from fastapi import APIRouter, Depends, HTTPException, Request

from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session
from datetime import datetime

from database.models import Backup, get_db, ActivityLog
from auth import get_current_admin_user, require_main_admin
from utils.backup_engine import backup_dir, create_database_backup, prune_database_backup_records, restore_database_backup
from utils.request_signing import require_internal_signature
from utils.security_client import SECURITY_API_URL, download_latest_vm1_database_backup, upload_vm1_database_backup

def get_rate_limit_key(request: Request) -> str:
    """Get rate limit key - user-based if authenticated, otherwise IP-based"""
    if hasattr(request.state, 'user') and request.state.user:
        return f"user:{request.state.user.id}"
    return get_remote_address(request)


limiter = Limiter(key_func=get_rate_limit_key)

router = APIRouter()

@router.post("/create")
@limiter.limit("3/minute")
async def create_backup(
    request: Request,
    current_user=Depends(require_main_admin()),
    db: Session = Depends(get_db),
):
    try:
        result = create_database_backup()
        status_text = "Completed"
        error_detail = None
    except Exception as exc:
        result = None
        status_text = "Failed"
        error_detail = str(exc)

    backup = Backup(
        filename=result.filename if result else f"database_failed_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.sql.gz",
        size=str(result.size_bytes) if result else "0",
        type="Manual",
        status=status_text,
        checksum=result.checksum if result else None,
        db_type=result.db_type if result else None,
        retention_days=30,
    )
    db.add(backup)
    
    log = ActivityLog(
        action="Backup Created",
        user=getattr(current_user, "username", "admin"),
        details=(
            f"Manual database backup created: {backup.filename}; Size: {backup.size}; Checksum: {backup.checksum}"
            if result
            else f"Manual database backup failed: {error_detail}"
        ),
        type="admin"
    )
    db.add(log)
    db.commit()
    if result:
        try:
            upload_vm1_database_backup(result.path, result.checksum, result.db_type)
        except Exception:
            pass
        prune_database_backup_records(db, Backup)
    db.refresh(backup)
    
    if error_detail:
        raise HTTPException(status_code=500, detail="Database backup failed")

    return backup

@router.get("/list")
async def get_all_backups(
    current_user=Depends(require_main_admin()),
    db: Session = Depends(get_db),
):
    backups = db.query(Backup).order_by(Backup.created_at.desc()).all()
    return backups

@router.post("/restore/{backup_id}")
@limiter.limit("3/minute")
async def restore_backup(
    request: Request,
    backup_id: int,
    _signature_ok: bool = Depends(require_internal_signature),
    current_user=Depends(require_main_admin()),
    db: Session = Depends(get_db),
):
    backup = db.query(Backup).filter(Backup.id == backup_id).first()
    if not backup:
        raise HTTPException(status_code=404, detail="Backup not found")
    
    try:
        backup_path = backup_dir() / backup.filename
        if not backup_path.exists() and SECURITY_API_URL:
            downloaded = download_latest_vm1_database_backup(backup_dir())
            backup_path = downloaded and downloaded.get("path") or backup_path
            checksum = downloaded and downloaded.get("checksum") or getattr(backup, "checksum", None)
            db_type = downloaded and downloaded.get("db_type") or getattr(backup, "db_type", None)
        else:
            checksum = getattr(backup, "checksum", None)
            db_type = getattr(backup, "db_type", None)
        restore_database_backup(backup_path, checksum, db_type)
        log = ActivityLog(
            action="Backup Restored",
            user=getattr(current_user, "username", "admin"),
            details=f"Restored database backup: {backup.filename}; Checksum: {getattr(backup, 'checksum', None)}",
            type="admin"
        )
        db.add(log)
        db.commit()
    except Exception as exc:
        db.add(ActivityLog(
            action="Backup Restore Failed",
            user=getattr(current_user, "username", "admin"),
            details=f"Restore failed for backup {backup.filename}: {exc}",
            type="admin",
        ))
        db.commit()
        raise HTTPException(status_code=500, detail="Backup restore failed") from exc
    
    return {"message": "Backup restored successfully"}
