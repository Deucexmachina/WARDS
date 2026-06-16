from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

MASTER_ROOT = Path(__file__).resolve().parents[3]
if str(MASTER_ROOT) not in sys.path:
    sys.path.insert(0, str(MASTER_ROOT))

from database.models import get_db, SessionLocal, ActivityLog, PermanentIpBlock, SecurityLogView
from auth import get_current_admin_from_token
from utils.background_jobs import job_manager, JobStatus
from middleware.dos_protection import get_blocked_ips, unblock_ip, block_ip, account_rate_limit_state, record_rate_limit_detection
from services.ip_reputation import get_permanent_blocks, add_permanent_block, remove_permanent_block, check_ip_reputation
from SECURITY.security_engine import (
    active_monitored_files_query,
    add_monitored_folder,
    add_ai_rule,
    available_ai_rule_templates,
    bulk_update_incidents,
    create_manual_backup,
    current_hash_index,
    dashboard_payload,
    full_system_recovery,
    get_setting,
    get_ai_rules,
    get_ai_sensitivity,
    is_database_entry,
    manual_recover_file,
    mark_stale_backup_events_failed,
    mark_admin_change,
    mark_false_positive,
    mark_verified_removal,
    migrate_portable_monitored_files,
    MissingFileConfirmationRequired,
    normalize_database_monitor_entry,
    now_utc,
    portable_monitored_path,
    query_detections,
    query_recoveries,
    register_initial_files,
    remove_monitored_folder,
    replacement_path_for,
    resolve_incident,
    retrain_ai,
    scan_all_files,
    scan_single_file,
    serialize_detection,
    serialize_file,
    serialize_incident,
    serialize_recovery,
    set_backup_location,
    set_setting,
    update_ai_rules,
    weekly_ai_behavior_data,
    next_weekday,
    json_dumps,
)
from SECURITY.security_models import SecurityIncident, SecurityMonitoredFile
from SECURITY.security_models import SecurityDetectionEvent, SecurityRecoveryEvent

router = APIRouter()
BACKEND_ENV_PATH = MASTER_ROOT / "WARDS" / "backend" / ".env"


ALLOWED_ENV_KEYS = {
    "SECURITY_SCAN_INTERVAL_SECONDS",
    "SECURITY_MONITORING_ENABLED",
}


def update_backend_env(updates: dict[str, str], env_path: Path = BACKEND_ENV_PATH) -> dict[str, str]:
    disallowed = set(updates.keys()) - ALLOWED_ENV_KEYS
    if disallowed:
        raise HTTPException(
            status_code=403,
            detail=f"Env mutation restricted. Disallowed keys: {sorted(disallowed)}"
        )
    lines = env_path.read_text(encoding="utf-8").splitlines() if env_path.exists() else []
    pending = {key: str(value) for key, value in updates.items()}
    written = set()
    next_lines = []
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            next_lines.append(line)
            continue
        key = line.split("=", 1)[0].strip()
        if key in pending:
            next_lines.append(f"{key}={pending[key]}")
            os.environ[key] = pending[key]
            written.add(key)
        else:
            next_lines.append(line)
    for key, value in pending.items():
        if key not in written:
            next_lines.append(f"{key}={value}")
            os.environ[key] = value
    env_path.parent.mkdir(parents=True, exist_ok=True)
    env_path.write_text("\n".join(next_lines) + "\n", encoding="utf-8")
    return pending


def datetime_from_iso(value: str, end_of_day: bool = False):
    from datetime import datetime

    if end_of_day and len(value) == 10:
        value = f"{value}T23:59:59"
    return datetime.fromisoformat(value)


def _viewed_ids(db: Session, admin_username: str, log_type: str) -> set[int]:
    return {
        row.log_id
        for row in db.query(SecurityLogView).filter(
            SecurityLogView.viewer_username == admin_username,
            SecurityLogView.log_type == log_type,
        ).all()
    }


def _with_view_flags(items: list[dict], viewed: set[int]) -> list[dict]:
    return [{**item, "is_viewed": item.get("id") in viewed} for item in items]


