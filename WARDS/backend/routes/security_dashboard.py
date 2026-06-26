from __future__ import annotations

import asyncio
import httpx
import os
import sys
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from slowapi import Limiter
from slowapi.util import get_remote_address
from pydantic import BaseModel
from sqlalchemy.orm import Session

try:
    MASTER_ROOT = Path(__file__).resolve().parents[3]
except IndexError:
    MASTER_ROOT = Path("/")
if str(MASTER_ROOT) not in sys.path:
    sys.path.insert(0, str(MASTER_ROOT))

from database.models import get_db, SessionLocal, ActivityLog, PermanentIpBlock, SecurityLogView, Backup
from auth import get_current_admin_from_token
from utils.background_jobs import job_manager, JobStatus
from middleware.dos_protection import get_blocked_ips, unblock_ip, block_ip, account_rate_limit_state, record_rate_limit_detection
from services.ip_reputation import get_permanent_blocks, add_permanent_block, remove_permanent_block, check_ip_reputation
from utils.backup_engine import create_database_backup as create_vm1_database_backup, restore_database_backup
from utils.security_client import (
    SECURITY_API_URL,
    active_monitored_files_query,
    add_monitored_folder,
    add_ai_rule,
    available_ai_rule_templates,
    bulk_update_incidents,
    create_manual_backup,
    create_database_backup,
    create_files_backup,
    create_ml_backup,
    create_full_system_backup,
    current_hash_index,
    dashboard_payload,
    full_system_recovery,
    recover_database,
    recover_files,
    recover_ml_artifacts,
    recover_full_system,
    get_setting,
    get_ai_rules,
    get_ai_sensitivity,
    is_database_entry,
    list_monitored_files,
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
    query_incidents,
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
    set_ai_sensitivity,
    set_backup_location,
    set_setting,
    source_ids_for_log_type,
    source_ids_batch,
    update_ai_rules,
    weekly_ai_behavior_data,
    sync_security_alerts,
    next_weekday,
    json_dumps,
)
def get_rate_limit_key(request: Request) -> str:
    """Get rate limit key - user-based if authenticated, otherwise IP-based"""
    if hasattr(request.state, 'user') and request.state.user:
        return f"user:{request.state.user.id}"
    return get_remote_address(request)


limiter = Limiter(key_func=get_rate_limit_key)

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
    new_content = "\n".join(next_lines) + "\n"
    old_content = env_path.read_text(encoding="utf-8") if env_path.exists() else ""
    # Only write if content actually changes to avoid triggering file-change detections
    if new_content != old_content:
        env_path.parent.mkdir(parents=True, exist_ok=True)
        env_path.write_text(new_content, encoding="utf-8")
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


def _getval(obj, key, default=None):
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _source_ids_for_log_type(db: Session, log_type: str) -> list[int]:
    return source_ids_for_log_type(db, log_type)


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
    vm_target: str | None = None


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
    try:
        mark_stale_backup_events_failed(db)
    except Exception:
        pass
    try:
        sync_security_alerts(db, limit=50)
    except Exception:
        pass
    try:
        return dashboard_payload(db)
    except Exception as exc:
        return {
            "system_status": "Unknown",
            "monitored_files": 0,
            "active_incidents": 0,
            "last_scan": None,
            "next_scheduled_backup": "Not scheduled",
            "severity_distribution": {},
            "attack_types": {},
            "behaviors": {},
            "today_summary": {"incidents": 0, "detections": 0, "high_severity": 0},
            "backup_location": None,
            "latest_backup": None,
            "ai_model_status": {"trained": False, "last_trained": None},
            "monitoring_enabled": False,
            "_service_warning": str(exc),
        }


@router.get("/files")
def list_files(db: Session = Depends(get_db), _=Depends(current_admin)):
    try:
        return list_monitored_files(db)
    except Exception:
        return []


