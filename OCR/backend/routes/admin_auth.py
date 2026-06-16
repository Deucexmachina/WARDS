"""
Consolidated OCR staff/admin authentication and admin routes.
Replaces auth/simple_auth.py, routes/auth_simple.py, and routes/admin_simple.py.
"""

import os
import secrets
import time
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.config import SessionLocal, get_db
from database.models import BranchStaffAccount
from services.branch_staff_service import (
    build_otpauth_uri,
    get_branch_staff_account_for_login,
    serialize_branch_account,
    sync_branch_staff_accounts,
    verify_password,
    verify_totp_code,
)
from services.queue_service import queue_service
from services.service_service import service_service
from services.branch_staff_service import (
    MAX_WINDOWS,
    get_active_window_count,
    get_window_catalog,
)

# ---------------------------------------------------------------------------
# Environment-based admin credentials (replaces hardcoded USERS dict)
# ---------------------------------------------------------------------------
_ADMIN_USERNAME = os.getenv("OCR_ADMIN_USERNAME")
_ADMIN_PASSWORD = os.getenv("OCR_ADMIN_PASSWORD")


def _load_admin_user() -> Optional[dict]:
    """Load admin user from environment; return None if not configured."""
    password = _ADMIN_PASSWORD
    if not password:
        return None
    return {
        "username": _ADMIN_USERNAME,
        "password": password,
        "full_name": "System Administrator",
        "role": "admin",
        "portal_access": "full_admin",
    }


# ---------------------------------------------------------------------------
# In-memory stores (preserved from simple_auth; still wiped on restart)
# ---------------------------------------------------------------------------
sessions: dict[str, dict] = {}
mfa_challenges: dict[str, dict] = {}

# Simple in-memory rate limiting: {normalized_username: [timestamp, ...]}
_login_attempts: dict[str, list[float]] = {}
RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_MAX_ATTEMPTS = 10


def _open_db():
    return SessionLocal()


def _admin_user_payload(user: dict) -> dict:
    return {
        "username": user["username"],
        "full_name": user["full_name"],
        "role": user["role"],
        "portal_access": user["portal_access"],
    }


def _branch_user_payload(account) -> dict:
    return {
        "id": account.id,
        "username": account.username,
        "full_name": account.window_label,
        "role": "branch_staff",
        "portal_access": "queue_only",
        "service_id": account.service_id,
        "window_code": account.window_code,
        "window_label": account.window_label,
        "email": account.email,
    }


def _check_rate_limit(username: str) -> bool:
    """Return True if the user is allowed to attempt login."""
    normalized = username.strip().lower()
    now = time.time()
    attempts = _login_attempts.get(normalized, [])
    # Keep only attempts within the window
    attempts = [t for t in attempts if now - t < RATE_LIMIT_WINDOW_SECONDS]
    if len(attempts) >= RATE_LIMIT_MAX_ATTEMPTS:
        _login_attempts[normalized] = attempts
        return False
    attempts.append(now)
    _login_attempts[normalized] = attempts
    return True


def verify_credentials(username: str, password: str) -> Optional[dict]:
    normalized_username = username.strip()

    if not _check_rate_limit(normalized_username):
        return {"rate_limited": True}

    # Admin via environment credentials
    admin_user = _load_admin_user()
    if admin_user and normalized_username.lower() == admin_user["username"].lower():
        # Use constant-time comparison to avoid timing attacks
        import hmac

        if hmac.compare_digest(admin_user["password"].encode(), password.encode()):
            return {
                "auth_type": "admin",
                "user": _admin_user_payload(admin_user),
            }

    # Branch staff via database
    db = _open_db()
    try:
        account = get_branch_staff_account_for_login(db, normalized_username)
        if account and verify_password(password, account.password_hash):
            return {
                "auth_type": "branch_staff",
                "user": _branch_user_payload(account),
                "challenge_token": create_mfa_challenge(account),
                "mfa_setup_required": not account.mfa_enabled,
                "mfa_secret": account.mfa_secret,
                "otpauth_uri": build_otpauth_uri(account.username, account.mfa_secret),
            }
    finally:
        db.close()

    return None


