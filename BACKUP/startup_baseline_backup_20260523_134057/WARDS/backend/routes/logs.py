from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import Optional

from database.models import ActivityLog, User, get_db
from middleware.admin_auth import get_current_admin_user
from utils.rbac import require_permission

router = APIRouter()

@router.get("/")
async def get_activity_logs(
    type: Optional[str] = None,
    user: Optional[str] = None,
    dateFrom: Optional[str] = None,
    dateTo: Optional[str] = None,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    require_permission("view_activity_logs")(current_user)
    query = db.query(ActivityLog)
    
    if type:
        query = query.filter(ActivityLog.type == type)
    if user:
        query = query.filter(ActivityLog.user.contains(user))
    if dateFrom:
        query = query.filter(ActivityLog.created_at >= datetime.fromisoformat(dateFrom))
    if dateTo:
        query = query.filter(ActivityLog.created_at < datetime.fromisoformat(dateTo) + timedelta(days=1))
    
    logs = query.order_by(ActivityLog.created_at.desc()).limit(100).all()
    return [
        {
            "id": log.id,
            "action": log.action,
            "user": log.user,
            "details": log.details,
            "type": log.type,
            "created_at": log.created_at.isoformat() if log.created_at else None,
        }
        for log in logs
    ]
