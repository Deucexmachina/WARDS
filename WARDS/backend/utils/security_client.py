# WARDS Security Client Adapter
# This module proxies security engine calls to a remote Security VM when
# SECURITY_API_URL is configured, otherwise falls back to local imports.
import os
import time
import threading
from datetime import datetime
from typing import Any

import requests
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Shared session for connection pooling to VM2
_session = requests.Session()
_session.headers.update({"Connection": "keep-alive"})

SECURITY_API_URL = os.getenv("SECURITY_API_URL", "").rstrip("/")
SECURITY_API_KEY = os.getenv("SECURITY_API_KEY", "")
TIMEOUT = 8.0

# In-memory cache for VM2 read responses to avoid repeated slow calls
_cache: dict[str, tuple[Any, float]] = {}
_cache_lock = threading.Lock()
_CACHE_TTL: dict[str, int] = {
    "dashboard_payload": 10,
    "list_monitored_files": 30,
    "source_ids": 10,
    "query_detections": 10,
    "query_recoveries": 10,
    "get_ai_rules": 60,
    "get_ai_sensitivity": 60,
    "get_setting": 30,
    "current_hash_index": 30,
}


def _cached_fetch(cache_key: str, ttl_seconds: int, fetch_fn, default=None):
    now = time.time()
    with _cache_lock:
        if cache_key in _cache:
            value, expiry = _cache[cache_key]
            if now < expiry:
                return value
    try:
        value = fetch_fn()
        with _cache_lock:
            _cache[cache_key] = (value, now + ttl_seconds)
        return value
    except Exception:
        with _cache_lock:
            if cache_key in _cache:
                return _cache[cache_key][0]
        return default


def _headers() -> dict[str, str]:
    return {"X-API-Key": SECURITY_API_KEY, "Content-Type": "application/json"}


def _sync_post(path: str, json_data: dict | None = None, timeout: float | None = None) -> Any:
    if not SECURITY_API_URL:
        raise RuntimeError("SECURITY_API_URL is not configured")
    url = f"{SECURITY_API_URL}{path}"
    r = _session.post(url, headers=_headers(), json=json_data, timeout=timeout or TIMEOUT, verify=False)
    if r.status_code == 409:
        from SECURITY.security_engine import MissingFileConfirmationRequired
        try:
            body = r.json()
            detail = body.get("detail") if isinstance(body, dict) else body
            if not isinstance(detail, dict):
                detail = {"message": str(detail)}
        except Exception:
            detail = {"message": r.text or "Confirmation required"}
        raise MissingFileConfirmationRequired(detail)
    r.raise_for_status()
    return r.json()


def _sync_get(path: str, params: dict | None = None, timeout: float | None = None) -> Any:
    if not SECURITY_API_URL:
        raise RuntimeError("SECURITY_API_URL is not configured")
    url = f"{SECURITY_API_URL}{path}"
    r = _session.get(url, headers=_headers(), params=params, timeout=timeout or TIMEOUT, verify=False)
    r.raise_for_status()
    return r.json()


# ---------------------------------------------------------------------------
# Dashboard / query proxies
# ---------------------------------------------------------------------------
def dashboard_payload(db) -> dict:
    if not SECURITY_API_URL:
        from SECURITY.security_engine import dashboard_payload as _local
        return _local(db)
    return _cached_fetch("dashboard_payload", _CACHE_TTL["dashboard_payload"], lambda: _sync_get("/v1/dashboard"), default={})


def active_monitored_files_query(db):
    # Returns an ORM query builder (used with .all(), .filter(), .order_by()).
    # This cannot be serialized over HTTP, so it always runs locally against
    # the VM 1 database until Phase 8 fully decouples ORM model imports.
    from SECURITY.security_engine import active_monitored_files_query as _local
    return _local(db)


