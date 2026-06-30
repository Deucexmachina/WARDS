from datetime import datetime, timedelta

import re

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session
from typing import Optional

from database.models import ActivityLog, Branch, BranchStaff, Admin, CitizenUser, get_db
from sqlalchemy import func
from utils.field_crypto import find_citizen_by_email, get_decrypted_or_raw
from auth import get_current_admin_user, get_current_branch_staff
from utils.log_integrity import verify_record_integrity
from utils.rbac import require_permission

router = APIRouter()
security = HTTPBearer(auto_error=False)


async def get_logs_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> Admin | BranchStaff:
    try:
        return await get_current_admin_user(request, credentials, db)
    except HTTPException as admin_exc:
        try:
            staff = await get_current_branch_staff(request, credentials, db)
        except HTTPException as branch_exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required. Please log in again.",
            ) from branch_exc
        if staff.role != "branch_admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only branch admin accounts can access branch activity logs.",
            )
        return staff


def _get_branch_name_for_user(current_user, db: Session) -> Optional[str]:
    """Return the branch name for a BranchStaff user, or None for admin users."""
    if isinstance(current_user, BranchStaff) and current_user.branch_id:
        branch = db.query(Branch).filter(Branch.id == current_user.branch_id).first()
        if not branch:
            return None
        return get_decrypted_or_raw(branch, "name")
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
    current_user: Admin | BranchStaff = Depends(get_logs_current_user),
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
    current_user: Admin | BranchStaff = Depends(get_logs_current_user),
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

    try:
        earliest_record = db.query(func.min(ActivityLog.created_at)).scalar()
    except Exception:
        earliest_record = None
    earliest_record_date = earliest_record.date().isoformat() if earliest_record else None

    def detail_value(details: str | None, label: str) -> str | None:
        if not details:
            return None
        match = re.search(rf"{re.escape(label)}\s*:\s*([^|,]+)", details, flags=re.IGNORECASE)
        return match.group(1).strip() if match else None

    # Pre-fetch roles for all unique users in this batch to avoid N+1 queries
    unique_users = {log.user for log in logs if log.user}
    usernames = {u for u in unique_users if "@" not in u}
    emails = {u for u in unique_users if "@" in u}

    admins_map: dict[str, str] = {}
    staff_map: dict[str, str] = {}
    citizens_map: dict[str, str] = {}
    if usernames:
        admins_map = {a.username: a.role for a in db.query(Admin).filter(Admin.username.in_(usernames)).all()}
        staff_map = {s.username: s.role for s in db.query(BranchStaff).filter(BranchStaff.username.in_(usernames)).all()}
    if emails:
        for email in emails:
            citizen = find_citizen_by_email(db, CitizenUser, email)
            if citizen and citizen.role:
                citizens_map[email] = citizen.role

    def _resolve_role(user_identifier: str) -> str:
        if not user_identifier:
            return "unknown"
        if user_identifier.lower() == "system":
            return "system"
        role = admins_map.get(user_identifier)
        if role:
            return role
        role = staff_map.get(user_identifier)
        if role:
            return role
        if "@" in user_identifier:
            role = citizens_map.get(user_identifier)
            if role:
                return role
            return "citizen"
        return "unknown"

    def _extract_ip(details: str | None) -> str | None:
        if not details:
            return None
        # Try standard ip: prefix first
        match = re.search(r"ip\s*:\s*([^|,;\s]+)", details, flags=re.IGNORECASE)
        if match:
            candidate = match.group(1).strip()
            if _is_ip_like(candidate):
                return candidate
        # Fallback: look for explicit IP labels
        match = re.search(r"(?:IP|client ip|remote ip)\s*[:=]\s*([^|,;\s]+)", details, flags=re.IGNORECASE)
        if match:
            candidate = match.group(1).strip()
            if _is_ip_like(candidate):
                return candidate
        # Broad fallback: find any IPv4-like pattern in the text
        match = re.search(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", details)
        if match:
            return match.group(0)
        return None

    items = [
        {
            "id": log.id,
            "title": log.action,
            "action": log.action,
            "user": log.user,
            "email": log.user if "@" in (log.user or "") else detail_value(log.details, "email"),
            "role": detail_value(log.details, "role") or detail_value(log.details, "portal") or _resolve_role(log.user) or "unknown",
            "branch": detail_value(log.details, "branch") or detail_value(log.details, "branch_name"),
            "ip": _extract_ip(log.details) or "unknown",
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
        "earliest_record_date": earliest_record_date,
    }


def _is_ip_like(value: str) -> bool:
    """Quick heuristic to check if a string looks like an IP address."""
    if not value or value.lower() in {"unknown", "none", "not recorded", "n/a"}:
        return False
    return bool(re.match(r"^(?:\d{1,3}\.){3}\d{1,3}$", value))
