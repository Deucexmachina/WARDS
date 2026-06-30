from __future__ import annotations

import os
from pathlib import Path


def env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


VM2_API_URL = env("EVAL_VM2_API_URL", "https://api-vm2.nanowards.com")
VM2_API_KEY = env("EVAL_VM2_API_KEY")
VM2_ADMIN_SECRET = env("EVAL_VM2_ADMIN_SECRET")

VM1_HOST = env("EVAL_VM1_HOST", "152.42.249.84")
VM1_SSH_USER = env("EVAL_VM1_SSH_USER", "root")
VM1_SSH_KEY_PATH = env("EVAL_VM1_SSH_KEY_PATH", "~/.ssh/id_rsa")
VM1_APP_DIR = env("EVAL_VM1_APP_DIR", "/opt/wards/app")
VM1_MYSQL_CONTAINER = env("EVAL_VM1_MYSQL_CONTAINER", "app-mysql-1")
VM1_MYSQL_USER = env("EVAL_VM1_MYSQL_USER", "root")
VM1_MYSQL_PASSWORD = env("EVAL_VM1_MYSQL_PASSWORD")
VM1_MYSQL_DATABASE = env("EVAL_VM1_MYSQL_DATABASE", "wards_db")

VM2_HOST = env("EVAL_VM2_HOST", "146.190.97.87")
VM2_SSH_USER = env("EVAL_VM2_SSH_USER", "root")
VM2_SSH_KEY_PATH = env("EVAL_VM2_SSH_KEY_PATH", "~/.ssh/id_rsa")
VM2_APP_DIR = env("EVAL_VM2_APP_DIR", "/opt/wards/security/app")
VM2_MYSQL_CONTAINER = env("EVAL_VM2_MYSQL_CONTAINER", "app-security-db-1")
VM2_MYSQL_USER = env("EVAL_VM2_MYSQL_USER", "root")
VM2_MYSQL_PASSWORD = env("EVAL_VM2_MYSQL_PASSWORD")
VM2_MYSQL_DATABASE = env("EVAL_VM2_MYSQL_DATABASE", "wards_security_db")

SCAN_WAIT_SECONDS = int(env("EVAL_SCAN_WAIT_SECONDS", "45") or "45")
CLEANUP_WAIT_SECONDS = int(env("EVAL_CLEANUP_WAIT_SECONDS", "5") or "5")
SCAN_BACKOFF_SECONDS = int(env("EVAL_SCAN_BACKOFF_SECONDS", "21") or "21")
VM1_SNAPSHOT_WAIT_SECONDS = int(env("EVAL_VM1_SNAPSHOT_WAIT_SECONDS", "45") or "45")
DETECTION_LOOKBACK_SECONDS = int(env("EVAL_DETECTION_LOOKBACK_SECONDS", "120") or "120")
REQUEST_TIMEOUT_SECONDS = int(env("EVAL_REQUEST_TIMEOUT_SECONDS", "180") or "180")
VERIFY_TLS = env("EVAL_VERIFY_TLS", "true").lower() not in {"0", "false", "no"}

ROOT = Path(__file__).resolve().parent
RESULTS_DIR = ROOT / "results"
RESULTS_CSV = Path(env("EVAL_RESULTS_CSV", str(RESULTS_DIR / "evaluation_results.csv")))
SUMMARY_JSON = Path(env("EVAL_SUMMARY_JSON", str(RESULTS_DIR / "summary.json")))
SUMMARY_MD = Path(env("EVAL_SUMMARY_MD", str(RESULTS_DIR / "summary.md")))
SUMMARY_XLSX = Path(env("EVAL_SUMMARY_XLSX", str(RESULTS_DIR / "confusion_matrix_results.xlsx")))


def validate_required() -> None:
    missing = [
        name
        for name, value in {
            "EVAL_VM2_API_KEY": VM2_API_KEY,
            "EVAL_VM2_ADMIN_SECRET": VM2_ADMIN_SECRET,
            "EVAL_VM1_MYSQL_PASSWORD": VM1_MYSQL_PASSWORD,
            "EVAL_VM2_MYSQL_PASSWORD": VM2_MYSQL_PASSWORD,
        }.items()
        if not value
    ]
    if missing:
        raise RuntimeError("Missing required evaluation environment variable(s): " + ", ".join(missing))