def _source_ids_for_log_type(db: Session, log_type: str) -> list[int]:
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
    return [row[0] for row in rows]


def _paginate(items: list[dict], page: int, page_size: int) -> dict:
    total = len(items)
    total_pages = max(1, (total + page_size - 1) // page_size)
    page = min(max(1, page), total_pages)
    start = (page - 1) * page_size
    return {
        "items": items[start:start + page_size],
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
    }


class BackupLocationRequest(BaseModel):
    path: str
    delete_previous: bool = False


class ScheduleBackupRequest(BaseModel):
    frequency: str = "weekly"
    next_run: str


class AddFolderRequest(BaseModel):
    path: str


class AiScheduleRequest(BaseModel):
    day: str = "Sunday"
    time: str = "23:00"


class AdminChangeRequest(BaseModel):
    file_path: str


class AiRulesRequest(BaseModel):
    rules: dict


class AddAiRuleRequest(BaseModel):
    rule_key: str


class ScanIntervalRequest(BaseModel):
    seconds: int


class MonitoringToggleRequest(BaseModel):
    enabled: bool


class AiSensitivityRequest(BaseModel):
    sensitivity: str


class BulkIncidentRequest(BaseModel):
    action: str
    confirm_missing_files: bool = False


ROLE_MAIN_ADMIN = "main_admin"
ROLE_SUPERADMIN = "superadmin"


async def current_admin(request: Request, db: Session = Depends(get_db)):
    admin = await get_current_admin_from_token(request, db)
    if admin.role not in {ROLE_MAIN_ADMIN, ROLE_SUPERADMIN}:
        raise HTTPException(status_code=403, detail="Security dashboard restricted to Main Admin and Super Admin only")
    return admin


@router.post("/initialize")
def initialize_security(db: Session = Depends(get_db), admin=Depends(current_admin)):
    count = register_initial_files(db)
    return {"message": "Security dashboard initialized", "registered_files": count, "admin": admin.username}


@router.get("/dashboard")
def get_dashboard(db: Session = Depends(get_db), _=Depends(current_admin)):
    mark_stale_backup_events_failed(db)
    return dashboard_payload(db)


@router.get("/files")
def list_files(db: Session = Depends(get_db), _=Depends(current_admin)):
    return [serialize_file(item) for item in active_monitored_files_query(db).order_by(SecurityMonitoredFile.relative_path.asc()).all()]


@router.post("/files/{file_id}/scan")
def scan_file(file_id: int, request: Request, db: Session = Depends(get_db), admin=Depends(current_admin)):
    file_entry = active_monitored_files_query(db).filter(SecurityMonitoredFile.id == file_id).first()
    if not file_entry:
        raise HTTPException(status_code=404, detail="Monitored file not found")
    detection = scan_single_file(db, file_entry, context={"manual_scan": True})
    db.add(ActivityLog(
        action="Security File Scan",
        user=admin.username,
        details=f"Scanned file id={file_id}. Detection: {detection is not None} | IP: {request.client.host if request.client else 'unknown'}",
        type="security",
    ))
    db.commit()
    return {"message": "Scan complete", "detection": serialize_detection(detection) if detection else None}


@router.post("/files/{file_id}/recover")
def recover_file(file_id: int, request: Request, db: Session = Depends(get_db), admin=Depends(current_admin)):
    try:
        event = manual_recover_file(db, file_id, admin.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    db.add(ActivityLog(
        action="Security File Recovery",
        user=admin.username,
        details=f"Recovered file id={file_id} | IP: {request.client.host if request.client else 'unknown'}",
        type="security",
    ))
    db.commit()
    return serialize_recovery(event)


@router.get("/detections")
def detections(
    keyword: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    target: str | None = None,
    severity: str | None = None,
    classification: str | None = None,
    sort: str = "newest",
    limit: int = Query(200, ge=1, le=500),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db),
    admin=Depends(current_admin),
):
    rows = query_detections(db, keyword, date_from, date_to, target, severity, limit, sort, classification)
    items = _with_view_flags([serialize_detection(item) for item in rows], _viewed_ids(db, admin.username, "detections"))
    return _paginate(items, page, page_size)


@router.get("/recoveries")
def recoveries(
    keyword: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    recovery_type: str | None = None,
    status: str | None = None,
    sort: str = "newest",
    limit: int = Query(200, ge=1, le=500),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db),
    admin=Depends(current_admin),
):
    mark_stale_backup_events_failed(db)
    rows = query_recoveries(db, keyword, date_from, date_to, recovery_type, status, limit, sort)
    if not recovery_type:
        rows = [row for row in rows if "backup" not in (row.recovery_type or "")]
    items = _with_view_flags([serialize_recovery(item) for item in rows], _viewed_ids(db, admin.username, "recoveries"))
    return _paginate(items, page, page_size)


