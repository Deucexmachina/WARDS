from __future__ import annotations

import difflib
import base64
import csv
import hashlib
import hmac
import json
import logging
import math
import os
import random
import shlex
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Iterable

import requests
from sqlalchemy import MetaData, Table, inspect, or_, text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session
from database.models import Admin, Alert, SessionLocal
from utils.log_integrity import verify_record_integrity

from SECURITY.security_models import (
    SecurityAdminFileChange,
    SecurityDetectionEvent,
    SecurityIncident,
    SecurityMonitoredFile,
    SecurityRecoveryEvent,
    SecuritySetting,
)

try:
    import numpy as np
    _NUMPY_AVAILABLE = True
except ImportError:
    np = None  # type: ignore
    _NUMPY_AVAILABLE = False

try:
    from sklearn.ensemble import IsolationForest
    _SKLEARN_AVAILABLE = True
except ImportError:
    IsolationForest = None  # type: ignore
    _SKLEARN_AVAILABLE = False

try:
    import joblib
    _JOBLIB_AVAILABLE = True
except ImportError:
    joblib = None  # type: ignore
    _JOBLIB_AVAILABLE = False

MASTER_ROOT = Path(__file__).resolve().parents[1]
logger = logging.getLogger(__name__)

# Cache last-run timestamps for expensive housekeeping operations so they
# do not run on every incident mutation.
_last_migrate_at: float = 0.0
_last_dedupe_at: float = 0.0


def _run_async_backup(fn):
    """Run a backup operation in a background daemon thread to avoid blocking the HTTP response."""
    def _wrapper():
        try:
            fn()
        except Exception as exc:
            logger.warning("Background backup failed: %s", exc)
    threading.Thread(target=_wrapper, daemon=True).start()


SECURITY_ROOT = MASTER_ROOT / "SECURITY"
QUARANTINE_ROOT = MASTER_ROOT / "QUARANTINE"
VM1_SNAPSHOT_ROOT = Path(os.getenv("VM1_SNAPSHOT_ROOT", str(SECURITY_ROOT / "vm1_snapshots")))
VM1_DEFACED_SNAPSHOT_ROOT = VM1_SNAPSHOT_ROOT / ".defaced"
VM1_RESTORE_CONTENT_ROOT = VM1_SNAPSHOT_ROOT / ".restore_content"
DEFAULT_BACKUP_ROOT = SECURITY_ROOT / "local_backups"
MODEL_STATE_PATH = SECURITY_ROOT / "ml" / "isolation_forest_state.json"
MODEL_METADATA_PATH = SECURITY_ROOT / "ml" / "isolation_forest_metadata.json"
INITIAL_TRAINING_SAMPLES_PATH = SECURITY_ROOT / "ml" / "initial_training_samples.csv"
ML_MODELS_DIR = SECURITY_ROOT / "ml_models"
IFOREST_MODEL_PATH = ML_MODELS_DIR / "isolation_forest.pkl"
IFOREST_META_PATH = ML_MODELS_DIR / "model_metadata.json"
MIN_ML_TRAINING_SAMPLES = 10
WAZUH_CONFIG_PATH = Path(os.getenv("WAZUH_CONFIG_PATH", str(SECURITY_ROOT / "wazuh" / "ossec.conf"))).expanduser()
DATABASE_MONITOR_ROOT = SECURITY_ROOT / "database_monitor"
DATABASE_SNAPSHOT_PATH = DATABASE_MONITOR_ROOT / "wards_db_snapshot.json"
DATABASE_CHECKSUM_PATH = DATABASE_MONITOR_ROOT / "wards_db_checksum.json"
DATABASE_BACKUP_RELATIVE_PATH = "DATABASE/wards_db_snapshot.json"
DATABASE_CHECKSUM_RELATIVE_PATH = "DATABASE/wards_db_checksum.json"
RECOVERY_DOMAIN_FILES = "application_files"
RECOVERY_DOMAIN_VM2_DATABASE = "vm2_database"
RECOVERY_DOMAIN_ML = "ai_ml_assets"
RECOVERY_DOMAIN_VM1_DATABASE = "vm1_database"
RECOVERY_DOMAINS = {
    RECOVERY_DOMAIN_FILES,
    RECOVERY_DOMAIN_VM2_DATABASE,
    RECOVERY_DOMAIN_ML,
    RECOVERY_DOMAIN_VM1_DATABASE,
}
DATABASE_AUDIT_TABLE = "wards_security_db_audit_log"
DATABASE_AUTH_TABLE = "wards_security_authorized_operations"
DATABASE_AUDIT_TRIGGER_PREFIX = "wards_security_audit"
BACKUP_MANIFEST_NAME = "_backup_hashes.json"
BACKUP_RETENTION_LIMIT = 10
WAZUH_CONFIG_BACKUP_SUFFIX = ".bak"
WAZUH_HELPER_SCRIPT = SECURITY_ROOT / "wazuh_admin_helper.py"
WAZUH_HELPER_LOG_PATH = SECURITY_ROOT / "wazuh" / "wazuh_helper.log"
MODEL_RELATIVE_BACKUP_DIR = "SECURITY/ml"
ML_MODELS_RELATIVE_BACKUP_DIR = "SECURITY/ml_models"
SHARED_MONITORED_FOLDERS_PATH = SECURITY_ROOT / "monitoring" / "monitored_folders.json"
LOCAL_MONITORED_FOLDERS_SETTING = "custom_monitored_folders"
VM1_CUSTOM_MONITORED_FOLDERS_SETTING = "vm1_custom_monitored_folders"
MONITORING_REMOVED_STATUS = "monitoring_removed"
EXTERNAL_MONITOR_PREFIX = "EXTERNAL"
VM1_FOLDER_ROOT_PREFIX = "VM1_"

DATABASE_EXCLUDED_TABLES = {
    "activity_logs",
    "alerts",
    "alert_views",
    "announcement_views",
    "ip_reputation_cache",
    "memo_views",
    "permanent_ip_blocks",
    DATABASE_AUDIT_TABLE,
    DATABASE_AUTH_TABLE,
}
DATABASE_EXCLUDED_PREFIXES = ("security_",)

_vm2_app_dir = os.getenv("VM2_APP_DIR")
if _vm2_app_dir:
    _deploy_root = Path(_vm2_app_dir)
    MONITORED_ROOTS = {
        "WARDS": _deploy_root / "WARDS",
    }
else:
    MONITORED_ROOTS = {
        "WARDS": MASTER_ROOT / "WARDS",
    }

DEFAULT_EXCLUDED_DIRS = {
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
    ".csv",
}

MONITORED_SPECIAL_FILENAMES = {
    "dockerfile",
    ".gitignore",
    ".gitkeep",
}

MONITORED_SPECIAL_NAME_SUFFIXES = (
    ".env.example",
    "env.example",
)

SUSPICIOUS_PATTERNS = {
    "script_injection": ("<script", "javascript:", "eval(", "document.write", "onerror=", "onload="),
    "iframe_injection": ("<iframe",),
    "defacement_keywords": ("hacked", "defaced", "owned", "pwned"),
    "credential_access": ("password=", "token=", "secret=", "api_key"),
    "sql_injection": ("' or '1'='1", "union select", "drop table"),
}

BEHAVIOR_LABELS = {
    "after_hours": "After-hours activity",
    "weekend_activity": "Weekend activity",
    "vpn_activity": "VPN or proxy activity",
    "rapid_change": "Rapid file change velocity",
    "unauthenticated_change": "Change outside the admin workflow",
    "script_injection": "Script injection pattern",
    "iframe_injection": "Hidden iframe pattern",
    "defacement_keywords": "Defacement wording",
    "credential_access": "Credential-like content",
    "sql_injection": "SQL injection pattern",
    "source_ip_reputation": "Source IP reputation anomaly",
    "keystroke_dynamics": "Keystroke dynamics anomaly",
    "unauthorized_admin_path": "Sensitive admin path change",
    "sensitive_config_change": "Sensitive configuration change",
    "mfa_not_verified": "MFA verification anomaly",
    "first_time_device": "First-time device anomaly",
    "first_time_country": "First-time country anomaly",
    "geo_distance_from_last_login": "Impossible travel anomaly",
    "backup_restore_activity": "Backup or restore activity anomaly",
    "mfa_configuration_change": "MFA configuration change",
    "auth_system_modification": "Authentication system modification",
    "peer_login_time_deviation": "Peer login time deviation",
    "peer_path_access_deviation": "Peer path access deviation",
    "excessive_file_modifications": "Excessive file modification rate",
    "rapid_admin_actions": "Rapid admin action rate",
}

DEFAULT_AI_RULES = {
    "hour_of_day": {
        "label": "Hour of Day",
        "description": "Time the change was detected.",
        "enabled": True,
        "weight": 0.08,
        "config": {"safe_start_hour": 8, "safe_end_hour": 18},
    },
    "day_of_week": {
        "label": "Day of Week",
        "description": "Monday to Sunday behavior pattern.",
        "enabled": True,
        "weight": 0.05,
        "config": {"safe_days": [0, 1, 2, 3, 4]},
    },
    "session_duration": {
        "label": "Session Duration",
        "description": "Estimated authenticated admin session age.",
        "enabled": True,
        "weight": 0.08,
        "config": {"minimum_seconds": 60, "maximum_seconds": 28800},
    },
    "file_size_change": {
        "label": "File Size Change",
        "description": "Byte difference from the clean backup copy.",
        "enabled": True,
        "weight": 0.12,
        "config": {"large_delta_bytes": 2000},
    },
    "content_length": {
        "label": "Content Length",
        "description": "New file length.",
        "enabled": True,
        "weight": 0.05,
        "config": {"unusual_min": 10, "unusual_max": 250000},
    },
    "special_chars_count": {
        "label": "Special Characters",
        "description": "Count of code-like or injection-friendly characters.",
        "enabled": True,
        "weight": 0.08,
        "config": {"high_count": 300},
    },
    "admin_session_valid": {
        "label": "Admin Session Valid",
        "description": "Whether a WARDS admin JWT/MFA session was present.",
        "enabled": True,
        "weight": 0.22,
        "config": {},
    },
    "mfa_verified": {
        "label": "MFA Verified",
        "description": "Whether Microsoft Authenticator MFA was verified for the admin session.",
        "enabled": True,
        "weight": 0.16,
        "config": {"required_for_admin_changes": True},
    },
    "ip_consistent": {
        "label": "IP Consistency",
        "description": "Whether source looks consistent with normal admin use.",
        "enabled": True,
        "weight": 0.08,
        "config": {},
    },
    "source_ip_reputation": {
        "label": "Source IP Reputation",
        "description": "Whether source IP reputation or blocklist signals look suspicious.",
        "enabled": True,
        "weight": 0.1,
        "config": {"suspicious_score": 50, "malicious_score": 80},
    },
    "keystroke_dynamics": {
        "label": "Keystroke Dynamics",
        "description": "Uses aggregate typing-pattern anomaly signals when available.",
        "enabled": True,
        "weight": 0.1,
        "config": {"minimum_confidence": 0.7},
    },
    "method_legitimate": {
        "label": "Legitimate Method",
        "description": "Whether change came through an approved admin workflow.",
        "enabled": True,
        "weight": 0.18,
        "config": {},
    },
    "business_hours": {
        "label": "Business Hours",
        "description": "Whether change happened during normal working hours.",
        "enabled": True,
        "weight": 0.08,
        "config": {"safe_start_hour": 8, "safe_end_hour": 18},
    },
    "file_type_risk": {
        "label": "File Type Risk",
        "description": "Risk weight for web/code files.",
        "enabled": True,
        "weight": 0.07,
        "config": {"high_risk_extensions": [".html", ".jsx", ".js", ".py"]},
    },
    "suspicious_pattern_score": {
        "label": "Suspicious Pattern Score",
        "description": "Defacement/injection pattern score.",
        "enabled": True,
        "weight": 0.32,
        "config": {"critical_patterns": ["script_injection", "iframe_injection"], "keyword_weight": 0.22},
    },
    "vpn_activity": {
        "label": "VPN Activity",
        "description": "Raises risk but does not automatically mark malicious.",
        "enabled": True,
        "weight": 0.12,
        "config": {"auto_malicious": False},
    },
    "first_time_device": {
        "label": "First-Time Device",
        "description": "Raises risk when an admin action comes from a device not seen in the learned profile.",
        "enabled": True,
        "weight": 0.14,
        "config": {},
    },
    "first_time_country": {
        "label": "First-Time Country",
        "description": "Raises risk when an admin action comes from a country not seen in the learned profile.",
        "enabled": True,
        "weight": 0.16,
        "config": {},
    },
    "geo_distance_from_last_login": {
        "label": "Geo Distance From Last Login",
        "description": "Detects impossible-travel style distance jumps between admin sessions.",
        "enabled": True,
        "weight": 0.18,
        "config": {"high_risk_km": 500, "impossible_travel_km_per_hour": 900},
    },
    "unauthorized_admin_path": {
        "label": "Unauthorized Admin Path",
        "description": "Raises risk when admin, auth, MFA, backup, recovery, or security-dashboard files change outside approved workflows.",
        "enabled": True,
        "weight": 0.22,
        "config": {"path_keywords": ["admin", "security", "auth", "mfa", "backup", "recovery"]},
    },
    "sensitive_config_change": {
        "label": "Sensitive Config Change",
        "description": "Raises risk for environment, Wazuh, dependency, and database configuration changes.",
        "enabled": True,
        "weight": 0.26,
        "config": {"extensions": [".env", ".xml", ".yml", ".yaml", ".sql"], "filenames": ["requirements.txt", "package.json"]},
    },
    "backup_restore_activity": {
        "label": "Backup Restore Activity",
        "description": "Detects backup, restore, quarantine, and recovery actions outside approved workflows.",
        "enabled": True,
        "weight": 0.2,
        "config": {"path_keywords": ["backup", "restore", "recovery", "quarantine"]},
    },
    "mfa_configuration_change": {
        "label": "MFA Configuration Change",
        "description": "Detects changes to MFA setup, authenticator, and two-factor configuration paths.",
        "enabled": True,
        "weight": 0.22,
        "config": {"path_keywords": ["mfa", "authenticator", "two_factor", "2fa"]},
    },
    "auth_system_modification": {
        "label": "Auth System Modification",
        "description": "Detects authentication, authorization, token, password, and session module changes.",
        "enabled": True,
        "weight": 0.24,
        "config": {"path_keywords": ["auth", "login", "jwt", "token", "password", "session", "middleware"]},
    },
    "admin_action_rarity": {
        "label": "Admin Action Rarity",
        "description": "Raises risk when an administrator modifies paths or performs actions outside the learned admin profile.",
        "enabled": True,
        "weight": 0.16,
        "config": {"high_rarity_score": 0.75},
    },
    "restore_frequency": {
        "label": "Restore Frequency",
        "description": "Raises risk when repeated restore operations suggest a recovery abuse loop.",
        "enabled": True,
        "weight": 0.18,
        "config": {"max_restores_per_window": 3, "window_minutes": 30},
    },
    "backup_integrity_validation": {
        "label": "Backup Integrity Validation",
        "description": "Blocks recovery risk acceptance when backup hash validation fails before restoration.",
        "enabled": True,
        "weight": 0.24,
        "config": {},
    },
    "content_similarity_score": {
        "label": "Content Similarity Score",
        "description": "Raises risk when modified content is substantially different from the approved baseline even if length is similar.",
        "enabled": True,
        "weight": 0.2,
        "config": {"low_similarity": 0.45},
    },
    "affected_files_count": {
        "label": "Affected Files Count",
        "description": "Raises risk when many protected files are modified in a short time window.",
        "enabled": True,
        "weight": 0.2,
        "config": {"medium_risk_count": 3, "high_risk_count": 10},
    },
}

AI_SENSITIVITY_THRESHOLDS = {
    "low": 0.85,
    "medium": 0.70,
    "high": 0.55,
    "very_high": 0.40,
}

APPROVED_ADDITIONAL_AI_RULES = {
    "peer_login_time_deviation": {
        "label": "Peer Login Time Deviation",
        "description": "Compares admin action timing against peer administrator activity when supplied by context.",
        "enabled": True,
        "weight": 0.1,
        "config": {"minimum_z_score": 2.5},
        "initial_samples": ["admin login time is outside peer group baseline."],
    },
    "peer_path_access_deviation": {
        "label": "Peer Path Access Deviation",
        "description": "Detects unusual file path access compared with peer administrators when supplied by context.",
        "enabled": True,
        "weight": 0.12,
        "config": {"minimum_z_score": 2.5},
        "initial_samples": ["admin edited paths outside peer group baseline."],
    },
    "excessive_file_modifications": {
        "label": "Excessive File Modifications",
        "description": "Raises risk when too many protected files change in a short window.",
        "enabled": True,
        "weight": 0.18,
        "config": {"max_files_per_window": 10},
        "initial_samples": ["multiple protected files modified within a short time window."],
    },
    "rapid_admin_actions": {
        "label": "Rapid Admin Actions",
        "description": "Raises risk for unusually fast repeated privileged actions that may indicate automation or compromise.",
        "enabled": True,
        "weight": 0.16,
        "config": {"max_actions_per_minute": 12},
        "initial_samples": ["admin executed repeated privileged actions faster than normal."],
    },
}


@dataclass
class AIPrediction:
    prediction: str
    score: float
    confidence: float
    basis: str


_NETWORK_TIME_CACHE = {"value": None, "fetched_at": 0.0, "source": "local_utc"}


def now_utc() -> datetime:
    cache_age = time.time() - float(_NETWORK_TIME_CACHE.get("fetched_at") or 0)
    if _NETWORK_TIME_CACHE.get("value") and cache_age < 60:
        return _NETWORK_TIME_CACHE["value"] + timedelta(seconds=cache_age)
    if _NETWORK_TIME_CACHE.get("source") == "local_utc_fallback" and cache_age < 60:
        return datetime.utcnow()
    try:
        response = requests.get("https://worldtimeapi.org/api/timezone/Etc/UTC", timeout=0.5)
        response.raise_for_status()
        payload = response.json()
        raw_value = payload.get("utc_datetime") or payload.get("datetime")
        if raw_value:
            online_time = datetime.fromisoformat(raw_value.replace("Z", "+00:00")).replace(tzinfo=None)
            _NETWORK_TIME_CACHE.update({"value": online_time, "fetched_at": time.time(), "source": "online_utc"})
            return online_time
    except Exception:
        pass
    _NETWORK_TIME_CACHE.update({"value": None, "fetched_at": time.time(), "source": "local_utc_fallback"})
    return datetime.utcnow()


def time_source_label() -> str:
    return str(_NETWORK_TIME_CACHE.get("source") or "local_utc")


def json_loads(value, default):
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return default


def json_dumps(value) -> str:
    return json.dumps(value, ensure_ascii=True, default=str)


SYSTEM_ALERT_CATALOG = {
    "backup_started": "Security Backup Started",
    "backup_completed": "Security Backup Completed",
    "backup_failed": "Security Backup Failed",
    "detection_logged": "Security Detection Logged",
    "recovery_completed": "Security Recovery Completed",
    "recovery_failed": "Security Recovery Failed",
    "incident_created": "Security Incident Logged",
    "incident_resolved": "Security Incident Resolved",
    "incident_false_positive": "Security Incident Marked False Positive",
    "vpn_risk": "VPN/Proxy Risk Detected",
    "invalid_admin_session": "Invalid Admin Session Detected",
}

CANONICAL_SUPERADMIN_EMAIL = "treasurersuper@gmail.com"
CANONICAL_MAIN_ADMIN_EMAIL = "treasurermain@gmail.com"
IMPORTANT_SYSTEM_ALERT_KEYS = {
    "backup_started",
    "backup_completed",
    "backup_failed",
    "detection_logged",
    "recovery_completed",
    "recovery_failed",
    "incident_created",
    "incident_resolved",
    "incident_false_positive",
    "vpn_risk",
    "invalid_admin_session",
}


def _valid_admin_id(db: Session, admin_id: int | None) -> int | None:
    """Return admin_id only if the admin exists locally; otherwise None.

    This prevents cross-VM foreign-key failures when VM1 admin IDs are
    passed to VM2, which does not share the same admins table.
    """
    if admin_id is None:
        return None
    try:
        return admin_id if db.query(Admin).filter(Admin.id == admin_id).first() else None
    except Exception:
        return None


def canonical_admin_recipients() -> list[str]:
    recipients = [
        (os.getenv("SUPERADMIN_EMAIL") or CANONICAL_SUPERADMIN_EMAIL).strip().lower(),
        (os.getenv("ADMIN_EMAIL") or CANONICAL_MAIN_ADMIN_EMAIL).strip().lower(),
    ]
    return sorted({email for email in recipients if email})


def system_alert_email_recipients(db: Session) -> list[str]:
    recipients = set(canonical_admin_recipients())
    try:
        if "admins" not in inspect(db.bind).get_table_names():
            return sorted(recipients)
        for admin in db.query(Admin).filter(Admin.status == "Active", Admin.role.in_(["main_admin", "admin", "superadmin"])).all():
            email = (admin.email or "").strip().lower()
            if email:
                recipients.add(email)
    except Exception:
        pass
    return sorted(recipients)


_ALERT_EMAIL_COOLDOWN_SECONDS = 60
_last_alert_email_times: dict[str, float] = {}

def dispatch_system_alert_email(
    db: Session,
    alert: Alert,
    *,
    incident: dict | None = None,
    detection: dict | None = None,
    recoveries: list[dict] | None = None,
) -> dict | None:
    try:
        from services.email_service import send_security_incident_alert_email
    except Exception as exc:
        logger.warning("Security alert email service unavailable: %s", exc)
        return None
    if alert.type not in IMPORTANT_SYSTEM_ALERT_KEYS:
        return None
    # Rate-limit incident-related alert emails to prevent spam during bulk detections
    if alert.type in {"incident_created", "incident_auto_recovery", "incident_resolved", "incident_false_positive"}:
        now = time.time()
        last_sent = _last_alert_email_times.get(alert.type, 0)
        if now - last_sent < _ALERT_EMAIL_COOLDOWN_SECONDS:
            logger.info("Rate-limiting %s alert email (last sent %.0fs ago)", alert.type, now - last_sent)
            return None
        _last_alert_email_times[alert.type] = now
    recipients = system_alert_email_recipients(db)
    incident_payload = incident or {
        "id": alert.id,
        "severity_level": alert.severity,
        "status": "open",
        "incident_type": alert.type,
        "description": alert.message,
    }
    detection_payload = detection or {
        "id": alert.id,
        "target_name": "system_alert",
        "change_type": alert.type,
        "trigger_summary": alert.message,
    }
    result = send_security_incident_alert_email(recipients, incident_payload, detection_payload, recoveries)
    if result and not result.get("sent"):
        logger.warning("Security alert email skipped: %s", result.get("message", "unknown reason"))
    return result


def create_system_alert(db: Session, alert_key: str, message: str, severity: str = "low", *, title: str | None = None, dedupe_key: str | None = None) -> Alert | None:
    try:
        if "alerts" not in inspect(db.bind).get_table_names():
            return None
    except Exception:
        return None
    resolved_title = title or SYSTEM_ALERT_CATALOG.get(alert_key, alert_key.replace("_", " ").title())
    if dedupe_key:
        existing = (
            db.query(Alert)
            .filter(Alert.type == alert_key, Alert.title == resolved_title, Alert.message.like(f"%{dedupe_key}%"))
            .first()
        )
        if existing:
            return existing
    alert = Alert(type=alert_key, title=resolved_title, message=message, severity=severity, created_at=datetime.utcnow())
    db.add(alert)
    db.commit()
    db.refresh(alert)
    try:
        dispatch_system_alert_email(db, alert)
    except Exception:
        logger.exception("Failed to dispatch system alert email for alert %s", alert.id)
    return alert


def create_incident_system_alert(db: Session, incident: SecurityIncident, detection: SecurityDetectionEvent | None, recovery: SecurityRecoveryEvent | None = None) -> Alert | None:
    dedupe_key = f"SEC-{incident.id}"
    detection_summary = detection.trigger_summary if detection else "No detection summary recorded."
    recovery_summary = recovery.summary if recovery else "No recovery action was recorded."
    message = (
        f"{dedupe_key}: {incident.description or 'Security incident recorded.'} "
        f"Detection: {detection_summary} Recovery: {recovery_summary}"
    )
    return create_system_alert(
        db,
        "incident_created",
        message,
        incident.severity_level or "high",
        title=f"Security Incident {dedupe_key}",
        dedupe_key=dedupe_key,
    )


def enrich_security_context(db: Session, context: dict | None) -> dict:
    context = dict(context or {})
    rules = context.get("ai_rules") or DEFAULT_AI_RULES
    if not (ai_rule_enabled(rules, "vpn_activity") or ai_rule_enabled(rules, "source_ip_reputation")):
        return context
    try:
        from services.vpn_detection import detect_vpn
    except Exception:
        return context
    source_ip = context.get("source_ip") or context.get("client_ip") or context.get("ip_address")
    if not source_ip or str(source_ip).lower() == "unknown":
        return context
    vpn = detect_vpn(str(source_ip))
    context["vpn_detection"] = vpn
    context["vpn_detected"] = bool(vpn.get("is_vpn") or vpn.get("is_proxy"))
    context["vpn_activity"] = context.get("vpn_activity") or context["vpn_detected"]
    context["vpn_provider"] = vpn.get("provider")
    context["vpn_risk_score"] = vpn.get("risk_score")
    if vpn.get("risk_score"):
        context["ip_reputation_score"] = max(float(context.get("ip_reputation_score") or 0), float(vpn.get("risk_score") or 0))
    if vpn.get("signals"):
        context["vpn_signals"] = vpn.get("signals")
    return context


def enrich_file_ai_context(
    db: Session,
    file_entry: SecurityMonitoredFile,
    change_type: str,
    old_content: str,
    new_content: str,
    context: dict | None,
) -> dict:
    """Populate cheap rule inputs for scans; disabled rules avoid extra work."""
    context = dict(context or {})
    rules = context.get("ai_rules") or DEFAULT_AI_RULES
    ts = now_utc()
    path = Path(file_entry.relative_path or file_entry.file_path or "")
    old_text = old_content or ""
    new_text = new_content or ""

    if ai_rule_enabled(rules, "hour_of_day"):
        context.setdefault("hour_of_day", ts.hour)
    if ai_rule_enabled(rules, "day_of_week"):
        context.setdefault("day_of_week", ts.weekday())
    if ai_rule_enabled(rules, "business_hours"):
        cfg = ai_rule_config(rules, "business_hours")
        start = int(cfg.get("safe_start_hour", 8))
        end = int(cfg.get("safe_end_hour", 18))
        context.setdefault("business_hours", start <= ts.hour <= end and ts.weekday() < 5)
    if ai_rule_enabled(rules, "file_size_change"):
        context.setdefault("file_size_change", len(new_text.encode("utf-8")) - len(old_text.encode("utf-8")))
    if ai_rule_enabled(rules, "content_length"):
        context.setdefault("content_length", len(new_text))
    if ai_rule_enabled(rules, "special_chars_count"):
        context.setdefault("special_chars_count", sum(new_text.count(char) for char in ["<", ">", "&", '"', "'", "/", "\\"]))
    if ai_rule_enabled(rules, "file_type_risk"):
        high_risk = set(ai_rule_config(rules, "file_type_risk").get("high_risk_extensions", [".html", ".jsx", ".js", ".py"]))
        context.setdefault("file_type_risk", 1 if path.suffix.lower() in high_risk else 0)
    if ai_rule_enabled(rules, "content_similarity_score"):
        context.setdefault("content_similarity_score", difflib.SequenceMatcher(None, old_text, new_text).ratio())
    if ai_rule_enabled(rules, "sensitive_config_change"):
        cfg = ai_rule_config(rules, "sensitive_config_change")
        context.setdefault(
            "sensitive_config_change",
            path.suffix.lower() in set(cfg.get("extensions", [])) or path.name.lower() in {str(item).lower() for item in cfg.get("filenames", [])},
        )
    if ai_rule_enabled(rules, "backup_restore_activity"):
        keywords = [str(item).lower() for item in ai_rule_config(rules, "backup_restore_activity").get("path_keywords", [])]
        context.setdefault("backup_restore_activity", any(keyword in str(path).lower() for keyword in keywords))
    if ai_rule_enabled(rules, "mfa_configuration_change"):
        keywords = [str(item).lower() for item in ai_rule_config(rules, "mfa_configuration_change").get("path_keywords", [])]
        context.setdefault("mfa_configuration_change", any(keyword in str(path).lower() for keyword in keywords))
    if ai_rule_enabled(rules, "auth_system_modification"):
        keywords = [str(item).lower() for item in ai_rule_config(rules, "auth_system_modification").get("path_keywords", [])]
        context.setdefault("auth_system_modification", any(keyword in str(path).lower() for keyword in keywords))

    source_ip = context.get("source_ip") or context.get("client_ip") or context.get("ip_address")
    if ai_rule_enabled(rules, "ip_consistent") and source_ip and str(source_ip).lower() != "unknown":
        try:
            known_ip = (
                db.query(SecurityAdminFileChange)
                .filter(SecurityAdminFileChange.ip_address == str(source_ip))
                .filter(SecurityAdminFileChange.timestamp >= ts - timedelta(days=90))
                .first()
            )
            context.setdefault("ip_consistent", bool(known_ip))
        except Exception:
            pass

    if ai_rule_enabled(rules, "affected_files_count") or ai_rule_enabled(rules, "excessive_file_modifications"):
        try:
            window_minutes = int(ai_rule_config(rules, "affected_files_count").get("window_minutes", 30) or 30)
            recent_file_ids = (
                db.query(SecurityDetectionEvent.file_id)
                .filter(SecurityDetectionEvent.detected_at >= ts - timedelta(minutes=window_minutes))
                .filter(SecurityDetectionEvent.file_id.isnot(None))
                .limit(200)
                .all()
            )
            affected_count = len({row[0] for row in recent_file_ids if row and row[0] is not None} | {file_entry.id})
            context.setdefault("affected_files_count", affected_count)
            context.setdefault("modified_file_count", affected_count)
            context.setdefault("files_modified_in_window", affected_count)
        except Exception:
            pass

    if ai_rule_enabled(rules, "restore_frequency"):
        try:
            window_minutes = int(ai_rule_config(rules, "restore_frequency").get("window_minutes", 30) or 30)
            restore_count = (
                db.query(SecurityRecoveryEvent)
                .filter(SecurityRecoveryEvent.completed_at >= ts - timedelta(minutes=window_minutes))
                .count()
            )
            context.setdefault("restore_count", restore_count)
            context.setdefault("restores_in_window", restore_count)
        except Exception:
            pass

    if ai_rule_enabled(rules, "rapid_admin_actions"):
        try:
            action_count = (
                db.query(SecurityAdminFileChange)
                .filter(SecurityAdminFileChange.timestamp >= ts - timedelta(minutes=1))
                .count()
            )
            context.setdefault("admin_actions_per_minute", action_count)
            context.setdefault("privileged_actions_per_minute", action_count)
        except Exception:
            pass

    if ai_rule_enabled(rules, "admin_action_rarity"):
        state = load_ai_model_state()
        profile = state.get("behavioral_profile") or {}
        rarity = 0.0
        if profile:
            if path.suffix.lower() and path.suffix.lower() not in set(profile.get("common_extensions") or []):
                rarity += 0.35
            root = str(path.parts[0]) if path.parts else ""
            if root and root not in set(profile.get("common_roots") or []):
                rarity += 0.25
            if source_ip and profile.get("known_source_ips") and source_ip not in set(profile.get("known_source_ips") or []):
                rarity += 0.3
            normal_hours = set(profile.get("normal_hours") or [])
            if normal_hours and ts.hour not in normal_hours:
                rarity += 0.2
        context.setdefault("admin_action_rarity", min(1.0, rarity))
        context.setdefault("admin_action_rarity_score", min(1.0, rarity))

    return context


def record_context_detection(
    db: Session,
    *,
    target_name: str,
    actor: str,
    change_type: str,
    context: dict,
    force_flag: str | None = None,
) -> SecurityDetectionEvent | None:
    context = enrich_security_context(db, context)
    synthetic_content = json_dumps({
        "target": target_name,
        "actor": actor,
        "change_type": change_type,
        "context": {key: value for key, value in context.items() if key != "ai_rules"},
    })
    context.setdefault("admin_session_valid", change_type != "invalid_admin_session")
    context.setdefault("method_legitimate", change_type not in {"invalid_admin_session", "suspicious_login"})
    context.setdefault("business_hours", 8 <= now_utc().hour <= 18)
    context.setdefault("ai_rules", get_ai_rules(db))
    flags = content_flags(synthetic_content, context)
    if force_flag:
        flags.append(force_flag)
        flags = sorted(set(flags))
    prediction = ai_predict(Path(target_name), "", synthetic_content, context)
    if prediction.prediction == "normal" and not flags:
        return None
    classification = classify(change_type, prediction, flags, context)
    trigger_summary = build_trigger_summary(change_type, flags, {"added": [], "removed": [], "changed": []}, False, context.get("source_ip") or "unknown")
    detection = SecurityDetectionEvent(
        file_id=None,
        target_type=context.get("target_type") or "admin_session",
        target_name=target_name,
        actor=actor,
        change_type=change_type,
        old_hash=None,
        new_hash=sha256_text(synthetic_content),
        is_legitimate=False,
        admin_id=_valid_admin_id(db, context.get("admin_id")),
        ai_score=prediction.score,
        ai_prediction=prediction.prediction,
        confidence=prediction.confidence,
        severity_level=classification["severity_level"],
        cvss_score=classification["cvss_score"],
        nist_category=classification["nist_category"],
        enisa_threat_type=classification["enisa_threat_type"],
        trigger_summary=trigger_summary,
        accuracy_basis=prediction.basis,
        behavior_flags_json=json_dumps([BEHAVIOR_LABELS.get(flag, flag) for flag in flags]),
        changed_lines_json=json_dumps({"added": [], "removed": [], "changed": []}),
        context_json=json_dumps(context),
    )
    db.add(detection)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if "admin_id" in str(exc).lower() or "admins" in str(exc).lower():
            detection.admin_id = None
            db.add(detection)
            db.commit()
        else:
            raise
    db.refresh(detection)
    if "vpn_activity" in flags:
        create_system_alert(
            db,
            "vpn_risk",
            f"VPN/proxy risk for {actor} from {context.get('source_ip')}. Provider: {context.get('vpn_provider') or 'unknown'}. Detection #{detection.id}.",
            "medium",
            dedupe_key=f"Detection #{detection.id}",
        )
    if change_type == "invalid_admin_session":
        create_system_alert(
            db,
            "invalid_admin_session",
            f"Invalid admin session from {context.get('source_ip')}. Detection #{detection.id}.",
            "high",
            dedupe_key=f"Detection #{detection.id}",
        )
    return detection


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file_obj:
        for chunk in iter(lambda: file_obj.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def safe_rel(path: Path) -> str:
    resolved = path.resolve()
    try:
        return str(resolved.relative_to(MASTER_ROOT)).replace("\\", "/")
    except ValueError:
        return resolved.name


def relative_to_root(path: Path, root: Path) -> str:
    return str(path.resolve().relative_to(root.resolve())).replace("\\", "/")


def resolve_stored_path(raw_path: Path | str | None, base_root: Path = MASTER_ROOT) -> Path | None:
    if raw_path in {None, ""}:
        return None
    try:
        candidate = Path(raw_path).expanduser()
        if not candidate.is_absolute():
            candidate = (base_root / candidate).resolve(strict=False)
        else:
            candidate = candidate.resolve(strict=False)
        return candidate
    except Exception:
        return None


def stored_path_value(path: Path | str | None, base_root: Path = MASTER_ROOT) -> str | None:
    if path in {None, ""}:
        return None
    resolved = resolve_stored_path(path, base_root=base_root)
    if not resolved:
        return str(path).replace("\\", "/")
    try:
        rel = str(resolved.relative_to(base_root)).replace("\\", "/")
        return rel if rel != "." else str(resolved).replace("\\", "/")
    except ValueError:
        return str(resolved)


def is_vm1_file(file_entry: SecurityMonitoredFile) -> bool:
    folder = str(getattr(file_entry, "folder_root", None) or "")
    file_path = str(getattr(file_entry, "file_path", "") or "")
    return folder.startswith(VM1_FOLDER_ROOT_PREFIX) or file_path.startswith("vm1://")


def portable_monitored_path(file_entry: SecurityMonitoredFile) -> Path:
    original = Path(file_entry.file_path)
    relative = str(file_entry.relative_path or "").replace("\\", "/")
    parts = [part for part in relative.split("/") if part]
    if parts and parts[0] == EXTERNAL_MONITOR_PREFIX:
        return original
    if parts:
        root_name = parts[0]
        root = MONITORED_ROOTS.get(root_name)
        if root:
            candidate = root.joinpath(*parts[1:]).resolve(strict=False)
            return candidate
        return (MASTER_ROOT / Path(*parts)).resolve(strict=False)
    return original


def portable_root_name(file_entry: SecurityMonitoredFile) -> str | None:
    relative = str(file_entry.relative_path or "").replace("\\", "/")
    parts = [part for part in relative.split("/") if part]
    return parts[0] if parts and parts[0] in MONITORED_ROOTS else None


def normalized_path_key(path: Path | str) -> str:
    try:
        resolved = str(Path(path).expanduser().resolve(strict=False))
    except Exception:
        resolved = str(path)
    return resolved.lower() if os.name == "nt" else resolved


def is_retired_monitored_file(file_entry: SecurityMonitoredFile) -> bool:
    return (file_entry.status or "").lower() == MONITORING_REMOVED_STATUS


def active_monitored_files_query(db: Session):
    return db.query(SecurityMonitoredFile).filter(SecurityMonitoredFile.status != MONITORING_REMOVED_STATUS)


def path_relative_to_repo(path: Path) -> str | None:
    try:
        return str(path.resolve().relative_to(MASTER_ROOT.resolve())).replace("\\", "/")
    except ValueError:
        return None


def external_monitored_relative_path(path: Path, root: Path) -> str:
    suffix = hashlib.sha1(str(root.resolve()).encode("utf-8")).hexdigest()[:12]
    relative = relative_to_root(path, root)
    return f"{EXTERNAL_MONITOR_PREFIX}/{root.name}_{suffix}/{relative}"


def monitored_relative_path(path: Path, root: Path) -> str:
    repo_relative = path_relative_to_repo(path)
    if repo_relative:
        return repo_relative
    return external_monitored_relative_path(path, root)


def shared_monitored_folder_token(path: Path) -> str | None:
    return path_relative_to_repo(path)


def load_shared_monitored_folders() -> list[Path]:
    if not SHARED_MONITORED_FOLDERS_PATH.exists():
        return []
    try:
        payload = json_loads(SHARED_MONITORED_FOLDERS_PATH.read_text(encoding="utf-8"), {})
        items = payload.get("folders") or []
    except Exception:
        logger.exception("Failed to load shared monitored folders from '%s'.", SHARED_MONITORED_FOLDERS_PATH)
        return []
    folders: list[Path] = []
    seen: set[str] = set()
    for item in items:
        resolved = resolve_stored_path(item)
        if not resolved or not resolved.exists() or not resolved.is_dir():
            continue
        key = normalized_path_key(resolved)
        if key in seen:
            continue
        seen.add(key)
        folders.append(resolved)
    return folders


def save_shared_monitored_folders(paths: list[Path]) -> None:
    tokens = sorted({token for token in (shared_monitored_folder_token(path) for path in paths) if token})
    try:
        SHARED_MONITORED_FOLDERS_PATH.parent.mkdir(parents=True, exist_ok=True)
        SHARED_MONITORED_FOLDERS_PATH.write_text(
            json_dumps({"version": 1, "folders": tokens}),
            encoding="utf-8",
        )
    except OSError as exc:
        logger.warning("Could not write shared monitored folders to '%s': %s", SHARED_MONITORED_FOLDERS_PATH, exc)


def load_local_monitored_folders(db: Session) -> list[Path]:
    raw = get_setting(db, LOCAL_MONITORED_FOLDERS_SETTING, "[]")
    try:
        items = json_loads(raw, [])
    except Exception:
        items = []
    folders: list[Path] = []
    seen: set[str] = set()
    for item in items:
        resolved = resolve_stored_path(item)
        if not resolved or not resolved.exists() or not resolved.is_dir():
            continue
        key = normalized_path_key(resolved)
        if key in seen:
            continue
        seen.add(key)
        folders.append(resolved)
    return folders


def save_local_monitored_folders(db: Session, paths: list[Path], updated_by: str) -> None:
    values = sorted({stored_path_value(path) or str(path.resolve()) for path in paths})
    set_setting(db, LOCAL_MONITORED_FOLDERS_SETTING, json_dumps(values), updated_by)


def load_vm1_monitored_folders(db: Session) -> list[Path]:
    raw = get_setting(db, VM1_CUSTOM_MONITORED_FOLDERS_SETTING, "[]")
    try:
        items = json_loads(raw, [])
    except Exception:
        items = []
    folders: list[Path] = []
    seen: set[str] = set()
    for item in items:
        try:
            path = Path(item)
        except Exception:
            continue
        key = normalized_path_key(path)
        if key in seen:
            continue
        seen.add(key)
        folders.append(path)
    return folders


def save_vm1_monitored_folders(db: Session, paths: list[Path], updated_by: str) -> None:
    values = sorted({str(path) for path in paths})
    set_setting(db, VM1_CUSTOM_MONITORED_FOLDERS_SETTING, json_dumps(values), updated_by)


def configured_custom_monitored_folders(db: Session) -> list[Path]:
    folders: list[Path] = []
    seen: set[str] = set()
    for path in load_shared_monitored_folders() + load_local_monitored_folders(db):
        key = normalized_path_key(path)
        if key in seen:
            continue
        seen.add(key)
        folders.append(path)
    return folders


def monitored_folder_scope(path: Path) -> str:
    return "shared" if shared_monitored_folder_token(path) else "local"


def persist_configured_monitored_folder(db: Session, root: Path, updated_by: str) -> str:
    if shared_monitored_folder_token(root):
        paths = load_shared_monitored_folders()
        if normalized_path_key(root) not in {normalized_path_key(item) for item in paths}:
            paths.append(root)
            save_shared_monitored_folders(paths)
        return "shared"
    paths = load_local_monitored_folders(db)
    if normalized_path_key(root) not in {normalized_path_key(item) for item in paths}:
        paths.append(root)
        save_local_monitored_folders(db, paths, updated_by)
    return "local"


def remove_configured_monitored_folder(db: Session, root: Path, updated_by: str) -> str:
    if shared_monitored_folder_token(root):
        paths = [item for item in load_shared_monitored_folders() if normalized_path_key(item) != normalized_path_key(root)]
        save_shared_monitored_folders(paths)
        return "shared"
    paths = [item for item in load_local_monitored_folders(db) if normalized_path_key(item) != normalized_path_key(root)]
    save_local_monitored_folders(db, paths, updated_by)
    return "local"


def reassign_monitored_file_references(db: Session, source_id: int, target_id: int) -> None:
    db.query(SecurityDetectionEvent).filter(SecurityDetectionEvent.file_id == source_id).update(
        {SecurityDetectionEvent.file_id: target_id},
        synchronize_session=False,
    )
    db.query(SecurityRecoveryEvent).filter(SecurityRecoveryEvent.file_id == source_id).update(
        {SecurityRecoveryEvent.file_id: target_id},
        synchronize_session=False,
    )


def merge_monitored_file_entry(db: Session, source: SecurityMonitoredFile, target: SecurityMonitoredFile) -> SecurityMonitoredFile:
    if source.id == target.id:
        return target
    if not target.baseline_hash and source.baseline_hash:
        target.baseline_hash = source.baseline_hash
    if not target.current_hash and source.current_hash:
        target.current_hash = source.current_hash
    if not target.status and source.status:
        target.status = source.status
    if not target.file_type and source.file_type:
        target.file_type = source.file_type
    if not target.size_bytes and source.size_bytes:
        target.size_bytes = source.size_bytes
    reassign_monitored_file_references(db, source.id, target.id)
    db.add(target)
    db.delete(source)
    return target


def migrate_portable_monitored_files(db: Session) -> int:
    global _last_migrate_at
    changed = 0
    entries = db.query(SecurityMonitoredFile).order_by(SecurityMonitoredFile.id.asc()).all()
    by_path: dict[str, SecurityMonitoredFile] = {}
    by_relative: dict[str, SecurityMonitoredFile] = {}
    for entry in entries:
        # Strip legacy VM1_/CUSTOM_ prefixes from VM1 custom folder names
        folder_root = str(entry.folder_root or "")
        clean_root = _clean_folder_root(folder_root)
        if clean_root != folder_root:
            entry.folder_root = clean_root
            relative = str(entry.relative_path or "").replace("\\", "/")
            clean_rel = _clean_folder_root(relative)
            if clean_rel != relative:
                entry.relative_path = clean_rel
            file_path = str(entry.file_path or "")
            if "CUSTOM_" in file_path or "VM1_CUSTOM_" in file_path:
                new_path = file_path.replace("VM1_CUSTOM_", "", 1).replace("CUSTOM_", "", 1)
                # If cleaning creates a duplicate file_path, merge instead of updating
                dup = (
                    db.query(SecurityMonitoredFile)
                    .filter(SecurityMonitoredFile.file_path == new_path)
                    .filter(SecurityMonitoredFile.id != entry.id)
                    .first()
                )
                if dup:
                    merge_monitored_file_entry(db, entry, dup)
                    changed += 1
                    continue
                entry.file_path = new_path
            changed += 1
        if is_database_entry(entry):
            by_path[normalized_path_key(entry.file_path)] = entry
            continue
        # VM1 files are externally managed; never rewrite their paths or folder_root
        if is_vm1_file(entry):
            relative_key = str(entry.relative_path or "").replace("\\", "/").lower()
            db.add(entry)
            by_path[normalized_path_key(entry.file_path)] = entry
            if relative_key:
                by_relative[relative_key] = entry
            continue
        target_path = portable_monitored_path(entry)
        path_key = normalized_path_key(target_path)
        relative_key = str(entry.relative_path or "").replace("\\", "/").lower()
        root_name = portable_root_name(entry)
        existing = by_path.get(path_key) or (by_relative.get(relative_key) if relative_key else None)
        if existing and existing.id != entry.id:
            merge_monitored_file_entry(db, entry, existing)
            changed += 1
            continue
        conflict = (
            db.query(SecurityMonitoredFile)
            .filter(SecurityMonitoredFile.file_path == str(target_path), SecurityMonitoredFile.id != entry.id)
            .first()
        )
        if conflict:
            by_path[path_key] = merge_monitored_file_entry(db, entry, conflict)
            changed += 1
            continue
        if str(entry.file_path) != str(target_path):
            entry.file_path = str(target_path)
            changed += 1
        if root_name and entry.folder_root != root_name:
            entry.folder_root = root_name
            changed += 1
        db.add(entry)
        by_path[path_key] = entry
        if relative_key:
            by_relative[relative_key] = entry
    if changed:
        db.flush()
    _last_migrate_at = time.time()
    return changed


def dedupe_monitored_files_by_relative_path(db: Session) -> int:
    global _last_dedupe_at
    if time.time() - _last_dedupe_at < 300:
        return 0
    changed = 0
    rows = db.query(SecurityMonitoredFile).order_by(SecurityMonitoredFile.id.asc()).all()
    groups: dict[str, list[SecurityMonitoredFile]] = {}
    for row in rows:
        key = str(row.relative_path or "").replace("\\", "/").lower()
        if key:
            groups.setdefault(key, []).append(row)
    for items in groups.values():
        if len(items) <= 1:
            continue
        # Prefer VM1 files as canonical since they represent ground truth from VM1
        vm1_item = next((item for item in items if is_vm1_file(item)), None)
        local_existing = next((item for item in items if Path(item.file_path or "").exists()), None)
        canonical = vm1_item or local_existing or items[0]
        for item in items:
            if item.id != canonical.id:
                canonical = merge_monitored_file_entry(db, item, canonical)
                changed += 1
    if changed:
        db.flush()
    _last_dedupe_at = time.time()
    return changed


def migrate_portable_security_paths(db: Session) -> int:
    changed = 0
    for key in ("backup_location", "latest_backup_path"):
        setting = db.query(SecuritySetting).filter(SecuritySetting.key == key).first()
        if not setting or not setting.value:
            continue
        normalized = stored_path_value(setting.value)
        if normalized and setting.value != normalized:
            setting.value = normalized
            setting.updated_at = now_utc()
            setting.updated_by = "path_migration"
            db.add(setting)
            changed += 1
    for recovery in db.query(SecurityRecoveryEvent).all():
        normalized_backup = stored_path_value(recovery.backup_path) if recovery.backup_path else None
        normalized_quarantine = stored_path_value(recovery.quarantine_path) if recovery.quarantine_path else None
        if normalized_backup and recovery.backup_path != normalized_backup:
            recovery.backup_path = normalized_backup
            db.add(recovery)
            changed += 1
        if normalized_quarantine and recovery.quarantine_path != normalized_quarantine:
            recovery.quarantine_path = normalized_quarantine
            db.add(recovery)
            changed += 1
    for incident in db.query(SecurityIncident).all():
        quarantine_paths = json_loads(incident.quarantine_paths_json, [])
        if isinstance(quarantine_paths, str):
            quarantine_paths = [quarantine_paths]
        normalized_paths = [stored_path_value(item) or str(item).replace("\\", "/") for item in quarantine_paths]
        if quarantine_paths != normalized_paths:
            incident.quarantine_paths_json = json_dumps(normalized_paths)
            db.add(incident)
            changed += 1
    if changed:
        db.flush()
    return changed


def file_type(path: Path) -> str:
    return path.suffix.lower().lstrip(".") or "file"


def hmac_secret() -> str:
    value = os.getenv("BACKUP_INTEGRITY_SECRET") or os.getenv("DATA_HASH_SECRET")
    if not value:
        raise RuntimeError(
            "Missing required environment variable: BACKUP_INTEGRITY_SECRET or DATA_HASH_SECRET. "
            "Please ensure at least one is set in your .env file."
        )
    return value.strip()


def serialize_db_value(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, datetime):
        return {"__type": "datetime", "value": value.isoformat()}
    if isinstance(value, date):
        return {"__type": "date", "value": value.isoformat()}
    if isinstance(value, Decimal):
        return {"__type": "decimal", "value": str(value)}
    if isinstance(value, bytes):
        return {"__type": "bytes_hex", "value": value.hex()}
    return str(value)


def deserialize_db_value(value):
    if not isinstance(value, dict) or "__type" not in value:
        return value
    value_type = value.get("__type")
    raw_value = value.get("value")
    if raw_value is None:
        return None
    if value_type == "datetime":
        return datetime.fromisoformat(raw_value)
    if value_type == "date":
        return date.fromisoformat(raw_value)
    if value_type == "decimal":
        return Decimal(str(raw_value))
    if value_type == "bytes_hex":
        return bytes.fromhex(raw_value)
    return raw_value


def monitored_database_tables(db: Session) -> list[str]:
    inspector = inspect(db.bind)
    tables = []
    for table_name in sorted(inspector.get_table_names()):
        lowered = table_name.lower()
        if lowered in DATABASE_EXCLUDED_TABLES:
            continue
        if any(lowered.startswith(prefix) for prefix in DATABASE_EXCLUDED_PREFIXES):
            continue
        tables.append(table_name)
    return tables


def table_primary_key_columns(db: Session, table_name: str) -> list[str]:
    try:
        return inspect(db.bind).get_pk_constraint(table_name).get("constrained_columns") or []
    except Exception:
        return []


def database_backend_name(db: Session) -> str:
    return db.bind.url.get_backend_name() if db.bind is not None else "unknown"


def quote_identifier(identifier: str) -> str:
    return "`" + identifier.replace("`", "``") + "`"


def sql_string_literal(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "''") + "'"


def audit_trigger_name(table_name: str, action: str) -> str:
    digest = hashlib.sha1(f"{table_name}:{action}".encode("utf-8")).hexdigest()[:12]
    return f"{DATABASE_AUDIT_TRIGGER_PREFIX}_{action.lower()}_{digest}"


def ensure_database_audit_infrastructure(db: Session) -> None:
    if not database_backend_name(db).startswith("mysql"):
        return
    db.execute(text(
        f"""
        CREATE TABLE IF NOT EXISTS {quote_identifier(DATABASE_AUTH_TABLE)} (
            token VARCHAR(80) PRIMARY KEY,
            actor VARCHAR(255) NULL,
            context VARCHAR(255) NULL,
            issued_at DATETIME NOT NULL,
            expires_at DATETIME NOT NULL,
            INDEX idx_wards_security_auth_expires (expires_at)
        ) ENGINE=InnoDB
        """
    ))
    db.execute(text(
        f"""
        CREATE TABLE IF NOT EXISTS {quote_identifier(DATABASE_AUDIT_TABLE)} (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            table_name VARCHAR(128) NOT NULL,
            action VARCHAR(20) NOT NULL,
            auth_token VARCHAR(80) NULL,
            auth_actor VARCHAR(255) NULL,
            auth_context VARCHAR(255) NULL,
            source_ip VARCHAR(80) NULL,
            db_user VARCHAR(255) NULL,
            connection_id BIGINT NULL,
            changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_wards_security_audit_id (id),
            INDEX idx_wards_security_audit_changed_at (changed_at),
            INDEX idx_wards_security_audit_token (auth_token),
            INDEX idx_wards_security_audit_source_ip (source_ip)
        ) ENGINE=InnoDB
        """
    ))
    existing_columns = {
        row["COLUMN_NAME"]
        for row in db.execute(text(
            """
            SELECT COLUMN_NAME
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table_name
            """
        ), {"table_name": DATABASE_AUDIT_TABLE}).mappings().all()
    }
    for column_name, ddl in {
        "auth_token": "ADD COLUMN auth_token VARCHAR(80) NULL",
        "auth_actor": "ADD COLUMN auth_actor VARCHAR(255) NULL",
        "auth_context": "ADD COLUMN auth_context VARCHAR(255) NULL",
        "source_ip": "ADD COLUMN source_ip VARCHAR(80) NULL",
        "db_user": "ADD COLUMN db_user VARCHAR(255) NULL",
        "connection_id": "ADD COLUMN connection_id BIGINT NULL",
    }.items():
        if column_name not in existing_columns:
            db.execute(text(f"ALTER TABLE {quote_identifier(DATABASE_AUDIT_TABLE)} {ddl}"))
    db.commit()
    for table_name in monitored_database_tables(db):
        if table_name == DATABASE_AUDIT_TABLE:
            continue
        for action in ("INSERT", "UPDATE", "DELETE"):
            trigger_name = audit_trigger_name(table_name, action)
            db.execute(text(f"DROP TRIGGER IF EXISTS {quote_identifier(trigger_name)}"))
            db.execute(text(
                f"""
                CREATE TRIGGER {quote_identifier(trigger_name)}
                AFTER {action} ON {quote_identifier(table_name)}
                FOR EACH ROW
                INSERT INTO {quote_identifier(DATABASE_AUDIT_TABLE)}
                    (table_name, action, auth_token, auth_actor, auth_context, source_ip, db_user, connection_id)
                VALUES (
                    {sql_string_literal(table_name)},
                    {sql_string_literal(action)},
                    @wards_db_auth_token,
                    @wards_db_auth_actor,
                    @wards_db_auth_context,
                    SUBSTRING_INDEX(USER(), '@', -1),
                    USER(),
                    CONNECTION_ID()
                )
                """
            ))
    db.commit()


def drop_database_audit_triggers(db: Session) -> None:
    if not database_backend_name(db).startswith("mysql"):
        return
    for table_name in monitored_database_tables(db):
        if table_name == DATABASE_AUDIT_TABLE:
            continue
        for action in ("INSERT", "UPDATE", "DELETE"):
            db.execute(text(f"DROP TRIGGER IF EXISTS {quote_identifier(audit_trigger_name(table_name, action))}"))
    db.commit()


def clear_database_audit_log(db: Session) -> None:
    if not database_backend_name(db).startswith("mysql"):
        return
    ensure_database_audit_infrastructure(db)
    db.execute(text(f"DELETE FROM {quote_identifier(DATABASE_AUDIT_TABLE)}"))
    db.commit()


def latest_database_audit_id(db: Session) -> int:
    if not database_backend_name(db).startswith("mysql"):
        return 0
    if DATABASE_AUDIT_TABLE not in inspect(db.bind).get_table_names():
        return 0
    value = db.execute(text(f"SELECT COALESCE(MAX(id), 0) FROM {quote_identifier(DATABASE_AUDIT_TABLE)}")).scalar()
    return int(value or 0)


def database_audit_changes_since(db: Session, last_id: int) -> list[dict]:
    if not database_backend_name(db).startswith("mysql"):
        return []
    if DATABASE_AUDIT_TABLE not in inspect(db.bind).get_table_names():
        return []
    rows = db.execute(text(
        f"""
        SELECT table_name, action, COUNT(*) AS change_count, MAX(id) AS max_id, MAX(changed_at) AS latest_change,
               MAX(source_ip) AS source_ip, MAX(db_user) AS db_user, MAX(connection_id) AS connection_id
        FROM {quote_identifier(DATABASE_AUDIT_TABLE)}
        WHERE id > :last_id
        GROUP BY table_name, action
        ORDER BY max_id ASC
        """
    ), {"last_id": int(last_id or 0)}).mappings().all()
    return [
        {
            "table_name": row["table_name"],
            "action": row["action"],
            "change_count": int(row["change_count"] or 0),
            "max_id": int(row["max_id"] or 0),
            "latest_change": row["latest_change"].isoformat() if hasattr(row["latest_change"], "isoformat") else str(row["latest_change"]),
            "source_ip": row.get("source_ip"),
            "db_user": row.get("db_user"),
            "connection_id": int(row["connection_id"]) if row.get("connection_id") else None,
        }
        for row in rows
    ]


def unauthorized_database_audit_changes_since(db: Session, last_id: int) -> list[dict]:
    if not database_backend_name(db).startswith("mysql"):
        return []
    if DATABASE_AUDIT_TABLE not in inspect(db.bind).get_table_names():
        return []
    rows = db.execute(text(
        f"""
        SELECT
            audit.table_name,
            audit.action,
            audit.auth_token,
            audit.auth_actor,
            audit.auth_context,
            audit.source_ip,
            audit.db_user,
            audit.connection_id,
            COUNT(*) AS change_count,
            MAX(audit.id) AS max_id,
            MAX(audit.changed_at) AS latest_change
        FROM {quote_identifier(DATABASE_AUDIT_TABLE)} audit
        LEFT JOIN {quote_identifier(DATABASE_AUTH_TABLE)} auth
            ON audit.auth_token = auth.token
            AND audit.changed_at >= auth.issued_at
            AND audit.changed_at <= auth.expires_at
        WHERE audit.id > :last_id
          AND auth.token IS NULL
        GROUP BY audit.table_name, audit.action, audit.auth_token, audit.auth_actor, audit.auth_context, audit.source_ip, audit.db_user, audit.connection_id
        ORDER BY max_id ASC
        """
    ), {"last_id": int(last_id or 0)}).mappings().all()
    return [
        {
            "table_name": row["table_name"],
            "action": row["action"],
            "auth_token": row["auth_token"],
            "auth_actor": row["auth_actor"],
            "auth_context": row["auth_context"],
            "source_ip": row["source_ip"],
            "db_user": row["db_user"],
            "connection_id": int(row["connection_id"]) if row["connection_id"] else None,
            "change_count": int(row["change_count"] or 0),
            "max_id": int(row["max_id"] or 0),
            "latest_change": row["latest_change"].isoformat() if hasattr(row["latest_change"], "isoformat") else str(row["latest_change"]),
        }
        for row in rows
    ]


def prune_database_authorized_operations(db: Session) -> None:
    if not database_backend_name(db).startswith("mysql"):
        return
    if DATABASE_AUTH_TABLE not in inspect(db.bind).get_table_names():
        return
    db.execute(text(
        f"DELETE FROM {quote_identifier(DATABASE_AUTH_TABLE)} WHERE expires_at < (UTC_TIMESTAMP() - INTERVAL 1 DAY)"
    ))
    db.commit()


def create_database_checksum_manifest(db: Session, output_path: Path = DATABASE_CHECKSUM_PATH) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    manifest = {
        "snapshot_type": "wards_db_checksum_manifest",
        "database_url_driver": database_backend_name(db),
        "excluded_tables": sorted(DATABASE_EXCLUDED_TABLES),
        "excluded_prefixes": list(DATABASE_EXCLUDED_PREFIXES),
        "audit_last_id": latest_database_audit_id(db) if database_backend_name(db).startswith("mysql") else 0,
        "tables": {},
    }
    for table_name in monitored_database_tables(db):
        metadata = MetaData()
        table = Table(table_name, metadata, autoload_with=db.bind)
        columns = [column.name for column in table.columns]
        pk_columns = table_primary_key_columns(db, table_name)
        order_columns = [table.c[column] for column in (pk_columns or columns) if column in table.c]
        query = table.select()
        if order_columns:
            query = query.order_by(*order_columns)
        table_hash = hashlib.sha256()
        row_count = 0
        for row in db.execute(query).mappings():
            payload = {column: serialize_db_value(row.get(column)) for column in columns}
            table_hash.update(json_dumps(payload).encode("utf-8"))
            table_hash.update(b"\n")
            row_count += 1
        manifest["tables"][table_name] = {
            "columns": columns,
            "primary_key": pk_columns,
            "row_count": row_count,
            "table_hash": table_hash.hexdigest(),
        }
    output_path.write_text(json_dumps(manifest), encoding="utf-8")
    return output_path


def database_monitor_entries(db: Session) -> list[SecurityMonitoredFile]:
    checksum_name = DATABASE_CHECKSUM_PATH.name
    snapshot_name = DATABASE_SNAPSHOT_PATH.name
    return (
        db.query(SecurityMonitoredFile)
        .filter(
            or_(
                SecurityMonitoredFile.folder_root == "DATABASE",
                SecurityMonitoredFile.relative_path.in_([DATABASE_CHECKSUM_RELATIVE_PATH, DATABASE_BACKUP_RELATIVE_PATH]),
                SecurityMonitoredFile.file_path.like(f"%{checksum_name}"),
                SecurityMonitoredFile.file_path.like(f"%{snapshot_name}"),
            )
        )
        .order_by(SecurityMonitoredFile.id.asc())
        .all()
    )


def normalize_database_monitor_entry(
    db: Session,
    reset_baseline: bool = False,
    ensure_snapshot: bool = True,
) -> SecurityMonitoredFile:
    checksum_existed = DATABASE_CHECKSUM_PATH.exists()
    checksum_path = create_database_checksum_manifest(db)
    if ensure_snapshot or not DATABASE_SNAPSHOT_PATH.exists():
        create_database_snapshot(db, DATABASE_SNAPSHOT_PATH)
    checksum_hash = sha256_file(checksum_path)
    entries = database_monitor_entries(db)
    local_checksum_path = str(checksum_path)
    entry = next((item for item in entries if item.file_path == local_checksum_path), None)
    if entry is None:
        entry = next((item for item in entries if (item.folder_root or "").upper() == "DATABASE"), None)
    if entry is None:
        entry = entries[0] if entries else None

    if not entry:
        entry = SecurityMonitoredFile(
            file_path=local_checksum_path,
            relative_path=DATABASE_CHECKSUM_RELATIVE_PATH,
            folder_root="DATABASE",
            baseline_hash=checksum_hash,
            current_hash=checksum_hash,
            status="clean",
            file_type="json",
            size_bytes=checksum_path.stat().st_size,
        )
    else:
        entry.file_path = local_checksum_path
        entry.relative_path = DATABASE_CHECKSUM_RELATIVE_PATH
        entry.folder_root = "DATABASE"
        entry.file_type = "json"
        entry.current_hash = checksum_hash
        if reset_baseline or not checksum_existed or not entry.baseline_hash:
            entry.baseline_hash = checksum_hash
            entry.status = "clean"
        entry.size_bytes = checksum_path.stat().st_size
        entry.last_checked = now_utc()
    db.add(entry)
    db.flush()
    return entry


def activate_database_runtime_monitoring(db: Session, reset_baseline: bool = True) -> SecurityMonitoredFile | None:
    ensure_database_audit_infrastructure(db)
    clear_database_audit_log(db)
    entry = normalize_database_monitor_entry(db, reset_baseline=reset_baseline, ensure_snapshot=True)
    set_setting(db, "database_audit_last_id", str(latest_database_audit_id(db)), "database_monitor")
    set_setting(db, "database_monitor_started_at", now_utc().isoformat(), "database_monitor")
    set_setting(db, "database_runtime_monitoring", "active", "database_monitor")
    db.commit()
    return entry


def refresh_latest_database_backup_snapshot(db: Session, checksum_path: Path | None = None) -> None:
    backup_root = latest_backup_root(db)
    if not backup_root:
        return
    create_database_snapshot(db, backup_file_path(backup_root, DATABASE_BACKUP_RELATIVE_PATH))
    if checksum_path and checksum_path.exists():
        checksum_target = backup_file_path(backup_root, DATABASE_CHECKSUM_RELATIVE_PATH)
        checksum_target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(checksum_path, checksum_target)


def create_database_snapshot(db: Session, output_path: Path = DATABASE_SNAPSHOT_PATH) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    snapshot = {
        "snapshot_type": "wards_db_logical_snapshot",
        "database_url_driver": db.bind.url.get_backend_name() if db.bind is not None else "unknown",
        "excluded_tables": sorted(DATABASE_EXCLUDED_TABLES),
        "excluded_prefixes": list(DATABASE_EXCLUDED_PREFIXES),
        "tables": {},
    }
    for table_name in monitored_database_tables(db):
        metadata = MetaData()
        table = Table(table_name, metadata, autoload_with=db.bind)
        columns = [column.name for column in table.columns]
        pk_columns = table_primary_key_columns(db, table_name)
        order_columns = [table.c[column] for column in (pk_columns or columns) if column in table.c]
        query = table.select()
        if order_columns:
            query = query.order_by(*order_columns)
        rows = []
        for row in db.execute(query).mappings().all():
            rows.append({column: serialize_db_value(row.get(column)) for column in columns})
        snapshot["tables"][table_name] = {
            "columns": columns,
            "primary_key": pk_columns,
            "row_count": len(rows),
            "rows": rows,
        }
    output_path.write_text(json_dumps(snapshot), encoding="utf-8")
    return output_path


def restore_database_snapshot(db: Session, snapshot_path: Path) -> None:
    payload = json_loads(snapshot_path.read_text(encoding="utf-8"), {})
    tables = payload.get("tables") or {}
    metadata = MetaData()
    if db.bind.url.get_backend_name().startswith("mysql"):
        db.execute(text("SET FOREIGN_KEY_CHECKS=0"))
    elif db.bind.url.get_backend_name().startswith("sqlite"):
        db.execute(text("PRAGMA foreign_keys=OFF"))
    try:
        for table_name in reversed(list(tables.keys())):
            table = Table(table_name, metadata, autoload_with=db.bind)
            db.execute(table.delete())
        for table_name, table_payload in tables.items():
            rows = table_payload.get("rows") or []
            if not rows:
                continue
            table = Table(table_name, metadata, autoload_with=db.bind)
            decoded_rows = [
                {key: deserialize_db_value(value) for key, value in row.items()}
                for row in rows
            ]
            db.execute(table.insert(), decoded_rows)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        if db.bind.url.get_backend_name().startswith("mysql"):
            db.execute(text("SET FOREIGN_KEY_CHECKS=1"))
        elif db.bind.url.get_backend_name().startswith("sqlite"):
            db.execute(text("PRAGMA foreign_keys=ON"))


def is_database_entry(file_entry: SecurityMonitoredFile) -> bool:
    relative = (file_entry.relative_path or "").replace("\\", "/")
    file_name = Path(file_entry.file_path or "").name.lower()
    return (
        (file_entry.folder_root or "").upper() == "DATABASE"
        or relative in {DATABASE_CHECKSUM_RELATIVE_PATH, DATABASE_BACKUP_RELATIVE_PATH}
        or file_name in {DATABASE_CHECKSUM_PATH.name.lower(), DATABASE_SNAPSHOT_PATH.name.lower()}
    )


def is_monitorable(path: Path, root_path: Path | None = None) -> bool:
    if not path.is_file():
        return False
    lower_name = path.name.lower()
    if path.suffix.lower() not in MONITORED_SUFFIXES and lower_name not in MONITORED_SPECIAL_FILENAMES and not any(lower_name.endswith(item) for item in MONITORED_SPECIAL_NAME_SUFFIXES):
        return False
    parts = {part.lower() for part in path.parts}
    allowed_root_parts = {part.lower() for part in root_path.resolve().parts} if root_path else set()
    if (parts - allowed_root_parts).intersection({item.lower() for item in DEFAULT_EXCLUDED_DIRS}):
        return False
    return True


def iter_monitorable_files(roots: dict[str, Path] | None = None) -> Iterable[tuple[str, Path]]:
    roots = roots or MONITORED_ROOTS
    excluded = {item.lower() for item in DEFAULT_EXCLUDED_DIRS}
    for root_name, root_path in roots.items():
        if not root_path.exists():
            continue
        for current_root, dirnames, filenames in os.walk(root_path):
            dirnames[:] = [
                dirname for dirname in dirnames
                if dirname.lower() not in excluded and not dirname.startswith(".")
            ]
            current_path = Path(current_root)
            allowed_root_parts = {part.lower() for part in root_path.resolve().parts}
            if ({part.lower() for part in current_path.parts} - allowed_root_parts).intersection(excluded):
                continue
            for filename in filenames:
                path = current_path / filename
                if is_monitorable(path, root_path=root_path):
                    yield root_name, path.resolve()


def register_monitored_folder_entries(
    db: Session,
    root: Path,
    *,
    refresh_existing: bool = True,
    backup_root: Path | None = None,
) -> tuple[int, int, int]:
    created = 0
    backed_up = 0
    processed = 0
    roots = {root.name.upper(): root}
    for root_name, path in iter_monitorable_files(roots):
        processed += 1
        current_hash = sha256_file(path)
        relative = monitored_relative_path(path, root)
        matches = [
            item for item in (
                db.query(SecurityMonitoredFile)
                .filter(or_(SecurityMonitoredFile.file_path == str(path), SecurityMonitoredFile.relative_path == relative))
                .order_by(SecurityMonitoredFile.id.asc())
                .all()
            )
            if not is_vm1_file(item)
        ]
        existing = None
        if matches:
            path_key = normalized_path_key(path)
            existing = next((item for item in matches if normalized_path_key(item.file_path) == path_key), None) or matches[0]
            for duplicate in matches:
                if duplicate.id != existing.id:
                    existing = merge_monitored_file_entry(db, duplicate, existing)
        if existing:
            existing.file_path = str(path)
            existing.relative_path = relative
            existing.folder_root = root_name
            existing.file_type = file_type(path)
            existing.size_bytes = path.stat().st_size
            existing.last_checked = now_utc()
            if refresh_existing or is_retired_monitored_file(existing):
                existing.current_hash = current_hash
                existing.baseline_hash = existing.baseline_hash or current_hash
                existing.status = "clean"
            db.add(existing)
        else:
            db.add(
                SecurityMonitoredFile(
                    file_path=str(path),
                    relative_path=relative,
                    folder_root=root_name,
                    baseline_hash=current_hash,
                    current_hash=current_hash,
                    status="clean",
                    file_type=file_type(path),
                    size_bytes=path.stat().st_size,
                )
            )
            created += 1
        if backup_root:
            target = backup_file_path(backup_root, relative)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
            backed_up += 1
    return created, backed_up, processed


def sync_configured_monitored_folders(db: Session, refresh_existing: bool = True) -> int:
    created = 0
    for root in configured_custom_monitored_folders(db):
        if not root.exists() or not root.is_dir():
            continue
        folder_created, _, _ = register_monitored_folder_entries(db, root, refresh_existing=refresh_existing, backup_root=None)
        created += folder_created
    if created:
        dedupe_monitored_files_by_relative_path(db)
        db.commit()
    return created


def get_setting(db: Session, key: str, default: str) -> str:
    setting = db.query(SecuritySetting).filter(SecuritySetting.key == key).first()
    return setting.value if setting else default


def set_setting(db: Session, key: str, value: str, updated_by: str | None = None) -> SecuritySetting:
    setting = db.query(SecuritySetting).filter(SecuritySetting.key == key).first()
    if not setting:
        setting = SecuritySetting(key=key, value=value, updated_by=updated_by)
        db.add(setting)
    else:
        setting.value = value
        setting.updated_by = updated_by
        setting.updated_at = now_utc()
    db.commit()
    db.refresh(setting)
    return setting


def is_deployment_in_progress(db: Session) -> bool:
    setting = db.query(SecuritySetting).filter(SecuritySetting.key == "deployment_in_progress").first()
    if not setting or not setting.value or setting.value.lower() != "true":
        return False
    # Auto-clear stale deployment pause (> 30 minutes) so a failed webhook unpause
    # doesn't leave monitoring disabled forever.
    stale_threshold = 1800  # seconds
    if setting.updated_at and (now_utc() - setting.updated_at).total_seconds() > stale_threshold:
        logger.warning(
            "Deployment pause is stale (updated_at=%s, threshold=%ds). Auto-clearing.",
            setting.updated_at.isoformat(), stale_threshold,
        )
        set_deployment_mode(db, False, "stale_auto_clear")
        return False
    return True


def set_deployment_mode(db: Session, in_progress: bool, updated_by: str = "deploy") -> None:
    set_setting(db, "deployment_in_progress", "true" if in_progress else "false", updated_by)
    if in_progress:
        logger.info("Security monitoring paused — deployment in progress.")
    else:
        logger.info("Security monitoring resumed — deployment complete.")


def env_value(name: str, default: str) -> str:
    raw = os.getenv(name)
    return default if raw is None else str(raw).strip()


def sync_runtime_env_settings(db: Session, updated_by: str = "environment") -> dict[str, str]:
    env_mapped = {
        "deployment_mode": env_value("SECURITY_DEPLOYMENT_MODE", "development"),
        "monitoring_enabled": env_value("SECURITY_MONITORING_ENABLED", "false").lower(),
        "scan_interval_seconds": env_value("SECURITY_SCAN_INTERVAL_SECONDS", "30"),
        "wazuh_enabled": env_value("WAZUH_ENABLED", "false").lower(),
    }
    changed = False
    for key, value in env_mapped.items():
        current = db.query(SecuritySetting).filter(SecuritySetting.key == key).first()
        if current and str(current.value) == value:
            continue
        # Only overwrite settings that were last updated by "environment" or
        # that don't exist yet. This prevents multi-worker race conditions
        # where one worker's stale os.environ overwrites a user toggle.
        if current and (current.updated_by or "") != "environment":
            continue
        if current:
            current.value = value
            current.updated_by = updated_by
            current.updated_at = datetime.utcnow()
            db.add(current)
        else:
            db.add(SecuritySetting(key=key, value=value, updated_by=updated_by))
        changed = True
    if changed:
        db.commit()
    return env_mapped


def seed_settings(db: Session) -> None:
    defaults = {
        "backup_location": stored_path_value(DEFAULT_BACKUP_ROOT) or str(DEFAULT_BACKUP_ROOT),
        "latest_backup_path": "",
        LOCAL_MONITORED_FOLDERS_SETTING: "[]",
        VM1_CUSTOM_MONITORED_FOLDERS_SETTING: " []",
        "last_scan_at": "",
        "backup_schedule": json_dumps({"enabled": False, "frequency": "weekly", "next_run": ""}),
        "ai_retrain_schedule": json_dumps({"day": "Sunday", "time": "23:00", "next_run": next_weekday("Sunday", "23:00")}),
        "ai_last_retrained_at": "",
        "deployment_mode": os.getenv("SECURITY_DEPLOYMENT_MODE", "development"),
        "monitoring_enabled": os.getenv("SECURITY_MONITORING_ENABLED", "false").lower(),
        "scan_interval_seconds": os.getenv("SECURITY_SCAN_INTERVAL_SECONDS", "30"),
        "wazuh_enabled": os.getenv("WAZUH_ENABLED", "false").lower(),
        "ai_rules": json_dumps(DEFAULT_AI_RULES),
        "ai_sensitivity": os.getenv("AI_SENSITIVITY", "medium"),
    }
    changed = False
    for key, value in defaults.items():
        if not db.query(SecuritySetting).filter(SecuritySetting.key == key).first():
            db.add(SecuritySetting(key=key, value=value))
            changed = True
    changed = bool(migrate_portable_security_paths(db)) or changed
    if changed:
        db.commit()
    sync_runtime_env_settings(db)
    sync_configured_monitored_folders(db, refresh_existing=True)
    backup_location = writable_backup_location(db, "startup")
    prune_all_backup_types_across_locations(db, keep=BACKUP_RETENTION_LIMIT)
    refresh_backup_integrity_manifests(backup_location, force=False)
    try:
        sync_wazuh_monitored_folders(db)
    except Exception:
        logger.exception("Wazuh monitored-folder sync failed during security settings bootstrap.")


def get_ai_rules(db: Session) -> dict:
    saved = json_loads(get_setting(db, "ai_rules", json_dumps(DEFAULT_AI_RULES)), {})
    merged = {}
    approved = {**DEFAULT_AI_RULES, **APPROVED_ADDITIONAL_AI_RULES}
    for key, default in approved.items():
        current = saved.get(key, {}) if isinstance(saved, dict) else {}
        merged[key] = {
            **default,
            **current,
            "config": {**default.get("config", {}), **current.get("config", {})},
        }
    return merged


def ai_rule_enabled(rules: dict | None, rule_name: str) -> bool:
    rules = rules or DEFAULT_AI_RULES
    return bool(rules.get(rule_name, DEFAULT_AI_RULES.get(rule_name, {})).get("enabled", True))


def ai_rule_config(rules: dict | None, rule_name: str) -> dict:
    rules = rules or DEFAULT_AI_RULES
    default = DEFAULT_AI_RULES.get(rule_name, APPROVED_ADDITIONAL_AI_RULES.get(rule_name, {}))
    current = rules.get(rule_name, {}) if isinstance(rules, dict) else {}
    return {**default.get("config", {}), **current.get("config", {})}


def available_ai_rule_templates(db: Session) -> list[dict]:
    current = get_ai_rules(db)
    return [
        {"key": key, **value, "already_added": key in current}
        for key, value in APPROVED_ADDITIONAL_AI_RULES.items()
    ]


def add_ai_rule(db: Session, rule_key: str, updated_by: str) -> dict:
    if rule_key not in APPROVED_ADDITIONAL_AI_RULES:
        raise ValueError("Choose a rule from the approved defacement rule list.")
    merged = get_ai_rules(db)
    if rule_key in merged:
        return merged
    merged[rule_key] = APPROVED_ADDITIONAL_AI_RULES[rule_key]
    set_setting(db, "ai_rules", json_dumps(merged), updated_by)
    return merged


def update_ai_rules(db: Session, rules: dict, updated_by: str) -> dict:
    merged = get_ai_rules(db)
    for key, value in (rules or {}).items():
        if key not in merged or not isinstance(value, dict):
            continue
        if "enabled" in value:
            enabled_val = value["enabled"]
            if isinstance(enabled_val, str):
                merged[key]["enabled"] = enabled_val.lower() not in ("false", "0", "off", "no", "", "disabled")
            else:
                merged[key]["enabled"] = bool(enabled_val)
        if "weight" in value:
            merged[key]["weight"] = max(0.0, min(2.0, float(value["weight"])))
        if "config" in value and isinstance(value["config"], dict):
            merged[key]["config"] = {**merged[key].get("config", {}), **value["config"]}
    set_setting(db, "ai_rules", json_dumps(merged), updated_by)
    return merged


def get_ai_sensitivity(db: Session) -> str:
    return get_setting(db, "ai_sensitivity", "medium")


def set_ai_sensitivity(db: Session, sensitivity: str, updated_by: str) -> str:
    valid_levels = ["low", "medium", "high", "very_high"]
    if sensitivity not in valid_levels:
        raise ValueError(f"Invalid sensitivity level. Must be one of: {', '.join(valid_levels)}")
    set_setting(db, "ai_sensitivity", sensitivity, updated_by)
    return sensitivity


def next_weekday(day_name: str, time_value: str) -> str:
    names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    target_day = names.index(day_name)
    hour, minute = [int(part) for part in time_value.split(":", 1)]
    base = now_utc().replace(hour=hour, minute=minute, second=0, microsecond=0)
    days_ahead = (target_day - base.weekday()) % 7
    candidate = base + timedelta(days=days_ahead)
    if candidate <= now_utc():
        candidate += timedelta(days=7)
    return candidate.isoformat()


def latest_backup_root(db: Session) -> Path | None:
    raw = get_setting(db, "latest_backup_path", "")
    if raw:
        path = resolve_stored_path(raw)
        if path.exists():
            return path
    backups = all_backup_roots(db)
    if backups:
        set_setting(db, "latest_backup_path", stored_path_value(backups[0]) or str(backups[0]), "backup_location_fallback")
        return backups[0]
    set_setting(db, "latest_backup_path", "", "backup_location_fallback")
    return None


def backup_folder_sort_key(path: Path) -> tuple[datetime, float, str]:
    timestamp_text = path.name.split("_backup_", 1)[1] if "_backup_" in path.name else path.name
    try:
        timestamp = datetime.strptime(timestamp_text[:15], "%Y%m%d_%H%M%S")
    except Exception:
        timestamp = datetime.min
    try:
        mtime = path.stat().st_mtime
    except OSError:
        mtime = 0.0
    return (timestamp, mtime, str(path))


def all_backup_roots(db: Session) -> list[Path]:
    locations_to_check = backup_locations_to_check(db)
    backups: list[Path] = []
    for location in locations_to_check:
        if location.exists() and location.is_dir():
            backups.extend([item for item in location.iterdir() if item.is_dir()])
    result = sorted(set(backups), key=backup_folder_sort_key, reverse=True)
    logger.info("all_backup_roots found %s backup(s) in %s", len(result), [str(p) for p in locations_to_check])
    return result


def backup_locations_to_check(db: Session) -> list[Path]:
    locations_to_check = []
    configured = resolve_stored_path(get_setting(db, "backup_location", ""))
    if configured:
        locations_to_check.append(configured.resolve(strict=False))
    fallback = DEFAULT_BACKUP_ROOT.resolve()
    if fallback not in locations_to_check:
        locations_to_check.append(fallback)
    return locations_to_check


def backup_file_path(backup_root: Path, relative_path: str) -> Path:
    return backup_root / relative_path.replace("/", os.sep)


def writable_backup_location(db: Session, updated_by: str = "system") -> Path:
    configured = resolve_stored_path(get_setting(db, "backup_location", stored_path_value(DEFAULT_BACKUP_ROOT) or str(DEFAULT_BACKUP_ROOT))) or DEFAULT_BACKUP_ROOT.resolve()
    fallback = DEFAULT_BACKUP_ROOT.resolve()
    configured_resolved = configured.resolve(strict=False)
    candidates = [configured_resolved] if configured_resolved.exists() or configured_resolved == fallback else []
    candidates.append(fallback)
    for candidate in candidates:
        try:
            target = validate_backup_destination(candidate, create=True)
            portable_target = stored_path_value(target) or str(target)
            current_value = get_setting(db, "backup_location", stored_path_value(DEFAULT_BACKUP_ROOT) or str(DEFAULT_BACKUP_ROOT))
            if portable_target != current_value:
                set_setting(db, "backup_location", portable_target, updated_by)
            return target
        except (OSError, ValueError):
            continue
    try:
        fallback.mkdir(parents=True, exist_ok=True)
        set_setting(db, "backup_location", stored_path_value(fallback) or str(fallback), updated_by)
        return fallback
    except (OSError, ValueError):
        # Last resort: use /tmp for backups if the default is not writable
        tmp_fallback = Path("/tmp/wards_backups")
        tmp_fallback.mkdir(parents=True, exist_ok=True)
        set_setting(db, "backup_location", str(tmp_fallback), updated_by)
        return tmp_fallback


def validate_backup_destination(raw_path: Path | str, create: bool = True) -> Path:
    target = Path(raw_path).expanduser()
    if not target.is_absolute():
        raise ValueError("Backup location must use an absolute filesystem path.")
    resolved = target.resolve(strict=False)
    if resolved.exists() and not resolved.is_dir():
        raise ValueError("Backup location must be a folder, not a file.")
    if create:
        resolved.mkdir(parents=True, exist_ok=True)
    probe = resolved / ".wards_backup_write_test"
    try:
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
    except Exception as exc:
        raise ValueError(f"Backup location is not writable: {resolved}") from exc
    return resolved


def copy_into_backup(source: Path, target: Path, previous_source: Path | None = None, can_reuse_previous: bool = False) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if can_reuse_previous and previous_source and previous_source.exists():
        try:
            os.link(previous_source, target)
            return
        except Exception:
            try:
                shutil.copy2(previous_source, target)
                return
            except Exception:
                pass
    shutil.copy2(source, target)


def relative_backup_path(path: Path, backup_root: Path) -> str:
    return str(path.relative_to(backup_root)).replace("\\", "/")


def iter_model_artifact_paths() -> list[Path]:
    paths = [
        MODEL_STATE_PATH,
        MODEL_METADATA_PATH,
        IFOREST_META_PATH,
        IFOREST_MODEL_PATH,
    ]
    return [path for path in paths if path.exists() and path.is_file()]


def model_backup_relative_path(path: Path) -> str:
    if path.name in {IFOREST_META_PATH.name, IFOREST_MODEL_PATH.name}:
        return f"{ML_MODELS_RELATIVE_BACKUP_DIR}/{path.name}"
    return f"{MODEL_RELATIVE_BACKUP_DIR}/{path.name}"


def backup_ml_artifacts(
    backup_root: Path,
    manifest_files: list[dict[str, object]],
    previous_backup_root: Path | None = None,
    previous_manifest: dict[str, dict[str, object]] | None = None,
) -> int:
    previous_manifest = previous_manifest or {}
    copied = 0
    for path in iter_model_artifact_paths():
        relative = model_backup_relative_path(path)
        target = backup_file_path(backup_root, relative)
        try:
            file_hash = sha256_file(path)
            size_bytes = path.stat().st_size
        except OSError as exc:
            logger.warning("Skipping ML artifact that disappeared during backup: %s (%s)", path, exc)
            continue
        previous_source = backup_file_path(previous_backup_root, relative) if previous_backup_root else None
        previous_matches = bool(previous_source and previous_source.exists() and str(previous_manifest.get(relative, {}).get("sha256") or "") == file_hash)
        copy_into_backup(
            path,
            target,
            previous_source=previous_source,
            can_reuse_previous=previous_matches,
        )
        manifest_files.append({
            "path": relative,
            "size_bytes": size_bytes,
            "sha256": file_hash,
        })
        copied += 1
    return copied


def restore_ml_artifacts_from_backup(db: Session) -> int:
    backup_root = newest_valid_backup_for_domain(db, RECOVERY_DOMAIN_ML)
    if not backup_root:
        return 0
    restored = 0
    for destination in (
        MODEL_STATE_PATH,
        MODEL_METADATA_PATH,
        IFOREST_META_PATH,
        IFOREST_MODEL_PATH,
    ):
        source = backup_file_path(backup_root, model_backup_relative_path(destination))
        if not source.exists() or not source.is_file():
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        restored += 1
    global _ml_model_cache
    _ml_model_cache = {"model": None, "mtime": 0.0}
    return restored


def backup_manifest_index(backup_root: Path | None) -> dict[str, dict[str, object]]:
    if not backup_root:
        return {}
    manifest_path = backup_root / BACKUP_MANIFEST_NAME
    if not manifest_path.exists() or not manifest_path.is_file():
        return {}
    try:
        payload = json_loads(manifest_path.read_text(encoding="utf-8"), {})
    except Exception:
        return {}
    if not isinstance(payload, dict):
        return {}
    if not verify_backup_manifest_hmac(payload):
        logger.warning("Backup manifest HMAC verification failed for '%s'.", manifest_path)
        return {}
    files = payload.get("files")
    if not isinstance(files, list):
        return {}
    manifest: dict[str, dict[str, object]] = {}
    for item in files:
        if not isinstance(item, dict):
            continue
        relative = str(item.get("path") or "").replace("\\", "/")
        file_hash = str(item.get("sha256") or "")
        if not relative or not file_hash:
            continue
        manifest[relative] = {
            "sha256": file_hash,
            "size_bytes": int(item.get("size_bytes") or 0),
            "domain": str(item.get("domain") or recovery_domain_for_relative_path(relative)),
        }
    return manifest


def verify_backup_manifest_hmac(payload: dict) -> bool:
    expected = str(payload.get("manifest_hmac_sha256") or "")
    if not expected:
        return False
    unsigned = {key: value for key, value in payload.items() if key != "manifest_hmac_sha256"}
    encoded = json.dumps(unsigned, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    actual = hmac.new(hmac_secret().encode("utf-8"), encoded.encode("utf-8"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(actual, expected)


def recovery_domain_for_relative_path(relative: str) -> str:
    normalized = str(relative or "").replace("\\", "/")
    lower = normalized.lower()
    if normalized in {DATABASE_BACKUP_RELATIVE_PATH, DATABASE_CHECKSUM_RELATIVE_PATH}:
        return RECOVERY_DOMAIN_VM2_DATABASE
    if lower.startswith("security/ml/") or lower.startswith("security/ml_models/"):
        return RECOVERY_DOMAIN_ML
    return RECOVERY_DOMAIN_FILES


def add_manifest_file(manifest_files: list[dict[str, object]], path: str, source: Path, domain: str | None = None, file_hash: str | None = None) -> None:
    manifest_files.append({
        "path": str(path).replace("\\", "/"),
        "size_bytes": source.stat().st_size,
        "sha256": file_hash or sha256_file(source),
        "domain": domain or recovery_domain_for_relative_path(path),
        "version": "1",
    })


def manifest_domains(manifest: dict[str, dict[str, object]]) -> set[str]:
    return {str(item.get("domain") or recovery_domain_for_relative_path(path)) for path, item in manifest.items()}


def backup_root_has_valid_domain(backup_root: Path, domain: str) -> bool:
    manifest = backup_manifest_index(backup_root)
    if not manifest:
        return False
    has_domain_file = False
    for relative, meta in manifest.items():
        item_domain = str(meta.get("domain") or recovery_domain_for_relative_path(relative))
        if item_domain != domain:
            continue
        source = backup_file_path(backup_root, relative)
        if not source.exists() or not source.is_file():
            return False
        try:
            if int(meta.get("size_bytes") or 0) != source.stat().st_size:
                return False
            if sha256_file(source) != str(meta.get("sha256") or ""):
                return False
        except OSError:
            return False
        has_domain_file = True
    return has_domain_file


def newest_valid_backup_for_domain(db: Session, domain: str) -> Path | None:
    for root in all_backup_roots(db):
        if backup_root_has_valid_domain(root, domain):
            return root
    return None


def newest_valid_backup_for_path(db: Session, relative: str, expected_hash: str | None = None) -> tuple[Path | None, Path | None]:
    normalized = str(relative or "").replace("\\", "/")
    for root in all_backup_roots(db):
        manifest = backup_manifest_index(root)
        meta = manifest.get(normalized)
        if not meta:
            continue
        source = backup_file_path(root, normalized)
        if not source.exists() or not source.is_file():
            continue
        try:
            source_hash = sha256_file(source)
            if source_hash != str(meta.get("sha256") or ""):
                continue
            if int(meta.get("size_bytes") or 0) != source.stat().st_size:
                continue
            if expected_hash and source_hash != expected_hash:
                continue
            return source, root
        except OSError:
            continue
    return None, None


def write_backup_manifest(backup_root: Path, files: list[dict[str, object]] | None = None) -> Path:
    backup_root.mkdir(parents=True, exist_ok=True)
    manifest_files = list(files) if files is not None else []
    if files is None:
        for path in sorted(backup_root.rglob("*")):
            if not path.is_file() or path.name == BACKUP_MANIFEST_NAME:
                continue
            relative = relative_backup_path(path, backup_root)
            manifest_files.append({
                "path": relative,
                "size_bytes": path.stat().st_size,
                "sha256": sha256_file(path),
                "domain": recovery_domain_for_relative_path(relative),
                "version": "1",
            })
    else:
        normalized_files = []
        for item in manifest_files:
            relative = str(item.get("path") or "").replace("\\", "/")
            if not relative:
                continue
            normalized = dict(item)
            normalized["path"] = relative
            normalized.setdefault("domain", recovery_domain_for_relative_path(relative))
            normalized.setdefault("version", "1")
            normalized_files.append(normalized)
        manifest_files = normalized_files
    manifest_files.sort(key=lambda item: str(item.get("path") or ""))
    domains = sorted({str(item.get("domain") or recovery_domain_for_relative_path(str(item.get("path") or ""))) for item in manifest_files})
    payload = {
        "manifest_type": "wards_backup_integrity_manifest",
        "backup_root": stored_path_value(backup_root) or str(backup_root),
        "generated_at": now_utc().isoformat(),
        "recovery_domains": domains,
        "backup_type": backup_root.name.split("_backup_", 1)[0] if "_backup_" in backup_root.name else "unknown",
        "files": manifest_files,
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    payload["manifest_hmac_sha256"] = hmac.new(hmac_secret().encode("utf-8"), encoded.encode("utf-8"), hashlib.sha256).hexdigest()
    manifest_path = backup_root / BACKUP_MANIFEST_NAME
    manifest_path.write_text(json_dumps(payload), encoding="utf-8")
    return manifest_path


def refresh_backup_entry(db: Session, file_entry: SecurityMonitoredFile, backup_root: Path | None = None) -> Path:
    backup_root = backup_root or latest_backup_root(db)
    if not backup_root:
        raise RuntimeError("No local backup exists. Create a manual backup first.")
    path = portable_monitored_path(file_entry)
    relative = file_entry.relative_path or safe_rel(path)
    if is_database_entry(file_entry):
        checksum_path = create_database_checksum_manifest(db, path)
        snapshot_target = backup_file_path(backup_root, DATABASE_BACKUP_RELATIVE_PATH)
        create_database_snapshot(db, snapshot_target)
        checksum_target = backup_file_path(backup_root, DATABASE_CHECKSUM_RELATIVE_PATH)
        checksum_target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(checksum_path, checksum_target)
    else:
        if not path.exists() or not path.is_file():
            raise FileNotFoundError(f"File not found for backup refresh: {relative}")
        target = backup_file_path(backup_root, relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
    write_backup_manifest(backup_root)
    return backup_root


def refresh_backup_integrity_manifests(backup_location: Path, force: bool = True) -> int:
    if not backup_location.exists():
        return 0
    updated = 0
    for backup_root in backup_location.iterdir():
        if not backup_root.is_dir():
            continue
        try:
            if not force and (backup_root / BACKUP_MANIFEST_NAME).exists():
                continue
            write_backup_manifest(backup_root)
            updated += 1
        except Exception:
            continue
    return updated


def is_completed_backup_folder(path: Path) -> bool:
    return path.is_dir() and "_backup_" in path.name and (path / BACKUP_MANIFEST_NAME).exists()


def list_completed_backups(backup_location: Path, label: str | None = None) -> list[Path]:
    if not backup_location.exists():
        return []
    backups = []
    for item in backup_location.iterdir():
        if not is_completed_backup_folder(item):
            continue
        if label and not item.name.startswith(f"{label}_backup_"):
            continue
        backups.append(item)
    return sorted(backups, key=lambda item: item.name)


def list_all_backup_folders(backup_location: Path, label: str | None = None) -> list[Path]:
    """List every backup folder (completed or not) for retention enforcement."""
    if not backup_location.exists():
        return []
    backups = []
    for item in backup_location.iterdir():
        if not item.is_dir() or "_backup_" not in item.name:
            continue
        if label and not item.name.startswith(f"{label}_backup_"):
            continue
        backups.append(item)
    return sorted(backups, key=lambda item: item.name)


def list_backup_inventory(db: Session) -> dict:
    try:
        prune_all_backup_types_across_locations(db, keep=BACKUP_RETENTION_LIMIT)
    except Exception:
        logger.exception("Backup inventory retention pruning failed; continuing inventory load.")
    roots = all_backup_roots(db)

    # Pre-load manifests once per root to avoid redundant disk I/O.
    # backup_manifest_index() reads the file, verifies HMAC, and parses JSON.
    root_manifests: dict[Path, dict[str, dict[str, object]]] = {}
    root_manifest_payloads: dict[Path, dict] = {}
    root_manifest_valid: dict[Path, bool] = {}
    root_domains: dict[Path, set[str]] = {}

    for root in roots:
        manifest_path = root / BACKUP_MANIFEST_NAME
        manifest_payload = {}
        manifest_valid = False
        if manifest_path.exists() and manifest_path.is_file():
            try:
                manifest_payload = json_loads(manifest_path.read_text(encoding="utf-8"), {})
                manifest_valid = isinstance(manifest_payload, dict) and verify_backup_manifest_hmac(manifest_payload)
            except OSError:
                manifest_payload = {}
        root_manifest_payloads[root] = manifest_payload
        root_manifest_valid[root] = manifest_valid
        manifest = backup_manifest_index(root)
        root_manifests[root] = manifest
        root_domains[root] = manifest_domains(manifest) if manifest else set()

    # Compute latest by domain from cached data (skip expensive per-file SHA256 re-validation).
    # For inventory display, a backup is valid for a domain if its manifest lists files for that domain.
    latest_by_domain: dict[str, Path] = {}
    for domain in RECOVERY_DOMAINS:
        for root in roots:
            if domain in root_domains.get(root, set()):
                latest_by_domain[domain] = root
                break

    items = []
    for root in roots:
        manifest = root_manifests.get(root, {})
        domains = sorted(root_domains.get(root, set()))
        # Lightweight domain check for inventory display (skip expensive SHA256 re-computation).
        domain_validity = {domain: domain in root_domains.get(root, set()) for domain in domains}
        latest_domains = [
            domain
            for domain, latest_root in latest_by_domain.items()
            if latest_root and latest_root.resolve(strict=False) == root.resolve(strict=False)
        ]
        timestamp = None
        if "_backup_" in root.name:
            timestamp_text = root.name.rsplit("_backup_", 1)[-1]
            try:
                timestamp = datetime.strptime(timestamp_text[:15], "%Y%m%d_%H%M%S").isoformat()
            except Exception:
                timestamp = None
        manifest_payload = root_manifest_payloads.get(root, {})
        items.append({
            "filename": root.name,
            "label": root.name.split("_backup_", 1)[0] if "_backup_" in root.name else "unknown",
            "timestamp": timestamp,
            "path": stored_path_value(root) or str(root),
            "backup_type": manifest_payload.get("backup_type") if isinstance(manifest_payload, dict) else None,
            "manifest_valid": root_manifest_valid.get(root, False),
            "domains": domains,
            "domain_validity": domain_validity,
            "latest_domains": latest_domains,
            "is_latest": bool(latest_domains),
            "file_count": len(manifest),
            "size_bytes": sum(int(meta.get("size_bytes") or 0) for meta in manifest.values()),
        })
    return {
        "backup_locations": sorted({str(root.parent) for root in roots}),
        "domains": RECOVERY_DOMAINS,
        "latest_by_domain": {
            domain: (stored_path_value(root) or str(root)) if root else None
            for domain, root in latest_by_domain.items()
        },
        "items": items,
    }


def prune_backup_type(backup_location: Path, label: str, keep: int = BACKUP_RETENTION_LIMIT) -> int:
    removed = 0
    for old_backup in list_all_backup_folders(backup_location, label=label)[:-keep]:
        try:
            shutil.rmtree(old_backup)
            removed += 1
            logger.info("Removed old backup '%s' during FIFO retention enforcement.", old_backup)
        except Exception:
            logger.exception("Failed to remove old backup '%s'.", old_backup)
    return removed


def prune_backup_type_across_locations(db: Session, label: str, keep: int = BACKUP_RETENTION_LIMIT) -> int:
    backups: list[Path] = []
    for location in backup_locations_to_check(db):
        backups.extend(list_all_backup_folders(location, label=label))
    removed = 0
    for old_backup in sorted(set(backups), key=backup_folder_sort_key)[:-keep]:
        try:
            shutil.rmtree(old_backup)
            removed += 1
            logger.info("Removed old backup '%s' during cross-location retention enforcement.", old_backup)
        except Exception:
            logger.exception("Failed to remove old backup '%s'.", old_backup)
    return removed


def prune_all_backup_types(backup_location: Path, keep: int = BACKUP_RETENTION_LIMIT) -> int:
    removed = 0
    try:
        labels = {
            item.name.split("_backup_", 1)[0]
            for item in backup_location.iterdir()
            if item.is_dir() and "_backup_" in item.name
        }
        for label in labels:
            removed += prune_backup_type(backup_location, label, keep=keep)
    except Exception:
        logger.exception("Backup retention scan failed for '%s'.", backup_location)
    return removed


def prune_all_backup_types_across_locations(db: Session, keep: int = BACKUP_RETENTION_LIMIT) -> int:
    labels = set()
    for location in backup_locations_to_check(db):
        try:
            labels.update(
                item.name.split("_backup_", 1)[0]
                for item in location.iterdir()
                if item.is_dir() and "_backup_" in item.name
            )
        except Exception:
            logger.exception("Backup retention label scan failed for '%s'.", location)
    return sum(prune_backup_type_across_locations(db, label, keep=keep) for label in labels)


def register_initial_files(db: Session, ensure_backup: bool = True, refresh_existing: bool = True, incremental: bool = False) -> int:
    seed_settings(db)
    migrate_portable_monitored_files(db)
    dedupe_monitored_files_by_relative_path(db)
    created = 0
    if incremental:
        for file_entry in active_monitored_files_query(db).all():
            if is_database_entry(file_entry) or is_vm1_file(file_entry):
                continue
            path = portable_monitored_path(file_entry)
            if path.exists():
                stat = path.stat()
                if refresh_existing:
                    current_hash = sha256_file(path)
                    file_entry.current_hash = current_hash
                    file_entry.baseline_hash = file_entry.baseline_hash or current_hash
                    file_entry.status = "clean" if file_entry.baseline_hash == current_hash else file_entry.status
                    file_entry.size_bytes = stat.st_size
                    file_entry.last_checked = datetime.utcfromtimestamp(stat.st_mtime)
                else:
                    pass
                file_entry.file_type = file_type(path)
                db.add(file_entry)
    else:
        for root_name, path in iter_monitorable_files():
            relative = safe_rel(path)
            matches = [
                item for item in (
                    db.query(SecurityMonitoredFile)
                    .filter(or_(SecurityMonitoredFile.file_path == str(path), SecurityMonitoredFile.relative_path == relative))
                    .order_by(SecurityMonitoredFile.id.asc())
                    .all()
                )
                if not is_vm1_file(item)
            ]
            existing = None
            if matches:
                path_key = normalized_path_key(path)
                existing = next((item for item in matches if normalized_path_key(item.file_path) == path_key), None) or matches[0]
                for duplicate in matches:
                    if duplicate.id != existing.id:
                        existing = merge_monitored_file_entry(db, duplicate, existing)
            if existing:
                existing.file_path = str(path)
                existing.relative_path = relative
                existing.folder_root = root_name
                existing.file_type = file_type(path)
                if refresh_existing:
                    current_hash = sha256_file(path)
                    existing.current_hash = current_hash
                    existing.baseline_hash = existing.baseline_hash or current_hash
                    existing.status = "clean" if existing.baseline_hash == current_hash else existing.status
                    existing.size_bytes = path.stat().st_size
                    existing.last_checked = datetime.utcfromtimestamp(path.stat().st_mtime)
                else:
                    pass
                db.add(existing)
                continue
            current_hash = sha256_file(path)
            db.add(
                SecurityMonitoredFile(
                    file_path=str(path),
                    relative_path=relative,
                    folder_root=root_name,
                    baseline_hash=current_hash,
                    current_hash=current_hash,
                    status="clean",
                    file_type=file_type(path),
                    size_bytes=path.stat().st_size,
                    last_checked=None,
                )
            )
            created += 1
    try:
        had_database_entry = bool(database_monitor_entries(db))
        normalize_database_monitor_entry(db, reset_baseline=refresh_existing, ensure_snapshot=True)
        if not had_database_entry:
            created += 1
    except Exception:
        pass
    dedupe_monitored_files_by_relative_path(db)
    db.commit()
    if ensure_backup and not latest_backup_root(db):
        create_manual_backup(db, initiated_by=None, label="initial")
    return created


def generate_initial_training_samples(sample_count: int = 640) -> list[dict]:
    rng = random.Random(42)
    samples = []
    for _ in range(sample_count):
        hour = rng.randint(8, 17)
        samples.append(
            {
                "hour_of_day": hour,
                "day_of_week": rng.randint(0, 4),
                "session_duration": rng.randint(120, 7200),
                "file_size_change": rng.randint(-180, 260),
                "content_length": rng.randint(200, 12000),
                "special_chars_count": rng.randint(4, 200),
                "admin_session_valid": 1,
                "mfa_verified": 1,
                "ip_consistent": 1,
                "source_ip_reputation": 0,
                "keystroke_dynamics": 0,
                "method_legitimate": 1,
                "business_hours": 1,
                "file_type_risk": rng.choice([0, 1, 1, 2]),
                "suspicious_pattern_score": 0,
                "vpn_activity": 0,
                "first_time_device": 0,
                "first_time_country": 0,
                "geo_distance_from_last_login": 0,
                "unauthorized_admin_path": 0,
                "sensitive_config_change": 0,
                "backup_restore_activity": 0,
                "mfa_configuration_change": 0,
                "auth_system_modification": 0,
                "admin_action_rarity": 0,
                "restore_frequency": 0,
                "backup_integrity_validation": 1,
                "content_similarity_score": 1,
                "affected_files_count": 0,
            }
        )
    return samples


def load_initial_training_samples(path: Path = INITIAL_TRAINING_SAMPLES_PATH) -> list[dict]:
    if not path.exists() or not path.is_file():
        return generate_initial_training_samples()
    samples: list[dict] = []
    with path.open("r", encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            sample: dict[str, object] = {}
            for key, value in row.items():
                if key == "label":
                    sample[key] = value
                    continue
                try:
                    sample[key] = float(value)
                except (TypeError, ValueError):
                    sample[key] = value
            sample.setdefault("source_ip", "seeded_admin_profile")
            sample.setdefault("file_path", "WARDS/backend/routes/security_dashboard.py")
            samples.append(sample)
    return samples


def behavioral_profile_from_logs(logs: list[dict]) -> dict:
    hours = sorted({int(log.get("hour_of_day")) for log in logs if log.get("hour_of_day") is not None})
    weekdays = sorted({int(log.get("day_of_week")) for log in logs if log.get("day_of_week") is not None})
    extensions = sorted({
        Path(str(log.get("file_path") or "")).suffix.lower()
        for log in logs
        if Path(str(log.get("file_path") or "")).suffix
    })
    roots = sorted({
        Path(str(log.get("file_path") or "")).parts[0]
        for log in logs
        if Path(str(log.get("file_path") or "")).parts
    })
    source_ips = sorted({
        str(log.get("source_ip"))
        for log in logs
        if log.get("source_ip")
    })
    return {
        "sample_count": len(logs),
        "normal_hours": hours,
        "normal_weekdays": weekdays,
        "common_extensions": extensions,
        "common_roots": roots,
        "known_source_ips": source_ips,
    }


def build_behavioral_profile(admin_changes: list[SecurityAdminFileChange]) -> dict:
    hours = sorted({change.timestamp.hour for change in admin_changes if change.timestamp})
    weekdays = sorted({change.timestamp.weekday() for change in admin_changes if change.timestamp})
    extensions = sorted({
        Path(change.file_path).suffix.lower()
        for change in admin_changes
        if change.file_path and Path(change.file_path).suffix
    })
    roots = sorted({
        safe_rel(Path(change.file_path)).split("/", 1)[0]
        for change in admin_changes
        if change.file_path
    })
    source_ips = sorted({
        change.ip_address
        for change in admin_changes
        if change.ip_address and change.ip_address not in {"unknown", "127.0.0.1"}
    })
    return {
        "sample_count": len(admin_changes),
        "normal_hours": hours,
        "normal_weekdays": weekdays,
        "common_extensions": extensions,
        "common_roots": roots,
        "known_source_ips": source_ips,
    }


FEATURE_NAMES = [
    "hour",
    "weekday",
    "business_hours",
    "ip_hash",
    "ip_consistent",
    "vpn_activity",
    "source_ip_reputation",
    "session_duration",
    "admin_session_valid",
    "mfa_verified",
    "method_legitimate",
    "keystroke_dynamics",
    "ext_hash",
    "file_size_change",
    "content_length",
    "special_chars_count",
    "file_type_risk",
    "first_time_device",
    "first_time_country",
    "geo_distance",
    "unauthorized_admin_path",
    "sensitive_config_change",
    "backup_restore_activity",
    "mfa_configuration_change",
    "auth_system_modification",
    "admin_action_rarity",
    "restore_frequency",
    "affected_files_count",
]


def _hash_enc(value, mod: int) -> int:
    if not value or mod <= 0:
        return 0
    digest = hashlib.sha256(str(value).encode("utf-8", errors="ignore")).hexdigest()
    return int(digest[:12], 16) % mod


def first_present(mapping: dict | None, *keys: str, default=None):
    """Return the first non-None value so valid zeroes do not fall through."""
    mapping = mapping or {}
    for key in keys:
        value = mapping.get(key)
        if value is not None:
            return value
    return default


def build_feature_vector(log: dict) -> list[float]:
    """Convert one security/admin event into the stable 28-feature ML vector."""
    log = log or {}

    def safe_int(x, default=0):
        try:
            return int(x)
        except (TypeError, ValueError):
            return default

    def safe_float(x, default=0.0):
        try:
            value = float(x)
            if math.isnan(value) or math.isinf(value):
                return default
            return value
        except (TypeError, ValueError):
            return default

    hour = safe_int(log.get("hour_of_day") if log.get("hour_of_day") is not None else log.get("hour"))
    weekday = safe_int(log.get("day_of_week") if log.get("day_of_week") is not None else log.get("weekday"))
    business_hours = 1 if (8 <= hour <= 18 and weekday < 5) else 0
    source_ip = log.get("source_ip") or log.get("client_ip") or log.get("ip_address") or ""
    file_path = log.get("file_path") or log.get("target_name") or ""
    path_obj = Path(str(file_path)) if file_path else Path("unknown")
    source_ip_reputation = safe_float(first_present(log, "source_ip_reputation", "ip_reputation_score", default=0.0))
    geo_distance = safe_float(first_present(log, "geo_distance_from_last_login", "geo_distance_from_last_login_km", "geo_distance_km", default=0.0))

    return [
        float(hour),
        float(weekday),
        float(business_hours),
        float(_hash_enc(source_ip, 1000)),
        1.0 if log.get("ip_consistent") else 0.0,
        1.0 if log.get("vpn_activity") or log.get("vpn_detected") else 0.0,
        source_ip_reputation,
        float(safe_int(log.get("session_duration"))),
        1.0 if log.get("admin_session_valid") else 0.0,
        1.0 if log.get("mfa_verified") else 0.0,
        1.0 if log.get("method_legitimate") else 0.0,
        safe_float(first_present(log, "keystroke_dynamics", "keystroke_anomaly_confidence", default=0.0)),
        float(_hash_enc(path_obj.suffix.lower(), 100)),
        float(safe_int(log.get("file_size_change"))),
        float(safe_int(log.get("content_length"))),
        float(safe_int(log.get("special_chars_count"))),
        float(safe_int(log.get("file_type_risk"))),
        1.0 if log.get("first_time_device") or log.get("new_device") or log.get("device_seen_before") is False else 0.0,
        1.0 if log.get("first_time_country") or log.get("new_country") or log.get("country_seen_before") is False else 0.0,
        geo_distance,
        1.0 if log.get("unauthorized_admin_path") else 0.0,
        1.0 if log.get("sensitive_config_change") else 0.0,
        1.0 if log.get("backup_restore_activity") else 0.0,
        1.0 if log.get("mfa_configuration_change") else 0.0,
        1.0 if log.get("auth_system_modification") else 0.0,
        safe_float(first_present(log, "admin_action_rarity", "admin_action_rarity_score", default=0.0)),
        float(safe_int(first_present(log, "restore_frequency", "restores_in_window", "restore_count", default=0))),
        float(safe_int(first_present(log, "affected_files_count", "modified_file_count", "files_modified_in_window", default=0))),
    ]


def train_isolation_forest(logs: list[dict]) -> object | None:
    """Train and persist the real Isolation Forest model, if dependencies/data are available."""
    if not _NUMPY_AVAILABLE or not _SKLEARN_AVAILABLE or not _JOBLIB_AVAILABLE:
        logger.warning("numpy/sklearn/joblib unavailable; skipping Isolation Forest training.")
        return None
    if len(logs) < MIN_ML_TRAINING_SAMPLES:
        logger.info("Need >= %s samples for ML; have %s.", MIN_ML_TRAINING_SAMPLES, len(logs))
        return None

    X = np.array([build_feature_vector(log) for log in logs], dtype=float)
    if not np.isfinite(X).all():
        logger.warning("Isolation Forest training data contained NaN/Inf; sanitizing invalid values to zero.")
        X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)
    non_zero = ~(X == 0).all(axis=1)
    X = X[non_zero]
    if len(X) < MIN_ML_TRAINING_SAMPLES:
        logger.info("Not enough non-zero samples after filtering.")
        return None

    contamination = min(0.1, max(0.01, 5.0 / len(X)))
    model = IsolationForest(
        n_estimators=100,
        contamination=contamination,
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X)

    ML_MODELS_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, IFOREST_MODEL_PATH)
    meta = {
        "algorithm": "IsolationForest",
        "version": now_utc().strftime("iforest-v%Y%m%d%H%M%S"),
        "trained_at": now_utc().isoformat(),
        "sample_count": int(len(X)),
        "contamination": float(contamination),
        "n_estimators": 100,
        "feature_count": int(X.shape[1]),
        "features": FEATURE_NAMES,
        "model_path": stored_path_value(IFOREST_MODEL_PATH) or str(IFOREST_MODEL_PATH),
    }
    IFOREST_META_PATH.write_text(json_dumps(meta), encoding="utf-8")

    global _ml_model_cache
    try:
        model_mtime = IFOREST_MODEL_PATH.stat().st_mtime
    except OSError:
        model_mtime = 0.0
    _ml_model_cache = {"model": model, "mtime": model_mtime}
    logger.info("Isolation Forest trained on %s samples.", len(X))
    return model


_ml_model_cache = {"model": None, "mtime": 0.0}
_ml_model_lock = threading.Lock()


def _get_cached_model():
    if not _JOBLIB_AVAILABLE or not IFOREST_MODEL_PATH.exists():
        return None
    try:
        mtime = IFOREST_MODEL_PATH.stat().st_mtime
    except OSError as exc:
        logger.warning("ML model disappeared before cache load: %s", exc)
        _ml_model_cache["model"] = None
        _ml_model_cache["mtime"] = 0.0
        return None
    with _ml_model_lock:
        if _ml_model_cache["model"] is None or mtime > float(_ml_model_cache.get("mtime") or 0.0):
            try:
                _ml_model_cache["model"] = joblib.load(IFOREST_MODEL_PATH)
                _ml_model_cache["mtime"] = mtime
            except Exception as exc:
                logger.warning("Failed to load ML model: %s", exc)
                _ml_model_cache["model"] = None
                _ml_model_cache["mtime"] = 0.0
        return _ml_model_cache["model"]


def ml_anomaly_score(log: dict) -> float:
    """Return Isolation Forest anomaly risk in [0.0, 1.0]. Missing model means no ML risk."""
    if not _NUMPY_AVAILABLE or not _SKLEARN_AVAILABLE or not _JOBLIB_AVAILABLE or not IFOREST_MODEL_PATH.exists():
        return 0.0
    try:
        model = _get_cached_model()
    except OSError as exc:
        logger.warning("ML model cache lookup failed during filesystem race: %s", exc)
        return 0.0
    if model is None:
        return 0.0

    try:
        x = np.array([build_feature_vector(log)], dtype=float)
        if hasattr(model, "n_features_in_") and int(model.n_features_in_) != int(x.shape[1]):
            logger.warning("ML model feature mismatch: model=%s input=%s", model.n_features_in_, x.shape[1])
            return 0.0
        pred = model.predict(x)[0]
        raw = float(model.decision_function(x)[0])
    except Exception as exc:
        logger.warning("ML inference failed: %s", exc)
        return 0.0

    if pred == -1:
        risk = min(1.0, 0.6 + abs(raw) * 0.8)
    else:
        risk = max(0.0, 0.4 - raw * 0.8)
    return round(float(risk), 4)


def behavioral_score_from_profile(context: dict, profile: dict, rules: dict | None = None) -> tuple[float, list[str], bool]:
    """Compute learned-profile risk additions for hour, weekday, file type, and source IP."""
    context = context or {}
    rules = rules or DEFAULT_AI_RULES

    def enabled(rule_name: str) -> bool:
        return bool(rules.get(rule_name, {}).get("enabled", True))

    def weight(rule_name: str, fallback: float) -> float:
        try:
            return float(rules.get(rule_name, {}).get("weight", fallback))
        except Exception:
            return fallback

    sample_count = int(profile.get("sample_count") or 0)
    if sample_count < 3:
        return 0.0, [], False

    learned_notes: list[str] = []
    learned_warning = False
    risk = 0.0
    current_hour = int(context.get("hour_of_day") if context.get("hour_of_day") is not None else now_utc().hour)
    current_weekday = int(context.get("day_of_week") if context.get("day_of_week") is not None else now_utc().weekday())
    file_path = context.get("file_path") or ""
    suffix = Path(str(file_path)).suffix.lower() if file_path else ""
    source_ip = context.get("source_ip") or context.get("client_ip") or context.get("ip_address")

    normal_hours = set(profile.get("normal_hours") or [])
    if enabled("hour_of_day") and normal_hours and current_hour not in normal_hours:
        risk += weight("hour_of_day", 0.08)
        learned_warning = True
        learned_notes.append(f"hour {current_hour} outside learned hours")

    normal_weekdays = set(profile.get("normal_weekdays") or [])
    if enabled("day_of_week") and normal_weekdays and current_weekday not in normal_weekdays:
        risk += weight("day_of_week", 0.05)
        learned_warning = True
        learned_notes.append(f"weekday {current_weekday} outside learned weekdays")

    common_extensions = set(profile.get("common_extensions") or [])
    if enabled("file_type_risk") and common_extensions and suffix and suffix not in common_extensions:
        risk += min(weight("file_type_risk", 0.07), 0.1)
        learned_warning = True
        learned_notes.append(f"{suffix} outside learned file types")

    known_source_ips = set(profile.get("known_source_ips") or [])
    if enabled("ip_consistent") and source_ip and known_source_ips and source_ip not in known_source_ips:
        risk += weight("ip_consistent", 0.08)
        learned_warning = True
        learned_notes.append("source IP outside learned admin profile")

    return risk, learned_notes, learned_warning


def compute_profile_confidence(profile: dict) -> float:
    """Measure how much the model/profile should influence final predictions."""
    profile = profile or {}
    try:
        sample_count = int(profile.get("sample_count") or 0)
    except (TypeError, ValueError):
        sample_count = 0
    sample_score = min(sample_count / 50.0, 1.0)
    coverage_parts = [
        bool(profile.get("normal_hours")),
        bool(profile.get("normal_weekdays")),
        bool(profile.get("common_extensions")),
        bool(profile.get("known_source_ips")),
    ]
    coverage_score = sum(1 for part in coverage_parts if part) / len(coverage_parts)
    freshness_score = 0.0
    try:
        if IFOREST_MODEL_PATH.exists():
            age_hours = max(0.0, (time.time() - IFOREST_MODEL_PATH.stat().st_mtime) / 3600.0)
            freshness_score = max(0.0, 1.0 - (age_hours / (14 * 24)))
    except OSError:
        freshness_score = 0.0
    confidence = (sample_score * 0.5) + (coverage_score * 0.3) + (freshness_score * 0.2)
    return round(max(0.0, min(1.0, confidence)), 4)


def load_ai_model_state() -> dict:
    if not MODEL_STATE_PATH.exists():
        return {}
    try:
        return json_loads(MODEL_STATE_PATH.read_text(encoding="utf-8"), {})
    except Exception:
        return {}


def load_ai_model_metadata() -> dict:
    if not MODEL_METADATA_PATH.exists():
        return {}
    try:
        return json_loads(MODEL_METADATA_PATH.read_text(encoding="utf-8"), {})
    except Exception:
        return {}


def load_isolation_forest_metadata() -> dict:
    try:
        if not IFOREST_META_PATH.exists():
            return {}
        return json_loads(IFOREST_META_PATH.read_text(encoding="utf-8"), {})
    except OSError:
        return {}


def retrain_ai(db: Session, initiated_by: str = "system") -> dict:
    now = now_utc()
    admin_cutoff = now - timedelta(days=90)
    detection_cutoff = now - timedelta(days=30)
    admin_changes = (
        db.query(SecurityAdminFileChange)
        .filter(SecurityAdminFileChange.timestamp >= admin_cutoff)
        .order_by(SecurityAdminFileChange.timestamp.desc())
        .limit(2000)
        .all()
    )
    detections = (
        db.query(SecurityDetectionEvent)
        .filter(SecurityDetectionEvent.detected_at >= detection_cutoff)
        .order_by(SecurityDetectionEvent.detected_at.desc())
        .limit(500)
        .all()
    )

    logs: list[dict] = []
    for change in admin_changes:
        timestamp = change.timestamp or now
        path = Path(change.file_path or "")
        try:
            length = path.stat().st_size if path.exists() else 0
        except OSError:
            length = 0
        file_path_text = str(change.file_path or "")
        user_agent = str(change.user_agent or "").lower()
        high_risk_ext = path.suffix.lower() in {".py", ".js", ".jsx", ".html", ".css", ".json", ".env", ".yml", ".yaml", ".xml"}
        logs.append(
            {
                "hour_of_day": timestamp.hour,
                "day_of_week": timestamp.weekday(),
                "source_ip": change.ip_address,
                "file_path": change.file_path,
                "change_type": change.change_type,
                "session_duration": 1800,
                "content_length": length,
                "file_size_change": length,
                "special_chars_count": 0,
                "admin_session_valid": 1,
                "mfa_verified": 1,
                "ip_consistent": bool(change.ip_address),
                "source_ip_reputation": 0.0,
                "keystroke_dynamics": 0.0,
                "method_legitimate": 1,
                "business_hours": 1 if 8 <= timestamp.hour <= 18 and timestamp.weekday() < 5 else 0,
                "file_type_risk": 1 if high_risk_ext else 0,
                "vpn_activity": 1 if "vpn" in user_agent or "proxy" in user_agent else 0,
                "first_time_device": 0,
                "first_time_country": 0,
                "geo_distance_from_last_login": 0.0,
                "unauthorized_admin_path": 0,
                "sensitive_config_change": 1 if path.suffix.lower() in {".env", ".xml", ".yml", ".yaml", ".sql"} or path.name.lower() in {"requirements.txt", "package.json"} else 0,
                "backup_restore_activity": 1 if any(keyword in file_path_text.lower() for keyword in ("backup", "restore", "recovery", "quarantine")) else 0,
                "mfa_configuration_change": 1 if any(keyword in file_path_text.lower() for keyword in ("mfa", "authenticator", "two_factor", "2fa")) else 0,
                "auth_system_modification": 1 if any(keyword in file_path_text.lower() for keyword in ("auth", "login", "jwt", "token", "password", "session", "middleware")) else 0,
                "admin_action_rarity": 0.0,
                "restore_frequency": 0,
                "affected_files_count": 1,
            }
        )

    for detection in detections:
        timestamp = detection.detected_at or now
        context = json_loads(detection.context_json, {})
        if not isinstance(context, dict):
            context = {}
        flags = json_loads(detection.behavior_flags_json, [])
        flag_text = " ".join(str(flag).lower() for flag in flags) if isinstance(flags, list) else ""
        log = {
            **context,
            "hour_of_day": context.get("hour_of_day") if context.get("hour_of_day") is not None else timestamp.hour,
            "day_of_week": context.get("day_of_week") if context.get("day_of_week") is not None else timestamp.weekday(),
            "file_path": context.get("file_path") or detection.target_name,
            "target_name": detection.target_name,
            "source_ip": context.get("source_ip") or context.get("client_ip") or context.get("ip_address"),
            "content_length": first_present(context, "content_length", default=len(detection.changed_lines_json or "")),
            "admin_session_valid": context.get("admin_session_valid", detection.change_type != "invalid_admin_session"),
            "method_legitimate": context.get("method_legitimate", bool(detection.is_legitimate)),
            "mfa_verified": context.get("mfa_verified", False),
            "file_type_risk": 1 if str(detection.target_name or "").lower().endswith((".py", ".js", ".jsx", ".html", ".css", ".json", ".env", ".yml", ".yaml", ".xml")) else 0,
            "unauthorized_admin_path": "unauthorized" in flag_text,
            "sensitive_config_change": "sensitive" in flag_text,
            "backup_restore_activity": "backup" in flag_text or "restore" in flag_text,
            "mfa_configuration_change": "mfa" in flag_text,
            "auth_system_modification": "auth" in flag_text,
            "admin_action_rarity": float(detection.ai_score or 0.0),
            "affected_files_count": first_present(context, "affected_files_count", "modified_file_count", default=0),
        }
        logs.append(log)

    training_error = None
    try:
        ml_model = train_isolation_forest(logs)
    except Exception as exc:
        logger.exception("ML training failed; continuing with existing rules/profile state: %s", exc)
        training_error = str(exc)
        ml_model = None
    ml_meta = load_isolation_forest_metadata()
    MODEL_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    version = now.strftime("v%Y%m%d%H%M%S")
    profile = build_behavioral_profile(admin_changes)
    state = {
        "algorithm": "Hybrid Rules + Behavioral Profile + Isolation Forest",
        "strategy": "Rules-based detection fused with learned admin profile and capped-window Isolation Forest retraining",
        "normal_samples": len(logs),
        "historical_admin_samples": len(admin_changes),
        "detection_samples": len(detections),
        "features": FEATURE_NAMES,
        "behavioral_profile": profile,
        "updated_at": now.isoformat(),
        "updated_by": initiated_by,
        "version": version,
        "note": "Uses recent validated admin behavior plus recent security detections; falls back to rules/profile if the ML artifact is missing.",
        "report": {
            "admin_window_days": 90,
            "detection_window_days": 30,
            "admin_sample_cap": 2000,
            "detection_sample_cap": 500,
            "training_log_count": len(logs),
            "ml_training_available": bool(_NUMPY_AVAILABLE and _SKLEARN_AVAILABLE and _JOBLIB_AVAILABLE),
            "ml_model_trained": bool(ml_model),
            "ml_model_path": stored_path_value(IFOREST_MODEL_PATH) if IFOREST_MODEL_PATH.exists() else None,
            "ml_sample_count": ml_meta.get("sample_count", 0),
            "profile_confidence": compute_profile_confidence(profile),
            "ml_training_error": training_error,
        },
    }
    metadata = {
        "model_name": "wards_hybrid_ai_security_model",
        "version": version,
        "trained_at": state["updated_at"],
        "model_type": state["algorithm"],
        "feature_set": state["features"],
        "training_parameters": {
            "strategy": state["strategy"],
            "bootstrap_samples": 0,
            "historical_admin_samples": len(admin_changes),
            "detection_samples": len(detections),
            "ml_model_trained": bool(ml_model),
        },
        "state_path": stored_path_value(MODEL_STATE_PATH) or str(MODEL_STATE_PATH),
        "isolation_forest": ml_meta,
    }
    try:
        MODEL_STATE_PATH.write_text(json_dumps(state), encoding="utf-8")
        MODEL_METADATA_PATH.write_text(json_dumps(metadata), encoding="utf-8")
    except OSError as exc:
        logger.exception("AI state persistence failed after retraining attempt: %s", exc)
        state["report"]["persistence_error"] = str(exc)
        return state
    # Update baseline hashes for model artifacts so they aren't flagged as unauthorized changes
    for artifact_path in iter_model_artifact_paths():
        try:
            rel = str(artifact_path.relative_to(MASTER_ROOT)).replace("\\", "/")
        except ValueError:
            continue
        entry = db.query(SecurityMonitoredFile).filter(SecurityMonitoredFile.relative_path == rel).first()
        if entry:
            try:
                artifact_hash = sha256_file(artifact_path)
            except OSError as exc:
                logger.warning("Skipping ML artifact hash refresh; artifact disappeared: %s (%s)", artifact_path, exc)
                continue
            entry.current_hash = artifact_hash
            entry.baseline_hash = artifact_hash
            entry.status = "clean"
            entry.last_checked = now_utc()
            db.add(entry)
    db.commit()
    set_setting(db, "ai_last_retrained_at", state["updated_at"], initiated_by)
    set_setting(db, "ai_training_sample_count", str(len(logs)), initiated_by)
    set_setting(db, "ai_model_version", version, initiated_by)
    return state


def seed_initial_ai_training(db: Session, initiated_by: str = "system", force: bool = False) -> dict:
    if not force and (get_setting(db, "ai_initial_training_seeded", "false") or "false").lower() == "true":
        state = load_ai_model_state()
        return {
            "status": "skipped",
            "reason": "initial training samples were already seeded",
            "state": state,
        }

    now = now_utc()
    logs = load_initial_training_samples()
    ml_model = None
    training_error = None
    try:
        ml_model = train_isolation_forest(logs)
    except Exception as exc:
        logger.exception("Initial AI seed training failed: %s", exc)
        training_error = str(exc)
    ml_meta = load_isolation_forest_metadata()
    profile = behavioral_profile_from_logs(logs)
    version = now.strftime("seed-v%Y%m%d%H%M%S")
    state = {
        "algorithm": "Hybrid Rules + Behavioral Profile + Isolation Forest",
        "strategy": "One-time bootstrap from SECURITY/ml/initial_training_samples.csv plus future incremental retraining from admin and detection history",
        "normal_samples": len(logs),
        "historical_admin_samples": 0,
        "detection_samples": 0,
        "features": FEATURE_NAMES,
        "behavioral_profile": profile,
        "updated_at": now.isoformat(),
        "updated_by": initiated_by,
        "version": version,
        "note": "Seeded baseline; future retraining should use production admin-change and detection history.",
        "report": {
            "seed_path": stored_path_value(INITIAL_TRAINING_SAMPLES_PATH) or str(INITIAL_TRAINING_SAMPLES_PATH),
            "training_log_count": len(logs),
            "ml_training_available": bool(_NUMPY_AVAILABLE and _SKLEARN_AVAILABLE and _JOBLIB_AVAILABLE),
            "ml_model_trained": bool(ml_model),
            "ml_model_path": stored_path_value(IFOREST_MODEL_PATH) if IFOREST_MODEL_PATH.exists() else None,
            "ml_sample_count": ml_meta.get("sample_count", 0),
            "profile_confidence": compute_profile_confidence(profile),
            "ml_training_error": training_error,
        },
    }
    metadata = {
        "model_name": "wards_hybrid_ai_security_model",
        "version": version,
        "trained_at": state["updated_at"],
        "model_type": state["algorithm"],
        "feature_set": state["features"],
        "training_parameters": {
            "strategy": state["strategy"],
            "bootstrap_samples": len(logs),
            "historical_admin_samples": 0,
            "detection_samples": 0,
            "ml_model_trained": bool(ml_model),
        },
        "state_path": stored_path_value(MODEL_STATE_PATH) or str(MODEL_STATE_PATH),
        "isolation_forest": ml_meta,
    }
    MODEL_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    try:
        MODEL_STATE_PATH.write_text(json_dumps(state), encoding="utf-8")
        MODEL_METADATA_PATH.write_text(json_dumps(metadata), encoding="utf-8")
    except OSError as exc:
        logger.exception("Initial AI seed persistence failed: %s", exc)
        state["report"]["persistence_error"] = str(exc)
        return state

    for artifact_path in iter_model_artifact_paths():
        try:
            rel = str(artifact_path.relative_to(MASTER_ROOT)).replace("\\", "/")
            artifact_hash = sha256_file(artifact_path)
        except OSError as exc:
            logger.warning("Skipping seeded ML artifact hash refresh; artifact unavailable: %s (%s)", artifact_path, exc)
            continue
        except ValueError:
            continue
        entry = db.query(SecurityMonitoredFile).filter(SecurityMonitoredFile.relative_path == rel).first()
        if entry:
            entry.current_hash = artifact_hash
            entry.baseline_hash = artifact_hash
            entry.status = "clean"
            entry.last_checked = now_utc()
            db.add(entry)
    db.commit()
    set_setting(db, "ai_initial_training_seeded", "true", initiated_by)
    set_setting(db, "ai_last_retrained_at", state["updated_at"], initiated_by)
    set_setting(db, "ai_training_sample_count", str(len(logs)), initiated_by)
    set_setting(db, "ai_model_version", version, initiated_by)
    return state


def content_flags(content: str, context: dict | None = None, path: Path | None = None) -> list[str]:
    context = context or {}
    rules = context.get("ai_rules") or DEFAULT_AI_RULES
    lowered = (content or "").lower()
    flags = []
    ts = now_utc()
    try:
        hour = int(context.get("hour_of_day")) if context.get("hour_of_day") is not None else ts.hour
    except (TypeError, ValueError):
        hour = ts.hour
    try:
        weekday = int(context.get("day_of_week")) if context.get("day_of_week") is not None else ts.weekday()
    except (TypeError, ValueError):
        weekday = ts.weekday()
    if ai_rule_enabled(rules, "hour_of_day") and (hour < 8 or hour > 18):
        flags.append("after_hours")
    if ai_rule_enabled(rules, "day_of_week") and weekday >= 5:
        flags.append("weekend_activity")
    if ai_rule_enabled(rules, "vpn_activity") and (context.get("vpn_activity") or context.get("vpn_detected")):
        flags.append("vpn_activity")
    ip_reputation_score = first_present(context, "ip_reputation_score", "source_ip_reputation", default=0)
    ip_reputation = str(context.get("ip_reputation") or context.get("source_ip_reputation") or "").lower()
    try:
        if ai_rule_enabled(rules, "source_ip_reputation") and float(ip_reputation_score) >= 50:
            flags.append("source_ip_reputation")
    except (TypeError, ValueError):
        pass
    if ai_rule_enabled(rules, "source_ip_reputation") and ip_reputation in {"suspicious", "malicious", "blocked", "abusive"}:
        flags.append("source_ip_reputation")
    try:
        keystroke_confidence = float(first_present(context, "keystroke_anomaly_confidence", "keystroke_dynamics", default=0))
    except (TypeError, ValueError):
        keystroke_confidence = 0
    if ai_rule_enabled(rules, "keystroke_dynamics") and (context.get("keystroke_anomaly") or context.get("typing_pattern_anomaly") or keystroke_confidence >= 0.7):
        flags.append("keystroke_dynamics")
    if ai_rule_enabled(rules, "admin_session_valid") and not context.get("admin_session_valid"):
        flags.append("unauthenticated_change")
    if ai_rule_enabled(rules, "mfa_verified") and (context.get("mfa_verified") is False or context.get("mfa_valid") is False):
        flags.append("mfa_not_verified")
    if ai_rule_enabled(rules, "first_time_device") and (context.get("first_time_device") or context.get("new_device") or context.get("device_seen_before") is False):
        flags.append("first_time_device")
    if ai_rule_enabled(rules, "first_time_country") and (context.get("first_time_country") or context.get("new_country") or context.get("country_seen_before") is False):
        flags.append("first_time_country")
    try:
        geo_distance_km = float(first_present(context, "geo_distance_from_last_login_km", "geo_distance_km", default=0))
        geo_elapsed_hours = float(first_present(context, "hours_since_last_login", "geo_elapsed_hours", default=0))
    except (TypeError, ValueError):
        geo_distance_km = 0
        geo_elapsed_hours = 0
    if ai_rule_enabled(rules, "geo_distance_from_last_login") and (context.get("impossible_travel") or geo_distance_km >= 500 or (geo_elapsed_hours > 0 and geo_distance_km / geo_elapsed_hours >= 900)):
        flags.append("geo_distance_from_last_login")
    try:
        peer_login_z_score = float(first_present(context, "peer_login_time_z_score", default=0))
    except (TypeError, ValueError):
        peer_login_z_score = 0
    if ai_rule_enabled(rules, "peer_login_time_deviation") and (context.get("peer_login_time_deviation") or peer_login_z_score >= 2.5):
        flags.append("peer_login_time_deviation")
    try:
        peer_path_z_score = float(first_present(context, "peer_path_access_z_score", default=0))
    except (TypeError, ValueError):
        peer_path_z_score = 0
    if ai_rule_enabled(rules, "peer_path_access_deviation") and (context.get("peer_path_access_deviation") or peer_path_z_score >= 2.5):
        flags.append("peer_path_access_deviation")
    try:
        modified_file_count = int(first_present(context, "modified_file_count", "files_modified_in_window", default=0))
    except (TypeError, ValueError):
        modified_file_count = 0
    if ai_rule_enabled(rules, "excessive_file_modifications") and (context.get("excessive_file_modifications") or modified_file_count > 10):
        flags.append("excessive_file_modifications")
    try:
        admin_actions_per_minute = float(first_present(context, "admin_actions_per_minute", "privileged_actions_per_minute", default=0))
    except (TypeError, ValueError):
        admin_actions_per_minute = 0
    if ai_rule_enabled(rules, "rapid_admin_actions") and (context.get("rapid_admin_actions") or admin_actions_per_minute > 12):
        flags.append("rapid_admin_actions")
    if ai_rule_enabled(rules, "admin_action_rarity"):
        try:
            rarity_score = float(first_present(context, "admin_action_rarity_score", "admin_action_rarity", default=0))
        except (TypeError, ValueError):
            rarity_score = 0
        if rarity_score >= float(ai_rule_config(rules, "admin_action_rarity").get("high_rarity_score", 0.75)):
            flags.append("admin_action_rarity")
    if ai_rule_enabled(rules, "restore_frequency"):
        try:
            restore_count = int(first_present(context, "restore_count", "restores_in_window", default=0))
        except (TypeError, ValueError):
            restore_count = 0
        if restore_count >= int(ai_rule_config(rules, "restore_frequency").get("max_restores_per_window", 3)):
            flags.append("restore_frequency")
    if ai_rule_enabled(rules, "backup_integrity_validation") and context.get("backup_integrity_valid") is False:
        flags.append("backup_integrity_validation")
    if ai_rule_enabled(rules, "content_similarity_score"):
        try:
            similarity = float(
                context.get("content_similarity_score")
                if context.get("content_similarity_score") is not None
                else difflib.SequenceMatcher(None, context.get("old_content") or "", content or "").ratio()
            )
        except (TypeError, ValueError):
            similarity = 1
        if similarity < float(ai_rule_config(rules, "content_similarity_score").get("low_similarity", 0.45)):
            flags.append("content_similarity_score")
    if ai_rule_enabled(rules, "affected_files_count"):
        try:
            affected_files_count = int(first_present(context, "affected_files_count", "modified_file_count", default=0))
        except (TypeError, ValueError):
            affected_files_count = 0
        cfg = ai_rule_config(rules, "affected_files_count")
        high_count = int(cfg.get("high_risk_count", 10))
        medium_count = int(cfg.get("medium_risk_count", 3))
        if affected_files_count > high_count or affected_files_count >= medium_count:
            flags.append("affected_files_count")
    if path is not None:
        path_text = str(path).lower()
        if ai_rule_enabled(rules, "unauthorized_admin_path"):
            path_keywords = ai_rule_config(rules, "unauthorized_admin_path").get("path_keywords", ["admin", "security", "auth", "mfa", "backup", "recovery"])
            if not context.get("method_legitimate") and any(str(keyword).lower() in path_text for keyword in path_keywords):
                flags.append("unauthorized_admin_path")
        if ai_rule_enabled(rules, "sensitive_config_change"):
            sensitive_config = ai_rule_config(rules, "sensitive_config_change")
            sensitive_extensions = {str(item).lower() for item in sensitive_config.get("extensions", [".env", ".xml", ".yml", ".yaml", ".sql"])}
            sensitive_filenames = {str(item).lower() for item in sensitive_config.get("filenames", ["requirements.txt", "package.json"])}
            if context.get("sensitive_config_change") or path.suffix.lower() in sensitive_extensions or path.name.lower() in sensitive_filenames:
                flags.append("sensitive_config_change")
        if ai_rule_enabled(rules, "backup_restore_activity"):
            path_keywords = ai_rule_config(rules, "backup_restore_activity").get("path_keywords", ["backup", "restore", "recovery", "quarantine"])
            if context.get("backup_restore_activity") or any(str(keyword).lower() in path_text for keyword in path_keywords):
                flags.append("backup_restore_activity")
        if ai_rule_enabled(rules, "mfa_configuration_change"):
            path_keywords = ai_rule_config(rules, "mfa_configuration_change").get("path_keywords", ["mfa", "authenticator", "two_factor", "2fa"])
            if context.get("mfa_configuration_change") or any(str(keyword).lower() in path_text for keyword in path_keywords):
                flags.append("mfa_configuration_change")
        if ai_rule_enabled(rules, "auth_system_modification"):
            path_keywords = ai_rule_config(rules, "auth_system_modification").get("path_keywords", ["auth", "login", "jwt", "token", "password", "session", "middleware"])
            if context.get("auth_system_modification") or any(str(keyword).lower() in path_text for keyword in path_keywords):
                flags.append("auth_system_modification")
    # Skip content-based injection/defacement pattern matching for documentation
    # files (.md, .txt) that legitimately contain example payloads.
    is_doc_file = path is not None and path.suffix.lower() in {".md", ".txt", ".rst"}
    if ai_rule_enabled(rules, "suspicious_pattern_score") and not is_doc_file:
        for key, patterns in SUSPICIOUS_PATTERNS.items():
            if any(pattern in lowered for pattern in patterns):
                flags.append(key)
    if context.get("rapid_change"):
        flags.append("rapid_change")
    return sorted(set(flags))


def ai_predict(path: Path, old_content: str, new_content: str, context: dict | None = None) -> AIPrediction:
    context = context or {}
    if context.get("content_similarity_score") is None:
        context["content_similarity_score"] = difflib.SequenceMatcher(None, old_content or "", new_content or "").ratio()
    flags = content_flags(new_content, context, path=path)
    rules = context.get("ai_rules") or DEFAULT_AI_RULES

    def enabled(rule_name: str) -> bool:
        return bool(rules.get(rule_name, {}).get("enabled", True))

    def weight(rule_name: str, fallback: float) -> float:
        try:
            return float(rules.get(rule_name, {}).get("weight", fallback))
        except Exception:
            return fallback

    def config(rule_name: str) -> dict:
        return rules.get(rule_name, {}).get("config", {}) or {}

    risk = 0.12
    if enabled("admin_session_valid") and "unauthenticated_change" in flags:
        risk += weight("admin_session_valid", 0.22)
    if enabled("mfa_verified") and "mfa_not_verified" in flags:
        risk += weight("mfa_verified", 0.16)
    if enabled("hour_of_day") and "after_hours" in flags:
        risk += weight("hour_of_day", 0.08)
    if enabled("day_of_week") and "weekend_activity" in flags:
        risk += weight("day_of_week", 0.05)
    if enabled("vpn_activity") and "vpn_activity" in flags:
        risk += weight("vpn_activity", 0.12)
    if enabled("source_ip_reputation") and "source_ip_reputation" in flags:
        risk += weight("source_ip_reputation", 0.1)
    if enabled("keystroke_dynamics") and "keystroke_dynamics" in flags:
        risk += weight("keystroke_dynamics", 0.1)
    if enabled("first_time_device") and "first_time_device" in flags:
        risk += weight("first_time_device", 0.14)
    if enabled("first_time_country") and "first_time_country" in flags:
        risk += weight("first_time_country", 0.16)
    if enabled("geo_distance_from_last_login") and "geo_distance_from_last_login" in flags:
        risk += weight("geo_distance_from_last_login", 0.18)
    if "rapid_change" in flags:
        risk += 0.18
    if enabled("suspicious_pattern_score") and "defacement_keywords" in flags:
        risk += float(config("suspicious_pattern_score").get("keyword_weight", 0.22))
    if enabled("suspicious_pattern_score") and ("script_injection" in flags or "iframe_injection" in flags):
        risk += weight("suspicious_pattern_score", 0.32)
    if enabled("suspicious_pattern_score") and ("credential_access" in flags or "sql_injection" in flags):
        risk += 0.18
    explicitly_scored_flags = {
        "unauthorized_admin_path",
        "sensitive_config_change",
        "backup_restore_activity",
        "mfa_configuration_change",
        "auth_system_modification",
        "admin_action_rarity",
        "restore_frequency",
        "backup_integrity_validation",
        "content_similarity_score",
        "affected_files_count",
    }
    for additional_rule in APPROVED_ADDITIONAL_AI_RULES:
        if additional_rule in explicitly_scored_flags:
            continue
        if enabled(additional_rule) and additional_rule in flags:
            risk += weight(additional_rule, float(APPROVED_ADDITIONAL_AI_RULES[additional_rule].get("weight", 0.18)))
    if enabled("unauthorized_admin_path") and "unauthorized_admin_path" in flags:
        risk += weight("unauthorized_admin_path", 0.22)
    if enabled("sensitive_config_change") and "sensitive_config_change" in flags:
        risk += weight("sensitive_config_change", 0.26)
    if enabled("backup_restore_activity") and "backup_restore_activity" in flags:
        risk += weight("backup_restore_activity", 0.2)
    if enabled("mfa_configuration_change") and "mfa_configuration_change" in flags:
        risk += weight("mfa_configuration_change", 0.22)
    if enabled("auth_system_modification") and "auth_system_modification" in flags:
        risk += weight("auth_system_modification", 0.24)
    size_delta = abs(len(new_content.encode("utf-8")) - len(old_content.encode("utf-8")))
    if enabled("file_size_change") and size_delta > int(config("file_size_change").get("large_delta_bytes", 2000)):
        risk += weight("file_size_change", 0.12)
    if enabled("content_length"):
        length_config = config("content_length")
        if len(new_content) < int(length_config.get("unusual_min", 10)) or len(new_content) > int(length_config.get("unusual_max", 250000)):
            risk += weight("content_length", 0.05)
    if enabled("special_chars_count"):
        special_count = sum(new_content.count(char) for char in ["<", ">", "&", '"', "'", "/", "\\"])
        if special_count > int(config("special_chars_count").get("high_count", 300)):
            risk += weight("special_chars_count", 0.08)
    if enabled("file_type_risk") and path.suffix.lower() in set(config("file_type_risk").get("high_risk_extensions", [".html", ".jsx", ".js", ".py"])):
        risk += weight("file_type_risk", 0.07)
    if enabled("ip_consistent") and context.get("ip_consistent") is False:
        risk += weight("ip_consistent", 0.08)
    if enabled("method_legitimate") and not context.get("method_legitimate"):
        risk += weight("method_legitimate", 0.18)
    if enabled("business_hours") and not context.get("business_hours", True):
        risk += weight("business_hours", 0.08)
    if enabled("admin_action_rarity"):
        try:
            rarity_score = float(first_present(context, "admin_action_rarity_score", "admin_action_rarity", default=0))
        except (TypeError, ValueError):
            rarity_score = 0
        if rarity_score >= float(config("admin_action_rarity").get("high_rarity_score", 0.75)):
            risk += weight("admin_action_rarity", 0.16) * min(rarity_score, 1)
    if enabled("restore_frequency"):
        try:
            restore_count = int(first_present(context, "restore_count", "restores_in_window", default=0))
        except (TypeError, ValueError):
            restore_count = 0
        if restore_count >= int(config("restore_frequency").get("max_restores_per_window", 3)):
            risk += weight("restore_frequency", 0.18)
    if enabled("backup_integrity_validation") and context.get("backup_integrity_valid") is False:
        risk += weight("backup_integrity_validation", 0.24)
    if enabled("content_similarity_score"):
        try:
            similarity = float(context.get("content_similarity_score") if context.get("content_similarity_score") is not None else difflib.SequenceMatcher(None, old_content or "", new_content or "").ratio())
        except (TypeError, ValueError):
            similarity = 1
        if similarity < float(config("content_similarity_score").get("low_similarity", 0.45)):
            risk += weight("content_similarity_score", 0.2) * (1 - max(0, similarity))
    if enabled("affected_files_count"):
        try:
            affected_files_count = int(first_present(context, "affected_files_count", "modified_file_count", default=0))
        except (TypeError, ValueError):
            affected_files_count = 0
        high_count = int(config("affected_files_count").get("high_risk_count", 10))
        medium_count = int(config("affected_files_count").get("medium_risk_count", 3))
        if affected_files_count > high_count:
            risk += weight("affected_files_count", 0.2)
        elif affected_files_count >= medium_count:
            risk += weight("affected_files_count", 0.2) * 0.5
    model_state = load_ai_model_state()
    profile = model_state.get("behavioral_profile") or {}
    profile_context = {
        **context,
        "file_path": str(path),
        "hour_of_day": context.get("hour_of_day") if context.get("hour_of_day") is not None else now_utc().hour,
        "day_of_week": context.get("day_of_week") if context.get("day_of_week") is not None else now_utc().weekday(),
    }
    profile_risk, learned_notes, learned_warning = behavioral_score_from_profile(profile_context, profile, rules)
    rule_risk = risk + profile_risk
    identity_warning = (
        context.get("ip_consistent") is False
        or "source_ip_reputation" in flags
        or "keystroke_dynamics" in flags
        or "vpn_activity" in flags
        or learned_warning
    )
    if context.get("admin_session_valid") and context.get("method_legitimate") and enabled("admin_session_valid") and enabled("method_legitimate") and not identity_warning:
        rule_risk = min(rule_risk, 0.18)

    ml_log = {
        **profile_context,
        "file_size_change": size_delta,
        "content_length": len(new_content or ""),
        "special_chars_count": sum((new_content or "").count(char) for char in ["<", ">", "&", '"', "'", "/", "\\"]),
        "file_type_risk": 1 if path.suffix.lower() in set(config("file_type_risk").get("high_risk_extensions", [".html", ".jsx", ".js", ".py"])) else 0,
    }
    for flag in flags:
        ml_log.setdefault(flag, 1)
    ml_risk = ml_anomaly_score(ml_log)
    profile_confidence = compute_profile_confidence(profile)
    ml_weight = profile_confidence * 0.4
    rule_weight = 1.0 - ml_weight
    final_risk = (rule_risk * rule_weight) + (ml_risk * ml_weight)
    final_risk = max(0.01, min(final_risk, 0.99))
    sensitivity = str(context.get("ai_sensitivity") or context.get("global_ai_sensitivity") or "medium").lower().replace(" ", "_")
    suspicious_threshold = AI_SENSITIVITY_THRESHOLDS.get(sensitivity, AI_SENSITIVITY_THRESHOLDS["medium"])
    malicious_threshold = max(0.7, suspicious_threshold + 0.15)
    prediction = "normal" if final_risk < suspicious_threshold else "suspicious" if final_risk < malicious_threshold else "malicious"
    confidence = final_risk if prediction != "normal" else 1 - final_risk
    active_rules = [key for key, value in rules.items() if value.get("enabled", True)]
    basis = f"Based on enabled AI rules: {', '.join(active_rules)}."
    if learned_notes:
        basis = f"{basis} Learned behavioral profile: {', '.join(learned_notes)}."
    if ml_risk > 0:
        basis = f"{basis} Isolation Forest risk {ml_risk:.4f} with ML weight {ml_weight:.2f}."
    return AIPrediction(prediction=prediction, score=round(final_risk, 4), confidence=round(confidence, 4), basis=basis)


def classify(change_type: str, prediction: AIPrediction, flags: list[str], context: dict | None = None) -> dict:
    context = context or {}
    score = 0.0
    if change_type == "file_deleted":
        score += 4.0
    elif change_type == "content_modified":
        score += 2.0
    if prediction.prediction == "suspicious":
        score += 1.5
    if prediction.prediction == "malicious":
        score += 3.0
    if "script_injection" in flags:
        score += 2.0
    if "iframe_injection" in flags:
        score += 1.7
    if "defacement_keywords" in flags:
        score += 1.5
    if "rapid_change" in flags:
        score += 1.2
    if "vpn_activity" in flags:
        score += 0.7
    if "sql_injection" in flags:
        score += 1.0
    if context.get("mass_modification"):
        score += 1.5
    score = round(max(0.0, min(10.0, score)), 1)
    level = "info" if score <= 0 else "low" if score < 4 else "medium" if score < 7 else "high" if score < 9 else "critical"

    if change_type == "file_deleted":
        incident_type = "file_deletion"
        nist = "CAT 2 - Denial of Service"
        enisa = "Denial of Service"
        vector = "AV:N/AC:L/PR:N/UI:N/S:C/C:N/I:H/A:H"
    elif "script_injection" in flags or "iframe_injection" in flags:
        incident_type = "injection"
        nist = "CAT 3 - Malicious Code"
        enisa = "Web Application Attack"
        vector = "AV:N/AC:L/PR:N/UI:N/S:C/C:N/I:H/A:N"
    elif "sql_injection" in flags:
        incident_type = "unauthorized_access"
        nist = "CAT 1 - Unauthorized Access"
        enisa = "Identity Fraud"
        vector = "AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:N"
    elif context.get("mass_modification") or "rapid_change" in flags:
        incident_type = "mass_defacement"
        nist = "CAT 3 - Malicious Code"
        enisa = "Web Application Attack"
        vector = "AV:N/AC:L/PR:N/UI:N/S:C/C:N/I:H/A:N"
    elif level == "info":
        incident_type = "legitimate_change"
        nist = "CAT 0 - Exercise/Test"
        enisa = "N/A"
        vector = "AV:L/AC:L/PR:H/UI:N/S:U/C:N/I:N/A:N"
    else:
        incident_type = "defacement"
        nist = "CAT 4 - Improper Usage"
        enisa = "Information Manipulation"
        vector = "AV:N/AC:L/PR:N/UI:N/S:C/C:N/I:H/A:N"

    return {
        "incident_type": incident_type,
        "severity_level": level,
        "cvss_score": score,
        "cvss_vector": vector,
        "nist_category": nist,
        "enisa_threat_type": enisa,
    }


def diff_lines(old_content: str, new_content: str) -> dict:
    changes = {"added": [], "removed": [], "changed": []}
    diff = difflib.ndiff(old_content.splitlines(), new_content.splitlines())
    old_line = 0
    new_line = 0
    _MAX_DIFF_LINES = 500
    for entry in diff:
        code = entry[:2]
        text = entry[2:]
        if code == "  ":
            old_line += 1
            new_line += 1
        elif code == "- ":
            old_line += 1
            changes["removed"].append({"line": old_line, "text": text[:500]})
        elif code == "+ ":
            new_line += 1
            changes["added"].append({"line": new_line, "text": text[:500]})
        # Cap each list independently to keep total JSON well under MySQL TEXT limit
        if len(changes["added"]) >= _MAX_DIFF_LINES and len(changes["removed"]) >= _MAX_DIFF_LINES:
            break
    return changes


def recent_admin_change(db: Session, file_path: str) -> SecurityAdminFileChange | None:
    cutoff = now_utc() - timedelta(seconds=90)
    return (
        db.query(SecurityAdminFileChange)
        .filter(SecurityAdminFileChange.file_path == file_path, SecurityAdminFileChange.timestamp >= cutoff)
        .order_by(SecurityAdminFileChange.timestamp.desc())
        .first()
    )


def quarantine_file(file_path: Path, detection_id: int) -> str | None:
    if not file_path.exists():
        logger.warning("Unable to quarantine detection %s because file is missing: %s", detection_id, file_path)
        return None
    target = QUARANTINE_ROOT / f"detection_{detection_id}" / safe_rel(file_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(file_path, target)
    logger.warning("Quarantined file copy created for detection %s at %s from %s", detection_id, target, file_path)
    return stored_path_value(target) or str(target)


def safe_quarantine_path(raw_path: str | Path | None) -> Path | None:
    if not raw_path:
        return None
    try:
        root = QUARANTINE_ROOT.resolve()
        path = resolve_stored_path(raw_path)
        if not path:
            return None
        path.relative_to(root)
        return path
    except Exception:
        return None


def cleanup_quarantine_paths(paths: list[str]) -> None:
    for raw_path in paths:
        try:
            path = safe_quarantine_path(raw_path)
            if not path:
                continue
            if path.exists():
                if path.is_dir():
                    shutil.rmtree(path, ignore_errors=True)
                else:
                    path.unlink()
            marker = next((parent for parent in path.parents if parent.name.startswith("detection_")), None)
            if marker and safe_quarantine_path(marker) and marker.exists():
                shutil.rmtree(marker, ignore_errors=True)
        except Exception:
            pass


def restore_from_backup(db: Session, file_entry: SecurityMonitoredFile, detection_id: int | None, recovery_type: str, initiated_by: int | None, quarantine_path: str | None = None, *, create_event: bool = True) -> SecurityRecoveryEvent | None:
    if is_database_entry(file_entry):
        return restore_database_from_backup(db, file_entry, detection_id, recovery_type, initiated_by, quarantine_path, create_event=create_event)

    def _find_backup_source():
        return newest_valid_backup_for_path(db, file_entry.relative_path, file_entry.baseline_hash)

    if not create_event:
        source, backup_root = _find_backup_source()
        if not source:
            raise RuntimeError("No local backup matching the trusted baseline exists. Create a manual backup first.")
        target = portable_monitored_path(file_entry)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        restored_hash = sha256_file(target)
        file_entry.current_hash = restored_hash
        file_entry.baseline_hash = restored_hash
        file_entry.status = "recovered"
        file_entry.size_bytes = target.stat().st_size
        file_entry.last_checked = now_utc()
        db.add(file_entry)
        db.commit()
        return None

    if detection_id:
        existing = db.query(SecurityRecoveryEvent).filter(
            SecurityRecoveryEvent.file_id == file_entry.id,
            SecurityRecoveryEvent.detection_event_id == detection_id,
        ).first()
        if existing:
            return existing

    recovery = SecurityRecoveryEvent(
        detection_event_id=detection_id,
        file_id=file_entry.id,
        recovery_type=recovery_type,
        initiated_by=initiated_by,
        status="in_progress",
        quarantine_path=quarantine_path,
    )
    db.add(recovery)
    db.commit()
    db.refresh(recovery)

    started = time.time()
    try:
        source, backup_root = _find_backup_source()
        if not source:
            raise RuntimeError("No local backup matching the trusted baseline exists. Create a manual backup first.")

        if is_vm1_file(file_entry):
            # VM1 file: push clean snapshot and create a VM1 restore command
            snapshot = VM1_SNAPSHOT_ROOT / file_entry.relative_path
            snapshot.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, snapshot)
            clean_hash = sha256_file(snapshot)
            file_entry.baseline_hash = clean_hash
            file_entry.status = "clean"
            file_entry.last_checked = now_utc()
            recovery.status = "success"
            recovery.backup_path = stored_path_value(source) or str(source)
            recovery.completed_at = now_utc()
            recovery.recovery_duration_ms = int((time.time() - started) * 1000)
            recovery.summary = f"Auto-recovery applied for {file_entry.relative_path} from {backup_root.name}; pending admin verification."
            db.add(file_entry)
            db.add(recovery)
            db.commit()
            _create_vm1_restore_command(db, file_entry, detection_id)
        else:
            target = portable_monitored_path(file_entry)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            restored_hash = sha256_file(target)
            file_entry.current_hash = restored_hash
            file_entry.baseline_hash = restored_hash
            file_entry.status = "recovered"
            file_entry.size_bytes = target.stat().st_size
            file_entry.last_checked = now_utc()
            recovery.status = "success"
            recovery.backup_path = stored_path_value(source) or str(source)
            recovery.completed_at = now_utc()
            recovery.recovery_duration_ms = int((time.time() - started) * 1000)
            recovery.summary = f"Restored {file_entry.relative_path} from {backup_root.name}."
            db.add(file_entry)
            db.add(recovery)
            db.commit()
        if recovery_type != "automatic":
            create_system_alert(db, "recovery_completed", f"Recovery #{recovery.id}: {recovery.summary}", "low", dedupe_key=f"Recovery #{recovery.id}")
    except Exception as exc:
        recovery.status = "failed"
        recovery.error_message = str(exc)
        recovery.completed_at = now_utc()
        recovery.recovery_duration_ms = int((time.time() - started) * 1000)
        recovery.summary = f"Recovery failed for {file_entry.relative_path}."
        db.add(recovery)
        db.commit()
        if recovery_type != "automatic":
            create_system_alert(db, "recovery_failed", f"Recovery #{recovery.id}: {recovery.summary} {recovery.error_message or ''}", "high", dedupe_key=f"Recovery #{recovery.id}")
    db.refresh(recovery)
    return recovery


def restore_database_from_backup(db: Session, file_entry: SecurityMonitoredFile, detection_id: int | None, recovery_type: str, initiated_by: int | None, quarantine_path: str | None = None, *, create_event: bool = True) -> SecurityRecoveryEvent | None:
    recovery = None
    if create_event:
        recovery = SecurityRecoveryEvent(
            detection_event_id=detection_id,
            file_id=file_entry.id,
            recovery_type=recovery_type,
            initiated_by=initiated_by,
            status="in_progress",
            quarantine_path=quarantine_path,
        )
        db.add(recovery)
        db.commit()
        db.refresh(recovery)

    started = time.time()
    try:
        backup_root = newest_valid_backup_for_domain(db, RECOVERY_DOMAIN_VM2_DATABASE)
        if not backup_root:
            raise RuntimeError("No local database backup exists. Create a manual backup first.")
        source = backup_file_path(backup_root, DATABASE_BACKUP_RELATIVE_PATH)
        if not source.exists():
            raise FileNotFoundError(f"Database backup snapshot not found for {DATABASE_BACKUP_RELATIVE_PATH}")
        restore_database_snapshot(db, source)
        target = Path(file_entry.file_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        clear_database_audit_log(db)
        create_database_checksum_manifest(db, target)
        restored_hash = sha256_file(target)
        file_entry.current_hash = restored_hash
        file_entry.baseline_hash = restored_hash
        file_entry.status = "recovered"
        file_entry.size_bytes = target.stat().st_size
        file_entry.last_checked = now_utc()
        if recovery:
            recovery.status = "success"
            recovery.backup_path = stored_path_value(source) or str(source)
            recovery.completed_at = now_utc()
            recovery.recovery_duration_ms = int((time.time() - started) * 1000)
            recovery.summary = "Restored wards_db from the latest trusted database snapshot."
        db.add(file_entry)
        if recovery:
            db.add(recovery)
        set_setting(db, "database_audit_last_id", str(latest_database_audit_id(db)), "database_monitor")
        db.commit()
        if recovery and recovery_type != "automatic":
            create_system_alert(db, "recovery_completed", f"Recovery #{recovery.id}: {recovery.summary}", "low", dedupe_key=f"Recovery #{recovery.id}")
    except Exception as exc:
        if recovery:
            recovery.status = "failed"
            recovery.error_message = str(exc)
            recovery.completed_at = now_utc()
            recovery.recovery_duration_ms = int((time.time() - started) * 1000)
            recovery.summary = "Database recovery failed."
            db.add(recovery)
            db.commit()
            if recovery_type != "automatic":
                create_system_alert(db, "recovery_failed", f"Recovery #{recovery.id}: {recovery.summary} {recovery.error_message or ''}", "high", dedupe_key=f"Recovery #{recovery.id}")
        if not create_event:
            raise
    if recovery:
        db.refresh(recovery)
    return recovery


def restore_from_quarantine(db: Session, file_entry: SecurityMonitoredFile, detection_id: int | None, initiated_by: int, quarantine_path: str) -> SecurityRecoveryEvent:
    recovery = SecurityRecoveryEvent(
        detection_event_id=detection_id,
        file_id=file_entry.id,
        recovery_type="false_positive_restore",
        initiated_by=initiated_by,
        status="in_progress",
        quarantine_path=quarantine_path,
    )
    db.add(recovery)
    db.commit()
    db.refresh(recovery)

    started = time.time()
    try:
        source = safe_quarantine_path(quarantine_path)
        target = portable_monitored_path(file_entry)
        if not source:
            raise FileNotFoundError(f"Quarantined copy not found for {file_entry.relative_path}")
        if not source.exists() or not source.is_file():
            raise FileNotFoundError(f"Quarantined copy not found for {file_entry.relative_path}")
        if is_database_entry(file_entry):
            restore_database_snapshot(db, source)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        restored_hash = sha256_file(target)
        file_entry.baseline_hash = restored_hash
        file_entry.current_hash = restored_hash
        file_entry.status = "clean"
        file_entry.size_bytes = target.stat().st_size
        file_entry.last_checked = now_utc()
        recovery.status = "success"
        recovery.completed_at = now_utc()
        recovery.recovery_duration_ms = int((time.time() - started) * 1000)
        recovery.summary = f"Restored authorized quarantined copy for {file_entry.relative_path}."
        db.add(file_entry)
        db.add(recovery)
        db.commit()
    except Exception as exc:
        recovery.status = "failed"
        recovery.error_message = str(exc)
        recovery.completed_at = now_utc()
        recovery.recovery_duration_ms = int((time.time() - started) * 1000)
        recovery.summary = f"False positive restore failed for {file_entry.relative_path}."
        db.add(recovery)
        db.commit()
    db.refresh(recovery)
    return recovery


def revert_recovery_to_quarantine(db: Session, file_entry: SecurityMonitoredFile, detection_id: int | None, initiated_by: int, quarantine_path: str) -> SecurityRecoveryEvent:
    recovery = SecurityRecoveryEvent(
        detection_event_id=detection_id,
        file_id=file_entry.id,
        recovery_type="reverted",
        initiated_by=initiated_by,
        status="reverted",
        quarantine_path=quarantine_path,
    )
    db.add(recovery)
    db.commit()
    db.refresh(recovery)

    started = time.time()
    try:
        source = safe_quarantine_path(quarantine_path)
        target = portable_monitored_path(file_entry)
        if not source or not source.exists() or not source.is_file():
            raise FileNotFoundError(f"Quarantined copy not found for {file_entry.relative_path}")
        if is_database_entry(file_entry):
            restore_database_snapshot(db, source)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        reverted_hash = sha256_file(target)
        file_entry.baseline_hash = reverted_hash
        file_entry.current_hash = reverted_hash
        file_entry.status = "clean"
        file_entry.size_bytes = target.stat().st_size
        file_entry.last_checked = now_utc()
        recovery.completed_at = now_utc()
        recovery.recovery_duration_ms = int((time.time() - started) * 1000)
        recovery.summary = f"Reverted previous recovery and restored the authorized quarantined copy for {file_entry.relative_path}."
        db.add(file_entry)
        db.add(recovery)
        db.commit()
    except Exception as exc:
        recovery.status = "failed"
        recovery.error_message = str(exc)
        recovery.completed_at = now_utc()
        recovery.recovery_duration_ms = int((time.time() - started) * 1000)
        recovery.summary = f"Failed to revert recovery for {file_entry.relative_path}."
        db.add(recovery)
        db.commit()
    db.refresh(recovery)
    return recovery

def restore_quarantined_copy_to_original(
    db: Session,
    file_entry: SecurityMonitoredFile,
    quarantine_path: str,
    initiated_by: int,
    detection_id: int | None = None,
    *,
    create_event: bool = True,
) -> SecurityRecoveryEvent | None:
    source = safe_quarantine_path(quarantine_path)
    if not source or not source.exists() or not source.is_file():
        raise FileNotFoundError(f"Quarantined copy not found for {file_entry.relative_path}")

    target = portable_monitored_path(file_entry)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)

    restored_hash = sha256_file(target)
    file_entry.baseline_hash = restored_hash
    file_entry.current_hash = restored_hash
    file_entry.status = "clean"
    file_entry.size_bytes = target.stat().st_size
    file_entry.last_checked = now_utc()
    db.add(file_entry)

    if not create_event:
        db.commit()
        return None

    recovery = SecurityRecoveryEvent(
        detection_event_id=detection_id,
        file_id=file_entry.id,
        recovery_type="reverted",
        initiated_by=_valid_admin_id(db, initiated_by),
        status="reverted",
        quarantine_path=stored_path_value(source) or str(source),
        backup_path=stored_path_value(source) or str(source),
        summary=f"Restored the quarantined copy for {file_entry.relative_path} back to its original location.",
        completed_at=now_utc(),
    )
    db.add(recovery)
    db.commit()
    db.refresh(recovery)
    return recovery

def current_hash_index(db: Session) -> dict[str, list[SecurityMonitoredFile]]:
    index: dict[str, list[SecurityMonitoredFile]] = {}
    for entry in active_monitored_files_query(db).all():
        path = portable_monitored_path(entry)
        if not path.exists() or not path.is_file():
            continue
        current_hash = entry.current_hash
        if not current_hash:
            try:
                current_hash = sha256_file(path)
            except Exception:
                continue
        index.setdefault(current_hash, []).append(entry)
    return index


def replacement_path_for(entry: SecurityMonitoredFile, hash_index: dict[str, list[SecurityMonitoredFile]]) -> str | None:
    for candidate in hash_index.get(entry.baseline_hash, []):
        if candidate.file_path != entry.file_path:
            return candidate.relative_path or candidate.file_path
    return None


def mark_verified_removal(db: Session, file_entry: SecurityMonitoredFile, reason: str, replacement_path: str | None = None, actor: str = "trusted_baseline") -> SecurityDetectionEvent:
    label = "Verified rename" if reason == "verified_renamed" else "Verified deletion"
    summary = f"{label}: {file_entry.relative_path}"
    if replacement_path:
        summary = f"{summary} -> {replacement_path}"
    detection = (
        db.query(SecurityDetectionEvent)
        .filter(
            SecurityDetectionEvent.file_id == file_entry.id,
            SecurityDetectionEvent.change_type.in_(["file_deleted", "verified_deleted", "verified_renamed"]),
        )
        .order_by(SecurityDetectionEvent.detected_at.desc())
        .first()
    )
    if detection:
        detection.change_type = reason
        detection.is_legitimate = True
        detection.ai_prediction = "normal"
        detection.ai_score = 0.0
        detection.confidence = 1.0
        detection.severity_level = "info"
        detection.cvss_score = 0.0
        detection.nist_category = "CAT 0 - Exercise/Test"
        detection.enisa_threat_type = "N/A"
        detection.trigger_summary = summary
        detection.accuracy_basis = "Accepted during trusted baseline reconciliation."
        context = json_loads(detection.context_json, {})
        context.update({"verified_removal": True, "replacement_path": replacement_path, "actor": actor, "removal_type": reason})
        detection.context_json = json_dumps(context)
        db.add(detection)
    else:
        detection = SecurityDetectionEvent(
            file_id=file_entry.id,
            target_type="file",
            target_name=file_entry.relative_path,
            actor=actor,
            change_type=reason,
            old_hash=file_entry.current_hash or file_entry.baseline_hash,
            new_hash=None,
            is_legitimate=True,
            ai_score=0.0,
            ai_prediction="normal",
            confidence=1.0,
            severity_level="info",
            cvss_score=0.0,
            nist_category="CAT 0 - Exercise/Test",
            enisa_threat_type="N/A",
            trigger_summary=summary,
            accuracy_basis="Accepted during trusted baseline reconciliation.",
            behavior_flags_json=json_dumps([]),
            changed_lines_json=json_dumps({}),
            context_json=json_dumps({"verified_removal": True, "replacement_path": replacement_path, "actor": actor, "removal_type": reason}),
        )
        db.add(detection)
        db.flush()

    for incident in db.query(SecurityIncident).filter(SecurityIncident.detection_event_id == detection.id, SecurityIncident.status.in_(["open", "investigating"])).all():
        incident.status = "resolved"
        incident.response_action = "trusted_removal_resolved"
        incident.resolved_at = now_utc()
        cleanup_quarantine_paths(json_loads(incident.quarantine_paths_json, []))
        db.add(incident)
    for recovery in db.query(SecurityRecoveryEvent).filter(SecurityRecoveryEvent.detection_event_id == detection.id, SecurityRecoveryEvent.status == "success").all():
        recovery.status = "verified_removal"
        recovery.summary = "Trusted baseline accepted; previous automatic recovery is no longer treated as a security incident."
        db.add(recovery)

    file_entry.current_hash = None
    file_entry.status = reason
    file_entry.last_checked = now_utc()
    db.add(file_entry)
    db.flush()
    return detection


def mark_existing_deletion_incident_verified_rename(db: Session, detection: SecurityDetectionEvent, file_entry: SecurityMonitoredFile, replacement_path: str, actor: str) -> None:
    detection.change_type = "verified_renamed"
    detection.is_legitimate = True
    detection.ai_prediction = "normal"
    detection.ai_score = 0.0
    detection.confidence = 1.0
    detection.severity_level = "info"
    detection.cvss_score = 0.0
    detection.nist_category = "CAT 0 - Exercise/Test"
    detection.enisa_threat_type = "N/A"
    detection.trigger_summary = f"Verified rename: {file_entry.relative_path} -> {replacement_path}"
    detection.accuracy_basis = "Accepted during trusted baseline reconciliation."
    context = json_loads(detection.context_json, {})
    context.update({"verified_removal": True, "replacement_path": replacement_path, "actor": actor, "removal_type": "verified_renamed"})
    detection.context_json = json_dumps(context)
    db.add(detection)

    for incident in db.query(SecurityIncident).filter(SecurityIncident.detection_event_id == detection.id, SecurityIncident.status.in_(["open", "investigating"])).all():
        incident.status = "resolved"
        incident.response_action = "trusted_removal_resolved"
        incident.resolved_at = now_utc()
        cleanup_quarantine_paths(json_loads(incident.quarantine_paths_json, []))
        db.add(incident)

    for recovery in db.query(SecurityRecoveryEvent).filter(SecurityRecoveryEvent.detection_event_id == detection.id, SecurityRecoveryEvent.status == "success").all():
        recovery.status = "verified_removal"
        recovery.summary = "Trusted baseline accepted; previous automatic recovery is no longer treated as a security incident."
        db.add(recovery)
    file_entry.current_hash = None
    file_entry.status = "verified_renamed"
    file_entry.last_checked = now_utc()
    db.add(file_entry)


def reconcile_trusted_file_removals(db: Session, actor: str = "trusted_baseline") -> dict[str, int]:
    hash_index = current_hash_index(db)
    verified_deleted = 0
    verified_renamed = 0
    for entry in active_monitored_files_query(db).order_by(SecurityMonitoredFile.relative_path.asc()).all():
        path = portable_monitored_path(entry)
        if path.exists():
            continue
        replacement_path = replacement_path_for(entry, hash_index)
        if replacement_path:
            mark_verified_removal(db, entry, "verified_renamed", replacement_path=replacement_path, actor=actor)
            verified_renamed += 1
        else:
            mark_verified_removal(db, entry, "verified_deleted", actor=actor)
            verified_deleted += 1
    open_deletion_incidents = (
        db.query(SecurityIncident, SecurityDetectionEvent, SecurityMonitoredFile)
        .join(SecurityDetectionEvent, SecurityIncident.detection_event_id == SecurityDetectionEvent.id)
        .join(SecurityMonitoredFile, SecurityDetectionEvent.file_id == SecurityMonitoredFile.id)
        .filter(SecurityIncident.status.in_(["open", "investigating"]), SecurityDetectionEvent.change_type == "file_deleted")
        .all()
    )
    for _incident, detection, entry in open_deletion_incidents:
        replacement_path = replacement_path_for(entry, hash_index)
        if not replacement_path:
            continue
        mark_existing_deletion_incident_verified_rename(db, detection, entry, replacement_path, actor)
        verified_renamed += 1
    return {"verified_deleted": verified_deleted, "verified_renamed": verified_renamed}


def should_create_incident(change_type: str, prediction: AIPrediction, flags: list[str], classification: dict) -> bool:
    concrete_tamper_flags = {
        "script_injection",
        "iframe_injection",
        "defacement_keywords",
        "credential_access",
        "sql_injection",
    }
    if change_type == "file_deleted":
        return True
    if prediction.prediction == "malicious":
        return True
    if concrete_tamper_flags.intersection(flags):
        return True
    return float(classification.get("cvss_score") or 0) >= 7.0


def create_incident(db: Session, detection: SecurityDetectionEvent, classification: dict, flags: list[str], changed: dict, quarantine_path: str | None) -> SecurityIncident:
    context = json.loads(detection.context_json or "{}")
    if detection.target_type == "vm1_host":
        description = (
            "VM1 security reporter heartbeat timeout. "
            "Host may be compromised, reporter killed, or network partitioned."
        )
    else:
        source_ip = context.get("source_ip") or context.get("client_ip") or context.get("ip_address") or "unknown"
        source_details = f" Source IP: {source_ip}."
        if context.get("db_user"):
            source_details += f" DB user: {context.get('db_user')}."
        description = f"{detection.change_type} detected in {detection.target_name}.{source_details}"
    incident = SecurityIncident(
        detection_event_id=detection.id,
        incident_type=classification["incident_type"],
        severity_level=classification["severity_level"],
        cvss_score=classification["cvss_score"],
        cvss_vector=classification["cvss_vector"],
        nist_category=classification["nist_category"],
        enisa_threat_type=classification["enisa_threat_type"],
        description=description,
        behaviors_json=json_dumps([BEHAVIOR_LABELS.get(flag, flag) for flag in flags]),
        affected_files_json=json_dumps([detection.target_name]),
        changed_lines_json=json_dumps(changed),
        quarantine_paths_json=json_dumps([quarantine_path] if quarantine_path else []),
        response_action="monitoring",
        status="open",
    )
    db.add(incident)
    db.commit()
    db.refresh(incident)
    return incident


def scan_database_entry(db: Session, file_entry: SecurityMonitoredFile, context: dict | None = None, commit_clean: bool = True) -> SecurityDetectionEvent | None:
    context = {**(context or {}), "target_type": "database", "database_checksum": True}
    last_audit_id = int(get_setting(db, "database_audit_last_id", "0") or 0)
    audit_changes = database_audit_changes_since(db, last_audit_id)
    unauthorized_audit_changes = unauthorized_database_audit_changes_since(db, last_audit_id)
    if audit_changes:
        context["database_audit_changes"] = audit_changes
        context["database_audit_change_count"] = sum(item["change_count"] for item in audit_changes)
        context["database_audit_tables"] = sorted({item["table_name"] for item in audit_changes})
    if unauthorized_audit_changes:
        context["database_unauthorized_audit_changes"] = unauthorized_audit_changes
        context["database_unauthorized_change_count"] = sum(item["change_count"] for item in unauthorized_audit_changes)
        context["database_unauthorized_tables"] = sorted({item["table_name"] for item in unauthorized_audit_changes})
        first_source = next((item for item in unauthorized_audit_changes if item.get("source_ip") or item.get("db_user")), {})
        context.setdefault("source_ip", first_source.get("source_ip") or "unknown")
        context.setdefault("db_user", first_source.get("db_user"))
        context.setdefault("db_connection_id", first_source.get("connection_id"))

    existing_path = Path(file_entry.file_path)
    checksum_existed = existing_path.exists()

    if not audit_changes and not unauthorized_audit_changes and checksum_existed:
        current_hash = sha256_file(existing_path)
        file_entry.current_hash = current_hash
        file_entry.size_bytes = existing_path.stat().st_size
        file_entry.last_checked = now_utc()
        if current_hash != file_entry.baseline_hash:
            file_entry.baseline_hash = current_hash
        file_entry.status = "clean"
        db.add(file_entry)
        set_setting(db, "database_audit_last_id", str(latest_database_audit_id(db)), "database_monitor")
        prune_database_authorized_operations(db)
        if commit_clean:
            db.commit()
        return None

    path = create_database_checksum_manifest(db, existing_path)
    old_hash = file_entry.current_hash
    current_hash = sha256_file(path)
    backup_root = latest_backup_root(db)
    backup_source = backup_file_path(backup_root, file_entry.relative_path) if backup_root else None
    old_content = read_text(backup_source) if backup_source and backup_source.exists() else ""

    file_entry.current_hash = current_hash
    file_entry.size_bytes = path.stat().st_size
    file_entry.last_checked = now_utc()

    if unauthorized_audit_changes:
        file_entry.status = "modified"
        db.add(file_entry)
        db.commit()
        new_content = read_text(path)
        detection = record_detection(db, file_entry, "content_modified", old_hash, current_hash, old_content, new_content, context)
        set_setting(db, "database_audit_last_id", str(latest_database_audit_id(db)), "database_monitor")
        return detection

    if (not checksum_existed and not unauthorized_audit_changes) or audit_changes or current_hash != file_entry.baseline_hash:
        if audit_changes:
            refresh_latest_database_backup_snapshot(db, path)
        file_entry.baseline_hash = current_hash
        file_entry.current_hash = current_hash
        file_entry.status = "clean"
        db.add(file_entry)
        set_setting(db, "database_audit_last_id", str(latest_database_audit_id(db)), "database_monitor")
        prune_database_authorized_operations(db)
        if commit_clean:
            db.commit()
        return None

    file_entry.status = "clean"
    db.add(file_entry)
    set_setting(db, "database_audit_last_id", str(latest_database_audit_id(db)), "database_monitor")
    prune_database_authorized_operations(db)
    if commit_clean:
        db.commit()
    return None


def _has_open_incident(db: Session, file_entry: SecurityMonitoredFile, change_type: str) -> bool:
    return db.query(SecurityIncident).join(SecurityDetectionEvent).filter(
        SecurityDetectionEvent.file_id == file_entry.id,
        SecurityDetectionEvent.change_type == change_type,
        SecurityIncident.status.in_(["open", "investigating"]),
    ).first() is not None


def scan_single_file(db: Session, file_entry: SecurityMonitoredFile, context: dict | None = None, commit_clean: bool = True, precomputed_hash: str | None = None) -> SecurityDetectionEvent | None:
    context = context or {}
    if is_database_entry(file_entry):
        return scan_database_entry(db, file_entry, context=context, commit_clean=commit_clean)
    if is_vm1_file(file_entry) and not context.get("scan_vm1_local"):
        return None
    # Skip environment files that change frequently and are environment-specific
    if Path(file_entry.file_path or "").name.lower() == ".env":
        file_entry.status = "clean"
        file_entry.last_checked = now_utc()
        db.add(file_entry)
        if commit_clean:
            db.commit()
        return None
    # Skip ML training data CSV files that may have encoding/line-ending drift
    rel_path = str(file_entry.relative_path or "").replace("\\", "/").lower()
    if "security/ml/" in rel_path and rel_path.endswith(".csv"):
        file_entry.status = "clean"
        file_entry.last_checked = now_utc()
        db.add(file_entry)
        if commit_clean:
            db.commit()
        return None
    path = portable_monitored_path(file_entry)
    old_hash = file_entry.current_hash
    backup_root = latest_backup_root(db)
    backup_source = backup_file_path(backup_root, file_entry.relative_path) if backup_root else None
    old_content = read_text(backup_source) if backup_source and backup_source.exists() else ""

    if not path.exists():
        if file_entry.status in {"verified_deleted", "verified_renamed"}:
            file_entry.current_hash = None
            file_entry.last_checked = now_utc()
            db.add(file_entry)
            if commit_clean:
                db.commit()
            return None
        if file_entry.status == "missing" and _has_open_incident(db, file_entry, "file_deleted"):
            file_entry.last_checked = now_utc()
            db.add(file_entry)
            if commit_clean:
                db.commit()
            return None
        file_entry.status = "missing"
        file_entry.current_hash = None
        file_entry.last_checked = now_utc()
        db.add(file_entry)
        db.commit()
        return record_detection(db, file_entry, "file_deleted", old_hash, None, old_content, "", context)

    stat = path.stat()
    if precomputed_hash is not None:
        current_hash = precomputed_hash
    else:
        current_hash = sha256_file(path)
    file_entry.current_hash = current_hash
    file_entry.size_bytes = stat.st_size
    file_entry.last_checked = now_utc()

    if current_hash != file_entry.baseline_hash:
        if _has_open_incident(db, file_entry, "content_modified"):
            file_entry.status = "modified"
            db.add(file_entry)
            if commit_clean:
                db.commit()
            return None
        file_entry.status = "modified"
        db.add(file_entry)
        db.commit()
        new_content = read_text(path)
        return record_detection(db, file_entry, "content_modified", old_hash, current_hash, old_content, new_content, context)

    file_entry.status = "clean"
    db.add(file_entry)
    if commit_clean:
        db.commit()
    return None


def _scan_vm1_snapshot(db: Session, file_entry: SecurityMonitoredFile, context: dict | None = None) -> SecurityDetectionEvent | None:
    """Scan a VM1 file by comparing its locally-stored snapshot to the baseline hash.

    This allows manual/interval scans on VM2 to detect VM1 file changes even when
    the manifest endpoint hasn't been triggered yet, or when bulk-change detection
    suppressed a detection.
    """
    snapshot = VM1_SNAPSHOT_ROOT / file_entry.relative_path
    if not snapshot.exists():
        return None

    current_hash = sha256_file(snapshot)
    file_entry.current_hash = current_hash
    file_entry.last_checked = now_utc()

    if not file_entry.baseline_hash or current_hash == file_entry.baseline_hash:
        file_entry.status = "clean"
        db.add(file_entry)
        return None

    if _has_open_incident(db, file_entry, "vm1_content_modified"):
        file_entry.status = "modified"
        db.add(file_entry)
        return None

    if _has_pending_vm1_restore_for_file(db, file_entry.relative_path):
        file_entry.status = "modified"
        db.add(file_entry)
        return None

    # Safety-net: if the most recent incident for this file was resolved or
    # false-positive with the SAME hash, update baseline and skip.
    recent_incident = (
        db.query(SecurityIncident)
        .join(SecurityDetectionEvent)
        .filter(SecurityDetectionEvent.file_id == file_entry.id)
        .order_by(SecurityIncident.created_at.desc())
        .first()
    )
    if recent_incident and recent_incident.status in ("resolved", "false_positive"):
        recent_detection = db.query(SecurityDetectionEvent).filter(
            SecurityDetectionEvent.id == recent_incident.detection_event_id
        ).first()
        if recent_detection and recent_detection.new_hash == current_hash:
            file_entry.baseline_hash = current_hash
            file_entry.status = "clean"
            db.add(file_entry)
            db.commit()
            logger.info(
                "VM1 safety-net (_scan_vm1_snapshot): suppressed re-detection for %s (hash %s...%s) "
                "because incident SEC-%s was already %s.",
                file_entry.relative_path, current_hash[:8], current_hash[-8:],
                recent_incident.id, recent_incident.status,
            )
            return None

    # Attempt to recover the clean (baseline) content for diff and restore.
    original_content_bytes = None
    old_content = ""
    for root in all_backup_roots(db):
        candidate = backup_file_path(root, file_entry.relative_path)
        if candidate.exists() and candidate.is_file():
            if file_entry.baseline_hash and sha256_file(candidate) == file_entry.baseline_hash:
                try:
                    original_content_bytes = candidate.read_bytes()
                    old_content = read_text(candidate)
                    break
                except Exception:
                    pass

    # Fallback: check restore-content store for a previously captured clean copy
    if original_content_bytes is None and VM1_RESTORE_CONTENT_ROOT.exists():
        for content_file in VM1_RESTORE_CONTENT_ROOT.glob("*.b64"):
            try:
                content = base64.b64decode(content_file.read_bytes())
                if hashlib.sha256(content).hexdigest() == file_entry.baseline_hash:
                    original_content_bytes = content
                    old_content = content.decode("utf-8", errors="replace")
                    break
            except Exception:
                pass

    file_entry.status = "modified"
    db.add(file_entry)
    db.commit()

    new_content = read_text(snapshot)
    return _record_vm1_detection(
        db, file_entry, "vm1_content_modified", current_hash,
        old_content=old_content, new_content=new_content,
        original_content_bytes=original_content_bytes,
    )


def record_detection(db: Session, file_entry: SecurityMonitoredFile, change_type: str, old_hash: str | None, new_hash: str | None, old_content: str, new_content: str, context: dict | None = None) -> SecurityDetectionEvent:
    # Safety-net: skip if an open incident already exists for this file and change type
    existing_incident = db.query(SecurityIncident).join(SecurityDetectionEvent).filter(
        SecurityDetectionEvent.file_id == file_entry.id,
        SecurityDetectionEvent.change_type == change_type,
        SecurityIncident.status.in_(["open", "investigating"]),
    ).first()
    if existing_incident:
        return None
    context = dict(context or {})
    context.setdefault("ai_rules", get_ai_rules(db))
    context = enrich_security_context(db, context)
    context = enrich_file_ai_context(db, file_entry, change_type, old_content, new_content, context)
    source_ip = context.get("source_ip") or context.get("client_ip") or context.get("ip_address") or "unknown"
    context.setdefault("source_ip", source_ip)
    admin_change = recent_admin_change(db, file_entry.file_path)
    is_legitimate = bool(admin_change)
    if is_legitimate:
        context.update({"admin_session_valid": True, "method_legitimate": True})
    else:
        context.setdefault("admin_session_valid", False)
        context.setdefault("method_legitimate", False)

    prediction = ai_predict(portable_monitored_path(file_entry), old_content, new_content, context)
    flags = content_flags(new_content, context, path=portable_monitored_path(file_entry))
    classification = classify(change_type, prediction, flags, context)
    if is_legitimate:
        prediction = AIPrediction("normal", 0.02, 0.98, "Valid admin token and registered admin file-change event.")
        classification = {
            "incident_type": "legitimate_change",
            "severity_level": "info",
            "cvss_score": 0.0,
            "cvss_vector": "AV:L/AC:L/PR:H/UI:N/S:U/C:N/I:N/A:N",
            "nist_category": "CAT 0 - Exercise/Test",
            "enisa_threat_type": "N/A",
        }

    changed = diff_lines(old_content, new_content)
    trigger_summary = build_trigger_summary(change_type, flags, changed, is_legitimate, source_ip)
    detection = SecurityDetectionEvent(
        file_id=file_entry.id,
        target_type=context.get("target_type") or "file",
        target_name=file_entry.relative_path,
        actor=str(admin_change.admin_id) if admin_change else context.get("actor") or source_ip or "unknown",
        change_type=change_type,
        old_hash=old_hash,
        new_hash=new_hash,
        is_legitimate=is_legitimate,
        admin_id=_valid_admin_id(db, admin_change.admin_id) if admin_change else None,
        ai_score=prediction.score,
        ai_prediction=prediction.prediction,
        confidence=prediction.confidence,
        severity_level=classification["severity_level"],
        cvss_score=classification["cvss_score"],
        nist_category=classification["nist_category"],
        enisa_threat_type=classification["enisa_threat_type"],
        trigger_summary=trigger_summary,
        accuracy_basis=prediction.basis,
        behavior_flags_json=json_dumps([BEHAVIOR_LABELS.get(flag, flag) for flag in flags]),
        changed_lines_json=json_dumps(changed),
        context_json=json_dumps(context),
    )
    db.add(detection)
    db.commit()
    db.refresh(detection)

    if not is_legitimate:
        quarantine_path = quarantine_file(portable_monitored_path(file_entry), detection.id)
        incident = create_incident(db, detection, classification, flags, changed, quarantine_path)
        recovery = None

        # Auto-recovery for web/code files, high/critical severity, or database unauthorized changes
        suffix = Path(file_entry.relative_path).suffix.lower()
        is_web_code_file = suffix in {".html", ".htm", ".jsx", ".js", ".ts", ".tsx", ".py"}
        is_high_severity = classification.get("severity_level") in {"high", "critical"}
        is_database_unauthorized = is_database_entry(file_entry) and context.get("database_unauthorized_audit_changes")
        if change_type in {"content_modified", "file_deleted"} and (is_web_code_file or is_high_severity or is_database_unauthorized):
            recovery = restore_from_backup(db, file_entry, detection.id, "automatic", None, quarantine_path)
            incident.response_action = "auto_recovered_pending_review" if recovery.status == "success" else "escalated"
            db.add(incident)
            db.commit()
        else:
            incident.response_action = "manual_review_required"
            db.add(incident)
            db.commit()

        create_incident_system_alert(db, incident, detection, recovery)
    return detection


def build_trigger_summary(change_type: str, flags: list[str], changed: dict, is_legitimate: bool, source_ip: str = "unknown") -> str:
    if is_legitimate:
        return f"Authorized admin change through MFA-protected WARDS session. Source IP: {source_ip}."
    pieces = [change_type.replace("_", " ")]
    pieces.append(f"Source IP: {source_ip}")
    if flags:
        pieces.append(", ".join(BEHAVIOR_LABELS.get(flag, flag) for flag in flags[:4]))
    added = len(changed.get("added", []))
    removed = len(changed.get("removed", []))
    if added or removed:
        pieces.append(f"{added} added and {removed} removed lines")
    return " | ".join(pieces)


_last_full_registration_at = None

def scan_all_files(db: Session, context: dict | None = None) -> list[SecurityDetectionEvent]:
    global _last_full_registration_at
    now = now_utc()
    is_manual_scan = bool(context and context.get("manual_scan"))
    if is_deployment_in_progress(db):
        logger.info("Deployment in progress — refreshing file registry without creating detections.")
        register_initial_files(db, refresh_existing=True, incremental=False)
        # Force-update baselines for ALL existing local files so post-deploy scans
        # see current_hash == baseline_hash and do not create false positives.
        for entry in active_monitored_files_query(db).all():
            if is_database_entry(entry) or is_vm1_file(entry):
                continue
            if entry.current_hash:
                entry.baseline_hash = entry.current_hash
                entry.status = "clean"
                db.add(entry)
        _last_full_registration_at = now
        set_setting(db, "last_scan_at", now_utc().isoformat(), "security_scanner")
        db.commit()
        return []
    if is_manual_scan:
        register_initial_files(db, refresh_existing=False, incremental=True)
    elif _last_full_registration_at is None or (now - _last_full_registration_at) > timedelta(hours=1):
        register_initial_files(db, refresh_existing=False, incremental=False)
        _last_full_registration_at = now
    else:
        register_initial_files(db, refresh_existing=False, incremental=True)
    migrate_portable_monitored_files(db)
    database_entry = normalize_database_monitor_entry(db, reset_baseline=False, ensure_snapshot=not is_manual_scan)
    set_setting(db, "last_scan_at", now_utc().isoformat(), "security_scanner")
    detections = []
    hash_index = current_hash_index(db)
    file_entries = active_monitored_files_query(db).order_by(SecurityMonitoredFile.relative_path.asc()).all()

    entries_to_hash = []
    for file_entry in file_entries:
        if is_database_entry(file_entry) or is_vm1_file(file_entry):
            continue
        p = portable_monitored_path(file_entry)
        if p.exists():
            entries_to_hash.append(file_entry)

    precomputed_hashes: dict[int, str] = {}

    def _hash_worker(entry: SecurityMonitoredFile) -> tuple[int, str | None]:
        p = portable_monitored_path(entry)
        try:
            return (entry.id, sha256_file(p))
        except Exception:
            return (entry.id, None)

    max_workers = min(8, (os.cpu_count() or 1))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        for entry_id, file_hash in executor.map(_hash_worker, entries_to_hash):
            if file_hash is not None:
                precomputed_hashes[entry_id] = file_hash

    for file_entry in file_entries:
        if is_vm1_file(file_entry):
            if context and context.get("manual_scan"):
                detection = _scan_vm1_snapshot(db, file_entry, context=context)
                if detection:
                    detections.append(detection)
            continue
        if is_database_entry(file_entry) and database_entry and file_entry.id != database_entry.id:
            file_entry.status = "clean"
            file_entry.last_checked = now_utc()
            db.add(file_entry)
            continue
        if not portable_monitored_path(file_entry).exists():
            replacement_path = replacement_path_for(file_entry, hash_index)
            if replacement_path:
                mark_verified_removal(db, file_entry, "verified_renamed", replacement_path=replacement_path, actor="active_scan")
                continue
        detection = scan_single_file(db, file_entry, context=context, commit_clean=False, precomputed_hash=precomputed_hashes.get(file_entry.id))
        if detection:
            detections.append(detection)
    db.commit()
    return detections


def mark_stale_backup_events_failed(db: Session, max_age_minutes: int = 10) -> int:
    cutoff = now_utc() - timedelta(minutes=max_age_minutes)
    stale_events = db.query(SecurityRecoveryEvent).filter(
        SecurityRecoveryEvent.recovery_type.like("%backup%"),
        SecurityRecoveryEvent.status == "in_progress",
        SecurityRecoveryEvent.started_at <= cutoff,
    ).all()
    for event in stale_events:
        event.status = "failed"
        event.completed_at = now_utc()
        event.error_message = event.error_message or "Backup did not complete before the timeout window."
        event.summary = event.summary or "Backup failed because it did not complete."
        db.add(event)
    if stale_events:
        db.commit()
    return len(stale_events)


def create_manual_backup(db: Session, initiated_by: int | None, label: str = "manual", skip_database_snapshot: bool = False, skip_file_registration: bool = False) -> SecurityRecoveryEvent:
    # FK safety: initiated_by may reference a VM1 admin ID that doesn't exist
    # in the security DB. Fall back to None to avoid IntegrityError.
    if initiated_by is not None:
        try:
            admin_exists = db.query(Admin).filter(Admin.id == initiated_by).first()
            if not admin_exists:
                initiated_by = None
        except OperationalError:
            # VM2 security DB may not have the full admins schema (e.g. missing full_name column)
            initiated_by = None
    seed_settings(db)
    migrate_portable_monitored_files(db)
    dedupe_monitored_files_by_relative_path(db)
    mark_stale_backup_events_failed(db)
    if not skip_file_registration:
        register_count = register_initial_files(db, ensure_backup=False, refresh_existing=False)
        dedupe_monitored_files_by_relative_path(db)
    else:
        register_count = 0
    removal_summary = reconcile_trusted_file_removals(db, actor=f"{label}_backup")
    backup_location = writable_backup_location(db)
    previous_backup_root = latest_backup_root(db)
    previous_manifest = backup_manifest_index(previous_backup_root)
    timestamp = now_utc().strftime("%Y%m%d_%H%M%S")
    backup_root = backup_location / f"{label}_backup_{timestamp}"
    started = time.time()
    model_artifact_count = 0
    event = SecurityRecoveryEvent(recovery_type="manual_backup", initiated_by=initiated_by, status="in_progress")
    db.add(event)
    db.commit()
    db.refresh(event)
    event_id = event.id
    create_system_alert(
        db,
        "backup_started",
        f"Backup #{event_id}: {label.replace('_', ' ')} backup started.",
        "low",
        dedupe_key=f"Backup #{event_id}",
    )
    logger.info("Backup %s started for label '%s' at '%s'.", event_id, label, backup_root)
    try:
        backup_root.mkdir(parents=True, exist_ok=True)
        database_entry = normalize_database_monitor_entry(db, reset_baseline=False, ensure_snapshot=not skip_database_snapshot)
        manifest_files: list[dict[str, object]] = []
        backed_up_roots: set[str] = set()
        # Clear any pending state from the setup functions to avoid
        # accumulating row locks before the main loop.
        db.commit()
        processed = 0
        entries = active_monitored_files_query(db).order_by(SecurityMonitoredFile.relative_path.asc()).all()
        for entry in entries:
            if is_database_entry(entry) and database_entry and entry.id != database_entry.id:
                entry.status = "clean"
                entry.last_checked = now_utc()
                db.add(entry)
                processed += 1
                continue
            path = portable_monitored_path(entry)
            relative = entry.relative_path or safe_rel(path)
            if is_database_entry(entry):
                checksum_path = create_database_checksum_manifest(db, path)
                snapshot_target = backup_file_path(backup_root, DATABASE_BACKUP_RELATIVE_PATH)
                if not skip_database_snapshot:
                    create_database_snapshot(db, snapshot_target)
                elif DATABASE_SNAPSHOT_PATH.exists():
                    snapshot_target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(DATABASE_SNAPSHOT_PATH, snapshot_target)
                checksum_target = backup_file_path(backup_root, DATABASE_CHECKSUM_RELATIVE_PATH)
                checksum_target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(checksum_path, checksum_target)
                file_hash = sha256_file(checksum_path)
                if not skip_database_snapshot:
                    manifest_files.append({
                        "path": DATABASE_BACKUP_RELATIVE_PATH,
                        "size_bytes": snapshot_target.stat().st_size,
                        "sha256": sha256_file(snapshot_target),
                    })
                manifest_files.append({
                    "path": DATABASE_CHECKSUM_RELATIVE_PATH,
                    "size_bytes": checksum_target.stat().st_size,
                    "sha256": file_hash,
                })
                backed_up_roots.add("wards_db")
                path = checksum_path
                relative = DATABASE_CHECKSUM_RELATIVE_PATH
            else:
                if is_vm1_file(entry):
                    snapshot = VM1_SNAPSHOT_ROOT / (entry.relative_path or "")
                    if snapshot.exists() and snapshot.is_file():
                        target = backup_file_path(backup_root, relative)
                        file_hash = sha256_file(snapshot)
                        previous_source = backup_file_path(previous_backup_root, relative) if previous_backup_root else None
                        previous_matches = bool(
                            previous_source and previous_source.exists()
                            and str(previous_manifest.get(relative, {}).get("sha256") or "") == file_hash
                        )
                        copy_into_backup(
                            snapshot,
                            target,
                            previous_source=previous_source,
                            can_reuse_previous=previous_matches,
                        )
                        manifest_files.append({
                            "path": relative,
                            "size_bytes": snapshot.stat().st_size,
                            "sha256": file_hash,
                        })
                        root_name = _clean_folder_root(str(entry.folder_root or ""))
                        if root_name:
                            backed_up_roots.add(root_name)
                    else:
                        file_hash = entry.current_hash or entry.baseline_hash
                    has_open_incident = (
                        _has_open_incident(db, entry, "vm1_content_modified")
                        or _has_open_incident(db, entry, "file_deleted")
                    )
                    if not has_open_incident:
                        entry.baseline_hash = file_hash
                        entry.current_hash = file_hash
                        entry.status = "clean"
                    else:
                        entry.current_hash = file_hash
                        entry.status = "modified"
                    entry.file_type = file_type(snapshot) if snapshot.exists() else entry.file_type
                    entry.size_bytes = snapshot.stat().st_size if snapshot.exists() else entry.size_bytes
                    entry.last_checked = now_utc()
                    db.add(entry)
                    processed += 1
                    continue
                if not path.exists() or not path.is_file():
                    continue
                target = backup_file_path(backup_root, relative)
                file_hash = sha256_file(path)
                previous_source = backup_file_path(previous_backup_root, relative) if previous_backup_root else None
                previous_matches = bool(previous_source and previous_source.exists() and str(previous_manifest.get(relative, {}).get("sha256") or "") == file_hash)
                copy_into_backup(
                    path,
                    target,
                    previous_source=previous_source,
                    can_reuse_previous=previous_matches,
                )
                manifest_files.append({
                    "path": relative,
                    "size_bytes": path.stat().st_size,
                    "sha256": file_hash,
                })
                root_name = str(entry.folder_root or "").removeprefix("VM1_").removeprefix("CUSTOM_")
                if root_name:
                    backed_up_roots.add(root_name)
            is_local_file = not is_database_entry(entry)
            has_open_incident = is_local_file and (
                _has_open_incident(db, entry, "content_modified") or _has_open_incident(db, entry, "file_deleted")
            )
            if not has_open_incident:
                entry.baseline_hash = file_hash
                entry.current_hash = file_hash
                entry.status = "clean"
            else:
                entry.current_hash = file_hash
                entry.status = "modified"
            entry.file_type = file_type(path)
            entry.size_bytes = path.stat().st_size
            entry.last_checked = now_utc()
            processed += 1
            # Incremental commit every 50 entries to avoid holding hundreds
            # of row locks at once (prevents MySQL deadlock with monitor loop).
            if processed % 50 == 0:
                db.commit()
        db.commit()
        model_artifact_count = backup_ml_artifacts(
            backup_root,
            manifest_files,
            previous_backup_root=previous_backup_root,
            previous_manifest=previous_manifest,
        )
        manifest_path = write_backup_manifest(backup_root, files=manifest_files)
        event.status = "success"
        event.backup_path = stored_path_value(backup_root) or str(backup_root)
        event.completed_at = now_utc()
        event.recovery_duration_ms = int((time.time() - started) * 1000)
        verified_deleted = removal_summary["verified_deleted"]
        verified_renamed = removal_summary["verified_renamed"]
        root_names = sorted(backed_up_roots) or ["no monitored roots"]
        event.summary = (
            f"Local backup completed for {', '.join(root_names)} "
            f"({register_count} new target(s) registered, {verified_deleted + verified_renamed} trusted removal update(s), "
            f"{model_artifact_count} ML artifact(s), "
            f"manifest: {manifest_path.name})."
        )
        set_setting(db, "latest_backup_path", stored_path_value(backup_root) or str(backup_root), str(initiated_by) if initiated_by else "system")
        removed_backups = prune_backup_type_across_locations(db, label, keep=BACKUP_RETENTION_LIMIT)
        logger.info(
            "Backup %s completed successfully. Retention kept the newest %s completed '%s' backup(s) and removed %s old backup(s).",
            event_id,
            BACKUP_RETENTION_LIMIT,
            label,
            removed_backups,
        )
    except Exception as exc:
        # Session may be rolled back (e.g., MySQL deadlock). Roll back
        # explicitly so we can safely update the event record.
        try:
            db.rollback()
        except Exception:
            pass
        event.status = "failed"
        event.error_message = str(exc)
        event.completed_at = now_utc()
        event.recovery_duration_ms = int((time.time() - started) * 1000)
        event.summary = "Local backup failed."
        logger.exception("Backup %s failed for label '%s'.", event_id, label)
    db.add(event)
    db.commit()
    db.refresh(event)
    create_system_alert(
        db,
        "backup_completed" if event.status == "success" else "backup_failed",
        f"Backup #{event.id}: {event.summary}",
        "low" if event.status == "success" else "high",
        dedupe_key=f"Backup #{event.id}",
    )
    return event


def _prepare_backup_event(
    db: Session,
    initiated_by: int | None,
    label: str,
) -> tuple[Path, Path | None, dict[str, dict[str, object]], dict[str, int], int, SecurityRecoveryEvent, float]:
    """Shared setup for all component-level backups."""
    seed_settings(db)
    migrate_portable_monitored_files(db)
    dedupe_monitored_files_by_relative_path(db)
    mark_stale_backup_events_failed(db)
    register_count = register_initial_files(db, ensure_backup=False, refresh_existing=False)
    dedupe_monitored_files_by_relative_path(db)
    removal_summary = reconcile_trusted_file_removals(db, actor=f"{label}_backup")
    backup_location = writable_backup_location(db)
    previous_backup_root = latest_backup_root(db)
    previous_manifest = backup_manifest_index(previous_backup_root)
    timestamp = now_utc().strftime("%Y%m%d_%H%M%S")
    backup_root = backup_location / f"{label}_backup_{timestamp}"
    started = time.time()
    event = SecurityRecoveryEvent(
        recovery_type=f"{label}_backup",
        initiated_by=initiated_by,
        status="in_progress",
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    create_system_alert(
        db,
        "backup_started",
        f"Backup #{event.id}: {label.replace('_', ' ')} backup started.",
        "low",
        dedupe_key=f"Backup #{event.id}",
    )
    logger.info("Backup %s started for label '%s' at '%s'.", event.id, label, backup_root)
    return backup_root, previous_backup_root, previous_manifest, removal_summary, register_count, event, started


def _finalize_backup_event(
    db: Session,
    event: SecurityRecoveryEvent,
    backup_root: Path,
    label: str,
    manifest_files: list[dict[str, object]],
    model_artifact_count: int,
    removal_summary: dict[str, int],
    register_count: int,
    started: float,
    status: str = "success",
    error: str | None = None,
) -> SecurityRecoveryEvent:
    """Shared finalization for all component-level backups."""
    if status == "success":
        manifest_path = write_backup_manifest(backup_root, files=manifest_files)
        event.status = "success"
        event.backup_path = stored_path_value(backup_root) or str(backup_root)
        event.completed_at = now_utc()
        event.recovery_duration_ms = int((time.time() - started) * 1000)
        verified_deleted = removal_summary["verified_deleted"]
        verified_renamed = removal_summary["verified_renamed"]
        event.summary = (
            f"{label.replace('_', ' ').title()} backup completed "
            f"({register_count} new target(s) registered, {verified_deleted + verified_renamed} trusted removal update(s), "
            f"{model_artifact_count} ML artifact(s), "
            f"manifest: {manifest_path.name})."
        )
        set_setting(
            db,
            "latest_backup_path",
            stored_path_value(backup_root) or str(backup_root),
            str(event.initiated_by) if event.initiated_by else "system",
        )
        removed_backups = prune_backup_type_across_locations(db, label, keep=BACKUP_RETENTION_LIMIT)
        logger.info(
            "Backup %s completed successfully. Retention kept the newest %s completed '%s' backup(s) and removed %s old backup(s).",
            event.id,
            BACKUP_RETENTION_LIMIT,
            label,
            removed_backups,
        )
    else:
        event.status = "failed"
        event.error_message = error or "Backup failed."
        event.completed_at = now_utc()
        event.recovery_duration_ms = int((time.time() - started) * 1000)
        event.summary = f"{label.replace('_', ' ').title()} backup failed."
        logger.exception("Backup %s failed for label '%s'.", event.id, label)
    db.add(event)
    db.commit()
    db.refresh(event)
    create_system_alert(
        db,
        "backup_completed" if event.status == "success" else "backup_failed",
        f"Backup #{event.id}: {event.summary}",
        "low" if event.status == "success" else "high",
        dedupe_key=f"Backup #{event.id}",
    )
    return event


def create_database_backup(
    db: Session, initiated_by: int | None, label: str = "database"
) -> SecurityRecoveryEvent:
    """Backup only the VM2 security database."""
    (
        backup_root,
        previous_backup_root,
        previous_manifest,
        removal_summary,
        register_count,
        event,
        started,
    ) = _prepare_backup_event(db, initiated_by, label)
    manifest_files: list[dict[str, object]] = []
    try:
        backup_root.mkdir(parents=True, exist_ok=True)
        database_entry = normalize_database_monitor_entry(db, reset_baseline=False, ensure_snapshot=True)
        for entry in active_monitored_files_query(db).order_by(SecurityMonitoredFile.relative_path.asc()).all():
            if is_database_entry(entry) and database_entry and entry.id != database_entry.id:
                entry.status = "clean"
                entry.last_checked = now_utc()
                db.add(entry)
                continue
            if not is_database_entry(entry):
                continue
            path = portable_monitored_path(entry)
            checksum_path = create_database_checksum_manifest(db, path)
            snapshot_target = backup_file_path(backup_root, DATABASE_BACKUP_RELATIVE_PATH)
            create_database_snapshot(db, snapshot_target)
            checksum_target = backup_file_path(backup_root, DATABASE_CHECKSUM_RELATIVE_PATH)
            checksum_target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(checksum_path, checksum_target)
            file_hash = sha256_file(checksum_path)
            manifest_files.append({
                "path": DATABASE_BACKUP_RELATIVE_PATH,
                "size_bytes": snapshot_target.stat().st_size,
                "sha256": sha256_file(snapshot_target),
            })
            manifest_files.append({
                "path": DATABASE_CHECKSUM_RELATIVE_PATH,
                "size_bytes": checksum_target.stat().st_size,
                "sha256": file_hash,
            })
            entry.baseline_hash = file_hash
            entry.current_hash = file_hash
            entry.status = "clean"
            entry.file_type = file_type(checksum_path)
            entry.size_bytes = checksum_path.stat().st_size
            entry.last_checked = now_utc()
        db.commit()
        return _finalize_backup_event(
            db, event, backup_root, label, manifest_files, 0,
            removal_summary, register_count, started, status="success",
        )
    except Exception as exc:
        return _finalize_backup_event(
            db, event, backup_root, label, manifest_files, 0,
            removal_summary, register_count, started, status="failed", error=str(exc),
        )


def create_files_backup(
    db: Session, initiated_by: int | None, label: str = "files"
) -> SecurityRecoveryEvent:
    """Backup only monitored WARDS and OCR files (not database or ML)."""
    (
        backup_root,
        previous_backup_root,
        previous_manifest,
        removal_summary,
        register_count,
        event,
        started,
    ) = _prepare_backup_event(db, initiated_by, label)
    manifest_files: list[dict[str, object]] = []
    try:
        backup_root.mkdir(parents=True, exist_ok=True)
        for entry in active_monitored_files_query(db).order_by(SecurityMonitoredFile.relative_path.asc()).all():
            if is_database_entry(entry):
                continue
            path = portable_monitored_path(entry)
            relative = entry.relative_path or safe_rel(path)
            if is_vm1_file(entry):
                snapshot = VM1_SNAPSHOT_ROOT / (entry.relative_path or "")
                if snapshot.exists() and snapshot.is_file():
                    target = backup_file_path(backup_root, relative)
                    file_hash = sha256_file(snapshot)
                    previous_source = backup_file_path(previous_backup_root, relative) if previous_backup_root else None
                    previous_matches = bool(
                        previous_source and previous_source.exists()
                        and str(previous_manifest.get(relative, {}).get("sha256") or "") == file_hash
                    )
                    copy_into_backup(
                        snapshot,
                        target,
                        previous_source=previous_source,
                        can_reuse_previous=previous_matches,
                    )
                    manifest_files.append({
                        "path": relative,
                        "size_bytes": snapshot.stat().st_size,
                        "sha256": file_hash,
                    })
                entry.baseline_hash = entry.current_hash or entry.baseline_hash
                entry.current_hash = entry.baseline_hash
                entry.status = "clean"
                entry.file_type = file_type(snapshot) if snapshot.exists() else entry.file_type
                entry.size_bytes = snapshot.stat().st_size if snapshot.exists() else entry.size_bytes
                entry.last_checked = now_utc()
                db.add(entry)
                continue
            if not path.exists() or not path.is_file():
                continue
            target = backup_file_path(backup_root, relative)
            file_hash = sha256_file(path)
            previous_source = backup_file_path(previous_backup_root, relative) if previous_backup_root else None
            previous_matches = bool(
                previous_source and previous_source.exists()
                and str(previous_manifest.get(relative, {}).get("sha256") or "") == file_hash
            )
            copy_into_backup(
                path,
                target,
                previous_source=previous_source,
                can_reuse_previous=previous_matches,
            )
            manifest_files.append({
                "path": relative,
                "size_bytes": path.stat().st_size,
                "sha256": file_hash,
            })
            has_open_incident = (
                _has_open_incident(db, entry, "content_modified") or _has_open_incident(db, entry, "file_deleted")
            )
            if not has_open_incident:
                entry.baseline_hash = file_hash
                entry.current_hash = file_hash
                entry.status = "clean"
            else:
                entry.current_hash = file_hash
                entry.status = "modified"
            entry.file_type = file_type(path)
            entry.size_bytes = path.stat().st_size
            entry.last_checked = now_utc()
        db.commit()
        return _finalize_backup_event(
            db, event, backup_root, label, manifest_files, 0,
            removal_summary, register_count, started, status="success",
        )
    except Exception as exc:
        return _finalize_backup_event(
            db, event, backup_root, label, manifest_files, 0,
            removal_summary, register_count, started, status="failed", error=str(exc),
        )


def create_ml_backup(
    db: Session, initiated_by: int | None, label: str = "ml"
) -> SecurityRecoveryEvent:
    """Backup only ML artifacts."""
    (
        backup_root,
        previous_backup_root,
        previous_manifest,
        removal_summary,
        register_count,
        event,
        started,
    ) = _prepare_backup_event(db, initiated_by, label)
    manifest_files: list[dict[str, object]] = []
    try:
        backup_root.mkdir(parents=True, exist_ok=True)
        model_artifact_count = backup_ml_artifacts(
            backup_root,
            manifest_files,
            previous_backup_root=previous_backup_root,
            previous_manifest=previous_manifest,
        )
        return _finalize_backup_event(
            db, event, backup_root, label, manifest_files, model_artifact_count,
            removal_summary, register_count, started, status="success",
        )
    except Exception as exc:
        return _finalize_backup_event(
            db, event, backup_root, label, manifest_files, 0,
            removal_summary, register_count, started, status="failed", error=str(exc),
        )


def create_full_system_backup(
    db: Session, initiated_by: int | None, label: str = "full"
) -> SecurityRecoveryEvent:
    """Full system backup covering database, files, and ML artifacts."""
    return create_manual_backup(db, initiated_by, label=label)


def recover_database(db: Session, admin_id: int) -> SecurityRecoveryEvent:
    """Restore only the VM2 security database from the latest backup."""
    db_entry = normalize_database_monitor_entry(db, reset_baseline=False, ensure_snapshot=False)
    if not db_entry:
        raise RuntimeError("No database monitor entry found.")
    return restore_database_from_backup(db, db_entry, None, "database_recovery", admin_id)


def _restore_full_backup(backup_root: Path, db: Session) -> tuple[int, int]:
    """Copy every file from a backup root back to its original location."""
    restored = 0
    failed = 0
    for source in backup_root.rglob("*"):
        if not source.is_file():
            continue
        try:
            relative = str(source.relative_to(backup_root)).replace("\\", "/")
            target = MASTER_ROOT / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            restored += 1
        except Exception:
            failed += 1
    return restored, failed


def recover_files(db: Session, admin_id: int) -> dict:
    """Restore only monitored application files from their newest valid file-domain backups."""
    started = time.time()
    restored = 0
    failed = 0
    skipped = 0
    for file_entry in (
        db.query(SecurityMonitoredFile)
        .filter(SecurityMonitoredFile.status != "monitoring_removed")
        .order_by(SecurityMonitoredFile.relative_path.asc())
        .all()
    ):
        if is_database_entry(file_entry):
            continue
        relative = str(file_entry.relative_path or "").replace("\\", "/")
        try:
            source, backup_root = newest_valid_backup_for_path(db, relative)
            if not source:
                skipped += 1
                continue
            if is_vm1_file(file_entry):
                snapshot = VM1_SNAPSHOT_ROOT / relative
                snapshot.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, snapshot)
                restored_hash = sha256_file(snapshot)
                file_entry.current_hash = restored_hash
                file_entry.baseline_hash = restored_hash
                file_entry.status = "clean"
                file_entry.size_bytes = snapshot.stat().st_size
                file_entry.last_checked = now_utc()
                db.add(file_entry)
                _create_vm1_restore_command(db, file_entry, None)
                restored += 1
                continue
            path = portable_monitored_path(file_entry)
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, path)
            restored_hash = sha256_file(path)
            file_entry.current_hash = restored_hash
            file_entry.baseline_hash = restored_hash
            file_entry.status = "recovered"
            file_entry.size_bytes = path.stat().st_size
            file_entry.last_checked = now_utc()
            db.add(file_entry)
            restored += 1
        except Exception:
            failed += 1
            continue

    db.commit()
    recovery = SecurityRecoveryEvent(
        recovery_type="files_recovery",
        initiated_by=admin_id,
        status="success" if failed == 0 else "failed",
        completed_at=now_utc(),
        recovery_duration_ms=int((time.time() - started) * 1000),
        summary=f"Application files recovery: {restored} file(s) restored, {skipped} skipped, {failed} failed.",
    )
    db.add(recovery)
    db.commit()
    db.refresh(recovery)
    alert_type = "recovery_completed" if recovery.status == "success" else "recovery_failed"
    alert_severity = "low" if recovery.status == "success" else "high"
    create_system_alert(db, alert_type, f"Recovery #{recovery.id}: {recovery.summary}", alert_severity, dedupe_key=f"Recovery #{recovery.id}")
    return {
        "restored": restored,
        "failed": failed,
        "skipped": skipped,
        "recovery_event_id": recovery.id,
    }


def recover_ml_artifacts(db: Session, admin_id: int) -> SecurityRecoveryEvent:
    """Restore only ML artifacts from the latest backup."""
    recovery = SecurityRecoveryEvent(
        recovery_type="ml_recovery",
        initiated_by=admin_id,
        status="in_progress",
    )
    db.add(recovery)
    db.commit()
    db.refresh(recovery)
    started = time.time()
    try:
        count = restore_ml_artifacts_from_backup(db)
        recovery.status = "success"
        recovery.completed_at = now_utc()
        recovery.recovery_duration_ms = int((time.time() - started) * 1000)
        recovery.summary = f"Restored {count} ML artifact(s) from the latest backup."
        db.add(recovery)
        db.commit()
        create_system_alert(
            db,
            "recovery_completed",
            f"Recovery #{recovery.id}: {recovery.summary}",
            "low",
            dedupe_key=f"Recovery #{recovery.id}",
        )
    except Exception as exc:
        recovery.status = "failed"
        recovery.error_message = str(exc)
        recovery.completed_at = now_utc()
        recovery.recovery_duration_ms = int((time.time() - started) * 1000)
        recovery.summary = "ML artifact recovery failed."
        db.add(recovery)
        db.commit()
        create_system_alert(
            db,
            "recovery_failed",
            f"Recovery #{recovery.id}: {recovery.summary} {recovery.error_message or ''}",
            "high",
            dedupe_key=f"Recovery #{recovery.id}",
        )
    db.refresh(recovery)
    return recovery


def recover_full_system(db: Session, admin_id: int) -> dict:
    """Full system recovery covering database, files, and ML artifacts."""
    return full_system_recovery(db, admin_id)


def manual_recover_file(db: Session, file_id: int, admin_id: int) -> SecurityRecoveryEvent:
    file_entry = db.query(SecurityMonitoredFile).filter(SecurityMonitoredFile.id == file_id).first()
    if not file_entry:
        raise ValueError("Monitored file not found")
    return restore_from_backup(db, file_entry, None, "manual", admin_id)


def full_system_recovery(db: Session, admin_id: int) -> dict:
    started = time.time()
    plan = {
        RECOVERY_DOMAIN_FILES: newest_valid_backup_for_domain(db, RECOVERY_DOMAIN_FILES),
        RECOVERY_DOMAIN_VM1_DATABASE: newest_valid_backup_for_domain(db, RECOVERY_DOMAIN_VM1_DATABASE),
        RECOVERY_DOMAIN_VM2_DATABASE: newest_valid_backup_for_domain(db, RECOVERY_DOMAIN_VM2_DATABASE),
        RECOVERY_DOMAIN_ML: newest_valid_backup_for_domain(db, RECOVERY_DOMAIN_ML),
    }
    results: dict[str, object] = {}
    failed = 0
    restored_domains = 0

    if not plan[RECOVERY_DOMAIN_FILES]:
        failed += 1
        results[RECOVERY_DOMAIN_FILES] = {"failed": 1, "reason": "no valid backup"}
    else:
        try:
            results[RECOVERY_DOMAIN_FILES] = recover_files(db, admin_id)
            if int(results[RECOVERY_DOMAIN_FILES].get("failed", 0)) > 0:
                failed += 1
            if int(results[RECOVERY_DOMAIN_FILES].get("restored", 0)) > 0:
                restored_domains += 1
        except Exception as exc:
            failed += 1
            results[RECOVERY_DOMAIN_FILES] = {"failed": 1, "error": str(exc)}

    results[RECOVERY_DOMAIN_VM1_DATABASE] = {
        "skipped": True,
        "reason": "vm1 database recovery is performed by the VM1 route before VM2 domain recovery",
        "backup_available": bool(plan.get(RECOVERY_DOMAIN_VM1_DATABASE)),
    }

    try:
        if plan[RECOVERY_DOMAIN_VM2_DATABASE]:
            db_entry = normalize_database_monitor_entry(db, reset_baseline=False, ensure_snapshot=False)
            if db_entry:
                event = restore_database_from_backup(db, db_entry, None, "full_vm2_database", admin_id, create_event=True)
                results[RECOVERY_DOMAIN_VM2_DATABASE] = {"restored": bool(event and event.status == "success"), "recovery_event_id": getattr(event, "id", None)}
                if not event or event.status != "success":
                    failed += 1
                else:
                    restored_domains += 1
            else:
                failed += 1
                results[RECOVERY_DOMAIN_VM2_DATABASE] = {"failed": 1, "reason": "database monitor entry missing"}
        else:
            failed += 1
            results[RECOVERY_DOMAIN_VM2_DATABASE] = {"failed": 1, "reason": "no valid backup"}
    except Exception as exc:
        failed += 1
        results[RECOVERY_DOMAIN_VM2_DATABASE] = {"failed": 1, "error": str(exc)}

    if not plan[RECOVERY_DOMAIN_ML]:
        failed += 1
        restored_ml_artifacts = 0
        results[RECOVERY_DOMAIN_ML] = {"failed": 1, "reason": "no valid backup"}
    else:
        try:
            restored_ml_artifacts = restore_ml_artifacts_from_backup(db)
            results[RECOVERY_DOMAIN_ML] = {"restored_artifacts": restored_ml_artifacts}
            if restored_ml_artifacts > 0:
                restored_domains += 1
            else:
                failed += 1
                results[RECOVERY_DOMAIN_ML]["failed"] = 1
                results[RECOVERY_DOMAIN_ML]["reason"] = "valid backup contained no restorable ML artifacts"
        except Exception as exc:
            failed += 1
            restored_ml_artifacts = 0
            results[RECOVERY_DOMAIN_ML] = {"failed": 1, "error": str(exc)}

    recovery = SecurityRecoveryEvent(
        recovery_type="full_system_recovery",
        initiated_by=admin_id,
        status="success" if failed == 0 and restored_domains > 0 else "failed",
        completed_at=now_utc(),
        recovery_duration_ms=int((time.time() - started) * 1000),
        summary=(
            "Full system recovery assembled per domain: "
            f"files={results.get(RECOVERY_DOMAIN_FILES)}, "
            f"vm1_database={results.get(RECOVERY_DOMAIN_VM1_DATABASE)}, "
            f"vm2_database={results.get(RECOVERY_DOMAIN_VM2_DATABASE)}, "
            f"ml_artifacts={restored_ml_artifacts}; restored_domains={restored_domains}; failed_domains={failed}."
        ),
    )
    db.add(recovery)
    db.commit()
    db.refresh(recovery)
    create_system_alert(db, "recovery_completed", f"Recovery #{recovery.id}: {recovery.summary}", "low", dedupe_key=f"Recovery #{recovery.id}")
    return {
        "failed_domains": failed,
        "restored_domains": restored_domains,
        "plan": {domain: (stored_path_value(root) if root else None) for domain, root in plan.items()},
        "domain_results": results,
        "restored_ml_artifacts": restored_ml_artifacts,
        "recovery_event_id": recovery.id,
    }


def mark_admin_change(db: Session, admin_id: int, file_path: str, token_id: str | None = None, ip: str | None = None, user_agent: str | None = None) -> SecurityAdminFileChange:
    change = SecurityAdminFileChange(
        admin_id=admin_id,
        file_path=file_path,
        change_type="content_modified",
        jwt_token_id=token_id,
        ip_address=ip,
        user_agent=user_agent,
    )
    db.add(change)
    db.commit()
    db.refresh(change)
    return change


class MissingFileConfirmationRequired(RuntimeError):
    def __init__(self, details: dict):
        super().__init__(details.get("message") or "Confirmation is required because incident files are missing.")
        self.details = details


def incident_missing_file_details(db: Session, incident: SecurityIncident, action: str) -> dict:
    detection = db.query(SecurityDetectionEvent).filter(SecurityDetectionEvent.id == incident.detection_event_id).first()
    file_entry = db.query(SecurityMonitoredFile).filter(SecurityMonitoredFile.id == detection.file_id).first() if detection else None
    missing_files = []
    missing_quarantine = []
    if action == "false_positive" and file_entry and not is_database_entry(file_entry) and not is_vm1_file(file_entry):
        target = portable_monitored_path(file_entry)
        if target is None or not target.exists():
            missing_files.append(file_entry.relative_path or file_entry.file_path)
    quarantine_paths = json_loads(incident.quarantine_paths_json, [])
    if action == "false_positive" and not quarantine_paths:
        missing_quarantine.append("No quarantined copy is recorded for this incident.")
    elif action in {"false_positive", "resolve"} and quarantine_paths:
        if not quarantine_paths:
            missing_quarantine.append("No quarantined copy is recorded for this incident.")
        else:
            for raw_path in quarantine_paths:
                path = safe_quarantine_path(raw_path)
                if not path or not path.exists() or not path.is_file():
                    missing_quarantine.append(str(raw_path))
    has_missing = bool(missing_files or missing_quarantine)
    label = "false positive" if action == "false_positive" else "resolved"
    message_parts = []
    if action == "resolve" and missing_quarantine and not missing_files:
        message_parts.append("Some quarantine copies are already missing.")
    elif missing_files:
        message_parts.append(f"The affected file is already deleted: {', '.join(missing_files)}.")
    if missing_quarantine:
        if action == "false_positive":
            message_parts.append(f"The quarantined copy is missing: {', '.join(missing_quarantine)}.")
    if action == "resolve" and missing_quarantine:
        message_parts.append(f"Do you still want to mark this incident as {label}? WARDS will proceed because resolving a confirmed threat only needs to remove quarantine remnants.")
    elif action == "false_positive" and missing_quarantine:
        message_parts.append(f"Do you still want to mark this incident as {label}? No reversion or backup will take place and the current file state will remain as is.")
    elif action == "false_positive" and missing_files and not missing_quarantine:
        message_parts.append(f"Do you still want to mark this incident as {label}? WARDS will restore the quarantined copy if you continue.")
    else:
        message_parts.append(f"Do you still want to mark this incident as {label}? No missing file will be restored.")
    return {
        "requires_confirmation": has_missing,
        "reason": "missing_incident_files",
        "message": " ".join(message_parts),
        "suppress_file_list": action == "resolve",
        "missing_files": missing_files,
        "missing_quarantine_paths": missing_quarantine,
    }


def ensure_missing_file_confirmation(db: Session, incidents: list[SecurityIncident], action: str, confirmed: bool) -> None:
    missing = []
    for incident in incidents:
        details = incident_missing_file_details(db, incident, action)
        if details["requires_confirmation"]:
            missing.append({"incident_id": incident.id, **details})
    if missing and not confirmed:
        if action == "resolve":
            message = "Some quarantine copies are already missing. Continue resolving the selected incidents?"
        else:
            message = "One or more affected files or quarantined copies are already deleted. Do you still want to continue?"
        raise MissingFileConfirmationRequired({
            "requires_confirmation": True,
            "reason": "missing_incident_files",
            "message": message,
            "suppress_file_list": action == "resolve",
            "incidents": missing,
        })


def resolve_incident(db: Session, incident_id: int, admin_id: int, confirm_missing_files: bool = False, *, create_event: bool = True) -> SecurityIncident:
    migrate_portable_monitored_files(db)
    dedupe_monitored_files_by_relative_path(db)
    incident = db.query(SecurityIncident).filter(SecurityIncident.id == incident_id).first()
    if not incident:
        raise ValueError("Incident not found")
    detection = db.query(SecurityDetectionEvent).filter(SecurityDetectionEvent.id == incident.detection_event_id).first()
    file_entry = db.query(SecurityMonitoredFile).filter(SecurityMonitoredFile.id == detection.file_id).first() if detection else None
    ensure_missing_file_confirmation(db, [incident], "resolve", confirm_missing_files)
    if file_entry and not is_database_entry(file_entry):
        target = portable_monitored_path(file_entry)
        restored_from_backup = False
        if is_vm1_file(file_entry):
            # VM1 file handling
            if incident.status == "resolved" and incident.response_action == "auto_recovered":
                # Already auto-recovered; just ensure quarantine is cleaned up
                cleanup_quarantine_paths(json_loads(incident.quarantine_paths_json, []))
            elif incident.response_action == "auto_recovered_pending_review":
                # Auto-recovery was already queued at detection time; admin now confirms resolution
                quarantine_paths = json_loads(incident.quarantine_paths_json, [])
                cleanup_quarantine_paths(quarantine_paths)
                quarantine_path = quarantine_paths[0] if quarantine_paths else None
                safe_quarantine = safe_quarantine_path(quarantine_path) if quarantine_path else None
                # Find the restore command created during auto-recovery and use its clean
                # content to update the snapshot and baseline. Do NOT use quarantine
                # (it contains the defaced version).
                clean_hash = None
                detection_id = detection.id if detection else None
                if detection_id:
                    commands = json_loads(get_setting(db, "vm1_restore_commands", "[]"), [])
                    cmd = next((c for c in commands if c.get("detection_id") == detection_id), None)
                    if cmd:
                        content_file = cmd.get("restore_content_file")
                        if content_file:
                            try:
                                content_path = Path(content_file)
                                if content_path.exists():
                                    clean_bytes = base64.b64decode(content_path.read_bytes())
                                    snapshot = VM1_SNAPSHOT_ROOT / file_entry.relative_path
                                    snapshot.parent.mkdir(parents=True, exist_ok=True)
                                    snapshot.write_bytes(clean_bytes)
                                    clean_hash = hashlib.sha256(clean_bytes).hexdigest()
                            except Exception:
                                pass
                if not clean_hash:
                    # Fallback: use current snapshot only if it matches the existing
                    # baseline (meaning it wasn't overwritten by a defaced version).
                    snapshot = VM1_SNAPSHOT_ROOT / file_entry.relative_path
                    if snapshot.exists():
                        try:
                            snapshot_hash = sha256_file(snapshot)
                            if snapshot_hash == file_entry.baseline_hash:
                                clean_hash = snapshot_hash
                        except Exception:
                            pass
                if clean_hash:
                    file_entry.baseline_hash = clean_hash
                    file_entry.current_hash = clean_hash
                    file_entry.status = "clean"
                else:
                    file_entry.status = "modified"
                file_entry.last_checked = now_utc()
                db.add(file_entry)
                if create_event:
                    recovery = SecurityRecoveryEvent(
                        detection_event_id=detection.id if detection else None,
                        file_id=file_entry.id,
                        recovery_type="vm1_restore_confirmed",
                        initiated_by=_valid_admin_id(db, admin_id),
                        status="success",
                        quarantine_path=str(safe_quarantine) if safe_quarantine else None,
                        summary=f"Admin resolved: auto-recovery confirmed for {file_entry.relative_path}.",
                        completed_at=now_utc(),
                    )
                    db.add(recovery)
                    db.commit()
                    # Trigger a post-resolve backup so the restored state becomes the trusted baseline.
                    def _post_resolve_backup():
                        bg_db = SessionLocal()
                        try:
                            post_resolve_backup = create_manual_backup(bg_db, initiated_by=_valid_admin_id(bg_db, admin_id), label="post_resolve", skip_database_snapshot=True, skip_file_registration=True)
                            if post_resolve_backup.status == "success":
                                bg_incident = bg_db.query(SecurityIncident).filter(SecurityIncident.id == incident.id).first()
                                if bg_incident:
                                    bg_incident.response_action = "resolved_clean_backup_refreshed"
                                    bg_db.add(bg_incident)
                                    bg_db.commit()
                        except Exception as backup_exc:
                            logger.warning("Post-resolve backup failed: %s", backup_exc)
                        finally:
                            bg_db.close()
                    _run_async_backup(_post_resolve_backup)
            else:
                # Manual resolve: search backups for clean content matching the trusted baseline
                original_bytes = None
                candidate, found_backup_root = newest_valid_backup_for_path(db, file_entry.relative_path, file_entry.baseline_hash)
                if candidate and candidate.exists() and candidate.is_file():
                    try:
                        original_bytes = candidate.read_bytes()
                    except Exception:
                        original_bytes = None
                quarantine_paths = json_loads(incident.quarantine_paths_json, [])
                quarantine_path = quarantine_paths[0] if quarantine_paths else None
                safe_quarantine = safe_quarantine_path(quarantine_path) if quarantine_path else None
                if original_bytes is None:
                    # Fallback to quarantine (stores the last known clean snapshot)
                    if safe_quarantine and safe_quarantine.exists():
                        try:
                            original_bytes = safe_quarantine.read_bytes()
                        except Exception:
                            pass
                    if original_bytes is None:
                        logger.warning(
                            "No clean backup matching baseline hash %s or quarantine found for %s; "
                            "cannot restore file content.",
                            file_entry.baseline_hash,
                            file_entry.relative_path,
                        )
                if original_bytes is not None:
                    # Write clean snapshot on VM2 so backup and baseline use the original trusted content
                    snapshot = VM1_SNAPSHOT_ROOT / file_entry.relative_path
                    snapshot.parent.mkdir(parents=True, exist_ok=True)
                    snapshot.write_bytes(original_bytes)
                    clean_hash = hashlib.sha256(original_bytes).hexdigest()
                    file_entry.baseline_hash = clean_hash
                    file_entry.current_hash = clean_hash
                    file_entry.status = "clean"
                else:
                    # No clean backup found — accept the current state as the new baseline
                    # so the file stops getting re-detected on every scan.
                    file_entry.baseline_hash = file_entry.current_hash
                    file_entry.status = "clean"
                file_entry.last_checked = now_utc()
                db.add(file_entry)
                if detection and original_bytes is not None:
                    cmd = _create_vm1_restore_command(db, file_entry, detection.id, original_content_bytes=original_bytes)
                    if create_event:
                        recovery = SecurityRecoveryEvent(
                            detection_event_id=detection.id,
                            file_id=file_entry.id,
                            recovery_type="vm1_restore_queued",
                            initiated_by=_valid_admin_id(db, admin_id),
                            status="success",
                            quarantine_path=str(safe_quarantine) if safe_quarantine else None,
                            summary=f"Resolved incident: restored {file_entry.relative_path} from {found_backup_root.name if found_backup_root else 'quarantine'}.",
                            completed_at=now_utc(),
                        )
                        db.add(recovery)
                        db.commit()
                    cleanup_quarantine_paths(quarantine_paths)
                    # Trigger a post-resolve backup so the restored state becomes the trusted baseline
                    incident_id = incident.id
                    def _post_resolve_backup():
                        bg_db = SessionLocal()
                        try:
                            post_resolve_backup = create_manual_backup(bg_db, initiated_by=_valid_admin_id(bg_db, admin_id), label="post_resolve", skip_database_snapshot=True, skip_file_registration=True)
                            if post_resolve_backup.status == "success":
                                bg_incident = bg_db.query(SecurityIncident).filter(SecurityIncident.id == incident_id).first()
                                if bg_incident:
                                    bg_incident.response_action = "resolved_clean_backup_refreshed"
                                    bg_db.add(bg_incident)
                                    bg_db.commit()
                        except Exception as backup_exc:
                            logger.warning("Post-resolve backup failed: %s", backup_exc)
                        finally:
                            bg_db.close()
                    _run_async_backup(_post_resolve_backup)
        else:
            # Local file handling
            if incident.response_action == "auto_recovered_pending_review":
                # Auto-recovery already ran at detection time; admin now confirms resolution
                file_entry.status = "clean"
                file_entry.last_checked = now_utc()
                file_entry.baseline_hash = file_entry.current_hash or file_entry.baseline_hash
                db.add(file_entry)
                if create_event:
                    recovery = SecurityRecoveryEvent(
                        detection_event_id=detection.id if detection else None,
                        file_id=file_entry.id,
                        recovery_type="auto_recovery_confirmed",
                        initiated_by=_valid_admin_id(db, admin_id),
                        status="success",
                        summary=f"Admin resolved: auto-recovery confirmed for {file_entry.relative_path}.",
                        completed_at=now_utc(),
                    )
                    db.add(recovery)
                    db.commit()
            else:
                # Manual resolve: search all backups for one matching the trusted baseline
                expected_hash = file_entry.baseline_hash
                backup_source, backup_root = newest_valid_backup_for_path(db, file_entry.relative_path, expected_hash)
                if backup_source is None:
                    logger.warning(
                        "No backup matching baseline hash %s found for %s; skipping restoration.",
                        expected_hash,
                        file_entry.relative_path,
                    )
                    if create_event:
                        recovery = SecurityRecoveryEvent(
                            detection_event_id=incident.detection_event_id,
                            file_id=file_entry.id,
                            recovery_type="resolve",
                            initiated_by=_valid_admin_id(db, admin_id),
                            status="failed",
                            error_message=f"No valid backup matching baseline hash {expected_hash} found.",
                            summary=f"Resolve attempted for {file_entry.relative_path}, but no domain-valid trusted backup was available.",
                            completed_at=now_utc(),
                        )
                        db.add(recovery)
                if backup_source and backup_source.exists() and backup_source.is_file():
                    if not target.exists() or not target.is_file() or sha256_file(target) != file_entry.baseline_hash:
                        started = time.time()
                        if create_event:
                            recovery = SecurityRecoveryEvent(
                                detection_event_id=incident.detection_event_id,
                                file_id=file_entry.id,
                                recovery_type="resolve",
                                initiated_by=_valid_admin_id(db, admin_id),
                                status="success",
                                backup_path=str(backup_source),
                                summary=f"Resolved incident restored trusted file for {file_entry.relative_path}.",
                            )
                        target.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(backup_source, target)
                        if create_event:
                            recovery.completed_at = now_utc()
                            recovery.recovery_duration_ms = int((time.time() - started) * 1000)
                            db.add(recovery)
                        restored_from_backup = True
                if target.exists() and target.is_file():
                    current_hash = sha256_file(target)
                    file_entry.current_hash = current_hash
                    if restored_from_backup:
                        file_entry.baseline_hash = current_hash
                    file_entry.status = "clean" if current_hash == file_entry.baseline_hash else "modified"
                    file_entry.size_bytes = target.stat().st_size
                else:
                    # For VM1 files the local target may not exist on VM2; accept the current
                    # snapshot hash as clean when the admin confirms missing files.
                    if confirm_missing_files and file_entry.current_hash:
                        file_entry.baseline_hash = file_entry.current_hash
                        file_entry.status = "clean"
                    else:
                        file_entry.current_hash = None
                        file_entry.status = "missing"
                file_entry.last_checked = now_utc()
                db.add(file_entry)
    incident.status = "resolved"
    incident.resolved_at = now_utc()
    incident.resolved_by = _valid_admin_id(db, admin_id)
    if not incident.response_action or incident.response_action in {"monitoring", "vm1_restore_pending"}:
        incident.response_action = "resolved_clean_backup_retained"
    cleanup_quarantine_paths(json_loads(incident.quarantine_paths_json, []))
    db.add(incident)
    # Resolve any other open incidents for the same file to prevent duplicates
    if detection and detection.file_id is not None:
        for other in db.query(SecurityIncident).join(SecurityDetectionEvent).filter(
            SecurityDetectionEvent.file_id == detection.file_id,
            SecurityIncident.id != incident.id,
            SecurityIncident.status.in_(["open", "investigating"]),
        ).all():
            other.status = "resolved"
            other.resolved_at = now_utc()
            other.resolved_by = _valid_admin_id(db, admin_id)
            other.response_action = "resolved_clean_backup_retained"
            cleanup_quarantine_paths(json_loads(other.quarantine_paths_json, []))
            db.add(other)
    db.commit()
    db.refresh(incident)
    if create_event:
        create_system_alert(db, "incident_resolved", f"SEC-{incident.id}: Incident resolved. Quarantine was cleared and trusted backup baseline was retained.", "low", dedupe_key=f"SEC-{incident.id}")
    return incident


def mark_false_positive(db: Session, incident_id: int, admin_id: int, refresh_backup: bool = True, confirm_missing_files: bool = False, *, create_event: bool = True) -> SecurityIncident:
    migrate_portable_monitored_files(db)
    dedupe_monitored_files_by_relative_path(db)
    incident = db.query(SecurityIncident).filter(SecurityIncident.id == incident_id).first()
    if not incident:
        raise ValueError("Incident not found")
    detection = db.query(SecurityDetectionEvent).filter(SecurityDetectionEvent.id == incident.detection_event_id).first()
    file_entry = db.query(SecurityMonitoredFile).filter(SecurityMonitoredFile.id == detection.file_id).first() if detection else None
    quarantine_paths = json_loads(incident.quarantine_paths_json, [])
    if isinstance(quarantine_paths, str):
        quarantine_paths = [quarantine_paths]

    ensure_missing_file_confirmation(db, [incident], "false_positive", confirm_missing_files)

    # Non-file incidents (e.g., vm1_host_silent) have no file_entry and no quarantine.
    # For these, resolve and false_positive are equivalent — just mark the status.
    is_non_file_incident = not file_entry or (detection and detection.target_type in {"vm1_host", "system"})
    if is_non_file_incident:
        if detection:
            detection.is_legitimate = True
            detection.ai_prediction = "normal"
            detection.ai_score = 0.0
            detection.confidence = 1.0
            detection.severity_level = "info"
            detection.trigger_summary = f"False positive accepted by admin for {detection.target_name}."
            db.add(detection)
        incident.status = "false_positive"
        incident.response_action = "authorized_non_file_acknowledged"
        incident.resolved_at = now_utc()
        incident.resolved_by = _valid_admin_id(db, admin_id)
        db.add(incident)
        db.commit()
        if create_event:
            create_system_alert(
                db,
                "incident_false_positive",
                f"SEC-{incident.id}: Incident marked false positive. Non-file incident acknowledged; no file restoration was performed.",
                "low",
                dedupe_key=f"SEC-{incident.id}",
            )
        return incident

    quarantine_source = quarantine_paths[0] if quarantine_paths else None
    safe_source = safe_quarantine_path(quarantine_source) if quarantine_source else None
    has_quarantine_copy = bool(safe_source and safe_source.exists() and safe_source.is_file())
    if not has_quarantine_copy and not confirm_missing_files:
        raise ValueError("Incident has no quarantined copy to restore")
    false_positive_recovery = None
    if is_vm1_file(file_entry):
        # VM1 false+: accept the defaced state as legitimate
        defaced_hash = None
        if has_quarantine_copy:
            try:
                defaced_hash = sha256_file(safe_source)
            except OSError:
                defaced_hash = None
        if not defaced_hash:
            defaced_hash = detection.new_hash if detection and detection.new_hash else file_entry.current_hash
        file_entry.baseline_hash = defaced_hash
        file_entry.current_hash = defaced_hash
        file_entry.status = "clean"
        file_entry.last_checked = now_utc()
        db.add(file_entry)
        if has_quarantine_copy:
            if incident.response_action in {"auto_recovered", "auto_recovered_pending_review"}:
                # Auto-recovery already ran (or was queued); push the defaced snapshot back to VM1
                defaced_snapshot = VM1_DEFACED_SNAPSHOT_ROOT / file_entry.relative_path
                defaced_bytes = None
                if defaced_snapshot.exists():
                    try:
                        defaced_bytes = defaced_snapshot.read_bytes()
                    except Exception:
                        pass
                if defaced_bytes is not None:
                    # Update VM2 snapshot to defaced so backup baseline matches
                    snapshot = VM1_SNAPSHOT_ROOT / file_entry.relative_path
                    snapshot.parent.mkdir(parents=True, exist_ok=True)
                    snapshot.write_bytes(defaced_bytes)
                    defaced_hash = hashlib.sha256(defaced_bytes).hexdigest()
                    file_entry.baseline_hash = defaced_hash
                    file_entry.current_hash = defaced_hash
                    db.add(file_entry)
                _create_vm1_restore_command(db, file_entry, incident.detection_event_id, original_content_bytes=defaced_bytes)
                if create_event:
                    false_positive_recovery = SecurityRecoveryEvent(
                        detection_event_id=incident.detection_event_id,
                        file_id=file_entry.id,
                        recovery_type="reverted",
                        initiated_by=_valid_admin_id(db, admin_id),
                        status="success",
                        quarantine_path=str(safe_source),
                        summary=f"False positive: auto-recovery reverted for {file_entry.relative_path}.",
                        completed_at=now_utc(),
                    )
                    db.add(false_positive_recovery)
                    db.commit()
            else:
                # Non-priority VM1 file: copy quarantined copy to snapshot so VM2 baseline matches
                target = VM1_SNAPSHOT_ROOT / file_entry.relative_path
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(safe_source, target)
                try:
                    defaced_hash = sha256_file(target)
                    file_entry.baseline_hash = defaced_hash
                    file_entry.current_hash = defaced_hash
                    db.add(file_entry)
                except OSError:
                    pass
                if create_event:
                    false_positive_recovery = SecurityRecoveryEvent(
                        detection_event_id=incident.detection_event_id,
                        file_id=file_entry.id,
                        recovery_type="reverted",
                        initiated_by=_valid_admin_id(db, admin_id),
                        status="success",
                        quarantine_path=str(safe_source),
                        summary=f"False positive: quarantined copy restored to snapshot for {file_entry.relative_path}.",
                        completed_at=now_utc(),
                    )
                    db.add(false_positive_recovery)
                    db.commit()
            cleanup_quarantine_paths(quarantine_paths)
    elif has_quarantine_copy:
        false_positive_recovery = restore_quarantined_copy_to_original(
            db,
            file_entry,
            str(safe_source),
            admin_id,
            incident.detection_event_id,
            create_event=create_event,
        )
        if false_positive_recovery and false_positive_recovery.status != "reverted":
            raise RuntimeError(false_positive_recovery.error_message or "Unable to restore the quarantined file")
        cleanup_quarantine_paths(quarantine_paths)
    if detection:
        detection.is_legitimate = True
        detection.ai_prediction = "normal"
        detection.ai_score = 0.0
        detection.confidence = 1.0
        detection.severity_level = "info"
        detection.trigger_summary = f"False positive accepted by admin; {'authorized quarantined copy restored to its original location' if has_quarantine_copy else 'missing file acknowledged'} for {detection.target_name}."
        db.add(detection)
    if create_event:
        for recovery in db.query(SecurityRecoveryEvent).filter(SecurityRecoveryEvent.detection_event_id == incident.detection_event_id).all():
            if false_positive_recovery and recovery.id == false_positive_recovery.id:
                continue
            if "backup" not in (recovery.recovery_type or ""):
                recovery.status = "reverted"
                recovery.summary = "False positive accepted; previous recovery was reversed to the quarantined incident state." if has_quarantine_copy else "False positive accepted after admin confirmed the affected or quarantined file is missing."
            db.add(recovery)
    incident.status = "false_positive"
    incident.response_action = "authorized_quarantined_copy_restored" if has_quarantine_copy else "authorized_change_missing_file_acknowledged"
    incident.resolved_at = now_utc()
    incident.resolved_by = _valid_admin_id(db, admin_id)
    db.add(incident)
    # Mark any other open incidents for the same file as false_positive to prevent duplicates
    if detection and detection.file_id is not None:
        for other in db.query(SecurityIncident).join(SecurityDetectionEvent).filter(
            SecurityDetectionEvent.file_id == detection.file_id,
            SecurityIncident.id != incident.id,
            SecurityIncident.status.in_(["open", "investigating"]),
        ).all():
            other.status = "false_positive"
            other.resolved_at = now_utc()
            other.resolved_by = _valid_admin_id(db, admin_id)
            other.response_action = incident.response_action
            db.add(other)
    db.commit()
    backup_refreshed = False
    backup_refresh_failed = False
    if has_quarantine_copy:
        if refresh_backup:
            # Run slow full backup in background to avoid HTTP timeout
            def _fp_backup():
                bg_db = SessionLocal()
                try:
                    backup_event = create_manual_backup(bg_db, _valid_admin_id(bg_db, admin_id), label="false_positive", skip_database_snapshot=True, skip_file_registration=True)
                    if backup_event.status == "success":
                        bg_incident = bg_db.query(SecurityIncident).filter(SecurityIncident.id == incident.id).first()
                        if bg_incident:
                            bg_incident.response_action = "authorized_change_restored_backup_refreshed"
                            bg_db.add(bg_incident)
                            bg_db.commit()
                except Exception as exc:
                    logger.warning("False-positive background backup failed: %s", exc)
                finally:
                    bg_db.close()
            _run_async_backup(_fp_backup)
            backup_refresh_failed = True  # Will be corrected by background thread if backup succeeds
            incident.response_action = "authorized_change_restored_backup_failed"
            db.add(incident)
            db.commit()
        cleanup_quarantine_paths([str(safe_source)])
    if has_quarantine_copy and refresh_backup:
        false_positive_summary = "Quarantined copy restored; backup baseline refresh queued in background."
    elif has_quarantine_copy:
        false_positive_summary = "Quarantined copy restored; backup baseline will be refreshed by the bulk operation."
    else:
        false_positive_summary = "Missing quarantine acknowledged; no reversion or backup was performed."
    if create_event:
        create_system_alert(
            db,
            "incident_false_positive",
            f"SEC-{incident.id}: Incident marked false positive. {false_positive_summary}",
            "medium",
            dedupe_key=f"SEC-{incident.id}",
        )
    db.refresh(incident)
    return incident


def bulk_update_incidents(db: Session, action: str, admin_id: int, confirm_missing_files: bool = False) -> dict:
    migrate_portable_monitored_files(db)
    dedupe_monitored_files_by_relative_path(db)
    updated = 0
    rows = db.query(SecurityIncident).filter(SecurityIncident.status.in_(["open", "investigating"])).order_by(SecurityIncident.id.asc()).all()
    if action in {"resolve", "false_positive"}:
        ensure_missing_file_confirmation(db, rows, action, confirm_missing_files)
    started = time.time()
    failed = 0
    for incident in rows:
        try:
            if action == "resolve":
                resolve_incident(db, incident.id, admin_id, confirm_missing_files=confirm_missing_files, create_event=False)
                updated += 1
            elif action == "false_positive":
                mark_false_positive(db, incident.id, admin_id, refresh_backup=False, confirm_missing_files=confirm_missing_files, create_event=False)
                updated += 1
            elif action == "investigating":
                incident.status = "investigating"
                incident.response_action = "under_review"
                db.add(incident)
                db.commit()
                updated += 1
            else:
                raise ValueError("Unsupported bulk incident action")
        except Exception:
            failed += 1
    if action == "false_positive" and updated:
        def _bulk_fp_backup():
            bg_db = SessionLocal()
            try:
                create_manual_backup(bg_db, _valid_admin_id(bg_db, admin_id), label="false_positive_bulk", skip_database_snapshot=True, skip_file_registration=True)
            except Exception as exc:
                logger.warning("Bulk false-positive background backup failed: %s", exc)
            finally:
                bg_db.close()
        _run_async_backup(_bulk_fp_backup)
    recovery = SecurityRecoveryEvent(
        recovery_type="bulk_incident_update",
        initiated_by=_valid_admin_id(db, admin_id),
        status="success" if failed == 0 else "failed",
        completed_at=now_utc(),
        recovery_duration_ms=int((time.time() - started) * 1000),
        summary=f"Bulk {action}: {updated} incident(s) updated, {failed} failed.",
    )
    db.add(recovery)
    db.commit()
    db.refresh(recovery)
    create_system_alert(db, "bulk_incident_update", f"Bulk {action}: {updated} incident(s) updated, {failed} failed.", "low", dedupe_key=f"bulk-{action}-{updated}")
    return {"updated": updated, "failed": failed, "action": action, "recovery_event_id": recovery.id}


def dashboard_payload(db: Session) -> dict:
    runtime_env = sync_runtime_env_settings(db)
    monitored_files_count = active_monitored_files_query(db).count()
    file_attention_count = active_monitored_files_query(db).filter(
        SecurityMonitoredFile.status.in_(["modified", "missing", "compromised"])
    ).count()
    incidents = db.query(SecurityIncident).filter(SecurityIncident.status.in_(["open", "investigating"])).all()
    detection_attention_count = db.query(SecurityDetectionEvent).filter(SecurityDetectionEvent.is_legitimate == False).count()
    recovery_attention_count = db.query(SecurityRecoveryEvent).filter(SecurityRecoveryEvent.status.in_(["failed", "reverted"])).count()
    last_detection = db.query(SecurityDetectionEvent).order_by(SecurityDetectionEvent.detected_at.desc()).first()
    last_scan_at = get_setting(db, "last_scan_at", "")
    backup_location = get_setting(db, "backup_location", str(DEFAULT_BACKUP_ROOT))
    backup_location_path = resolve_stored_path(backup_location)
    latest_backup = latest_backup_root(db)
    model_metadata = load_ai_model_metadata()
    severity = {key: 0 for key in ["info", "low", "medium", "high", "critical"]}
    attack_types = {}
    behaviors = {}
    chart_cutoff = datetime.utcnow() - timedelta(days=30)
    chart_incidents = db.query(SecurityIncident).filter(SecurityIncident.created_at >= chart_cutoff).all()
    for incident in chart_incidents:
        severity[incident.severity_level or "info"] = severity.get(incident.severity_level or "info", 0) + 1
        attack_types[incident.incident_type] = attack_types.get(incident.incident_type, 0) + 1
        for behavior in json_loads(incident.behaviors_json, []):
            behaviors[behavior] = behaviors.get(behavior, 0) + 1
    schedule = json_loads(get_setting(db, "backup_schedule", "{}"), {})
    next_backup = schedule.get("next_run") or "Not scheduled"
    status = "Protected"
    if any(item.severity_level in {"high", "critical"} for item in incidents):
        status = "Compromised"
    elif incidents:
        status = "At Risk"
    monitoring_enabled = (get_setting(db, "monitoring_enabled", "false") or "false").lower() == "true"
    ml_model_trained = IFOREST_MODEL_PATH.exists()
    iforest_metadata = load_isolation_forest_metadata()

    # Today's counts
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_incidents = db.query(SecurityIncident).filter(SecurityIncident.created_at >= today_start).count()
    today_detections = db.query(SecurityDetectionEvent).filter(SecurityDetectionEvent.detected_at >= today_start).count()
    today_high_severity = db.query(SecurityIncident).filter(
        SecurityIncident.created_at >= today_start,
        SecurityIncident.severity_level.in_(["high", "critical"]),
    ).count()

    return {
        "system_status": status,
        "monitored_files": monitored_files_count,
        "active_incidents": len(incidents),
        "last_scan": last_scan_at or (last_detection.detected_at.isoformat() if last_detection else None),
        "next_scheduled_backup": next_backup,
        "severity_distribution": severity,
        "attack_types": attack_types,
        "behaviors": behaviors,
        "today_summary": {
            "incidents": today_incidents,
            "detections": today_detections,
            "high_severity": today_high_severity,
            "recommendation": _today_recommendation(today_incidents, today_high_severity, status),
        },
        "traffic_summaries": {
            "severity": summarize_chart("severity", severity),
            "attacks": summarize_chart("attacks", attack_types),
            "behaviors": summarize_chart("behaviors", behaviors),
        },
        "notification_counts": {
            "dashboard": len(incidents),
            "files": file_attention_count,
            "detections": detection_attention_count,
            "recoveries": recovery_attention_count,
            "incidents": len(incidents),
        },
        "health": {
            "wazuh_agent": "Active" if monitoring_enabled else "Inactive",
            "database": "healthy",
            "backup_status": "Active" if latest_backup and backup_location_path and backup_location_path.exists() else "Inactive",
            "backup_location": backup_location,
            "ai_model": "trained" if (MODEL_STATE_PATH.exists() or ml_model_trained) else "bootstrap-ready",
            "ai_model_version": model_metadata.get("version") or get_setting(db, "ai_model_version", ""),
            "ml_model_trained": ml_model_trained,
            "ml_model_version": iforest_metadata.get("version", ""),
            "ml_model_path": str(IFOREST_MODEL_PATH) if ml_model_trained else None,
            "ai_rules_enabled": sum(1 for item in get_ai_rules(db).values() if item.get("enabled", True)),
            "deployment_mode": get_setting(db, "deployment_mode", "development"),
            "monitoring_enabled": "true" if monitoring_enabled else "false",
            "scan_interval_seconds": get_setting(db, "scan_interval_seconds", "30"),
            "last_interval_scan_status": get_setting(db, "last_interval_scan_status", "unknown"),
            "time_source": time_source_label(),
        },
    }


def summarize_chart(kind: str, data: dict) -> str:
    if not data:
        return "No events are recorded yet, so the chart is still waiting for security data."
    total = sum(int(value) for value in data.values())
    if total == 0:
        return "No activity has been detected yet."
    top_key, top_value = sorted(data.items(), key=lambda item: item[1], reverse=True)[0]
    label = str(top_key).replace("_", " ").title()
    if kind == "severity":
        if label.lower() in {"high", "critical"}:
            return f"{label} severity dominates the threat landscape ({top_value} of {total} incidents). Immediate review and hardening of affected systems is strongly recommended."
        if label.lower() == "medium":
            return f"{label} severity is most common ({top_value} of {total} incidents). Review patterns and consider proactive mitigations before escalation."
        return f"{label} severity is most common ({top_value} of {total} incidents). Monitor trends and investigate any clustering."
    if kind == "attacks":
        return f"{label} is the most frequent attack vector ({top_value} of {total} incidents). Prioritize defensive controls targeting this vector — consider rule hardening, access restrictions, or staff awareness training."
    return f"{label} is the top flagged behavior ({top_value} of {total} occurrences). Correlate with user or system activity to identify potential insider threats or compromised credentials."


def _today_recommendation(today_incidents: int, today_high: int, status: str) -> str:
    if status == "Compromised":
        return f"Today's Report: {today_incidents} incident(s) detected, including {today_high} high or critical severity. The system is currently flagged as compromised. Immediate administrator intervention, incident containment, and a full security audit are required."
    if today_high > 0:
        return f"Today's Report: {today_incidents} incident(s) detected today with {today_high} high-severity event(s). Escalate to the security team and review affected files or user sessions immediately."
    if today_incidents > 0:
        return f"Today's Report: {today_incidents} incident(s) detected today. No critical severity events so far, but continuous monitoring is advised. Review low-severity flags for patterns that may signal reconnaissance or early-stage intrusion."
    return "Today's Report: No new incidents detected today. Security posture is stable, but maintain routine monitoring and scheduled backups to preserve this state."


def query_detections(db: Session, keyword: str | None = None, date_from: str | None = None, date_to: str | None = None, target: str | None = None, severity: str | None = None, limit: int = 200, sort: str = "newest", classification: str | None = None) -> list[SecurityDetectionEvent]:
    query = db.query(SecurityDetectionEvent)
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(or_(SecurityDetectionEvent.target_name.like(like), SecurityDetectionEvent.trigger_summary.like(like), SecurityDetectionEvent.actor.like(like)))
    if target:
        query = query.filter(SecurityDetectionEvent.target_name.like(f"%{target}%"))
    if severity:
        query = query.filter(SecurityDetectionEvent.severity_level == severity)
    if classification:
        if classification == "legitimate":
            query = query.filter(SecurityDetectionEvent.is_legitimate == True)
        else:
            query = query.filter(SecurityDetectionEvent.ai_prediction == classification)
    if date_from:
        query = query.filter(SecurityDetectionEvent.detected_at >= datetime.fromisoformat(date_from))
    if date_to:
        end_value = f"{date_to}T23:59:59" if len(date_to) == 10 else date_to
        query = query.filter(SecurityDetectionEvent.detected_at <= datetime.fromisoformat(end_value))
    order = SecurityDetectionEvent.detected_at.asc() if sort == "oldest" else SecurityDetectionEvent.detected_at.desc()
    return query.order_by(order).limit(limit).all()


def query_recoveries(db: Session, keyword: str | None = None, date_from: str | None = None, date_to: str | None = None, recovery_type: str | None = None, status: str | None = None, limit: int = 200, sort: str = "newest") -> list[SecurityRecoveryEvent]:
    query = db.query(SecurityRecoveryEvent)
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(or_(SecurityRecoveryEvent.summary.like(like), SecurityRecoveryEvent.backup_path.like(like), SecurityRecoveryEvent.error_message.like(like)))
    if recovery_type:
        if recovery_type == "reverted":
            query = query.filter(or_(SecurityRecoveryEvent.recovery_type.in_(["reverted", "false_positive_restore"]), SecurityRecoveryEvent.status == "reverted"))
        else:
            query = query.filter(SecurityRecoveryEvent.recovery_type == recovery_type)
    if status:
        if status == "reverted":
            query = query.filter(or_(SecurityRecoveryEvent.status == "reverted", SecurityRecoveryEvent.recovery_type.in_(["reverted", "false_positive_restore"])))
        else:
            query = query.filter(SecurityRecoveryEvent.status == status)
    if date_from:
        query = query.filter(SecurityRecoveryEvent.started_at >= datetime.fromisoformat(date_from))
    if date_to:
        end_value = f"{date_to}T23:59:59" if len(date_to) == 10 else date_to
        query = query.filter(SecurityRecoveryEvent.started_at <= datetime.fromisoformat(end_value))
    order = SecurityRecoveryEvent.started_at.asc() if sort == "oldest" else SecurityRecoveryEvent.started_at.desc()
    return query.order_by(order).limit(limit).all()


def weekly_ai_behavior_data(db: Session) -> dict:
    raw_since = get_setting(db, "ai_last_retrained_at", "")
    since = datetime.fromisoformat(raw_since) if raw_since else now_utc() - timedelta(days=7)
    changes = db.query(SecurityAdminFileChange).filter(SecurityAdminFileChange.timestamp >= since).order_by(SecurityAdminFileChange.timestamp.desc()).all()
    detections = db.query(SecurityDetectionEvent).filter(SecurityDetectionEvent.detected_at >= since).order_by(SecurityDetectionEvent.detected_at.desc()).all()
    behaviors: dict[str, int] = {}
    for detection in detections:
        for behavior in json_loads(detection.behavior_flags_json, []):
            label = str(behavior).replace("_", " ")
            behaviors[label] = behaviors.get(label, 0) + 1
    users = len({change.admin_id for change in changes if change.admin_id})
    return {
        "since": since.isoformat(),
        "admin_changes": len(changes),
        "users": users,
        "detections_reviewed": len(detections),
        "behaviors": behaviors,
        "approved_changes": [
            {
                "admin_id": change.admin_id,
                "file_path": change.file_path,
                "change_type": change.change_type,
                "timestamp": change.timestamp.isoformat() if change.timestamp else None,
                "ip_address": change.ip_address,
            }
            for change in changes[:100]
        ],
        "security_reviews": [
            {
                "target_name": detection.target_name,
                "change_type": detection.change_type,
                "severity": detection.severity_level,
                "prediction": detection.ai_prediction,
                "confidence": detection.confidence,
                "detected_at": detection.detected_at.isoformat() if detection.detected_at else None,
                "behaviors": json_loads(detection.behavior_flags_json, []),
            }
            for detection in detections[:100]
        ],
        "summary": (
            f"Since the last retrain, WARDS collected {len(changes)} approved admin change(s), "
            f"{len(detections)} security review event(s), and activity from {users} admin account(s)."
        ),
    }


def set_backup_location(db: Session, new_location: str, delete_previous: bool, updated_by: str) -> dict:
    previous = resolve_stored_path(get_setting(db, "backup_location", stored_path_value(DEFAULT_BACKUP_ROOT) or str(DEFAULT_BACKUP_ROOT))) or DEFAULT_BACKUP_ROOT.resolve()
    target = validate_backup_destination(new_location, create=True)
    previous_resolved = previous.expanduser().resolve() if previous.exists() else previous.expanduser()
    set_setting(db, "backup_location", stored_path_value(target) or str(target), updated_by)
    deleted = False
    deletion_skipped_reason = None
    if delete_previous and previous.exists() and previous_resolved != target:
        if len(previous_resolved.parts) <= 1:
            deletion_skipped_reason = "previous backup location resolves to a filesystem root"
        elif path_is_inside(target, previous_resolved):
            deletion_skipped_reason = "new backup location is inside the previous backup location"
        else:
            shutil.rmtree(previous, ignore_errors=True)
            deleted = True
    backup_event = create_manual_backup(db, initiated_by=None, label="location_changed")
    logger.info("Backup location updated from '%s' to '%s'.", previous_resolved, target)
    return {
        "backup_location": stored_path_value(target) or str(target),
        "previous_deleted": deleted,
        "deletion_skipped_reason": deletion_skipped_reason,
        "absolute_path": str(target),
        "backup_event_id": getattr(backup_event, 'id', None),
    }


def path_is_inside(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def normalize_path_text(path: Path | str) -> str:
    text = str(Path(path).expanduser().resolve())
    return text.lower() if os.name == "nt" else text


def _clean_folder_root(folder_root: str) -> str:
    """Strip legacy VM1_ and CUSTOM_ prefixes from folder_root for display/matching."""
    result = str(folder_root or "")
    if result.startswith("VM1_CUSTOM_"):
        result = result[11:]  # len("VM1_CUSTOM_") = 11
    elif result.startswith("CUSTOM_"):
        result = result[7:]  # len("CUSTOM_") = 7
    if result.startswith("VM1_"):
        result = result[4:]  # len("VM1_") = 4
    return result


def monitored_entries_for_folder(db: Session, root: Path) -> list[SecurityMonitoredFile]:
    rows = []
    folder_name = root.name
    folder_name_upper = folder_name.upper()
    for entry in active_monitored_files_query(db).all():
        try:
            if path_is_inside(portable_monitored_path(entry), root):
                rows.append(entry)
                continue
        except Exception:
            pass
        # VM1 entries don't have valid local filesystem paths (especially in Docker);
        # match by folder_root name instead.
        if is_vm1_file(entry):
            entry_folder = str(entry.folder_root or "")
            clean_folder = _clean_folder_root(entry_folder)
            if clean_folder == folder_name or clean_folder == folder_name_upper:
                rows.append(entry)
                continue
            # Also match the raw folder_root against all known prefix variants
            variants = {
                folder_name, folder_name_upper,
                f"CUSTOM_{folder_name}", f"CUSTOM_{folder_name_upper}",
                f"VM1_{folder_name}", f"VM1_{folder_name_upper}",
                f"VM1_CUSTOM_{folder_name}", f"VM1_CUSTOM_{folder_name_upper}",
            }
            if entry_folder in variants:
                rows.append(entry)
                continue
    return rows


def wazuh_syscheck_tree(config_path: Path = WAZUH_CONFIG_PATH) -> tuple[ET.ElementTree, ET.Element]:
    if config_path.exists():
        tree = ET.parse(config_path)
        root = tree.getroot()
    else:
        root = ET.Element("ossec_config")
        tree = ET.ElementTree(root)
    syscheck = root.find("syscheck")
    if syscheck is None:
        syscheck = ET.SubElement(root, "syscheck")
        ET.SubElement(syscheck, "frequency").text = "300"
        ET.SubElement(syscheck, "scan_on_start").text = "yes"
        ET.SubElement(syscheck, "alert_new_files").text = "yes"
    return tree, syscheck


def write_wazuh_tree(tree: ET.ElementTree, config_path: Path) -> None:
    config_path.parent.mkdir(parents=True, exist_ok=True)
    if config_path.exists():
        backup_path = config_path.with_suffix(f"{config_path.suffix}{WAZUH_CONFIG_BACKUP_SUFFIX}")
        shutil.copy2(config_path, backup_path)
    temp_path = config_path.with_suffix(f"{config_path.suffix}.tmp")
    tree.write(temp_path, encoding="utf-8", xml_declaration=False)
    temp_path.replace(config_path)


def validate_wazuh_config_tree(tree: ET.ElementTree) -> None:
    root = tree.getroot()
    if root.tag != "ossec_config":
        raise ValueError("Wazuh configuration root element must be <ossec_config>.")
    syscheck = root.find("syscheck")
    if syscheck is None:
        raise ValueError("Wazuh configuration must contain a <syscheck> section.")
    for item in syscheck.findall("directories"):
        text = (item.text or "").strip()
        if not text:
            raise ValueError("Wazuh <directories> entries cannot be empty.")
        if not Path(text).is_absolute():
            raise ValueError(f"Wazuh monitored directory must be absolute: {text}")


def is_windows_admin() -> bool:
    if os.name != "nt":
        return False
    try:
        import ctypes

        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def can_write_path(path: Path) -> bool:
    target = path if path.exists() else path.parent
    try:
        target.mkdir(parents=True, exist_ok=True)
        probe = target / ".wards_probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        return True
    except Exception:
        return False


def wazuh_service_restart_enabled() -> bool:
    return (os.getenv("WAZUH_SERVICE_RESTART_ENABLED", "true").strip().lower() == "true")


def requires_wazuh_elevation(config_path: Path = WAZUH_CONFIG_PATH) -> bool:
    if os.name != "nt":
        return False
    if is_windows_admin():
        return False
    if wazuh_service_restart_enabled():
        return True
    return not can_write_path(config_path)


def wazuh_desired_directories(db: Session) -> list[Path]:
    desired_folders: dict[str, Path] = {
        normalize_path_text(DATABASE_MONITOR_ROOT): DATABASE_MONITOR_ROOT,
        **{normalize_path_text(path): path for path in MONITORED_ROOTS.values() if path.exists() and path.is_dir()},
    }
    for root in configured_custom_monitored_folders(db):
        if root.exists() and root.is_dir():
            desired_folders.setdefault(normalize_path_text(root), root)
    return sorted(desired_folders.values(), key=lambda item: str(item))


def reload_wazuh_if_configured() -> bool:
    command = (os.getenv("WAZUH_RELOAD_COMMAND") or "").strip()
    if not command:
        return False
    # Only allow simple whitelisted reload commands to prevent shell injection
    allowed_prefixes = ("/var/ossec/bin/wazuh-control", "systemctl", "service")
    if not any(command.startswith(p) for p in allowed_prefixes):
        logger.warning("Wazuh reload command rejected: does not start with an allowed prefix.")
        return False
    try:
        args = shlex.split(command)
        result = subprocess.run(args, capture_output=True, check=False)
        if result.returncode != 0:
            logger.warning("Wazuh reload command exited with status %s. stderr: %s", result.returncode, result.stderr.decode("utf-8", errors="replace")[:200])
            return False
        return True
    except Exception:
        logger.exception("Wazuh reload command failed.")
        return False


def run_elevated_wazuh_helper(desired_folders: list[Path], config_path: Path = WAZUH_CONFIG_PATH) -> dict[str, object]:
    if os.name != "nt":
        raise RuntimeError("Windows elevation helper is only available on Windows.")
    if not WAZUH_HELPER_SCRIPT.exists():
        raise RuntimeError(f"Wazuh helper script not found: {WAZUH_HELPER_SCRIPT}")
    payload = {
        "config_path": str(config_path),
        "directories": [str(path) for path in desired_folders],
        "log_path": str(WAZUH_HELPER_LOG_PATH),
    }
    with tempfile.TemporaryDirectory(prefix="wards_wazuh_") as temp_dir:
        temp_root = Path(temp_dir)
        payload_path = temp_root / "payload.json"
        result_path = temp_root / "result.json"
        payload_path.write_text(json_dumps(payload), encoding="utf-8")

        logger.info("Requesting UAC elevation for Wazuh sync of '%s'.", config_path)
        try:
            import ctypes
            from ctypes import wintypes

            SEE_MASK_NOCLOSEPROCESS = 0x00000040
            SW_HIDE = 0

            class SHELLEXECUTEINFOW(ctypes.Structure):
                _fields_ = [
                    ("cbSize", wintypes.DWORD),
                    ("fMask", ctypes.c_ulong),
                    ("hwnd", wintypes.HWND),
                    ("lpVerb", wintypes.LPCWSTR),
                    ("lpFile", wintypes.LPCWSTR),
                    ("lpParameters", wintypes.LPCWSTR),
                    ("lpDirectory", wintypes.LPCWSTR),
                    ("nShow", ctypes.c_int),
                    ("hInstApp", wintypes.HINSTANCE),
                    ("lpIDList", ctypes.c_void_p),
                    ("lpClass", wintypes.LPCWSTR),
                    ("hkeyClass", wintypes.HKEY),
                    ("dwHotKey", wintypes.DWORD),
                    ("hIcon", wintypes.HANDLE),
                    ("hProcess", wintypes.HANDLE),
                ]

            params = (
                f'"{WAZUH_HELPER_SCRIPT}" '
                f'--payload "{payload_path}" '
                f'--result "{result_path}"'
            )
            python_executable = Path(sys.executable)
            hidden_executable = python_executable.with_name("pythonw.exe")
            launch_executable = hidden_executable if hidden_executable.exists() else python_executable
            sei = SHELLEXECUTEINFOW()
            sei.cbSize = ctypes.sizeof(SHELLEXECUTEINFOW)
            sei.fMask = SEE_MASK_NOCLOSEPROCESS
            sei.hwnd = None
            sei.lpVerb = "runas"
            sei.lpFile = str(launch_executable)
            sei.lpParameters = params
            sei.lpDirectory = str(MASTER_ROOT)
            sei.nShow = SW_HIDE

            shell32 = ctypes.windll.shell32
            if not shell32.ShellExecuteExW(ctypes.byref(sei)):
                error_code = ctypes.GetLastError()
                if error_code == 1223:
                    raise PermissionError("Administrator approval was declined. Wazuh changes were not applied.")
                raise RuntimeError(f"Unable to start elevated Wazuh helper (error {error_code}).")

            ctypes.windll.kernel32.WaitForSingleObject(sei.hProcess, 300000)
        except PermissionError:
            logger.warning("User declined the Wazuh UAC elevation request.")
            raise
        except Exception:
            logger.exception("Elevated Wazuh helper failed to launch.")
            raise

        if not result_path.exists():
            raise RuntimeError("Wazuh helper did not produce a result file.")
        result = json_loads(result_path.read_text(encoding="utf-8"), {})
        if not result.get("success"):
            raise RuntimeError(str(result.get("message") or "Elevated Wazuh helper reported a failure."))
        return result


def update_wazuh_monitored_folder(folder_path: Path, action: str, config_path: Path = WAZUH_CONFIG_PATH) -> bool:
    target = normalize_path_text(folder_path)
    tree, syscheck = wazuh_syscheck_tree(config_path)
    changed = False
    directories = list(syscheck.findall("directories"))
    existing = [
        item for item in directories
        if item.text and normalize_path_text(item.text) == target
    ]
    if action == "add":
        if not existing:
            item = ET.SubElement(syscheck, "directories")
            item.set("check_all", "yes")
            item.set("realtime", "yes")
            item.set("report_changes", "yes")
            item.text = str(folder_path)
            changed = True
    elif action == "remove":
        for item in existing:
            syscheck.remove(item)
            changed = True
    else:
        raise ValueError("Unsupported Wazuh folder action.")
    if changed:
        write_wazuh_tree(tree, config_path)
    return changed


def sync_wazuh_monitored_folders(db: Session, config_path: Path = WAZUH_CONFIG_PATH, allow_elevation: bool = False) -> dict[str, object]:
    tree, syscheck = wazuh_syscheck_tree(config_path)
    desired_folders = wazuh_desired_directories(db)
    directories = list(syscheck.findall("directories"))
    existing = {normalize_path_text(item.text): item for item in directories if item.text}
    changed = False

    for normalized, item in list(existing.items()):
        if normalized not in {normalize_path_text(path) for path in desired_folders}:
            syscheck.remove(item)
            changed = True

    for folder in desired_folders:
        normalized = normalize_path_text(folder)
        if normalized in existing:
            continue
        item = ET.SubElement(syscheck, "directories")
        item.set("check_all", "yes")
        item.set("realtime", "yes")
        item.set("report_changes", "yes")
        item.text = str(folder)
        changed = True

    if changed:
        validate_wazuh_config_tree(tree)
        if allow_elevation and requires_wazuh_elevation(config_path):
            helper_result = run_elevated_wazuh_helper(desired_folders, config_path=config_path)
            logger.info("Wazuh configuration updated through elevated helper for '%s'.", config_path)
            return {
                "updated": bool(helper_result.get("updated", True)),
                "reloaded": bool(helper_result.get("reloaded", False)),
                "config_path": str(config_path),
                "used_elevation": True,
                "message": helper_result.get("message") or "Wazuh configuration updated.",
            }
        write_wazuh_tree(tree, config_path)
    reloaded = reload_wazuh_if_configured() if changed else False
    logger.info("Wazuh configuration sync completed for '%s' (changed=%s, reloaded=%s).", config_path, changed, reloaded)
    return {"updated": changed, "reloaded": reloaded, "config_path": str(config_path), "used_elevation": False}


def monitored_file_has_history(db: Session, file_id: int) -> bool:
    detection = db.query(SecurityDetectionEvent.id).filter(SecurityDetectionEvent.file_id == file_id).first()
    if detection:
        return True
    recovery = db.query(SecurityRecoveryEvent.id).filter(SecurityRecoveryEvent.file_id == file_id).first()
    return bool(recovery)


def add_monitored_folder(db: Session, folder_path: str, initiated_by: int | None = None, vm_target: str | None = None) -> dict:
    root = Path(folder_path).expanduser().resolve()
    if not root.is_absolute():
        raise ValueError("Monitored folder must use an absolute filesystem path.")

    is_vm1 = str(vm_target or "").lower() == "vm1"
    if is_vm1:
        # VM1 folders are stored as raw paths; existence is checked by VM1's reporter.
        # They live only in vm1_custom_monitored_folders — never in local/shared settings.
        existing = load_vm1_monitored_folders(db)
        if normalized_path_key(root) in {normalized_path_key(p) for p in existing}:
            raise ValueError("Folder is already monitored on VM1.")
        existing.append(root)
        save_vm1_monitored_folders(db, existing, updated_by=str(initiated_by) if initiated_by else "system")
        backup_event = create_manual_backup(db, initiated_by=initiated_by, label="monitored_folder_added")
        logger.info("Added VM1 monitored folder '%s'.", root)
        return {
            "added_files": 0,
            "backup_files_added": 0,
            "folder": str(root),
            "folder_scope": "vm1",
            "folder_storage": str(root),
            "wazuh_config_updated": False,
            "wazuh_reloaded": False,
            "wazuh_used_elevation": False,
            "wazuh_config_path": None,
            "backup_refreshed": backup_event.status == "success",
        }

    if not root.exists() or not root.is_dir():
        raise ValueError("Folder does not exist")
    if monitored_entries_for_folder(db, root):
        raise ValueError("Folder is already monitored.")
    scope = persist_configured_monitored_folder(db, root, updated_by=str(initiated_by) if initiated_by else "system")
    backup_root = latest_backup_root(db)
    created, backed_up, processed = register_monitored_folder_entries(db, root, refresh_existing=True, backup_root=backup_root)
    if processed == 0:
        raise ValueError("Folder does not contain monitorable files.")
    db.commit()
    wazuh_result = sync_wazuh_monitored_folders(db, allow_elevation=True)
    backup_event = create_manual_backup(db, initiated_by=initiated_by, label="monitored_folder_added")
    logger.info("Added monitored folder '%s' with %s file(s).", root, created)
    return {
        "added_files": created,
        "backup_files_added": backed_up,
        "folder": str(root),
        "folder_scope": scope,
        "folder_storage": shared_monitored_folder_token(root) or str(root),
        "wazuh_config_updated": wazuh_result["updated"],
        "wazuh_reloaded": wazuh_result["reloaded"],
        "wazuh_used_elevation": wazuh_result.get("used_elevation", False),
        "wazuh_config_path": wazuh_result.get("config_path"),
        "backup_refreshed": backup_event.status == "success",
    }


def remove_monitored_folder(db: Session, folder_path: str, initiated_by: int | None = None, vm_target: str | None = None) -> dict:
    root = Path(folder_path).expanduser().resolve()
    if not root.is_absolute():
        raise ValueError("Monitored folder must use an absolute filesystem path.")

    is_vm1 = str(vm_target or "").lower() == "vm1"
    removed_from_vm1 = False
    if is_vm1:
        existing = load_vm1_monitored_folders(db)
        if normalized_path_key(root) in {normalized_path_key(p) for p in existing}:
            updated = [p for p in existing if normalized_path_key(p) != normalized_path_key(root)]
            save_vm1_monitored_folders(db, updated, updated_by=str(initiated_by) if initiated_by else "system")
            removed_from_vm1 = True
            logger.info("Removed VM1 monitored folder '%s' from VM1 list.", root)

    # VM1 folders are managed in DB settings only, not local/shared JSON.
    # If an older version put the VM1 folder into local/shared settings, clean it up
    # gracefully so a read-only container filesystem doesn't block removal.
    if is_vm1:
        scope = "vm1"
        try:
            remove_configured_monitored_folder(db, root, updated_by=str(initiated_by) if initiated_by else "system")
        except OSError:
            pass
    else:
        scope = remove_configured_monitored_folder(db, root, updated_by=str(initiated_by) if initiated_by else "system")

    # Gather all entries that belong to this folder (local + VM1)
    entries = monitored_entries_for_folder(db, root)

    if not entries and not removed_from_vm1:
        raise ValueError("Folder is not currently monitored.")

    removed = len(entries)
    entry_ids = [entry.id for entry in entries]
    if entry_ids:
        db.query(SecurityDetectionEvent).filter(SecurityDetectionEvent.file_id.in_(entry_ids)).delete(synchronize_session=False)
        db.query(SecurityRecoveryEvent).filter(SecurityRecoveryEvent.file_id.in_(entry_ids)).delete(synchronize_session=False)
        for entry in entries:
            db.delete(entry)
    db.commit()

    # Clean up VM1 snapshot files for removed folders so they don't reappear in backups
    if is_vm1:
        folder_name = root.name
        snapshot_dir = VM1_SNAPSHOT_ROOT / folder_name
        if snapshot_dir.exists():
            try:
                import shutil
                shutil.rmtree(snapshot_dir)
                logger.info("Removed VM1 snapshot directory for '%s'.", folder_name)
            except OSError as exc:
                logger.warning("Could not remove VM1 snapshot directory '%s': %s", snapshot_dir, exc)

    wazuh_result = sync_wazuh_monitored_folders(db, allow_elevation=True)
    backup_event = create_manual_backup(db, initiated_by=initiated_by, label="monitored_folder_removed")
    logger.info("Removed monitored folder '%s' with %s file record(s).", root, removed)
    return {
        "removed_files": removed,
        "removed_backup_files": 0,
        "retired_files": 0,
        "folder": str(root),
        "folder_scope": "vm1" if removed_from_vm1 else scope,
        "folder_storage": shared_monitored_folder_token(root) or str(root),
        "wazuh_config_updated": wazuh_result["updated"],
        "wazuh_reloaded": wazuh_result["reloaded"],
        "wazuh_used_elevation": wazuh_result.get("used_elevation", False),
        "wazuh_config_path": wazuh_result.get("config_path"),
        "backup_refreshed": backup_event.status == "success",
    }


def serialize_detection(item: SecurityDetectionEvent) -> dict:
    display_change_type = "trusted_removal_update" if item.change_type in {"verified_deleted", "verified_renamed"} else item.change_type
    display_summary = item.trigger_summary
    if item.change_type in {"verified_deleted", "verified_renamed"} or "Verified rename" in str(display_summary or ""):
        display_summary = "Accepted during trusted baseline reconciliation."
    return {
        "id": item.id,
        "file_id": item.file_id,
        "detected_at": item.detected_at.isoformat() if item.detected_at else None,
        "target_type": item.target_type,
        "target_name": item.target_name,
        "actor": item.actor,
        "change_type": display_change_type,
        "is_legitimate": item.is_legitimate,
        "ai_score": item.ai_score,
        "ai_prediction": item.ai_prediction,
        "confidence": item.confidence,
        "severity_level": item.severity_level,
        "cvss_score": item.cvss_score,
        "nist_category": item.nist_category,
        "enisa_threat_type": item.enisa_threat_type,
        "trigger_summary": display_summary,
        "accuracy_basis": item.accuracy_basis,
        "behaviors": json_loads(item.behavior_flags_json, []),
        "changed_lines": json_loads(item.changed_lines_json, {}),
        "context": json_loads(item.context_json, {}),
        "integrity_valid": verify_record_integrity(item),
    }


def serialize_recovery(item: SecurityRecoveryEvent | dict) -> dict:
    if isinstance(item, dict):
        return item
    raw_type = item.recovery_type or ""
    display_status = "success" if item.status == "verified_removal" else item.status
    if raw_type in {"reverted", "false_positive_restore"} or str(item.summary or "").lower().find("false positive") >= 0:
        display_status = "reverted"
    display_recovery_type = item.recovery_type
    if raw_type in {"reverted", "false_positive_restore"}:
        display_recovery_type = "manual"
    if item.recovery_type == "manual_backup" and (
        item.initiated_by is None
        or any(label in str(item.backup_path or item.summary or "").lower() for label in ("startup", "initial", "scheduled", "automatic"))
    ):
        display_recovery_type = "automatic_backup"
    display_summary = item.summary
    if "Verified rename" in str(display_summary or ""):
        display_summary = "Trusted baseline accepted; previous automatic recovery is no longer treated as a security incident."
    return {
        "id": item.id,
        "detection_event_id": item.detection_event_id,
        "file_id": item.file_id,
        "recovery_type": display_recovery_type,
        "initiated_by": item.initiated_by,
        "started_at": item.started_at.isoformat() if item.started_at else None,
        "completed_at": item.completed_at.isoformat() if item.completed_at else None,
        "status": display_status,
        "backup_path": item.backup_path,
        "quarantine_path": item.quarantine_path,
        "recovery_duration_ms": item.recovery_duration_ms,
        "error_message": item.error_message,
        "summary": display_summary,
        "integrity_valid": verify_record_integrity(item),
    }


def serialize_file(item: SecurityMonitoredFile) -> dict:
    display_status = "clean" if item.status in {"verified_deleted", "verified_renamed"} else item.status
    folder_root = _clean_folder_root(str(item.folder_root or ""))
    return {
        "id": item.id,
        "file_path": item.file_path,
        "relative_path": item.relative_path,
        "folder_root": folder_root,
        "baseline_hash": item.baseline_hash,
        "current_hash": item.current_hash,
        "status": display_status,
        "file_type": item.file_type,
        "size_bytes": item.size_bytes,
        "last_checked": item.last_checked.isoformat() if item.last_checked else None,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }


def serialize_incident(item: SecurityIncident) -> dict:
    display_status = "resolved" if item.status in {"verified_deleted", "verified_renamed"} else item.status
    display_action = "trusted_removal_resolved" if item.response_action in {"verified_deleted", "verified_renamed"} else item.response_action
    return {
        "id": item.id,
        "detection_event_id": item.detection_event_id,
        "incident_type": item.incident_type,
        "severity_level": item.severity_level,
        "cvss_score": item.cvss_score,
        "cvss_vector": item.cvss_vector,
        "nist_category": item.nist_category,
        "enisa_threat_type": item.enisa_threat_type,
        "status": display_status,
        "description": item.description,
        "behaviors": json_loads(item.behaviors_json, []),
        "affected_files": json_loads(item.affected_files_json, []),
        "changed_lines": json_loads(item.changed_lines_json, {}),
        "quarantine_paths": json_loads(item.quarantine_paths_json, []),
        "response_action": display_action,
        "resolved_at": item.resolved_at.isoformat() if item.resolved_at else None,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "integrity_valid": verify_record_integrity(item),
    }


# ---------------------------------------------------------------------------
# VM1 File Integrity Monitoring (remote reporter integration)
# ---------------------------------------------------------------------------

def _store_vm1_snapshot(rel_path: str, content_b64: str | None):
    if content_b64 is None:
        return
    target = VM1_SNAPSHOT_ROOT / rel_path
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        data = base64.b64decode(content_b64)
        with open(target, "wb") as f:
            f.write(data)
    except Exception:
        pass


def _quarantine_vm1_snapshot(entry: SecurityMonitoredFile, detection_id: int) -> str | None:
    snapshot = VM1_SNAPSHOT_ROOT / entry.relative_path
    if not snapshot.exists():
        return None
    rel_safe = safe_rel(snapshot) if snapshot.exists() else entry.relative_path.replace("/", "_")
    target = QUARANTINE_ROOT / f"detection_{detection_id}" / f"vm1_{rel_safe}"
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copy2(snapshot, target)
        return stored_path_value(target) or str(target)
    except Exception:
        return None


def _create_vm1_restore_command(db: Session, entry: SecurityMonitoredFile, detection_id: int, *, original_content_bytes: bytes | None = None):
    content_bytes = None
    if original_content_bytes is not None:
        # Verify the provided bytes actually match the expected baseline hash
        provided_hash = hashlib.sha256(original_content_bytes).hexdigest()
        if provided_hash == entry.baseline_hash:
            content_bytes = original_content_bytes
        else:
            logger.warning(
                "VM1 provided original_content_bytes hash mismatch for %s (provided=%s baseline=%s); "
                "falling back to snapshot/backups.",
                entry.relative_path, provided_hash, entry.baseline_hash,
            )

    # Fallback 1: snapshot on VM2
    if content_bytes is None:
        snapshot = VM1_SNAPSHOT_ROOT / entry.relative_path
        if snapshot.exists():
            try:
                snapshot_hash = sha256_file(snapshot)
                if snapshot_hash == entry.baseline_hash:
                    content_bytes = snapshot.read_bytes()
                else:
                    logger.warning(
                        "VM1 snapshot hash mismatch for %s (snapshot=%s baseline=%s); "
                        "skipping snapshot-based restore content.",
                        entry.relative_path, snapshot_hash, entry.baseline_hash,
                    )
            except Exception:
                pass

    # Fallback 2: backup roots (clean copies from before the incident)
    if content_bytes is None:
        candidate, _root = newest_valid_backup_for_path(db, entry.relative_path, entry.baseline_hash)
        if candidate and candidate.exists() and candidate.is_file():
            try:
                content_bytes = candidate.read_bytes()
            except Exception:
                pass

    # Fallback 3: previously stored restore-content files
    if content_bytes is None and VM1_RESTORE_CONTENT_ROOT.exists():
        for content_file in VM1_RESTORE_CONTENT_ROOT.glob("*.b64"):
            try:
                decoded = base64.b64decode(content_file.read_bytes())
                if hashlib.sha256(decoded).hexdigest() == entry.baseline_hash:
                    content_bytes = decoded
                    break
            except Exception:
                pass

    command_id = f"rest_{detection_id}_{int(time.time())}"
    content_file = None
    if content_bytes:
        try:
            VM1_RESTORE_CONTENT_ROOT.mkdir(parents=True, exist_ok=True)
            content_file = VM1_RESTORE_CONTENT_ROOT / f"{command_id}.b64"
            content_file.write_bytes(base64.b64encode(content_bytes))
        except Exception:
            content_file = None

    cmd = {
        "command_id": command_id,
        "detection_id": detection_id,
        "relative_path": entry.relative_path,
        "expected_hash": entry.baseline_hash,
        "restore_content_file": str(content_file) if content_file else None,
        "created_at": now_utc().isoformat(),
    }
    existing = json_loads(get_setting(db, "vm1_restore_commands", "[]"), [])
    if not isinstance(existing, list):
        existing = []
    acked_raw = json_loads(get_setting(db, "vm1_restore_acks", "[]"), [])
    acked_ids = {ack.get("command_id") for ack in acked_raw if isinstance(ack, dict)}
    existing = [item for item in existing if isinstance(item, dict) and item.get("command_id") not in acked_ids]
    existing.append(cmd)
    if len(existing) > 500:
        logger.warning("VM1 restore command queue has %s pending command(s); not truncating pending restores.", len(existing))
    set_setting(db, "vm1_restore_commands", json_dumps(existing), "vm2_monitor")
    return cmd


def _has_pending_vm1_restore_for_file(db: Session, relative_path: str) -> bool:
    commands = get_pending_vm1_restore_commands(db)
    return any(c.get("relative_path") == relative_path for c in commands)


def get_pending_vm1_restore_commands(db: Session) -> list[dict]:
    raw = get_setting(db, "vm1_restore_commands", "[]")
    commands = json_loads(raw, [])
    acked_raw = get_setting(db, "vm1_restore_acks", "[]")
    acked = json_loads(acked_raw, [])
    acked_ids = {a.get("command_id") for a in acked}
    pending = []
    for c in commands:
        if c.get("command_id") in acked_ids:
            continue
        # Hydrate content from external file if present (avoids MySQL TEXT limit)
        content_file = c.get("restore_content_file")
        if content_file and not c.get("restore_content_b64"):
            try:
                path = Path(content_file)
                if path.exists():
                    # File already contains base64-encoded text; read it directly
                    c["restore_content_b64"] = path.read_bytes().decode()
            except Exception:
                pass
        pending.append(c)
    return pending


def acknowledge_vm1_restore_command(db: Session, command_id: str, success: bool) -> bool:
    acks = json_loads(get_setting(db, "vm1_restore_acks", "[]"), [])
    acks.append({
        "command_id": command_id,
        "success": success,
        "timestamp": now_utc().isoformat(),
    })
    # Keep only the last 100 acks to prevent the setting from growing indefinitely
    if len(acks) > 100:
        acks = acks[-100:]
    set_setting(db, "vm1_restore_acks", json_dumps(acks), "vm1_reporter")

    # Also remove the acknowledged command from the pending list so the queue stays small
    commands = json_loads(get_setting(db, "vm1_restore_commands", "[]"), [])
    removed = [c for c in commands if c.get("command_id") == command_id]
    commands = [c for c in commands if c.get("command_id") != command_id]
    set_setting(db, "vm1_restore_commands", json_dumps(commands), "vm1_reporter")

    # Update the monitored file baseline when a restore succeeds so the clean
    # state is trusted immediately and doesn't trigger a re-detection.
    if success:
        for cmd in removed:
            rel_path = cmd.get("relative_path")
            if not rel_path:
                continue
            file_entry = (
                db.query(SecurityMonitoredFile)
                .filter(SecurityMonitoredFile.relative_path == rel_path)
                .first()
            )
            if not file_entry:
                continue
            try:
                clean_hash = None
                content_file = cmd.get("restore_content_file")
                if content_file:
                    content_path = Path(content_file)
                    if content_path.exists():
                        clean_bytes = base64.b64decode(content_path.read_bytes())
                        clean_hash = hashlib.sha256(clean_bytes).hexdigest()
                        snapshot = VM1_SNAPSHOT_ROOT / rel_path
                        snapshot.parent.mkdir(parents=True, exist_ok=True)
                        snapshot.write_bytes(clean_bytes)
                if not clean_hash:
                    expected_hash = cmd.get("expected_hash")
                    if expected_hash:
                        clean_hash = expected_hash
                if clean_hash:
                    file_entry.baseline_hash = clean_hash
                    file_entry.current_hash = clean_hash
                    file_entry.status = "clean"
                    file_entry.last_checked = now_utc()
                    db.add(file_entry)
                    db.commit()
            except Exception:
                pass

    # Clean up external content files to prevent disk bloat
    for c in removed:
        content_file = c.get("restore_content_file")
        if content_file:
            try:
                Path(content_file).unlink(missing_ok=True)
            except Exception:
                pass
    return True


def _record_vm1_detection(db: Session, entry: SecurityMonitoredFile, change_type: str, new_hash: str | None, old_content: str = "", new_content: str = "", original_content_bytes: bytes | None = None) -> SecurityDetectionEvent | None:
    old_hash = entry.baseline_hash
    context = {
        "host_vm": "vm1",
        "background_monitor": True,
        "source_ip": "vm1_internal",
    }
    context.setdefault("ai_rules", get_ai_rules(db))
    context = enrich_file_ai_context(db, entry, change_type, old_content, new_content, context)
    prediction = ai_predict(Path(entry.relative_path), old_content, new_content, context)
    flags = content_flags(new_content, context, path=Path(entry.relative_path))
    classification = classify(change_type, prediction, flags, context)
    is_legitimate = False
    context.setdefault("admin_session_valid", False)
    context.setdefault("method_legitimate", False)
    changed = diff_lines(old_content, new_content)
    trigger_summary = build_trigger_summary(change_type, flags, changed, is_legitimate, "vm1_internal")

    detection = SecurityDetectionEvent(
        file_id=entry.id,
        target_type="vm1_file",
        target_name=entry.relative_path,
        actor="vm1_reporter",
        change_type=change_type,
        old_hash=old_hash,
        new_hash=new_hash,
        is_legitimate=is_legitimate,
        admin_id=None,
        ai_score=prediction.score,
        ai_prediction=prediction.prediction,
        confidence=prediction.confidence,
        severity_level=classification["severity_level"],
        cvss_score=classification["cvss_score"],
        nist_category=classification["nist_category"],
        enisa_threat_type=classification["enisa_threat_type"],
        trigger_summary=trigger_summary,
        accuracy_basis=prediction.basis,
        behavior_flags_json=json_dumps([BEHAVIOR_LABELS.get(flag, flag) for flag in flags]),
        changed_lines_json=json_dumps(changed),
        context_json=json_dumps(context),
    )
    db.add(detection)
    db.commit()
    db.refresh(detection)

    # Deduplication: skip if an open incident already exists for this file and change type
    existing_incident = db.query(SecurityIncident).join(SecurityDetectionEvent).filter(
        SecurityDetectionEvent.file_id == entry.id,
        SecurityDetectionEvent.change_type == change_type,
        SecurityIncident.status.in_(["open", "investigating"]),
    ).first()
    if existing_incident:
        logger.info(
            "VM1 dedup: skipping incident for %s (existing open incident SEC-%s)",
            entry.relative_path, existing_incident.id,
        )
        return detection

    # Always create a security incident for VM1 file changes; auto-recovery is controlled separately
    try:
        quarantine_path = _quarantine_vm1_snapshot(entry, detection.id)
    except Exception as exc:
        quarantine_path = None
        logger.warning("VM1 quarantine failed for %s: %s", entry.relative_path, exc)

    # Determine auto-recovery eligibility — do this BEFORE creating the incident
    # so that even if restore-command creation fails, the incident still exists.
    suffix = Path(entry.relative_path).suffix.lower()
    rules = context.get("ai_rules") or DEFAULT_AI_RULES
    high_risk_exts = set(rules.get("file_type_risk", {}).get("config", {}).get("high_risk_extensions", [".html", ".jsx", ".js", ".py"]))
    is_auto_recover = suffix in high_risk_exts or classification.get("severity_level") in {"high", "critical"}

    if is_auto_recover:
        # Queue restore command independently — failure here must NOT prevent incident creation
        try:
            _create_vm1_restore_command(db, entry, detection.id, original_content_bytes=original_content_bytes)
        except Exception as exc:
            logger.exception("VM1 restore-command creation failed for %s: %s", entry.relative_path, exc)

    # Now create the security incident regardless of whether the restore command succeeded
    try:
        incident = create_incident(db, detection, classification, flags, changed, quarantine_path)
        if is_auto_recover:
            incident.status = "open"
            incident.response_action = "auto_recovered_pending_review"
            db.add(incident)
            db.commit()
            recovery = SecurityRecoveryEvent(
                detection_event_id=detection.id,
                file_id=entry.id,
                recovery_type="automatic",
                initiated_by=None,
                status="success",
                quarantine_path=quarantine_path,
                summary=f"Auto-recovery applied for {entry.relative_path}; pending admin verification.",
                completed_at=now_utc(),
            )
            db.add(recovery)
            db.commit()
            create_system_alert(
                db,
                "incident_auto_recovery",
                f"SEC-{incident.id}: Auto-recovery applied for {entry.relative_path} (high-risk / high-severity). Admin review required.",
                incident.severity_level or "low",
                dedupe_key=f"SEC-{incident.id}",
            )
        else:
            incident.response_action = "vm1_restore_pending"
            db.add(incident)
            db.commit()
            create_incident_system_alert(db, incident, detection, None)
        logger.info("VM1 incident SEC-%s created for %s (auto_recover=%s)", incident.id, entry.relative_path, is_auto_recover)
    except Exception as exc:
        logger.exception("Failed to create security incident for VM1 detection %s: %s", detection.id, exc)
    return detection


def _vm1_file_monitorable(rel_path: str) -> bool:
    lower_name = Path(rel_path).name.lower()
    suffix = Path(rel_path).suffix.lower()
    if suffix in MONITORED_SUFFIXES:
        return True
    if lower_name in MONITORED_SPECIAL_FILENAMES:
        return True
    if any(lower_name.endswith(item) for item in MONITORED_SPECIAL_NAME_SUFFIXES):
        return True
    return False


def process_vm1_file_manifest(db: Session, files: list[dict], deployment_commit: str | None = None) -> dict:
    # Build the set of currently allowed VM1 folder roots so stale manifests
    # from reporters that haven't refreshed config yet don't recreate entries.
    allowed_vm1_roots = {
        _clean_folder_root(p.name)
        for p in load_vm1_monitored_folders(db)
    }
    # Standard VM1 roots (WARDS, OCR) are hardcoded on VM1 and not stored in
    # vm1_custom_monitored_folders, but their manifests must still be accepted.
    # Note: OCR root is no longer in MONITORED_ROOTS, but legacy manifests may
    # still reference it; those files are dropped below by excluded-dirs check.
    allowed_vm1_roots |= set(MONITORED_ROOTS.keys())

    def _valid_hash(value) -> str:
        if not isinstance(value, str) or len(value) != 64 or not all(c in "0123456789abcdefABCDEF" for c in value):
            return ""
        return value.lower()

    def _valid_size(value) -> int:
        try:
            return max(0, int(value))
        except (TypeError, ValueError):
            return 0

    deployment_commit = str(deployment_commit or "").strip()
    deployment_paused = is_deployment_in_progress(db)
    if deployment_commit:
        set_setting(db, "vm1_last_manifest_commit", deployment_commit, "vm1_reporter")
    set_setting(db, "vm1_last_manifest_at", now_utc().isoformat(), "vm1_reporter")
    set_setting(db, "vm1_last_manifest_deployment_paused", "true" if deployment_paused else "false", "vm1_reporter")

    if deployment_paused:
        logger.info("Deployment in progress — skipping VM1 file change detections.")
        # Still register or update files so the baseline is correct post-deploy
        for f in files:
            if not isinstance(f, dict):
                continue
            rel_path = str(f.get("relative_path") or "").strip()
            folder_root = str(f.get("folder_root") or "").strip()
            # Normalize legacy CUSTOM_ prefix from older VM1 reporters
            folder_root = _clean_folder_root(folder_root)
            rel_path = _clean_folder_root(rel_path)
            if not rel_path or ".." in rel_path.replace("\\", "/"):
                continue
            current_hash = _valid_hash(f.get("current_hash"))
            size_bytes = _valid_size(f.get("size_bytes"))
            if Path(rel_path).name.lower() == ".env":
                continue
            # Skip non-monitorable file types during deployment — only update
            # existing entries, don't create new ones for e.g. images/audio.
            entry = (
                db.query(SecurityMonitoredFile)
                .filter(SecurityMonitoredFile.relative_path == rel_path)
                .filter(SecurityMonitoredFile.folder_root == folder_root)
                .first()
            )
            if entry:
                if entry.status == MONITORING_REMOVED_STATUS:
                    continue  # Don't reactivate removed entries
                entry.current_hash = current_hash
                entry.size_bytes = size_bytes
                entry.last_checked = now_utc()
                entry.status = "clean"
                entry.baseline_hash = current_hash
                db.add(entry)
            elif _vm1_file_monitorable(rel_path):
                db.add(
                    SecurityMonitoredFile(
                        file_path=f"vm1://{rel_path}",
                        relative_path=rel_path,
                        folder_root=folder_root,
                        baseline_hash=current_hash,
                        current_hash=current_hash,
                        status="clean",
                        file_type=file_type(Path(rel_path)),
                        size_bytes=size_bytes,
                        last_checked=now_utc(),
                    )
                )
            # Store the snapshot during deployment so future diffs have a proper baseline
            _store_vm1_snapshot(rel_path, f.get("content_b64"))
        db.commit()
        target_commit = (get_setting(db, "deployment_target_commit", "") or "").strip()
        baseline_ready = bool(deployment_commit and target_commit and deployment_commit == target_commit)
        if baseline_ready:
            set_setting(db, "deployment_vm1_baseline_ready", "true", "vm1_reporter")
        return {
            "detections": [],
            "changed": 0,
            "registered": len(files),
            "deployment_paused": True,
            "deployment_commit": deployment_commit,
            "deployment_target_commit": target_commit,
            "deployment_vm1_baseline_ready": baseline_ready,
        }

    # --- Bulk change detection ---
    # If many existing monitored files change at once with no open incidents,
    # treat as a deployment and update baselines instead of flooding detections.
    changed_entries: list[tuple[SecurityMonitoredFile, dict, str]] = []
    for f in files:
        if not isinstance(f, dict):
            continue
        rel_path = str(f.get("relative_path") or "").strip()
        folder_root = str(f.get("folder_root") or "").strip()
        folder_root = _clean_folder_root(folder_root)
        rel_path = _clean_folder_root(rel_path)
        if not rel_path or ".." in rel_path.replace("\\", "/"):
            continue
        if folder_root not in allowed_vm1_roots:
            continue
        rel_path_parts = set(Path(rel_path).parts)
        if rel_path_parts.intersection({item.lower() for item in DEFAULT_EXCLUDED_DIRS}):
            continue
        if not _vm1_file_monitorable(rel_path):
            continue
        current_hash = _valid_hash(f.get("current_hash"))
        if Path(rel_path).name.lower() == ".env":
            continue
        entry = (
            db.query(SecurityMonitoredFile)
            .filter(SecurityMonitoredFile.relative_path == rel_path)
            .filter(SecurityMonitoredFile.folder_root == folder_root)
            .first()
        )
        if entry and entry.baseline_hash and current_hash and entry.baseline_hash != current_hash:
            changed_entries.append((entry, f, current_hash))

    BULK_CHANGE_THRESHOLD = 5
    if len(changed_entries) >= BULK_CHANGE_THRESHOLD:
        has_open_incidents = any(
            db.query(SecurityIncident)
            .join(SecurityDetectionEvent)
            .filter(SecurityDetectionEvent.file_id == entry.id)
            .filter(SecurityIncident.status.in_(["open", "investigating"]))
            .first()
            is not None
            for entry, _, _ in changed_entries
        )
        if not has_open_incidents:
            logger.info(
                "Bulk VM1 file change detected (%d files) — treating as deployment, updating baselines.",
                len(changed_entries),
            )
            for entry, f, current_hash in changed_entries:
                entry.current_hash = current_hash
                entry.baseline_hash = current_hash
                entry.status = "clean"
                entry.last_checked = now_utc()
                db.add(entry)
                _store_vm1_snapshot(entry.relative_path, f.get("content_b64"))
            db.commit()
            return {
                "registered": 0,
                "changed": len(changed_entries),
                "detections": 0,
                "deployment_detected": True,
            }

    detections = []
    changed = 0
    registered = 0

    for f in files:
        if not isinstance(f, dict):
            continue
        rel_path = str(f.get("relative_path") or "").strip()
        folder_root = str(f.get("folder_root") or "").strip()
        # Normalize legacy CUSTOM_ prefix from older VM1 reporters
        folder_root = _clean_folder_root(folder_root)
        rel_path = _clean_folder_root(rel_path)
        if not rel_path or ".." in rel_path.replace("\\", "/"):
            continue

        # Skip files from folders that are no longer in the VM1 monitored list
        if folder_root not in allowed_vm1_roots:
            continue

        # Skip files in excluded directories (e.g. OCR, build outputs)
        rel_path_parts = set(Path(rel_path).parts)
        if rel_path_parts.intersection({item.lower() for item in DEFAULT_EXCLUDED_DIRS}):
            continue

        # Skip non-monitorable file types (images, audio, etc.)
        if not _vm1_file_monitorable(rel_path):
            continue

        current_hash = _valid_hash(f.get("current_hash"))
        size_bytes = _valid_size(f.get("size_bytes"))

        # Skip environment files — they change as part of normal operations
        if Path(rel_path).name.lower() == ".env":
            continue

        entry = (
            db.query(SecurityMonitoredFile)
            .filter(SecurityMonitoredFile.relative_path == rel_path)
            .filter(SecurityMonitoredFile.folder_root == folder_root)
            .first()
        )

        if entry:
            if entry.status == MONITORING_REMOVED_STATUS:
                continue  # Don't reactivate removed entries
        if not entry:
            # Migrate any stale local duplicate to the VM1 folder so it doesn't show as missing
            stale = (
                db.query(SecurityMonitoredFile)
                .filter(SecurityMonitoredFile.relative_path == rel_path)
                .filter(SecurityMonitoredFile.folder_root != folder_root)
                .first()
            )
            if stale:
                stale.folder_root = folder_root
                stale.file_path = f"vm1://{rel_path}"
                stale.baseline_hash = current_hash
                stale.current_hash = current_hash
                stale.size_bytes = size_bytes
                stale.status = "clean"
                stale.last_checked = now_utc()
                db.add(stale)
                db.commit()
                db.refresh(stale)
                registered += 1
                _store_vm1_snapshot(rel_path, f.get("content_b64"))
                continue

            entry = SecurityMonitoredFile(
                file_path=f"vm1://{rel_path}",
                relative_path=rel_path,
                folder_root=folder_root,
                baseline_hash=current_hash,
                current_hash=current_hash,
                status="clean",
                file_type=file_type(Path(rel_path)),
                size_bytes=size_bytes,
                last_checked=now_utc(),
            )
            db.add(entry)
            db.commit()
            db.refresh(entry)
            registered += 1
            _store_vm1_snapshot(rel_path, f.get("content_b64"))
            continue

        previous_hash = entry.current_hash
        entry.current_hash = current_hash
        entry.size_bytes = size_bytes
        entry.last_checked = now_utc()

        if current_hash != entry.baseline_hash:
            # If the file hash hasn't changed since the last scan, don't log another detection
            if previous_hash == current_hash:
                entry.status = "modified"
                db.add(entry)
                continue
            # Suppress only if a restore command is already pending for this file
            has_pending_restore = _has_pending_vm1_restore_for_file(db, entry.relative_path)
            # If the VM1 reporter says this file matches git HEAD, it was changed
            # through the legitimate GitHub workflow. Cancel any stale pending
            # restores (they would revert a legitimate state) and update baseline.
            if f.get("git_head_match"):
                if has_pending_restore:
                    # Remove stale restore commands for this file so they don't revert
                    # the legitimate git state on the next poll.
                    all_cmds = json_loads(get_setting(db, "vm1_restore_commands", "[]"), [])
                    filtered = [c for c in all_cmds if c.get("relative_path") != entry.relative_path]
                    if len(filtered) != len(all_cmds):
                        set_setting(db, "vm1_restore_commands", json_dumps(filtered), "vm2_monitor")
                        logger.info(
                            "VM1 git workflow: cancelled %s stale restore command(s) for %s",
                            len(all_cmds) - len(filtered), entry.relative_path,
                        )
                entry.baseline_hash = current_hash
                entry.status = "clean"
                db.add(entry)
                _store_vm1_snapshot(rel_path, f.get("content_b64"))
                continue
            if not has_pending_restore:
                # Resolve any existing open incidents for this file before creating a new one
                for old_incident in db.query(SecurityIncident).join(SecurityDetectionEvent).filter(
                    SecurityDetectionEvent.file_id == entry.id,
                    SecurityIncident.status.in_(["open", "investigating"]),
                ).all():
                    old_incident.status = "resolved"
                    old_incident.resolved_at = now_utc()
                    old_incident.resolved_by = None
                    old_incident.response_action = "superseded_by_new_detection"
                    db.add(old_incident)
                # Safety-net: if the most recent incident for this file was resolved or
                # false-positive with the SAME hash, treat as a re-detection of a known
                # state and update baseline instead of flooding new incidents.
                # This prevents git-workflow loops where Resolve reverts baseline to old
                # content and the next manifest re-triggers the same detection.
                recent_incident = (
                    db.query(SecurityIncident)
                    .join(SecurityDetectionEvent)
                    .filter(SecurityDetectionEvent.file_id == entry.id)
                    .order_by(SecurityIncident.created_at.desc())
                    .first()
                )
                if recent_incident and recent_incident.status in ("resolved", "false_positive"):
                    recent_detection = db.query(SecurityDetectionEvent).filter(
                        SecurityDetectionEvent.id == recent_incident.detection_event_id
                    ).first()
                    if recent_detection and recent_detection.new_hash == current_hash:
                        entry.baseline_hash = current_hash
                        entry.status = "clean"
                        db.add(entry)
                        db.commit()
                        logger.info(
                            "VM1 safety-net: suppressed re-detection for %s (hash %s...%s) "
                            "because incident SEC-%s was already %s.",
                            entry.relative_path, current_hash[:8], current_hash[-8:],
                            recent_incident.id, recent_incident.status,
                        )
                        continue
                # Fallback: if baseline is missing, set it and skip instead of flooding
                if not entry.baseline_hash:
                    entry.baseline_hash = current_hash
                    entry.status = "clean"
                    db.add(entry)
                    db.commit()
                    logger.warning(
                        "VM1 baseline missing for %s; updated to %s and skipping detection.",
                        entry.relative_path, current_hash,
                    )
                    continue
                entry.status = "modified"
                changed += 1
                db.add(entry)
                db.commit()
                # Read previous snapshot content for diff AND capture raw bytes
                # before _store_vm1_snapshot overwrites it.
                snapshot_path = VM1_SNAPSHOT_ROOT / entry.relative_path
                old_content = read_text(snapshot_path) if snapshot_path.exists() else ""
                old_snapshot_bytes = None
                if snapshot_path.exists():
                    try:
                        old_snapshot_bytes = snapshot_path.read_bytes()
                    except Exception:
                        pass
                new_content = ""
                content_b64 = f.get("content_b64")
                if content_b64:
                    try:
                        new_content = base64.b64decode(content_b64).decode("utf-8", errors="replace")
                    except Exception:
                        pass
                # Skip detection when both contents are empty (no meaningful diff possible).
                # This typically happens for large files where content_b64 is not sent.
                if not old_content.strip() and not new_content.strip():
                    logger.warning(
                        "VM1 file %s hash changed but both old/new content are empty "
                        "(snapshot/content_b64 missing); updating baseline to %s and skipping detection.",
                        rel_path, current_hash,
                    )
                    entry.baseline_hash = current_hash
                    entry.status = "clean"
                    db.add(entry)
                    db.commit()
                    continue
                detection = _record_vm1_detection(
                    db, entry, "vm1_content_modified", current_hash,
                    old_content=old_content, new_content=new_content,
                    original_content_bytes=old_snapshot_bytes,
                )
                # Store the new snapshot so future changes have a baseline
                _store_vm1_snapshot(rel_path, content_b64)
                # Keep a copy of the defaced snapshot for false-positive revert
                snapshot = VM1_SNAPSHOT_ROOT / rel_path
                if snapshot.exists():
                    defaced_path = VM1_DEFACED_SNAPSHOT_ROOT / rel_path
                    defaced_path.parent.mkdir(parents=True, exist_ok=True)
                    try:
                        shutil.copy2(snapshot, defaced_path)
                    except Exception:
                        pass
                if detection:
                    detections.append(detection)
            else:
                entry.status = "modified"
                db.add(entry)
        else:
            entry.status = "clean"
            # Keep baseline in sync so future changes don't re-trigger old deltas
            entry.baseline_hash = current_hash
            db.add(entry)

    db.commit()
    set_setting(db, "vm1_last_heartbeat_at", now_utc().isoformat(), "vm1_reporter")
    set_setting(db, "vm1_last_heartbeat_status", "success", "vm1_reporter")
    # Include pending restore commands in the response so the VM1 reporter can
    # apply them immediately instead of waiting for the next poll cycle.
    restore_commands = get_pending_vm1_restore_commands(db)
    return {
        "registered": registered,
        "changed": changed,
        "detections": len(detections),
        "detection_ids": [d.id for d in detections],
        "restore_commands": restore_commands,
    }


def check_vm1_heartbeat_timeout(db: Session) -> SecurityDetectionEvent | None:
    last_str = get_setting(db, "vm1_last_heartbeat_at", "")
    if not last_str:
        return None

    try:
        last = datetime.fromisoformat(last_str)
    except Exception:
        return None

    timeout_seconds = int(os.getenv("VM1_HEARTBEAT_TIMEOUT_SECONDS", "60"))
    if (now_utc() - last).total_seconds() < timeout_seconds:
        return None

    # Avoid duplicate silent-host detections within a short window
    last_detected = get_setting(db, "vm1_last_silent_detection_at", "")
    if last_detected:
        try:
            if (now_utc() - datetime.fromisoformat(last_detected)).total_seconds() < max(timeout_seconds, 300):
                return None
        except Exception:
            pass

    # DEDUPE: if an open vm1_host_compromised incident already exists, just update its timestamp
    existing_incident = (
        db.query(SecurityIncident)
        .filter(SecurityIncident.incident_type == "vm1_host_compromised")
        .filter(SecurityIncident.status.in_(["open", "investigating"]))
        .order_by(SecurityIncident.created_at.desc())
        .first()
    )
    if existing_incident:
        existing_incident.description = (
            f"VM1 heartbeat timeout recurrence at {now_utc().isoformat()}. "
            f"Original detection: {existing_incident.created_at.isoformat() if existing_incident.created_at else 'unknown'}."
        )
        db.add(existing_incident)
        db.commit()
        set_setting(db, "vm1_last_silent_detection_at", now_utc().isoformat(), "vm2_monitor")
        set_setting(db, "vm1_last_heartbeat_status", "timeout_detected", "vm2_monitor")
        return None

    context = {
        "host_vm": "vm1",
        "background_monitor": True,
        "source_ip": "vm1_internal",
    }
    detection = SecurityDetectionEvent(
        target_type="vm1_host",
        target_name="vm1_host_silent",
        actor="vm1_reporter",
        change_type="vm1_host_silent",
        old_hash=None,
        new_hash=None,
        is_legitimate=False,
        admin_id=None,
        ai_score=0.95,
        ai_prediction="anomaly",
        confidence=0.95,
        severity_level="critical",
        cvss_score=9.0,
        nist_category="CAT 1 - Unauthorized Access",
        enisa_threat_type="Compromised System",
        trigger_summary="VM1 security reporter heartbeat timeout. Host may be compromised, reporter killed, or network partitioned.",
        accuracy_basis="Heartbeat timeout exceeded threshold.",
        behavior_flags_json=json_dumps(["Host Unresponsive"]),
        changed_lines_json=json_dumps({}),
        context_json=json_dumps(context),
    )
    db.add(detection)
    db.commit()
    db.refresh(detection)

    incident = create_incident(
        db, detection,
        {
            "incident_type": "vm1_host_compromised",
            "severity_level": "critical",
            "cvss_score": 9.0,
            "cvss_vector": "AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H",
            "nist_category": "CAT 1 - Unauthorized Access",
            "enisa_threat_type": "Compromised System",
        },
        ["Host Unresponsive"],
        {},
        None,
    )
    incident.response_action = "escalated"
    db.add(incident)
    db.commit()
    create_incident_system_alert(db, incident, detection, None)
    set_setting(db, "vm1_last_silent_detection_at", now_utc().isoformat(), "vm2_monitor")
    set_setting(db, "vm1_last_heartbeat_status", "timeout_detected", "vm2_monitor")
    return detection
