#!/usr/bin/env python3
"""
VM1 Security Reporter
Runs on VM1 (App Server). Periodically hashes monitored files and POSTs
the manifest to VM2's Security API. Sends heartbeats and polls for restore
commands from VM2.

Environment variables:
  SECURITY_API_URL          - VM2 security API base URL (e.g. https://security.yourdomain.com)
  SECURITY_API_KEY          - API key shared with VM2
  VM1_WARDS_DIR             - Path to WARDS folder on VM1 (default: /WARDS)
  VM1_OCR_DIR               - Path to OCR folder on VM1 (default: /OCR)
  VM1_REPORT_INTERVAL       - Seconds between file scans (default: 30)
  VM1_HEARTBEAT_INTERVAL    - Seconds between heartbeats (default: 10)
  VM1_RESTORE_POLL_INTERVAL - Seconds between restore polls (default: 15)
  VM1_SNAPSHOT_DIR          - Local snapshot dir for self-recovery (default: /app/.vm1_snapshots)
"""

import base64
import gzip
import hashlib
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SECURITY_API_URL = (os.getenv("SECURITY_API_URL") or "").rstrip("/")
API_KEY = os.getenv("SECURITY_API_KEY", "")
ADMIN_SECRET = os.getenv("SECURITY_ADMIN_SECRET", "")

MONITORED_ROOTS = {
    "WARDS": Path(os.getenv("VM1_WARDS_DIR", "/WARDS")),
    "OCR": Path(os.getenv("VM1_OCR_DIR", "/OCR")),
}
DEPLOY_DIR = Path(os.getenv("DEPLOY_DIR", "/opt/wards/app"))

SCAN_INTERVAL = max(5, int(os.getenv("VM1_REPORT_INTERVAL", "10")))
HEARTBEAT_INTERVAL = max(5, int(os.getenv("VM1_HEARTBEAT_INTERVAL", "10")))
RESTORE_POLL_INTERVAL = max(3, int(os.getenv("VM1_RESTORE_POLL_INTERVAL", "5")))
CONFIG_FETCH_INTERVAL = max(3, int(os.getenv("VM1_CONFIG_FETCH_INTERVAL", "5")))
MAX_DYNAMIC_SCAN_INTERVAL = max(5, int(os.getenv("VM1_MAX_REPORT_INTERVAL", "60")))
SNAPSHOT_DIR = Path(os.getenv("VM1_SNAPSHOT_DIR", "/app/.vm1_snapshots"))
MAX_FILE_SNAPSHOT_BYTES = int(os.getenv("VM1_MAX_SNAPSHOT_BYTES", "2097152"))  # 2 MB
MAX_INLINE_CONTENT_BYTES = int(os.getenv("VM1_MAX_INLINE_CONTENT_BYTES", "131072"))  # 128 KB per file
MAX_MANIFEST_CONTENT_BYTES = int(os.getenv("VM1_MAX_MANIFEST_CONTENT_BYTES", "524288"))  # 512 KB total

CUSTOM_FOLDERS: list[Path] = []
DYNAMIC_SCAN_INTERVAL = SCAN_INTERVAL
FRONTEND_REBUILD_REASONS: set[str] = set()
LAST_DATABASE_CHECKSUM = ""

LOG_PREFIX = "[VM1-REPORTER]"

CRITICAL_INLINE_RELATIVE_PATHS = {
    "WARDS/frontend/index.html",
}

EXCLUDED_DIRS = {
    ".git",
    "__pycache__",
    ".pytest_cache",
    "node_modules",
    "venv",
    ".venv",
    "dist",
    "build",
    "output",
    "SECURITY",
    "local_backups",
    "QUARANTINE",
    "DEFACEMENT",
    "OCR",
}

MONITORED_SUFFIXES = {
    ".py",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".html",
    ".css",
    ".json",
    ".md",
    ".txt",
    ".xml",
    ".yml",
    ".yaml",
    ".sql",
    ".db",
    ".sqlite",
    ".sqlite3",
    ".php",
    ".phtml",
    ".pkl",
    ".csv",
}