@router.post("/files/{file_id}/scan")
def scan_file(file_id: int, request: Request, db: Session = Depends(get_db), admin=Depends(current_admin)):
    from types import SimpleNamespace
    file_entry = SimpleNamespace(id=file_id, relative_path=None)
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
    try:
        rows = query_detections(db, keyword, date_from, date_to, target, severity, limit, sort, classification)
        items = _with_view_flags([serialize_detection(item) for item in rows], _viewed_ids(db, admin.username, "detections"))
        return _paginate(items, page, page_size)
    except Exception:
        return _paginate([], page, page_size)


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
    try:
        mark_stale_backup_events_failed(db)
        rows = query_recoveries(db, keyword, date_from, date_to, recovery_type, status, limit, sort)
        if not recovery_type:
            rows = [row for row in rows if "backup" not in (_getval(row, "recovery_type") or "")]
        items = _with_view_flags([serialize_recovery(item) for item in rows], _viewed_ids(db, admin.username, "recoveries"))
        return _paginate(items, page, page_size)
    except Exception:
        return _paginate([], page, page_size)


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
    try:
        rows = query_incidents(db, keyword=keyword, status=status, severity=severity, date_from=date_from, date_to=date_to, limit=limit, sort=sort)
        items = _with_view_flags([serialize_incident(item) for item in rows], _viewed_ids(db, admin.username, "incidents"))
        return _paginate(items, page, page_size)
    except Exception:
        return _paginate([], page, page_size)


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
    try:
        mark_stale_backup_events_failed(db)
        query_type = None if recovery_type in {None, "", "automatic_backup"} else recovery_type or "manual_backup"
        rows = query_recoveries(db, keyword, date_from, date_to, query_type, status, 500, sort)
        backup_rows = [row for row in rows if "backup" in (_getval(row, "recovery_type") or "")]
        if recovery_type == "automatic_backup":
            backup_rows = [
                row for row in backup_rows
                if _getval(row, "initiated_by") is None
                or any(label in str((_getval(row, "backup_path") or _getval(row, "summary") or "")).lower() for label in ("startup", "initial", "scheduled", "automatic"))
            ]
        elif recovery_type == "manual_backup":
            backup_rows = [
                row for row in backup_rows
                if _getval(row, "initiated_by") is not None
                and not any(label in str((_getval(row, "backup_path") or _getval(row, "summary") or "")).lower() for label in ("startup", "initial", "scheduled", "automatic"))
            ]
        items = _with_view_flags([serialize_recovery(item) for item in backup_rows], _viewed_ids(db, admin.username, "backups"))
        return _paginate(items, page, page_size)
    except Exception:
        return _paginate([], page, page_size)


@router.get("/unread-counts")
def unread_counts(db: Session = Depends(get_db), admin=Depends(current_admin)):
    try:
        ids_map = source_ids_batch(db, ["detections", "recoveries", "incidents", "backups"])
    except Exception:
        ids_map = {}
    counts = {}
    for log_type in ("detections", "recoveries", "incidents", "backups"):
        ids = set(ids_map.get(log_type, []))
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
    ids_to_mark = source_ids_for_log_type(db, log_type) if ids is None else ids
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
    if SECURITY_API_URL:
        db = SessionLocal()
        try:
            job_manager.update_progress(job_id, 10, "registering_files")
            detections = scan_all_files(db, context={"manual_scan": True})
            set_setting(db, "last_scan_at", now_utc().isoformat(), "security_scanner")
            job_manager.update_progress(job_id, 100, "complete")
            return detections
        finally:
            db.close()

    db = SessionLocal()
    try:
        job_manager.update_progress(job_id, 10, "registering_files")
        register_initial_files(db, refresh_existing=False)
        migrate_portable_monitored_files(db)
        database_entry = normalize_database_monitor_entry(db, reset_baseline=False, ensure_snapshot=True)
        set_setting(db, "last_scan_at", now_utc().isoformat(), "security_scanner")
        detections = []
        hash_index = current_hash_index(db)
        from SECURITY.security_models import SecurityMonitoredFile
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
@limiter.limit("5/minute")
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


@router.post("/scan")
@limiter.limit("5/minute")
def run_full_scan(request: Request, db: Session = Depends(get_db), admin=Depends(current_admin)):
    try:
        job = job_manager.submit("security_full_scan")
    except Exception as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    db.add(ActivityLog(
        action="Security Full Scan",
        user=admin.username,
        details=f"Manual system scan initiated. | IP: {request.client.host if request.client else 'unknown'}",
        type="security",
    ))
    db.commit()
    job_manager._start(job.id)
    try:
        detections = _run_scan_all_files_sync(job.id)
        job_manager._complete(job.id, detections)
        return {
            "summary": f"{len(detections)} change(s) found." if detections else "No changes found. All monitored files match the trusted backup.",
            "detections": [serialize_detection(item) for item in detections],
        }
    except Exception as exc:
        job_manager._fail(job.id, str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


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
    try:
        result = full_system_recovery(db, admin.id)
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code if exc.response else 502
        raise HTTPException(status_code=status_code, detail=f"Security service error: {exc}")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Security service timed out. VM2 may be unreachable.")
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Unable to reach security service: {exc}")
    db.add(ActivityLog(
        action="Security Full System Recovery",
        user=admin.username,
        details=f"Full system recovery triggered. | IP: {request.client.host if request.client else 'unknown'}",
        type="security",
    ))
    db.commit()
    return result


@router.post("/recover/vm1-database")
def recover_vm1_database(request: Request, db: Session = Depends(get_db), admin=Depends(current_admin)):
    latest = db.query(Backup).filter(Backup.status == "Completed").order_by(Backup.created_at.desc()).first()
    if not latest:
        raise HTTPException(status_code=404, detail="No completed VM1 database backup found.")
    from utils.backup_engine import backup_dir
    backup_path = backup_dir() / latest.filename
    try:
        restore_database_backup(backup_path, getattr(latest, "checksum", None), getattr(latest, "db_type", None))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"VM1 database restore failed: {exc}")
    db.add(ActivityLog(
        action="Security VM1 Database Recovery",
        user=admin.username,
        details=f"VM1 database restored from {latest.filename}. | IP: {request.client.host if request.client else 'unknown'}",
        type="security",
    ))
    db.commit()
    return {"restored": True, "filename": latest.filename}


