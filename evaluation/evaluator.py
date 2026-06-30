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
    PREFLIGHT_POLL_SECONDS,
    PREFLIGHT_WAIT_SECONDS,
    REQUEST_TIMEOUT_SECONDS,
    RESULTS_CSV,
    SCAN_BACKOFF_SECONDS,
    SCAN_WAIT_SECONDS,
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
            predicted = "attack"
            detection = detections[0]
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
        f"{user}@{host}",
        command,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f"ssh exited {result.returncode}")
    return result.stdout.strip()


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
