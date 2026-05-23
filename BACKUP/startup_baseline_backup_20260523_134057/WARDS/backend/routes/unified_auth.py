from datetime import datetime, timedelta
from typing import Optional, Tuple
import base64
import io
import os
import time

import pyotp
import qrcode
import requests
from fastapi import APIRouter, Depends, HTTPException, Request, status
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from database.models import ActivityLog, Admin, BranchStaff, CitizenUser, MFASecret, get_db
from services.email_service import (
    send_login_notification_email,
    send_password_reset_email,
)
from utils.field_crypto import apply_citizen_user_security, apply_mfa_secret_security, find_citizen_by_email, find_mfa_secret_record, get_decrypted_or_raw, serialize_citizen_user

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

USER_SECRET_KEY = os.getenv("USER_SECRET_KEY", "your-user-secret-key-change-in-production")
ADMIN_SECRET_KEY = os.getenv("ADMIN_SECRET_KEY", "your-admin-secret-key-change-in-production-immediately")
BRANCH_SECRET_KEY = os.getenv("BRANCH_SECRET_KEY", "your-branch-secret-key-change-in-production")
PASSWORD_RESET_SECRET_KEY = os.getenv("PASSWORD_RESET_SECRET_KEY", "your-password-reset-secret-key-change-in-production")
ALGORITHM = "HS256"
RECAPTCHA_SECRET_KEY = os.getenv("RECAPTCHA_SECRET_KEY", "6LdOdsAsAAAAAHPw5OFtL757OAFc7SRJB618yE-D")
PASSWORD_RESET_EXPIRES_MINUTES = 30

PORTAL_CONFIG = {
    "unknown": {
        "secret_key": USER_SECRET_KEY,
        "token_type": "user",
        "expires_minutes": 1440,
        "captcha_threshold": 3,
        "lockout_duration": 120,
        "issuer_name": "WARDS Portal",
    },
    "public": {
        "secret_key": USER_SECRET_KEY,
        "token_type": "user",
        "expires_minutes": 1440,
        "captcha_threshold": 3,
        "lockout_duration": 120,
        "issuer_name": "WARDS Public Portal",
    },
    "admin": {
        "secret_key": ADMIN_SECRET_KEY,
        "token_type": "admin",
        "expires_minutes": 30,
        "captcha_threshold": 3,
        "lockout_duration": 120,
        "issuer_name": "WARDS Admin Portal",
    },
    "branch": {
        "secret_key": BRANCH_SECRET_KEY,
        "token_type": "branch",
        "expires_minutes": 480,
        "captcha_threshold": 3,
        "lockout_duration": 120,
        "issuer_name": "WARDS Branch Portal",
    },
}

MAX_LOGIN_ATTEMPTS = 5
RATE_LIMIT_WINDOW = 60
MAX_REQUESTS_PER_WINDOW = 30
MFA_VALID_WINDOW_STEPS = 2

login_attempts = {}
locked_accounts = {}


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


class UnifiedToken(BaseModel):
    access_token: str
    token_type: str
    portal: str
    user: dict
    requires_mfa: Optional[bool] = False
    requires_captcha: Optional[bool] = False


class UnifiedPasswordResetRequest(BaseModel):
    email: EmailStr
    portal: Optional[str] = None


class UnifiedPasswordResetConfirm(BaseModel):
    token: str
    new_password: str


def normalize_identifier(identifier: str) -> str:
    value = identifier.strip()
    return value.lower() if "@" in value else value


def slugify_branch_name(name: str) -> str:
    value = "".join(char.lower() if char.isalnum() else "-" for char in name.strip())
    slug = "-".join(part for part in value.split("-") if part)
    return slug or "branch"


def get_branch_dashboard_url(account: object) -> str:
    branch = getattr(account, "branch", None)
    if branch and getattr(branch, "dashboard_url", None):
        return branch.dashboard_url

    base_url = os.getenv("FRONTEND_BASE_URL", "http://localhost:3000").rstrip("/")
    branch_name = getattr(branch, "name", "") if branch else ""
    if branch_name:
        return f"{base_url}/branch-dashboard/{slugify_branch_name(branch_name)}"

    branch_id = getattr(account, "branch_id", None)
    return f"{base_url}/branch-dashboard/branch-{branch_id or 'portal'}"


def tracking_key(portal: str, identifier: str) -> str:
    return f"{portal}:{normalize_identifier(identifier)}"


def clear_tracking(identifier: str):
    normalized = normalize_identifier(identifier)
    for portal in PORTAL_CONFIG.keys():
        key = f"{portal}:{normalized}"
        if key in locked_accounts:
            del locked_accounts[key]


def check_rate_limit(ip_address: str) -> bool:
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
    return True


def is_account_locked(portal: str, identifier: str) -> bool:
    key = tracking_key(portal, identifier)
    if key in locked_accounts:
        lock_time = locked_accounts[key]["locked_at"]
        duration = PORTAL_CONFIG[portal]["lockout_duration"]
        if lock_time and time.time() - lock_time < duration:
            return True
        del locked_accounts[key]
    return False


def record_failed_attempt(portal: str, identifier: str):
    key = tracking_key(portal, identifier)
    if key not in locked_accounts:
        locked_accounts[key] = {"attempts": 0, "locked_at": None}

    locked_accounts[key]["attempts"] += 1
    if locked_accounts[key]["attempts"] >= MAX_LOGIN_ATTEMPTS:
        locked_accounts[key]["locked_at"] = time.time()


def reset_failed_attempts(portal: str, identifier: str):
    key = tracking_key(portal, identifier)
    if key in locked_accounts:
        del locked_accounts[key]


def requires_captcha(portal: str, identifier: str) -> bool:
    key = tracking_key(portal, identifier)
    if key not in locked_accounts:
        return False
    return locked_accounts[key]["attempts"] >= PORTAL_CONFIG[portal]["captcha_threshold"]


def verify_recaptcha(token: str, client_ip: str) -> bool:
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
        return response.json().get("success", False)
    except Exception as exc:
        print(f"[UNIFIED AUTH] reCAPTCHA verification error: {exc}")
        return False


def create_access_token(portal: str, data: dict) -> str:
    expires_delta = timedelta(minutes=PORTAL_CONFIG[portal]["expires_minutes"])
    to_encode = data.copy()
    to_encode["exp"] = datetime.utcnow() + expires_delta
    return jwt.encode(to_encode, PORTAL_CONFIG[portal]["secret_key"], algorithm=ALGORITHM)


def log_activity(db: Session, action: str, user: str, details: str, log_type: str = "auth"):
    db.add(ActivityLog(action=action, user=user, details=details, type=log_type))
    db.commit()


def find_account(db: Session, identifier: str) -> Tuple[Optional[str], Optional[object]]:
    normalized = normalize_identifier(identifier)

    if "@" in normalized:
        public_user = find_citizen_by_email(db, CitizenUser, normalized)
        if public_user:
            return "public", public_user

        admin = db.query(Admin).filter(Admin.email == normalized).first()
        if admin:
            return "admin", admin

        branch_staff = db.query(BranchStaff).filter(BranchStaff.email == normalized).first()
        if branch_staff:
            return "branch", branch_staff

    admin = db.query(Admin).filter(Admin.username == identifier.strip()).first()
    if admin:
        return "admin", admin

    branch_staff = db.query(BranchStaff).filter(BranchStaff.username == identifier.strip()).first()
    if branch_staff:
        return "branch", branch_staff

    return None, None


def find_account_for_portal(db: Session, identifier: str, requested_portal: Optional[str]) -> Tuple[Optional[str], Optional[object]]:
    normalized = normalize_identifier(identifier)
    portal = (requested_portal or "").strip().lower()

    if portal == "public":
        if "@" not in normalized:
            return None, None
        public_user = find_citizen_by_email(db, CitizenUser, normalized)
        return ("public", public_user) if public_user else (None, None)

    if portal == "admin":
        if "@" in normalized:
            admin = db.query(Admin).filter(Admin.email == normalized).first()
        else:
            admin = db.query(Admin).filter(Admin.username == identifier.strip()).first()
        return ("admin", admin) if admin else (None, None)

    if portal == "branch":
        if "@" in normalized:
            branch_staff = db.query(BranchStaff).filter(BranchStaff.email == normalized).first()
        else:
            branch_staff = db.query(BranchStaff).filter(BranchStaff.username == identifier.strip()).first()
        return ("branch", branch_staff) if branch_staff else (None, None)

    return find_account(db, identifier)


def get_mfa_secret(db: Session, portal: str, username: str) -> Optional[str]:
    record = find_mfa_secret_record(db, MFASecret, portal, username, enabled_only=True)
    return (get_decrypted_or_raw(record, "secret") or record.secret) if record else None


