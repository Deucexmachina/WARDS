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
import hashlib
import os
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

MONITORED_ROOTS = {
    "WARDS": Path(os.getenv("VM1_WARDS_DIR", "/WARDS")),
    "OCR": Path(os.getenv("VM1_OCR_DIR", "/OCR")),
}

SCAN_INTERVAL = max(5, int(os.getenv("VM1_REPORT_INTERVAL", "30")))
HEARTBEAT_INTERVAL = max(5, int(os.getenv("VM1_HEARTBEAT_INTERVAL", "10")))
RESTORE_POLL_INTERVAL = max(5, int(os.getenv("VM1_RESTORE_POLL_INTERVAL", "15")))
SNAPSHOT_DIR = Path(os.getenv("VM1_SNAPSHOT_DIR", "/app/.vm1_snapshots"))
MAX_FILE_SNAPSHOT_BYTES = int(os.getenv("VM1_MAX_SNAPSHOT_BYTES", "102400"))  # 100 KB

CUSTOM_FOLDERS: list[Path] = []
DYNAMIC_SCAN_INTERVAL = SCAN_INTERVAL

LOG_PREFIX = "[VM1-REPORTER]"


def log(msg: str):
    ts = datetime.now(timezone.utc).isoformat()
    print(f"{LOG_PREFIX} {ts} {msg}", flush=True)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def file_content_b64(path: Path) -> str | None:
    try:
        size = path.stat().st_size
        if size > MAX_FILE_SNAPSHOT_BYTES:
            return None
        with open(path, "rb") as f:
            return base64.b64encode(f.read()).decode()
    except Exception:
        return None


def _iter_root_files(root_name: str, root_path: Path):
    if not root_path.exists():
        log(f"WARNING: root path does not exist: {root_path}")
        return
    for path in root_path.rglob("*"):
        if not path.is_file():
            continue
        # Skip environment files — they change as part of normal operations
        if path.name.lower() == ".env":
            continue
        rel = str(path.relative_to(root_path)).replace("\\", "/")
        yield {
            "relative_path": f"{root_name}/{rel}",
            "folder_root": f"VM1_{root_name}",
            "file_path": str(path),
            "size_bytes": path.stat().st_size,
            "current_hash": sha256_file(path),
            "content_b64": file_content_b64(path),
        }


def iter_monitored_files():
    for root_name, root_path in MONITORED_ROOTS.items():
        yield from _iter_root_files(root_name, root_path)
    for custom_path in CUSTOM_FOLDERS:
        if custom_path.exists() and custom_path.is_dir():
            root_name = custom_path.name
            yield from _iter_root_files(root_name, custom_path)


def send_manifest(files: list[dict]) -> bool:
    if not SECURITY_API_URL or not API_KEY:
        log("SECURITY_API_URL or SECURITY_API_KEY not set; skipping manifest upload")
        return False
    try:
        resp = requests.post(
            f"{SECURITY_API_URL}/v1/vm1/files/register",
            headers={"X-API-Key": API_KEY, "Content-Type": "application/json"},
            json={"files": files},
            timeout=30,
        )
        if resp.status_code == 200:
            data = resp.json()
            log(
                f"Manifest uploaded: registered={data.get('registered', 0)} "
                f"changed={data.get('changed', 0)} detections={data.get('detections', 0)}"
            )
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
    except Exception as exc:
        log(f"Config fetch exception: {exc}")
    return {}


def apply_restore_command(cmd: dict) -> bool:
    rel_path = cmd.get("relative_path", "")
    expected_hash = cmd.get("expected_hash")
    content_b64 = cmd.get("restore_content_b64")

    # Resolve the actual path on VM1
    target = None
    for root_name, root_path in MONITORED_ROOTS.items():
        prefix = f"VM1_{root_name}/"
        if rel_path.startswith(prefix):
            suffix = rel_path[len(prefix):]
            target = root_path / suffix
            break

    if target is None:
        for custom_path in CUSTOM_FOLDERS:
            prefix = f"{custom_path.name}/"
            if rel_path.startswith(prefix):
                suffix = rel_path[len(prefix):]
                target = custom_path / suffix
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
            snapshot = SNAPSHOT_DIR / rel_path
            if snapshot.exists():
                import shutil
                shutil.copy2(snapshot, target)
            else:
                log(f"No snapshot or content for restore: {rel_path}")
                return False

        actual_hash = sha256_file(target)
        if expected_hash and actual_hash != expected_hash:
            log(f"Restore hash mismatch for {rel_path}: expected {expected_hash} got {actual_hash}")
            return False

        log(f"Restored {rel_path} (hash: {actual_hash})")
        return True
    except Exception as exc:
        log(f"Restore failed for {rel_path}: {exc}")
        return False


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

    while True:
        now = time.time()

        # Fetch unified config from VM2 every 60s
        if now - last_config_fetch >= 60:
            cfg = fetch_vm2_config()
            if cfg:
                new_interval = cfg.get("scan_interval_seconds")
                if new_interval and isinstance(new_interval, int):
                    DYNAMIC_SCAN_INTERVAL = max(5, new_interval)
                custom = cfg.get("vm1_custom_folders", [])
                CUSTOM_FOLDERS = [Path(p) for p in custom if p]
                if new_interval:
                    log(f"Config synced from VM2: interval={DYNAMIC_SCAN_INTERVAL}s custom_folders={len(CUSTOM_FOLDERS)}")
            last_config_fetch = now

        if now - last_heartbeat >= HEARTBEAT_INTERVAL:
            if send_heartbeat():
                last_heartbeat = now

        if now - last_scan >= DYNAMIC_SCAN_INTERVAL:
            cfg = fetch_vm2_config()
            if cfg.get("deployment_paused"):
                log("VM2 deployment is paused — skipping manifest upload")
            else:
                files = list(iter_monitored_files())
                snapshot_files(files)
                send_manifest(files)
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