@router.get("/incidents")
def incidents(
    keyword: str | None = None,
    status: str | None = None,
    severity: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    sort: str = "newest",
    limit: int = Query(200, ge=1, le=500),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db),
    admin=Depends(current_admin),
):
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
        query = query.filter(SecurityIncident.created_at >= datetime_from_iso(date_from))
    if date_to:
        query = query.filter(SecurityIncident.created_at <= datetime_from_iso(date_to, True))
    order = SecurityIncident.created_at.asc() if sort == "oldest" else SecurityIncident.created_at.desc()
    items = _with_view_flags([serialize_incident(item) for item in query.order_by(order).limit(limit).all()], _viewed_ids(db, admin.username, "incidents"))
    return _paginate(items, page, page_size)


@router.get("/backups")
def backup_history(
    keyword: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    recovery_type: str | None = None,
    status: str | None = None,
    sort: str = "newest",
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db),
    admin=Depends(current_admin),
):
    mark_stale_backup_events_failed(db)
    query_type = None if recovery_type in {None, "", "automatic_backup"} else recovery_type or "manual_backup"
    rows = query_recoveries(db, keyword, date_from, date_to, query_type, status, 500, sort)
    backup_rows = [row for row in rows if "backup" in (row.recovery_type or "")]
    if recovery_type == "automatic_backup":
        backup_rows = [
            row for row in backup_rows
            if row.initiated_by is None
            or any(label in str(row.backup_path or row.summary or "").lower() for label in ("startup", "initial", "scheduled", "automatic"))
        ]
    elif recovery_type == "manual_backup":
        backup_rows = [
            row for row in backup_rows
            if row.initiated_by is not None
            and not any(label in str(row.backup_path or row.summary or "").lower() for label in ("startup", "initial", "scheduled", "automatic"))
        ]
    items = _with_view_flags([serialize_recovery(item) for item in backup_rows], _viewed_ids(db, admin.username, "backups"))
    return _paginate(items, page, page_size)


@router.get("/unread-counts")
def unread_counts(db: Session = Depends(get_db), admin=Depends(current_admin)):
    counts = {}
    for log_type in ("detections", "recoveries", "incidents", "backups"):
        ids = _source_ids_for_log_type(db, log_type)
        if log_type == "incidents":
            counts[log_type] = len(ids)
        else:
            viewed = _viewed_ids(db, admin.username, log_type)
            counts[log_type] = len([item_id for item_id in ids if item_id not in viewed])
    return counts


@router.post("/{log_type}/mark-viewed")
def mark_security_logs_viewed(log_type: str, ids: list[int] | None = None, db: Session = Depends(get_db), admin=Depends(current_admin)):
    if log_type not in {"detections", "recoveries", "incidents", "backups"}:
        raise HTTPException(status_code=400, detail="Invalid security log type.")
    ids_to_mark = _source_ids_for_log_type(db, log_type) if ids is None else ids
    if not ids_to_mark:
        return {"message": "No logs marked.", "unread_counts": unread_counts(db, admin)}
    existing = _viewed_ids(db, admin.username, log_type)
    for log_id in ids_to_mark:
        if log_id not in existing:
            db.add(SecurityLogView(log_type=log_type, log_id=log_id, viewer_username=admin.username))
    db.commit()
    return {"message": "Logs marked as viewed.", "unread_counts": unread_counts(db, admin)}


@router.patch("/incidents/bulk-action")
def bulk_incidents(payload: BulkIncidentRequest, request: Request, db: Session = Depends(get_db), admin=Depends(current_admin)):
    if payload.action not in {"resolve", "false_positive", "investigating"}:
        raise HTTPException(status_code=400, detail="Action must be resolve, false_positive, or investigating.")
    try:
        result = bulk_update_incidents(db, payload.action, admin.id, confirm_missing_files=payload.confirm_missing_files)
    except MissingFileConfirmationRequired as exc:
        raise HTTPException(status_code=409, detail=exc.details)
    db.add(ActivityLog(
        action="Security Bulk Incident Update",
        user=admin.username,
        details=f"Action={payload.action} | IP: {request.client.host if request.client else 'unknown'}",
        type="security",
    ))
    db.commit()
    return result


@router.patch("/incidents/{incident_id}/resolve")
def resolve(incident_id: int, confirm_missing_files: bool = False, db: Session = Depends(get_db), admin=Depends(current_admin)):
    try:
        return serialize_incident(resolve_incident(db, incident_id, admin.id, confirm_missing_files=confirm_missing_files))
    except MissingFileConfirmationRequired as exc:
        raise HTTPException(status_code=409, detail=exc.details)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.patch("/incidents/{incident_id}/false-positive")
def false_positive(incident_id: int, confirm_missing_files: bool = False, db: Session = Depends(get_db), admin=Depends(current_admin)):
    try:
        return serialize_incident(mark_false_positive(db, incident_id, admin.id, confirm_missing_files=confirm_missing_files))
    except MissingFileConfirmationRequired as exc:
        raise HTTPException(status_code=409, detail=exc.details)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


def _run_scan_all_files_sync(job_id: str) -> list:
    db = SessionLocal()
    try:
        job_manager.update_progress(job_id, 10, "registering_files")
        register_initial_files(db, refresh_existing=False)
        migrate_portable_monitored_files(db)
        database_entry = normalize_database_monitor_entry(db, reset_baseline=False, ensure_snapshot=True)
        set_setting(db, "last_scan_at", now_utc().isoformat(), "security_scanner")
        detections = []
        hash_index = current_hash_index(db)
        files = active_monitored_files_query(db).order_by(SecurityMonitoredFile.relative_path.asc()).all()
        total = len(files)
        for idx, file_entry in enumerate(files, start=1):
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
            detection = scan_single_file(db, file_entry, context={"manual_scan": True}, commit_clean=False)
            if detection:
                detections.append(detection)
            progress = 10 + int((idx / total) * 80) if total else 50
            job_manager.update_progress(job_id, progress, f"scanning {file_entry.relative_path}")
        db.commit()
        job_manager.update_progress(job_id, 100, "complete")
        return detections
    finally:
        db.close()


async def _run_scan_background(job_id: str) -> list:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: _run_scan_all_files_sync(job_id))


@router.post("/scan/submit")
async def submit_full_scan(request: Request, db: Session = Depends(get_db), admin=Depends(current_admin)):
    try:
        job = job_manager.submit("security_full_scan")
    except Exception as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    db.add(ActivityLog(
        action="Security Full Scan Submitted",
        user=admin.username,
        details=f"Background scan job submitted. Job ID: {job.id} | IP: {request.client.host if request.client else 'unknown'}",
        type="security",
    ))
    db.commit()
    # Start background task without awaiting
    asyncio.create_task(job_manager.run(job.id, lambda: _run_scan_background(job.id)))
    return {"job_id": job.id, "status": job.status, "message": "Scan job submitted successfully."}


@router.get("/scan/status/{job_id}")
def scan_status(job_id: str, _=Depends(current_admin)):
    job = job_manager.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return {
        "job_id": job.id,
        "type": job.type,
        "status": job.status,
        "progress": job.progress,
        "current_step": job.current_step,
        "created_at": job.created_at,
        "started_at": job.started_at,
        "completed_at": job.completed_at,
    }