def save_mfa_secret(db: Session, portal: str, username: str, secret: str):
    record = find_mfa_secret_record(db, MFASecret, portal, username)
    if record:
        record.portal = portal
        record.username = username
        record.secret = secret
        record.enabled = True
        apply_mfa_secret_security(record)
    else:
        record = MFASecret(portal=portal, username=username, secret=secret, enabled=True)
        apply_mfa_secret_security(record)
        db.add(record)
    db.commit()


def build_user_response(portal: str, account: object) -> dict:
    if portal == "public":
        profile = serialize_citizen_user(account)
        return {
            "id": account.id,
            "email": profile["email"],
            "role": "public",
            "full_name": profile["full_name"],
            "contact_number": profile["contact_number"],
            "address": profile["address"],
        }

    if portal == "admin":
        return {
            "id": account.id,
            "username": account.username,
            "email": account.email,
            "role": "admin",
            "internal_role": account.role,
            "status": account.status,
            "mfa_setup_required": False,
        }

    return {
        "id": account.id,
        "username": account.username,
        "email": account.email,
        "full_name": account.full_name,
        "role": "branch",
        "internal_role": account.role,
        "branch_id": account.branch_id,
        "dashboard_url": get_branch_dashboard_url(account),
        "status": account.status,
        "account_scope": getattr(account, "account_scope", "full_branch"),
        "service_window": getattr(account, "service_window", None),
        "mfa_setup_required": False,
    }


def build_token_payload(portal: str, account: object) -> dict:
    if portal == "public":
        profile = serialize_citizen_user(account)
        return {
            "sub": profile["email"],
            "user_id": account.id,
            "role": "public",
            "type": "user",
        }

    if portal == "admin":
        return {
            "sub": account.username,
            "user_id": account.id,
            "role": "admin",
            "internal_role": account.role,
            "type": "admin",
        }

    return {
        "sub": account.username,
        "user_id": account.id,
        "role": "branch",
        "internal_role": account.role,
        "branch_id": account.branch_id,
        "account_scope": getattr(account, "account_scope", "full_branch"),
        "service_window": getattr(account, "service_window", None),
        "type": "branch",
    }


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