def create_mfa_challenge(account) -> str:
    token = f"mfa_{secrets.token_urlsafe(32)}"
    mfa_challenges[token] = {
        "account_id": account.id,
        "username": account.username,
        "expires_at": datetime.now() + timedelta(minutes=5),
    }
    return token


def create_session(user: dict) -> str:
    token = f"session_{secrets.token_urlsafe(32)}"
    sessions[token] = {
        "user": user,
        "created_at": datetime.now(),
        "expires_at": datetime.now() + timedelta(hours=8),
    }
    return token


def complete_mfa_login(challenge_token: str, otp_code: str) -> Optional[dict]:
    challenge = mfa_challenges.get(challenge_token)
    if not challenge:
        return None

    if datetime.now() > challenge["expires_at"]:
        del mfa_challenges[challenge_token]
        return None

    db = _open_db()
    try:
        account = get_branch_staff_account_for_login(db, challenge["username"])
        if not account or account.id != challenge["account_id"]:
            return None

        if not verify_totp_code(account.mfa_secret, otp_code):
            return False

        account.mfa_enabled = True
        account.last_login = datetime.utcnow()
        db.commit()

        del mfa_challenges[challenge_token]
        return _branch_user_payload(account)
    finally:
        db.close()


def verify_session(token: str) -> Optional[dict]:
    session = sessions.get(token)
    if not session:
        return None

    if datetime.now() > session["expires_at"]:
        del sessions[token]
        return None

    user = session["user"]
    if user["role"] == "admin":
        admin = _load_admin_user()
        if admin and admin["username"].lower() == user["username"].lower():
            return _admin_user_payload(admin)
        return None

    db = _open_db()
    try:
        account = get_branch_staff_account_for_login(db, user["username"])
        if account:
            return _branch_user_payload(account)
        return None
    finally:
        db.close()


def delete_session(token: str):
    if token in sessions:
        del sessions[token]


def list_active_branch_accounts() -> list[dict]:
    db = _open_db()
    try:
        accounts = (
            db.query(BranchStaffAccount)
            .filter_by(is_active=True)
            .order_by(BranchStaffAccount.service_id.asc())
            .all()
        )
        return [serialize_branch_account(account) for account in accounts]
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Auth router (mounted at /api/auth)
# ---------------------------------------------------------------------------
auth_router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: Optional[str] = None
    token_type: Optional[str] = None
    user: dict
    mfa_required: bool = False
    mfa_setup_required: bool = False
    challenge_token: Optional[str] = None
    mfa_secret: Optional[str] = None
    otpauth_uri: Optional[str] = None


class MFAVerifyRequest(BaseModel):
    challenge_token: str
    otp_code: str


@auth_router.post("/login", response_model=LoginResponse)
async def login(request: Request, payload: LoginRequest):
    auth_result = verify_credentials(payload.username, payload.password)

    if auth_result and auth_result.get("rate_limited"):
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Please wait a minute and try again.",
        )

    if not auth_result:
        raise HTTPException(
            status_code=401,
            detail="Incorrect username or password",
        )

    if auth_result["auth_type"] == "branch_staff":
        return {
            "user": auth_result["user"],
            "mfa_required": True,
            "mfa_setup_required": auth_result["mfa_setup_required"],
            "challenge_token": auth_result["challenge_token"],
            "mfa_secret": auth_result["mfa_secret"] if auth_result["mfa_setup_required"] else None,
            "otpauth_uri": auth_result["otpauth_uri"] if auth_result["mfa_setup_required"] else None,
        }

    user = auth_result["user"]
    token = create_session(user)

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": user,
    }


@auth_router.post("/verify-mfa", response_model=LoginResponse)
async def verify_mfa(payload: MFAVerifyRequest):
    user = complete_mfa_login(payload.challenge_token, payload.otp_code)

    if user is False:
        raise HTTPException(status_code=401, detail="Invalid OTP code")

    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired MFA challenge")

    token = create_session(user)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": user,
    }