@router.post("/recover/vm2-database")
def recover_vm2_database(request: Request, db: Session = Depends(get_db), admin=Depends(current_admin)):
    event = recover_database(db, admin.id)
    db.add(ActivityLog(
        action="Security VM2 Database Recovery",
        user=admin.username,
        details=f"VM2 database recovery triggered. | IP: {request.client.host if request.client else 'unknown'}",
        type="security",
    ))
    db.commit()
    return serialize_recovery(event)


@router.post("/recover/files")
def recover_files_route(request: Request, db: Session = Depends(get_db), admin=Depends(current_admin)):
    result = recover_files(db, admin.id)
    db.add(ActivityLog(
        action="Security Files Recovery",
        user=admin.username,
        details=f"Files recovery triggered. Restored: {result.get('restored', 0)}, Failed: {result.get('failed', 0)}. | IP: {request.client.host if request.client else 'unknown'}",
        type="security",
    ))
    db.commit()
    return result


@router.post("/recover/ml")
def recover_ml_route(request: Request, db: Session = Depends(get_db), admin=Depends(current_admin)):
    event = recover_ml_artifacts(db, admin.id)
    db.add(ActivityLog(
        action="Security ML Recovery",
        user=admin.username,
        details=f"ML artifacts recovery triggered. | IP: {request.client.host if request.client else 'unknown'}",
        type="security",
    ))
    db.commit()
    return serialize_recovery(event)


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


@router.post("/backup/vm1-database")
def backup_vm1_database(request: Request, db: Session = Depends(get_db), admin=Depends(current_admin)):
    try:
        result = create_vm1_database_backup()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"VM1 database backup failed: {exc}")
    backup = Backup(
        filename=result.filename,
        size=str(result.size_bytes),
        type="Security VM1 Manual",
        status="Completed",
        checksum=result.checksum,
        db_type=result.db_type,
        retention_days=30,
    )
    db.add(backup)
    db.add(ActivityLog(
        action="Security VM1 Database Backup",
        user=admin.username,
        details=f"VM1 database backup created: {result.filename}; Size: {result.size_bytes}; Checksum: {result.checksum}. | IP: {request.client.host if request.client else 'unknown'}",
        type="security",
    ))
    db.commit()
    db.refresh(backup)
    return {
        "id": backup.id,
        "filename": result.filename,
        "size_bytes": result.size_bytes,
        "checksum": result.checksum,
        "db_type": result.db_type,
        "status": "Completed",
    }


@router.post("/backup/vm2-database")
def backup_vm2_database(request: Request, db: Session = Depends(get_db), admin=Depends(current_admin)):
    event = create_database_backup(db, admin.id)
    db.add(ActivityLog(
        action="Security VM2 Database Backup",
        user=admin.username,
        details=f"VM2 database backup created. | IP: {request.client.host if request.client else 'unknown'}",
        type="security",
    ))
    db.commit()
    return serialize_recovery(event)


@router.post("/backup/files")
def backup_files(request: Request, db: Session = Depends(get_db), admin=Depends(current_admin)):
    event = create_files_backup(db, admin.id)
    db.add(ActivityLog(
        action="Security Files Backup",
        user=admin.username,
        details=f"Files backup created. | IP: {request.client.host if request.client else 'unknown'}",
        type="security",
    ))
    db.commit()
    return serialize_recovery(event)


@router.post("/backup/ml")
def backup_ml(request: Request, db: Session = Depends(get_db), admin=Depends(current_admin)):
    event = create_ml_backup(db, admin.id)
    db.add(ActivityLog(
        action="Security ML Backup",
        user=admin.username,
        details=f"ML backup created. | IP: {request.client.host if request.client else 'unknown'}",
        type="security",
    ))
    db.commit()
    return serialize_recovery(event)


