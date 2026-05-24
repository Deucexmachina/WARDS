"""
User Authentication (Citizens)
Security Level: STANDARD
- Email + Password login
- reCAPTCHA after repeated failed attempts
- Password reset functionality
- Activity logging
- Rate limiting
"""
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta
from typing import Optional
import os
import secrets
import requests
import time
import hashlib

from database.models import Admin, Branch, BranchStaff, CitizenUser, ActivityLog, EmailOTP, EmailVerificationToken, Invite, get_db
from services.email_service import (
    send_citizen_verification_email,
    send_registration_confirmation_email,
    smtp_is_configured,
)
from utils.field_crypto import apply_citizen_user_security, apply_email_otp_security, apply_email_verification_token_security, find_invite_by_token, get_decrypted_or_raw, hash_optional_value, serialize_citizen_user, find_citizen_by_email
from utils.system_settings import get_setting_value
from utils.security_validation import (
    DUPLICATE_EMAIL_MESSAGE,
    ensure_email_is_unique,
    ensure_tin_is_unique,
    format_tin,
    normalize_citizen_full_name,
    normalize_email,
    normalize_ph_contact_number,
    normalize_tin,
    validate_strong_password,
)

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
SERVER_STARTED_AT = datetime.utcnow().isoformat()

SECRET_KEY = os.getenv("USER_SECRET_KEY", "your-user-secret-key-change-in-production")
ADMIN_SECRET_KEY = os.getenv("ADMIN_SECRET_KEY", "your-admin-secret-key-change-in-production-immediately")
BRANCH_SECRET_KEY = os.getenv("BRANCH_SECRET_KEY", "your-branch-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 1440  # 24 hours
RECAPTCHA_SECRET_KEY = os.getenv("RECAPTCHA_SECRET_KEY", "6LdOdsAsAAAAAHPw5OFtL757OAFc7SRJB618yE-D")

# Security tracking
login_attempts = {}
locked_accounts = {}
password_reset_tokens = {}

MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_DURATION = 300  # 5 minutes
CAPTCHA_THRESHOLD = 3
RATE_LIMIT_WINDOW = 60
MAX_REQUESTS_PER_WINDOW = 20  # More lenient for public users
EMAIL_VERIFICATION_OTP_EXPIRES_MINUTES = 10
EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS = 120
EMAIL_VERIFICATION_ROLE = "public_verification"

class UserRegisterRequest(BaseModel):
    email: EmailStr
    full_name: str
    tin: Optional[str] = None
    contact_number: str
    password: str
    address: Optional[str] = None
    recaptcha_token: Optional[str] = None

class InviteRegisterRequest(BaseModel):
    email: EmailStr
    password: str
    invite_token: str

class UserLoginRequest(BaseModel):
    email: EmailStr
    password: str
    recaptcha_token: Optional[str] = None

class PasswordResetRequest(BaseModel):
    email: EmailStr
    recaptcha_token: str

class PasswordResetConfirm(BaseModel):
    email: EmailStr
    reset_token: str
    new_password: str

class Token(BaseModel):
    access_token: Optional[str] = None
    token_type: str
    user: Optional[dict] = None
    requires_captcha: Optional[bool] = False
    requires_email_verification: Optional[bool] = False
    message: Optional[str] = None
    resend_available_in_seconds: Optional[int] = None


class EmailVerificationOtpRequest(BaseModel):
    email: EmailStr


class EmailVerificationOtpConfirm(BaseModel):
    email: EmailStr
    code: str


def validate_public_password(password: str):
    validate_strong_password(password)


def hash_email_verification_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def generate_email_verification_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def find_active_email_otp(db: Session, email: str) -> Optional[EmailOTP]:
    now = datetime.utcnow()
    email_hash = hash_optional_value(email)
    role_hash = hash_optional_value(EMAIL_VERIFICATION_ROLE)
    return (
        db.query(EmailOTP)
        .filter(
            EmailOTP.email_hash == email_hash,
            EmailOTP.role_hash == role_hash,
            EmailOTP.consumed_at.is_(None),
            EmailOTP.expires_at > now,
        )
        .order_by(EmailOTP.created_at.desc(), EmailOTP.id.desc())
        .first()
    )


def issue_email_verification_otp(
    db: Session,
    user: CitizenUser,
    *,
    allow_recent_existing: bool = False,
) -> tuple[EmailOTP, int]:
    now = datetime.utcnow()
    active_otp = find_active_email_otp(db, serialize_citizen_user(user)["email"])

    if active_otp and active_otp.last_sent_at:
        elapsed = int((now - active_otp.last_sent_at).total_seconds())
        remaining = max(EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS - elapsed, 0)
        if remaining > 0:
            if allow_recent_existing:
                return active_otp, remaining
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Please wait {remaining} seconds before requesting another verification code.",
            )

    if active_otp:
        active_otp.consumed_at = now

    verification_code = generate_email_verification_code()
    otp_record = EmailOTP(
        email=serialize_citizen_user(user)["email"],
        role=EMAIL_VERIFICATION_ROLE,
        code_hash=hash_email_verification_code(verification_code),
        expires_at=now + timedelta(minutes=EMAIL_VERIFICATION_OTP_EXPIRES_MINUTES),
        attempts=0,
        resend_count=(active_otp.resend_count + 1) if active_otp else 0,
        last_sent_at=now,
    )
    db.add(otp_record)
    db.flush()
    apply_email_otp_security(otp_record)

    email_result = send_citizen_verification_email(
        recipient_email=serialize_citizen_user(user)["email"],
        verification_code=verification_code,
        expires_minutes=EMAIL_VERIFICATION_OTP_EXPIRES_MINUTES,
    )
    if not email_result["sent"]:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=email_result["message"],
        )

    return otp_record, EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None, secret_key: str = SECRET_KEY):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, secret_key, algorithm=ALGORITHM)
    return encoded_jwt


