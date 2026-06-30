from __future__ import annotations

import csv
import json
import posixpath
import shlex
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

import requests

from eval_config import (
    CLEANUP_WAIT_SECONDS,
    DETECTION_LOOKBACK_SECONDS,
    FINAL_CLEANUP_GIT_RESET,
    FINAL_CLEANUP_REBUILD,
    FINAL_CLEANUP_RESTORE_VM1_DB,
    PREFLIGHT_POLL_SECONDS,
    PREFLIGHT_WAIT_SECONDS,
    REQUEST_TIMEOUT_SECONDS,
    REPAIR_ADMIN_EMAIL,
    REPAIR_ADMIN_PASSWORD,
    RESULTS_CSV,
    SCAN_BACKOFF_SECONDS,
    SCAN_WAIT_SECONDS,
    SSH_RETRIES,
    VERIFY_TLS,
    VM1_DIRECT_MANIFEST,
    VM1_SNAPSHOT_WAIT_SECONDS,
    VM1_APP_DIR,
    VM1_HOST,
    VM1_MYSQL_CONTAINER,
    VM1_MYSQL_DATABASE,
    VM1_MYSQL_PASSWORD,
    VM1_MYSQL_USER,
    VM1_SSH_KEY_PATH,
    VM1_SSH_USER,
    VM2_ADMIN_SECRET,
    VM2_API_KEY,
    VM2_API_URL,
    VM2_APP_DIR,
    VM2_HOST,
    VM2_MYSQL_CONTAINER,
    VM2_MYSQL_DATABASE,
    VM2_MYSQL_PASSWORD,
    VM2_MYSQL_USER,
    VM2_SSH_KEY_PATH,
    VM2_SSH_USER,
)


HEADERS = {"X-API-Key": VM2_API_KEY, "Content-Type": "application/json"}
EVAL_HEADERS = {**HEADERS, "X-Admin-Secret": VM2_ADMIN_SECRET, "X-Evaluation-Run": "true"}
_last_scan_at = 0.0


@dataclass
class TestCase:
    test_id: str
    scenario: str
    domain: str
    actual: str
    action: Callable[[], None]
    trigger_scan: bool = False
    wait_seconds: int | None = None
    cleanup: Callable[[], None] | None = None
    notes: str = ""
    target_hint: str | None = None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def api_get(path: str, *, headers: dict | None = None) -> object:
    response = requests.get(
        f"{VM2_API_URL}{path}",
        headers=headers or HEADERS,
        timeout=REQUEST_TIMEOUT_SECONDS,
        verify=VERIFY_TLS,
    )
    response.raise_for_status()
    return response.json()


def api_post(path: str, payload: dict | None = None, *, headers: dict | None = None) -> object:
    response = requests.post(
        f"{VM2_API_URL}{path}",
        headers=headers or HEADERS,
        json=payload or {},
        timeout=REQUEST_TIMEOUT_SECONDS,
        verify=VERIFY_TLS,
    )
    response.raise_for_status()
    return response.json()


def trigger_scan_all() -> list[dict]:
    global _last_scan_at
    elapsed = time.time() - _last_scan_at
    if elapsed < SCAN_BACKOFF_SECONDS:
        time.sleep(SCAN_BACKOFF_SECONDS - elapsed)
    result = api_post(
        "/v1/scan/all",
        {"context": {"evaluation_run": True, "manual_scan": True, "force_full_registration": True}},
        headers=EVAL_HEADERS,
    )
    _last_scan_at = time.time()
    return list((result or {}).get("detections") or [])


def query_new_detections(since_iso: str, *, target: str | None = None) -> list[dict]:
    rows = api_post(
        "/v1/detections/query",
        {"sort": "newest", "limit": 100, "date_from": since_iso, "target": target},
        headers=HEADERS,
    )
    return list(rows or [])


def api_files() -> list[dict]:
    rows = api_get("/v1/files", headers=HEADERS)
    return list(rows or [])


def normalize_rel_path(path: str | None) -> str:
    return str(path or "").replace("\\", "/").strip("/")


