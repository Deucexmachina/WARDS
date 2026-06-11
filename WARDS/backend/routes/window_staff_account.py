"""
Window Staff Self-Service Account Management
Allows window staff (account_scope='queue_window') to manage their own account only.
Permitted: view profile, edit profile, change password, reset MFA.
Forbidden: viewing or modifying any other account.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, status
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy.orm import Session

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
    current_password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    confirm_new_password: str


class ResetMFARequest(BaseModel):
    current_password: str


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

    normalized_full_name = normalize_citizen_full_name(payload.full_name)
    normalized_email = normalize_email(payload.email.strip().lower())

    ensure_email_is_unique(db, normalized_email, exclude_branch_staff_id=current_staff.id)

    current_staff.full_name = normalized_full_name
    current_staff.email = normalized_email
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
    """Reset the authenticated window staff's own MFA configuration."""
    _require_window_staff(current_staff)
    _verify_own_password(current_staff, payload.current_password)

    _delete_mfa_secret(db, current_staff.username)

    client_ip = request.client.host if request.client else "unknown"
    _log(db, "Window Staff MFA Reset", current_staff.username, f"IP: {client_ip}")

    return {"message": "MFA reset successfully. You will need to set up MFA again on your next login."}