@router.get("/scan/result/{job_id}")
def scan_result(job_id: str, _=Depends(current_admin)):
    job = job_manager.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    if job.status not in {JobStatus.COMPLETED, JobStatus.FAILED}:
        raise HTTPException(status_code=400, detail=f"Scan still in progress ({job.status}).")
    if job.status == JobStatus.FAILED:
        raise HTTPException(status_code=500, detail=job.error)
    detections = job.result or []
    return {
        "job_id": job.id,
        "status": job.status,
        "summary": f"{len(detections)} change(s) found." if detections else "No changes found. All monitored files match the trusted backup.",
        "detections": [serialize_detection(item) for item in detections],
    }


@router.post("/recover/full")
def recover_full(request: Request, db: Session = Depends(get_db), admin=Depends(current_admin)):
    result = full_system_recovery(db, admin.id)
    db.add(ActivityLog(
        action="Security Full System Recovery",
        user=admin.username,
        details=f"Full system recovery triggered. | IP: {request.client.host if request.client else 'unknown'}",
        type="security",
    ))
    db.commit()
    return result


@router.post("/backup/manual")
def manual_backup(request: Request, db: Session = Depends(get_db), admin=Depends(current_admin)):
    event = create_manual_backup(db, admin.id)
    db.add(ActivityLog(
        action="Security Manual Backup",
        user=admin.username,
        details=f"Manual backup created. | IP: {request.client.host if request.client else 'unknown'}",
        type="security",
    ))
    db.commit()
    return serialize_recovery(event)


@router.post("/backup/schedule")
def schedule_backup(payload: ScheduleBackupRequest, db: Session = Depends(get_db), admin=Depends(current_admin)):
    try:
        from datetime import datetime

        if datetime.fromisoformat(payload.next_run) <= datetime.now():
            raise HTTPException(status_code=400, detail="Scheduled backup date must be in the future.")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Use an ISO date/time value for next_run.")
    value = {"enabled": True, "frequency": payload.frequency, "next_run": payload.next_run}
    set_setting(db, "backup_schedule", json_dumps(value), admin.username)
    return value


@router.post("/backup/location")
def backup_location(payload: BackupLocationRequest, db: Session = Depends(get_db), admin=Depends(current_admin)):
    try:
        return set_backup_location(db, payload.path, payload.delete_previous, admin.username)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/folders")
