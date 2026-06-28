# WARDS Security Microservice
# This FastAPI app runs on VM 2 (Security Server) and exposes the security engine
# via authenticated REST endpoints consumed by the App VM adapter.
from __future__ import annotations

import logging
import os
import sys
import threading

logger = logging.getLogger(__name__)
import time
from pathlib import Path

# Resolve repo root (two levels up from SECURITY/)
MASTER_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(MASTER_ROOT))
sys.path.insert(0, str(MASTER_ROOT / "WARDS" / "backend"))

from fastapi import FastAPI, HTTPException, Header, Depends, BackgroundTasks, Request
from starlette.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import inspect
from typing import Any

from database.models import SessionLocal, engine, Admin, Base, Alert
from SECURITY.security_engine import (
    dashboard_payload,
    scan_single_file,
    scan_all_files,
    query_detections,
    query_recoveries,
    get_ai_rules,
    get_ai_sensitivity,
    set_ai_sensitivity,
    update_ai_rules,
    add_ai_rule,
    available_ai_rule_templates,
    retrain_ai,
    weekly_ai_behavior_data,
    create_manual_backup,
    create_database_backup,
    create_files_backup,
    create_ml_backup,
    create_full_system_backup,
    set_backup_location,
    full_system_recovery,
    recover_database,
    recover_files,
    recover_ml_artifacts,
    recover_full_system,
    manual_recover_file,
    add_monitored_folder,
    remove_monitored_folder,
    resolve_incident,
    mark_false_positive,
    bulk_update_incidents,
    get_setting,
    set_setting,
    serialize_detection,
    serialize_file,
    serialize_incident,
    serialize_recovery,
    active_monitored_files_query,
    register_initial_files,
    mark_stale_backup_events_failed,
    current_hash_index,
    is_database_entry,
    normalize_database_monitor_entry,
    portable_monitored_path,
    replacement_path_for,
    mark_verified_removal,
    migrate_portable_monitored_files,
    mark_admin_change,
    now_utc,
    json_dumps,
    activate_database_runtime_monitoring,
    seed_settings,
    drop_database_audit_triggers,
    MissingFileConfirmationRequired,
)
from SECURITY.security_models import (
    SecurityMonitoredFile,
    SecurityIncident,
    SecurityDetectionEvent,
    SecurityRecoveryEvent,
)

API_KEY = os.getenv("APP_API_KEY", "")
if not API_KEY or API_KEY in ("change-me", ""):
    import warnings
    warnings.warn("APP_API_KEY is not set or is using a default value. Set a strong key before production use.")

ADMIN_SECRET = os.getenv("SECURITY_ADMIN_SECRET", "")
if not ADMIN_SECRET:
    import warnings
    warnings.warn("SECURITY_ADMIN_SECRET is not set. Destructive endpoints rely on APP_API_KEY only.")

# Simple in-memory rate limiter for VM2 API endpoints
_rate_limit_store: dict[str, dict] = {}


def _rate_limit_key(endpoint: str, request) -> str:
    client_ip = request.client.host if request.client else "unknown"
    return f"{endpoint}:{client_ip}"


def rate_limit(endpoint_name: str, max_requests: int = 5, window_seconds: float = 60.0):
    """Decorator to rate-limit an endpoint by client IP."""
    def decorator(func):
        from functools import wraps
        @wraps(func)
        def wrapper(*args, **kwargs):
            request = None
            for arg in args:
                if hasattr(arg, "client"):
                    request = arg
                    break
            if request is None:
                for v in kwargs.values():
                    if hasattr(v, "client"):
                        request = v
                        break
            if request:
                key = _rate_limit_key(endpoint_name, request)
                now = time.time()
                bucket = _rate_limit_store.setdefault(key, {"count": 0, "reset_at": now + window_seconds})
                if now > bucket["reset_at"]:
                    bucket["count"] = 0
                    bucket["reset_at"] = now + window_seconds
                bucket["count"] += 1
                if bucket["count"] > max_requests:
                    raise HTTPException(status_code=429, detail="Rate limit exceeded. Try again later.")
            return func(*args, **kwargs)
        return wrapper
    return decorator


app = FastAPI(title="WARDS Security API", version="1.0.0")
Base.metadata.create_all(bind=engine)


@app.exception_handler(MissingFileConfirmationRequired)
async def missing_file_confirmation_handler(request, exc):
    return JSONResponse(
        status_code=409,
        content={"detail": exc.details if hasattr(exc, "details") else str(exc)},
    )