def list_monitored_files(db):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import active_monitored_files_query as _local
        from SECURITY.security_models import SecurityMonitoredFile
        return [serialize_file(item) for item in _local(db).order_by(SecurityMonitoredFile.relative_path.asc()).all()]
    return _cached_fetch("list_monitored_files", _CACHE_TTL["list_monitored_files"], lambda: _sync_get("/v1/files"), default=[])


def query_incidents(db, keyword=None, status=None, severity=None, date_from=None, date_to=None, limit=200, sort="newest"):
    if not SECURITY_API_URL:
        from SECURITY.security_models import SecurityIncident
        from datetime import datetime
        query = db.query(SecurityIncident)
        if status:
            if status == "resolved":
                query = query.filter(SecurityIncident.status.in_(["resolved", "verified_deleted", "verified_renamed"]))
            else:
                query = query.filter(SecurityIncident.status == status)
        if severity:
            query = query.filter(SecurityIncident.severity_level == severity)
        if keyword:
            query = query.filter(SecurityIncident.description.like(f"%{keyword}%"))
        if date_from:
            query = query.filter(SecurityIncident.created_at >= datetime.fromisoformat(date_from))
        if date_to:
            query = query.filter(SecurityIncident.created_at <= datetime.fromisoformat(f"{date_to}T23:59:59" if len(date_to) == 10 else date_to))
        order = SecurityIncident.created_at.asc() if sort == "oldest" else SecurityIncident.created_at.desc()
        return query.order_by(order).limit(limit).all()
    return _sync_post("/v1/incidents/query", {
        "keyword": keyword, "status": status, "severity": severity,
        "date_from": date_from, "date_to": date_to, "limit": limit, "sort": sort,
    })


def source_ids_for_log_type(db, log_type: str) -> list[int]:
    if not SECURITY_API_URL:
        from SECURITY.security_models import SecurityIncident, SecurityDetectionEvent, SecurityRecoveryEvent
        if log_type == "detections":
            rows = db.query(SecurityDetectionEvent.id).filter(SecurityDetectionEvent.is_legitimate == False).all()
        elif log_type == "recoveries":
            rows = db.query(SecurityRecoveryEvent.id).filter(SecurityRecoveryEvent.recovery_type.notlike("%backup%")).all()
        elif log_type == "incidents":
            rows = db.query(SecurityIncident.id).filter(SecurityIncident.status.in_(["open", "investigating"])).all()
        elif log_type == "backups":
            rows = db.query(SecurityRecoveryEvent.id).filter(SecurityRecoveryEvent.recovery_type.like("%backup%")).all()
        else:
            raise ValueError("Invalid security log type.")
        return [row[0] for row in rows]
    def _fetch():
        resp = _sync_get(f"/v1/source-ids/{log_type}")
        return resp.get("ids", [])
    return _cached_fetch(f"source_ids:{log_type}", _CACHE_TTL["source_ids"], _fetch, default=[])


def source_ids_batch(db, log_types: list[str]) -> dict[str, list[int]]:
    """Fetch source IDs for multiple log types from VM2."""
    if not SECURITY_API_URL:
        return {lt: source_ids_for_log_type(db, lt) for lt in log_types}

    results: dict[str, list[int]] = {}
    for lt in log_types:
        try:
            r = _session.get(f"{SECURITY_API_URL}/v1/source-ids/{lt}", headers=_headers(), timeout=TIMEOUT, verify=False)
            r.raise_for_status()
            results[lt] = r.json().get("ids", [])
        except Exception:
            results[lt] = []
    return results


def query_detections(db, keyword=None, date_from=None, date_to=None, target=None, severity=None, limit=200, sort="newest", classification=None):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import query_detections as _local
        return _local(db, keyword, date_from, date_to, target, severity, limit, sort, classification)
    def _fetch():
        return _sync_post("/v1/detections/query", {
            "keyword": keyword, "date_from": date_from, "date_to": date_to,
            "target": target, "severity": severity, "limit": limit, "sort": sort, "classification": classification,
        })
    cache_key = f"query_detections:{keyword}:{date_from}:{date_to}:{target}:{severity}:{limit}:{sort}:{classification}"
    return _cached_fetch(cache_key, _CACHE_TTL["query_detections"], _fetch, default=[])


