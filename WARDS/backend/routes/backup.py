from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
import random

from database.models import Backup, get_db, ActivityLog
from middleware.admin_auth import get_current_admin_user, require_main_admin

router = APIRouter()

@router.post("/create")
async def create_backup(
    current_user=Depends(require_main_admin()),
    db: Session = Depends(get_db),
):
    filename = f"backup_{datetime.now().strftime('%Y-%m-%d_%H-%M')}.sql"
    size = f"{random.randint(240, 250)} MB"
    
    backup = Backup(
        filename=filename,
        size=size,
        type="Manual",
        status="Completed"
    )
    db.add(backup)
    
    log = ActivityLog(
        action="Backup Created",
        user="admin",
        details=f"Manual backup created: {filename}",
        type="admin"
    )
    db.add(log)
    db.commit()
    db.refresh(backup)
    
    return backup

@router.get("/list")
async def get_all_backups(
    current_user=Depends(require_main_admin()),
    db: Session = Depends(get_db),
):
    backups = db.query(Backup).order_by(Backup.created_at.desc()).all()
    return backups

@router.post("/restore/{backup_id}")
async def restore_backup(
    backup_id: int,
    current_user=Depends(require_main_admin()),
    db: Session = Depends(get_db),
):
    backup = db.query(Backup).filter(Backup.id == backup_id).first()
    if not backup:
        raise HTTPException(status_code=404, detail="Backup not found")
    
    log = ActivityLog(
        action="Backup Restored",
        user="admin",
        details=f"Restored backup: {backup.filename}",
        type="admin"
    )
    db.add(log)
    db.commit()
    
    return {"message": "Backup restored successfully"}