def require_api_key(x_api_key: str = Header(..., alias="X-API-Key")):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


def require_admin_secret(x_admin_secret: str = Header(..., alias="X-Admin-Secret")):
    if ADMIN_SECRET and x_admin_secret != ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="Admin secret required")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@app.get("/")
def root():
    return {"status": "ok", "service": "wards-security-api"}


@app.get("/health")
def health():
    return {"status": "healthy"}


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------
@app.get("/v1/dashboard", dependencies=[Depends(require_api_key)])
def get_dashboard(db=Depends(get_db)):
    mark_stale_backup_events_failed(db)
    return dashboard_payload(db)


# ---------------------------------------------------------------------------
# Scanning
# ---------------------------------------------------------------------------
class ScanFileRequest(BaseModel):
    file_id: int | None = None
    relative_path: str | None = None
    context: dict = {}
    commit_clean: bool = True


@app.post("/v1/scan/file", dependencies=[Depends(require_api_key)])
def api_scan_file(payload: ScanFileRequest, db=Depends(get_db)):
    file_entry = None
    if payload.file_id:
        file_entry = db.query(SecurityMonitoredFile).filter(SecurityMonitoredFile.id == payload.file_id).first()
    if not file_entry and payload.relative_path:
        file_entry = db.query(SecurityMonitoredFile).filter(SecurityMonitoredFile.relative_path == payload.relative_path).first()
    if not file_entry:
        raise HTTPException(status_code=404, detail="Monitored file not found")
    detection = scan_single_file(db, file_entry, context=payload.context, commit_clean=payload.commit_clean)
    return {"detection": serialize_detection(detection) if detection else None}


@app.post("/v1/scan/all", dependencies=[Depends(require_api_key)])
@rate_limit("scan_all", max_requests=3, window_seconds=60)
def api_scan_all(payload: dict = {}, request: Request = None, db=Depends(get_db)):
    # scan_all_files expects a list of file entries; we scan all active monitored files
    register_initial_files(db, refresh_existing=False, incremental=False)
    from SECURITY.security_engine import active_monitored_files_query
    files = active_monitored_files_query(db).all()
    detections = []
    for file_entry in files:
        detection = scan_single_file(db, file_entry, context=payload.get("context", {}), commit_clean=False)
        if detection:
            detections.append(detection)
    db.commit()
    return {"detections": [serialize_detection(d) for d in detections]}


# ---------------------------------------------------------------------------
# Detections & Recoveries
# ---------------------------------------------------------------------------
@app.post("/v1/detections/context", dependencies=[Depends(require_api_key)])
def api_detections_context(payload: dict = {}, db=Depends(get_db)):
    from SECURITY.security_engine import record_context_detection
    return record_context_detection(
        db,
        target_name=payload["target_name"],
        actor=payload["actor"],
        change_type=payload["change_type"],
        context=payload.get("context", {}),
    )


@app.post("/v1/detections/query", dependencies=[Depends(require_api_key)])
def api_detections_query(payload: dict = {}, db=Depends(get_db)):
    rows = query_detections(
        db,
        keyword=payload.get("keyword"),
        date_from=payload.get("date_from"),
        date_to=payload.get("date_to"),
        target=payload.get("target"),
        severity=payload.get("severity"),
        limit=payload.get("limit", 200),
        sort=payload.get("sort", "newest"),
        classification=payload.get("classification"),
    )
    return [serialize_detection(r) for r in rows]


@app.post("/v1/recoveries/query", dependencies=[Depends(require_api_key)])
def api_recoveries_query(payload: dict = {}, db=Depends(get_db)):
    rows = query_recoveries(
        db,
        keyword=payload.get("keyword"),
        date_from=payload.get("date_from"),
        date_to=payload.get("date_to"),
        recovery_type=payload.get("recovery_type"),
        status=payload.get("status"),
        limit=payload.get("limit", 200),
        sort=payload.get("sort", "newest"),
    )
    return [serialize_recovery(r) for r in rows]


# ---------------------------------------------------------------------------
# AI Rules
# ---------------------------------------------------------------------------
@app.get("/v1/ai/rules", dependencies=[Depends(require_api_key)])
def api_ai_rules(db=Depends(get_db)):
    return get_ai_rules(db)


