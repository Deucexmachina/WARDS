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
    REQUEST_TIMEOUT_SECONDS,
    RESULTS_CSV,
    SCAN_BACKOFF_SECONDS,
    SCAN_WAIT_SECONDS,
    VERIFY_TLS,
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
    start_iso = (datetime.now(timezone.utc) - timedelta(seconds=DETECTION_LOOKBACK_SECONDS)).isoformat()
    started = time.time()
    predicted = "benign"
    detection = None
    error = ""
    try:
        case.action()
        if case.trigger_scan:
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
        "notes": "; ".join(part for part in [case.notes, error] if part),
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