def validate_reset_password(password: str):
    password_bytes = password.encode("utf-8")
    message = (
        "Password must be more than 12 characters long and include at least one uppercase letter, "
        "one lowercase letter, and at least one number or special character."
    )

    if len(password) <= 12:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)
    if len(password_bytes) > 72:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password is too long for secure processing. Please use 72 bytes or fewer.",
        )
    if not any(char.isupper() for char in password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)
    if not any(char.islower() for char in password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)
    if not any(char.isdigit() or not char.isalnum() for char in password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


def get_account_email(portal: str, account: object) -> str:
    if portal == "public":
        return serialize_citizen_user(account)["email"]
    return account.email


def get_account_identifier(portal: str, account: object) -> str:
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


def generate_mfa_payload(portal: str, username: str, secret: str) -> dict:
    issuer_name = PORTAL_CONFIG[portal]["issuer_name"]
    totp_uri = pyotp.TOTP(secret).provisioning_uri(name=username, issuer_name=issuer_name)

    qr = qrcode.QRCode(version=1, box_size=10, border=5)
    qr.add_data(totp_uri)
    qr.make(fit=True)

    image = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")

    return {
        "message": "MFA setup successful",
        "portal": portal,
        "qr_code": f"data:image/png;base64,{base64.b64encode(buffer.getvalue()).decode()}",
        "manual_entry_key": secret,
    }


@router.post("/login", response_model=UnifiedToken)
async def unified_login(request: Request, credentials: UnifiedLoginRequest, db: Session = Depends(get_db)):
    client_ip = request.client.host

    if not check_rate_limit(client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Please try again later.",
        )

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
                detail=f"Account is locked. Please try again in {wait_message}.",
            )

        record_failed_attempt("unknown", credentials.identifier)
        headers = {}
        if requires_captcha("unknown", credentials.identifier):
            headers["X-Requires-Captcha"] = "true"
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials. Please check your email or username and password.",
            headers=headers,
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
            detail=f"Account is locked. Please try again in {wait_message}.",
            headers={"X-Auth-Portal": portal},
        )

    password_valid = pwd_context.verify(credentials.password, account.hashed_password)
    if not password_valid:
        record_failed_attempt(portal, credentials.identifier)
        log_activity(
            db,
            "Failed Unified Login",
            credentials.identifier,
            f"Portal: {portal}, IP: {client_ip}",
            "security",
        )

        if requires_captcha(portal, credentials.identifier):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials. Please complete the captcha.",
                headers={"X-Requires-Captcha": "true", "X-Auth-Portal": portal},
            )

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials. Please check your email or username and password.",
            headers={"X-Auth-Portal": portal},
        )

    if portal == "branch" and (
        getattr(account, "status", "Active") == "Pending Verification"
        or not getattr(account, "is_verified", True)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Login failed. This branch account has not been verified yet. Please verify the registered email before logging in.",
            headers={"X-Auth-Portal": portal},
        )

    if portal == "public" and not getattr(account, "is_verified", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is not verified yet. Enter the OTP code sent to your email to continue.",
            headers={
                "X-Auth-Portal": portal,
                "X-Requires-Email-Verification": "true",
            },
        )

    if getattr(account, "status", "Active") != "Active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is not active",
            headers={"X-Auth-Portal": portal},
        )

    if requires_captcha(portal, credentials.identifier):
        if not credentials.recaptcha_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="reCAPTCHA verification required",
                headers={"X-Requires-Captcha": "true", "X-Auth-Portal": portal},
            )

        if not verify_recaptcha(credentials.recaptcha_token, client_ip):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="reCAPTCHA verification failed",
                headers={"X-Auth-Portal": portal},
            )

    if portal in {"admin", "branch"}:
        mfa_secret = get_mfa_secret(db, portal, account.username)
        if not mfa_secret:
            headers = {
                "X-Requires-MFA-Setup": "true",
                "X-Auth-Portal": portal,
            }
            if requires_captcha(portal, credentials.identifier):
                headers["X-Requires-Captcha"] = "true"
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="MFA not configured. Please setup MFA first.",
                headers=headers,
            )

        if not credentials.totp_code:
            return {
                "access_token": "",
                "token_type": "bearer",
                "portal": portal,
                "user": {
                    "username": account.username,
                    "email": account.email,
                },
                "requires_mfa": True,
                "requires_captcha": requires_captcha(portal, credentials.identifier),
            }

        totp = pyotp.TOTP(mfa_secret)
        if not totp.verify(credentials.totp_code, valid_window=MFA_VALID_WINDOW_STEPS):
            record_failed_attempt(portal, credentials.identifier)
            headers = {"X-Auth-Portal": portal}
            if requires_captcha(portal, credentials.identifier):
                headers["X-Requires-Captcha"] = "true"
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired authenticator code. Check that your device time is set automatically, then try again.",
                headers=headers,
            )

    reset_failed_attempts(portal, credentials.identifier)
    clear_tracking(credentials.identifier)

    access_token = create_access_token(portal, build_token_payload(portal, account))
    account.last_login = datetime.utcnow()
    if portal == "public":
        apply_citizen_user_security(account)
    db.commit()

    send_login_notification_email(
        recipient_email=get_account_email(portal, account),
        display_name=get_account_display_name(portal, account),
        account_type=get_account_type_label(portal, account),
        logged_in_at=account.last_login or datetime.utcnow(),
        ip_address=client_ip,
        user_agent=request.headers.get("user-agent"),
    )

    log_activity(
        db,
        "Successful Unified Login",
        credentials.identifier,
        f"Portal: {portal}, IP: {client_ip}",
        "security",
    )

    user_response = build_user_response(portal, account)
    if portal in {"admin", "branch"}:
        user_response["mfa_setup_required"] = get_mfa_secret(db, portal, account.username) is None

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "portal": portal,
        "user": user_response,
        "requires_mfa": False,
        "requires_captcha": False,
    }


@router.post("/setup-mfa")
async def unified_setup_mfa(request: Request, credentials: UnifiedSetupMFARequest, db: Session = Depends(get_db)):
    client_ip = request.client.host
    portal, account = find_account_for_portal(db, credentials.identifier, credentials.portal)

    if portal not in {"admin", "branch"} or not account:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="MFA setup is only available for staff and admin accounts.",
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
            detail="Invalid credentials",
            headers={"X-Auth-Portal": portal},
        )

    secret = pyotp.random_base32()
    save_mfa_secret(db, portal, account.username, secret)
    log_activity(
        db,
        "Unified MFA Setup Initiated",
        credentials.identifier,
        f"Portal: {portal}, IP: {client_ip}",
        "security",
    )
    return generate_mfa_payload(portal, account.username, secret)


@router.post("/request-password-reset")
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
async def unified_reset_password(
    request: Request,
    reset_data: UnifiedPasswordResetConfirm,
    db: Session = Depends(get_db),
):
    try:
        payload = jwt.decode(reset_data.token, PASSWORD_RESET_SECRET_KEY, algorithms=[ALGORITHM])
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

    validate_reset_password(reset_data.new_password)

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