@app.post("/v1/ai/rules", dependencies=[Depends(require_api_key)])
def api_ai_rules_update(payload: dict = {}, db=Depends(get_db)):
    return update_ai_rules(db, payload.get("rules", []), payload.get("actor", "api"))


@app.post("/v1/ai/rules/add", dependencies=[Depends(require_api_key)])
def api_ai_rule_add(payload: dict = {}, db=Depends(get_db)):
    return add_ai_rule(db, payload.get("rule_key"), payload.get("actor", "api"))


@app.get("/v1/ai/sensitivity", dependencies=[Depends(require_api_key)])
def api_ai_sensitivity(db=Depends(get_db)):
    return {"sensitivity": get_ai_sensitivity(db)}


@app.post("/v1/ai/sensitivity", dependencies=[Depends(require_api_key)])
def api_ai_sensitivity_set(payload: dict = {}, db=Depends(get_db)):
    return {"sensitivity": set_ai_sensitivity(db, payload.get("sensitivity", "medium"), payload.get("actor", "api"))}


@app.get("/v1/ai/rule-templates", dependencies=[Depends(require_api_key)])
def api_ai_templates(db=Depends(get_db)):
    return available_ai_rule_templates(db)


@app.post("/v1/ai/retrain", dependencies=[Depends(require_api_key)])
def api_ai_retrain(payload: dict = {}, db=Depends(get_db)):
    return retrain_ai(db, payload.get("actor", "api"))


@app.get("/v1/ai/weekly-data", dependencies=[Depends(require_api_key)])
def api_ai_weekly(db=Depends(get_db)):
    return weekly_ai_behavior_data(db)


def _resolve_admin_id(db, admin_id):
    """Validate admin_id exists in local VM2 admins table; return None if foreign."""
    if admin_id is None:
        return None
    if "admins" not in inspect(db.bind).get_table_names():
        return None
    try:
        return db.query(Admin.id).filter(Admin.id == admin_id).scalar()
    except Exception:
        return None


def start_security_monitor_if_enabled():
    enabled = (os.getenv("SECURITY_MONITORING_ENABLED") or "false").strip().lower() == "true"
    deployed = (os.getenv("SECURITY_DEPLOYMENT_MODE") or "development").strip().lower() == "deployed"
    if not deployed or not enabled:
        print("[SECURITY MONITOR] automatic monitoring disabled; deployed mode and monitoring flag must both be enabled")
        return

    default_interval = max(5, int(os.getenv("SECURITY_SCAN_INTERVAL_SECONDS", "30")))
    adaptive_enabled = (os.getenv("SECURITY_ADAPTIVE_INTERVAL_ENABLED") or "false").strip().lower() == "true"

    def monitor_loop():
        from SECURITY.security_engine import (
            activate_database_runtime_monitoring,
            get_setting,
            now_utc,
            scan_all_files,
            seed_settings,
            set_deployment_mode,
            set_setting,
        )

        while True:
            retry_delay = False
            startup_db = SessionLocal()
            try:
                seed_settings(startup_db)
                set_setting(startup_db, "startup_baseline_status", "in_progress", "system")
                print("[SECURITY MONITOR] activating database runtime monitoring")
                activate_database_runtime_monitoring(startup_db, reset_baseline=True)
                print("[SECURITY MONITOR] refreshing startup baseline backup after runtime activation")
                event = create_manual_backup(startup_db, initiated_by=None, label="startup_baseline")
                if event.status != "success":
                    raise RuntimeError(event.error_message or "Startup baseline backup failed")
                set_setting(startup_db, "monitoring_enabled", "true", "system_startup")
                set_setting(startup_db, "startup_baseline_status", "complete", "system")
                # Note: do NOT clear deployment_in_progress here.
                # The VM1 webhook's finally block handles unpause after deploy.
                # Clearing it here would cause false detections during deployment.
                print("[SECURITY MONITOR] startup baseline backup refreshed")
                break
            except Exception as exc:
                try:
                    set_setting(startup_db, "startup_baseline_status", "failed", "system")
                except Exception:
                    pass
                print(f"[SECURITY MONITOR] startup baseline refresh failed: {exc}")
                retry_delay = True
            finally:
                startup_db.close()
            if retry_delay:
                time.sleep(default_interval)
            else:
                break

        first_scan = True
        consecutive_clean = 0
        last_vm1_check = 0
        vm1_check_interval = max(15, int(os.getenv("VM1_HEARTBEAT_CHECK_INTERVAL", "30")))

        while True:
            db = SessionLocal()
            interval = default_interval
            try:
                monitoring_enabled = (get_setting(db, "monitoring_enabled", "true") or "true").lower() == "true"
                configured_interval = max(5, int(get_setting(db, "scan_interval_seconds", str(default_interval))))
                if monitoring_enabled:
                    detections = scan_all_files(db, context={"background_monitor": True})
                    set_setting(db, "last_scan_at", now_utc().isoformat(), "interval_scanner")
                    set_setting(db, "last_interval_scan_status", "success", "interval_scanner")
                    if first_scan:
                        print(f"[SECURITY MONITOR] first automatic scan complete; {len(detections)} change(s) found")
                    if adaptive_enabled:
                        if detections:
                            consecutive_clean = 0
                            interval = min(30, configured_interval)
                        else:
                            consecutive_clean += 1
                            if consecutive_clean >= 5:
                                interval = min(configured_interval * (2 ** min(consecutive_clean - 4, 4)), 300)
                            else:
                                interval = configured_interval
                    else:
                        interval = configured_interval
                else:
                    interval = configured_interval
                    set_setting(db, "last_interval_scan_status", "monitoring_disabled", "interval_scanner")
                first_scan = False
            except Exception as exc:
                print(f"[SECURITY MONITOR] scan failed: {exc}")
                try:
                    set_setting(db, "last_interval_scan_status", f"failed: {exc}", "interval_scanner")
                except Exception:
                    pass
            finally:
                db.close()

            # VM1 heartbeat timeout check
            if time.time() - last_vm1_check >= vm1_check_interval:
                vm1_db = SessionLocal()
                try:
                    from SECURITY.security_engine import check_vm1_heartbeat_timeout
                    detection = check_vm1_heartbeat_timeout(vm1_db)
                    if detection:
                        print(f"[SECURITY MONITOR] VM1 heartbeat timeout detected; detection #{detection.id}")
                except Exception as exc:
                    print(f"[SECURITY MONITOR] VM1 heartbeat check failed: {exc}")
                finally:
                    vm1_db.close()
                last_vm1_check = time.time()

            time.sleep(max(5, int(interval)))

    thread = threading.Thread(target=monitor_loop, daemon=True, name="wards-security-monitor")
    thread.start()
    print(f"[SECURITY MONITOR] ready; default scan interval is {default_interval} seconds")


