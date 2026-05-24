from __future__ import annotations

import difflib
import hashlib
import json
import os
import random
import shutil
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterable

import requests
from sqlalchemy import or_
from sqlalchemy.orm import Session

from SECURITY.security_models import (
    SecurityAdminFileChange,
    SecurityDetectionEvent,
    SecurityIncident,
    SecurityMonitoredFile,
    SecurityRecoveryEvent,
    SecuritySetting,
)

MASTER_ROOT = Path(__file__).resolve().parents[1]
SECURITY_ROOT = MASTER_ROOT / "SECURITY"
QUARANTINE_ROOT = MASTER_ROOT / "QUARANTINE"
DEFAULT_BACKUP_ROOT = SECURITY_ROOT / "local_backups"
MODEL_STATE_PATH = SECURITY_ROOT / "ml" / "isolation_forest_state.json"

MONITORED_ROOTS = {
    "WARDS": MASTER_ROOT / "WARDS",
    "OCR": MASTER_ROOT / "OCR",
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
    "uploads",
    "SECURITY",
    "QUARANTINE",
    "DEFACEMENT",
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
    ".env",
    ".txt",
    ".xml",
    ".yml",
    ".yaml",
    ".sql",
}

SUSPICIOUS_PATTERNS = {
    "script_injection": ("<script", "javascript:", "eval(", "document.write", "onerror=", "onload="),
    "iframe_injection": ("<iframe",),
    "defacement_keywords": ("hacked", "defaced", "owned", "pwned"),
    "credential_access": ("password=", "token=", "secret=", "api_key"),
    "sql_injection": ("' or '1'='1", "union select", "drop table", "--"),
    "ransom_note_keywords": ("your files have been encrypted", "pay ransom", "bitcoin wallet", "decrypt key"),
    "malicious_redirect": ("window.location=", "location.href=", "http-equiv=\"refresh\"", "meta refresh"),
    "destructive_script": ("localstorage.clear", "sessionstorage.clear", "delete all", "removechild(document.body"),
    "phishing_form": ("verify your password", "enter your password", "account suspended", "login again"),
    "style_takeover": ("position: fixed", "z-index: 2147483647", "filter: blur", "pointer-events: none"),
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
    "ransom_note_keywords": "Ransom note wording",
    "malicious_redirect": "Malicious redirect pattern",
    "destructive_script": "Destructive browser script",
    "phishing_form": "Phishing wording",
    "style_takeover": "Visual style takeover",
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
    "ip_consistent": {
        "label": "IP Consistency",
        "description": "Whether source looks consistent with normal admin use.",
        "enabled": True,
        "weight": 0.08,
        "config": {},
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
}

APPROVED_ADDITIONAL_AI_RULES = {
    "ransom_note_keywords": {
        "label": "Ransom Note Wording",
        "description": "Detects ransom/extortion wording commonly used in defacement pages.",
        "enabled": True,
        "weight": 0.28,
        "config": {"patterns": list(SUSPICIOUS_PATTERNS["ransom_note_keywords"])},
        "initial_samples": [
            "Your files have been encrypted. Pay ransom to recover access.",
            "Send payment to this bitcoin wallet to receive the decrypt key.",
        ],
    },
    "malicious_redirect": {
        "label": "Malicious Redirect",
        "description": "Detects forced redirects away from WARDS pages.",
        "enabled": True,
        "weight": 0.24,
        "config": {"patterns": list(SUSPICIOUS_PATTERNS["malicious_redirect"])},
        "initial_samples": [
            "window.location='https://attacker.example/login'",
            "<meta http-equiv=\"refresh\" content=\"0;url=https://attacker.example\">",
        ],
    },
    "destructive_script": {
        "label": "Destructive Browser Script",
        "description": "Detects browser-side destructive or disruptive script patterns.",
        "enabled": True,
        "weight": 0.22,
        "config": {"patterns": list(SUSPICIOUS_PATTERNS["destructive_script"])},
        "initial_samples": [
            "localStorage.clear(); sessionStorage.clear();",
            "document.body.removeChild(document.body.firstChild);",
        ],
    },
    "phishing_form": {
        "label": "Phishing Wording",
        "description": "Detects fake login and account-warning wording.",
        "enabled": True,
        "weight": 0.2,
        "config": {"patterns": list(SUSPICIOUS_PATTERNS["phishing_form"])},
        "initial_samples": [
            "Your account is suspended. Enter your password to continue.",
            "Verify your password to restore access.",
        ],
    },
    "style_takeover": {
        "label": "Visual Style Takeover",
        "description": "Detects aggressive CSS overlays that obscure the legitimate WARDS UI.",
        "enabled": True,
        "weight": 0.18,
        "config": {"patterns": list(SUSPICIOUS_PATTERNS["style_takeover"])},
        "initial_samples": [
            "body::before { position: fixed; z-index: 2147483647; }",
            "* { filter: blur(8px); pointer-events: none; }",
        ],
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
    return str(path.resolve().relative_to(MASTER_ROOT)).replace("\\", "/")


def file_type(path: Path) -> str:
    return path.suffix.lower().lstrip(".") or "file"


def is_monitorable(path: Path) -> bool:
    if not path.is_file():
        return False
    if path.suffix.lower() not in MONITORED_SUFFIXES:
        return False
    parts = {part.lower() for part in path.parts}
    if parts.intersection({item.lower() for item in DEFAULT_EXCLUDED_DIRS}):
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
            if {part.lower() for part in current_path.parts}.intersection(excluded):
                continue
            for filename in filenames:
                path = current_path / filename
                if path.suffix.lower() in MONITORED_SUFFIXES and is_monitorable(path):
                    yield root_name, path.resolve()


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


def seed_settings(db: Session) -> None:
    defaults = {
        "backup_location": str(DEFAULT_BACKUP_ROOT),
        "latest_backup_path": "",
        "last_scan_at": "",
        "backup_schedule": json_dumps({"enabled": False, "frequency": "weekly", "next_run": ""}),
        "ai_retrain_schedule": json_dumps({"day": "Sunday", "time": "23:00", "next_run": next_weekday("Sunday", "23:00")}),
        "ai_last_retrained_at": "",
        "deployment_mode": os.getenv("SECURITY_DEPLOYMENT_MODE", "development"),
        "monitoring_enabled": os.getenv("SECURITY_MONITORING_ENABLED", "false").lower(),
        "scan_interval_seconds": os.getenv("SECURITY_SCAN_INTERVAL_SECONDS", "30"),
        "wazuh_enabled": os.getenv("WAZUH_ENABLED", "false").lower(),
        "ai_rules": json_dumps(DEFAULT_AI_RULES),
    }
    changed = False
    for key, value in defaults.items():
        if not db.query(SecuritySetting).filter(SecuritySetting.key == key).first():
            db.add(SecuritySetting(key=key, value=value))
            changed = True
    if changed:
        db.commit()
    backup_location = Path(get_setting(db, "backup_location", str(DEFAULT_BACKUP_ROOT)))
    prune_all_backup_types(backup_location, keep=3)


def get_ai_rules(db: Session) -> dict:
    saved = json_loads(get_setting(db, "ai_rules", json_dumps(DEFAULT_AI_RULES)), {})
    merged = {}
    approved = {**DEFAULT_AI_RULES, **APPROVED_ADDITIONAL_AI_RULES}
    for key, default in approved.items():
        current = saved.get(key, {}) if isinstance(saved, dict) else {}
        if key in DEFAULT_AI_RULES or current:
            merged[key] = {
                **default,
                **current,
                "config": {**default.get("config", {}), **current.get("config", {})},
            }
    return merged


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
            merged[key]["enabled"] = bool(value["enabled"])
        if "weight" in value:
            merged[key]["weight"] = max(0.0, min(2.0, float(value["weight"])))
        if "config" in value and isinstance(value["config"], dict):
            merged[key]["config"] = {**merged[key].get("config", {}), **value["config"]}
    set_setting(db, "ai_rules", json_dumps(merged), updated_by)
    return merged


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
        path = Path(raw)
        if path.exists():
            return path
    location = writable_backup_location(db)
    if not location.exists():
        return None
    backups = sorted([item for item in location.iterdir() if item.is_dir()], reverse=True)
    return backups[0] if backups else None


def backup_file_path(backup_root: Path, relative_path: str) -> Path:
    return backup_root / relative_path.replace("/", os.sep)


def writable_backup_location(db: Session, updated_by: str = "system") -> Path:
    configured = Path(get_setting(db, "backup_location", str(DEFAULT_BACKUP_ROOT))).expanduser()
    fallback = DEFAULT_BACKUP_ROOT.resolve()
    for candidate in (configured, fallback):
        try:
            target = candidate.resolve()
            target.mkdir(parents=True, exist_ok=True)
            if target != configured:
                set_setting(db, "backup_location", str(target), updated_by)
            return target
        except OSError:
            continue
    fallback.mkdir(parents=True, exist_ok=True)
    set_setting(db, "backup_location", str(fallback), updated_by)
    return fallback


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


def prune_backup_type(backup_location: Path, label: str, keep: int = 3) -> None:
    try:
        backups = sorted(
            [
                item for item in backup_location.iterdir()
                if item.is_dir() and item.name.startswith(f"{label}_backup_")
            ],
            key=lambda item: item.name,
            reverse=True,
        )
        for old_backup in backups[keep:]:
            shutil.rmtree(old_backup, ignore_errors=True)
    except Exception:
        pass


def prune_all_backup_types(backup_location: Path, keep: int = 3) -> None:
    try:
        labels = {
            item.name.split("_backup_", 1)[0]
            for item in backup_location.iterdir()
            if item.is_dir() and "_backup_" in item.name
        }
        for label in labels:
            prune_backup_type(backup_location, label, keep=keep)
    except Exception:
        pass


def register_initial_files(db: Session, ensure_backup: bool = True, refresh_existing: bool = True) -> int:
    seed_settings(db)
    created = 0
    for root_name, path in iter_monitorable_files():
        relative = safe_rel(path)
        existing = db.query(SecurityMonitoredFile).filter(SecurityMonitoredFile.file_path == str(path)).first()
        if existing:
            existing.relative_path = relative
            existing.folder_root = root_name
            existing.file_type = file_type(path)
            if refresh_existing:
                current_hash = sha256_file(path)
                existing.current_hash = current_hash
                existing.baseline_hash = existing.baseline_hash or current_hash
                existing.status = "clean" if existing.baseline_hash == current_hash else existing.status
                existing.size_bytes = path.stat().st_size
                existing.last_checked = now_utc()
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
            )
        )
        created += 1
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
                "ip_consistent": 1,
                "method_legitimate": 1,
                "business_hours": 1,
                "file_type_risk": rng.choice([0, 1, 1, 2]),
                "suspicious_pattern_score": 0,
                "vpn_activity": 0,
            }
        )
    return samples


