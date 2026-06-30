# WARDS Confusion Matrix — Evaluation Design & Implementation Guide

> This document defines the complete methodology, test dataset, and implementation instructions for generating a confusion matrix that evaluates WARDS' AI/ML detection pipeline. A separate model or developer should implement the scripts described here based on this specification. All code blocks are reference implementations, not files to be placed anywhere specific — the implementing model decides the final file layout.

---

## 1. What We Are Evaluating

WARDS uses a **hybrid detection pipeline**:

1. **Rule-based content flags** — suspicious patterns, injection signatures, defacement keywords
2. **Behavioral profile risk** — after-hours activity, unknown source IP, unusual file extension, weekend access
3. **Isolation Forest ML anomaly score** — trained on historical admin file-change and detection event data
4. **Confidence fusion** — combines all three into a final score (0.0–1.0) and prediction label: `normal`, `suspicious`, or `malicious`

The confusion matrix evaluates **the complete end-to-end system decision**, not any individual component. The question for each test is:

> "When a security-relevant event occurs, does WARDS create a detection incident or not?"

| | **WARDS Creates Incident** | **WARDS Silent** |
|---|---|---|
| **Actual Attack** | True Positive (TP) | False Negative (FN) |
| **Actual Benign** | False Positive (FP) | True Negative (TN) |

---

## 2. Evaluation Strategy

### 2.1 Ground Truth Source

The evaluator itself performs every test action and **knows in advance** whether that action is an attack or benign. Ground truth is never derived after the fact — it is defined before execution. This eliminates the ambiguity that comes from labelling passive traffic.

### 2.2 WARDS Prediction Source

WARDS' prediction for a given action is determined by querying the VM2 Security API after each test:

```
POST https://api-vm2.nanowards.com/v1/detections/query
X-API-Key: <APP_API_KEY>
Content-Type: application/json

{
  "sort": "newest",
  "limit": 5,
  "date_from": "<ISO timestamp just before the test action>"
}
```

- If one or more `SecurityDetectionEvent` rows are returned with a `detected_at` timestamp after the test started → **WARDS predicted: Malicious**
- If no new detection rows exist within the wait window → **WARDS predicted: Benign**

### 2.3 Wait Window

The security monitor scan interval is `SECURITY_SCAN_INTERVAL_SECONDS=30` (set in both VM `.env` files). The evaluator must wait **at least 35 seconds** after performing a test action before querying for new incidents, to give the monitor one full cycle. Use 45 seconds as a safe default.

For tests that trigger an **on-demand scan** via `POST /v1/scan/all`, no wait is needed — query immediately after the scan API call returns.

### 2.4 Cleanup Between Tests

After each **attack test**, the evaluator should resolve the incident to restore WARDS to a clean state before running the next test. Otherwise, a file that is still flagged as `defaced` may interfere with subsequent detections.

Resolve an incident via:

```
POST https://api-vm2.nanowards.com/v1/incidents/<incident_id>/resolve
X-API-Key: <APP_API_KEY>
X-Admin-Secret: <SECURITY_ADMIN_SECRET>
Content-Type: application/json

{"admin_id": null}
```

The `incident_id` is available in the detection query response under `incident_id`.

---

## 3. Test Dataset

The dataset is split by **recovery domain** so every protected component is evaluated. Total: **80 tests** (40 attack, 40 benign).

### 3.1 Domain Coverage

| Domain | Attack Tests | Benign Tests | Total |
|---|---|---|---|
| Application Files (VM1 WARDS/) | 15 | 15 | 30 |
| VM1 Database | 5 | 5 | 10 |
| VM2 Database | 5 | 5 | 10 |
| AI/ML Assets | 10 | 5 | 15 |
| Context/Behavioral | 5 | 10 | 15 |
| **Total** | **40** | **40** | **80** |

### 3.2 Attack Test Cases

#### A. Application Files — Priority File Defacement (auto-recovery triggered)

These files have extensions `.html`, `.htm`, `.js`, `.jsx`, `.ts`, `.tsx`, `.py`. WARDS will quarantine and auto-recover them.

| ID | Scenario | File to Modify | Attack Action |
|---|---|---|---|
| ATK-F-01 | HTML defacement | `WARDS/frontend/index.html` | Replace entire file content with `<h1>HACKED BY EVALUATOR</h1>` |
| ATK-F-02 | HTML script injection | `WARDS/frontend/index.html` | Append `<script>alert('xss')</script>` |
| ATK-F-03 | JS payload injection | `WARDS/frontend/src/main.jsx` | Append `document.write('<img src=x onerror=alert(1)>');` |
| ATK-F-04 | Python backend modification | `WARDS/backend/main.py` | Append `# INJECTED: import os; os.system("id")` (comment-embedded payload) |
| ATK-F-05 | Python route tampering | `WARDS/backend/routes/unified_auth.py` | Append `# eval("pass")  # TAMPERED` |
| ATK-F-06 | TypeScript component injection | `WARDS/frontend/src/App.tsx` (or any `.tsx`) | Append `// HACKED` then append `eval("1")` on next line |
| ATK-F-07 | CSS defacement | `WARDS/frontend/src/index.css` | Replace body color with `body { display: none; }` |

#### B. Application Files — Non-Priority File Defacement (quarantine only, no auto-recovery)

These files have extensions `.md`, `.txt`, `.json`, `.yml`. WARDS quarantines but does not auto-recover.

| ID | Scenario | File to Modify | Attack Action |
|---|---|---|---|
| ATK-F-08 | Config tampering | `WARDS/backend/.env.example` | Insert fake `SECRET_KEY=attacker_controlled` line |
| ATK-F-09 | Defacement keyword in markdown | `WARDS/backend/README.md` | Insert the word `hacked` into content |
| ATK-F-10 | YAML pipeline poisoning | `.github/workflows/wards-ci.yml` (if monitored) | Append `# DEFACED` comment with injection keyword |
| ATK-F-11 | SQL keyword injection in CSV | `SECURITY/ml/initial_training_samples.csv` | Append row containing `DROP TABLE` string |
| ATK-F-12 | Credential exposure in text | Any `.txt` file in WARDS/ | Insert `password=attacker123` |

#### C. Application Files — Deletion / Missing File

| ID | Scenario | Attack Action |
|---|---|---|
| ATK-F-13 | Critical file deletion | Delete `WARDS/backend/main.py` temporarily (restore after incident recorded) |
| ATK-F-14 | Frontend entry deletion | Delete `WARDS/frontend/index.html` temporarily |
| ATK-F-15 | Config deletion | Delete `WARDS/backend/.env.example` temporarily |

#### D. VM1 Database Attacks

These simulate unauthorized SQL changes to the production database on VM1. The WARDS database monitor detects checksum/snapshot deviations.

| ID | Scenario | Attack Action |
|---|---|---|
| ATK-DB1-01 | Patient record tampering | `UPDATE citizen_users SET email='hacked@evil.com' WHERE id=1` |
| ATK-DB1-02 | Admin account tampering | `UPDATE admins SET password_hash='TAMPERED' WHERE id=1` |
| ATK-DB1-03 | Tax record falsification | `UPDATE tax_records SET amount=0 WHERE id=1` (if table exists) |
| ATK-DB1-04 | Unauthorized row insertion | `INSERT INTO admins (email, role) VALUES ('attacker@evil.com', 'superadmin')` |
| ATK-DB1-05 | Mass deletion | `DELETE FROM activity_logs WHERE id > 0 LIMIT 50` |

> **Note**: VM1 database monitoring uses `wards_security_db_audit_log` and audit triggers on VM1's MySQL. These attacks must be executed directly against the VM1 MySQL container. VM2 detects deviations when it polls the VM1 database snapshot. To execute: `docker exec -i <mysql_container> mysql -u root -p<password> wards_db -e "<SQL>"` on VM1.

#### E. VM2 Database Attacks