@app.on_event("startup")
def on_startup():
    start_security_monitor_if_enabled()


@app.on_event("shutdown")
def on_shutdown():
    enabled = (os.getenv("SECURITY_MONITORING_ENABLED") or "false").strip().lower() == "true"
    deployed = (os.getenv("SECURITY_DEPLOYMENT_MODE") or "development").strip().lower() == "deployed"
    if not deployed or not enabled:
        return
    try:
        db = SessionLocal()
        try:
            drop_database_audit_triggers(db)
            set_setting(db, "database_runtime_monitoring", "stopped", "system_shutdown")
            print("[SECURITY MONITOR] database audit triggers stopped")
        finally:
            db.close()
    except Exception as exc:
        print(f"[SECURITY MONITOR] database audit trigger shutdown skipped: {exc}")


# ---------------------------------------------------------------------------
# VM1 Remote Reporter Endpoints
# ---------------------------------------------------------------------------
@app.post("/v1/vm1/files/register", dependencies=[Depends(require_api_key)])
def api_vm1_files_register(payload: dict = {}, db=Depends(get_db)):
    from SECURITY.security_engine import process_vm1_file_manifest
    return process_vm1_file_manifest(db, payload.get("files", []))


@app.post("/v1/vm1/heartbeat", dependencies=[Depends(require_api_key)])
def api_vm1_heartbeat(payload: dict = {}, db=Depends(get_db)):
    from SECURITY.security_engine import set_setting, now_utc
    set_setting(db, "vm1_last_heartbeat_at", now_utc().isoformat(), "vm1_reporter")
    set_setting(db, "vm1_last_heartbeat_status", "success", "vm1_reporter")
    return {"status": "ok"}


@app.get("/v1/vm1/restore-command", dependencies=[Depends(require_api_key)])
def api_vm1_restore_command(db=Depends(get_db)):
    from SECURITY.security_engine import get_pending_vm1_restore_commands
    return {"commands": get_pending_vm1_restore_commands(db)}