def get_session_timeout_minutes(db: Session) -> int:
    configured_timeout = int(get_setting_value(db, "sessionTimeout") or ACCESS_TOKEN_EXPIRE_MINUTES)
    return max(configured_timeout, 30)


def get_max_login_attempts(db: Session) -> int:
    return int(get_setting_value(db, "maxLoginAttempts") or MAX_LOGIN_ATTEMPTS)


def build_public_user_response(user: CitizenUser) -> dict:
    profile = serialize_citizen_user(user)
    return {
        "id": user.id,
        "email": profile["email"],
        "role": "public",
        "full_name": profile["full_name"],
        "tin": format_tin(profile["tin"]),
        "contact_number": profile["contact_number"],
        "address": profile["address"],
    }

def public_role(role: str) -> str:
    if role in {"branch", "branch_admin", "branch_staff"}:
        return "branch"
    if role in {"admin", "main_admin"}:
        return "admin"
    return "public"

def make_unique_username(db: Session, model, email: str):
    base = email.split("@", 1)[0].replace(".", "_").replace("-", "_")
    username = base
    counter = 1
    while db.query(model).filter(model.username == username).first():
        counter += 1
        username = f"{base}_{counter}"
    return username

def verify_recaptcha(token: str, client_ip: str) -> bool:
    """Verify reCAPTCHA token with Google"""
    try:
        response = requests.post(
            'https://www.google.com/recaptcha/api/siteverify',
            data={
                'secret': RECAPTCHA_SECRET_KEY,
                'response': token,
                'remoteip': client_ip
            },
            timeout=5
        )
        result = response.json()
        return result.get('success', False)
    except Exception as e:
        print(f"[USER AUTH] reCAPTCHA verification error: {e}")
        return False

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

def is_account_locked(email: str) -> bool:
    if email in locked_accounts:
        lock_time = locked_accounts[email]["locked_at"]
        if time.time() - lock_time < LOCKOUT_DURATION:
            return True
        else:
            del locked_accounts[email]
    return False

def record_failed_attempt(email: str, db: Session):
    if email not in locked_accounts:
        locked_accounts[email] = {"attempts": 0, "locked_at": None}
    locked_accounts[email]["attempts"] += 1
    if locked_accounts[email]["attempts"] >= get_max_login_attempts(db):
        locked_accounts[email]["locked_at"] = time.time()