INLINE_CONTENT_SUFFIXES = {
    ".py",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".html",
    ".css",
    ".json",
    ".php",
    ".phtml",
}

MONITORED_SPECIAL_FILENAMES = {"dockerfile", ".env", ".gitignore", ".gitkeep"}
MONITORED_SPECIAL_NAME_SUFFIXES = (".env", ".env.example", "env.example")


def log(msg: str):
    ts = datetime.now(timezone.utc).isoformat()
    print(f"{LOG_PREFIX} {ts} {msg}", flush=True)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def current_git_commit() -> str:
    """Return the deployed repo commit so VM2 can verify deployment baselines."""
    candidates = [DEPLOY_DIR, *MONITORED_ROOTS.values()]
    for candidate in candidates:
        try:
            result = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=candidate,
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except Exception:
            pass
    return "unknown"


def file_content_b64(path: Path) -> str | None:
    try:
        size = path.stat().st_size
        if size > MAX_FILE_SNAPSHOT_BYTES:
            return None
        with open(path, "rb") as f:
            return base64.b64encode(f.read()).decode()
    except Exception:
        return None


def _path_has_excluded_part(path: Path) -> bool:
    return any(part in EXCLUDED_DIRS or part.lower() in {item.lower() for item in EXCLUDED_DIRS} for part in path.parts)


def _file_monitorable(path: Path) -> bool:
    lower_name = path.name.lower()
    suffix = path.suffix.lower()
    if suffix in MONITORED_SUFFIXES:
        return True
    if lower_name in MONITORED_SPECIAL_FILENAMES:
        return True
    if any(lower_name.endswith(item) for item in MONITORED_SPECIAL_NAME_SUFFIXES):
        return True
    return False


def _should_inline_content(path: Path, size_bytes: int) -> bool:
    if size_bytes > MAX_INLINE_CONTENT_BYTES:
        return False
    lower_name = path.name.lower()
    if path.suffix.lower() in INLINE_CONTENT_SUFFIXES:
        return True
    return lower_name in MONITORED_SPECIAL_FILENAMES or any(lower_name.endswith(item) for item in MONITORED_SPECIAL_NAME_SUFFIXES)


def _inline_priority_rank(relative_path: str, path: Path, git_head_match: bool) -> int:
    if relative_path in CRITICAL_INLINE_RELATIVE_PATHS:
        return 0
    if not git_head_match and path.suffix.lower() in INLINE_CONTENT_SUFFIXES:
        return 1
    if not git_head_match:
        return 2
    return 3