@app.post("/v1/vm1/restore-ack", dependencies=[Depends(require_api_key)])
def api_vm1_restore_ack(payload: dict = {}, db=Depends(get_db)):
    from SECURITY.security_engine import acknowledge_vm1_restore_command
    success = acknowledge_vm1_restore_command(db, payload.get("command_id"), payload.get("success", False))
    return {"status": "ok" if success else "error"}


@app.get("/v1/vm1/config", dependencies=[Depends(require_api_key)])
def api_vm1_config(db=Depends(get_db)):
    from SECURITY.security_engine import get_setting, load_vm1_monitored_folders, is_deployment_in_progress
    interval = max(5, int(get_setting(db, "scan_interval_seconds", "30")))
    custom_folders = [str(p) for p in load_vm1_monitored_folders(db)]
    return {
        "scan_interval_seconds": interval,
        "vm1_custom_folders": custom_folders,
        "monitoring_enabled": (get_setting(db, "monitoring_enabled", "true") or "true").lower() == "true",
        "deployment_paused": is_deployment_in_progress(db),
    }


# ---------------------------------------------------------------------------
# Backup & Recovery
# ---------------------------------------------------------------------------
@app.post("/v1/backup/manual", dependencies=[Depends(require_api_key)])
@rate_limit("backup_manual", max_requests=3, window_seconds=60)
def api_backup_manual(payload: dict = {}, request: Request = None, db=Depends(get_db)):
    event = create_manual_backup(db, _resolve_admin_id(db, payload.get("admin_id")), label=payload.get("label", "manual"))
    return serialize_recovery(event)


@app.post("/v1/backup/location", dependencies=[Depends(require_api_key), Depends(require_admin_secret)])
@rate_limit("backup_location", max_requests=5, window_seconds=60)
def api_backup_location(payload: dict = {}, db=Depends(get_db)):
    return set_backup_location(
        db,
        payload.get("path"),
        payload.get("delete_previous", False),
        payload.get("actor"),
    )


@app.post("/v1/recover/full", dependencies=[Depends(require_api_key)])
@rate_limit("recover_full", max_requests=2, window_seconds=300)
def api_recover_full(payload: dict = {}, background_tasks: BackgroundTasks = None, request: Request = None, db=Depends(get_db)):
    admin_id = _resolve_admin_id(db, payload.get("admin_id"))

    def _run_recovery():
        db2 = SessionLocal()
        try:
            full_system_recovery(db2, admin_id)
        finally:
            db2.close()

    if background_tasks:
        background_tasks.add_task(_run_recovery)
    else:
        # Fallback for test environments without background-task support
        threading.Thread(target=_run_recovery, daemon=True).start()

    return {"status": "processing", "message": "Full system recovery started in the background. Check recovery logs for results."}


@app.post("/v1/backup/database", dependencies=[Depends(require_api_key)])
def api_backup_database(payload: dict = {}, db=Depends(get_db)):
    event = create_database_backup(db, _resolve_admin_id(db, payload.get("admin_id")))
    return serialize_recovery(event)


@app.post("/v1/backup/files", dependencies=[Depends(require_api_key)])
def api_backup_files(payload: dict = {}, db=Depends(get_db)):
    event = create_files_backup(db, _resolve_admin_id(db, payload.get("admin_id")))
    return serialize_recovery(event)


@app.post("/v1/backup/ml", dependencies=[Depends(require_api_key)])
def api_backup_ml(payload: dict = {}, db=Depends(get_db)):
    event = create_ml_backup(db, _resolve_admin_id(db, payload.get("admin_id")))
    return serialize_recovery(event)


@app.post("/v1/backup/full", dependencies=[Depends(require_api_key)])
def api_backup_full(payload: dict = {}, db=Depends(get_db)):
    event = create_full_system_backup(db, _resolve_admin_id(db, payload.get("admin_id")))
    return serialize_recovery(event)


@app.post("/v1/recover/database", dependencies=[Depends(require_api_key)])
def api_recover_database(payload: dict = {}, db=Depends(get_db)):
    return serialize_recovery(recover_database(db, _resolve_admin_id(db, payload.get("admin_id"))))


@app.post("/v1/recover/files", dependencies=[Depends(require_api_key)])
def api_recover_files(payload: dict = {}, db=Depends(get_db)):
    return recover_files(db, _resolve_admin_id(db, payload.get("admin_id")))


