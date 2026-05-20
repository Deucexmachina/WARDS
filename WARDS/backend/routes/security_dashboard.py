from __future__ import annotations

import os
import sys
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

MASTER_ROOT = Path(__file__).resolve().parents[3]
if str(MASTER_ROOT) not in sys.path:
    sys.path.insert(0, str(MASTER_ROOT))

from database.models import get_db
from routes.admin_auth_v2 import get_current_admin_from_token
from SECURITY.security_engine import (
    add_monitored_folder,
    bulk_update_incidents,
    create_manual_backup,
    dashboard_payload,
    full_system_recovery,
    get_ai_rules,
    manual_recover_file,
    mark_admin_change,
    mark_false_positive,
    query_detections,
    query_recoveries,
    register_initial_files,
    remove_monitored_folder,
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

router = APIRouter()


def datetime_from_iso(value: str, end_of_day: bool = False):
    from datetime import datetime

    if end_of_day and len(value) == 10:
        value = f"{value}T23:59:59"
    return datetime.fromisoformat(value)


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


class ScanIntervalRequest(BaseModel):
    seconds: int


class BulkIncidentRequest(BaseModel):
    action: str


def current_admin(request: Request, db: Session = Depends(get_db)):
    return get_current_admin_from_token(request, db)


@router.post("/initialize")
def initialize_security(db: Session = Depends(get_db), admin=Depends(current_admin)):
    count = register_initial_files(db)
    return {"message": "Security dashboard initialized", "registered_files": count, "admin": admin.username}


@router.get("/dashboard")
def get_dashboard(db: Session = Depends(get_db), _=Depends(current_admin)):
    return dashboard_payload(db)


@router.get("/files")
def list_files(db: Session = Depends(get_db), _=Depends(current_admin)):
    register_initial_files(db)
    return [serialize_file(item) for item in db.query(SecurityMonitoredFile).order_by(SecurityMonitoredFile.relative_path.asc()).all()]


@router.post("/files/{file_id}/scan")
def scan_file(file_id: int, db: Session = Depends(get_db), _=Depends(current_admin)):
    file_entry = db.query(SecurityMonitoredFile).filter(SecurityMonitoredFile.id == file_id).first()
    if not file_entry:
        raise HTTPException(status_code=404, detail="Monitored file not found")
    detection = scan_single_file(db, file_entry, context={"manual_scan": True})
    return {"message": "Scan complete", "detection": serialize_detection(detection) if detection else None}


@router.post("/files/{file_id}/recover")
def recover_file(file_id: int, db: Session = Depends(get_db), admin=Depends(current_admin)):
    try:
        event = manual_recover_file(db, file_id, admin.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return serialize_recovery(event)


@router.get("/detections")
def detections(
    keyword: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    target: str | None = None,
    severity: str | None = None,
    sort: str = "newest",
    limit: int = Query(200, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(current_admin),
):
    rows = query_detections(db, keyword, date_from, date_to, target, severity, limit, sort)
    return [serialize_detection(item) for item in rows]


@router.get("/recoveries")
def recoveries(
    keyword: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    recovery_type: str | None = None,
    status: str | None = None,
    sort: str = "newest",
    limit: int = Query(200, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(current_admin),
):
    rows = query_recoveries(db, keyword, date_from, date_to, recovery_type, status, limit, sort)
    return [serialize_recovery(item) for item in rows]


@router.get("/incidents")
def incidents(
    keyword: str | None = None,
    status: str | None = None,
    severity: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    sort: str = "newest",
    limit: int = Query(200, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(current_admin),
):
    query = db.query(SecurityIncident)
    if status:
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
    return [serialize_incident(item) for item in query.order_by(order).limit(limit).all()]


@router.patch("/incidents/bulk-action")
def bulk_incidents(payload: BulkIncidentRequest, db: Session = Depends(get_db), admin=Depends(current_admin)):
    if payload.action not in {"resolve", "false_positive", "investigating"}:
        raise HTTPException(status_code=400, detail="Action must be resolve, false_positive, or investigating.")
    return bulk_update_incidents(db, payload.action, admin.id)


@router.patch("/incidents/{incident_id}/resolve")
def resolve(incident_id: int, db: Session = Depends(get_db), admin=Depends(current_admin)):
    try:
        return serialize_incident(resolve_incident(db, incident_id, admin.id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.patch("/incidents/{incident_id}/false-positive")
def false_positive(incident_id: int, db: Session = Depends(get_db), admin=Depends(current_admin)):
    try:
        return serialize_incident(mark_false_positive(db, incident_id, admin.id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/scan")
def full_scan(db: Session = Depends(get_db), _=Depends(current_admin)):
    detections = scan_all_files(db, context={"manual_scan": True})
    return {
        "message": "Full integrity scan complete",
        "summary": f"{len(detections)} change(s) found." if detections else "No changes found. All monitored files match the trusted backup.",
        "detections": [serialize_detection(item) for item in detections],
    }


@router.post("/recover/full")
def recover_full(db: Session = Depends(get_db), admin=Depends(current_admin)):
    return full_system_recovery(db, admin.id)


@router.post("/backup/manual")
def manual_backup(db: Session = Depends(get_db), admin=Depends(current_admin)):
    event = create_manual_backup(db, admin.id)
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
def add_folder(payload: AddFolderRequest, db: Session = Depends(get_db), _=Depends(current_admin)):
    try:
        return add_monitored_folder(db, payload.path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/folders/remove")
def remove_folder(payload: AddFolderRequest, db: Session = Depends(get_db), _=Depends(current_admin)):
    try:
        return remove_monitored_folder(db, payload.path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


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


@router.put("/ai/rules")
def save_rules(payload: AiRulesRequest, db: Session = Depends(get_db), admin=Depends(current_admin)):
    return update_ai_rules(db, payload.rules, admin.username)


@router.put("/scan-interval")
def save_scan_interval(payload: ScanIntervalRequest, db: Session = Depends(get_db), admin=Depends(current_admin)):
    if payload.seconds < 5:
        raise HTTPException(status_code=400, detail="Scan interval must be at least 5 seconds.")
    if payload.seconds > 3600:
        raise HTTPException(status_code=400, detail="Scan interval must be 3600 seconds or less.")
    set_setting(db, "scan_interval_seconds", str(payload.seconds), admin.username)
    return {"scan_interval_seconds": payload.seconds}


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