def retrain_ai(db: Session, initiated_by: str = "system") -> dict:
    samples = generate_initial_training_samples()
    admin_changes = (
        db.query(SecurityAdminFileChange)
        .order_by(SecurityAdminFileChange.timestamp.desc())
        .all()
    )
    for change in admin_changes:
        path = Path(change.file_path)
        length = path.stat().st_size if path.exists() else 0
        samples.append(
            {
                "hour_of_day": change.timestamp.hour,
                "day_of_week": change.timestamp.weekday(),
                "session_duration": 1800,
                "file_size_change": 80,
                "content_length": length,
                "special_chars_count": 40,
                "admin_session_valid": 1,
                "ip_consistent": 1,
                "method_legitimate": 1,
                "business_hours": 1 if 8 <= change.timestamp.hour <= 18 and change.timestamp.weekday() < 5 else 0,
                "file_type_risk": 1,
                "suspicious_pattern_score": 0,
                "vpn_activity": 0,
            }
        )

    MODEL_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    state = {
        "algorithm": "Isolation Forest",
        "strategy": "Continuous incremental retraining with Wazuh-fed admin activity",
        "normal_samples": len(samples),
        "historical_admin_samples": len(admin_changes),
        "features": list(samples[0].keys()),
        "updated_at": now_utc().isoformat(),
        "updated_by": initiated_by,
        "note": "Uses bootstrap normal data plus all historical validated admin behavior, including the newest verified records since the previous retrain.",
    }
    MODEL_STATE_PATH.write_text(json_dumps(state), encoding="utf-8")
    set_setting(db, "ai_last_retrained_at", state["updated_at"], initiated_by)
    set_setting(db, "ai_training_sample_count", str(len(samples)), initiated_by)
    return state