def reset_failed_attempts(email: str):
    if email in locked_accounts:
        del locked_accounts[email]

def requires_captcha(email: str) -> bool:
    if email in locked_accounts:
        return locked_accounts[email]["attempts"] >= CAPTCHA_THRESHOLD
    return False

def log_activity(db: Session, action: str, user: str, details: str, log_type: str = "user_auth"):
    log = ActivityLog(action=action, user=user, details=details, type=log_type)
    db.add(log)
    db.commit()

@router.post("/register", response_model=Token)
async def register_user(request: Request, user_data: UserRegisterRequest, db: Session = Depends(get_db)):
    """Register new citizen user"""
    client_ip = request.client.host
    
    if not check_rate_limit(client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please try again later."
        )
    
    # Verify reCAPTCHA for registration
    if user_data.recaptcha_token:
        if not verify_recaptcha(user_data.recaptcha_token, client_ip):
            log_activity(db, "Failed Registration reCAPTCHA", user_data.email, f"IP: {client_ip}", "security")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="reCAPTCHA verification failed"
            )
    
    normalized_email = normalize_email(user_data.email, check_deliverability=True)
    normalized_full_name = normalize_citizen_full_name(user_data.full_name)
    normalized_contact_number = normalize_ph_contact_number(user_data.contact_number)
    ensure_email_is_unique(db, normalized_email)
    normalized_tin = None
    if user_data.tin and user_data.tin.strip():
        normalized_tin = normalize_tin(user_data.tin)
        ensure_tin_is_unique(db, normalized_tin)

    validate_public_password(user_data.password)

    verification_required = smtp_is_configured()
    hashed_password = pwd_context.hash(user_data.password)
    new_user = CitizenUser(
        email=normalized_email,
        full_name=normalized_full_name,
        tin=normalized_tin,
        contact_number=normalized_contact_number,
        address=user_data.address,
        hashed_password=hashed_password,
        role="public",
        is_verified=not verification_required,
        status="Active"
    )

    db.add(new_user)
    db.flush()
    apply_citizen_user_security(new_user)

    if verification_required:
        issue_email_verification_otp(db, new_user, allow_recent_existing=False)

    db.commit()
    db.refresh(new_user)

    if verification_required:
        log_activity(db, "User Registration Pending Verification", serialize_citizen_user(new_user)["email"], f"New user registered from IP: {client_ip}", "user_auth")
        return {
            "access_token": None,
            "token_type": "pending",
            "user": {
                **build_public_user_response(new_user),
            },
            "requires_captcha": False,
            "requires_email_verification": True,
            "message": "We sent a 6-digit verification code to your email. Enter it to activate your account.",
            "resend_available_in_seconds": EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS,
        }

    access_token_expires = timedelta(minutes=get_session_timeout_minutes(db))
    access_token = create_access_token(
        data={
            "sub": serialize_citizen_user(new_user)["email"],
            "user_id": new_user.id,
            "role": "public",
            "type": "user"
        },
        expires_delta=access_token_expires
    )
    
    log_activity(db, "User Registration", serialize_citizen_user(new_user)["email"], f"New user registered from IP: {client_ip}", "user_auth")
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": build_public_user_response(new_user),
        "requires_captcha": False
    }


@router.post("/verification/request")
async def request_email_verification_otp(
    payload: EmailVerificationOtpRequest,
    db: Session = Depends(get_db),
):
    normalized_email = normalize_email(payload.email)
    user = find_citizen_by_email(db, CitizenUser, normalized_email)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Citizen account not found.",
        )

    if user.is_verified:
        return {
            "message": "This email is already verified. You can log in now.",
            "already_verified": True,
            "resend_available_in_seconds": 0,
        }

    otp_record, resend_wait = issue_email_verification_otp(db, user, allow_recent_existing=False)
    db.commit()

    return {
        "message": f"A new verification code was sent to {serialize_citizen_user(user)['email']}.",
        "already_verified": False,
        "resend_available_in_seconds": resend_wait,
        "expires_in_seconds": max(int((otp_record.expires_at - datetime.utcnow()).total_seconds()), 0),
    }