@auth_router.post("/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.replace("Bearer ", "")
        delete_session(token)

    return {"message": "Successfully logged out"}


@auth_router.get("/verify")
async def verify_token(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = authorization.replace("Bearer ", "")
    user = verify_session(token)

    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return {
        "valid": True,
        "user": user,
    }


@auth_router.get("/me")
async def get_current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = authorization.replace("Bearer ", "")
    user = verify_session(token)

    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return user


# ---------------------------------------------------------------------------
# Admin router (mounted at /api/admin)
# ---------------------------------------------------------------------------
admin_router = APIRouter()


class QueueActionRequest(BaseModel):
    queue_number: str
    notes: str = None


class BranchStaffAssignment(BaseModel):
    window_code: str
    email: str


class BranchStaffSyncRequest(BaseModel):
    window_count: int
    assignments: list[BranchStaffAssignment]


def _get_current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = authorization.replace("Bearer ", "")
    user = verify_session(token)

    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return user


def _ensure_admin_user(user: dict):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access is required")


def _get_user_service_scope(user: dict) -> Optional[int]:
    if user.get("role") == "branch_staff":
        return user.get("service_id")
    return None


@admin_router.get("/dashboard/stats")
async def get_dashboard_stats(authorization: Optional[str] = Header(None)):
    user = _get_current_user(authorization)

    total_waiting = 0
    total_serving = 0
    total_completed_today = 0
    total_no_show_today = 0
    scoped_service_id = _get_user_service_scope(user)

    today = datetime.now().date()

    for service_id, queue_list in queue_service.queues.items():
        if scoped_service_id and service_id != scoped_service_id:
            continue
        for entry in queue_list:
            if entry["status"] == "waiting":
                total_waiting += 1
            elif entry["status"] == "serving":
                total_serving += 1
            elif entry["status"] == "completed":
                completed_at = entry.get("completed_at")
                if completed_at and completed_at.date() == today:
                    total_completed_today += 1
            elif entry["status"] == "no_show":
                completed_at = entry.get("completed_at")
                if completed_at and completed_at.date() == today:
                    total_no_show_today += 1

    return {
        "waiting": total_waiting,
        "serving": total_serving,
        "completed_today": total_completed_today,
        "no_show_today": total_no_show_today,
    }


@admin_router.get("/queue/all")
async def get_all_queues(authorization: Optional[str] = Header(None)):
    user = _get_current_user(authorization)

    services = service_service.get_all()
    scoped_service_id = _get_user_service_scope(user)
    result = []

    for service in services:
        if scoped_service_id and service.id != scoped_service_id:
            continue
        queue_list = queue_service.queues.get(service.id, [])

        serving = None
        waiting = []

        for entry in queue_list:
            if entry["status"] == "serving":
                serving = {
                    "id": entry["queue_number"],
                    "queue_number": entry["queue_number"],
                    "client_name": entry["client_name"],
                    "priority_tag": entry.get("priority_tag"),
                    "called_at": entry.get("created_at"),
                }
            elif entry["status"] == "waiting":
                waiting.append({
                    "id": entry["queue_number"],
                    "queue_number": entry["queue_number"],
                    "client_name": entry["client_name"],
                    "priority_tag": entry.get("priority_tag"),
                    "created_at": entry.get("created_at"),
                })

        result.append({
            "service_id": service.id,
            "service_name": service.name,
            "counter": service.counter,
            "current_serving": serving,
            "waiting": waiting,
            "waiting_count": len(waiting),
        })

    return result


@admin_router.post("/queue/call-next/{service_id}")
async def call_next_client(service_id: int, authorization: Optional[str] = Header(None)):
    user = _get_current_user(authorization)
    scoped_service_id = _get_user_service_scope(user)
    if scoped_service_id and scoped_service_id != service_id:
        raise HTTPException(status_code=403, detail="This account can only manage its assigned queue window")

    queue_list = queue_service.queues.get(service_id, [])

    # Complete any currently serving
    for entry in queue_list:
        if entry["status"] == "serving":
            entry["status"] = "completed"
            entry["completed_at"] = datetime.now()

    # Find next waiting client
    next_client = None
    for entry in queue_list:
        if entry["status"] == "waiting":
            next_client = entry
            break

    if not next_client:
        return {"message": "No clients waiting", "queue_number": None}

    next_client["status"] = "serving"
    next_client["called_at"] = datetime.now()
    queue_service.current_serving[service_id] = next_client["queue_number"]

    return {
        "message": "Client called",
        "queue_number": next_client["queue_number"],
        "client_name": next_client["client_name"],
    }


@admin_router.post("/queue/complete")
async def complete_client(request: QueueActionRequest, authorization: Optional[str] = Header(None)):
    user = _get_current_user(authorization)
    scoped_service_id = _get_user_service_scope(user)

    for service_id, queue_list in queue_service.queues.items():
        if scoped_service_id and service_id != scoped_service_id:
            continue
        for entry in queue_list:
            if entry["queue_number"] == request.queue_number:
                entry["status"] = "completed"
                entry["completed_at"] = datetime.now()
                if request.notes:
                    entry["notes"] = request.notes

                if queue_service.current_serving.get(service_id) == request.queue_number:
                    queue_service.current_serving[service_id] = None

                return {"message": "Client marked as completed"}

    raise HTTPException(status_code=404, detail="Queue entry not found")


@admin_router.post("/queue/no-show")
async def mark_no_show(request: QueueActionRequest, authorization: Optional[str] = Header(None)):
    user = _get_current_user(authorization)
    scoped_service_id = _get_user_service_scope(user)

    for service_id, queue_list in queue_service.queues.items():
        if scoped_service_id and service_id != scoped_service_id:
            continue
        for entry in queue_list:
            if entry["queue_number"] == request.queue_number:
                entry["status"] = "no_show"
                entry["completed_at"] = datetime.now()
                if request.notes:
                    entry["notes"] = request.notes

                if queue_service.current_serving.get(service_id) == request.queue_number:
                    queue_service.current_serving[service_id] = None

                return {"message": "Client marked as no-show"}

    raise HTTPException(status_code=404, detail="Queue entry not found")


@admin_router.post("/queue/skip")
async def skip_client(request: QueueActionRequest, authorization: Optional[str] = Header(None)):
    user = _get_current_user(authorization)
    scoped_service_id = _get_user_service_scope(user)

    for service_id, queue_list in queue_service.queues.items():
        if scoped_service_id and service_id != scoped_service_id:
            continue
        for entry in queue_list:
            if entry["queue_number"] == request.queue_number:
                if entry["status"] == "serving":
                    entry["status"] = "waiting"
                    entry["called_at"] = None
                    entry["created_at"] = datetime.now()

                    if queue_service.current_serving.get(service_id) == request.queue_number:
                        queue_service.current_serving[service_id] = None

                if request.notes:
                    entry["notes"] = request.notes

                return {"message": "Client skipped and moved to end of queue"}

    raise HTTPException(status_code=404, detail="Queue entry not found")


@admin_router.post("/queue/reset/{service_id}")
async def reset_queue(service_id: int, authorization: Optional[str] = Header(None)):
    user = _get_current_user(authorization)
    _ensure_admin_user(user)

    if service_id not in queue_service.queues:
        raise HTTPException(status_code=404, detail="Service not found")

    queue_service.queues[service_id] = []
    queue_service.current_serving[service_id] = None
    queue_service.queue_counters[service_id] = 0

    return {
        "message": f"Queue reset successfully for service {service_id}",
        "service_id": service_id,
    }


@admin_router.get("/activity-log")
async def get_activity_log(authorization: Optional[str] = Header(None)):
    user = _get_current_user(authorization)
    _ensure_admin_user(user)

    return []


@admin_router.get("/account-management")
async def get_account_management(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    user = _get_current_user(authorization)
    _ensure_admin_user(user)

    active_accounts = (
        db.query(BranchStaffAccount)
        .filter(BranchStaffAccount.is_active == True)
        .order_by(BranchStaffAccount.service_id.asc())
        .all()
    )

    return {
        "window_count": get_active_window_count(db),
        "max_windows": MAX_WINDOWS,
        "available_windows": get_window_catalog(),
        "accounts": [serialize_branch_account(account) for account in active_accounts],
    }


@admin_router.post("/account-management/sync")
async def sync_account_management(
    request: BranchStaffSyncRequest,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    user = _get_current_user(authorization)
    _ensure_admin_user(user)

    try:
        return sync_branch_staff_accounts(
            db=db,
            window_count=request.window_count,
            assignments=[item.model_dump() for item in request.assignments],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


__all__ = ["auth_router", "admin_router", "verify_session"]