def add_folder(payload: AddFolderRequest, db: Session = Depends(get_db), admin=Depends(current_admin)):
    try:
        return add_monitored_folder(db, payload.path, initiated_by=admin.id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/folders/remove")
def remove_folder(payload: AddFolderRequest, db: Session = Depends(get_db), admin=Depends(current_admin)):
    try:
        return remove_monitored_folder(db, payload.path, initiated_by=admin.id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/folder-browser")
def folder_browser(path: str | None = Query(None), _=Depends(current_admin)):
    try:
        current = Path(path).expanduser().resolve() if path else MASTER_ROOT
        if not current.exists() or not current.is_dir():
            current = MASTER_ROOT
        directories = []
        for item in current.iterdir():
            try:
                if item.is_dir() and not item.name.startswith("."):
                    directories.append({"name": item.name, "path": str(item.resolve())})
            except PermissionError:
                continue
        drives = []
        if os.name == "nt":
            for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
                drive = Path(f"{letter}:\\")
                if drive.exists():
                    drives.append({"name": str(drive), "path": str(drive)})
        else:
            drives.append({"name": "/", "path": "/"})
        return {
            "current": str(current),
            "parent": str(current.parent) if current.parent != current else None,
            "directories": sorted(directories, key=lambda item: item["name"].lower()),
            "quick_roots": [
                {"name": "WARDS MASTERFILE", "path": str(MASTER_ROOT)},
                {"name": "WARDS", "path": str(MASTER_ROOT / "WARDS")},
                {"name": "OCR", "path": str(MASTER_ROOT / "OCR")},
            ],
            "drives": drives,
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unable to browse folder: {exc}")


@router.post("/ai/retrain")
def manual_ai_retrain(db: Session = Depends(get_db), admin=Depends(current_admin)):
    return retrain_ai(db, admin.username)


@router.get("/ai/weekly-data")
def ai_weekly_data(db: Session = Depends(get_db), _=Depends(current_admin)):
    return weekly_ai_behavior_data(db)


@router.get("/ai/rules")
def get_rules(db: Session = Depends(get_db), _=Depends(current_admin)):
    return get_ai_rules(db)


@router.get("/ai/rule-templates")
def ai_rule_templates(db: Session = Depends(get_db), _=Depends(current_admin)):
    return available_ai_rule_templates(db)


@router.post("/ai/rules/add")
def add_rule(payload: AddAiRuleRequest, db: Session = Depends(get_db), admin=Depends(current_admin)):
    try:
        return add_ai_rule(db, payload.rule_key, admin.username)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.put("/ai/rules")
def save_rules(payload: AiRulesRequest, db: Session = Depends(get_db), admin=Depends(current_admin)):
    return update_ai_rules(db, payload.rules, admin.username)


@router.get("/ai/sensitivity")
def get_sensitivity(db: Session = Depends(get_db), _=Depends(current_admin)):
    return {"sensitivity": get_ai_sensitivity(db)}


@router.put("/ai/sensitivity")
def set_sensitivity(payload: AiSensitivityRequest, db: Session = Depends(get_db), admin=Depends(current_admin)):
    try:
        return {"sensitivity": set_ai_sensitivity(db, payload.sensitivity, admin.username)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.put("/scan-interval")
def save_scan_interval(payload: ScanIntervalRequest, db: Session = Depends(get_db), admin=Depends(current_admin)):
    if payload.seconds < 5:
        raise HTTPException(status_code=400, detail="Scan interval must be at least 5 seconds.")
    if payload.seconds > 3600:
        raise HTTPException(status_code=400, detail="Scan interval must be 3600 seconds or less.")
    set_setting(db, "scan_interval_seconds", str(payload.seconds), admin.username)
    update_backend_env({"SECURITY_SCAN_INTERVAL_SECONDS": str(payload.seconds)})
    return {"scan_interval_seconds": payload.seconds, "env_updated": True}


@router.put("/monitoring")
def set_monitoring(payload: MonitoringToggleRequest, request: Request, db: Session = Depends(get_db), admin=Depends(current_admin)):
    previous = (get_setting(db, "monitoring_enabled", "true") or "true").lower() == "true"
    if payload.enabled and not previous:
        event = create_manual_backup(db, admin.id, label="monitoring_resume")
        if event.status != "success":
            raise HTTPException(status_code=500, detail=event.error_message or "Unable to refresh backup before enabling automatic scans.")
    set_setting(db, "monitoring_enabled", "true" if payload.enabled else "false", admin.username)
    update_backend_env({"SECURITY_MONITORING_ENABLED": "true" if payload.enabled else "false"})
    db.add(ActivityLog(
        action="Security Monitoring Toggle",
        user=admin.username,
        details=f"Monitoring set to {payload.enabled}. | IP: {request.client.host if request.client else 'unknown'}",
        type="security",
    ))
    db.commit()
    return {"monitoring_enabled": payload.enabled, "backup_refreshed": payload.enabled and not previous, "env_updated": True}


@router.post("/ai/schedule")
def schedule_ai(payload: AiScheduleRequest, db: Session = Depends(get_db), admin=Depends(current_admin)):
    if payload.day not in {"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"}:
        raise HTTPException(status_code=400, detail="Day must be Monday through Sunday.")
    next_run = next_weekday(payload.day, payload.time)
    value = {"day": payload.day, "time": payload.time, "next_run": next_run}
    set_setting(db, "ai_retrain_schedule", json_dumps(value), admin.username)
    return value


@router.post("/admin-change")
def admin_change(payload: AdminChangeRequest, request: Request, db: Session = Depends(get_db), admin=Depends(current_admin)):
    token = request.headers.get("Authorization", "")[-48:]
    change = mark_admin_change(
        db,
        admin.id,
        payload.file_path,
        token,
        request.client.host if request.client else None,
        request.headers.get("User-Agent"),
    )
    return {"id": change.id, "message": "Admin change registered as legitimate."}


# --- DoS Protection: Blocked IP Management ---


class BlockIpRequest(BaseModel):
    ip: str
    duration: int = 300


class PermanentBlockRequest(BaseModel):
    ip: str
    reason: str


class TemporaryUserRestrictionRequest(BaseModel):
    account_id: str
    account_type: str
    scope: str = "manual"
    duration: int = 900
    reason: str = "Manual temporary user restriction"


@router.get("/blocked-ips")
def list_blocked_ips(db: Session = Depends(get_db), admin=Depends(current_admin)):
    """View all currently blocked IPs with remaining block time."""
    import time

    blocked = get_blocked_ips()
    current_time = time.time()
    result = []
    for ip, unblock_at in blocked.items():
        is_permanent = unblock_at == float("inf")
        result.append({
            "ip": ip,
            "blocked_until": None if is_permanent else unblock_at,
            "remaining_seconds": None if is_permanent else max(0, int(unblock_at - current_time)),
            "is_permanent": is_permanent,
        })
    return {"blocked_ips": result, "total": len(result)}


@router.post("/blocked-ips")
def manually_block_ip(payload: BlockIpRequest, request: Request, db: Session = Depends(get_db), admin=Depends(current_admin)):
    """Manually block an IP address for a specified duration (seconds)."""
    if not payload.ip or not payload.ip.strip():
        raise HTTPException(status_code=400, detail="IP address is required.")
    if payload.duration < 10:
        raise HTTPException(status_code=400, detail="Block duration must be at least 10 seconds.")
    if payload.duration > 86400:
        raise HTTPException(status_code=400, detail="Block duration cannot exceed 24 hours.")

    block_ip(payload.ip.strip(), payload.duration)

    db.add(ActivityLog(
        action="Manual IP Block",
        user=admin.username,
        details=f"Blocked IP {payload.ip.strip()} for {payload.duration}s | Admin IP: {request.client.host if request.client else 'unknown'}",
        type="security",
    ))
    db.commit()

    return {"message": f"IP {payload.ip.strip()} blocked for {payload.duration} seconds.", "ip": payload.ip.strip(), "duration": payload.duration}


@router.post("/user-restrictions")
def temporarily_restrict_user(payload: TemporaryUserRestrictionRequest, request: Request, db: Session = Depends(get_db), admin=Depends(current_admin)):
    if not payload.account_id.strip():
        raise HTTPException(status_code=400, detail="Account ID is required.")
    if payload.account_type not in {"user", "citizen", "branch", "admin", "superadmin"}:
        raise HTTPException(status_code=400, detail="Account type must be citizen, branch, admin, or superadmin.")
    if payload.duration < 60 or payload.duration > 7 * 24 * 60 * 60:
        raise HTTPException(status_code=400, detail="Duration must be between 60 seconds and 7 days.")
    import time
    normalized_type = "user" if payload.account_type in {"user", "citizen"} else payload.account_type
    account_key = f"{normalized_type}:{payload.account_id.strip()}"
    state = account_rate_limit_state[account_key]
    state["restricted_until_by_scope"][payload.scope] = time.time() + payload.duration
    state["last_strike_timestamp"] = time.time()
    record_rate_limit_detection(account_key, normalized_type, normalized_type, payload.scope, int(state.get("strike_count") or 0), payload.reason, payload.duration)
    db.add(ActivityLog(
        action="Manual Temporary User Restriction",
        user=admin.username,
        details=f"Restricted {account_key} for {payload.duration}s on {payload.scope}. Reason: {payload.reason} | Admin IP: {request.client.host if request.client else 'unknown'}",
        type="security",
    ))
    db.commit()
    return {"message": f"{account_key} restricted for {payload.duration} seconds.", "account_id": account_key, "duration": payload.duration, "scope": payload.scope}


@router.get("/user-restrictions")
def list_user_restrictions(_=Depends(current_admin)):
    import time
    current_time = time.time()
    items = []
    for account_key, state in account_rate_limit_state.items():
        for scope, restricted_until in list((state.get("restricted_until_by_scope") or {}).items()):
            if restricted_until <= current_time:
                state["restricted_until_by_scope"].pop(scope, None)
                continue
            items.append({
                "account_id": account_key,
                "scope": scope,
                "remaining_seconds": int(restricted_until - current_time),
                "violation_count": int(state.get("violation_count") or 0),
                "strike_count": int(state.get("strike_count") or 0),
            })
    return {"user_restrictions": items, "total": len(items)}


@router.delete("/blocked-ips/{ip}")
def manually_unblock_ip(ip: str, request: Request, db: Session = Depends(get_db), admin=Depends(current_admin)):
    """Manually unblock a blocked IP address."""
    success = unblock_ip(ip)
    if not success:
        raise HTTPException(status_code=404, detail=f"IP {ip} is not currently blocked.")

    db.add(ActivityLog(
        action="Manual IP Unblock",
        user=admin.username,
        details=f"Unblocked IP {ip} | Admin IP: {request.client.host if request.client else 'unknown'}",
        type="security",
    ))
    db.commit()

    return {"message": f"IP {ip} has been unblocked.", "ip": ip}


@router.get("/permanent-blocks")
def list_permanent_blocks(db: Session = Depends(get_db), admin=Depends(current_admin)):
    """View all permanently blocked IPs."""
    blocks = get_permanent_blocks(db, active_only=True)
    return {
        "permanent_blocks": [
            {
                "id": block.id,
                "ip": block.ip_address,
                "reason": block.reason,
                "blocked_by": block.blocked_by,
                "blocked_at": block.blocked_at.isoformat() if block.blocked_at else None,
                "abuse_count": block.abuse_count,
            }
            for block in blocks
        ],
        "total": len(blocks)
    }


@router.post("/permanent-blocks")
def add_permanent_block_endpoint(payload: PermanentBlockRequest, request: Request, db: Session = Depends(get_db), admin=Depends(current_admin)):
    """Permanently block an IP address."""
    if not payload.ip or not payload.ip.strip():
        raise HTTPException(status_code=400, detail="IP address is required.")
    if not payload.reason or not payload.reason.strip():
        raise HTTPException(status_code=400, detail="Reason is required.")

    block = add_permanent_block(
        ip=payload.ip.strip(),
        reason=payload.reason.strip(),
        blocked_by=admin.username,
        db=db
    )

    db.add(ActivityLog(
        action="Permanent IP Block",
        user=admin.username,
        details=f"Permanently blocked IP {payload.ip.strip()} - Reason: {payload.reason.strip()} | Admin IP: {request.client.host if request.client else 'unknown'}",
        type="security",
    ))
    db.commit()

    return {"message": f"IP {payload.ip.strip()} has been permanently blocked.", "ip": payload.ip.strip()}


@router.delete("/permanent-blocks/{ip}")
def remove_permanent_block_endpoint(ip: str, request: Request, db: Session = Depends(get_db), admin=Depends(current_admin)):
    """Remove a permanent IP block."""
    success = remove_permanent_block(ip, db)
    if not success:
        raise HTTPException(status_code=404, detail=f"IP {ip} is not in the permanent blocklist.")

    db.add(ActivityLog(
        action="Permanent IP Unblock",
        user=admin.username,
        details=f"Removed permanent block for IP {ip} | Admin IP: {request.client.host if request.client else 'unknown'}",
        type="security",
    ))
    db.commit()

    return {"message": f"IP {ip} has been removed from permanent blocklist.", "ip": ip}


@router.get("/ip-reputation/{ip}")
def check_ip_reputation_endpoint(ip: str, db: Session = Depends(get_db), admin=Depends(current_admin)):
    """Check IP reputation using AbuseIPDB."""
    reputation = check_ip_reputation(ip, db)
    return reputation


# --- Distributed Ledger ---

from utils.distributed_ledger import verify_ledger_integrity, ledger_tail


@router.get("/ledger/verify")
def verify_ledger(_=Depends(current_admin)):
    violations = verify_ledger_integrity()
    return {"valid": len(violations) == 0, "violations": violations}


@router.get("/ledger/tail")
def ledger_tail_endpoint(limit: int = Query(100, ge=1, le=1000), _=Depends(current_admin)):
    return {"entries": ledger_tail(limit)}
