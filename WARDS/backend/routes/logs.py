from datetime import datetime, timedelta

import re

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import Optional

from database.models import ActivityLog, Branch, BranchStaff, User, get_db
from utils.field_crypto import get_decrypted_or_raw
from middleware.admin_auth import get_current_admin_user
from utils.log_integrity import verify_record_integrity
from utils.rbac import require_permission

router = APIRouter()


def _get_branch_name_for_user(current_user, db: Session) -> Optional[str]:
    """Return the branch name for a BranchStaff user, or None for admin users."""
    if isinstance(current_user, BranchStaff) and current_user.branch_id:
        branch = db.query(Branch).filter(Branch.id == current_user.branch_id).first()
        if not branch:
            return None
        return get_decrypted_or_raw(branch, "name") or branch.name
    return None


def _apply_branch_filter(query, branch_name: str):
    """Filter ActivityLog rows whose details field contains the given branch name."""
    return query.filter(
        ActivityLog.details.ilike(f"%branch%{branch_name}%")
        | ActivityLog.details.ilike(f"%branch_name%{branch_name}%")
    )


@router.get("/unread-count")
async def get_activity_logs_unread_count(
    since: Optional[str] = None,
    branch_name: Optional[str] = None,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    is_branch_admin = isinstance(current_user, BranchStaff) and current_user.role == "branch_admin"

    if is_branch_admin:
        require_permission("view_branch_activity_logs")(current_user)
    else:
        require_permission("view_activity_logs")(current_user)

    query = db.query(ActivityLog)

    if since:
        query = query.filter(ActivityLog.created_at > datetime.fromisoformat(since))

    # Branch admins are always scoped to their own branch
    effective_branch = _get_branch_name_for_user(current_user, db) if is_branch_admin else branch_name
    if effective_branch:
        query = _apply_branch_filter(query, effective_branch)

    return {"unread_count": query.count()}

@router.get("/")
async def get_activity_logs(
    type: Optional[str] = None,
    user: Optional[str] = None,
    dateFrom: Optional[str] = None,
    dateTo: Optional[str] = None,
    branch_name: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    is_branch_admin = isinstance(current_user, BranchStaff) and current_user.role == "branch_admin"

    if is_branch_admin:
        require_permission("view_branch_activity_logs")(current_user)
    else:
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

    # Branch admins are always scoped to their own branch; super/main admins may pass branch_name
    effective_branch = _get_branch_name_for_user(current_user, db) if is_branch_admin else branch_name
    if effective_branch:
        query = _apply_branch_filter(query, effective_branch)

    total = query.count()
    total_pages = max(1, (total + page_size - 1) // page_size)
    page = min(max(1, page), total_pages)
    logs = query.order_by(ActivityLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    def detail_value(details: str | None, label: str) -> str | None:
        if not details:
            return None
        match = re.search(rf"{re.escape(label)}\s*:\s*([^|,]+)", details, flags=re.IGNORECASE)
        return match.group(1).strip() if match else None

    items = [
        {
            "id": log.id,
            "title": log.action,
            "action": log.action,
            "user": log.user,
            "email": log.user if "@" in (log.user or "") else detail_value(log.details, "email"),
            "role": detail_value(log.details, "role") or detail_value(log.details, "portal"),
            "branch": detail_value(log.details, "branch") or detail_value(log.details, "branch_name"),
            "ip": detail_value(log.details, "ip") or "not recorded",
            "details": log.details,
            "type": log.type,
            "created_at": log.created_at.isoformat() if log.created_at else None,
            "integrity_valid": verify_record_integrity(log),
        }
        for log in logs
    ]
    return {
        "items": items,
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
    }