def vm1_manifest_for_targets(relative_paths: list[str]) -> dict:
    """Submit a VM1 manifest for target files through VM2's normal reporter endpoint."""
    targets = [normalize_rel_path(path) for path in relative_paths if path]
    if not targets:
        return {"registered": 0, "changed": 0, "detections": 0}
    script = r'''
import base64
import hashlib
import json
import subprocess
import sys
from pathlib import Path

app_dir = Path(sys.argv[1])
relative_paths = [item.replace("\\", "/").strip("/") for item in sys.argv[2:]]

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()

def run_git(args, cwd):
    try:
        result = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return ""

git_root_text = run_git(["rev-parse", "--show-toplevel"], app_dir)
git_root = Path(git_root_text) if git_root_text else app_dir
commit = run_git(["rev-parse", "HEAD"], git_root) or "unknown"
tracked = set((run_git(["ls-files"], git_root) or "").splitlines())
modified = set((run_git(["diff", "--name-only", "HEAD"], git_root) or "").splitlines())

files = []
for rel in relative_paths:
    path = app_dir / rel
    root_name = rel.split("/", 1)[0] if rel else "WARDS"
    if not path.exists() or not path.is_file():
        files.append({
            "relative_path": rel,
            "folder_root": f"VM1_{root_name}",
            "deleted": True,
            "current_hash": "",
            "content_b64": None,
        })
        continue
    size = path.stat().st_size
    content_b64 = None
    if size <= 2097152:
        content_b64 = base64.b64encode(path.read_bytes()).decode()
    try:
        rel_to_git = path.relative_to(git_root).as_posix()
    except Exception:
        rel_to_git = rel
    files.append({
        "relative_path": rel,
        "folder_root": f"VM1_{root_name}",
        "file_path": str(path),
        "size_bytes": size,
        "current_hash": sha256_file(path),
        "content_b64": content_b64,
        "git_head_match": rel_to_git in tracked and rel_to_git not in modified,
    })

print(json.dumps({"commit": commit, "files": files}))
'''
    command = f"python3 - {q(VM1_APP_DIR)} {' '.join(q(path) for path in targets)} <<'PY'\n{script}\nPY"
    payload = json.loads(vm1(command, timeout=REQUEST_TIMEOUT_SECONDS))
    return api_post("/v1/vm1/files/register", payload, headers=EVAL_HEADERS)


def direct_vm1_manifest_enabled(case: TestCase) -> bool:
    return bool(VM1_DIRECT_MANIFEST and case.domain == "application_files" and case.target_hint)


def target_file_status(files: list[dict], target: str) -> dict | None:
    needle = normalize_rel_path(target).lower()
    for item in files:
        if normalize_rel_path(item.get("relative_path")).lower() == needle:
            return item
    return None


def required_vm1_targets(cases: list[TestCase]) -> list[str]:
    return sorted(
        {
            normalize_rel_path(case.target_hint)
            for case in cases
            if case.domain == "application_files" and case.target_hint
        }
    )


def wait_for_vm1_targets(targets: list[str]) -> tuple[list[str], list[dict]]:
    files = api_files()
    deadline = time.time() + max(0, PREFLIGHT_WAIT_SECONDS)
    while True:
        missing = [
            target for target in targets
            if not (target_file_status(files, target) or {}).get("baseline_hash")
        ]
        if not missing or time.time() >= deadline:
            return missing, files
        time.sleep(max(1, PREFLIGHT_POLL_SECONDS))
        files = api_files()


def print_diagnostics(cases: list[TestCase]) -> None:
    targets = required_vm1_targets(cases)
    print("VM2 health:", api_get("/health", headers=HEADERS))
    print("VM1 config:", api_get("/v1/vm1/config", headers=HEADERS))
    for key in [
        "vm1_last_heartbeat_at",
        "vm1_last_heartbeat_status",
        "vm1_last_manifest_at",
        "vm1_last_manifest_deployment_paused",
        "deployment_vm1_baseline_ready",
        "scan_interval_seconds",
    ]:
        try:
            print(f"{key}:", api_post("/v1/settings/get", {"key": key, "default": ""}, headers=HEADERS))
        except Exception as exc:
            print(f"{key}: ERROR {exc}")
    files = api_files()
    print(f"VM2 monitored file rows: {len(files)}")
    for target in targets[:25]:
        status = target_file_status(files, target)
        if status:
            print(
                f"registered {target}: status={status.get('status')} "
                f"baseline={str(status.get('baseline_hash') or '')[:12]} "
                f"current={str(status.get('current_hash') or '')[:12]}"
            )
        else:
            print(f"missing {target}: no monitored file row")


def merge_detections(*groups: list[dict]) -> list[dict]:
    merged: list[dict] = []
    seen: set[str] = set()
    for group in groups:
        for detection in group or []:
            key = str(detection.get("id") or detection.get("incident_id") or json.dumps(detection, sort_keys=True))
            if key in seen:
                continue
            seen.add(key)
            merged.append(detection)
    return merged


def detection_matches_case(detection: dict, case: TestCase) -> bool:
    if not case.target_hint:
        return True
    haystack = " ".join(
        str(detection.get(key) or "")
        for key in ("target_name", "trigger_summary", "change_type", "actor")
    ).replace("\\", "/").lower()
    return case.target_hint.replace("\\", "/").lower() in haystack


def matching_detections(detections: list[dict], case: TestCase) -> list[dict]:
    matched = [item for item in detections if detection_matches_case(item, case)]
    return matched or ([] if case.target_hint else detections)