@router.post("/verification/confirm")
async def confirm_email_verification_otp(
    payload: EmailVerificationOtpConfirm,
    db: Session = Depends(get_db),
):
    normalized_email = normalize_email(payload.email)
    user = find_citizen_by_email(db, CitizenUser, normalized_email)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Citizen account not found.",
        )

    if user.is_verified:
        return {
            "message": "Your email is already verified. You can sign in now.",
            "already_verified": True,
        }

    active_otp = find_active_email_otp(db, serialize_citizen_user(user)["email"])
    if not active_otp:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active verification code was found. Please request a new one.",
        )

    submitted_code = (payload.code or "").strip()
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

    if active_otp.code_hash != hash_email_verification_code(submitted_code):
        active_otp.attempts = (active_otp.attempts or 0) + 1
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid verification code. Please try again.",
        )

    user.is_verified = True
    active_otp.consumed_at = datetime.utcnow()
    db.add(EmailVerificationToken(
        citizen_user_id=user.id,
        email=serialize_citizen_user(user)["email"],
        token=secrets.token_urlsafe(32),
        expires_at=datetime.utcnow(),
        used=True,
    ))
    db.flush()
    verification_token = db.query(EmailVerificationToken).filter(EmailVerificationToken.citizen_user_id == user.id).order_by(EmailVerificationToken.id.desc()).first()
    if verification_token:
        apply_email_verification_token_security(verification_token)
    db.commit()

    log_activity(db, "Citizen Email Verified", serialize_citizen_user(user)["email"], "Email verified with OTP.", "user_auth")

    return {
        "message": "Email verified successfully. You can now log in.",
        "already_verified": False,
    }

@router.post("/register/invite", response_model=Token)
async def register_invited_user(invite_data: InviteRegisterRequest, db: Session = Depends(get_db)):
    """Register an invited admin or branch user."""
    invite = find_invite_by_token(db, Invite, invite_data.invite_token)
    if not invite:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid invite token")
    if invite.used:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invite token has already been used")
    if invite.expires_at < datetime.utcnow():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invite token has expired")
    invite_email = (get_decrypted_or_raw(invite, "email") or invite.email).lower()
    invite_role = get_decrypted_or_raw(invite, "role") or invite.role
    if invite_email != invite_data.email.lower():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invite email does not match")
    if invite_role not in {"branch", "admin"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid invite role")

    normalized_email = normalize_email(invite_email)
    try:
        ensure_email_is_unique(db, normalized_email)
    except HTTPException as exc:
        if exc.detail == DUPLICATE_EMAIL_MESSAGE:
            raise
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=DUPLICATE_EMAIL_MESSAGE) from exc

    validate_public_password(invite_data.password)
    hashed_password = pwd_context.hash(invite_data.password)
    token_secret = SECRET_KEY
    token_type = "user"
    user_response = {}

    if invite_role == "admin":
        user = Admin(
            username=make_unique_username(db, Admin, normalized_email),
            email=normalized_email,
            hashed_password=hashed_password,
            role="main_admin",
            status="Active",
            is_verified=True,
        )
        db.add(user)
        db.flush()
        token_secret = ADMIN_SECRET_KEY
        token_type = "admin"
        user_response = {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "role": "admin",
            "status": user.status,
        }
    else:
        default_branch = db.query(Branch).order_by(Branch.id.asc()).first()
        if not default_branch:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one branch is required before creating branch users")

        user = BranchStaff(
            username=make_unique_username(db, BranchStaff, normalized_email),
            email=normalized_email,
            full_name=normalized_email.split("@", 1)[0],
            hashed_password=hashed_password,
            branch_id=default_branch.id,
            role="branch_staff",
            status="Active",
            is_verified=True,
        )
        db.add(user)
        db.flush()
        token_secret = BRANCH_SECRET_KEY
        token_type = "branch"
        user_response = {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "full_name": user.full_name,
            "role": "branch",
            "branch_id": user.branch_id,
            "status": user.status,
        }

    invite.used = True
    db.add(ActivityLog(
        action="Invite Registration",
        user=invite_email,
        details=f"Registered invited {invite_role} user",
        type="invite_auth",
    ))
    db.commit()

    access_token = create_access_token(
        data={
            "sub": user.username if invite.role in {"admin", "branch"} else user.email,
            "email": user.email,
            "user_id": user.id,
            "role": invite_role,
            "type": token_type,
        },
        expires_delta=timedelta(minutes=get_session_timeout_minutes(db)),
        secret_key=token_secret,
    )

    send_registration_confirmation_email(
        recipient_email=user.email,
        display_name=getattr(user, "full_name", None) or getattr(user, "username", None) or user.email,
        account_type="admin" if invite_role == "admin" else "branch_staff",
        registered_at=datetime.utcnow(),
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": user_response,
        "requires_captcha": False,
    }

