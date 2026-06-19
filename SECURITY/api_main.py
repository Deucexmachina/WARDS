# WARDS Security Microservice
# This FastAPI app runs on VM 2 (Security Server) and exposes the security engine
# via authenticated REST endpoints consumed by the App VM adapter.
from __future__ import annotations

import os
import sys
from pathlib import Path

# Resolve repo root (two levels up from SECURITY/)
MASTER_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(MASTER_ROOT))
sys.path.insert(0, str(MASTER_ROOT / "WARDS" / "backend"))

from fastapi import FastAPI, HTTPException, Header, Depends
from pydantic import BaseModel
from sqlalchemy import inspect
from typing import Any

from database.models import SessionLocal, engine, Admin, Base
from SECURITY.security_engine import (
    dashboard_payload,
    scan_single_file,
    scan_all_files,
    query_detections,
    query_recoveries,
    get_ai_rules,
    get_ai_sensitivity,
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

app = FastAPI(title="WARDS Security API", version="1.0.0")
Base.metadata.create_all(bind=engine)


def require_api_key(x_api_key: str = Header(..., alias="X-API-Key")):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


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
def api_scan_all(payload: dict = {}, db=Depends(get_db)):
    # scan_all_files expects a list of file entries; we scan all active monitored files
    register_initial_files(db)
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
        payload["target_name"],
        payload["actor"],
        payload["change_type"],
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


# ---------------------------------------------------------------------------
# Backup & Recovery
# ---------------------------------------------------------------------------
@app.post("/v1/backup/manual", dependencies=[Depends(require_api_key)])
def api_backup_manual(payload: dict = {}, db=Depends(get_db)):
    event = create_manual_backup(db, _resolve_admin_id(db, payload.get("admin_id")))
    return serialize_recovery(event)


@app.post("/v1/backup/location", dependencies=[Depends(require_api_key)])
def api_backup_location(payload: dict = {}, db=Depends(get_db)):
    return set_backup_location(
        db,
        payload.get("path"),
        payload.get("delete_previous", False),
        payload.get("actor"),
    )


@app.post("/v1/recover/full", dependencies=[Depends(require_api_key)])
def api_recover_full(payload: dict = {}, db=Depends(get_db)):
    return full_system_recovery(db, _resolve_admin_id(db, payload.get("admin_id")))


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
    return add_monitored_folder(db, payload["path"], initiated_by=payload.get("initiated_by"))


@app.post("/v1/folders/remove", dependencies=[Depends(require_api_key)])
def api_remove_folder(payload: dict = {}, db=Depends(get_db)):
    return remove_monitored_folder(db, payload["path"], initiated_by=payload.get("initiated_by"))


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
    return mark_admin_change(db, payload["file_path"], payload["admin_id"])


@app.post("/v1/backups/mark-stale", dependencies=[Depends(require_api_key)])
def api_mark_stale(db=Depends(get_db)):
    return mark_stale_backup_events_failed(db)


# ---------------------------------------------------------------------------
# Internal deploy trigger (called by VM1 webhook deployer)
# ---------------------------------------------------------------------------
@app.post("/internal/deploy", dependencies=[Depends(require_api_key)])
def api_internal_deploy():
    import subprocess
    import threading

    def _deploy():
        app_dir = os.getenv("VM2_APP_DIR", "/opt/wards/security/app")
        logger = logging.getLogger(__name__)
        if not os.path.isdir(os.path.join(app_dir, ".git")):
            logger.warning("Repo not accessible in container at %s — skipping auto-deploy", app_dir)
            return
        subprocess.run(["git", "fetch", "origin", "main"], cwd=app_dir, capture_output=True)
        subprocess.run(["git", "reset", "--hard", "origin/main"], cwd=app_dir, capture_output=True)
        try:
            subprocess.run(
                ["docker", "compose", "-f", "docker-compose.security.yml", "up", "-d", "--build"],
                cwd=app_dir, capture_output=True, check=False,
            )
        except FileNotFoundError:
            logger.warning("docker CLI not available inside container — run 'docker compose up -d --build' on the host")

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