def query_recoveries(db, keyword=None, date_from=None, date_to=None, recovery_type=None, status=None, limit=200, sort="newest"):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import query_recoveries as _local
        return _local(db, keyword, date_from, date_to, recovery_type, status, limit, sort)
    def _fetch():
        return _sync_post("/v1/recoveries/query", {
            "keyword": keyword, "date_from": date_from, "date_to": date_to,
            "recovery_type": recovery_type, "status": status, "limit": limit, "sort": sort,
        })
    cache_key = f"query_recoveries:{keyword}:{date_from}:{date_to}:{recovery_type}:{status}:{limit}:{sort}"
    return _cached_fetch(cache_key, _CACHE_TTL["query_recoveries"], _fetch, default=[])


# ---------------------------------------------------------------------------
# Scanning proxies
# ---------------------------------------------------------------------------
def scan_single_file(db, file_entry, context=None, commit_clean=True):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import scan_single_file as _local
        return _local(db, file_entry, context=context, commit_clean=commit_clean)
    payload = {
        "file_id": getattr(file_entry, "id", None),
        "relative_path": getattr(file_entry, "relative_path", None),
        "context": context or {},
        "commit_clean": commit_clean,
    }
    return _sync_post("/v1/scan/file", payload)


def scan_all_files(db, context=None):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import scan_all_files as _local
        return _local(db, context=context)
    return _sync_post("/v1/scan/all", {"context": context or {}})


# ---------------------------------------------------------------------------
# AI rule proxies
# ---------------------------------------------------------------------------
def get_ai_rules(db) -> dict:
    if not SECURITY_API_URL:
        from SECURITY.security_engine import get_ai_rules as _local
        return _local(db)
    return _cached_fetch("get_ai_rules", _CACHE_TTL["get_ai_rules"], lambda: _sync_get("/v1/ai/rules"), default={})


def get_ai_sensitivity(db) -> str:
    if not SECURITY_API_URL:
        from SECURITY.security_engine import get_ai_sensitivity as _local
        return _local(db)
    return _cached_fetch("get_ai_sensitivity", _CACHE_TTL["get_ai_sensitivity"], lambda: _sync_get("/v1/ai/sensitivity"), default="medium")


def update_ai_rules(db, rules, actor):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import update_ai_rules as _local
        return _local(db, rules, actor)
    return _sync_post("/v1/ai/rules", {"rules": rules, "actor": actor})


def add_ai_rule(db, rule_key, actor):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import add_ai_rule as _local
        return _local(db, rule_key, actor)
    return _sync_post("/v1/ai/rules/add", {"rule_key": rule_key, "actor": actor})


def available_ai_rule_templates(db):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import available_ai_rule_templates as _local
        return _local(db)
    return _sync_get("/v1/ai/rule-templates")


def retrain_ai(db, actor):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import retrain_ai as _local
        return _local(db, actor)
    return _sync_post("/v1/ai/retrain", {"actor": actor})


def set_ai_sensitivity(db, sensitivity: str, actor: str) -> str:
    if not SECURITY_API_URL:
        from SECURITY.security_engine import set_ai_sensitivity as _local
        return _local(db, sensitivity, actor)
    return _sync_post("/v1/ai/sensitivity", {"sensitivity": sensitivity, "actor": actor})


def weekly_ai_behavior_data(db):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import weekly_ai_behavior_data as _local
        return _local(db)
    return _sync_get("/v1/ai/weekly-data")


# ---------------------------------------------------------------------------
# Backup / recovery proxies
# ---------------------------------------------------------------------------
def create_manual_backup(db, admin_id, label: str = "manual"):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import create_manual_backup as _local
        return _local(db, admin_id, label=label)
    return _sync_post("/v1/backup/manual", {"admin_id": admin_id, "label": label})


def set_backup_location(db, path, delete_previous=False, actor=None):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import set_backup_location as _local
        return _local(db, path, delete_previous, actor)
    return _sync_post("/v1/backup/location", {"path": path, "delete_previous": delete_previous, "actor": actor})


def full_system_recovery(db, admin_id):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import full_system_recovery as _local
        return _local(db, admin_id)
    return _sync_post("/v1/recover/full", {"admin_id": admin_id}, timeout=30.0)


def create_database_backup(db, admin_id):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import create_database_backup as _local
        return _local(db, admin_id)
    return _sync_post("/v1/backup/database", {"admin_id": admin_id}, timeout=30.0)


def create_files_backup(db, admin_id):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import create_files_backup as _local
        return _local(db, admin_id)
    return _sync_post("/v1/backup/files", {"admin_id": admin_id}, timeout=30.0)


def create_ml_backup(db, admin_id):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import create_ml_backup as _local
        return _local(db, admin_id)
    return _sync_post("/v1/backup/ml", {"admin_id": admin_id}, timeout=30.0)


def create_full_system_backup(db, admin_id):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import create_full_system_backup as _local
        return _local(db, admin_id)
    return _sync_post("/v1/backup/full", {"admin_id": admin_id}, timeout=30.0)


def recover_database(db, admin_id):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import recover_database as _local
        return _local(db, admin_id)
    return _sync_post("/v1/recover/database", {"admin_id": admin_id})


def recover_files(db, admin_id):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import recover_files as _local
        return _local(db, admin_id)
    return _sync_post("/v1/recover/files", {"admin_id": admin_id})


def recover_ml_artifacts(db, admin_id):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import recover_ml_artifacts as _local
        return _local(db, admin_id)
    return _sync_post("/v1/recover/ml", {"admin_id": admin_id})


def recover_full_system(db, admin_id):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import recover_full_system as _local
        return _local(db, admin_id)
    return _sync_post("/v1/recover/full", {"admin_id": admin_id})


def manual_recover_file(db, file_id, admin_id):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import manual_recover_file as _local
        return _local(db, file_id, admin_id)
    return _sync_post("/v1/files/recover", {"file_id": file_id, "admin_id": admin_id})


# ---------------------------------------------------------------------------
# Folder management proxies
# ---------------------------------------------------------------------------
def add_monitored_folder(db, path, initiated_by=None, vm_target=None):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import add_monitored_folder as _local
        return _local(db, path, initiated_by=initiated_by, vm_target=vm_target)
    return _sync_post("/v1/folders", {"path": path, "initiated_by": initiated_by, "vm_target": vm_target}, timeout=30.0)


def remove_monitored_folder(db, path, initiated_by=None, vm_target=None):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import remove_monitored_folder as _local
        return _local(db, path, initiated_by=initiated_by, vm_target=vm_target)
    try:
        return _sync_post("/v1/folders/remove", {"path": path, "initiated_by": initiated_by, "vm_target": vm_target}, timeout=30.0)
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            # Security API endpoint may be missing on older deployments; fall back to local
            from SECURITY.security_engine import remove_monitored_folder as _local
            return _local(db, path, initiated_by=initiated_by, vm_target=vm_target)
        raise


# ---------------------------------------------------------------------------
# Incident proxies
# ---------------------------------------------------------------------------
def resolve_incident(db, incident_id, admin_id, confirm_missing_files=False):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import resolve_incident as _local
        return _local(db, incident_id, admin_id, confirm_missing_files=confirm_missing_files)
    return _sync_post("/v1/incidents/resolve", {
        "incident_id": incident_id, "admin_id": admin_id, "confirm_missing_files": confirm_missing_files,
    })


def mark_false_positive(db, incident_id, admin_id, confirm_missing_files=False):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import mark_false_positive as _local
        return _local(db, incident_id, admin_id, confirm_missing_files=confirm_missing_files)
    return _sync_post("/v1/incidents/false-positive", {
        "incident_id": incident_id, "admin_id": admin_id, "confirm_missing_files": confirm_missing_files,
    })