@app.post("/v1/recover/ml", dependencies=[Depends(require_api_key)])
def api_recover_ml(payload: dict = {}, db=Depends(get_db)):
    return serialize_recovery(recover_ml_artifacts(db, _resolve_admin_id(db, payload.get("admin_id"))))


@app.post("/v1/files/recover", dependencies=[Depends(require_api_key)])
def api_file_recover(payload: dict = {}, db=Depends(get_db)):
    event = manual_recover_file(db, payload["file_id"], _resolve_admin_id(db, payload.get("admin_id")))
    return serialize_recovery(event)


# ---------------------------------------------------------------------------
# Folders
# ---------------------------------------------------------------------------
@app.post("/v1/folders", dependencies=[Depends(require_api_key)])
def api_add_folder(payload: dict = {}, db=Depends(get_db)):
    try:
        return add_monitored_folder(db, payload.get("path", ""), initiated_by=payload.get("initiated_by"), vm_target=payload.get("vm_target"))
    except ValueError as exc:
        detail = str(exc)
        if "already monitored" in detail.lower():
            raise HTTPException(status_code=409, detail=detail)
        raise HTTPException(status_code=400, detail=detail)
    except Exception as exc:
        logger.error("api_add_folder error: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to add monitored folder.")


@app.post("/v1/folders/remove", dependencies=[Depends(require_api_key)])
def api_remove_folder(payload: dict = {}, db=Depends(get_db)):
    try:
        return remove_monitored_folder(db, payload["path"], initiated_by=payload.get("initiated_by"), vm_target=payload.get("vm_target"))
    except ValueError as exc:
        detail = str(exc)
        if "not currently monitored" in detail.lower():
            raise HTTPException(status_code=404, detail=detail)
        raise HTTPException(status_code=400, detail=detail)
    except Exception as exc:
        logger.error("api_remove_folder error: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to remove monitored folder.")


# ---------------------------------------------------------------------------
# Incidents
# ---------------------------------------------------------------------------
@app.post("/v1/incidents/resolve", dependencies=[Depends(require_api_key)])
def api_incident_resolve(payload: dict = {}, db=Depends(get_db)):
    return serialize_incident(
        resolve_incident(
            db,
            payload["incident_id"],
            payload["admin_id"],
            confirm_missing_files=payload.get("confirm_missing_files", False),
        )
    )


@app.post("/v1/incidents/false-positive", dependencies=[Depends(require_api_key)])
def api_incident_false_positive(payload: dict = {}, db=Depends(get_db)):
    return serialize_incident(
        mark_false_positive(
            db,
            payload["incident_id"],
            payload["admin_id"],
            confirm_missing_files=payload.get("confirm_missing_files", False),
        )
    )


@app.post("/v1/incidents/bulk-action", dependencies=[Depends(require_api_key)])
def api_incident_bulk(payload: dict = {}, db=Depends(get_db)):
    return bulk_update_incidents(
        db,
        payload["action"],
        payload["admin_id"],
        confirm_missing_files=payload.get("confirm_missing_files", False),
    )


@app.post("/v1/incidents/query", dependencies=[Depends(require_api_key)])
def api_incidents_query(payload: dict = {}, db=Depends(get_db)):
    from datetime import datetime
    query = db.query(SecurityIncident)
    status = payload.get("status")
    severity = payload.get("severity")
    keyword = payload.get("keyword")
    date_from = payload.get("date_from")
    date_to = payload.get("date_to")
    sort = payload.get("sort", "newest")
    limit = payload.get("limit", 200)
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
    return [serialize_incident(item) for item in query.order_by(order).limit(limit).all()]


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
@app.post("/v1/settings/get", dependencies=[Depends(require_api_key)])
def api_settings_get(payload: dict = {}, db=Depends(get_db)):
    return get_setting(db, payload["key"], default=payload.get("default"))


@app.post("/v1/settings/set", dependencies=[Depends(require_api_key)])
def api_settings_set(payload: dict = {}, db=Depends(get_db)):
    return set_setting(db, payload["key"], payload["value"], updated_by=payload.get("actor"))