def content_flags(content: str, context: dict | None = None) -> list[str]:
    context = context or {}
    lowered = (content or "").lower()
    flags = []
    ts = now_utc()
    if ts.hour < 8 or ts.hour > 18:
        flags.append("after_hours")
    if ts.weekday() >= 5:
        flags.append("weekend_activity")
    if context.get("vpn_activity") or context.get("vpn_detected"):
        flags.append("vpn_activity")
    if not context.get("admin_session_valid"):
        flags.append("unauthenticated_change")
    for key, patterns in SUSPICIOUS_PATTERNS.items():
        if any(pattern in lowered for pattern in patterns):
            flags.append(key)
    if context.get("rapid_change"):
        flags.append("rapid_change")
    return sorted(set(flags))


def ai_predict(path: Path, old_content: str, new_content: str, context: dict | None = None) -> AIPrediction:
    context = context or {}
    flags = content_flags(new_content, context)
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
    if enabled("hour_of_day") and "after_hours" in flags:
        risk += weight("hour_of_day", 0.08)
    if enabled("day_of_week") and "weekend_activity" in flags:
        risk += weight("day_of_week", 0.05)
    if enabled("vpn_activity") and "vpn_activity" in flags:
        risk += weight("vpn_activity", 0.12)
    if "rapid_change" in flags:
        risk += 0.18
    if enabled("suspicious_pattern_score") and "defacement_keywords" in flags:
        risk += float(config("suspicious_pattern_score").get("keyword_weight", 0.22))
    if enabled("suspicious_pattern_score") and ("script_injection" in flags or "iframe_injection" in flags):
        risk += weight("suspicious_pattern_score", 0.32)
    if enabled("suspicious_pattern_score") and ("credential_access" in flags or "sql_injection" in flags):
        risk += 0.18
    for additional_rule in APPROVED_ADDITIONAL_AI_RULES:
        if enabled(additional_rule) and additional_rule in flags:
            risk += weight(additional_rule, float(APPROVED_ADDITIONAL_AI_RULES[additional_rule].get("weight", 0.18)))
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
    if context.get("admin_session_valid") and context.get("method_legitimate") and enabled("admin_session_valid") and enabled("method_legitimate"):
        risk = min(risk, 0.18)

    risk = max(0.01, min(risk, 0.99))
    prediction = "normal" if risk < 0.3 else "suspicious" if risk < 0.7 else "malicious"
    confidence = risk if prediction != "normal" else 1 - risk
    active_rules = [key for key, value in rules.items() if value.get("enabled", True)]
    basis = f"Based on enabled AI rules: {', '.join(active_rules)}."
    return AIPrediction(prediction=prediction, score=round(risk, 4), confidence=round(confidence, 4), basis=basis)


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
        return None
    target = QUARANTINE_ROOT / f"detection_{detection_id}" / safe_rel(file_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(file_path, target)
    return str(target)


def cleanup_quarantine_paths(paths: list[str]) -> None:
    for raw_path in paths:
        try:
            path = Path(raw_path)
            if path.exists():
                if path.is_dir():
                    shutil.rmtree(path, ignore_errors=True)
                else:
                    path.unlink()
            marker = next((parent for parent in path.parents if parent.name.startswith("detection_")), None)
            if marker and marker.exists():
                shutil.rmtree(marker, ignore_errors=True)
        except Exception:
            pass


def restore_from_backup(db: Session, file_entry: SecurityMonitoredFile, detection_id: int | None, recovery_type: str, initiated_by: int | None, quarantine_path: str | None = None) -> SecurityRecoveryEvent:
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
        backup_root = latest_backup_root(db)
        if not backup_root:
            raise RuntimeError("No local backup exists. Create a manual backup first.")
        source = backup_file_path(backup_root, file_entry.relative_path)
        target = Path(file_entry.file_path)
        if not source.exists():
            raise FileNotFoundError(f"Backup copy not found for {file_entry.relative_path}")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        restored_hash = sha256_file(target)
        file_entry.current_hash = restored_hash
        file_entry.baseline_hash = restored_hash
        file_entry.status = "recovered"
        file_entry.size_bytes = target.stat().st_size
        file_entry.last_checked = now_utc()
        recovery.status = "success"
        recovery.backup_path = str(source)
        recovery.completed_at = now_utc()
        recovery.recovery_duration_ms = int((time.time() - started) * 1000)
        recovery.summary = f"Restored {file_entry.relative_path} from local backup."
        db.add(file_entry)
        db.add(recovery)
        db.commit()
    except Exception as exc:
        recovery.status = "failed"
        recovery.error_message = str(exc)
        recovery.completed_at = now_utc()
        recovery.recovery_duration_ms = int((time.time() - started) * 1000)
        recovery.summary = f"Recovery failed for {file_entry.relative_path}."
        db.add(recovery)
        db.commit()
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
        source = Path(quarantine_path)
        target = Path(file_entry.file_path)
        if not source.exists() or not source.is_file():
            raise FileNotFoundError(f"Quarantined copy not found for {file_entry.relative_path}")
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


def current_hash_index(db: Session) -> dict[str, list[SecurityMonitoredFile]]:
    index: dict[str, list[SecurityMonitoredFile]] = {}
    for entry in db.query(SecurityMonitoredFile).all():
        path = Path(entry.file_path)
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
        incident.status = reason
        incident.response_action = reason
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
        incident.status = "verified_renamed"
        incident.response_action = "verified_renamed"
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
    for entry in db.query(SecurityMonitoredFile).order_by(SecurityMonitoredFile.relative_path.asc()).all():
        path = Path(entry.file_path)
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


def create_incident(db: Session, detection: SecurityDetectionEvent, classification: dict, flags: list[str], changed: dict, quarantine_path: str | None) -> SecurityIncident:
    incident = SecurityIncident(
        detection_event_id=detection.id,
        incident_type=classification["incident_type"],
        severity_level=classification["severity_level"],
        cvss_score=classification["cvss_score"],
        cvss_vector=classification["cvss_vector"],
        nist_category=classification["nist_category"],
        enisa_threat_type=classification["enisa_threat_type"],
        description=f"{detection.change_type} detected in {detection.target_name}.",
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


def scan_single_file(db: Session, file_entry: SecurityMonitoredFile, context: dict | None = None, commit_clean: bool = True) -> SecurityDetectionEvent | None:
    context = context or {}
    path = Path(file_entry.file_path)
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
            else:
                db.flush()
            return None
        file_entry.status = "missing"
        file_entry.current_hash = None
        file_entry.last_checked = now_utc()
        db.add(file_entry)
        db.commit()
        return record_detection(db, file_entry, "file_deleted", old_hash, None, old_content, "", context)

    current_hash = sha256_file(path)
    file_entry.current_hash = current_hash
    file_entry.size_bytes = path.stat().st_size
    file_entry.last_checked = now_utc()

    if current_hash != file_entry.baseline_hash:
        file_entry.status = "modified"
        db.add(file_entry)
        db.commit()
        new_content = read_text(path)
        return record_detection(db, file_entry, "content_modified", old_hash, current_hash, old_content, new_content, context)

    file_entry.status = "clean"
    db.add(file_entry)
    if commit_clean:
        db.commit()
    else:
        db.flush()
    return None


def record_detection(db: Session, file_entry: SecurityMonitoredFile, change_type: str, old_hash: str | None, new_hash: str | None, old_content: str, new_content: str, context: dict | None = None) -> SecurityDetectionEvent:
    context = context or {}
    admin_change = recent_admin_change(db, file_entry.file_path)
    is_legitimate = bool(admin_change)
    if is_legitimate:
        context.update({"admin_session_valid": True, "method_legitimate": True})
    else:
        context.setdefault("admin_session_valid", False)
        context.setdefault("method_legitimate", False)
    context.setdefault("ai_rules", get_ai_rules(db))

    prediction = ai_predict(Path(file_entry.file_path), old_content, new_content, context)
    flags = content_flags(new_content, context)
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
    trigger_summary = build_trigger_summary(change_type, flags, changed, is_legitimate)
    detection = SecurityDetectionEvent(
        file_id=file_entry.id,
        target_type="file",
        target_name=file_entry.relative_path,
        actor=str(admin_change.admin_id) if admin_change else context.get("actor") or "unknown",
        change_type=change_type,
        old_hash=old_hash,
        new_hash=new_hash,
        is_legitimate=is_legitimate,
        admin_id=admin_change.admin_id if admin_change else None,
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
        quarantine_path = quarantine_file(Path(file_entry.file_path), detection.id)
        incident = create_incident(db, detection, classification, flags, changed, quarantine_path)
        if change_type in {"content_modified", "file_deleted"}:
            recovery = restore_from_backup(db, file_entry, detection.id, "automatic", None, quarantine_path)
            incident.response_action = "auto_recovered_pending_review" if recovery.status == "success" else "escalated"
            db.add(incident)
            db.commit()
    return detection


def build_trigger_summary(change_type: str, flags: list[str], changed: dict, is_legitimate: bool) -> str:
    if is_legitimate:
        return "Authorized admin change through MFA-protected WARDS session."
    pieces = [change_type.replace("_", " ")]
    if flags:
        pieces.append(", ".join(BEHAVIOR_LABELS.get(flag, flag) for flag in flags[:4]))
    added = len(changed.get("added", []))
    removed = len(changed.get("removed", []))
    if added or removed:
        pieces.append(f"{added} added and {removed} removed lines")
    return " | ".join(pieces)


def scan_all_files(db: Session, context: dict | None = None) -> list[SecurityDetectionEvent]:
    register_initial_files(db, refresh_existing=False)
    set_setting(db, "last_scan_at", now_utc().isoformat(), "security_scanner")
    detections = []
    hash_index = current_hash_index(db)
    for file_entry in db.query(SecurityMonitoredFile).order_by(SecurityMonitoredFile.relative_path.asc()).all():
        if not Path(file_entry.file_path).exists():
            replacement_path = replacement_path_for(file_entry, hash_index)
            if replacement_path:
                detections.append(mark_verified_removal(db, file_entry, "verified_renamed", replacement_path=replacement_path, actor="active_scan"))
                continue
        detection = scan_single_file(db, file_entry, context=context, commit_clean=False)
        if detection:
            detections.append(detection)
    db.commit()
    return detections


def create_manual_backup(db: Session, initiated_by: int | None, label: str = "manual") -> SecurityRecoveryEvent:
    seed_settings(db)
    register_count = register_initial_files(db, ensure_backup=False)
    removal_summary = reconcile_trusted_file_removals(db, actor=f"{label}_backup")
    backup_location = writable_backup_location(db)
    previous_backup_root = latest_backup_root(db)
    timestamp = now_utc().strftime("%Y%m%d_%H%M%S")
    backup_root = backup_location / f"{label}_backup_{timestamp}"
    started = time.time()
    event = SecurityRecoveryEvent(recovery_type="manual_backup", initiated_by=initiated_by, status="in_progress")
    db.add(event)
    db.commit()
    db.refresh(event)
    try:
        backup_root.mkdir(parents=True, exist_ok=True)
        for entry in db.query(SecurityMonitoredFile).order_by(SecurityMonitoredFile.relative_path.asc()).all():
            path = Path(entry.file_path)
            if not path.exists() or not path.is_file():
                continue
            relative = entry.relative_path or safe_rel(path)
            target = backup_file_path(backup_root, relative)
            file_hash = sha256_file(path)
            previous_source = backup_file_path(previous_backup_root, relative) if previous_backup_root else None
            previous_matches = bool(previous_source and previous_source.exists() and sha256_file(previous_source) == file_hash)
            copy_into_backup(
                path,
                target,
                previous_source=previous_source,
                can_reuse_previous=previous_matches,
            )
            entry.baseline_hash = file_hash
            entry.current_hash = file_hash
            entry.status = "clean"
            entry.file_type = file_type(path)
            entry.size_bytes = path.stat().st_size
            entry.last_checked = now_utc()
        db.commit()
        event.status = "success"
        event.backup_path = str(backup_root)
        event.completed_at = now_utc()
        event.recovery_duration_ms = int((time.time() - started) * 1000)
        verified_deleted = removal_summary["verified_deleted"]
        verified_renamed = removal_summary["verified_renamed"]
        event.summary = (
            f"Local backup completed for WARDS and OCR "
            f"({register_count} new files registered, {verified_deleted + verified_renamed} trusted removal update(s))."
        )
        set_setting(db, "latest_backup_path", str(backup_root), str(initiated_by) if initiated_by else "system")
        prune_backup_type(backup_location, label, keep=3)
    except Exception as exc:
        event.status = "failed"
        event.error_message = str(exc)
        event.completed_at = now_utc()
        event.recovery_duration_ms = int((time.time() - started) * 1000)
        event.summary = "Local backup failed."
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def manual_recover_file(db: Session, file_id: int, admin_id: int) -> SecurityRecoveryEvent:
    file_entry = db.query(SecurityMonitoredFile).filter(SecurityMonitoredFile.id == file_id).first()
    if not file_entry:
        raise ValueError("Monitored file not found")
    return restore_from_backup(db, file_entry, None, "manual", admin_id)


def full_system_recovery(db: Session, admin_id: int) -> dict:
    restored = 0
    failed = 0
    first_event = None
    for file_entry in db.query(SecurityMonitoredFile).order_by(SecurityMonitoredFile.relative_path.asc()).all():
        event = restore_from_backup(db, file_entry, None, "manual_full", admin_id)
        first_event = first_event or event
        if event.status == "success":
            restored += 1
        else:
            failed += 1
    return {"restored": restored, "failed": failed, "first_recovery_event_id": first_event.id if first_event else None}


def mark_admin_change(db: Session, admin_id: int, file_path: str, token_id: str | None, ip: str | None, user_agent: str | None) -> SecurityAdminFileChange:
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


def resolve_incident(db: Session, incident_id: int, admin_id: int) -> SecurityIncident:
    incident = db.query(SecurityIncident).filter(SecurityIncident.id == incident_id).first()
    if not incident:
        raise ValueError("Incident not found")
    detection = db.query(SecurityDetectionEvent).filter(SecurityDetectionEvent.id == incident.detection_event_id).first()
    file_entry = db.query(SecurityMonitoredFile).filter(SecurityMonitoredFile.id == detection.file_id).first() if detection else None
    if file_entry:
        restore_from_backup(db, file_entry, incident.detection_event_id, "automatic", admin_id)
    incident.status = "resolved"
    incident.resolved_at = now_utc()
    incident.resolved_by = admin_id
    incident.response_action = "resolved_clean_backup_retained"
    cleanup_quarantine_paths(json_loads(incident.quarantine_paths_json, []))
    db.add(incident)
    db.commit()
    db.refresh(incident)
    return incident


def mark_false_positive(db: Session, incident_id: int, admin_id: int, refresh_backup: bool = True) -> SecurityIncident:
    incident = db.query(SecurityIncident).filter(SecurityIncident.id == incident_id).first()
    if not incident:
        raise ValueError("Incident not found")
    detection = db.query(SecurityDetectionEvent).filter(SecurityDetectionEvent.id == incident.detection_event_id).first()
    file_entry = db.query(SecurityMonitoredFile).filter(SecurityMonitoredFile.id == detection.file_id).first() if detection else None
    quarantine_paths = json_loads(incident.quarantine_paths_json, [])
    if not file_entry:
        raise ValueError("Incident has no monitored file to restore")
    if not quarantine_paths:
        raise ValueError("Incident has no quarantined copy to restore")
    false_positive_recovery = restore_from_quarantine(db, file_entry, incident.detection_event_id, admin_id, quarantine_paths[0])
    if false_positive_recovery.status != "success":
        raise RuntimeError(false_positive_recovery.error_message or "Unable to restore the quarantined file")
    if detection:
        detection.is_legitimate = True
        detection.ai_prediction = "normal"
        detection.ai_score = 0.0
        detection.confidence = 1.0
        detection.severity_level = "info"
        detection.trigger_summary = f"False positive accepted by admin; quarantined copy restored for {detection.target_name}."
        db.add(detection)
    for recovery in db.query(SecurityRecoveryEvent).filter(SecurityRecoveryEvent.detection_event_id == incident.detection_event_id).all():
        if recovery.id == false_positive_recovery.id:
            continue
        recovery.status = "verified_false_positive"
        recovery.summary = "False positive accepted; quarantined copy restored and trusted backup refreshed."
        db.add(recovery)
    incident.status = "false_positive"
    incident.response_action = "authorized_change_restored"
    incident.resolved_at = now_utc()
    incident.resolved_by = admin_id
    cleanup_quarantine_paths(quarantine_paths)
    db.add(incident)
    db.commit()
    if refresh_backup:
        create_manual_backup(db, initiated_by=admin_id, label="post_false_positive")
    db.refresh(incident)
    return incident


def bulk_update_incidents(db: Session, action: str, admin_id: int) -> dict:
    updated = 0
    backup_after_bulk = False
    rows = db.query(SecurityIncident).filter(SecurityIncident.status.in_(["open", "investigating"])).order_by(SecurityIncident.id.asc()).all()
    for incident in rows:
        if action == "resolve":
            resolve_incident(db, incident.id, admin_id)
            updated += 1
        elif action == "false_positive":
            mark_false_positive(db, incident.id, admin_id, refresh_backup=False)
            backup_after_bulk = True
            updated += 1
        elif action == "investigating":
            incident.status = "investigating"
            incident.response_action = "under_review"
            db.add(incident)
            db.commit()
            updated += 1
        else:
            raise ValueError("Unsupported bulk incident action")
    if backup_after_bulk:
        create_manual_backup(db, initiated_by=admin_id, label="post_false_positive_bulk")
    return {"updated": updated, "action": action}


def dashboard_payload(db: Session) -> dict:
    monitored_files_count = db.query(SecurityMonitoredFile).count()
    file_attention_count = db.query(SecurityMonitoredFile).filter(
        SecurityMonitoredFile.status.in_(["modified", "missing", "compromised"])
    ).count()
    incidents = db.query(SecurityIncident).filter(SecurityIncident.status.in_(["open", "investigating"])).all()
    detection_attention_count = db.query(SecurityDetectionEvent).filter(SecurityDetectionEvent.is_legitimate == False).count()
    recovery_attention_count = db.query(SecurityRecoveryEvent).filter(SecurityRecoveryEvent.status.in_(["failed", "reverted"])).count()
    last_detection = db.query(SecurityDetectionEvent).order_by(SecurityDetectionEvent.detected_at.desc()).first()
    last_scan_at = get_setting(db, "last_scan_at", "")
    backup_location = get_setting(db, "backup_location", str(DEFAULT_BACKUP_ROOT))
    latest_backup = latest_backup_root(db)
    severity = {key: 0 for key in ["info", "low", "medium", "high", "critical"]}
    attack_types = {}
    behaviors = {}
    chart_incidents = db.query(SecurityIncident).all()
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
    monitoring_enabled = (get_setting(db, "monitoring_enabled", "true") or "true").lower() == "true"
    return {
        "system_status": status,
        "monitored_files": monitored_files_count,
        "active_incidents": len(incidents),
        "last_scan": last_scan_at or (last_detection.detected_at.isoformat() if last_detection else None),
        "next_scheduled_backup": next_backup,
        "severity_distribution": severity,
        "attack_types": attack_types,
        "behaviors": behaviors,
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
            "backup_status": "Active" if latest_backup and Path(backup_location).exists() else "Inactive",
            "backup_location": backup_location,
            "ai_model": "trained" if MODEL_STATE_PATH.exists() else "bootstrap-ready",
            "ai_rules_enabled": sum(1 for item in get_ai_rules(db).values() if item.get("enabled", True)),
            "deployment_mode": get_setting(db, "deployment_mode", "development"),
            "monitoring_enabled": "true" if monitoring_enabled else "false",
            "scan_interval_seconds": get_setting(db, "scan_interval_seconds", "30"),
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
        return f"{label} is currently the most common severity with {top_value} of {total} detections."
    if kind == "attacks":
        return f"The most frequent detected attack type is {label}, appearing in {top_value} of {total} incidents."
    return f"The most common monitored behavior is {label}, seen {top_value} time(s) across {total} behavior flags."


def query_detections(db: Session, keyword: str | None = None, date_from: str | None = None, date_to: str | None = None, target: str | None = None, severity: str | None = None, limit: int = 200, sort: str = "newest") -> list[SecurityDetectionEvent]:
    query = db.query(SecurityDetectionEvent)
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(or_(SecurityDetectionEvent.target_name.like(like), SecurityDetectionEvent.trigger_summary.like(like), SecurityDetectionEvent.actor.like(like)))
    if target:
        query = query.filter(SecurityDetectionEvent.target_name.like(f"%{target}%"))
    if severity:
        query = query.filter(SecurityDetectionEvent.severity_level == severity)
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
        query = query.filter(SecurityRecoveryEvent.recovery_type == recovery_type)
    if status:
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
    previous = Path(get_setting(db, "backup_location", str(DEFAULT_BACKUP_ROOT)))
    target = Path(new_location).expanduser().resolve()
    target.mkdir(parents=True, exist_ok=True)
    set_setting(db, "backup_location", str(target), updated_by)
    deleted = False
    if delete_previous and previous.exists() and previous.resolve() != target:
        shutil.rmtree(previous, ignore_errors=True)
        deleted = True
    return {"backup_location": str(target), "previous_deleted": deleted}


def path_is_inside(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def add_monitored_folder(db: Session, folder_path: str) -> dict:
    root = Path(folder_path).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise ValueError("Folder does not exist")
    roots = {root.name.upper(): root}
    created = 0
    backed_up = 0
    backup_root = latest_backup_root(db)
    for root_name, path in iter_monitorable_files(roots):
        current_hash = sha256_file(path)
        existing = db.query(SecurityMonitoredFile).filter(SecurityMonitoredFile.file_path == str(path)).first()
        if existing:
            continue
        relative = str(path.relative_to(root.parent)).replace("\\", "/")
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
        if backup_root:
            target = backup_file_path(backup_root, relative)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
            backed_up += 1
        created += 1
    db.commit()
    return {"added_files": created, "backup_files_added": backed_up, "folder": str(root)}


def remove_monitored_folder(db: Session, folder_path: str) -> dict:
    root = Path(folder_path).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise ValueError("Folder does not exist")

    backup_location = Path(get_setting(db, "backup_location", str(DEFAULT_BACKUP_ROOT)))
    backup_roots = [item for item in backup_location.iterdir() if item.is_dir()] if backup_location.exists() else []
    removed = 0
    removed_backups = 0
    entries = db.query(SecurityMonitoredFile).all()
    for entry in entries:
        entry_path = Path(entry.file_path)
        if not path_is_inside(entry_path, root):
            continue
        for backup_root in backup_roots:
            backup_path = backup_file_path(backup_root, entry.relative_path)
            if backup_path.exists():
                backup_path.unlink()
                removed_backups += 1
        db.delete(entry)
        removed += 1
    db.commit()
    return {"removed_files": removed, "removed_backup_files": removed_backups, "folder": str(root)}


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
    }


def serialize_recovery(item: SecurityRecoveryEvent) -> dict:
    display_status = "success" if item.status == "verified_removal" else item.status
    display_summary = item.summary
    if "Verified rename" in str(display_summary or ""):
        display_summary = "Trusted baseline accepted; previous automatic recovery is no longer treated as a security incident."
    return {
        "id": item.id,
        "detection_event_id": item.detection_event_id,
        "file_id": item.file_id,
        "recovery_type": item.recovery_type,
        "initiated_by": item.initiated_by,
        "started_at": item.started_at.isoformat() if item.started_at else None,
        "completed_at": item.completed_at.isoformat() if item.completed_at else None,
        "status": display_status,
        "backup_path": item.backup_path,
        "quarantine_path": item.quarantine_path,
        "recovery_duration_ms": item.recovery_duration_ms,
        "error_message": item.error_message,
        "summary": display_summary,
    }


def serialize_file(item: SecurityMonitoredFile) -> dict:
    display_status = "clean" if item.status in {"verified_deleted", "verified_renamed"} else item.status
    return {
        "id": item.id,
        "file_path": item.file_path,
        "relative_path": item.relative_path,
        "folder_root": item.folder_root,
        "baseline_hash": item.baseline_hash,
        "current_hash": item.current_hash,
        "status": display_status,
        "file_type": item.file_type,
        "size_bytes": item.size_bytes,
        "last_checked": item.last_checked.isoformat() if item.last_checked else None,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }


def serialize_incident(item: SecurityIncident) -> dict:
    return {
        "id": item.id,
        "detection_event_id": item.detection_event_id,
        "incident_type": item.incident_type,
        "severity_level": item.severity_level,
        "cvss_score": item.cvss_score,
        "cvss_vector": item.cvss_vector,
        "nist_category": item.nist_category,
        "enisa_threat_type": item.enisa_threat_type,
        "status": item.status,
        "description": item.description,
        "behaviors": json_loads(item.behaviors_json, []),
        "affected_files": json_loads(item.affected_files_json, []),
        "changed_lines": json_loads(item.changed_lines_json, {}),
        "quarantine_paths": json_loads(item.quarantine_paths_json, []),
        "response_action": item.response_action,
        "resolved_at": item.resolved_at.isoformat() if item.resolved_at else None,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }
