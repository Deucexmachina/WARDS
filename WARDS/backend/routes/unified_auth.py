import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple
import json
import logging
import os
import random
import secrets
import string
import time
from pathlib import Path

import pyotp
import requests
import base64
import io
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, JSONResponse
from jose import JWTError, jwt
from pydantic import BaseModel, EmailStr
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from database.models import ActivityLog, Admin, BranchStaff, CitizenUser, EmailOTP, Invite, MFASecret, get_db
from utils.redis_client import get_redis_client
from services.email_service import (
    _safe_html,
    send_account_change_notification_email,
    send_citizen_verification_email,
    send_login_notification_email,
    send_password_reset_email,
)
from utils.field_crypto import (
    apply_citizen_user_security,
    apply_email_otp_security,
    find_citizen_by_contact_number,
    find_citizen_by_email,
    find_invite_by_token,
    find_mfa_secret_record,
    get_decrypted_or_raw,
    hash_optional_value,
    serialize_citizen_user,
)
from utils.security_validation import normalize_email
from utils.system_settings import get_setting_value
from auth import (
    ALGORITHM,
    PASSWORD_RESET_SECRET_KEY,
    PORTAL_CONFIG,
    create_access_token,
    create_refresh_token,
    decode_token,
    get_portal_config,
    get_branch_assigned_window_number,
    get_branch_dashboard_url,
    get_branch_window_label,
    get_session_timeout_minutes,
    slugify_branch_name,
    pwd_context,
    validate_password_strength,
    check_mfa_recovery_confirm_rate_limit,
    check_mfa_recovery_rate_limit,
    find_active_mfa_recovery_otp,
    generate_mfa_payload,
    get_mfa_secret,
    get_mfa_secret_raw,
    hash_mfa_recovery_code,
    issue_mfa_recovery_otp,
    save_mfa_secret,
    decode_active_account_from_bearer_token,
    get_current_admin_user,
    get_current_branch_staff,
    get_current_user,
    require_window_staff,
    revoke_token,
    verify_account_password,
    verify_password,
    hash_password,
    delete_mfa_secret,
)

router = APIRouter()

# Rate limiting configuration
limiter = Limiter(key_func=get_remote_address)

logger = logging.getLogger(__name__)

RECAPTCHA_SECRET_KEY = os.getenv("RECAPTCHA_SECRET_KEY")
if RECAPTCHA_SECRET_KEY:
    logger.info("RECAPTCHA_SECRET_KEY is configured (length=%d, prefix=%s)", len(RECAPTCHA_SECRET_KEY), RECAPTCHA_SECRET_KEY[:6])
else:
    logger.warning("RECAPTCHA_SECRET_KEY is NOT configured — reCAPTCHA verification will always fail.")

PASSWORD_RESET_EXPIRES_MINUTES = 30

SERVER_STARTED_AT = datetime.utcnow().isoformat()

MAX_LOGIN_ATTEMPTS = 5
RATE_LIMIT_WINDOW = 60
MAX_REQUESTS_PER_WINDOW = 30
MFA_VALID_WINDOW_STEPS = 2

_ABUSE_STATE_PATH = Path(os.getenv("ABUSE_STATE_PATH", "./abuse_state.json"))


def utc_now() -> datetime:
    return datetime.utcnow()


def is_expired_at(value: datetime | None) -> bool:
    if value is None:
        return True
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value <= utc_now()


def seconds_since(value: datetime) -> float:
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return (utc_now() - value).total_seconds()


def _load_abuse_state() -> tuple[dict, dict]:
    r = get_redis_client()
    if r:
        try:
            raw_login = r.hgetall("wards:auth:login_attempts")
            raw_locked = r.hgetall("wards:auth:locked_accounts")
            return (
                {k: json.loads(v) for k, v in raw_login.items()},
                {k: json.loads(v) for k, v in raw_locked.items()},
            )
        except Exception:
            return {}, {}
    # Fallback to file
    if not _ABUSE_STATE_PATH.exists():
        return {}, {}
    try:
        with _ABUSE_STATE_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("login_attempts", {}), data.get("locked_accounts", {})
    except (json.JSONDecodeError, OSError):
        return {}, {}


def _save_abuse_state() -> None:
    r = get_redis_client()
    if r:
        try:
            pipe = r.pipeline()
            if login_attempts:
                pipe.hset("wards:auth:login_attempts", mapping={k: json.dumps(v) for k, v in login_attempts.items()})
            else:
                pipe.delete("wards:auth:login_attempts")
            if locked_accounts:
                pipe.hset("wards:auth:locked_accounts", mapping={k: json.dumps(v) for k, v in locked_accounts.items()})
            else:
                pipe.delete("wards:auth:locked_accounts")
            pipe.execute()
        except Exception:
            pass
        return
    # Fallback to file
    try:
        with _ABUSE_STATE_PATH.open("w", encoding="utf-8") as f:
            json.dump(
                {"login_attempts": login_attempts, "locked_accounts": locked_accounts},
                f,
            )
    except OSError:
        pass


login_attempts, locked_accounts = _load_abuse_state()


class UnifiedLoginRequest(BaseModel):
    identifier: str
    password: str
    portal: Optional[str] = None
    totp_code: Optional[str] = None
    recaptcha_token: Optional[str] = None


class UnifiedSetupMFARequest(BaseModel):
    identifier: str
    password: str
    portal: Optional[str] = None


class UnifiedVerifyMFASetup(BaseModel):
    identifier: str
    password: str
    portal: Optional[str] = None
    totp_code: str


class UnifiedMFARecoverySendOTPRequest(BaseModel):
    identifier: str
    password: str
    portal: Optional[str] = None


class UnifiedMFARecoveryVerifyOTPRequest(BaseModel):
    identifier: str
    password: str
    portal: Optional[str] = None
    otp_code: str


class UnifiedToken(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None
    token_type: str
    portal: str
    user: dict
    requires_mfa: Optional[bool] = False
    mfa_setup_required: Optional[bool] = False


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class UnifiedPasswordResetRequest(BaseModel):
    email: EmailStr
    portal: Optional[str] = None


class UnifiedPasswordResetConfirm(BaseModel):
    token: str
    new_password: str


def normalize_identifier(identifier: str) -> str:
    return identifier.strip().lower()


def tracking_key(portal: str, identifier: str) -> str:
    return f"{portal}:{normalize_identifier(identifier)}"


def _refresh_abuse_state() -> None:
    """Reload distributed abuse state from Redis so other instances' changes are visible."""
    r = get_redis_client()
    if not r:
        return
    try:
        global login_attempts, locked_accounts
        raw_login = r.hgetall("wards:auth:login_attempts")
        login_attempts = {k: json.loads(v) for k, v in raw_login.items()}
        raw_locked = r.hgetall("wards:auth:locked_accounts")
        locked_accounts = {k: json.loads(v) for k, v in raw_locked.items()}
    except Exception:
        pass


def clear_tracking(identifier: str):
    _refresh_abuse_state()
    normalized = normalize_identifier(identifier)
    for portal in PORTAL_CONFIG.keys():
        key = f"{portal}:{normalized}"
        if key in locked_accounts:
            del locked_accounts[key]
    _save_abuse_state()


def check_rate_limit(ip_address: str) -> bool:
    _refresh_abuse_state()
    current_time = time.time()
    if ip_address not in login_attempts:
        login_attempts[ip_address] = []

    login_attempts[ip_address] = [
        timestamp for timestamp in login_attempts[ip_address]
        if current_time - timestamp < RATE_LIMIT_WINDOW
    ]

    if len(login_attempts[ip_address]) >= MAX_REQUESTS_PER_WINDOW:
        return False

    login_attempts[ip_address].append(current_time)
    _save_abuse_state()
    return True


def is_account_locked(portal: str, identifier: str) -> bool:
    _refresh_abuse_state()
    key = tracking_key(portal, identifier)
    if key in locked_accounts:
        lock_time = locked_accounts[key]["locked_at"]
        duration = PORTAL_CONFIG[portal]["lockout_duration"]
        if lock_time and time.time() - lock_time < duration:
            return True
        del locked_accounts[key]
    _save_abuse_state()
    return False


def record_failed_attempt(portal: str, identifier: str):
    _refresh_abuse_state()
    key = tracking_key(portal, identifier)
    if key not in locked_accounts:
        locked_accounts[key] = {"attempts": 0, "locked_at": None}

    locked_accounts[key]["attempts"] += 1
    if locked_accounts[key]["attempts"] >= MAX_LOGIN_ATTEMPTS:
        locked_accounts[key]["locked_at"] = time.time()
    _save_abuse_state()


def reset_failed_attempts(portal: str, identifier: str):
    _refresh_abuse_state()
    key = tracking_key(portal, identifier)
    if key in locked_accounts:
        del locked_accounts[key]
    _save_abuse_state()


def requires_captcha(portal: str, identifier: str) -> bool:
    _refresh_abuse_state()
    key = tracking_key(portal, identifier)
    if key not in locked_accounts:
        return False
    entry = locked_accounts[key]
    lock_time = entry.get("locked_at")
    duration = PORTAL_CONFIG[portal]["lockout_duration"]
    if lock_time and time.time() - lock_time >= duration:
        # Stale entry — lockout expired, clear it
        del locked_accounts[key]
        _save_abuse_state()
        return False
    return entry["attempts"] >= PORTAL_CONFIG[portal]["captcha_threshold"]


def verify_recaptcha(token: str, client_ip: str) -> bool:
    if not RECAPTCHA_SECRET_KEY:
        logger.warning("verify_recaptcha called but RECAPTCHA_SECRET_KEY is missing")
        return False
    if not token:
        logger.warning("verify_recaptcha called with empty token")
        return False
    try:
        response = requests.post(
            "https://www.google.com/recaptcha/api/siteverify",
            data={
                "secret": RECAPTCHA_SECRET_KEY,
                "response": token,
                "remoteip": client_ip,
            },
            timeout=5,
        )
        data = response.json()
        success = data.get("success", False)
        if not success:
            logger.warning(
                "reCAPTCHA verification failed — success=%s, error-codes=%s, token_len=%d, ip=%s",
                success,
                data.get("error-codes", []),
                len(token),
                client_ip,
            )
        else:
            logger.info("reCAPTCHA verification succeeded for ip=%s", client_ip)
        return success
    except Exception as exc:
        logger.exception("reCAPTCHA verification request failed: %s", exc)
        return False


def log_activity(db: Session, action: str, user: str, details: str, log_type: str = "auth", *, request=None, role=None, branch=None, email=None):
    meta_parts = []
    if role:
        meta_parts.append(f"role: {role}")
    if branch:
        meta_parts.append(f"branch: {branch}")
    if email:
        meta_parts.append(f"email: {email}")
    if request and request.client and request.client.host:
        meta_parts.append(f"ip: {request.client.host}")
    full_details = details
    if meta_parts:
        separator = " | " if " | " in details else "; "
        full_details = f"{details}{separator}{' | '.join(meta_parts)}"
    db.add(ActivityLog(action=action, user=user, details=full_details, type=log_type))
    db.commit()


def log_unified_security_context(db: Session, *, portal: str, actor: str, client_ip: str, account: object):
    if portal != "admin":
        return
    try:
        from utils.security_client import record_context_detection

        record_context_detection(
            db,
            target_name=f"admin_session:{actor}",
            actor=actor,
            change_type="suspicious_login",
            context={
                "target_type": "admin_session",
                "source_ip": client_ip,
                "admin_id": getattr(account, "id", None),
                "admin_session_valid": True,
                "method_legitimate": True,
            },
        )
    except Exception:
        pass


def find_account(db: Session, identifier: str) -> Tuple[Optional[str], Optional[object]]:
    normalized = normalize_identifier(identifier)

    public_user = find_citizen_by_email(db, CitizenUser, normalized)
    if public_user:
        return "public", public_user

    admin = db.query(Admin).filter(Admin.email == normalized).first()
    if not admin:
        admin = db.query(Admin).filter(Admin.username == normalized).first()
    if admin:
        return "admin", admin

    branch_staff = db.query(BranchStaff).filter(BranchStaff.email == normalized).first()
    if not branch_staff:
        branch_staff = db.query(BranchStaff).filter(BranchStaff.username == normalized).first()
    if branch_staff:
        return "branch", branch_staff

    return None, None


def find_account_for_portal(db: Session, identifier: str, requested_portal: Optional[str]) -> Tuple[Optional[str], Optional[object]]:
    normalized = normalize_identifier(identifier)
    portal = (requested_portal or "").strip().lower()

    if portal == "public":
        public_user = find_citizen_by_email(db, CitizenUser, normalized)
        if public_user:
            return "public", public_user
        return find_account(db, identifier)

    if portal == "admin":
        admin = db.query(Admin).filter(Admin.email == normalized).first()
        if not admin:
            admin = db.query(Admin).filter(Admin.username == normalized).first()
        if admin:
            return "admin", admin
        return find_account(db, identifier)

    if portal == "branch":
        branch_staff = db.query(BranchStaff).filter(BranchStaff.email == normalized).first()
        if not branch_staff:
            branch_staff = db.query(BranchStaff).filter(BranchStaff.username == normalized).first()
        if branch_staff:
            return "branch", branch_staff
        return find_account(db, identifier)

    return find_account(db, identifier)


def get_portal_login_label(portal: Optional[str]) -> str:
    labels = {
        "public": "Citizen Access",
        "admin": "Main Office Admin",
        "branch": "Branch Office",
    }
    return labels.get((portal or "").strip().lower(), "WARDS Login")


def build_user_response(portal: str, account: object, mfa_setup_required: bool = False) -> dict:
    if portal == "public":
        profile = serialize_citizen_user(account)
        return {
            "id": account.id,
            "email": profile["email"],
            "role": "public",
            "full_name": profile["full_name"],
            "contact_number": profile["contact_number"],
            "address": profile["address"],
            "mfa_setup_required": mfa_setup_required,
        }

    if portal == "admin":
        return {
            "id": account.id,
            "username": account.username,
            "email": account.email,
            "role": "admin",
            "internal_role": account.role,
            "status": account.status,
            "mfa_setup_required": mfa_setup_required,
        }

    return {
        "id": account.id,
        "username": account.username,
        "email": account.email,
        "full_name": account.full_name,
        "role": "branch",
        "internal_role": account.role,
        "branch_id": account.branch_id,
        "branch_name": (
            get_decrypted_or_raw(account.branch, "name")
            if getattr(account, "branch", None)
            else None
        ),
        "dashboard_url": get_branch_dashboard_url(account),
        "status": account.status,
        "account_scope": getattr(account, "account_scope", "full_branch"),
        "service_window": getattr(account, "service_window", None),
        "service_window_label": get_branch_window_label(account),
        "window_label": get_branch_window_label(account),
        "assigned_window_number": get_branch_assigned_window_number(account),
        "mfa_setup_required": mfa_setup_required,
    }


def build_token_payload(portal: str, account: object, ip: str | None = None, ua: str | None = None) -> dict:
    payload: dict = {}
    if portal == "public":
        profile = serialize_citizen_user(account)
        payload = {
            "sub": profile["email"],
            "user_id": account.id,
            "role": "public",
            "type": "user",
        }
    elif portal == "admin":
        payload = {
            "sub": account.username,
            "user_id": account.id,
            "role": "admin",
            "internal_role": account.role,
            "type": "admin",
        }
    else:
        payload = {
            "sub": account.username,
            "email": account.email,
            "user_id": account.id,
            "role": "branch",
            "internal_role": account.role,
            "branch_id": account.branch_id,
            "account_scope": getattr(account, "account_scope", "full_branch"),
            "service_window": getattr(account, "service_window", None),
            "service_window_label": get_branch_window_label(account),
            "assigned_window_number": get_branch_assigned_window_number(account),
            "type": "branch",
        }

    if ip:
        payload["ip"] = ip
    if ua:
        payload["ua"] = ua
    return payload


def build_password_reset_token(portal: str, account: object) -> str:
    expires_at = datetime.utcnow() + timedelta(minutes=PASSWORD_RESET_EXPIRES_MINUTES)
    account_email = serialize_citizen_user(account)["email"] if portal == "public" else account.email
    payload = {
        "sub": account_email,
        "portal": portal,
        "user_id": account.id,
        "purpose": "password_reset",
        "exp": expires_at,
    }
    return jwt.encode(payload, PASSWORD_RESET_SECRET_KEY, algorithm=ALGORITHM)


def get_account_email(portal: str, account: object) -> str:
    if portal == "public":
        return serialize_citizen_user(account)["email"]
    return account.email


def get_account_identifier(portal: str, account: object) -> str:
    return serialize_citizen_user(account)["email"] if portal == "public" else account.email


def get_mfa_username(portal: str, account: object) -> str:
    return serialize_citizen_user(account)["email"] if portal == "public" else account.username


def get_account_display_name(portal: str, account: object) -> str:
    if portal == "public":
        profile = serialize_citizen_user(account)
        return profile["full_name"] or profile["email"]
    if portal == "admin":
        return getattr(account, "username", None) or account.email
    return getattr(account, "full_name", None) or getattr(account, "username", None) or account.email


def get_account_type_label(portal: str, account: object) -> str:
    if portal == "public":
        return "public"
    if portal == "admin":
        return "admin"
    if getattr(account, "role", "") == "branch_staff":
        return "branch_staff"
    return "branch"


@router.post("/login", response_model=UnifiedToken)
@limiter.limit("5/minute")
async def unified_login(request: Request, credentials: UnifiedLoginRequest, db: Session = Depends(get_db)):
    client_ip = request.client.host

    portal, account = find_account_for_portal(db, credentials.identifier, credentials.portal)

    if not portal or not account:
        if is_account_locked("unknown", credentials.identifier):
            remaining = int(
                PORTAL_CONFIG["unknown"]["lockout_duration"] -
                (time.time() - locked_accounts[tracking_key("unknown", credentials.identifier)]["locked_at"])
            )
            wait_message = f"{max(remaining, 1)} seconds" if remaining < 60 else f"{max(remaining // 60, 1)} minute(s)"
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid credentials or account status.",
            )

        record_failed_attempt("unknown", credentials.identifier)
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": "Invalid credentials or account status."},
        )

    if is_account_locked(portal, credentials.identifier):
        remaining = int(
            PORTAL_CONFIG[portal]["lockout_duration"] -
            (time.time() - locked_accounts[tracking_key(portal, credentials.identifier)]["locked_at"])
        )
        if remaining >= 60:
            wait_message = f"{max(remaining // 60, 1)} minute(s)"
        else:
            wait_message = f"{max(remaining, 1)} seconds"
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid credentials or account status.",
        )

    password_valid = pwd_context.verify(credentials.password, account.hashed_password)
    if not password_valid:
        record_failed_attempt(portal, credentials.identifier)
        log_activity(
            db,
            "Failed Unified Login",
            credentials.identifier,
            f"Portal: {portal}",
            "security",
            request=request,
            role=getattr(account, 'role', 'citizen' if portal == 'public' else portal),
        )

        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": "Invalid credentials or account status."},
        )

    if portal == "branch" and (
        getattr(account, "status", "Active") == "Pending Verification"
        or not getattr(account, "is_verified", True)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid credentials or account status.",
        )

    if portal == "public" and not getattr(account, "is_verified", True):
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={
                "detail": "Please verify your email before logging in.",
                "requires_email_verification": True,
            },
            headers={"x-requires-email-verification": "true"},
        )

    if getattr(account, "status", "Active") != "Active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid credentials or account status.",
        )

    if requires_captcha(portal, credentials.identifier):
        if not credentials.recaptcha_token:
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"detail": "Please complete the security check.", "requires_captcha": True},
            )

        if not verify_recaptcha(credentials.recaptcha_token, client_ip):
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"detail": "Security verification failed. Please try again."},
            )

    if portal in {"public", "admin", "branch"}:
        mfa_username = get_mfa_username(portal, account)
        mfa_secret = get_mfa_secret(db, portal, mfa_username)
        if not mfa_secret:
            # Allow login for all portals when MFA is not yet configured
            pass
        else:
            if not credentials.totp_code:
                reset_failed_attempts(portal, credentials.identifier)
                return {
                    "access_token": "",
                    "token_type": "bearer",
                    "portal": portal,
                    "user": {
                        "email": get_account_email(portal, account),
                    },
                    "requires_mfa": True,
                }

            totp = pyotp.TOTP(mfa_secret)
            if not totp.verify(credentials.totp_code, valid_window=MFA_VALID_WINDOW_STEPS):
                record_failed_attempt(portal, credentials.identifier)
                return JSONResponse(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    content={"detail": "Invalid authenticator code. Please try again."},
                )

    reset_failed_attempts(portal, credentials.identifier)
    clear_tracking(credentials.identifier)

    user_agent = request.headers.get("user-agent")
    token_payload = build_token_payload(portal, account, ip=client_ip, ua=user_agent)
    access_token = create_access_token(portal, token_payload)
    refresh_token = create_refresh_token(portal, token_payload)
    account.last_login = datetime.utcnow()
    if portal == "public":
        apply_citizen_user_security(account)
    db.commit()

    try:
        loop = asyncio.get_running_loop()
        loop.run_in_executor(
            None,
            send_login_notification_email,
            get_account_email(portal, account),
            get_account_display_name(portal, account),
            get_account_type_label(portal, account),
            account.last_login or datetime.utcnow(),
            client_ip,
            request.headers.get("user-agent"),
        )
    except Exception:
        pass

    log_activity(
        db,
        "Successful Unified Login",
        credentials.identifier,
        f"Portal: {portal}",
        "security",
        request=request,
        role=getattr(account, 'role', 'citizen' if portal == 'public' else portal),
    )
    log_unified_security_context(db, portal=portal, actor=get_mfa_username(portal, account), client_ip=client_ip, account=account)

    # Report MFA setup status truthfully for all portals.
    # Frontend enforces it for admin/branch; citizens see a dismissible prompt.
    mfa_setup_required = get_mfa_secret(db, portal, get_mfa_username(portal, account)) is None

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "portal": portal,
        "user": build_user_response(portal, account, mfa_setup_required),
        "requires_mfa": False,
        "mfa_setup_required": mfa_setup_required,
    }