@app.get("/v1/source-ids/{log_type}", dependencies=[Depends(require_api_key)])
def api_source_ids(log_type: str, db=Depends(get_db)):
    if log_type == "detections":
        rows = db.query(SecurityDetectionEvent.id).filter(SecurityDetectionEvent.is_legitimate == False).all()
    elif log_type == "recoveries":
        rows = db.query(SecurityRecoveryEvent.id).filter(SecurityRecoveryEvent.recovery_type.notlike("%backup%")).all()
    elif log_type == "incidents":
        rows = db.query(SecurityIncident.id).filter(SecurityIncident.status.in_(["open", "investigating"])).all()
    elif log_type == "backups":
        rows = db.query(SecurityRecoveryEvent.id).filter(SecurityRecoveryEvent.recovery_type.like("%backup%")).all()
    else:
        raise HTTPException(status_code=400, detail="Invalid security log type.")
    return {"ids": [row[0] for row in rows]}


# ---------------------------------------------------------------------------
# File helpers
# ---------------------------------------------------------------------------
@app.get("/v1/files", dependencies=[Depends(require_api_key)])
def api_files_list(db=Depends(get_db)):
    return [serialize_file(item) for item in active_monitored_files_query(db).order_by(SecurityMonitoredFile.relative_path.asc()).all()]


@app.post("/v1/files/register", dependencies=[Depends(require_api_key)])
def api_files_register(db=Depends(get_db)):
    return {"registered": register_initial_files(db)}


@app.get("/v1/files/hash-index", dependencies=[Depends(require_api_key)])
def api_hash_index(db=Depends(get_db)):
    return current_hash_index(db)


@app.post("/v1/files/db-entry", dependencies=[Depends(require_api_key)])
def api_db_entry(payload: dict = {}, db=Depends(get_db)):
    return normalize_database_monitor_entry(
        db,
        reset_baseline=payload.get("reset_baseline", False),
        ensure_snapshot=payload.get("ensure_snapshot", True),
    )


@app.post("/v1/files/replacement", dependencies=[Depends(require_api_key)])
def api_replacement(payload: dict = {}, db=Depends(get_db)):
    from SECURITY.security_models import SecurityMonitoredFile
    file_entry = db.query(SecurityMonitoredFile).filter(SecurityMonitoredFile.id == payload.get("file_id")).first()
    if not file_entry:
        raise HTTPException(status_code=404, detail="File not found")
    return {"replacement": str(replacement_path_for(file_entry, payload.get("hash_index", {})))}


@app.post("/v1/files/verified-removal", dependencies=[Depends(require_api_key)])
def api_verified_removal(payload: dict = {}, db=Depends(get_db)):
    from SECURITY.security_models import SecurityMonitoredFile
    file_entry = db.query(SecurityMonitoredFile).filter(SecurityMonitoredFile.id == payload.get("file_id")).first()
    if not file_entry:
        raise HTTPException(status_code=404, detail="File not found")
    mark_verified_removal(
        db, file_entry, payload["status"],
        replacement_path=payload.get("replacement_path"),
        actor=payload.get("actor"),
    )
    db.commit()
    return {"status": "ok"}


@app.post("/v1/files/migrate", dependencies=[Depends(require_api_key)])
def api_files_migrate(db=Depends(get_db)):
    return migrate_portable_monitored_files(db)


@app.post("/v1/files/admin-change", dependencies=[Depends(require_api_key)])
def api_admin_change(payload: dict = {}, db=Depends(get_db)):
    return mark_admin_change(
        db,
        admin_id=payload.get("admin_id"),
        file_path=payload.get("file_path"),
        token_id=payload.get("token_id"),
        ip=payload.get("ip"),
        user_agent=payload.get("user_agent"),
    )


@app.post("/v1/backups/mark-stale", dependencies=[Depends(require_api_key)])
def api_mark_stale(db=Depends(get_db)):
    return mark_stale_backup_events_failed(db)


# ---------------------------------------------------------------------------
# Internal deployment mode toggle (called by VM1 webhook deployer)
# ---------------------------------------------------------------------------
@app.post("/internal/deployment-mode", dependencies=[Depends(require_api_key)])
def api_deployment_mode(payload: dict = {}, db: Session = Depends(get_db)):
    from SECURITY.security_engine import set_deployment_mode
    in_progress = payload.get("in_progress", False)
    set_deployment_mode(db, in_progress, updated_by="webhook")
    return {"deployment_in_progress": in_progress}


