"""
Window Staff Self-Service Account Management
Allows window staff (account_scope='queue_window') to manage their own account only.
Permitted: view profile, edit profile.
Forbidden: viewing or modifying any other account.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from database.models import ActivityLog, BranchStaff, CitizenUser, get_db
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
from auth import get_current_branch_staff, require_window_staff, verify_account_password
from services.email_service import send_account_change_notification_email
from utils.field_crypto import get_decrypted_or_raw
from utils.field_crypto import find_citizen_by_contact_number
from utils.security_validation import (
    ensure_email_is_unique,
    normalize_citizen_full_name,
    normalize_email,
    normalize_ph_contact_number,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class UpdateProfileRequest(BaseModel):
    full_name: str
    email: str
    contact_number: str
    current_password: str


class ContactNumberCheckRequest(BaseModel):
    contact_number: str
    exclude_staff_id: Optional[int] = None


def get_client_ip(request) -> str:
    """Extract real client IP, respecting reverse-proxy / CDN headers."""
    if request is None:
        return "unknown"
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip:
        return cf_ip.strip()
    true_client = request.headers.get("true-client-ip")
    if true_client:
        return true_client.strip()
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    forwarded_rfc = request.headers.get("forwarded")
    if forwarded_rfc:
        match = forwarded_rfc.split("for=")
        if len(match) > 1:
            ip_candidate = match[1].split(";")[0].split(",")[0].strip().strip('"')
            if ip_candidate:
                return ip_candidate
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _log(db: Session, action: str, username: str, details: str, *, staff=None, request=None):
    meta_parts = []
    if staff is not None:
        role = getattr(staff, "role", None) or "branch_staff"
        meta_parts.append(f"role: {role}")
        branch_obj = getattr(staff, "branch", None)
        branch_name = get_decrypted_or_raw(branch_obj, "name") if branch_obj else f"Branch {staff.branch_id}"
        meta_parts.append(f"branch: {branch_name}")
    else:
        meta_parts.append("role: branch_staff")
    ip = get_client_ip(request) if request else "unknown"
    meta_parts.append(f"ip: {ip}")
    separator = " | "
    full_details = f"{' | '.join(meta_parts)} | {details}"
    db.add(ActivityLog(action=action, user=username, details=full_details, type="branch_account"))
    db.commit()


DUPLICATE_CONTACT_NUMBER_MESSAGE = "This contact number is unavailable. Please enter a different contact number."


def _normalize_contact_safe(value: str) -> str:
    """Normalize to +63XXXXXXXXXX; return empty string if invalid."""
    try:
        return normalize_ph_contact_number(value)
    except Exception:
        return ""


def _ensure_branch_staff_contact_is_unique(db: Session, contact_number: str, exclude_staff_id: Optional[int] = None):
    canonical = _normalize_contact_safe(contact_number)
    if not canonical:
        return
    candidates = db.query(BranchStaff)
    if exclude_staff_id is not None:
        candidates = candidates.filter(BranchStaff.id != exclude_staff_id)
    for staff in candidates.all():
        if _normalize_contact_safe(staff.contact_number or "") == canonical:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=DUPLICATE_CONTACT_NUMBER_MESSAGE)
    citizen_match = find_citizen_by_contact_number(db, CitizenUser, canonical)
    if citizen_match:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=DUPLICATE_CONTACT_NUMBER_MESSAGE)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/check-contact")
@limiter.limit("20/minute")
async def check_branch_staff_contact_availability(request: Request, payload: ContactNumberCheckRequest, db: Session = Depends(get_db)):
    canonical = _normalize_contact_safe(payload.contact_number or "")
    if not canonical:
        return {"available": True}
    try:
        _ensure_branch_staff_contact_is_unique(db, canonical, exclude_staff_id=payload.exclude_staff_id)
        return {"available": True}
    except HTTPException:
        return {"available": False, "detail": DUPLICATE_CONTACT_NUMBER_MESSAGE}


@router.get("/profile")
async def get_own_profile(
    current_staff: BranchStaff = Depends(get_current_branch_staff),
):
    """Return the authenticated window staff's own profile."""
    require_window_staff(current_staff)
    return {
        "id": current_staff.id,
        "username": current_staff.username,
        "full_name": current_staff.full_name,
        "email": current_staff.email,
        "contact_number": current_staff.contact_number or "",
        "role": current_staff.role,
        "account_scope": current_staff.account_scope,
        "service_window": current_staff.service_window,
        "branch_id": current_staff.branch_id,
        "status": current_staff.status,
    }


@router.put("/profile")
async def update_own_profile(
    request: Request,
    payload: UpdateProfileRequest,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    """Update the authenticated window staff's own profile (full_name, email, contact_number)."""
    require_window_staff(current_staff)
    verify_account_password(payload.current_password, current_staff.hashed_password, detail="Incorrect password.")

    if not payload.contact_number or not payload.contact_number.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Contact number is required.",
        )

    normalized_full_name = normalize_citizen_full_name(payload.full_name)
    normalized_email = normalize_email(payload.email.strip().lower())

    normalized_contact = _normalize_contact_safe(payload.contact_number)
    if not normalized_contact:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Contact number must begin with 9 and contain exactly 10 digits.",
        )
    ensure_email_is_unique(db, normalized_email, exclude_branch_staff_id=current_staff.id)
    _ensure_branch_staff_contact_is_unique(db, normalized_contact, exclude_staff_id=current_staff.id)

    changed_fields = []
    if normalized_full_name != (current_staff.full_name or ""):
        changed_fields.append("Full Name")
    if normalized_email != (current_staff.email or ""):
        changed_fields.append("Email Address")
    if normalized_contact != _normalize_contact_safe(current_staff.contact_number or ""):
        changed_fields.append("Contact Number")

    current_staff.full_name = normalized_full_name
    current_staff.email = normalized_email
    current_staff.contact_number = normalized_contact
    db.commit()

    _log(db, "Window Staff Profile Updated", current_staff.username, "Profile information updated", staff=current_staff, request=request)

    email_result = send_account_change_notification_email(
        recipient_email=normalized_email,
        display_name=normalized_full_name or current_staff.username,
        account_type="branch_staff",
        change_summary="Your WARDS account profile information was updated.",
        changed_fields=changed_fields or ["Profile Information"],
        subject="WARDS Security Notification: Profile Information Updated",
    )
    if email_result.get("sent"):
        _log(db, "Window Staff Profile Updated", current_staff.username, "Security notification email sent after profile update.", staff=current_staff, request=request)
    else:
        logger.warning("Profile update notification email not sent for %s: %s", current_staff.username, email_result.get("message"))

    return {"message": "Profile updated successfully.", "email_sent": email_result.get("sent", False)}