@router.post("/logout")
async def unified_logout(request: Request, db: Session = Depends(get_db)):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1]
        for config in PORTAL_CONFIG.values():
            revoke_token(db, token, config["secret_key"], ALGORITHM, config.get("token_type"))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
    return {"message": "Logged out successfully"}


@router.post("/refresh")
@limiter.limit("10/minute")
async def unified_refresh_token(request: Request, payload: RefreshTokenRequest, db: Session = Depends(get_db)):
    decoded = None
    portal = None
    for candidate_portal, config in PORTAL_CONFIG.items():
        if candidate_portal == "unknown":
            continue
        try:
            candidate = decode_token(payload.refresh_token, config["secret_key"])
        except JWTError:
            continue
        if candidate.get("type") == "refresh":
            decoded = candidate
            portal = candidate.get("portal") or candidate_portal
            break

    if not decoded or portal not in {"public", "admin", "branch"}:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")

    identifier = decoded.get("email") or decoded.get("sub")
    if portal == "public":
        account = find_citizen_by_email(db, CitizenUser, identifier)
    elif portal == "admin":
        account = db.query(Admin).filter((Admin.email == identifier) | (Admin.username == decoded.get("sub"))).first()
    else:
        account = db.query(BranchStaff).filter((BranchStaff.email == identifier) | (BranchStaff.username == decoded.get("sub"))).first()

    if not account or getattr(account, "status", "Active") != "Active":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    token_payload = build_token_payload(
        portal,
        account,
        ip=request.client.host if request.client else None,
        ua=request.headers.get("user-agent"),
    )
    mfa_setup_required = get_mfa_secret(db, portal, get_mfa_username(portal, account)) is None

    return {
        "access_token": create_access_token(portal, token_payload),
        "token_type": "bearer",
        "portal": portal,
        "user": build_user_response(portal, account, mfa_setup_required),
    }