# ---------------------------------------------------------------------------
# Internal deploy trigger (called by VM1 webhook deployer)
# ---------------------------------------------------------------------------
@app.post("/internal/deploy", dependencies=[Depends(require_api_key), Depends(require_admin_secret)])
@rate_limit("internal_deploy", max_requests=2, window_seconds=300)
def api_internal_deploy(request: Request = None):
    import subprocess
    import threading
    import signal
    import os
    import time

    def _deploy():
        from database.models import SessionLocal
        from SECURITY.security_engine import set_deployment_mode, create_full_system_backup

        db = SessionLocal()
        set_deployment_mode(db, True)
        db.close()

        app_dir = os.getenv("VM2_APP_DIR", "/opt/wards/security/app")
        logger = logging.getLogger(__name__)
        if not os.path.isdir(os.path.join(app_dir, ".git")):
            logger.warning("Repo not accessible in container at %s — skipping auto-deploy", app_dir)
            return

        fetch = subprocess.run(["git", "fetch", "origin", "main"], cwd=app_dir, capture_output=True, text=True)
        if fetch.returncode != 0:
            logger.error("git fetch failed: %s", fetch.stderr)
            return

        reset = subprocess.run(["git", "reset", "--hard", "origin/main"], cwd=app_dir, capture_output=True, text=True)
        if reset.returncode != 0:
            logger.error("git reset failed: %s", reset.stderr)
            return

        head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=app_dir, capture_output=True, text=True)
        logger.info("VM2 repo updated to %s", head.stdout.strip() if head.returncode == 0 else "unknown")

        # Try docker compose first (requires docker CLI inside container)
        try:
            docker = subprocess.run(
                ["docker", "compose", "-f", "docker-compose.security.yml", "up", "-d", "--build"],
                cwd=app_dir, capture_output=True, text=True, check=False,
            )
            if docker.returncode == 0:
                logger.info("Docker compose restart succeeded")
                # Post-deploy backup is triggered by VM1 webhook after VM2 is back up.
                # Deployment mode is cleared by the VM1 webhook's finally block.
                return
            logger.warning("docker compose exited %d: %s", docker.returncode, docker.stderr)
        except FileNotFoundError:
            logger.info("docker CLI not available in container, falling back to self-restart")

        # Fallback: signal self to exit so Docker's restart: unless-stopped
        # brings up a new container with the updated code.
        logger.info("Scheduling container self-restart in 2s")
        time.sleep(2)
        os.kill(os.getpid(), signal.SIGTERM)

    threading.Thread(target=_deploy, daemon=True).start()
    return {"status": "deploy_triggered"}


@app.get("/internal/deploy-status", dependencies=[Depends(require_api_key)])
def api_internal_deploy_status():
    import subprocess
    app_dir = os.getenv("VM2_APP_DIR", "/opt/wards/security/app")
    commit = "unknown"
    try:
        if os.path.isdir(os.path.join(app_dir, ".git")):
            result = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                capture_output=True, text=True, cwd=app_dir,
            )
            if result.returncode == 0:
                commit = result.stdout.strip()
    except Exception:
        pass
    return {"vm": "vm2", "commit": commit, "deploy_dir": app_dir}


@app.post("/v1/admin/clear-all-logs", dependencies=[Depends(require_api_key), Depends(require_admin_secret)])
@rate_limit("clear_logs", max_requests=2, window_seconds=300)
def api_clear_all_logs(request: Request = None, db=Depends(get_db)):
    """Admin-only: wipe every detection, recovery, and incident row."""
    from sqlalchemy import text
    db.execute(text("SET FOREIGN_KEY_CHECKS = 0"))
    deleted_recoveries = db.execute(text("DELETE FROM security_recovery_events")).rowcount
    deleted_incidents = db.execute(text("DELETE FROM security_incidents")).rowcount
    deleted_detections = db.execute(text("DELETE FROM security_detection_events")).rowcount
    db.execute(text("SET FOREIGN_KEY_CHECKS = 1"))
    db.commit()
    return {
        "status": "cleared",
        "incidents_deleted": deleted_incidents,
        "detections_deleted": deleted_detections,
        "recoveries_deleted": deleted_recoveries,
    }


@app.get("/v1/system-alerts", dependencies=[Depends(require_api_key)])
def api_system_alerts(limit: int = 50, db=Depends(get_db)):
    """Return recent system alerts stored in the security DB."""
    try:
        alerts = (
            db.query(Alert)
            .order_by(Alert.created_at.desc())
            .limit(limit)
            .all()
        )
    except Exception:
        return {"alerts": []}
    return {
        "alerts": [
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
    }
