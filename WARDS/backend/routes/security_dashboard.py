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

from database.models import get_db, ActivityLog, PermanentIpBlock
from routes.admin_auth_v2 import get_current_admin_from_token
from middleware.dos_protection import get_blocked_ips, unblock_ip, block_ip
from services.ip_reputation import get_permanent_blocks, add_permanent_block, remove_permanent_block, check_ip_reputation
from SECURITY.security_engine import (
    add_monitored_folder,
    add_ai_rule,
    available_ai_rule_templates,
    bulk_update_incidents,
    create_manual_backup,
    dashboard_payload,
    full_system_recovery,
    get_setting,
    get_ai_rules,
    manual_recover_file,
    mark_admin_change,
    mark_false_positive,
    MissingFileConfirmationRequired,
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
BACKEND_ENV_PATH = MASTER_ROOT / "WARDS" / "backend" / ".env"


def update_backend_env(updates: dict[str, str], env_path: Path = BACKEND_ENV_PATH) -> dict[str, str]:
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


class BulkIncidentRequest(BaseModel):
    action: str
    confirm_missing_files: bool = False


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
    try:
        return bulk_update_incidents(db, payload.action, admin.id, confirm_missing_files=payload.confirm_missing_files)
    except MissingFileConfirmationRequired as exc:
        raise HTTPException(status_code=409, detail=exc.details)


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
def add_folder(payload: AddFolderRequest, db: Session = Depends(get_db), admin=Depends(current_admin)):
    try:
        return add_monitored_folder(db, payload.path, initiated_by=admin.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/folders/remove")
def remove_folder(payload: AddFolderRequest, db: Session = Depends(get_db), admin=Depends(current_admin)):
    try:
        return remove_monitored_folder(db, payload.path, initiated_by=admin.id)
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
def set_monitoring(payload: MonitoringToggleRequest, db: Session = Depends(get_db), admin=Depends(current_admin)):
    previous = (get_setting(db, "monitoring_enabled", "true") or "true").lower() == "true"
    if payload.enabled and not previous:
        event = create_manual_backup(db, admin.id, label="monitoring_resume")
        if event.status != "success":
            raise HTTPException(status_code=500, detail=event.error_message or "Unable to refresh backup before enabling automatic scans.")
    set_setting(db, "monitoring_enabled", "true" if payload.enabled else "false", admin.username)
    update_backend_env({"SECURITY_MONITORING_ENABLED": "true" if payload.enabled else "false"})
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


@router.get("/blocked-ips")
def list_blocked_ips(db: Session = Depends(get_db), admin=Depends(current_admin)):
    """View all currently blocked IPs with remaining block time."""
    import time

    blocked = get_blocked_ips()
    current_time = time.time()
    result = []
    for ip, unblock_at in blocked.items():
        result.append({
            "ip": ip,
            "blocked_until": unblock_at,
            "remaining_seconds": max(0, int(unblock_at - current_time)),
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