@router.post("/setup-mfa")
@limiter.limit("5/minute")
async def unified_setup_mfa(request: Request, credentials: UnifiedSetupMFARequest, db: Session = Depends(get_db)):
    client_ip = request.client.host
    portal, account = find_account_for_portal(db, credentials.identifier, credentials.portal)

    if portal not in {"public", "admin", "branch"} or not account:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="MFA setup is only available for citizen, staff, and admin accounts.",
        )

    if not pwd_context.verify(credentials.password, account.hashed_password):
        log_activity(
            db,
            "Failed Unified MFA Setup",
            credentials.identifier,
            f"Portal: {portal}, IP: {client_ip}",
            "security",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials or account status.",
        )

    if portal == "public" and not getattr(account, "is_verified", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email before setting up MFA.",
        )

    if getattr(account, "status", "Active") != "Active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid credentials or account status.",
        )

    secret = pyotp.random_base32()
    mfa_username = get_mfa_username(portal, account)
    is_public = portal == "public"
    save_mfa_secret(db, portal, mfa_username, secret, enabled=not is_public)
    log_activity(
        db,
        "Unified MFA Setup Initiated",
        credentials.identifier,
        f"Portal: {portal}, IP: {client_ip}",
        "security",
    )
    return generate_mfa_payload(portal, mfa_username, secret)


@router.post("/verify-mfa-setup")
@limiter.limit("5/minute")
async def unified_verify_mfa_setup(
    request: Request,
    credentials: UnifiedVerifyMFASetup,
    db: Session = Depends(get_db),
):
    client_ip = request.client.host
    portal, account = find_account_for_portal(db, credentials.identifier, credentials.portal)

    if portal not in {"public", "admin", "branch"} or not account:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="MFA verification is only available for citizen, staff, and admin accounts.",
        )

    if not pwd_context.verify(credentials.password, account.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials or account status.",
        )

    if getattr(account, "status", "Active") != "Active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid credentials or account status.",
        )

    mfa_username = get_mfa_username(portal, account)
    mfa_record = get_mfa_secret_raw(db, portal, mfa_username)
    if not mfa_record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="MFA setup not initiated. Please start setup first.",
        )

    secret = get_decrypted_or_raw(mfa_record, "secret")
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to read MFA secret.",
        )

    totp = pyotp.TOTP(secret)
    if not totp.verify(credentials.totp_code, valid_window=MFA_VALID_WINDOW_STEPS):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authenticator code. Please try again.",
        )

    mfa_record.enabled = True
    db.commit()
    log_activity(
        db,
        "Unified MFA Setup Verified",
        credentials.identifier,
        f"Portal: {portal}, IP: {client_ip}",
        "security",
    )
    return {"message": "MFA enabled successfully", "portal": portal}


@router.post("/request-password-reset")
@limiter.limit("5/hour")
async def unified_request_password_reset(
    request: Request,
    reset_request: UnifiedPasswordResetRequest,
    db: Session = Depends(get_db),
):
    email = reset_request.email.strip().lower()
    portal, account = find_account_for_portal(db, email, reset_request.portal)

    if portal and account:
        frontend_base_url = os.getenv("FRONTEND_BASE_URL", "http://localhost:3000").rstrip("/")
        reset_token = build_password_reset_token(portal, account)
        reset_url = f"{frontend_base_url}/forgot-password?token={reset_token}&portal={portal}"
        send_password_reset_email(
            recipient_email=get_account_email(portal, account),
            display_name=get_account_display_name(portal, account),
            account_type=get_account_type_label(portal, account),
            reset_url=reset_url,
            expires_minutes=PASSWORD_RESET_EXPIRES_MINUTES,
        )
        log_activity(
            db,
            "Password Reset Requested",
            email,
            f"Portal: {portal}, IP: {request.client.host}",
            "security",
        )

    return {
        "message": "If the email exists, a password reset link has been sent.",
    }


@router.post("/reset-password")
@limiter.limit("5/minute")
async def unified_reset_password(
    request: Request,
    reset_data: UnifiedPasswordResetConfirm,
    db: Session = Depends(get_db),
):
    try:
        payload = decode_token(reset_data.token, PASSWORD_RESET_SECRET_KEY)
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset link.") from exc

    if payload.get("purpose") != "password_reset":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset link.")

    portal = payload.get("portal")
    email = (payload.get("sub") or "").strip().lower()
    user_id = payload.get("user_id")

    if portal not in {"public", "admin", "branch"} or not email or not user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset link.")

    _, account = find_account_for_portal(db, email, portal)
    if not account or account.id != user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset link.")

    validate_password_strength(reset_data.new_password)

    account.hashed_password = pwd_context.hash(reset_data.new_password)
    db.commit()

    clear_tracking(email)
    if portal in {"admin", "branch"}:
        clear_tracking(get_account_identifier(portal, account))

    log_activity(
        db,
        "Password Reset Completed",
        email,
        f"Portal: {portal}, IP: {request.client.host}",
        "security",
    )

    return {"message": "Password reset successful. You can now sign in with your new password."}


@router.post("/mfa-recovery/send-otp")
@limiter.limit("100/hour")
async def unified_mfa_recovery_send_otp(
    request: Request,
    credentials: UnifiedMFARecoverySendOTPRequest,
    db: Session = Depends(get_db),
):
    client_ip = request.client.host
    portal, account = find_account_for_portal(db, credentials.identifier, credentials.portal)

    if portal not in {"public", "admin", "branch"} or not account:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account not found.",
        )

    if not pwd_context.verify(credentials.password, account.hashed_password):
        log_activity(
            db,
            "Failed MFA Recovery OTP Request",
            credentials.identifier,
            f"Portal: {portal}, IP: {client_ip}",
            "security",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials or account status.",
        )

    if getattr(account, "status", "Active") != "Active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid credentials or account status.",
        )

    mfa_username = get_mfa_username(portal, account)
    mfa_record = get_mfa_secret_raw(db, portal, mfa_username)
    if not mfa_record or not mfa_record.enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="MFA is not enabled for this account. Please sign in normally.",
        )

    email = serialize_citizen_user(account)["email"] if portal == "public" else account.email

    if not check_mfa_recovery_rate_limit(email):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many recovery requests. Please try again later.",
        )

    otp_record, resend_wait = issue_mfa_recovery_otp(db, email, allow_recent_existing=False)
    db.commit()

    log_activity(
        db,
        "MFA Recovery OTP Sent",
        credentials.identifier,
        f"Portal: {portal}, IP: {client_ip}",
        "security",
    )

    return {
        "message": f"A verification code was sent to {email}.",
        "resend_available_in_seconds": resend_wait,
        "expires_in_seconds": max(int((otp_record.expires_at - datetime.utcnow()).total_seconds()), 0),
    }


@router.post("/mfa-recovery/verify-otp")
@limiter.limit("100/hour")
async def unified_mfa_recovery_verify_otp(
    request: Request,
    credentials: UnifiedMFARecoveryVerifyOTPRequest,
    db: Session = Depends(get_db),
):
    client_ip = request.client.host
    portal, account = find_account_for_portal(db, credentials.identifier, credentials.portal)

    if portal not in {"public", "admin", "branch"} or not account:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account not found.",
        )

    if not pwd_context.verify(credentials.password, account.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials or account status.",
        )

    if getattr(account, "status", "Active") != "Active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid credentials or account status.",
        )

    email = serialize_citizen_user(account)["email"] if portal == "public" else account.email

    if not check_mfa_recovery_confirm_rate_limit(email):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many verification attempts. Please try again later.",
        )

    active_otp = find_active_mfa_recovery_otp(db, email)
    if not active_otp:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active verification code was found. Please request a new one.",
        )

    submitted_code = (credentials.otp_code or "").strip()
    if len(submitted_code) != 6 or not submitted_code.isdigit():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Enter the 6-digit verification code from your email.",
        )

    if active_otp.expires_at <= datetime.utcnow():
        active_otp.consumed_at = datetime.utcnow()
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This verification code has expired. Please request a new one.",
        )

    if active_otp.code_hash != hash_mfa_recovery_code(submitted_code):
        active_otp.attempts = (active_otp.attempts or 0) + 1
        db.commit()

        if active_otp.attempts >= 5:
            active_otp.consumed_at = datetime.utcnow()
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Too many failed attempts. Please request a new verification code.",
            )

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid verification code. Please try again.",
        )

    # OTP verified — reset old MFA and generate new setup
    active_otp.consumed_at = datetime.utcnow()

    mfa_username = get_mfa_username(portal, account)
    secret = pyotp.random_base32()
    is_public = portal == "public"
    save_mfa_secret(db, portal, mfa_username, secret, enabled=not is_public)

    db.commit()

    log_activity(
        db,
        "MFA Recovery Completed — Old MFA Reset",
        credentials.identifier,
        f"Portal: {portal}, IP: {client_ip}",
        "security",
    )

    return generate_mfa_payload(portal, mfa_username, secret)


@router.get("/verify")
@limiter.limit("30/minute")
async def unified_verify(request: Request, db: Session = Depends(get_db)):
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authorization header",
        )

    token = auth_header.split(" ", 1)[1]
    portal, account, _payload = decode_active_account_from_bearer_token(token, db)
    mfa_setup_required = get_mfa_secret(db, portal, get_mfa_username(portal, account)) is None

    return {
        "valid": True,
        "portal": portal,
        "server_started_at": SERVER_STARTED_AT,
        "user": build_user_response(portal, account, mfa_setup_required),
    }


@router.post("/setup-mfa-authenticated")
async def unified_setup_mfa_authenticated(request: Request, db: Session = Depends(get_db)):
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authorization header",
        )

    token = auth_header.split(" ", 1)[1]
    portal, account, _payload = decode_active_account_from_bearer_token(token, db)

    if portal not in {"public", "admin", "branch"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="MFA setup is only available for citizen, staff, and admin accounts.",
        )

    client_ip = request.client.host
    mfa_username = get_mfa_username(portal, account)
    secret = pyotp.random_base32()
    is_public = portal == "public"
    save_mfa_secret(db, portal, mfa_username, secret, enabled=not is_public)
    log_activity(
        db,
        "Authenticated MFA Setup Initiated",
        get_account_identifier(portal, account),
        f"Portal: {portal}, IP: {client_ip}",
        "security",
    )
    return generate_mfa_payload(portal, mfa_username, secret)


@router.get("/me")
async def unified_me(request: Request, db: Session = Depends(get_db)):
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authorization header",
        )

    token = auth_header.split(" ", 1)[1]
    portal, account, _payload = decode_active_account_from_bearer_token(token, db)
    mfa_setup_required = get_mfa_secret(db, portal, get_mfa_username(portal, account)) is None
    return build_user_response(portal, account, mfa_setup_required)


class RegisterRequest(BaseModel):
    email: EmailStr
    full_name: str
    contact_number: str
    address: str = ""
    password: str
    dpa_consent: bool = False
    dpa_version: Optional[str] = None
    recaptcha_token: Optional[str] = None


class CheckContactRequest(BaseModel):
    contact_number: str


class VerificationRequest(BaseModel):
    email: EmailStr


class VerificationConfirmRequest(BaseModel):
    email: EmailStr
    code: str


class InviteRegisterRequest(BaseModel):
    email: EmailStr
    password: str
    invite_token: str


def _generate_verification_code() -> str:
    return "".join(random.choices(string.digits, k=6))


def _get_citizen_email(citizen: CitizenUser) -> str:
    return serialize_citizen_user(citizen)["email"]


def _find_latest_public_email_otp(db: Session, email: str) -> EmailOTP | None:
    normalized_email = normalize_identifier(email)
    email_hash = hash_optional_value(normalized_email)
    role_hash = hash_optional_value("public")

    otp_record = (
        db.query(EmailOTP)
        .filter(
            EmailOTP.email_hash == email_hash,
            EmailOTP.role_hash == role_hash,
            EmailOTP.consumed_at.is_(None),
        )
        .order_by(EmailOTP.created_at.desc(), EmailOTP.id.desc())
        .first()
    )
    if otp_record:
        return otp_record

    # Fallback: decrypt and compare for rows where the raw email/role have been
    # redacted to OTP_EMAIL_* / OTP_ROLE_* placeholders.
    for candidate in (
        db.query(EmailOTP)
        .filter(EmailOTP.consumed_at.is_(None))
        .order_by(EmailOTP.created_at.desc(), EmailOTP.id.desc())
        .all()
    ):
        candidate_email = (get_decrypted_or_raw(candidate, "email") or "").strip().lower()
        candidate_role = (get_decrypted_or_raw(candidate, "role") or "").strip().lower()
        if candidate_email == normalized_email and candidate_role == "public":
            return candidate

    return None


@router.post("/register")
@limiter.limit("3/minute")
async def unified_register(
    request: Request,
    payload: RegisterRequest,
    db: Session = Depends(get_db),
):
    if not payload.dpa_consent or not payload.dpa_version:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You must accept the Data Privacy Agreement to register.",
        )

    if payload.recaptcha_token and RECAPTCHA_SECRET_KEY:
        try:
            recaptcha_resp = requests.post(
                "https://www.google.com/recaptcha/api/siteverify",
                data={"secret": RECAPTCHA_SECRET_KEY, "response": payload.recaptcha_token},
                timeout=10,
            )
            recaptcha_data = recaptcha_resp.json()
            if not recaptcha_data.get("success"):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="reCAPTCHA verification failed.",
                )
        except Exception:
            pass

    email = normalize_identifier(payload.email)

    existing = find_citizen_by_email(db, CitizenUser, email)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    validate_password_strength(payload.password)

    citizen = CitizenUser(
        email=email,
        full_name=payload.full_name.strip(),
        contact_number=payload.contact_number.strip(),
        address=payload.address.strip() if payload.address else "",
        hashed_password=pwd_context.hash(payload.password),
        role="public",
        is_verified=False,
        status="Active",
    )
    apply_citizen_user_security(citizen)
    db.add(citizen)
    db.flush()

    code = _generate_verification_code()
    email_otp = EmailOTP(
        email=email,
        role="public",
        code_hash=pwd_context.hash(code),
        expires_at=utc_now() + timedelta(minutes=10),
        resend_count=1,
        last_sent_at=utc_now(),
    )
    db.add(email_otp)
    db.flush()
    apply_email_otp_security(email_otp)
    db.commit()

    email_result = send_citizen_verification_email(email, code, expires_minutes=10)
    message = (
        email_result.get("message")
        or "We sent a 6-digit verification code to your email. Enter it to activate your account."
    )

    log_activity(
        db,
        "Citizen Registration",
        email,
        f"New citizen user registered. Email verification pending.",
        "auth",
    )

    return {
        "requires_email_verification": True,
        "message": message,
        "resend_available_in_seconds": 120,
    }


@router.post("/check-contact")
@limiter.limit("10/minute")
async def unified_check_contact(
    request: Request,
    payload: CheckContactRequest,
    db: Session = Depends(get_db),
):
    normalized = payload.contact_number.strip()
    existing = find_citizen_by_contact_number(db, CitizenUser, normalized)
    return {"available": existing is None}


@router.post("/verification/request")
@limiter.limit("3/minute")
async def unified_verification_request(
    request: Request,
    payload: VerificationRequest,
    db: Session = Depends(get_db),
):
    email = normalize_identifier(payload.email)
    citizen = find_citizen_by_email(db, CitizenUser, email)
    if not citizen:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No account found with this email address.",
        )

    recent_otp = _find_latest_public_email_otp(db, email)

    if recent_otp and recent_otp.last_sent_at:
        elapsed = seconds_since(recent_otp.last_sent_at)
        if elapsed < 60:
            remaining = int(60 - elapsed)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Please wait {remaining} seconds before requesting a new code.",
            )

    code = _generate_verification_code()

    if recent_otp:
        recent_otp.code_hash = pwd_context.hash(code)
        recent_otp.expires_at = utc_now() + timedelta(minutes=10)
        recent_otp.resend_count = (recent_otp.resend_count or 0) + 1
        recent_otp.last_sent_at = utc_now()
        recent_otp.attempts = 0
        apply_email_otp_security(recent_otp)
    else:
        email_otp = EmailOTP(
            email=email,
            role="public",
            code_hash=pwd_context.hash(code),
            expires_at=utc_now() + timedelta(minutes=10),
            resend_count=1,
            last_sent_at=utc_now(),
        )
        db.add(email_otp)
        db.flush()
        apply_email_otp_security(email_otp)

    db.commit()

    email_result = send_citizen_verification_email(email, code, expires_minutes=10)
    message = (
        email_result.get("message")
        or "A new verification code was sent to your email."
    )

    return {
        "message": message,
        "resend_available_in_seconds": 120,
    }


@router.post("/verification/confirm")
@limiter.limit("5/minute")
async def unified_verification_confirm(
    request: Request,
    payload: VerificationConfirmRequest,
    db: Session = Depends(get_db),
):
    email = normalize_identifier(payload.email)
    citizen = find_citizen_by_email(db, CitizenUser, email)
    if not citizen:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No account found with this email address.",
        )

    otp_record = _find_latest_public_email_otp(db, email)

    if not otp_record or is_expired_at(otp_record.expires_at):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The verification code has expired. Please request a new one.",
        )

    if not pwd_context.verify(payload.code, otp_record.code_hash):
        otp_record.attempts = (otp_record.attempts or 0) + 1
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid verification code. Please try again.",
        )

    otp_record.consumed_at = utc_now()
    citizen.is_verified = True
    db.commit()

    return {"message": "Email verified. You can now log in."}


@router.post("/register/invite")
@limiter.limit("5/minute")
async def unified_invite_register(
    request: Request,
    payload: InviteRegisterRequest,
    db: Session = Depends(get_db),
):
    email = normalize_identifier(payload.email)

    invite = find_invite_by_token(db, Invite, payload.invite_token)
    if not invite or invite.used or is_expired_at(invite.expires_at):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired invite token.",
        )

    invite_email = normalize_identifier(get_decrypted_or_raw(invite, "email") or invite.email)
    invite_role = (get_decrypted_or_raw(invite, "role") or invite.role or "").strip().lower()

    if invite_email != email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invite email does not match.",
        )

    validate_password_strength(payload.password)

    portal = invite_role
    account = None

    if portal in ("admin", "main_admin", "superadmin"):
        existing = db.query(Admin).filter(Admin.email == email).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An admin account with this email already exists.",
            )
        account = Admin(
            email=email,
            username=email.split("@")[0],
            hashed_password=pwd_context.hash(payload.password),
            role=portal if portal in ("main_admin", "superadmin") else "main_admin",
            status="Active",
        )
        db.add(account)
    elif portal == "branch":
        existing = db.query(BranchStaff).filter(BranchStaff.email == email).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A branch account with this email already exists.",
            )
        account = BranchStaff(
            email=email,
            username=email.split("@")[0],
            hashed_password=pwd_context.hash(payload.password),
            role="branch_admin",
            status="Active",
        )
        db.add(account)
    else:
        existing = find_citizen_by_email(db, CitizenUser, email)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with this email already exists.",
            )
        account = CitizenUser(
            email=email,
            full_name=email.split("@")[0],
            contact_number="",
            address="",
            hashed_password=pwd_context.hash(payload.password),
            role="public",
            is_verified=True,
            status="Active",
        )
        apply_citizen_user_security(account)
        db.add(account)

    invite.used = True
    db.commit()
    db.refresh(account)

    token_portal = (
        "public" if portal not in ("admin", "main_admin", "superadmin", "branch")
        else ("admin" if portal in ("admin", "main_admin", "superadmin") else "branch")
    )
    token_payload = build_token_payload(token_portal, account)
    access_token = create_access_token(token_portal, token_payload)

    log_activity(
        db,
        "Invite Registration",
        email,
        f"Registered via invite. Portal: {portal}",
        "auth",
    )

    user_response = build_user_response(
        "public" if portal not in ("admin", "main_admin", "superadmin", "branch") else ("admin" if portal in ("admin", "main_admin", "superadmin") else "branch"),
        account,
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": user_response,
    }


# ---------------------------------------------------------------------------
# Branch Authentication Endpoints (mounted at /api/branch/auth)
# ---------------------------------------------------------------------------

@router.post("/branch/setup-mfa-authenticated")
async def branch_setup_mfa_authenticated(
    request: Request,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    """Authenticated branch staff MFA setup."""
    client_ip = request.client.host if request.client else "unknown"
    mfa_username = current_staff.username
    secret = pyotp.random_base32()
    save_mfa_secret(db, "branch", mfa_username, secret, enabled=True)

    db.add(ActivityLog(
        action="Branch MFA Setup Initiated",
        user=mfa_username,
        details=f"IP: {client_ip}",
        type="security",
    ))
    db.commit()

    totp = pyotp.TOTP(secret)
    provisioning_uri = totp.provisioning_uri(
        name=mfa_username,
        issuer_name="WARDS Branch Portal",
    )
    return {
        "secret": secret,
        "qr_code_uri": provisioning_uri,
        "message": "MFA setup initiated. Scan the QR code with your authenticator app.",
    }


@router.get("/branch/admin/staff")
async def list_branch_staff(
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    """List staff accounts within the same branch (branch admin only)."""
    if current_staff.role not in {"branch_admin", "main_admin", "admin", "superadmin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Branch admin access required",
        )

    staff_list = (
        db.query(BranchStaff)
        .filter(BranchStaff.branch_id == current_staff.branch_id)
        .all()
    )

    return [
        {
            "id": s.id,
            "username": s.username,
            "email": s.email,
            "full_name": s.full_name,
            "role": s.role,
            "status": s.status,
            "mfa_enabled": bool(
                find_mfa_secret_record(db, "branch", s.username)
            ),
        }
        for s in staff_list
    ]


class ResetStaffMfaRequest(BaseModel):
    staff_id: int


@router.post("/branch/admin/reset-staff-mfa")
async def reset_staff_mfa(
    payload: ResetStaffMfaRequest,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    """Reset MFA for a staff member in the same branch."""
    if current_staff.role not in {"branch_admin", "main_admin", "admin", "superadmin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Branch admin access required",
        )

    target = db.query(BranchStaff).filter(
        BranchStaff.id == payload.staff_id,
        BranchStaff.branch_id == current_staff.branch_id,
    ).first()

    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Staff member not found")

    mfa_record = find_mfa_secret_record(db, "branch", target.username)
    if mfa_record:
        db.delete(mfa_record)

    db.add(ActivityLog(
        action="Branch Staff MFA Reset",
        user=current_staff.username,
        details=f"Reset MFA for {target.username} (ID: {target.id})",
        type="security",
    ))
    db.commit()

    return {"message": f"MFA reset for {target.username}"}


def _build_branch_verification_page(*, success: bool, title: str, message: str, detail: str | None = None) -> str:
    """Build a styled HTML page for branch email verification outcomes."""
    frontend_base = os.getenv("FRONTEND_BASE_URL", "http://localhost:3000").rstrip("/")
    login_url = f"{frontend_base}/branch-login"
    accent_color = "#166534" if success else "#dc2626"
    icon_svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
        if success
        else '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
    )
    detail_html = f'<p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#5b6471;">{detail}</p>' if detail else ""
    cta_html = (
        f'<a href="{_safe_html(login_url)}" style="display:inline-block;margin-top:28px;padding:14px 32px;background:#0f2744;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:12px;box-shadow:0 8px 20px rgba(15,39,68,.25);transition:transform .15s,box-shadow .15s;">Go to Branch Login</a>'
        if success
        else f'<a href="{_safe_html(login_url)}" style="display:inline-block;margin-top:28px;padding:14px 32px;background:#0f2744;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:12px;box-shadow:0 8px 20px rgba(15,39,68,.25);transition:transform .15s,box-shadow .15s;">Back to Branch Login</a>'
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{_safe_html(title)} | WARDS</title>
<style>
  @media (prefers-reduced-motion: reduce) {{ * {{ animation:none !important; transition:none !important; }} }}
  body {{ margin:0; padding:0; background:#f3f6fb; font-family:Arial,Helvetica,sans-serif; color:#1f2937; display:flex; align-items:center; justify-content:center; min-height:100vh; }}
  .card {{ background:#ffffff; border-radius:24px; padding:48px 40px 44px; max-width:440px; width:90%; text-align:center; box-shadow:0 18px 40px rgba(15,39,68,.10); border:1px solid #dbe3ef; animation:fadeUp .6s ease both; }}
  .icon {{ color:{accent_color}; margin-bottom:20px; display:inline-flex; align-items:center; justify-content:center; width:80px; height:80px; border-radius:50%; background:{'#f0fdf4' if success else '#fef2f2'}; }}
  h1 {{ margin:0 0 12px; font-size:22px; font-weight:700; color:#0f2744; line-height:1.3; }}
  p.lead {{ margin:0; font-size:15px; line-height:1.7; color:#546273; }}
  a:hover {{ transform:translateY(-1px); box-shadow:0 12px 28px rgba(15,39,68,.30); }}
  .footer {{ margin-top:32px; font-size:12px; color:#9aa4b2; }}
  @keyframes fadeUp {{ from {{ opacity:0; transform:translateY(16px); }} to {{ opacity:1; transform:translateY(0); }} }}
</style>
</head>
<body>
  <div class="card">
    <div class="icon">{icon_svg}</div>
    <h1>{_safe_html(title)}</h1>
    <p class="lead">{_safe_html(message)}</p>
    {detail_html}
    {cta_html}
    <div class="footer">City Treasurer's Office &mdash; WARDS Branch Portal</div>
  </div>
</body>
</html>"""


@router.get("/branch/verify-email")
async def verify_branch_email(
    token: str = Query(..., description="Invite verification token"),
    db: Session = Depends(get_db),
):
    """Verify a branch admin email via invite token and return a styled HTML page."""
    invite = find_invite_by_token(db, Invite, token)

    if not invite or invite.used:
        return HTMLResponse(
            content=_build_branch_verification_page(
                success=False,
                title="Verification Failed",
                message="This verification link is invalid or has already been used.",
                detail="Please request a new verification email from your administrator.",
            ),
            status_code=400,
        )

    if invite.expires_at and invite.expires_at < datetime.utcnow():
        return HTMLResponse(
            content=_build_branch_verification_page(
                success=False,
                title="Link Expired",
                message="This verification link has expired.",
                detail="Please ask your administrator to resend the branch verification email.",
            ),
            status_code=400,
        )

    invite.used = True

    invite_email = get_decrypted_or_raw(invite, "email") or invite.email
    normalized_invite_email = normalize_email(invite_email, check_deliverability=False)
    staff = (
        db.query(BranchStaff)
        .filter(BranchStaff.email == normalized_invite_email)
        .first()
    )
    if staff:
        staff.is_verified = True
        if staff.status == "Pending Verification":
            staff.status = "Active"

    db.add(ActivityLog(
        action="Branch Email Verified",
        user=invite_email,
        details=f"Token: {token[:8]}...",
        type="branch_auth",
    ))
    db.commit()

    return HTMLResponse(
        content=_build_branch_verification_page(
            success=True,
            title="Email Verified",
            message="Your branch admin email has been verified successfully. You may now log in.",
        ),
        status_code=200,
    )


# ---------------------------------------------------------------------------
# Window Staff Self-Service Auth Endpoints
# ---------------------------------------------------------------------------

class WindowStaffChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    confirm_new_password: str


class WindowStaffResetMFARequest(BaseModel):
    current_password: str


class WindowStaffVerifyMFARequest(BaseModel):
    totp_code: str


@router.put("/branch/staff/password")
@limiter.limit("5/minute")
async def branch_staff_change_password(
    request: Request,
    payload: WindowStaffChangePasswordRequest,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    """Change the authenticated window staff's own password."""
    require_window_staff(current_staff)
    verify_account_password(payload.current_password, current_staff.hashed_password)

    if payload.new_password != payload.confirm_new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The new passwords do not match.",
        )

    validate_password_strength(payload.new_password)

    current_staff.hashed_password = hash_password(payload.new_password)
    db.commit()

    client_ip = request.client.host if request.client else "unknown"
    log_activity(db, "Window Staff Password Changed", current_staff.username, "Password changed", request=request, role=current_staff.role, branch=current_staff.branch.name if current_staff.branch else None)

    email_result = send_account_change_notification_email(
        recipient_email=current_staff.email,
        display_name=current_staff.full_name or current_staff.username,
        account_type="branch_staff",
        change_summary="Your WARDS account password was successfully changed.",
        changed_fields=["Password"],
        subject="WARDS Security Notification: Password Changed",
    )
    if email_result.get("sent"):
        log_activity(db, "Window Staff Password Changed", current_staff.username, "Security notification email sent after password change.")

    return {"message": "Password changed successfully.", "email_sent": email_result.get("sent", False)}


@router.post("/branch/staff/reset-mfa")
@limiter.limit("3/minute")
async def branch_staff_reset_mfa(
    request: Request,
    payload: WindowStaffResetMFARequest,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    """Reset the authenticated window staff's MFA and return a new QR code for in-app setup."""
    require_window_staff(current_staff)
    verify_account_password(payload.current_password, current_staff.hashed_password)

    totp_secret = pyotp.random_base32()
    save_mfa_secret(db, "branch", current_staff.username, totp_secret)

    payload_data = generate_mfa_payload("branch", current_staff.username, totp_secret, issuer_name="WARDS Branch Portal")

    client_ip = request.client.host if request.client else "unknown"
    log_activity(db, "Window Staff MFA Reset", current_staff.username, "MFA reset initiated", request=request, role=current_staff.role, branch=current_staff.branch.name if current_staff.branch else None)

    return {
        "message": "MFA reset. Please scan the QR code to complete setup.",
        "qr_code": payload_data["qr_code"],
        "manual_entry_key": totp_secret,
    }


@router.post("/branch/staff/verify-mfa")
@limiter.limit("5/minute")
async def branch_staff_verify_mfa(
    request: Request,
    payload: WindowStaffVerifyMFARequest,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    """Verify the TOTP code after in-app MFA setup to confirm the new configuration."""
    require_window_staff(current_staff)

    totp_secret = get_mfa_secret(db, "branch", current_staff.username)
    if not totp_secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No pending MFA setup found. Please reset MFA first.",
        )

    totp = pyotp.TOTP(totp_secret)
    if not totp.verify(payload.totp_code, valid_window=1):
        client_ip = request.client.host if request.client else "unknown"
        log_activity(db, "Window Staff MFA Verify Failed", current_staff.username, "MFA verification failed", request=request, role=current_staff.role, branch=current_staff.branch.name if current_staff.branch else None)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid verification code.",
        )

    client_ip = request.client.host if request.client else "unknown"
    log_activity(db, "Window Staff MFA Configured", current_staff.username, "MFA configured successfully", request=request, role=current_staff.role, branch=current_staff.branch.name if current_staff.branch else None)

    email_result = send_account_change_notification_email(
        recipient_email=current_staff.email,
        display_name=current_staff.full_name or current_staff.username,
        account_type="branch_staff",
        change_summary="Your WARDS account Multi-Factor Authentication (MFA) settings were successfully updated.",
        changed_fields=["Multi-Factor Authentication"],
        subject="WARDS Security Notification: MFA Settings Updated",
    )
    if email_result.get("sent"):
        log_activity(db, "Window Staff MFA Configured", current_staff.username, "Security notification email sent after MFA reset.")

    return {"message": "MFA configured successfully.", "email_sent": email_result.get("sent", False)}


# ---------------------------------------------------------------------------
# Public User Self-Service Auth Endpoints
# ---------------------------------------------------------------------------

class PublicUserChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    confirm_new_password: str


@router.put("/user/password")
@limiter.limit("5/minute")
async def public_user_change_password(
    request: Request,
    payload: PublicUserChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: CitizenUser = Depends(get_current_user),
):
    """Change the authenticated public user's password."""
    verify_account_password(payload.current_password, current_user.hashed_password, detail="Incorrect account password.")
    if payload.new_password != payload.confirm_new_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New password and confirmation do not match.")
    if verify_password(payload.new_password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New password must be different from your current password.")
    validate_password_strength(payload.new_password)

    current_user.hashed_password = hash_password(payload.new_password)
    db.add(ActivityLog(
        action="Public Taxpayer Password Changed",
        user=get_decrypted_or_raw(current_user, "email") or current_user.email or "",
        details=f"Password changed for citizen user {current_user.id}",
        type="user",
    ))
    db.commit()

    send_account_change_notification_email(
        recipient_email=get_decrypted_or_raw(current_user, "email") or current_user.email or "",
        display_name=get_decrypted_or_raw(current_user, "full_name") or current_user.full_name or "Taxpayer",
        account_type="public",
        change_summary="Your WARDS account password was changed.",
        changed_fields=["Password"],
    )

    return {"message": "Password changed successfully."}


# ---------------------------------------------------------------------------
# Admin Invite Creation Endpoint
# ---------------------------------------------------------------------------

class AdminInviteCreateRequest(BaseModel):
    email: EmailStr
    role: str


@router.post("/admin/invite")
@limiter.limit("10/minute")
async def admin_create_invite(
    request: Request,
    invite_data: AdminInviteCreateRequest,
    current_admin=Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    """Create an invite token for branch or admin registration."""
    if current_admin.role not in {"main_admin", "admin", "superadmin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

    if invite_data.role not in {"branch", "admin"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invite role must be either branch or admin",
        )

    token = secrets.token_urlsafe(32)
    invite = Invite(
        email=invite_data.email.lower(),
        role=invite_data.role,
        token=token,
        expires_at=datetime.utcnow() + timedelta(hours=24),
        used=False,
    )
    db.add(invite)
    db.flush()
    from utils.field_crypto import apply_invite_security
    apply_invite_security(invite)
    db.add(ActivityLog(
        action="Invite Created",
        user=current_admin.username,
        details=f"Invite for {get_decrypted_or_raw(invite, 'email') or invite_data.email.lower()} as {get_decrypted_or_raw(invite, 'role') or invite_data.role} from IP: {request.client.host}",
        type="admin_invite",
    ))
    db.commit()
    db.refresh(invite)

    return {
        "id": invite.id,
        "email": get_decrypted_or_raw(invite, "email") or invite.email,
        "role": get_decrypted_or_raw(invite, "role") or invite.role,
        "token": get_decrypted_or_raw(invite, "token") or token,
        "expires_at": invite.expires_at.isoformat(),
        "message": "Invite created successfully",
    }