@router.post("/login", response_model=Token)
@router.get("/verify-email", response_class=HTMLResponse)
async def verify_email(token: str, db: Session = Depends(get_db)):
    token_hash = hash_optional_value(token)
    token_record = (
        db.query(EmailVerificationToken)
        .filter(EmailVerificationToken.token_hash == token_hash, EmailVerificationToken.used.is_(False))
        .first()
    )
    if not token_record:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid verification token")
    if token_record.expires_at < datetime.utcnow():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Verification token has expired")

    user = db.query(CitizenUser).filter(CitizenUser.id == token_record.citizen_user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.is_verified = True
    token_record.used = True
    db.commit()

    return HTMLResponse(
        """
        <html>
          <body style="font-family:Arial,Helvetica,sans-serif;background:#f3f6fb;padding:40px;color:#1f2937;">
            <div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:18px;padding:32px;box-shadow:0 18px 40px rgba(15,39,68,.10);">
              <h1 style="margin:0 0 16px;color:#166534;">Email Verified</h1>
              <p style="margin:0 0 12px;line-height:1.7;">Your WARDS account has been verified successfully.</p>
              <p style="margin:0;line-height:1.7;">You can now return to WARDS and sign in with your email and password.</p>
            </div>
          </body>
        </html>
        """
    )


@router.post("/login", response_model=Token)
async def user_login(request: Request, credentials: UserLoginRequest, db: Session = Depends(get_db)):
    """User login with email, password, and conditional reCAPTCHA"""
    client_ip = request.client.host
    
    if not check_rate_limit(client_ip):
        log_activity(db, "Login Rate Limited", credentials.email, f"IP: {client_ip}", "security")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Please try again later."
        )
    
    if is_account_locked(credentials.email):
        remaining_time = int(LOCKOUT_DURATION - (time.time() - locked_accounts[credentials.email]["locked_at"]))
        log_activity(db, "Login Attempt on Locked Account", credentials.email, f"IP: {client_ip}", "security")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Account is locked. Please try again in {remaining_time // 60} minutes."
        )
    
    normalized_email = normalize_email(credentials.email)
    user = find_citizen_by_email(db, CitizenUser, normalized_email)
    
    print(f"[USER AUTH] Login attempt for email: {credentials.email}")
    print(f"[USER AUTH] User found: {user is not None}")
    
    if not user:
        record_failed_attempt(normalized_email, db)
        log_activity(db, "Failed Login", normalized_email, f"User not found, IP: {client_ip}", "security")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    
    password_valid = pwd_context.verify(credentials.password, user.hashed_password)
    
    if not password_valid:
        record_failed_attempt(normalized_email, db)
        log_activity(db, "Failed Login", normalized_email, f"Invalid password, IP: {client_ip}", "security")
        
        needs_captcha = requires_captcha(normalized_email)
        if needs_captcha:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials. Please complete the captcha.",
                headers={"X-Requires-Captcha": "true"}
            )
        
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    
    # Verify reCAPTCHA if required
    if requires_captcha(normalized_email):
        if not credentials.recaptcha_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="reCAPTCHA verification required",
                headers={"X-Requires-Captcha": "true"}
            )
        
        if not verify_recaptcha(credentials.recaptcha_token, client_ip):
            log_activity(db, "Failed reCAPTCHA", normalized_email, f"IP: {client_ip}", "security")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="reCAPTCHA verification failed"
            )
    
    if user.status != "Active":
        log_activity(db, "Login Attempt for Inactive Account", normalized_email, f"Status: {user.status}, IP: {client_ip}", "security")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is not active"
        )

    if not user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email before logging in.",
        )
    
    # All checks passed - create token
    reset_failed_attempts(normalized_email)
    
    access_token_expires = timedelta(minutes=get_session_timeout_minutes(db))
    access_token = create_access_token(
        data={
            "sub": serialize_citizen_user(user)["email"],
            "user_id": user.id,
            "role": "public",
            "type": "user"
        },
        expires_delta=access_token_expires
    )
    
    user.last_login = datetime.utcnow()
    apply_citizen_user_security(user)
    db.commit()
    
    log_activity(db, "Successful User Login", normalized_email, f"IP: {client_ip}", "user_auth")
    
    print(f"[USER AUTH] Login successful for {credentials.email}")
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": build_public_user_response(user),
        "requires_captcha": False
    }