| ID | Scenario | Attack Action |
|---|---|---|
| ATK-DB2-01 | Security incident table wipe | `DELETE FROM security_incidents WHERE id > 0 LIMIT 20` |
| ATK-DB2-02 | Detection event falsification | `UPDATE security_detection_events SET ai_prediction='normal' WHERE id=1` |
| ATK-DB2-03 | Monitored file hash tampering | `UPDATE security_monitored_files SET baseline_hash='000000' WHERE id=1` |
| ATK-DB2-04 | Recovery event deletion | `DELETE FROM security_recovery_events WHERE id > 0 LIMIT 10` |
| ATK-DB2-05 | Admin account takeover | `UPDATE admins SET password_hash='TAMPERED' WHERE id=1` (on VM2's admins table) |

> **Note**: These attacks must be executed against the `security-db` container on VM2.

#### F. AI/ML Asset Attacks

| ID | Scenario | File to Modify | Attack Action |
|---|---|---|---|
| ATK-AI-01 | Model file replacement | `SECURITY/ml_models/isolation_forest.pkl` | Replace with random bytes or zero-byte file |
| ATK-AI-02 | Model metadata tampering | `SECURITY/ml_models/model_metadata.json` | Insert `"poisoned": true` and change version |
| ATK-AI-03 | State JSON tampering | `SECURITY/ml/isolation_forest_state.json` | Overwrite with empty JSON `{}` |
| ATK-AI-04 | Isolation Forest metadata tampering | `SECURITY/ml/isolation_forest_metadata.json` | Corrupt JSON structure |
| ATK-AI-05 | Behavioral profile reset | `SECURITY/ml/isolation_forest_state.json` | Remove `"profile"` key from JSON |
| ATK-AI-06 | Training data poisoning | `SECURITY/ml/initial_training_samples.csv` | Append 50 rows of `0,0,0,...` (zero features) |
| ATK-AI-07 | Model deletion | `SECURITY/ml_models/isolation_forest.pkl` | Delete the file entirely |
| ATK-AI-08 | Threshold manipulation | Any threshold/metadata JSON | Change numeric threshold values to 0 or 999 |
| ATK-AI-09 | Config state poisoning | `SECURITY/ml/isolation_forest_state.json` | Inject `"sensitivity": "off"` |
| ATK-AI-10 | Dual artifact tampering | Both `.pkl` and `model_metadata.json` | Modify both simultaneously |

#### G. Context/Behavioral Attacks (Anomalous Access Pattern)

These use the `POST /v1/detections/context` endpoint to inject detection events with anomalous behavioral context. They test the behavioral scoring rules.

| ID | Scenario | Payload to Send |
|---|---|---|
| ATK-CTX-01 | After-hours critical access | `change_type: "unauthorized_access"`, context: `hour_of_day: 3, admin_session_valid: 0` |
| ATK-CTX-02 | Unknown source IP | context: `source_ip: "1.2.3.4"` (IP not in known admin list), `admin_session_valid: 0` |
| ATK-CTX-03 | VPN-masked admin login | context: `vpn_activity: 1, hour_of_day: 4` |
| ATK-CTX-04 | Mass file modification | context: `affected_files_count: 50, hour_of_day: 2` |
| ATK-CTX-05 | AI model modification flag | `target_name: "isolation_forest.pkl"`, `change_type: "modification"`, context: `hour_of_day: 3` |

---

### 3.3 Benign Test Cases

#### H. Normal File Operations

| ID | Scenario | Action |
|---|---|---|
| BEN-F-01 | README update | Append timestamp to `WARDS/backend/README.md` |
| BEN-F-02 | Notes file edit | Create/edit `WARDS/notes.txt` with plain text |
| BEN-F-03 | Log file append | Append a log line to any `.log` file in WARDS/ |
| BEN-F-04 | Temporary cache creation | Create `WARDS/tmp_eval_cache.txt` then delete immediately |
| BEN-F-05 | .gitignore update | Append `*.eval_tmp` to `.gitignore` |
| BEN-F-06 | Changelog entry | Append a line to `DOCUMENTATION/CHANGES.md` |
| BEN-F-07 | Non-sensitive JSON edit | Add a comment field to any non-critical `.json` config |
| BEN-F-08 | YAML minor edit | Add a comment line to a non-critical `.yml` file |
| BEN-F-09 | Documentation update | Add a line to any `.md` file that does not contain defacement keywords |
| BEN-F-10 | Normal admin CSV edit | Append a neutral row to `SECURITY/ml/initial_training_samples.csv` |

#### I. Normal Administrative Operations

| ID | Scenario | Action |
|---|---|---|
| BEN-ADM-01 | Manual full backup | `POST https://api-vm2.nanowards.com/v1/backup/full` |
| BEN-ADM-02 | Files-only backup | `POST https://api-vm2.nanowards.com/v1/backup/files` |
| BEN-ADM-03 | ML artifact backup | `POST https://api-vm2.nanowards.com/v1/backup/ml` |
| BEN-ADM-04 | Database backup | `POST https://api-vm2.nanowards.com/v1/backup/database` |
| BEN-ADM-05 | Dashboard health check | `GET https://api-vm2.nanowards.com/v1/dashboard` |

#### J. Normal Database Operations (VM1)

| ID | Scenario | Action |
|---|---|---|
| BEN-DB-01 | Routine SELECT query | `SELECT COUNT(*) FROM citizen_users` (read-only, no changes) |
| BEN-DB-02 | Authorized status update | Update a non-critical row using the authorized operations table mechanism |
| BEN-DB-03 | Log cleanup | Truncate old `activity_logs` rows (this table is in `DATABASE_EXCLUDED_TABLES`) |
| BEN-DB-04 | Index rebuild | `ANALYZE TABLE citizen_users` (no data change) |
| BEN-DB-05 | Normal backup read | Read a DB snapshot file without modifying it |

#### K. Normal AI/ML Operations

| ID | Scenario | Action |
|---|---|---|
| BEN-AI-01 | Model retrain (admin-authorized) | `POST https://api-vm2.nanowards.com/v1/ai/retrain` with valid API key |
| BEN-AI-02 | Seed initial training | `POST https://api-vm2.nanowards.com/v1/ai/seed-initial-training` |
| BEN-AI-03 | ML score probe (benign features) | `POST /v1/ai/ml-score` with `hour_of_day: 10, day_of_week: 2, admin_session_valid: 1` |
| BEN-AI-04 | Read model metadata | `GET` or read `SECURITY/ml_models/model_metadata.json` (no modification) |
| BEN-AI-05 | AI rule listing | `GET https://api-vm2.nanowards.com/v1/ai/rules` |

#### L. Normal Context Events (Benign Behavioral Profile)

| ID | Scenario | Payload to Send |
|---|---|---|
| BEN-CTX-01 | Admin login during business hours | `POST /v1/detections/context`, context: `hour_of_day: 10, day_of_week: 2, admin_session_valid: 1` |
| BEN-CTX-02 | Scheduled deployment | `POST /v1/detections/context`, `change_type: "scheduled_deployment"`, context: `hour_of_day: 14` |
| BEN-CTX-03 | Normal GitHub webhook deploy | Same as BEN-CTX-02 with `actor: "github_webhook"` |
| BEN-CTX-04 | Authorized receipt upload | context: `admin_session_valid: 1, source_ip: "152.42.249.84"` |
| BEN-CTX-05 | Normal database backup event | `change_type: "backup_created"`, context: `hour_of_day: 10` |
| BEN-CTX-06 | Authorized admin file-change | Use `POST /v1/incidents/admin-change` to register authorized edit |
| BEN-CTX-07 | Normal queue operation | `change_type: "queue_ticket_issued"`, context: `admin_session_valid: 1` |
| BEN-CTX-08 | Normal payment event | `change_type: "payment_completed"`, context: `admin_session_valid: 1` |
| BEN-CTX-09 | Recovery verified | `change_type: "recovery_verified"`, context: `admin_session_valid: 1` |
| BEN-CTX-10 | Scheduled scan (auto-cycle) | Wait for one natural monitor cycle with no changes and check no incident created |

---

## 4. Script File Structure

The implementing model should create the following files. **Place them in a new top-level directory called `evaluation/`** in the repository root:

```
evaluation/
├── run_evaluation.py          ← main runner (entry point)
├── evaluator.py               ← core: wait, query incidents, record results
├── metrics.py                 ← compute confusion matrix + metrics from CSV
├── attack_tests/
│   ├── __init__.py
│   ├── file_attacks.py        ← ATK-F-01 through ATK-F-15
│   ├── database_attacks.py    ← ATK-DB1-*, ATK-DB2-*
│   ├── ai_attacks.py          ← ATK-AI-*
│   └── context_attacks.py     ← ATK-CTX-*
├── benign_tests/
│   ├── __init__.py
│   ├── file_benign.py         ← BEN-F-*
│   ├── admin_benign.py        ← BEN-ADM-*
│   ├── database_benign.py     ← BEN-DB-*
│   ├── ai_benign.py           ← BEN-AI-*
│   └── context_benign.py      ← BEN-CTX-*
├── results/
│   └── evaluation_results.csv ← auto-generated output
└── eval_config.py             ← all config (URLs, API key, SSH details)
```

---

## 5. Configuration

`evaluation/eval_config.py` should contain all configurable values. **Do not hardcode credentials in any other file.**

```python
# evaluation/eval_config.py

# VM2 Security API
VM2_API_URL = "https://api-vm2.nanowards.com"
VM2_API_KEY = "3e5833e12a888a95601b31f69b4e9bb8612f0e17807020deeb4d24f43e3e68c1"
VM2_ADMIN_SECRET = "a9fa79fa240f4dcb537ff81a33fd91f51a34d1cb7bf4987603ecf1a631c4aa8d"

# VM1 App Server SSH
VM1_HOST = "152.42.249.84"
VM1_SSH_USER = "root"
VM1_SSH_KEY_PATH = "~/.ssh/id_rsa"   # update to your actual key path
VM1_APP_DIR = "/opt/wards/app"
VM1_MYSQL_PASSWORD = "sigmaBALLS_6769"
VM1_MYSQL_CONTAINER = "app-mysql-1"   # confirm with `docker ps` on VM1

# VM2 Security Server SSH
VM2_HOST = "146.190.97.87"
VM2_SSH_USER = "root"
VM2_SSH_KEY_PATH = "~/.ssh/id_rsa"
VM2_APP_DIR = "/opt/wards/security/app"
VM2_MYSQL_PASSWORD = "sigmaBALLS_6769"
VM2_MYSQL_CONTAINER = "app-security-db-1"  # confirm with `docker ps` on VM2

# Evaluation timing
SCAN_WAIT_SECONDS = 45      # wait after each action before querying incidents
CLEANUP_WAIT_SECONDS = 10   # wait after resolving an incident before next test

# Output
RESULTS_CSV = "evaluation/results/evaluation_results.csv"
```

---

## 6. Core Evaluator

`evaluation/evaluator.py` — handles incident querying, result recording, and cleanup.

```python
# evaluation/evaluator.py

import csv
import os
import time
from datetime import datetime, timezone
import requests

from eval_config import (
    VM2_API_URL,
    VM2_API_KEY,
    VM2_ADMIN_SECRET,
    SCAN_WAIT_SECONDS,
    CLEANUP_WAIT_SECONDS,
    RESULTS_CSV,
)

HEADERS = {
    "X-API-Key": VM2_API_KEY,
    "Content-Type": "application/json",
}

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def query_new_incidents(since_iso: str) -> list[dict]:
    """Query VM2 for detection events created after `since_iso`."""
    response = requests.post(
        f"{VM2_API_URL}/v1/detections/query",
        headers=HEADERS,
        json={"sort": "newest", "limit": 10, "date_from": since_iso},
        timeout=30,
        verify=True,
    )
    response.raise_for_status()
    return response.json()

def resolve_incident(incident_id: int):
    """Resolve a detection incident to restore clean state."""
    response = requests.post(
        f"{VM2_API_URL}/v1/incidents/{incident_id}/resolve",
        headers={**HEADERS, "X-Admin-Secret": VM2_ADMIN_SECRET},
        json={"admin_id": None},
        timeout=30,
        verify=True,
    )
    # Ignore errors silently — cleanup is best-effort
    return response.status_code == 200

def record_result(
    test_id: str,
    scenario: str,
    domain: str,
    actual: str,        # "attack" or "benign"
    predicted: str,     # "attack" or "benign"
    result: str,        # "TP", "FP", "TN", "FN"
    incident_id=None,
    ai_score=None,
    ai_prediction=None,
    notes: str = "",
):
    os.makedirs(os.path.dirname(RESULTS_CSV), exist_ok=True)
    file_exists = os.path.exists(RESULTS_CSV)
    with open(RESULTS_CSV, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if not file_exists:
            writer.writerow([
                "test_id", "scenario", "domain", "actual", "predicted",
                "result", "incident_id", "ai_score", "ai_prediction",
                "timestamp", "notes",
            ])
        writer.writerow([
            test_id, scenario, domain, actual, predicted,
            result, incident_id or "", ai_score or "", ai_prediction or "",
            now_iso(), notes,
        ])

def run_test(
    test_id: str,
    scenario: str,
    domain: str,
    actual: str,        # "attack" or "benign"
    action_fn,          # callable that performs the attack or benign action
    wait: bool = True,  # set False if using on-demand scan
    trigger_scan_fn=None,  # optional callable to trigger on-demand scan
):
    """
    Run a single evaluation test.

    1. Record the start timestamp.
    2. Call action_fn() to perform the test action.
    3. Wait for the monitor cycle (or call trigger_scan_fn).
    4. Query VM2 for new incidents.
    5. Determine predicted class.
    6. Record the result.
    7. Resolve any incidents (cleanup).
    """
    print(f"\n[{test_id}] {scenario}")
    start_time = now_iso()
    incident_id = None
    ai_score = None
    ai_pred = None

    try:
        action_fn()
    except Exception as exc:
        print(f"  ACTION FAILED: {exc}")
        record_result(test_id, scenario, domain, actual, "error", "ERROR", notes=str(exc))
        return

    if trigger_scan_fn:
        try:
            trigger_scan_fn()
        except Exception as exc:
            print(f"  SCAN TRIGGER FAILED: {exc}")

    if wait:
        print(f"  Waiting {SCAN_WAIT_SECONDS}s for monitor cycle...")
        time.sleep(SCAN_WAIT_SECONDS)

    try:
        incidents = query_new_incidents(start_time)
    except Exception as exc:
        print(f"  QUERY FAILED: {exc}")
        record_result(test_id, scenario, domain, actual, "error", "ERROR", notes=str(exc))
        return

    if incidents:
        predicted = "attack"
        # Take the most severe / newest incident
        newest = incidents[0]
        incident_id = newest.get("incident_id") or newest.get("id")
        ai_score = newest.get("ai_score")
        ai_pred = newest.get("ai_prediction")
    else:
        predicted = "benign"

    if actual == "attack" and predicted == "attack":
        result = "TP"
    elif actual == "attack" and predicted == "benign":
        result = "FN"
    elif actual == "benign" and predicted == "attack":
        result = "FP"
    else:
        result = "TN"

    print(f"  Actual={actual}, Predicted={predicted} → {result}")
    if ai_score is not None:
        print(f"  AI score={ai_score}, AI prediction={ai_pred}")

    record_result(
        test_id, scenario, domain, actual, predicted, result,
        incident_id=incident_id, ai_score=ai_score, ai_prediction=ai_pred,
    )

    # Cleanup: resolve incident to restore clean state before next test
    if incident_id and result in ("TP", "FP"):
        print(f"  Cleaning up incident {incident_id}...")
        resolve_incident(incident_id)
        time.sleep(CLEANUP_WAIT_SECONDS)

def trigger_scan_all():
    """Force VM2 to scan all monitored files immediately (bypasses wait)."""
    response = requests.post(
        f"{VM2_API_URL}/v1/scan/all",
        headers=HEADERS,
        json={},
        timeout=120,
        verify=True,
    )
    response.raise_for_status()
    return response.json()
```

---

## 7. SSH Helper

Many tests require executing commands on VM1 or VM2 via SSH. Create an SSH helper in `evaluation/evaluator.py` or a separate `evaluation/ssh_helper.py`:

```python
# evaluation/ssh_helper.py

import subprocess
from eval_config import (
    VM1_HOST, VM1_SSH_USER, VM1_SSH_KEY_PATH, VM1_APP_DIR,
    VM2_HOST, VM2_SSH_USER, VM2_SSH_KEY_PATH, VM2_APP_DIR,
    VM1_MYSQL_PASSWORD, VM1_MYSQL_CONTAINER,
    VM2_MYSQL_PASSWORD, VM2_MYSQL_CONTAINER,
)

def _ssh(host, user, key_path, command: str, raise_on_error=True) -> str:
    result = subprocess.run(
        ["ssh", "-i", key_path, "-o", "StrictHostKeyChecking=no",
         f"{user}@{host}", command],
        capture_output=True, text=True,
    )
    if raise_on_error and result.returncode != 0:
        raise RuntimeError(f"SSH error on {host}: {result.stderr}")
    return result.stdout.strip()

def vm1_exec(command: str, raise_on_error=True) -> str:
    return _ssh(VM1_HOST, VM1_SSH_USER, VM1_SSH_KEY_PATH, command, raise_on_error)

def vm2_exec(command: str, raise_on_error=True) -> str:
    return _ssh(VM2_HOST, VM2_SSH_USER, VM2_SSH_KEY_PATH, command, raise_on_error)

def vm1_write_file(relative_path: str, content: str):
    """Write content to a file in VM1_APP_DIR via SSH."""
    full_path = f"{VM1_APP_DIR}/{relative_path}"
    # Use printf to avoid quoting issues with heredoc
    escaped = content.replace("'", "'\\''")
    vm1_exec(f"printf '%s' '{escaped}' > {full_path}")

def vm1_append_file(relative_path: str, content: str):
    full_path = f"{VM1_APP_DIR}/{relative_path}"
    escaped = content.replace("'", "'\\''")
    vm1_exec(f"printf '%s' '{escaped}' >> {full_path}")

def vm1_read_file(relative_path: str) -> str:
    return vm1_exec(f"cat {VM1_APP_DIR}/{relative_path}")

def vm1_delete_file(relative_path: str):
    vm1_exec(f"rm -f {VM1_APP_DIR}/{relative_path}")

def vm1_mysql(sql: str) -> str:
    return vm1_exec(
        f'docker exec {VM1_MYSQL_CONTAINER} mysql -u root -p{VM1_MYSQL_PASSWORD} wards_db -e "{sql}"'
    )

def vm2_write_file(relative_path: str, content: str):
    full_path = f"{VM2_APP_DIR}/{relative_path}"
    escaped = content.replace("'", "'\\''")
    vm2_exec(f"printf '%s' '{escaped}' > {full_path}")

def vm2_append_file(relative_path: str, content: str):
    full_path = f"{VM2_APP_DIR}/{relative_path}"
    escaped = content.replace("'", "'\\''")
    vm2_exec(f"printf '%s' '{escaped}' >> {full_path}")

def vm2_read_file(relative_path: str) -> str:
    return vm2_exec(f"cat {VM2_APP_DIR}/{relative_path}")

def vm2_delete_file(relative_path: str):
    vm2_exec(f"rm -f {VM2_APP_DIR}/{relative_path}")

def vm2_mysql(sql: str) -> str:
    return vm2_exec(
        f'docker exec {VM2_MYSQL_CONTAINER} mysql -u root -p{VM2_MYSQL_PASSWORD} wards_db -e "{sql}"'
    )
```

---

## 8. Attack Test Implementations

### 8.1 File Attack Tests

`evaluation/attack_tests/file_attacks.py`:

```python
# evaluation/attack_tests/file_attacks.py

from ssh_helper import vm1_read_file, vm1_write_file, vm1_append_file, vm1_delete_file
import requests
from eval_config import VM2_API_URL, VM2_API_KEY

HEADERS = {"X-API-Key": VM2_API_KEY, "Content-Type": "application/json"}

# ---- Helpers ----------------------------------------------------------------

def _trigger_vm1_file_scan(relative_path: str):
    """Trigger an on-demand scan of a specific VM1 file via the VM2 API."""
    response = requests.post(
        f"{VM2_API_URL}/v1/scan/file",
        headers=HEADERS,
        json={"relative_path": relative_path, "context": {}},
        timeout=30,
    )
    # 404 means the file is not yet registered — fall back to scan-all
    if response.status_code == 404:
        requests.post(f"{VM2_API_URL}/v1/scan/all", headers=HEADERS, json={}, timeout=120)
    else:
        response.raise_for_status()

# ---- ATK-F-01: HTML defacement ----------------------------------------------

_original_index_html: str = ""

def setup_atk_f01():
    global _original_index_html
    _original_index_html = vm1_read_file("WARDS/frontend/index.html")

def action_atk_f01():
    vm1_write_file("WARDS/frontend/index.html", "<h1>HACKED BY EVALUATOR</h1>\n")

def teardown_atk_f01():
    if _original_index_html:
        vm1_write_file("WARDS/frontend/index.html", _original_index_html)

# ---- ATK-F-02: HTML script injection ----------------------------------------

def action_atk_f02():
    vm1_append_file("WARDS/frontend/index.html", "\n<script>alert('xss')</script>\n")

# ---- ATK-F-03: JS payload injection -----------------------------------------

def action_atk_f03():
    vm1_append_file(
        "WARDS/frontend/src/main.jsx",
        "\ndocument.write('<img src=x onerror=alert(1)>');\n"
    )

# ---- ATK-F-04: Python backend modification -----------------------------------

def action_atk_f04():
    vm1_append_file(
        "WARDS/backend/main.py",
        "\n# INJECTED: import os; os.system('id')\n"
    )

# ---- ATK-F-05: Python route tampering ----------------------------------------

def action_atk_f05():
    vm1_append_file(
        "WARDS/backend/routes/unified_auth.py",
        "\n# eval('pass')  # TAMPERED\n"
    )

# ---- ATK-F-06: TypeScript component injection --------------------------------

def action_atk_f06():
    vm1_append_file(
        "WARDS/frontend/src/App.tsx",
        "\n// HACKED\n// eval('1');\n"
    )

# ---- ATK-F-07: CSS defacement ------------------------------------------------

def action_atk_f07():
    vm1_append_file(
        "WARDS/frontend/src/index.css",
        "\nbody { display: none; } /* DEFACED */\n"
    )

# ---- ATK-F-08: Config tampering in .env.example -----------------------------

def action_atk_f08():
    vm1_append_file(
        "WARDS/backend/.env.example",
        "\nSECRET_KEY=attacker_controlled\n"
    )

# ---- ATK-F-09: Defacement keyword in README ---------------------------------

def action_atk_f09():
    vm1_append_file(
        "WARDS/backend/README.md",
        "\nhacked by evaluator test\n"
    )

# ---- ATK-F-11: SQL keyword injection in CSV ---------------------------------

def action_atk_f11():
    vm1_append_file(
        "SECURITY/ml/initial_training_samples.csv",
        "\nDROP TABLE,citizen_users,0,0,0,0,0,0,0,0,0,0\n"
    )

# ---- ATK-F-12: Credential exposure in text ----------------------------------

def action_atk_f12():
    vm1_append_file(
        "WARDS/backend/README.md",
        "\npassword=attacker123\ntoken=evil_token_here\n"
    )

# ---- ATK-F-13: Critical file deletion ---------------------------------------

_original_main_py: str = ""

def setup_atk_f13():
    global _original_main_py
    _original_main_py = vm1_read_file("WARDS/backend/main.py")

def action_atk_f13():
    vm1_delete_file("WARDS/backend/main.py")

def teardown_atk_f13():
    if _original_main_py:
        vm1_write_file("WARDS/backend/main.py", _original_main_py)

# ---- ATK-F-14: Frontend entry deletion ---------------------------------------

_original_index_html_f14: str = ""

def setup_atk_f14():
    global _original_index_html_f14
    _original_index_html_f14 = vm1_read_file("WARDS/frontend/index.html")

def action_atk_f14():
    vm1_delete_file("WARDS/frontend/index.html")

def teardown_atk_f14():
    if _original_index_html_f14:
        vm1_write_file("WARDS/frontend/index.html", _original_index_html_f14)

# ---- ATK-F-15: Config file deletion -----------------------------------------

_original_env_example: str = ""

def setup_atk_f15():
    global _original_env_example
    try:
        _original_env_example = vm1_read_file("WARDS/backend/.env.example")
    except Exception:
        _original_env_example = ""

def action_atk_f15():
    vm1_delete_file("WARDS/backend/.env.example")

def teardown_atk_f15():
    if _original_env_example:
        vm1_write_file("WARDS/backend/.env.example", _original_env_example)
```

### 8.2 Database Attack Tests

`evaluation/attack_tests/database_attacks.py`:

```python
# evaluation/attack_tests/database_attacks.py

from ssh_helper import vm1_mysql, vm2_mysql

# ---- VM1 database attacks ---------------------------------------------------

def action_atk_db1_01():
    vm1_mysql("UPDATE citizen_users SET email='hacked@evil.com' WHERE id=1")

def action_atk_db1_02():
    vm1_mysql("UPDATE admins SET password_hash='TAMPERED_HASH_FOR_EVAL' WHERE id=1")

def action_atk_db1_04():
    vm1_mysql(
        "INSERT INTO admins (email, branch_id, is_active, role, created_at) "
        "VALUES ('attacker@evil.com', 1, 1, 'superadmin', NOW())"
    )

def action_atk_db1_05():
    # activity_logs is in DATABASE_EXCLUDED_TABLES — delete from a monitored table instead
    vm1_mysql("DELETE FROM citizen_users WHERE email='hacked@evil.com' LIMIT 1")

# ---- VM2 database attacks ---------------------------------------------------

def action_atk_db2_01():
    vm2_mysql("DELETE FROM security_incidents WHERE id > 0 LIMIT 5")

def action_atk_db2_02():
    vm2_mysql("UPDATE security_detection_events SET ai_prediction='normal' WHERE id > 0 LIMIT 1")

def action_atk_db2_03():
    vm2_mysql("UPDATE security_monitored_files SET baseline_hash='0000000000000000' WHERE id=1")

def action_atk_db2_04():
    vm2_mysql("DELETE FROM security_recovery_events WHERE id > 0 LIMIT 3")

def action_atk_db2_05():
    vm2_mysql("UPDATE admins SET password_hash='TAMPERED_VM2_HASH' WHERE id=1")
```

> **Implementation note**: VM2 database monitoring works via the `wards_security_db_audit_log` audit triggers on VM1's `wards_db`. The VM2 database itself (`security_incidents`, `security_monitored_files`, etc.) is monitored differently — changes to security state tables may not trigger the same audit path. Verify what the `activate_database_runtime_monitoring()` function actually creates audit triggers for before running ATK-DB2 tests. If VM2 DB attacks do not trigger detection, document this as a known system scope boundary in the thesis.

### 8.3 AI/ML Attack Tests

`evaluation/attack_tests/ai_attacks.py`:

```python
# evaluation/attack_tests/ai_attacks.py

import json
from ssh_helper import vm2_read_file, vm2_write_file, vm2_delete_file
import requests
from eval_config import VM2_API_URL, VM2_API_KEY

HEADERS = {"X-API-Key": VM2_API_KEY, "Content-Type": "application/json"}

_original_model_metadata: str = ""
_original_state_json: str = ""
_original_if_metadata: str = ""

def setup_ai_originals():
    global _original_model_metadata, _original_state_json, _original_if_metadata
    try:
        _original_model_metadata = vm2_read_file("SECURITY/ml_models/model_metadata.json")
    except Exception:
        _original_model_metadata = "{}"
    try:
        _original_state_json = vm2_read_file("SECURITY/ml/isolation_forest_state.json")
    except Exception:
        _original_state_json = "{}"
    try:
        _original_if_metadata = vm2_read_file("SECURITY/ml/isolation_forest_metadata.json")
    except Exception:
        _original_if_metadata = "{}"

def action_atk_ai_01():
    # Replace model pkl with random bytes (written as empty to avoid binary SSH issues)
    vm2_write_file("SECURITY/ml_models/isolation_forest.pkl", "\x00\x00\x00CORRUPTED\x00")

def action_atk_ai_02():
    vm2_write_file(
        "SECURITY/ml_models/model_metadata.json",
        json.dumps({"poisoned": True, "version": "attacker_v0", "features": []})
    )

def action_atk_ai_03():
    vm2_write_file("SECURITY/ml/isolation_forest_state.json", "{}")

def action_atk_ai_04():
    vm2_write_file("SECURITY/ml/isolation_forest_metadata.json", "{CORRUPTED JSON")

def action_atk_ai_05():
    try:
        state = json.loads(_original_state_json or "{}")
    except Exception:
        state = {}
    state.pop("profile", None)
    vm2_write_file("SECURITY/ml/isolation_forest_state.json", json.dumps(state))

def action_atk_ai_07():
    vm2_delete_file("SECURITY/ml_models/isolation_forest.pkl")

def action_atk_ai_09():
    try:
        state = json.loads(_original_state_json or "{}")
    except Exception:
        state = {}
    state["sensitivity"] = "off"
    vm2_write_file("SECURITY/ml/isolation_forest_state.json", json.dumps(state))

def action_atk_ai_10():
    vm2_write_file("SECURITY/ml_models/model_metadata.json",
                   json.dumps({"poisoned": True}))
    vm2_write_file("SECURITY/ml_models/isolation_forest.pkl", "CORRUPTED_DUAL")

def teardown_ai_originals():
    if _original_model_metadata:
        vm2_write_file("SECURITY/ml_models/model_metadata.json", _original_model_metadata)
    if _original_state_json:
        vm2_write_file("SECURITY/ml/isolation_forest_state.json", _original_state_json)
    if _original_if_metadata:
        vm2_write_file("SECURITY/ml/isolation_forest_metadata.json", _original_if_metadata)
    # Retrain to restore model pkl
    try:
        requests.post(
            f"{VM2_API_URL}/v1/ai/retrain",
            headers=HEADERS,
            json={"actor": "eval_teardown"},
            timeout=60,
        )
    except Exception:
        pass
```

### 8.4 Context/Behavioral Attack Tests

`evaluation/attack_tests/context_attacks.py`:

```python
# evaluation/attack_tests/context_attacks.py

import requests
from eval_config import VM2_API_URL, VM2_API_KEY

HEADERS = {"X-API-Key": VM2_API_KEY, "Content-Type": "application/json"}

def _send_context_detection(target_name: str, actor: str, change_type: str, context: dict):
    response = requests.post(
        f"{VM2_API_URL}/v1/detections/context",
        headers=HEADERS,
        json={
            "target_name": target_name,
            "actor": actor,
            "change_type": change_type,
            "context": context,
        },
        timeout=30,
    )
    response.raise_for_status()
    return response.json()

def action_atk_ctx_01():
    _send_context_detection(
        target_name="admin_panel",
        actor="unknown_actor",
        change_type="unauthorized_access",
        context={"hour_of_day": 3, "day_of_week": 6, "admin_session_valid": 0, "vpn_activity": 1},
    )

def action_atk_ctx_02():
    _send_context_detection(
        target_name="admin_panel",
        actor="unknown",
        change_type="login_attempt",
        context={"source_ip": "1.2.3.4", "admin_session_valid": 0, "hour_of_day": 2},
    )

def action_atk_ctx_03():
    _send_context_detection(
        target_name="security_dashboard",
        actor="unknown",
        change_type="login_attempt",
        context={"vpn_activity": 1, "hour_of_day": 4, "admin_session_valid": 0},
    )

def action_atk_ctx_04():
    _send_context_detection(
        target_name="file_system",
        actor="unknown",
        change_type="mass_modification",
        context={"affected_files_count": 50, "hour_of_day": 2, "admin_session_valid": 0},
    )

def action_atk_ctx_05():
    _send_context_detection(
        target_name="isolation_forest.pkl",
        actor="unknown",
        change_type="modification",
        context={"hour_of_day": 3, "admin_session_valid": 0, "is_ai_model_file": 1},
    )
```

---

## 9. Benign Test Implementations

### 9.1 Benign File Operations

`evaluation/benign_tests/file_benign.py`:

```python
# evaluation/benign_tests/file_benign.py

from ssh_helper import vm1_append_file, vm1_exec, vm1_delete_file
from datetime import datetime

def action_ben_f01():
    vm1_append_file("WARDS/backend/README.md", f"\nEvaluation timestamp: {datetime.utcnow().isoformat()}\n")

def action_ben_f02():
    vm1_append_file("WARDS/notes.txt", f"\nEvaluation benign test: {datetime.utcnow().isoformat()}\n")

def action_ben_f03():
    vm1_append_file("WARDS/access.log", f"[EVAL] {datetime.utcnow().isoformat()} GET /health 200\n")

def action_ben_f04():
    vm1_append_file("WARDS/tmp_eval_cache.txt", "temporary\n")
    vm1_delete_file("WARDS/tmp_eval_cache.txt")

def action_ben_f05():
    vm1_append_file(".gitignore", "\n*.eval_tmp\n")

def action_ben_f06():
    vm1_append_file("DOCUMENTATION/CHANGES.md", f"\nEvaluation benign entry {datetime.utcnow().isoformat()}\n")
```

### 9.2 Benign Admin Operations

`evaluation/benign_tests/admin_benign.py`:

```python
# evaluation/benign_tests/admin_benign.py

import requests
from eval_config import VM2_API_URL, VM2_API_KEY

HEADERS = {"X-API-Key": VM2_API_KEY, "Content-Type": "application/json"}

def action_ben_adm_01():
    requests.post(f"{VM2_API_URL}/v1/backup/full", headers=HEADERS, timeout=120).raise_for_status()

def action_ben_adm_02():
    requests.post(f"{VM2_API_URL}/v1/backup/files", headers=HEADERS, timeout=120).raise_for_status()

def action_ben_adm_03():
    requests.post(f"{VM2_API_URL}/v1/backup/ml", headers=HEADERS, timeout=120).raise_for_status()

def action_ben_adm_04():
    requests.post(f"{VM2_API_URL}/v1/backup/database", headers=HEADERS, timeout=120).raise_for_status()

def action_ben_adm_05():
    requests.get(f"{VM2_API_URL}/v1/dashboard", headers=HEADERS, timeout=30).raise_for_status()
```

### 9.3 Benign AI Operations

`evaluation/benign_tests/ai_benign.py`:

```python
# evaluation/benign_tests/ai_benign.py

import requests
from eval_config import VM2_API_URL, VM2_API_KEY

HEADERS = {"X-API-Key": VM2_API_KEY, "Content-Type": "application/json"}

def action_ben_ai_01():
    requests.post(f"{VM2_API_URL}/v1/ai/retrain", headers=HEADERS,
                  json={"actor": "eval_benign"}, timeout=60).raise_for_status()

def action_ben_ai_02():
    requests.post(f"{VM2_API_URL}/v1/ai/seed-initial-training", headers=HEADERS,
                  json={"actor": "eval_benign"}, timeout=60).raise_for_status()

def action_ben_ai_03():
    requests.post(
        f"{VM2_API_URL}/v1/ai/ml-score",
        headers=HEADERS,
        json={"hour_of_day": 10, "day_of_week": 2, "admin_session_valid": 1},
        timeout=30,
    ).raise_for_status()

def action_ben_ai_05():
    requests.get(f"{VM2_API_URL}/v1/ai/rules", headers=HEADERS, timeout=30).raise_for_status()
```

### 9.4 Benign Context Events

`evaluation/benign_tests/context_benign.py`:

```python
# evaluation/benign_tests/context_benign.py

import requests
from eval_config import VM2_API_URL, VM2_API_KEY

HEADERS = {"X-API-Key": VM2_API_KEY, "Content-Type": "application/json"}

def _send(target_name, actor, change_type, context):
    requests.post(
        f"{VM2_API_URL}/v1/detections/context",
        headers=HEADERS,
        json={"target_name": target_name, "actor": actor,
              "change_type": change_type, "context": context},
        timeout=30,
    ).raise_for_status()

def action_ben_ctx_01():
    _send("admin_panel", "branch_admin_1", "login", {"hour_of_day": 10, "day_of_week": 2, "admin_session_valid": 1})

def action_ben_ctx_02():
    _send("deployment", "github_webhook", "scheduled_deployment", {"hour_of_day": 14, "admin_session_valid": 1})

def action_ben_ctx_03():
    _send("deployment", "github_webhook", "scheduled_deployment", {"hour_of_day": 11, "admin_session_valid": 1})

def action_ben_ctx_05():
    _send("backup_system", "scheduled_backup", "backup_created", {"hour_of_day": 10, "admin_session_valid": 1})
```

---

## 10. Main Test Runner

`evaluation/run_evaluation.py` — registers all tests and runs them sequentially.

```python
# evaluation/run_evaluation.py

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from evaluator import run_test, trigger_scan_all
from attack_tests.file_attacks import (
    setup_atk_f01, action_atk_f01, teardown_atk_f01,
    action_atk_f02, action_atk_f03, action_atk_f04, action_atk_f05,
    action_atk_f06, action_atk_f07, action_atk_f08, action_atk_f09,
    action_atk_f11, action_atk_f12,
    setup_atk_f13, action_atk_f13, teardown_atk_f13,
    setup_atk_f14, action_atk_f14, teardown_atk_f14,
    setup_atk_f15, action_atk_f15, teardown_atk_f15,
)
from attack_tests.database_attacks import (
    action_atk_db1_01, action_atk_db1_02, action_atk_db1_04, action_atk_db1_05,
    action_atk_db2_01, action_atk_db2_02, action_atk_db2_03, action_atk_db2_04, action_atk_db2_05,
)
from attack_tests.ai_attacks import (
    setup_ai_originals, teardown_ai_originals,
    action_atk_ai_01, action_atk_ai_02, action_atk_ai_03, action_atk_ai_04,
    action_atk_ai_05, action_atk_ai_07, action_atk_ai_09, action_atk_ai_10,
)
from attack_tests.context_attacks import (
    action_atk_ctx_01, action_atk_ctx_02, action_atk_ctx_03,
    action_atk_ctx_04, action_atk_ctx_05,
)
from benign_tests.file_benign import (
    action_ben_f01, action_ben_f02, action_ben_f03,
    action_ben_f04, action_ben_f05, action_ben_f06,
)
from benign_tests.admin_benign import (
    action_ben_adm_01, action_ben_adm_02, action_ben_adm_03,
    action_ben_adm_04, action_ben_adm_05,
)
from benign_tests.ai_benign import (
    action_ben_ai_01, action_ben_ai_02, action_ben_ai_03, action_ben_ai_05,
)
from benign_tests.context_benign import (
    action_ben_ctx_01, action_ben_ctx_02, action_ben_ctx_03,
    action_ben_ctx_05,
)

import metrics


def run_all():
    print("=" * 60)
    print("WARDS Confusion Matrix Evaluation")
    print("=" * 60)

    # --- Pre-run setup ---
    print("\n[SETUP] Reading AI artifact originals...")
    setup_ai_originals()
    setup_atk_f01()
    setup_atk_f13()
    setup_atk_f14()
    setup_atk_f15()

    # =====================================================================
    # ATTACK TESTS — Application Files
    # =====================================================================
    run_test("ATK-F-01", "HTML full defacement", "application_files", "attack",
             action_atk_f01, trigger_scan_fn=trigger_scan_all, wait=False)
    teardown_atk_f01()

    run_test("ATK-F-02", "HTML script injection", "application_files", "attack",
             action_atk_f02, trigger_scan_fn=trigger_scan_all, wait=False)

    run_test("ATK-F-03", "JS payload injection", "application_files", "attack",
             action_atk_f03, trigger_scan_fn=trigger_scan_all, wait=False)

    run_test("ATK-F-04", "Python backend modification", "application_files", "attack",
             action_atk_f04, trigger_scan_fn=trigger_scan_all, wait=False)

    run_test("ATK-F-05", "Python route tampering", "application_files", "attack",
             action_atk_f05, trigger_scan_fn=trigger_scan_all, wait=False)

    run_test("ATK-F-06", "TypeScript injection", "application_files", "attack",
             action_atk_f06, trigger_scan_fn=trigger_scan_all, wait=False)

    run_test("ATK-F-07", "CSS defacement", "application_files", "attack",
             action_atk_f07, trigger_scan_fn=trigger_scan_all, wait=False)

    run_test("ATK-F-08", "Config tampering .env.example", "application_files", "attack",
             action_atk_f08, trigger_scan_fn=trigger_scan_all, wait=False)

    run_test("ATK-F-09", "Defacement keyword in README", "application_files", "attack",
             action_atk_f09, trigger_scan_fn=trigger_scan_all, wait=False)

    run_test("ATK-F-11", "SQL keyword in CSV", "application_files", "attack",
             action_atk_f11, trigger_scan_fn=trigger_scan_all, wait=False)

    run_test("ATK-F-12", "Credential exposure in text", "application_files", "attack",
             action_atk_f12, trigger_scan_fn=trigger_scan_all, wait=False)

    run_test("ATK-F-13", "Critical file deletion (main.py)", "application_files", "attack",
             action_atk_f13, trigger_scan_fn=trigger_scan_all, wait=False)
    teardown_atk_f13()

    run_test("ATK-F-14", "Frontend entry deletion (index.html)", "application_files", "attack",
             action_atk_f14, trigger_scan_fn=trigger_scan_all, wait=False)
    teardown_atk_f14()

    run_test("ATK-F-15", "Config file deletion (.env.example)", "application_files", "attack",
             action_atk_f15, trigger_scan_fn=trigger_scan_all, wait=False)
    teardown_atk_f15()

    # =====================================================================
    # ATTACK TESTS — VM1 Database
    # =====================================================================
    # VM1 DB tests use natural monitor cycle (wait=True) since they go via audit triggers
    run_test("ATK-DB1-01", "citizen_users email tamper", "vm1_database", "attack",
             action_atk_db1_01, wait=True)

    run_test("ATK-DB1-02", "admins password_hash tamper", "vm1_database", "attack",
             action_atk_db1_02, wait=True)

    run_test("ATK-DB1-04", "Unauthorized admin insertion", "vm1_database", "attack",
             action_atk_db1_04, wait=True)

    run_test("ATK-DB1-05", "Unauthorized row deletion", "vm1_database", "attack",
             action_atk_db1_05, wait=True)

    # =====================================================================
    # ATTACK TESTS — VM2 Database
    # =====================================================================
    run_test("ATK-DB2-01", "security_incidents mass delete", "vm2_database", "attack",
             action_atk_db2_01, wait=True)

    run_test("ATK-DB2-02", "detection event falsification", "vm2_database", "attack",
             action_atk_db2_02, wait=True)

    run_test("ATK-DB2-03", "monitored file hash tamper", "vm2_database", "attack",
             action_atk_db2_03, wait=True)

    run_test("ATK-DB2-04", "recovery event deletion", "vm2_database", "attack",
             action_atk_db2_04, wait=True)

    run_test("ATK-DB2-05", "VM2 admin password tamper", "vm2_database", "attack",
             action_atk_db2_05, wait=True)

    # =====================================================================
    # ATTACK TESTS — AI/ML Assets
    # =====================================================================
    run_test("ATK-AI-01", "Model pkl replacement", "ai_ml_assets", "attack",
             action_atk_ai_01, trigger_scan_fn=trigger_scan_all, wait=False)
    teardown_ai_originals()

    run_test("ATK-AI-02", "Model metadata tampering", "ai_ml_assets", "attack",
             action_atk_ai_02, trigger_scan_fn=trigger_scan_all, wait=False)
    teardown_ai_originals()

    run_test("ATK-AI-03", "State JSON wipe", "ai_ml_assets", "attack",
             action_atk_ai_03, trigger_scan_fn=trigger_scan_all, wait=False)
    teardown_ai_originals()

    run_test("ATK-AI-04", "Isolation Forest metadata corrupt", "ai_ml_assets", "attack",
             action_atk_ai_04, trigger_scan_fn=trigger_scan_all, wait=False)
    teardown_ai_originals()

    run_test("ATK-AI-05", "Behavioral profile removal", "ai_ml_assets", "attack",
             action_atk_ai_05, trigger_scan_fn=trigger_scan_all, wait=False)
    teardown_ai_originals()

    run_test("ATK-AI-07", "Model pkl deletion", "ai_ml_assets", "attack",
             action_atk_ai_07, trigger_scan_fn=trigger_scan_all, wait=False)
    teardown_ai_originals()

    run_test("ATK-AI-09", "Config state poisoning", "ai_ml_assets", "attack",
             action_atk_ai_09, trigger_scan_fn=trigger_scan_all, wait=False)
    teardown_ai_originals()

    run_test("ATK-AI-10", "Dual artifact tampering", "ai_ml_assets", "attack",
             action_atk_ai_10, trigger_scan_fn=trigger_scan_all, wait=False)
    teardown_ai_originals()

    # =====================================================================
    # ATTACK TESTS — Context/Behavioral
    # =====================================================================
    run_test("ATK-CTX-01", "After-hours unauthorized access", "context", "attack",
             action_atk_ctx_01, wait=False)

    run_test("ATK-CTX-02", "Unknown source IP", "context", "attack",
             action_atk_ctx_02, wait=False)

    run_test("ATK-CTX-03", "VPN-masked access", "context", "attack",
             action_atk_ctx_03, wait=False)

    run_test("ATK-CTX-04", "Mass file modification", "context", "attack",
             action_atk_ctx_04, wait=False)

    run_test("ATK-CTX-05", "AI model modification flag", "context", "attack",
             action_atk_ctx_05, wait=False)

    # =====================================================================
    # BENIGN TESTS — Application Files
    # =====================================================================
    run_test("BEN-F-01", "README timestamp append", "application_files", "benign",
             action_ben_f01, trigger_scan_fn=trigger_scan_all, wait=False)

    run_test("BEN-F-02", "Notes file edit", "application_files", "benign",
             action_ben_f02, trigger_scan_fn=trigger_scan_all, wait=False)

    run_test("BEN-F-03", "Log file append", "application_files", "benign",
             action_ben_f03, trigger_scan_fn=trigger_scan_all, wait=False)

    run_test("BEN-F-04", "Temp cache create/delete", "application_files", "benign",
             action_ben_f04, trigger_scan_fn=trigger_scan_all, wait=False)

    run_test("BEN-F-05", ".gitignore benign append", "application_files", "benign",
             action_ben_f05, trigger_scan_fn=trigger_scan_all, wait=False)

    run_test("BEN-F-06", "Changelog benign entry", "application_files", "benign",
             action_ben_f06, trigger_scan_fn=trigger_scan_all, wait=False)

    # =====================================================================
    # BENIGN TESTS — Admin Operations
    # =====================================================================
    run_test("BEN-ADM-01", "Manual full backup", "admin_ops", "benign",
             action_ben_adm_01, wait=False)

    run_test("BEN-ADM-02", "Files-only backup", "admin_ops", "benign",
             action_ben_adm_02, wait=False)

    run_test("BEN-ADM-03", "ML artifact backup", "admin_ops", "benign",
             action_ben_adm_03, wait=False)

    run_test("BEN-ADM-04", "Database backup", "admin_ops", "benign",
             action_ben_adm_04, wait=False)

    run_test("BEN-ADM-05", "Dashboard health check", "admin_ops", "benign",
             action_ben_adm_05, wait=False)

    # =====================================================================
    # BENIGN TESTS — AI/ML Operations
    # =====================================================================
    run_test("BEN-AI-01", "Authorized model retrain", "ai_ml_assets", "benign",
             action_ben_ai_01, wait=False)

    run_test("BEN-AI-02", "Authorized seed training", "ai_ml_assets", "benign",
             action_ben_ai_02, wait=False)

    run_test("BEN-AI-03", "ML score probe benign features", "ai_ml_assets", "benign",
             action_ben_ai_03, wait=False)

    run_test("BEN-AI-05", "AI rule listing", "ai_ml_assets", "benign",
             action_ben_ai_05, wait=False)

    # =====================================================================
    # BENIGN TESTS — Context/Behavioral
    # =====================================================================
    run_test("BEN-CTX-01", "Admin login business hours", "context", "benign",
             action_ben_ctx_01, wait=False)

    run_test("BEN-CTX-02", "Scheduled deployment", "context", "benign",
             action_ben_ctx_02, wait=False)

    run_test("BEN-CTX-03", "Normal GitHub webhook deploy", "context", "benign",
             action_ben_ctx_03, wait=False)

    run_test("BEN-CTX-05", "Normal backup event", "context", "benign",
             action_ben_ctx_05, wait=False)

    # =====================================================================
    # COMPUTE & PRINT CONFUSION MATRIX
    # =====================================================================
    print("\n" + "=" * 60)
    print("EVALUATION COMPLETE — Computing Confusion Matrix")
    print("=" * 60)
    metrics.compute_and_print()


if __name__ == "__main__":
    run_all()
```

---

## 11. Metrics Computation

`evaluation/metrics.py` — reads the CSV and computes all metrics.

```python
# evaluation/metrics.py

import csv
from eval_config import RESULTS_CSV


def compute_and_print(csv_path: str = None):
    if csv_path is None:
        csv_path = RESULTS_CSV

    tp = fp = tn = fn = errors = 0
    domain_stats: dict[str, dict] = {}

    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            result = row["result"]
            domain = row["domain"]

            if domain not in domain_stats:
                domain_stats[domain] = {"TP": 0, "FP": 0, "TN": 0, "FN": 0}

            if result == "TP":
                tp += 1
                domain_stats[domain]["TP"] += 1
            elif result == "FP":
                fp += 1
                domain_stats[domain]["FP"] += 1
            elif result == "TN":
                tn += 1
                domain_stats[domain]["TN"] += 1
            elif result == "FN":
                fn += 1
                domain_stats[domain]["FN"] += 1
            else:
                errors += 1

    total = tp + fp + tn + fn

    print(f"\nTotal evaluated: {total}  (errors/skipped: {errors})")
    print()
    print("CONFUSION MATRIX")
    print("-" * 44)
    print(f"{'':20s}  {'Predicted Attack':>14}  {'Predicted Benign':>14}")
    print(f"{'Actual Attack':20s}  {'TP = ' + str(tp):>14}  {'FN = ' + str(fn):>14}")
    print(f"{'Actual Benign':20s}  {'FP = ' + str(fp):>14}  {'TN = ' + str(tn):>14}")
    print()

    accuracy  = (tp + tn) / total if total else 0
    precision = tp / (tp + fp) if (tp + fp) else 0
    recall    = tp / (tp + fn) if (tp + fn) else 0
    f1        = (2 * precision * recall) / (precision + recall) if (precision + recall) else 0
    fpr       = fp / (fp + tn) if (fp + tn) else 0

    print("PERFORMANCE METRICS")
    print("-" * 30)
    print(f"Accuracy   : {accuracy:.4f}  ({accuracy*100:.2f}%)")
    print(f"Precision  : {precision:.4f}  ({precision*100:.2f}%)")
    print(f"Recall     : {recall:.4f}  ({recall*100:.2f}%)")
    print(f"F1-Score   : {f1:.4f}  ({f1*100:.2f}%)")
    print(f"FP Rate    : {fpr:.4f}  ({fpr*100:.2f}%)")
    print()

    print("PER-DOMAIN BREAKDOWN")
    print("-" * 60)
    print(f"{'Domain':25s}  {'TP':>4}  {'FP':>4}  {'TN':>4}  {'FN':>4}")
    for domain, s in sorted(domain_stats.items()):
        print(f"{domain:25s}  {s['TP']:>4}  {s['FP']:>4}  {s['TN']:>4}  {s['FN']:>4}")

    return {
        "tp": tp, "fp": fp, "tn": tn, "fn": fn,
        "accuracy": accuracy, "precision": precision,
        "recall": recall, "f1": f1, "fpr": fpr,
    }


if __name__ == "__main__":
    compute_and_print()
```

---

## 12. How to Run the Evaluation

### 12.1 Prerequisites

Run these steps from a machine that has:
- SSH key access to both VM1 (`152.42.249.84`) and VM2 (`146.190.97.87`)
- Python 3.9+ with the `requests` library installed
- Network access to `https://api-vm2.nanowards.com`

```bash
pip install requests
```

### 12.2 First-time Setup

1. SSH into VM2 and confirm containers are running:

```bash
ssh root@146.190.97.87
docker ps
```

Look for `security-api` and `security-db` in the output.

2. Confirm the VM2 API is reachable:

```bash
curl -sS https://api-vm2.nanowards.com/health
# Expected: {"status": "healthy"}
```

3. Confirm the VM2 API key works:

```bash
curl -sS -H "X-API-Key: 3e5833e12a888a95601b31f69b4e9bb8612f0e17807020deeb4d24f43e3e68c1" \
  https://api-vm2.nanowards.com/v1/dashboard | python3 -m json.tool | head -20
```

4. Confirm the VM1 MySQL container name:

```bash
ssh root@152.42.249.84 'docker ps --format "table {{.Names}}\t{{.Status}}"'
```

Update `VM1_MYSQL_CONTAINER` in `eval_config.py` with the exact container name.

5. Confirm the VM2 MySQL container name:

```bash
ssh root@146.190.97.87 'docker ps --format "table {{.Names}}\t{{.Status}}"'
```

Update `VM2_MYSQL_CONTAINER` in `eval_config.py`.

6. Make sure the AI model exists (required for ATK-AI teardowns to work):

```bash
curl -sS -X POST https://api-vm2.nanowards.com/v1/ai/seed-initial-training \
  -H "X-API-Key: 3e5833e12a888a95601b31f69b4e9bb8612f0e17807020deeb4d24f43e3e68c1" \
  -H "Content-Type: application/json" \
  -d '{"actor": "pre_eval_seed"}' | python3 -m json.tool
```

### 12.3 Running the Evaluation

From the repository root:

```bash
cd evaluation
python run_evaluation.py
```

The runner will print live progress for each test and write results to `evaluation/results/evaluation_results.csv`.

After all tests complete, re-run metrics alone at any time:

```bash
python metrics.py
```

### 12.4 Running a Subset

To run only attack tests, comment out benign test blocks in `run_evaluation.py`. To run only a specific domain, comment out other domain blocks. The CSV appends rows, so partial runs accumulate; delete `evaluation_results.csv` to start fresh.

---

## 13. Expected Output

A successful full run should produce terminal output similar to:

```
====================================================
WARDS Confusion Matrix Evaluation
====================================================

[ATK-F-01] HTML full defacement
  Waiting for scan...
  Actual=attack, Predicted=attack → TP
  AI score=0.87, AI prediction=malicious
  Cleaning up incident 42...

[BEN-F-01] README timestamp append
  Waiting for scan...
  Actual=benign, Predicted=benign → TN
...

====================================================
EVALUATION COMPLETE — Computing Confusion Matrix
====================================================

Total evaluated: 80  (errors/skipped: 0)

CONFUSION MATRIX
--------------------------------------------
                      Predicted Attack    Predicted Benign
Actual Attack                 TP = 37              FN = 3
Actual Benign                  FP = 2             TN = 38

PERFORMANCE METRICS
------------------------------
Accuracy   : 0.9375  (93.75%)
Precision  : 0.9487  (94.87%)
Recall     : 0.9250  (92.50%)
F1-Score   : 0.9367  (93.67%)
FP Rate    : 0.0500  (5.00%)

PER-DOMAIN BREAKDOWN
------------------------------------------------------------
Domain                     TP    FP    TN    FN
admin_ops                   0     0     5     0
ai_ml_assets                7     0     4     1
application_files          20     1    15     0
context                     4     1     8     0
vm1_database                4     0     5     0
vm2_database                2     0     5     3
```

*(Numbers above are illustrative — actual results will differ.)*

---

## 14. How to Handle Unexpected Results

### If a test consistently produces FN (attack not detected):

- Check `SUSPICIOUS_PATTERNS` in `security_engine.py` — some patterns are very specific. A test payload that uses different capitalization or phrasing may escape the rule.
- Check `MONITORED_SUFFIXES` — if the file extension is not in the list, it is not monitored.
- Check `DEFAULT_EXCLUDED_DIRS` — if the file is inside an excluded directory, it is not monitored.
- Try forcing a scan after the action using `trigger_scan_all()` explicitly.
- Note the false negative in your thesis table and explain which rule or path exclusion caused it.

### If a benign test produces FP (benign action detected):

- Inspect the incident's `trigger_summary` field from the query response to see which rule fired.
- Common causes: appending to a monitored `.md` file with content that contains a watchword, or triggering a context detection with an IP not in the known admin list.
- Adjust the benign test payload to avoid triggering unintended rules, **or** document the false positive as a finding (benign file changes that contain security-adjacent keywords can trigger the system — this is a tuning tradeoff worth discussing).

### If VM2 DB attack tests (ATK-DB2-*) never detect:

This is expected in some configurations. The `wards_security_db_audit_log` audit triggers on VM1 monitor the **application database** (`wards_db` on VM1). The VM2 security database itself is not subject to the same audit trigger mechanism. If those tests consistently return FN, document in the thesis that WARDS currently monitors the application database for integrity and the VM2 security database is protected via backup integrity and HMAC verification instead.

---

## 15. Thesis Documentation

Once you have the confusion matrix results, present them in the thesis as follows:

### Section: AI Performance Evaluation

#### 15.1 Evaluation Dataset

The evaluation dataset consists of **N controlled test scenarios** executed against the live WARDS deployment. Each scenario has a predetermined ground-truth label (Attack or Benign). WARDS' prediction is determined by whether a `SecurityDetectionEvent` record is created within one scan cycle (35 seconds) after the action is performed.

| Category | Attack Scenarios | Benign Scenarios | Total |
|---|---|---|---|
| Application Files | 15 | 6 | 21 |
| Database (VM1 + VM2) | 9 | 5 | 14 |
| AI/ML Assets | 8 | 4 | 12 |
| Context/Behavioral | 5 | 7 | 12 |
| Admin Operations | 0 | 5 | 5 |
| **Total** | **37** | **27** | **64** |

*(Adjust these numbers to match your actual test count after running the suite.)*

#### 15.2 Confusion Matrix

*(Insert your actual results table here.)*

#### 15.3 Performance Metrics

| Metric | Value |
|---|---|
| Accuracy | X.XX% |
| Precision | X.XX% |
| Recall (Detection Rate) | X.XX% |
| F1-Score | X.XX% |
| False Positive Rate | X.XX% |

#### 15.4 Analysis

Discuss:
- Which domain had the highest detection rate and why
- Which attacks produced false negatives and what caused them (rule gap, excluded path, etc.)
- Whether any benign tests produced false positives and the implication for usability
- How the Isolation Forest ML scoring contributed vs. the rule-based scoring (visible via the `ai_score` and `ai_prediction` fields in the CSV)
- Reference the 28-feature vector and behavioral profile as complementary to rule-based detection

---

*End of CONFUSION_MATRIX.md*
