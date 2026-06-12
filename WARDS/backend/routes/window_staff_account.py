"""
Window Staff Self-Service Account Management
Allows window staff (account_scope='queue_window') to manage their own account only.
Permitted: view profile, edit profile, change password, reset MFA, setup MFA in-app.
Forbidden: viewing or modifying any other account.
"""
import base64
import io
import logging

import pyotp
import qrcode
from fastapi import APIRouter, Depends, HTTPException, Request, status
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from database.models import ActivityLog, BranchStaff, MFASecret, get_db
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
from middleware.branch_auth import get_current_branch_staff
from services.email_service import send_account_change_notification_email
from utils.field_crypto import find_mfa_secret_record
from utils.security_validation import (
    ensure_email_is_unique,
    normalize_citizen_full_name,
    normalize_email,
    normalize_ph_contact_number,
    validate_strong_password,
)

logger = logging.getLogger(__name__)

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


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


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    confirm_new_password: str


class ResetMFARequest(BaseModel):
    current_password: str


class VerifyMFARequest(BaseModel):
    totp_code: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _require_window_staff(current_staff: BranchStaff) -> BranchStaff:
    """Restrict endpoint to window staff (queue_window scope) only."""
    if current_staff.account_scope != "queue_window":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint is only available to window staff accounts.",
        )
    return current_staff


def _verify_own_password(staff: BranchStaff, password: str):
    if not password or not pwd_context.verify(password, staff.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password.",
        )


def _log(db: Session, action: str, username: str, details: str):
    db.add(ActivityLog(action=action, user=username, details=details, type="branch_account"))
    db.commit()


def _delete_mfa_secret(db: Session, username: str):
    """Remove the branch MFA secret for the given username."""
    mfa = find_mfa_secret_record(db, MFASecret, "branch", username)
    if mfa:
        db.delete(mfa)
        db.commit()


def _get_mfa_secret(db: Session, username: str) -> Optional[str]:
    from utils.field_crypto import get_decrypted_or_raw
    mfa = find_mfa_secret_record(db, MFASecret, "branch", username, enabled_only=True)
    return (get_decrypted_or_raw(mfa, "secret") or mfa.secret) if mfa else None


def _save_mfa_secret(db: Session, username: str, secret: str):
    from utils.field_crypto import apply_mfa_secret_security
    mfa = find_mfa_secret_record(db, MFASecret, "branch", username)
    if mfa:
        mfa.portal = "branch"
        mfa.username = username
        mfa.secret = secret
        mfa.enabled = True
        apply_mfa_secret_security(mfa)
    else:
        mfa = MFASecret(portal="branch", username=username, secret=secret, enabled=True)
        apply_mfa_secret_security(mfa)
    db.add(mfa)
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
    _require_window_staff(current_staff)
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
    _require_window_staff(current_staff)
    _verify_own_password(current_staff, payload.current_password)

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

    client_ip = request.client.host if request.client else "unknown"
    _log(db, "Window Staff Profile Updated", current_staff.username, f"IP: {client_ip}")

    email_result = send_account_change_notification_email(
        recipient_email=normalized_email,
        display_name=normalized_full_name or current_staff.username,
        account_type="branch_staff",
        change_summary="Your WARDS account profile information was updated.",
        changed_fields=changed_fields or ["Profile Information"],
        subject="WARDS Security Notification: Profile Information Updated",
    )
    if email_result.get("sent"):
        _log(db, "Window Staff Profile Updated", current_staff.username, "Security notification email sent after profile update.")
    else:
        logger.warning("Profile update notification email not sent for %s: %s", current_staff.username, email_result.get("message"))

    return {"message": "Profile updated successfully.", "email_sent": email_result.get("sent", False)}


@router.put("/password")
async def change_own_password(
    request: Request,
    payload: ChangePasswordRequest,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    """Change the authenticated window staff's own password."""
    _require_window_staff(current_staff)
    _verify_own_password(current_staff, payload.current_password)

    if payload.new_password != payload.confirm_new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The new passwords do not match.",
        )

    validate_strong_password(payload.new_password)

    current_staff.hashed_password = pwd_context.hash(payload.new_password)
    db.commit()

    client_ip = request.client.host if request.client else "unknown"
    _log(db, "Window Staff Password Changed", current_staff.username, f"IP: {client_ip}")

    email_result = send_account_change_notification_email(
        recipient_email=current_staff.email,
        display_name=current_staff.full_name or current_staff.username,
        account_type="branch_staff",
        change_summary="Your WARDS account password was successfully changed.",
        changed_fields=["Password"],
        subject="WARDS Security Notification: Password Changed",
    )
    if email_result.get("sent"):
        _log(db, "Window Staff Password Changed", current_staff.username, "Security notification email sent after password change.")
    else:
        logger.warning("Password change notification email not sent for %s: %s", current_staff.username, email_result.get("message"))

    return {"message": "Password changed successfully.", "email_sent": email_result.get("sent", False)}


@router.post("/reset-mfa")
async def reset_own_mfa(
    request: Request,
    payload: ResetMFARequest,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    """Reset the authenticated window staff's MFA and return a new QR code for in-app setup."""
    _require_window_staff(current_staff)
    _verify_own_password(current_staff, payload.current_password)

    totp_secret = pyotp.random_base32()
    _save_mfa_secret(db, current_staff.username, totp_secret)

    totp_uri = pyotp.totp.TOTP(totp_secret).provisioning_uri(
        name=current_staff.username,
        issuer_name="WARDS Branch Portal",
    )

    qr = qrcode.QRCode(version=1, box_size=10, border=5)
    qr.add_data(totp_uri)
    qr.make(fit=True)

    img = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    qr_code_base64 = base64.b64encode(buffer.getvalue()).decode()

    client_ip = request.client.host if request.client else "unknown"
    _log(db, "Window Staff MFA Reset", current_staff.username, f"IP: {client_ip}")

    return {
        "message": "MFA reset. Please scan the QR code to complete setup.",
        "qr_code": f"data:image/png;base64,{qr_code_base64}",
        "manual_entry_key": totp_secret,
    }


@router.post("/verify-mfa")
async def verify_own_mfa(
    request: Request,
    payload: VerifyMFARequest,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    """Verify the TOTP code after in-app MFA setup to confirm the new configuration."""
    _require_window_staff(current_staff)

    totp_secret = _get_mfa_secret(db, current_staff.username)
    if not totp_secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No pending MFA setup found. Please reset MFA first.",
        )

    totp = pyotp.TOTP(totp_secret)
    if not totp.verify(payload.totp_code, valid_window=1):
        client_ip = request.client.host if request.client else "unknown"
        _log(db, "Window Staff MFA Verify Failed", current_staff.username, f"IP: {client_ip}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid verification code.",
        )

    client_ip = request.client.host if request.client else "unknown"
    _log(db, "Window Staff MFA Configured", current_staff.username, f"IP: {client_ip}")

    email_result = send_account_change_notification_email(
        recipient_email=current_staff.email,
        display_name=current_staff.full_name or current_staff.username,
        account_type="branch_staff",
        change_summary="Your WARDS account Multi-Factor Authentication (MFA) settings were successfully updated.",
        changed_fields=["Multi-Factor Authentication"],
        subject="WARDS Security Notification: MFA Settings Updated",
    )
    if email_result.get("sent"):
        _log(db, "Window Staff MFA Configured", current_staff.username, "Security notification email sent after MFA reset.")
    else:
        logger.warning("MFA reset notification email not sent for %s: %s", current_staff.username, email_result.get("message"))

    return {"message": "MFA configured successfully.", "email_sent": email_result.get("sent", False)}