def bulk_update_incidents(db, action, admin_id, confirm_missing_files=False):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import bulk_update_incidents as _local
        return _local(db, action, admin_id, confirm_missing_files=confirm_missing_files)
    return _sync_post("/v1/incidents/bulk-action", {
        "action": action, "admin_id": admin_id, "confirm_missing_files": confirm_missing_files,
    })


# ---------------------------------------------------------------------------
# Setting / state proxies
# ---------------------------------------------------------------------------
def get_setting(db, key, default=None):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import get_setting as _local
        return _local(db, key, default=default)
    def _fetch():
        return _sync_post("/v1/settings/get", {"key": key, "default": default})
    return _cached_fetch(f"get_setting:{key}", _CACHE_TTL["get_setting"], _fetch, default=default)


def set_setting(db, key, value, actor=None):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import set_setting as _local
        return _local(db, key, value, actor)
    return _sync_post("/v1/settings/set", {"key": key, "value": value, "actor": actor})


# ---------------------------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------------------------
def serialize_detection(item) -> dict:
    if not SECURITY_API_URL:
        from SECURITY.security_engine import serialize_detection as _local
        return _local(item)
    return item if isinstance(item, dict) else {"id": getattr(item, "id", None)}


def serialize_incident(item) -> dict:
    if not SECURITY_API_URL:
        from SECURITY.security_engine import serialize_incident as _local
        return _local(item)
    return item if isinstance(item, dict) else {"id": getattr(item, "id", None)}


def serialize_recovery(item) -> dict:
    if not SECURITY_API_URL:
        from SECURITY.security_engine import serialize_recovery as _local
        return _local(item)
    return item if isinstance(item, dict) else {"id": getattr(item, "id", None)}


def serialize_file(item) -> dict:
    if not SECURITY_API_URL:
        from SECURITY.security_engine import serialize_file as _local
        return _local(item)
    return item if isinstance(item, dict) else {"id": getattr(item, "id", None)}


# ---------------------------------------------------------------------------
# Utility proxies
# ---------------------------------------------------------------------------
def now_utc():
    if not SECURITY_API_URL:
        from SECURITY.security_engine import now_utc as _local
        return _local()
    from datetime import datetime, timezone
    return datetime.now(timezone.utc)


def json_dumps(obj):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import json_dumps as _local
        return _local(obj)
    import json
    return json.dumps(obj, default=str)


def next_weekday(day_name: str, time_value: str):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import next_weekday as _local
        return _local(day_name, time_value)
    import calendar
    from datetime import datetime, timedelta
    target_day = list(calendar.day_name).index(day_name)
    hour, minute = [int(part) for part in time_value.split(":", 1)]
    now = datetime.now()
    base = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    days_ahead = (target_day - base.weekday()) % 7
    candidate = base + timedelta(days=days_ahead)
    if candidate <= now:
        candidate += timedelta(days=7)
    return candidate.isoformat()


# ---------------------------------------------------------------------------
# File registration / migration helpers
# ---------------------------------------------------------------------------
def register_initial_files(db):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import register_initial_files as _local
        return _local(db)
    return _sync_post("/v1/files/register", {})


def current_hash_index(db):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import current_hash_index as _local
        return _local(db)
    return _cached_fetch("current_hash_index", _CACHE_TTL["current_hash_index"], lambda: _sync_get("/v1/files/hash-index"), default={})


def is_database_entry(file_entry) -> bool:
    if not SECURITY_API_URL:
        from SECURITY.security_engine import is_database_entry as _local
        return _local(file_entry)
    rp = getattr(file_entry, "relative_path", "")
    return "database" in str(rp).lower() or "snapshot" in str(rp).lower()


def normalize_database_monitor_entry(db, reset_baseline=False, ensure_snapshot=True):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import normalize_database_monitor_entry as _local
        return _local(db, reset_baseline=reset_baseline, ensure_snapshot=ensure_snapshot)
    return _sync_post("/v1/files/db-entry", {"reset_baseline": reset_baseline, "ensure_snapshot": ensure_snapshot})


def portable_monitored_path(file_entry):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import portable_monitored_path as _local
        return _local(file_entry)
    rp = getattr(file_entry, "relative_path", "")
    from pathlib import Path
    return Path(rp)


def replacement_path_for(file_entry, hash_index):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import replacement_path_for as _local
        return _local(file_entry, hash_index)
    return _sync_post("/v1/files/replacement", {
        "file_id": getattr(file_entry, "id", None),
        "relative_path": getattr(file_entry, "relative_path", None),
        "hash_index": hash_index,
    })


def mark_verified_removal(db, file_entry, status, replacement_path=None, actor=None):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import mark_verified_removal as _local
        return _local(db, file_entry, status, replacement_path=replacement_path, actor=actor)
    return _sync_post("/v1/files/verified-removal", {
        "file_id": getattr(file_entry, "id", None),
        "status": status,
        "replacement_path": str(replacement_path) if replacement_path else None,
        "actor": actor,
    })


def migrate_portable_monitored_files(db):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import migrate_portable_monitored_files as _local
        return _local(db)
    return _sync_post("/v1/files/migrate", {})


def mark_stale_backup_events_failed(db):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import mark_stale_backup_events_failed as _local
        return _local(db)
    return _sync_post("/v1/backups/mark-stale", {})


def mark_admin_change(db, file_path, admin_id):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import mark_admin_change as _local
        return _local(db, file_path, admin_id)
    return _sync_post("/v1/files/admin-change", {"file_path": file_path, "admin_id": admin_id})


def record_context_detection(db, target_name, actor, change_type, context=None):
    if not SECURITY_API_URL:
        from SECURITY.security_engine import record_context_detection as _local
        return _local(db, target_name, actor, change_type, context=context)
    return _sync_post("/v1/detections/context", {
        "target_name": target_name,
        "actor": actor,
        "change_type": change_type,
        "context": context or {},
    })


def fetch_system_alerts(db, limit: int = 50) -> list[dict]:
    if not SECURITY_API_URL:
        from database.models import Alert
        try:
            alerts = (
                db.query(Alert)
                .order_by(Alert.created_at.desc())
                .limit(limit)
                .all()
            )
        except Exception:
            return []
        return [
            {
                "id": alert.id,
                "type": alert.type,
                "title": alert.title,
                "message": alert.message,
                "severity": alert.severity,
                "read": alert.read,
                "created_at": alert.created_at.isoformat() if alert.created_at else None,
            }
            for alert in alerts
        ]
    try:
        r = _session.get(
            f"{SECURITY_API_URL}/v1/system-alerts",
            headers=_headers(),
            params={"limit": limit},
            timeout=3.0,
            verify=False,
        )
        r.raise_for_status()
        return r.json().get("alerts", [])
    except Exception:
        return []


def sync_security_alerts(db, limit: int = 50) -> int:
    """Fetch system alerts from VM2 and persist them into the VM1 DB."""
    from database.models import Alert
    try:
        security_alerts = fetch_system_alerts(db, limit=limit)
    except Exception:
        return 0
    if not security_alerts:
        return 0
    existing = {
        (a.type, a.title, a.message)
        for a in db.query(Alert).all()
    }
    added = 0
    for sa in security_alerts:
        key = (sa.get("type"), sa.get("title"), sa.get("message"))
        if key not in existing:
            db.add(
                Alert(
                    type=sa.get("type", "security"),
                    title=sa.get("title", "Security Alert"),
                    message=sa.get("message", ""),
                    severity=sa.get("severity", "low"),
                    read=False,
                    created_at=datetime.fromisoformat(sa["created_at"]) if sa.get("created_at") else datetime.utcnow(),
                )
            )
            added += 1
            existing.add(key)
    if added:
        db.commit()
    return added


class MissingFileConfirmationRequired(Exception):
    def __init__(self, details):
        self.details = details
        super().__init__(details)