def _git_info_for_root(root_path: Path) -> tuple[Path | None, set[str], set[str]]:
    """Return (git_root, tracked_files, modified_files) for a monitored root.

    If the root is not inside a git repo, returns (None, set(), set()).
    """
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=root_path,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode != 0:
            return None, set(), set()
        git_root = Path(result.stdout.strip())
    except Exception:
        return None, set(), set()

    tracked_files: set[str] = set()
    modified_files: set[str] = set()

    try:
        r = subprocess.run(
            ["git", "ls-files"],
            cwd=git_root,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if r.returncode == 0:
            tracked_files = set(r.stdout.strip().splitlines())
    except Exception:
        pass

    try:
        r = subprocess.run(
            ["git", "diff", "--name-only", "HEAD"],
            cwd=git_root,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if r.returncode == 0:
            modified_files = set(r.stdout.strip().splitlines())
    except Exception:
        pass

    return git_root, tracked_files, modified_files


def _iter_root_files(root_name: str, root_path: Path):
    if not root_path.exists():
        log(f"WARNING: root path does not exist: {root_path}")
        return
    git_root, tracked_files, modified_files = _git_info_for_root(root_path)
    for path in root_path.rglob("*"):
        if not path.is_file():
            continue
        if _path_has_excluded_part(path.relative_to(root_path)):
            continue
        if not _file_monitorable(path):
            continue
        # Skip environment files — they change as part of normal operations
        if path.name.lower() == ".env":
            continue
        rel = str(path.relative_to(root_path)).replace("\\", "/")
        git_head_match = False
        if git_root:
            try:
                rel_to_git = str(path.relative_to(git_root)).replace("\\", "/")
                if rel_to_git in tracked_files and rel_to_git not in modified_files:
                    git_head_match = True
            except ValueError:
                pass  # path is outside git_root
        try:
            stat = path.stat()
            current_hash = sha256_file(path)
        except Exception as exc:
            log(f"Skipping unreadable file {path}: {exc}")
            continue
        relative_path = f"{root_name}/{rel}"
        yield {
            "relative_path": relative_path,
            "folder_root": f"VM1_{root_name}",
            "file_path": str(path),
            "size_bytes": stat.st_size,
            "current_hash": current_hash,
            "content_b64": None,
            "inline_candidate": _should_inline_content(path, stat.st_size),
            "inline_priority": not git_head_match or relative_path in CRITICAL_INLINE_RELATIVE_PATHS,
            "inline_priority_rank": _inline_priority_rank(relative_path, path, git_head_match),
            "inline_always": relative_path in CRITICAL_INLINE_RELATIVE_PATHS,
            "git_head_match": git_head_match,
        }


def iter_monitored_files():
    inline_budget = MAX_MANIFEST_CONTENT_BYTES
    items = []
    for root_name, root_path in MONITORED_ROOTS.items():
        items.extend(_iter_root_files(root_name, root_path))
    for custom_path in CUSTOM_FOLDERS:
        if custom_path.exists() and custom_path.is_dir():
            root_name = custom_path.name
            items.extend(_iter_root_files(root_name, custom_path))

    # Changed files need content most urgently; without it VM2 can only see
    # a hash delta and cannot produce a trustworthy diff or recovery command.
    items.sort(key=lambda item: (item.get("inline_priority_rank", 3), item["relative_path"]))
    for item in items:
        inline_candidate = item.pop("inline_candidate", False)
        inline_always = item.pop("inline_always", False)
        if inline_candidate and (item["size_bytes"] <= inline_budget or inline_always):
            item["content_b64"] = file_content_b64(Path(item["file_path"]))
            if item["content_b64"] is not None:
                inline_budget = max(0, inline_budget - item["size_bytes"])
        item.pop("inline_priority", None)
        item.pop("inline_priority_rank", None)
        yield item


def send_manifest(files: list[dict]) -> bool:
    if not SECURITY_API_URL or not API_KEY:
        log("SECURITY_API_URL or SECURITY_API_KEY not set; skipping manifest upload")
        return False
    payload = {"files": files, "commit": current_git_commit()}

    def _post_manifest(manifest_payload: dict):
        return requests.post(
            f"{SECURITY_API_URL}/v1/vm1/files/register",
            headers={"X-API-Key": API_KEY, "Content-Type": "application/json"},
            json=manifest_payload,
            timeout=30,
        )

    try:
        inline_count = sum(1 for item in files if item.get("content_b64"))
        log(f"Uploading manifest with {len(files)} file(s), inline_content={inline_count}")
        resp = _post_manifest(payload)
        if resp.status_code == 413:
            log("Manifest upload hit HTTP 413; retrying with hash-only manifest")
            hash_only_files = []
            for item in files:
                compact = dict(item)
                compact["content_b64"] = None
                hash_only_files.append(compact)
            resp = _post_manifest({"files": hash_only_files, "commit": payload["commit"]})
        if resp.status_code == 200:
            data = resp.json()
            log(
                f"Manifest uploaded: registered={data.get('registered', 0)} "
                f"changed={data.get('changed', 0)} detections={data.get('detections', 0)}"
            )
            # Apply any restore commands returned immediately to avoid poll delay
            for cmd in data.get("restore_commands", []):
                success = apply_restore_command(cmd)
                # Ack immediately so VM2 can update the baseline without waiting
                # for the next poll cycle.
                try:
                    requests.post(
                        f"{SECURITY_API_URL}/v1/vm1/restore-ack",
                        headers={"X-API-Key": API_KEY, "Content-Type": "application/json"},
                        json={
                            "command_id": cmd.get("command_id"),
                            "success": success,
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        },
                        timeout=10,
                    )
                except Exception:
                    pass
            _flush_frontend_rebuild()
            return True
        log(f"Manifest upload failed: HTTP {resp.status_code} {resp.text[:200]}")
        return False
    except Exception as exc:
        log(f"Manifest upload exception: {exc}")
        return False


def send_heartbeat() -> bool:
    if not SECURITY_API_URL or not API_KEY:
        return False
    try:
        resp = requests.post(
            f"{SECURITY_API_URL}/v1/vm1/heartbeat",
            headers={"X-API-Key": API_KEY, "Content-Type": "application/json"},
            json={"timestamp": datetime.now(timezone.utc).isoformat()},
            timeout=10,
        )
        return resp.status_code == 200
    except Exception as exc:
        log(f"Heartbeat exception: {exc}")
        return False


def fetch_vm2_config() -> dict:
    if not SECURITY_API_URL or not API_KEY:
        return {}
    try:
        resp = requests.get(
            f"{SECURITY_API_URL}/v1/vm1/config",
            headers={"X-API-Key": API_KEY},
            timeout=10,
        )
        if resp.status_code == 200:
            return resp.json()
        log(f"Config fetch failed: HTTP {resp.status_code} {resp.text[:200]}")
    except Exception as exc:
        log(f"Config fetch exception: {exc}")
    return {}


def apply_vm2_config(cfg: dict) -> str:
    global DYNAMIC_SCAN_INTERVAL, CUSTOM_FOLDERS
    if not cfg:
        return ""
    new_interval = cfg.get("scan_interval_seconds")
    if new_interval and isinstance(new_interval, int):
        DYNAMIC_SCAN_INTERVAL = min(MAX_DYNAMIC_SCAN_INTERVAL, max(5, new_interval))
    custom = cfg.get("vm1_custom_folders", [])
    CUSTOM_FOLDERS = [Path(p) for p in custom if p]
    if new_interval:
        log(f"Config synced from VM2: interval={DYNAMIC_SCAN_INTERVAL}s custom_folders={len(CUSTOM_FOLDERS)}")
    return str(cfg.get("force_scan_token") or "")


def scan_and_send_manifest(reason: str) -> bool:
    try:
        # DB integrity is tiny compared with the file manifest. Send it first so
        # VM2 can mark the dashboard at-risk and queue DB recovery quickly.
        send_database_integrity_report(reason, force=reason == "forced")
        log(f"Preparing VM1 file manifest ({reason})")
        files = list(iter_monitored_files())
        snapshot_files(files)
        sent = send_manifest(files)
        poll_restore_commands()
        return sent
    except Exception as exc:
        log(f"Manifest scan/upload failed ({reason}): {exc}")
        return False


def _compose_base_command() -> tuple[list[str], str | None]:
    compose_dirs = ["/opt/wards/app", "/wards", "/app", "/"]
    cwd = None
    for d in compose_dirs:
        if Path(d).joinpath("docker-compose.yml").exists():
            cwd = d
            break
    return ["docker", "compose"], cwd


def vm1_critical_database_checksum() -> dict | None:
    """Hash critical VM1 DB settings that should rarely change outside admin workflows."""
    command, cwd = _compose_base_command()
    # Pass SQL via stdin so backtick-quoted identifiers are NOT interpreted
    # as shell command substitution by sh -lc.
    mysql_cmd = (
        'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -N -B'
    )
    sql = (
        "SELECT `key`, COALESCE(`value`, ''), COALESCE(`description`, ''), COALESCE(`updated_by`, '') "
        "FROM system_settings WHERE `key` IN ('sessionTimeout') ORDER BY `key`;"
    )
    try:
        result = subprocess.run(
            [*command, "exec", "-T", "mysql", "sh", "-lc", mysql_cmd],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=30,
            input=sql + "\n",
        )
        if result.returncode != 0:
            log(f"VM1 database checksum query failed: {result.stderr.strip()[:200]}")
            return None
        payload = result.stdout.strip()
        digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        suspicious = any(
            token in payload.lower()
            for token in ("hacked", "defacement", "unauthorized", "unauthorized_sql_test")
        )
        return {
            "checksum": digest,
            "scope": "critical_system_settings",
            "row_count": len([line for line in payload.splitlines() if line.strip()]),
            "sample": payload[:500],
            "suspicious": suspicious,
        }
    except FileNotFoundError:
        log("Docker compose is unavailable; VM1 database integrity report skipped")
    except Exception as exc:
        log(f"VM1 database checksum exception: {exc}")
    return None


def send_database_integrity_report(reason: str, *, force: bool = False) -> bool:
    global LAST_DATABASE_CHECKSUM
    if not SECURITY_API_URL or not API_KEY:
        return False
    report = vm1_critical_database_checksum()
    if not report:
        log(f"VM1 database integrity report skipped ({reason}); checksum unavailable")
        return False
    checksum = str(report.get("checksum") or "")
    if checksum == LAST_DATABASE_CHECKSUM and not report.get("suspicious") and not force:
        return True
    try:
        log(
            f"Uploading VM1 database integrity report ({reason}); "
            f"suspicious={bool(report.get('suspicious'))} row_count={report.get('row_count')}"
        )
        resp = requests.post(
            f"{SECURITY_API_URL}/v1/vm1/database/integrity",
            headers={"X-API-Key": API_KEY, "Content-Type": "application/json"},
            json={**report, "reason": reason, "timestamp": datetime.now(timezone.utc).isoformat()},
            timeout=20,
        )
        if resp.status_code == 200:
            LAST_DATABASE_CHECKSUM = checksum
            data = resp.json()
            if data.get("restore_queued"):
                log(f"VM1 database integrity drift reported; restore queued by VM2 ({data.get('command_id')})")
            else:
                log(f"VM1 database integrity accepted by VM2: {data.get('status', 'ok')}")
            return True
        log(f"VM1 database integrity upload failed: HTTP {resp.status_code} {resp.text[:200]}")
    except Exception as exc:
        log(f"VM1 database integrity upload exception: {exc}")
    return False


def _restore_affects_frontend(rel_path: str) -> bool:
    lower = rel_path.lower()
    return any(p in lower for p in ("/frontend/", "/public/", "index.html"))


def _queue_frontend_rebuild(rel_path: str):
    if _restore_affects_frontend(rel_path):
        FRONTEND_REBUILD_REASONS.add(rel_path)


def _flush_frontend_rebuild():
    """Rebuild and restart frontend container once after a batch of restored frontend files."""
    if not FRONTEND_REBUILD_REASONS:
        return
    restored_count = len(FRONTEND_REBUILD_REASONS)
    sample_path = sorted(FRONTEND_REBUILD_REASONS)[0]
    FRONTEND_REBUILD_REASONS.clear()

    # Find a directory that contains docker-compose.yml so the build
    # uses the correct compose definition and build context.
    compose_dirs = ["/opt/wards/app", "/wards", "/app", "/"]
    cwd = None
    for d in compose_dirs:
        if Path(d).joinpath("docker-compose.yml").exists():
            cwd = d
            break

    try:
        import subprocess
        # Try rebuilding the image first — a simple restart won’t pick up
        # restored source files because nginx serves static assets baked
        # into the image at build time.
        kwargs = {"capture_output": True, "text": True, "timeout": 300}
        if cwd:
            kwargs["cwd"] = cwd

        # docker compose (new plugin) vs docker-compose (legacy standalone)
        rebuild_cmds = [
            ["docker", "compose", "up", "-d", "--no-deps", "--build", "frontend"],
            ["docker-compose", "up", "-d", "--no-deps", "--build", "frontend"],
        ]
        result = None
        for cmd in rebuild_cmds:
            try:
                result = subprocess.run(cmd, **kwargs)
                if result.returncode == 0:
                    log(f"Frontend rebuilt and restarted after restoring {restored_count} frontend file(s); sample={sample_path}")
                    return
                break  # command exists but failed; don't try the other variant
            except FileNotFoundError:
                continue  # try next variant

        if result is not None and result.returncode != 0:
            err = result.stderr.strip() if result.stderr else "(no stderr)"
            log(f"Frontend rebuild failed: {err}")

        # Fallback: at least restart so any volume-mounted changes are picked up
        restart_cmds = [
            ["docker", "compose", "restart", "frontend"],
            ["docker-compose", "restart", "frontend"],
        ]
        for cmd in restart_cmds:
            try:
                fb = subprocess.run(
                    cmd,
                    **{k: v for k, v in kwargs.items() if k != "timeout"},
                    timeout=60,
                )
                if fb.returncode == 0:
                    log(f"Frontend restart fallback succeeded")
                    return
                break
            except FileNotFoundError:
                continue

        log("Docker not available inside vm1-reporter; frontend will not auto-rebuild")
    except Exception as exc:
        log(f"Frontend rebuild exception: {exc}")


def apply_restore_command(cmd: dict) -> bool:
    if cmd.get("command_type") == "vm1_database_restore":
        return apply_database_restore_command(cmd)

    rel_path = cmd.get("relative_path", "")
    expected_hash = cmd.get("expected_hash")
    content_b64 = cmd.get("restore_content_b64")

    # Resolve the actual path on VM1
    target = None
    for root_name, root_path in MONITORED_ROOTS.items():
        # Heartbeat sends relative_path as "WARDS/backend/..." with folder_root "VM1_WARDS";
        # commands may use either format.
        for prefix in (f"VM1_{root_name}/", f"{root_name}/"):
            if rel_path.startswith(prefix):
                suffix = rel_path[len(prefix):]
                target = root_path / suffix
                break
        if target is not None:
            break

    if target is None:
        for custom_path in CUSTOM_FOLDERS:
            for prefix in (f"VM1_{custom_path.name}/", f"{custom_path.name}/"):
                if rel_path.startswith(prefix):
                    suffix = rel_path[len(prefix):]
                    target = custom_path / suffix
                    break
            if target is not None:
                break
    if target is None:
        log(f"Could not resolve restore path for {rel_path}")
        return False

    try:
        target.parent.mkdir(parents=True, exist_ok=True)

        if content_b64:
            data = base64.b64decode(content_b64)
            with open(target, "wb") as f:
                f.write(data)
        else:
            log(f"Restore command for {rel_path} has no content_b64; skipping (local snapshot would be defaced).")
            return False

        actual_hash = sha256_file(target)
        if expected_hash and actual_hash != expected_hash:
            log(f"Restore hash mismatch for {rel_path}: expected {expected_hash} got {actual_hash}")
            return False

        log(f"Restored {rel_path} (hash: {actual_hash})")
        _queue_frontend_rebuild(rel_path)
        return True
    except Exception as exc:
        log(f"Restore failed for {rel_path}: {exc}")
        return False


def apply_database_restore_command(cmd: dict) -> bool:
    missing = []
    if not SECURITY_API_URL:
        missing.append("SECURITY_API_URL")
    if not API_KEY:
        missing.append("SECURITY_API_KEY")
    if not ADMIN_SECRET:
        missing.append("SECURITY_ADMIN_SECRET")
    if missing:
        log(f"VM1 database restore command skipped; missing env: {', '.join(missing)}")
        return False
    command_id = str(cmd.get("command_id") or f"dbrestore_{int(time.time())}")
    download_path = Path(f"/tmp/{command_id}.sql.gz")
    try:
        with requests.get(
            f"{SECURITY_API_URL}/v1/vm1/database-backups/latest",
            headers={"X-API-Key": API_KEY, "X-Admin-Secret": ADMIN_SECRET},
            timeout=120,
            stream=True,
        ) as resp:
            if resp.status_code != 200:
                log(f"VM1 database backup download failed: HTTP {resp.status_code} {resp.text[:200]}")
                return False
            with open(download_path, "wb") as handle:
                for chunk in resp.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        handle.write(chunk)

        with gzip.open(download_path, "rb") as source:
            sql_payload = source.read()

        compose_cmd, cwd = _compose_base_command()
        restore = subprocess.run(
            [
                *compose_cmd,
                "exec",
                "-T",
                "mysql",
                "sh",
                "-lc",
                'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"',
            ],
            input=sql_payload,
            cwd=cwd,
            capture_output=True,
            timeout=180,
        )
        if restore.returncode != 0:
            stderr = restore.stderr.decode("utf-8", errors="replace") if restore.stderr else ""
            log(f"VM1 database restore failed: {stderr[:300]}")
            return False
        log(f"VM1 database restored from latest VM2 archive for command {command_id}")
        send_database_integrity_report("database_restore")
        return True
    except Exception as exc:
        log(f"VM1 database restore exception: {exc}")
        return False
    finally:
        try:
            download_path.unlink(missing_ok=True)
        except Exception:
            pass


def poll_restore_commands():
    if not SECURITY_API_URL or not API_KEY:
        return
    try:
        resp = requests.get(
            f"{SECURITY_API_URL}/v1/vm1/restore-command",
            headers={"X-API-Key": API_KEY},
            timeout=10,
        )
        if resp.status_code != 200:
            return
        commands = resp.json().get("commands", [])
        for cmd in commands:
            cmd_id = cmd.get("command_id")
            success = apply_restore_command(cmd)
            requests.post(
                f"{SECURITY_API_URL}/v1/vm1/restore-ack",
                headers={"X-API-Key": API_KEY, "Content-Type": "application/json"},
                json={
                    "command_id": cmd_id,
                    "success": success,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
                timeout=10,
            )
        _flush_frontend_rebuild()
    except Exception as exc:
        log(f"Restore poll exception: {exc}")


def snapshot_files(files: list[dict]):
    for f in files:
        rel = f["relative_path"]
        src = Path(f["file_path"])
        dst = SNAPSHOT_DIR / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        try:
            import shutil
            shutil.copy2(src, dst)
        except Exception:
            pass


def main_loop():
    global DYNAMIC_SCAN_INTERVAL, CUSTOM_FOLDERS
    log("Starting VM1 Security Reporter")
    log(f"Monitored roots: {{{', '.join(f'{k}: {v}' for k, v in MONITORED_ROOTS.items())}}}")
    log(f"VM2 API: {SECURITY_API_URL}")
    log(f"Initial scan interval: {SCAN_INTERVAL}s | Heartbeat: {HEARTBEAT_INTERVAL}s | Restore poll: {RESTORE_POLL_INTERVAL}s")

    last_scan = 0
    last_heartbeat = 0
    last_restore_poll = 0
    last_config_fetch = 0
    last_force_scan_token = ""
    force_scan_due = False

    while True:
        now = time.time()

        # Fetch unified config from VM2 frequently so manual scans can force
        # a fresh manifest without waiting for a long report interval.
        if now - last_config_fetch >= CONFIG_FETCH_INTERVAL:
            cfg = fetch_vm2_config()
            force_scan_token = apply_vm2_config(cfg)
            if force_scan_token and force_scan_token != last_force_scan_token:
                last_force_scan_token = force_scan_token
                force_scan_due = True
                log(f"VM2 requested immediate manifest scan: {force_scan_token}")
            last_config_fetch = now

        if now - last_heartbeat >= HEARTBEAT_INTERVAL:
            if send_heartbeat():
                last_heartbeat = now

        if force_scan_due or now - last_scan >= DYNAMIC_SCAN_INTERVAL:
            cfg = fetch_vm2_config()
            force_scan_token = apply_vm2_config(cfg)
            if force_scan_token and force_scan_token != last_force_scan_token:
                last_force_scan_token = force_scan_token
                force_scan_due = True
                log(f"VM2 requested immediate manifest scan: {force_scan_token}")
            if cfg.get("deployment_paused"):
                log("VM2 deployment is paused — change detections suppressed, but manifest will still be uploaded")
            scan_and_send_manifest("forced" if force_scan_due else "interval")
            force_scan_due = False
            last_scan = now

        if now - last_restore_poll >= RESTORE_POLL_INTERVAL:
            poll_restore_commands()
            last_restore_poll = now

        time.sleep(1)


if __name__ == "__main__":
    try:
        main_loop()
    except KeyboardInterrupt:
        log("Shutting down")
        sys.exit(0)