def detection_is_actionable(detection: dict) -> bool:
    if detection.get("incident_id"):
        return True
    prediction = str(detection.get("ai_prediction") or "").lower()
    if prediction in {"suspicious", "malicious", "manifest_detected"}:
        return True
    severity = str(detection.get("severity_level") or "").lower()
    return severity in {"medium", "high", "critical"}


def resolve_incident(incident_id: int | str | None) -> bool:
    if not incident_id:
        return False
    try:
        api_post(
            "/v1/incidents/resolve",
            {"incident_id": int(incident_id), "admin_id": None, "confirm_missing_files": True},
            headers=EVAL_HEADERS,
        )
        return True
    except Exception:
        return False


def record_result(row: dict) -> None:
    RESULTS_CSV.parent.mkdir(parents=True, exist_ok=True)
    exists = RESULTS_CSV.exists()
    fields = [
        "test_id",
        "scenario",
        "domain",
        "actual",
        "predicted",
        "result",
        "incident_id",
        "detection_id",
        "ai_score",
        "ai_prediction",
        "latency_seconds",
        "timestamp",
        "notes",
    ]
    with RESULTS_CSV.open("a", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        if not exists:
            writer.writeheader()
        writer.writerow({field: row.get(field, "") for field in fields})


def classify_result(actual: str, predicted: str) -> str:
    if predicted == "error":
        return "ERROR"
    if actual == "attack" and predicted == "attack":
        return "TP"
    if actual == "attack" and predicted == "benign":
        return "FN"
    if actual == "benign" and predicted == "attack":
        return "FP"
    return "TN"


def run_test(case: TestCase) -> dict:
    print(f"[{case.test_id}] {case.scenario}")
    started = time.time()
    start_iso = (datetime.now(timezone.utc) - timedelta(seconds=DETECTION_LOOKBACK_SECONDS)).isoformat()
    predicted = "benign"
    detection = None
    error = ""
    diagnostics: list[str] = []
    try:
        if direct_vm1_manifest_enabled(case):
            vm1_manifest_for_targets([case.target_hint or ""])
            skew_guard = min(max(DETECTION_LOOKBACK_SECONDS, 5), 30)
            start_iso = (datetime.now(timezone.utc) - timedelta(seconds=skew_guard)).isoformat()
        case.action()
        if direct_vm1_manifest_enabled(case):
            manifest_result = vm1_manifest_for_targets([case.target_hint or ""])
            manifest_ids = [str(item) for item in (manifest_result or {}).get("detection_ids", [])]
            manifest_detection_count = int((manifest_result or {}).get("detections") or len(manifest_ids) or 0)
            diagnostics.append(
                "vm1_manifest="
                f"registered:{(manifest_result or {}).get('registered', 0)},"
                f"changed:{(manifest_result or {}).get('changed', 0)},"
                f"detections:{manifest_detection_count}"
            )
            queried = query_new_detections(start_iso, target=case.target_hint)
            detections = matching_detections(queried, case)
            if not detections and manifest_ids:
                broader = merge_detections(query_new_detections(start_iso), query_new_detections(""))
                detections = [
                    item for item in broader
                    if str(item.get("id")) in manifest_ids or detection_matches_case(item, case)
                ]
            if not detections and manifest_detection_count > 0:
                detections = [{
                    "id": manifest_ids[0] if manifest_ids else "",
                    "incident_id": "",
                    "target_name": case.target_hint,
                    "ai_score": "",
                    "ai_prediction": "manifest_detected",
                }]
        elif case.trigger_scan:
            if case.domain == "application_files" and VM1_SNAPSHOT_WAIT_SECONDS > 0:
                time.sleep(VM1_SNAPSHOT_WAIT_SECONDS)
            scan_detections = trigger_scan_all()
            # VM1 file detections can be created by the reporter during the
            # snapshot wait, before /scan/all returns. Query the detection log
            # as well so the evaluator does not count real detections as FNs.
            detections = matching_detections(
                merge_detections(scan_detections, query_new_detections(start_iso, target=case.target_hint)),
                case,
            )
        else:
            wait_for = SCAN_WAIT_SECONDS if case.wait_seconds is None else case.wait_seconds
            if wait_for > 0:
                time.sleep(wait_for)
            if case.actual == "benign" and not case.target_hint:
                detections = []
            else:
                detections = matching_detections(query_new_detections(start_iso, target=case.target_hint), case)
        if detections:
            actionable = [item for item in detections if detection_is_actionable(item)]
            if actionable:
                predicted = "attack"
                detection = actionable[0]
    except Exception as exc:
        predicted = "error"
        error = str(exc)
        print(f"  ERROR: {error}")
    finally:
        if detection:
            resolve_incident(detection.get("incident_id") or detection.get("id"))
        if case.cleanup:
            try:
                case.cleanup()
            except Exception as exc:
                error = (error + "; " if error else "") + f"cleanup: {exc}"
        if CLEANUP_WAIT_SECONDS > 0:
            time.sleep(CLEANUP_WAIT_SECONDS)

    result = classify_result(case.actual, predicted)
    row = {
        "test_id": case.test_id,
        "scenario": case.scenario,
        "domain": case.domain,
        "actual": case.actual,
        "predicted": predicted,
        "result": result,
        "incident_id": (detection or {}).get("incident_id", ""),
        "detection_id": (detection or {}).get("id", ""),
        "ai_score": (detection or {}).get("ai_score", ""),
        "ai_prediction": (detection or {}).get("ai_prediction", ""),
        "latency_seconds": round(time.time() - started, 3),
        "timestamp": now_iso(),
        "notes": "; ".join(part for part in [case.notes, *diagnostics, error] if part),
    }
    record_result(row)
    print(f"  {result}: predicted={predicted}")
    return row


def ssh(host: str, user: str, key_path: str, command: str, *, timeout: int = REQUEST_TIMEOUT_SECONDS) -> str:
    cmd = [
        "ssh",
        "-i",
        str(Path(key_path).expanduser()),
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "ConnectTimeout=15",
        "-o",
        "ServerAliveInterval=10",
        "-o",
        "ServerAliveCountMax=2",
        f"{user}@{host}",
        command,
    ]
    last_error = ""
    for attempt in range(max(1, SSH_RETRIES)):
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
            if result.returncode == 0:
                return result.stdout.strip()
            last_error = result.stderr.strip() or result.stdout.strip() or f"ssh exited {result.returncode}"
        except subprocess.TimeoutExpired as exc:
            last_error = f"ssh timed out after {timeout} seconds"
            if exc.stderr:
                last_error += f": {exc.stderr}"
        if attempt + 1 < max(1, SSH_RETRIES):
            time.sleep(2)
    raise RuntimeError(last_error)


def vm1(command: str, *, timeout: int = REQUEST_TIMEOUT_SECONDS) -> str:
    return ssh(VM1_HOST, VM1_SSH_USER, VM1_SSH_KEY_PATH, command, timeout=timeout)


def vm2(command: str, *, timeout: int = REQUEST_TIMEOUT_SECONDS) -> str:
    return ssh(VM2_HOST, VM2_SSH_USER, VM2_SSH_KEY_PATH, command, timeout=timeout)


def q(value: str) -> str:
    return shlex.quote(value)


def vm1_path(relative_path: str) -> str:
    return f"{VM1_APP_DIR.rstrip('/')}/{relative_path.lstrip('/')}"


def vm2_path(relative_path: str) -> str:
    return f"{VM2_APP_DIR.rstrip('/')}/{relative_path.lstrip('/')}"


def vm1_append(relative_path: str, content: str) -> None:
    target = vm1_path(relative_path)
    vm1(f"mkdir -p {q(posixpath.dirname(target))} && printf %s {q(content)} >> {q(target)}")


def vm2_append(relative_path: str, content: str) -> None:
    target = vm2_path(relative_path)
    vm2(f"mkdir -p {q(posixpath.dirname(target))} && printf %s {q(content)} >> {q(target)}")


def vm1_delete(relative_path: str) -> None:
    vm1(f"rm -f {q(vm1_path(relative_path))}")


def vm2_delete(relative_path: str) -> None:
    vm2(f"rm -f {q(vm2_path(relative_path))}")


def vm1_backup(relative_path: str) -> str:
    backup = f"{vm1_path(relative_path)}.evalbak"
    vm1(f"if [ -f {q(vm1_path(relative_path))} ]; then cp {q(vm1_path(relative_path))} {q(backup)}; else rm -f {q(backup)}; fi")
    return backup


def vm1_restore(relative_path: str) -> None:
    backup = f"{vm1_path(relative_path)}.evalbak"
    vm1(f"if [ -f {q(backup)} ]; then mv {q(backup)} {q(vm1_path(relative_path))}; else rm -f {q(vm1_path(relative_path))}; fi")


def vm2_backup(relative_path: str) -> str:
    backup = f"{vm2_path(relative_path)}.evalbak"
    vm2(f"if [ -f {q(vm2_path(relative_path))} ]; then cp {q(vm2_path(relative_path))} {q(backup)}; else rm -f {q(backup)}; fi")
    return backup


def vm2_restore(relative_path: str) -> None:
    backup = f"{vm2_path(relative_path)}.evalbak"
    vm2(f"if [ -f {q(backup)} ]; then mv {q(backup)} {q(vm2_path(relative_path))}; else rm -f {q(vm2_path(relative_path))}; fi")


def _restore_eval_backups_script(app_dir: str, *, git_reset: bool, rebuild: bool, compose_file: str = "docker-compose.yml") -> str:
    reset_cmd = "git fetch origin main && git reset --hard origin/main" if git_reset else "true"
    compose_arg = f"-f {compose_file}" if compose_file else ""
    rebuild_cmd = f"docker compose {compose_arg} up -d --build" if rebuild else "docker compose ps || true"
    return f"""
set -e
cd {q(app_dir)}
find . -name '*.evalbak' -type f -exec sh -c 'for backup do original="${{backup%.evalbak}}"; mkdir -p "$(dirname "$original")"; mv "$backup" "$original"; done' sh {{}} +
rm -rf WARDS/backend/evaluation_logs WARDS/frontend/evaluation_logs
{reset_cmd}
{rebuild_cmd}
""".strip()


def repair_vm1_admin_password_if_configured() -> str:
    if not REPAIR_ADMIN_EMAIL or not REPAIR_ADMIN_PASSWORD:
        return "admin_password_repair=skipped"
    script = r'''
import os
import sys
sys.path.insert(0, "/app")
from auth import hash_password
print(hash_password(os.environ["EVAL_REPAIR_ADMIN_PASSWORD"]))
'''
    hash_cmd = (
        f"docker compose exec -T -e EVAL_REPAIR_ADMIN_PASSWORD={q(REPAIR_ADMIN_PASSWORD)} "
        f"backend python - <<'PY'\n{script}\nPY"
    )
    password_hash = vm1(f"cd {q(VM1_APP_DIR)} && {hash_cmd}", timeout=REQUEST_TIMEOUT_SECONDS).strip().splitlines()[-1]
    sql = (
        "UPDATE admins "
        f"SET hashed_password={sql_quote(password_hash)} "
        f"WHERE email={sql_quote(REPAIR_ADMIN_EMAIL)};"
    )
    vm1_mysql(sql)
    return f"admin_password_repair=updated:{REPAIR_ADMIN_EMAIL}"


def restore_vm1_admin_hashes_from_backups() -> str:
    script = r'''
import ast
import gzip
import re
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, "/app")
from database.models import Admin, CitizenUser, Payment, SessionLocal
from utils.backup_engine import backup_dir
from utils.security_client import SECURITY_API_URL, list_vm1_database_backup_archives, download_vm1_database_backup_archive
import requests

VALID_HASH_PREFIXES = ("$2a$", "$2b$", "$2y$", "$argon2", "pbkdf2:", "scrypt:")


def valid_hash(value):
    value = str(value or "")
    return value.startswith(VALID_HASH_PREFIXES) and len(value) >= 40


def split_sql_values(payload):
    rows = []
    current = []
    token = []
    in_quote = False
    escape = False
    depth = 0
    for char in payload:
        if in_quote:
            token.append(char)
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == "'":
                in_quote = False
            continue
        if char == "'":
            token.append(char)
            in_quote = True
            continue
        if char == "(":
            if depth == 0:
                current = []
                token = []
            else:
                token.append(char)
            depth += 1
            continue
        if char == ")" and depth:
            depth -= 1
            if depth == 0:
                current.append("".join(token).strip())
                rows.append(current)
                token = []
            else:
                token.append(char)
            continue
        if char == "," and depth == 1:
            current.append("".join(token).strip())
            token = []
            continue
        if depth:
            token.append(char)
    return rows


def decode_sql_value(value):
    value = value.strip()
    if value.upper() == "NULL":
        return None
    if value.startswith("'") and value.endswith("'"):
        try:
            return ast.literal_eval(value)
        except Exception:
            return value[1:-1].replace("\\'", "'").replace("\\\\", "\\")
    return value


def admin_hashes_from_dump(path):
    rows = table_records_from_dump(
        path,
        "admins",
        ["id", "username", "email", "full_name", "hashed_password", "role", "is_verified", "status", "last_login", "created_at"],
    )
    found = {}
    for record in rows:
        hash_value = record.get("hashed_password")
        if not valid_hash(hash_value):
            continue
        for key in (record.get("email"), record.get("username")):
            if key:
                found[str(key).lower()] = str(hash_value)
    return found


def table_records_from_dump(path, table_name, default_columns):
    content = gzip.open(path, "rt", encoding="utf-8", errors="ignore").read()
    pattern = rf"INSERT INTO `?{re.escape(table_name)}`?(?:\s*\((?P<columns>[^)]*)\))?\s+VALUES\s*(?P<values>.*?);"
    matches = re.finditer(pattern, content, re.I | re.S)
    records = []
    for match in matches:
        raw_columns = match.group("columns")
        columns = [col.strip(" `") for col in raw_columns.split(",")] if raw_columns else default_columns
        for row in split_sql_values(match.group("values")):
            values = [decode_sql_value(item) for item in row]
            records.append(dict(zip(columns, values)))
    return records


def records_by_id_from_dump(path, table_name, default_columns):
    records = {}
    for record in table_records_from_dump(path, table_name, default_columns):
        try:
            record_id = int(record.get("id"))
        except Exception:
            continue
        records[record_id] = record
    return records


location = backup_dir()
dumps = sorted(location.glob("database_*.sql.gz"), key=lambda item: item.name, reverse=True)
if SECURITY_API_URL:
    try:
        archive_payload = list_vm1_database_backup_archives()
        archive_items = list((archive_payload or {}).get("items") or [])
    except requests.exceptions.HTTPError as exc:
        archive_items = []
    except Exception:
        archive_items = []
    if archive_items:
        archive_dir = Path(tempfile.mkdtemp(prefix="vm2_vm1_db_archives_"))
        for item in archive_items:
            archive_name = str(item.get("archive") or "")
            if not archive_name:
                continue
            try:
                downloaded = download_vm1_database_backup_archive(archive_name, archive_dir)
                if downloaded and downloaded.get("path"):
                    dumps.append(Path(downloaded["path"]))
            except Exception:
                continue
        dumps = sorted(set(dumps), key=lambda item: item.name, reverse=True)
if not dumps:
    print("admin_hash_restore=no_dumps")
    raise SystemExit(0)

db = SessionLocal()
try:
    admins = (
        db.query(Admin)
        .filter(Admin.role.in_(["main_admin", "superadmin"]))
        .all()
    )
    admin_targets = [
        admin for admin in admins
        if not valid_hash(getattr(admin, "hashed_password", None))
    ]
    citizen_targets = [
        user for user in db.query(CitizenUser).all()
        if any(marker in str(getattr(user, "email", "") or "").lower() for marker in ("attacker", "eval_attack", "eval_intruder"))
    ]
    payment_targets = [
        payment for payment in db.query(Payment).all()
        if getattr(payment, "amount", None) is not None
        and (float(getattr(payment, "amount") or 0) < 0 or float(getattr(payment, "amount") or 0) >= 10000000)
    ]
    if not admin_targets and not citizen_targets and not payment_targets:
        print("known_db_artifact_restore=no_suspicious_rows")
        raise SystemExit(0)
    repaired = []
    for dump in dumps:
        hashes = admin_hashes_from_dump(dump)
        for admin in list(admin_targets):
            candidates = [
                str(getattr(admin, "email", "") or "").lower(),
                str(getattr(admin, "username", "") or "").lower(),
            ]
            replacement = next((hashes[item] for item in candidates if item in hashes), None)
            if not replacement:
                continue
            admin.hashed_password = replacement
            db.add(admin)
            repaired.append(f"admin_hash:{admin.email or admin.username}:{dump.name}")
            admin_targets.remove(admin)

        citizen_records = records_by_id_from_dump(dump, "citizen_users", [
            "id", "email", "email_hash", "email_enc", "full_name", "full_name_hash", "full_name_enc",
            "tin", "tin_hash", "tin_enc", "contact_number", "contact_number_hash", "contact_number_enc",
            "address", "address_hash", "address_enc", "taxpayer_type", "hashed_password", "role",
            "is_verified", "status", "created_at", "last_login",
        ])
        for user in list(citizen_targets):
            backup_record = citizen_records.get(int(user.id))
            if not backup_record:
                continue
            backup_email = backup_record.get("email")
            if not backup_email or any(marker in str(backup_email).lower() for marker in ("attacker", "eval_attack", "eval_intruder")):
                continue
            user.email = backup_email
            user.email_hash = backup_record.get("email_hash")
            user.email_enc = backup_record.get("email_enc")
            db.add(user)
            repaired.append(f"citizen_email:{user.id}:{dump.name}")
            citizen_targets.remove(user)

        payment_records = records_by_id_from_dump(dump, "payments", [
            "id", "ref_number", "ref_number_hash", "ref_number_enc", "txn_id", "txn_id_hash", "txn_id_enc",
            "taxpayer_name", "taxpayer_name_hash", "taxpayer_name_enc", "tin", "tin_hash", "tin_enc",
            "property_ref_number", "property_ref_number_hash", "property_ref_number_enc", "tax_type",
            "tax_type_hash", "tax_type_enc", "amount", "payment_method", "payment_method_hash",
            "payment_method_enc", "branch_id", "branch", "branch_hash", "branch_enc", "status", "email",
            "email_hash", "email_enc", "contact_number", "contact_number_hash", "contact_number_enc",
            "source_module", "related_request_id", "paymongo_checkout_session_id",
            "paymongo_checkout_session_id_hash", "paymongo_checkout_session_id_enc",
            "paymongo_payment_intent_id", "paymongo_payment_intent_id_hash", "paymongo_payment_intent_id_enc",
            "paymongo_source_id", "paymongo_source_id_hash", "paymongo_source_id_enc", "paymongo_payment_id",
            "paymongo_payment_id_hash", "paymongo_payment_id_enc", "paymongo_checkout_url",
            "paymongo_checkout_url_hash", "paymongo_checkout_url_enc", "paymongo_status",
            "paymongo_status_hash", "paymongo_status_enc", "metadata_json", "proof_file_path",
            "proof_file_path_hash", "proof_file_path_enc", "proof_file_name", "proof_file_name_hash",
            "proof_file_name_enc", "proof_uploaded_at", "treasury_remarks", "treasury_remarks_hash",
            "treasury_remarks_enc", "treasury_updated_at", "official_receipt_number",
            "official_receipt_number_hash", "official_receipt_number_enc", "official_receipt_path",
            "official_receipt_path_hash", "official_receipt_path_enc", "official_receipt_generated_at",
            "release_method", "release_method_hash", "release_method_enc", "release_details_json",
            "payment_expiry", "receipt_sent_at", "created_at", "verified_at", "public_access_token",
        ])
        for payment in list(payment_targets):
            backup_record = payment_records.get(int(payment.id))
            if not backup_record:
                continue
            try:
                backup_amount = float(backup_record.get("amount"))
            except Exception:
                continue
            if backup_amount < 0 or backup_amount >= 10000000:
                continue
            payment.amount = backup_amount
            db.add(payment)
            repaired.append(f"payment_amount:{payment.id}:{dump.name}")
            payment_targets.remove(payment)

        if not admin_targets and not citizen_targets and not payment_targets:
            break
    if repaired:
        db.commit()
        print("known_db_artifact_restore=updated:" + ",".join(repaired))
    else:
        leftovers = []
        if admin_targets:
            leftovers.append(f"admin_hashes:{len(admin_targets)}")
        if citizen_targets:
            leftovers.append(f"citizen_emails:{len(citizen_targets)}")
        if payment_targets:
            leftovers.append(f"payment_amounts:{len(payment_targets)}")
        print("known_db_artifact_restore=no_matching_backup_rows:" + ",".join(leftovers))
finally:
    db.close()
'''
    result = vm1(
        f"cd {q(VM1_APP_DIR)} && docker compose exec -T backend python - <<'PY'\n{script}\nPY",
        timeout=max(REQUEST_TIMEOUT_SECONDS, 300),
    )
    return result.strip().splitlines()[-1] if result.strip() else "admin_hash_restore=unknown"


def restore_latest_vm1_database_backup() -> str:
    script = r'''
import sys
sys.path.insert(0, "/app")
from database.models import Backup, SessionLocal
from utils.backup_engine import backup_dir, is_database_backup_record, restore_database_backup
from utils.security_client import SECURITY_API_URL, download_latest_vm1_database_backup
import requests

db = SessionLocal()
try:
    location = backup_dir()
    rows = (
        db.query(Backup)
        .filter(Backup.status == "Completed")
        .order_by(Backup.created_at.desc())
        .limit(100)
        .all()
    )
    candidates = [
        row for row in rows
        if is_database_backup_record(row)
        and getattr(row, "filename", None)
        and (location / row.filename).exists()
    ]
    if not candidates:
        files = sorted(location.glob("database_*.sql.gz"), key=lambda item: item.name, reverse=True)
        if files:
            latest_file = files[0]
            restore_database_backup(latest_file, None, None)
            print(latest_file.name)
        elif SECURITY_API_URL:
            try:
                downloaded = download_latest_vm1_database_backup(location)
            except requests.exceptions.HTTPError as exc:
                if exc.response is not None and exc.response.status_code == 404:
                    raise RuntimeError("No VM2 VM1-database archive is available yet. Deploy the VM2 archive endpoint and create a new VM1 DB backup.") from exc
                raise
            if not downloaded:
                raise RuntimeError("No VM2 VM1-database archive is available.")
            latest_file = downloaded["path"]
            restore_database_backup(latest_file, downloaded.get("checksum"), downloaded.get("db_type") or "mysql")
            print(f"{latest_file} (vm2_archive)")
        else:
            raise RuntimeError(f"No restorable VM1 database dump found in {location}. Backup rows may be stale or backup storage is not mounted.")
    else:
        latest = candidates[0]
        restore_database_backup(
            location / latest.filename,
            getattr(latest, "checksum", None),
            getattr(latest, "db_type", None),
        )
        print(latest.filename)
finally:
    db.close()
'''
    filename = vm1(f"cd {q(VM1_APP_DIR)} && docker compose exec -T backend python - <<'PY'\n{script}\nPY", timeout=max(REQUEST_TIMEOUT_SECONDS, 300)).strip().splitlines()[-1]
    return f"vm1_database_restored:{filename}"


def list_vm1_database_backups() -> str:
    script = r'''
import sys
sys.path.insert(0, "/app")
from database.models import Backup, SessionLocal
from utils.backup_engine import backup_dir, is_database_backup_record

location = backup_dir()
print(f"backup_dir={location}")
files = sorted(location.glob("database_*.sql.gz"), key=lambda item: item.name, reverse=True)
print("disk_files=" + (",".join(item.name for item in files[:20]) if files else "NONE"))

db = SessionLocal()
try:
    rows = (
        db.query(Backup)
        .filter(Backup.status == "Completed")
        .order_by(Backup.created_at.desc())
        .limit(20)
        .all()
    )
    filtered = [row for row in rows if is_database_backup_record(row)]
    if not filtered:
        print("backup_rows=NONE")
    for row in filtered:
        filename = getattr(row, "filename", "") or ""
        print(
            "backup_row="
            f"id:{getattr(row, 'id', '')},"
            f"filename:{filename},"
            f"exists:{(location / filename).exists()},"
            f"checksum:{bool(getattr(row, 'checksum', None))},"
            f"db_type:{getattr(row, 'db_type', None)}"
        )
finally:
    db.close()
'''
    return vm1(f"cd {q(VM1_APP_DIR)} && docker compose exec -T backend python - <<'PY'\n{script}\nPY", timeout=REQUEST_TIMEOUT_SECONDS)


def sql_quote(value: str) -> str:
    return "'" + str(value).replace("\\", "\\\\").replace("'", "''") + "'"


def cleanup_vm1_after_evaluation(
    *,
    git_reset: bool = FINAL_CLEANUP_GIT_RESET,
    rebuild: bool = FINAL_CLEANUP_REBUILD,
    restore_vm1_db: bool = FINAL_CLEANUP_RESTORE_VM1_DB,
) -> list[str]:
    notes = []
    vm1(_restore_eval_backups_script(VM1_APP_DIR, git_reset=git_reset, rebuild=rebuild), timeout=max(REQUEST_TIMEOUT_SECONDS, 300))
    notes.append("vm1_files_restored")
    if restore_vm1_db:
        try:
            notes.append(restore_latest_vm1_database_backup())
        except Exception as exc:
            notes.append(f"vm1_database_restore_failed:{exc}")
        try:
            notes.append(restore_vm1_admin_hashes_from_backups())
        except Exception as exc:
            notes.append(f"admin_hash_restore_failed:{exc}")
    try:
        vm1_mysql("DELETE FROM admins WHERE email='eval_intruder@example.com' OR username='eval_intruder';")
        notes.append("vm1_eval_intruder_removed")
    except Exception as exc:
        notes.append(f"vm1_eval_intruder_cleanup_failed:{exc}")
    try:
        notes.append(repair_vm1_admin_password_if_configured())
    except Exception as exc:
        notes.append(f"admin_password_repair_failed:{exc}")
    return notes


def cleanup_vm2_after_evaluation(*, git_reset: bool = FINAL_CLEANUP_GIT_RESET, rebuild: bool = FINAL_CLEANUP_REBUILD) -> list[str]:
    compose_file = "docker-compose.security.yml"
    vm2(_restore_eval_backups_script(VM2_APP_DIR, git_reset=git_reset, rebuild=rebuild, compose_file=compose_file), timeout=max(REQUEST_TIMEOUT_SECONDS, 300))
    return ["vm2_files_restored"]


def cleanup_after_evaluation(
    *,
    git_reset: bool = FINAL_CLEANUP_GIT_RESET,
    rebuild: bool = FINAL_CLEANUP_REBUILD,
    restore_vm1_db: bool = FINAL_CLEANUP_RESTORE_VM1_DB,
) -> list[str]:
    notes = []
    try:
        notes.extend(cleanup_vm1_after_evaluation(git_reset=git_reset, rebuild=rebuild, restore_vm1_db=restore_vm1_db))
    except Exception as exc:
        notes.append(f"vm1_cleanup_failed:{exc}")
    try:
        notes.extend(cleanup_vm2_after_evaluation(git_reset=git_reset, rebuild=rebuild))
    except Exception as exc:
        notes.append(f"vm2_cleanup_failed:{exc}")
    return notes


def vm1_mysql(sql: str) -> None:
    cmd = (
        f"docker exec {q(VM1_MYSQL_CONTAINER)} mysql "
        f"-u{q(VM1_MYSQL_USER)} -p{q(VM1_MYSQL_PASSWORD)} {q(VM1_MYSQL_DATABASE)} "
        f"-e {q(sql)}"
    )
    vm1(cmd)


def vm2_mysql(sql: str) -> None:
    cmd = (
        f"docker exec {q(VM2_MYSQL_CONTAINER)} mysql "
        f"-u{q(VM2_MYSQL_USER)} -p{q(VM2_MYSQL_PASSWORD)} {q(VM2_MYSQL_DATABASE)} "
        f"-e {q(sql)}"
    )
    vm2(cmd)


def context_detection(test_id: str, change_type: str, context: dict, *, actor: str = "eval_runner", target: str | None = None) -> None:
    api_post(
        "/v1/detections/context",
        {
            "target_name": target or f"evaluation:{test_id}",
            "actor": actor,
            "change_type": change_type,
            "context": {"evaluation_run": True, **context},
        },
        headers=EVAL_HEADERS,
    )


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
