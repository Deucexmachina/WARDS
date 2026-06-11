"""
Window Staff Self-Service Account Management
Allows window staff (account_scope='queue_window') to manage their own account only.
Permitted: view profile, edit profile, change password, reset MFA, setup MFA in-app.
Forbidden: viewing or modifying any other account.
"""
import base64
import io

import pyotp
import qrcode
from fastapi import APIRouter, Depends, HTTPException, Request, status
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from database.models import ActivityLog, BranchStaff, MFASecret, get_db
from middleware.branch_auth import get_current_branch_staff
from utils.field_crypto import find_mfa_secret_record
from utils.security_validation import (
    ensure_email_is_unique,
    normalize_citizen_full_name,
    normalize_email,
    validate_strong_password,
)

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


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

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

    ensure_email_is_unique(db, normalized_email, exclude_branch_staff_id=current_staff.id)

    current_staff.full_name = normalized_full_name
    current_staff.email = normalized_email
    current_staff.contact_number = payload.contact_number.strip()
    db.commit()

    client_ip = request.client.host if request.client else "unknown"
    _log(db, "Window Staff Profile Updated", current_staff.username, f"IP: {client_ip}")

    return {"message": "Profile updated successfully."}


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

    return {"message": "Password changed successfully."}


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

    return {"message": "MFA configured successfully."}