@router.post("/request-password-reset")
async def request_password_reset(request: Request, reset_request: PasswordResetRequest, db: Session = Depends(get_db)):
    """Request password reset token"""
    client_ip = request.client.host
    
    # Verify reCAPTCHA
    if not verify_recaptcha(reset_request.recaptcha_token, client_ip):
        log_activity(db, "Failed Password Reset reCAPTCHA", reset_request.email, f"IP: {client_ip}", "security")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="reCAPTCHA verification failed"
        )
    
    user = find_citizen_by_email(db, CitizenUser, reset_request.email)
    
    # Always return success to prevent email enumeration
    if user:
        reset_token = secrets.token_urlsafe(32)
        password_reset_tokens[reset_request.email] = {
            "token": reset_token,
            "expires_at": time.time() + 1800  # 30 minutes
        }
        
        log_activity(db, "Password Reset Requested", reset_request.email, f"IP: {client_ip}", "user_auth")
        
        # In production, send email with reset link
        print(f"[USER AUTH] Password reset token for {reset_request.email}: {reset_token}")
        
        return {
            "message": "If the email exists, a password reset link has been sent.",
            "reset_token": reset_token  # Remove in production
        }
    
    return {"message": "If the email exists, a password reset link has been sent."}

@router.post("/reset-password")
async def reset_password(request: Request, reset_data: PasswordResetConfirm, db: Session = Depends(get_db)):
    """Reset password with token"""
    client_ip = request.client.host
    
    if reset_data.email not in password_reset_tokens:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token"
        )
    
    token_data = password_reset_tokens[reset_data.email]
    
    if time.time() > token_data["expires_at"]:
        del password_reset_tokens[reset_data.email]
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reset token has expired"
        )
    
    if reset_data.reset_token != token_data["token"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid reset token"
        )
    
    user = find_citizen_by_email(db, CitizenUser, reset_data.email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    validate_public_password(reset_data.new_password)

    # Update password
    user.hashed_password = pwd_context.hash(reset_data.new_password)
    db.commit()
    
    # Clear reset token
    del password_reset_tokens[reset_data.email]
    
    # Clear any lockouts
    reset_failed_attempts(reset_data.email)
    
    log_activity(db, "Password Reset Completed", reset_data.email, f"IP: {client_ip}", "user_auth")
    
    return {"message": "Password reset successful"}

@router.post("/logout")
async def user_logout(request: Request, db: Session = Depends(get_db)):
    """User logout"""
    client_ip = request.client.host
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            email = payload.get("sub")
            log_activity(db, "User Logout", email or "Unknown", f"IP: {client_ip}", "user_auth")
        except:
            pass
    return {"message": "Logged out successfully"}

@router.get("/verify")
async def verify_token(request: Request, db: Session = Depends(get_db)):
    """Verify user token"""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authorization header"
        )
    
    token = auth_header.split(" ")[1]
    
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("sub")
        token_type = payload.get("type")
        
        if token_type != "user":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid token type"
            )
        
        user = find_citizen_by_email(db, CitizenUser, email)
        if not user or user.status != "Active":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or inactive"
            )
        
        return {
            "valid": True,
            "server_started_at": SERVER_STARTED_AT,
            "user": build_public_user_response(user)
        }
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token"
        )