@router.post("/backup/full")
def backup_full(request: Request, db: Session = Depends(get_db), admin=Depends(current_admin)):
    # VM1 DB backup
    try:
        vm1_result = create_vm1_database_backup()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"VM1 database backup failed: {exc}")
    vm1_backup = Backup(
        filename=vm1_result.filename,
        size=str(vm1_result.size_bytes),
        type="Security Full VM1",
        status="Completed",
        checksum=vm1_result.checksum,
        db_type=vm1_result.db_type,
        retention_days=30,
    )
    db.add(vm1_backup)
    # VM2 full system backup
    event = create_full_system_backup(db, admin.id)
    vm2_event_id = event.get("id") if isinstance(event, dict) else getattr(event, "id", None)
    db.add(ActivityLog(
        action="Security Full System Backup",
        user=admin.username,
        details=f"Full system backup created. VM1: {vm1_result.filename}; VM2: Backup #{vm2_event_id}. | IP: {request.client.host if request.client else 'unknown'}",
        type="security",
    ))
    db.commit()
    db.refresh(vm1_backup)
    return {
        "vm1": {
            "id": vm1_backup.id,
            "filename": vm1_result.filename,
            "size_bytes": vm1_result.size_bytes,
            "checksum": vm1_result.checksum,
        },
        "vm2": serialize_recovery(event),
    }


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
        return add_monitored_folder(db, payload.path, initiated_by=admin.id, vm_target=payload.vm_target)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code if exc.response else 502
        detail = exc.response.text if exc.response else str(exc)
        raise HTTPException(status_code=status_code, detail=detail)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Security service timed out while adding folder.")
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/folders/remove")
def remove_folder(payload: AddFolderRequest, db: Session = Depends(get_db), admin=Depends(current_admin)):
    try:
        return remove_monitored_folder(db, payload.path, initiated_by=admin.id, vm_target=payload.vm_target)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code if exc.response else 502
        raise HTTPException(status_code=status_code, detail=str(exc))


@router.get("/folder-browser")
def folder_browser(path: str | None = Query(None), _=Depends(current_admin)):
    try:
        from SECURITY.security_engine import stored_path_value
        if not path or path in {".", "./"}:
            current = MASTER_ROOT
        else:
            expanded = Path(path).expanduser()
            if not expanded.is_absolute():
                current = (MASTER_ROOT / expanded).resolve()
            else:
                current = expanded.resolve()
        if not current.exists() or not current.is_dir():
            current = MASTER_ROOT
        directories = []
        for item in current.iterdir():
            try:
                if item.is_dir() and not item.name.startswith("."):
                    directories.append({"name": item.name, "path": stored_path_value(item.resolve()) or str(item.resolve())})
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
        quick_roots = [
            {"name": "WARDS", "path": stored_path_value(MASTER_ROOT / "WARDS") or str(MASTER_ROOT / "WARDS")},
            {"name": "OCR", "path": stored_path_value(MASTER_ROOT / "OCR") or str(MASTER_ROOT / "OCR")},
            {"name": "Security Root", "path": stored_path_value(MASTER_ROOT / "SECURITY") or str(MASTER_ROOT / "SECURITY")},
        ]
        if Path("/opt/wards/app").exists():
            quick_roots.append({"name": "App Root", "path": "/opt/wards/app"})
        if Path("/opt/wards/security").exists():
            quick_roots.append({"name": "Security App", "path": "/opt/wards/security"})
        local_backups = MASTER_ROOT / "SECURITY" / "local_backups"
        if local_backups.exists():
            quick_roots.append({"name": "Local Backups", "path": stored_path_value(local_backups) or str(local_backups)})
        home_dir = Path.home()
        if home_dir.exists() and str(home_dir) != "/":
            quick_roots.append({"name": "Home", "path": str(home_dir)})
        return {
            "current": stored_path_value(current) or str(current),
            "parent": stored_path_value(current.parent) or str(current.parent) if current.parent != current else None,
            "directories": sorted(directories, key=lambda item: item["name"].lower()),
            "quick_roots": quick_roots,
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
        status = event.status if hasattr(event, "status") else event.get("status")
        error = event.error_message if hasattr(event, "error_message") else event.get("error_message")
        if status != "success":
            raise HTTPException(status_code=500, detail=error or "Unable to refresh backup before enabling automatic scans.")
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

    return {
        "message": f"IP {payload.ip.strip()} has been permanently blocked.",
        "ip": payload.ip.strip(),
        "permanent_block": {
            "id": block.id,
            "ip": block.ip_address,
            "reason": block.reason,
            "blocked_by": block.blocked_by,
            "blocked_at": block.blocked_at.isoformat() if block.blocked_at else None,
            "abuse_count": block.abuse_count,
        },
    }


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
