"""
Branch Authentication with TOTP MFA and reCAPTCHA
Security Level: HIGH
- TOTP-based MFA (Microsoft Authenticator compatible)
- reCAPTCHA after 3 failed attempts
- Account lockout after 5 failed attempts
- RBAC enforcement
- Comprehensive activity logging
"""
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta
from typing import Optional
import os
import pyotp
import qrcode
import io
import base64
import requests
import time
import re
from urllib.parse import urlparse
from html import escape

from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from database.models import Branch, BranchStaff, ActivityLog, Invite, MFASecret, get_db
from middleware.branch_auth import require_branch_admin
from utils.field_crypto import apply_mfa_secret_security, find_invite_by_token, find_mfa_secret_record, get_decrypted_or_raw
from utils.system_settings import get_setting_value

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
SERVER_STARTED_AT = datetime.utcnow().isoformat()


def is_safe_url(url: str) -> bool:
    """
    Validate that a URL is safe for use in href attributes.
    Only allows http:// and https:// schemes.
    Rejects javascript:, data:, vbscript:, and malformed URLs.
    
    Implements OWASP XSS Prevention Cheat Sheet Rule #3: Input Validation.
    
    Args:
        url: The URL string to validate
        
    Returns:
        True if the URL is safe, False otherwise
    """
    if not url or not isinstance(url, str):
        return False
    
    try:
        parsed = urlparse(url)
        # Only allow http and https schemes
        if parsed.scheme not in ("http", "https"):
            return False
        # Ensure there's a scheme present (prevents protocol-relative URLs like //evil.com)
        if not parsed.scheme:
            return False
        # Ensure there's a netloc (domain) present
        if not parsed.netloc:
            return False
        return True
    except Exception:
        # Malformed URL
        return False

# Rate limiting configuration
limiter = Limiter(key_func=get_remote_address)

SECRET_KEY = os.getenv("BRANCH_SECRET_KEY", "your-branch-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 480  # 8 hours
RECAPTCHA_SECRET_KEY = os.getenv("RECAPTCHA_SECRET_KEY", "6LdOdsAsAAAAAHPw5OFtL757OAFc7SRJB618yE-D")

# Security tracking
login_attempts = {}
locked_accounts = {}

MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_DURATION = 120  # 2 minutes
CAPTCHA_THRESHOLD = 3
RATE_LIMIT_WINDOW = 60
MAX_REQUESTS_PER_WINDOW = 30

class BranchLoginRequest(BaseModel):
    email: str
    password: str
    totp_code: Optional[str] = None
    recaptcha_token: Optional[str] = None

class BranchSetupMFARequest(BaseModel):
    email: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    user: dict
    requires_mfa: Optional[bool] = False
    requires_captcha: Optional[bool] = False

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def get_session_timeout_minutes(db: Session) -> int:
    configured_timeout = int(get_setting_value(db, "sessionTimeout") or 30)
    return max(configured_timeout, 30)


def get_max_login_attempts(db: Session) -> int:
    return int(get_setting_value(db, "maxLoginAttempts") or MAX_LOGIN_ATTEMPTS)

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

def is_account_locked(username: str) -> bool:
    if username in locked_accounts:
        lock_time = locked_accounts[username]["locked_at"]
        if time.time() - lock_time < LOCKOUT_DURATION:
            return True
        else:
            del locked_accounts[username]
    return False

def record_failed_attempt(username: str, db: Session):
    if username not in locked_accounts:
        locked_accounts[username] = {"attempts": 0, "locked_at": None}
    locked_accounts[username]["attempts"] += 1
    if locked_accounts[username]["attempts"] >= get_max_login_attempts(db):
        locked_accounts[username]["locked_at"] = time.time()

def reset_failed_attempts(username: str):
    if username in locked_accounts:
        del locked_accounts[username]

def requires_captcha(username: str) -> bool:
    if username in locked_accounts:
        return locked_accounts[username]["attempts"] >= CAPTCHA_THRESHOLD
    return False

def log_activity(db: Session, action: str, user: str, details: str, log_type: str = "branch_auth"):
    log = ActivityLog(action=action, user=user, details=details, type=log_type)
    db.add(log)
    db.commit()

def get_mfa_secret(db: Session, username: str) -> Optional[str]:
    mfa = find_mfa_secret_record(db, MFASecret, "branch", username, enabled_only=True)
    return (get_decrypted_or_raw(mfa, "secret") or mfa.secret) if mfa else None

def save_mfa_secret(db: Session, username: str, secret: str):
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

def public_role(role: str) -> str:
    return "branch" if role in {"branch", "branch_admin", "branch_staff"} else role


def get_window_display_label(staff: BranchStaff) -> str | None:
    if not staff.service_window:
        return None
    return staff.service_window_label or {
        "RPT": "RPT Window",
        "BUSINESS": "BT Window",
        "MISC": "MISC Window",
        "QW4": "Queue Window 4",
        "QW5": "Queue Window 5",
    }.get(staff.service_window, staff.service_window)


def get_assigned_window_number(staff: BranchStaff) -> int | None:
    if not staff.service_window:
        return None
    if staff.assigned_window_number:
        return staff.assigned_window_number
    return {
        "RPT": 1,
        "BUSINESS": 2,
        "MISC": 3,
        "QW4": 4,
        "QW5": 5,
    }.get(staff.service_window)


def slugify_branch_name(name: str) -> str:
    value = "".join(char.lower() if char.isalnum() else "-" for char in name.strip())
    slug = "-".join(part for part in value.split("-") if part)
    return slug or "branch"


def get_branch_dashboard_url(staff: BranchStaff) -> str:
    branch = getattr(staff, "branch", None)
    dashboard_url = get_decrypted_or_raw(branch, "dashboard_url") if branch else None
    if dashboard_url:
        return dashboard_url

    base_url = os.getenv("FRONTEND_BASE_URL", "http://localhost:3000").rstrip("/")
    branch_name = get_decrypted_or_raw(branch, "name") if branch else ""
    if branch_name:
        return f"{base_url}/branch-dashboard/{slugify_branch_name(branch_name)}"

    return f"{base_url}/branch-dashboard/branch-{staff.branch_id or 'portal'}"


def get_branch_window_accounts(db: Session, branch_id: int) -> list[BranchStaff]:
    if not branch_id:
        return []
    return (
        db.query(BranchStaff)
        .filter(
            BranchStaff.branch_id == branch_id,
            BranchStaff.role == "branch_staff",
            BranchStaff.account_scope == "queue_window",
            BranchStaff.status == "Active",
        )
        .order_by(BranchStaff.assigned_window_number.asc(), BranchStaff.id.asc())
        .all()
    )


def normalize_branch_email(email: str) -> str:
    return str(email).strip().lower()

@router.post("/setup-mfa")
async def setup_mfa(request: Request, credentials: BranchSetupMFARequest, db: Session = Depends(get_db)):
    """Setup TOTP-based MFA for branch staff"""
    client_ip = request.client.host
    normalized_email = normalize_branch_email(credentials.email)
    
    staff = db.query(BranchStaff).filter(BranchStaff.email == normalized_email).first()
    if not staff or not pwd_context.verify(credentials.password, staff.hashed_password):
        log_activity(db, "Failed MFA Setup", normalized_email, f"Invalid credentials from IP: {client_ip}", "security")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    
    totp_secret = pyotp.random_base32()
    save_mfa_secret(db, staff.username, totp_secret)
    
    totp_uri = pyotp.totp.TOTP(totp_secret).provisioning_uri(
        name=staff.username,
        issuer_name="WARDS Branch Portal"
    )
    
    qr = qrcode.QRCode(version=1, box_size=10, border=5)
    qr.add_data(totp_uri)
    qr.make(fit=True)
    
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format='PNG')
    qr_code_base64 = base64.b64encode(buffer.getvalue()).decode()
    
    log_activity(db, "MFA Setup Initiated", normalized_email, f"TOTP setup from IP: {client_ip}", "security")
    
    return {
        "message": "MFA setup successful",
        "totp_secret": totp_secret,
        "qr_code": f"data:image/png;base64,{qr_code_base64}",
        "manual_entry_key": totp_secret
    }


@router.post("/setup-mfa-authenticated")
async def setup_mfa_authenticated(
    request: Request,
    current_staff: BranchStaff = Depends(require_branch_admin()),
    db: Session = Depends(get_db),
):
    """Reset or re-enroll TOTP-based MFA for the authenticated branch admin."""
    client_ip = request.client.host

    totp_secret = pyotp.random_base32()
    save_mfa_secret(db, current_staff.username, totp_secret)

    totp_uri = pyotp.totp.TOTP(totp_secret).provisioning_uri(
        name=current_staff.username,
        issuer_name="WARDS Branch Portal"
    )

    qr = qrcode.QRCode(version=1, box_size=10, border=5)
    qr.add_data(totp_uri)
    qr.make(fit=True)

    img = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format='PNG')
    qr_code_base64 = base64.b64encode(buffer.getvalue()).decode()

    log_activity(db, "Authenticated MFA Reset Initiated", current_staff.username, f"IP: {client_ip}", "security")

    return {
        "message": "MFA setup successful",
        "totp_secret": totp_secret,
        "qr_code": f"data:image/png;base64,{qr_code_base64}",
        "manual_entry_key": totp_secret
    }

@router.post("/login", response_model=Token)
@limiter.limit("5/minute")
async def branch_login(request: Request, credentials: BranchLoginRequest, db: Session = Depends(get_db)):
    """Branch login with TOTP MFA and reCAPTCHA"""
    client_ip = request.client.host
    normalized_email = normalize_branch_email(credentials.email)
    
    if is_account_locked(normalized_email):
        remaining_time = int(LOCKOUT_DURATION - (time.time() - locked_accounts[normalized_email]["locked_at"]))
        log_activity(db, "Login Attempt on Locked Account", normalized_email, f"IP: {client_ip}", "security")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Account is locked. Please try again in {remaining_time} seconds."
        )
    
    staff = db.query(BranchStaff).filter(BranchStaff.email == normalized_email).first()
    
    
    if not staff:
        record_failed_attempt(normalized_email, db)
        log_activity(db, "Failed Login", normalized_email, f"Staff not found, IP: {client_ip}", "security")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    
    password_valid = pwd_context.verify(credentials.password, staff.hashed_password)
    
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
    
    if staff.status == "Pending Verification" or not staff.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Login failed. This branch account has not been verified yet. Please verify the registered email before logging in."
        )

    if staff.status != "Active":
        log_activity(db, "Login Attempt for Inactive Account", normalized_email, f"Status: {staff.status}, IP: {client_ip}", "security")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is not active"
        )
    
    totp_secret = get_mfa_secret(db, staff.username)
    if not totp_secret:
        log_activity(db, "Login Without MFA Setup", normalized_email, f"IP: {client_ip}", "security")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="MFA not configured. Please setup MFA first.",
            headers={"X-Requires-MFA-Setup": "true"}
        )
    
    if not credentials.totp_code:
        return {
            "access_token": "",
            "token_type": "bearer",
            "user": {},
            "requires_mfa": True,
            "requires_captcha": requires_captcha(normalized_email)
        }
    
    totp = pyotp.TOTP(totp_secret)
    if not totp.verify(credentials.totp_code, valid_window=1):
        record_failed_attempt(normalized_email, db)
        log_activity(db, "Failed TOTP Verification", normalized_email, f"IP: {client_ip}", "security")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid TOTP code"
        )
    
    reset_failed_attempts(normalized_email)
    
    access_token_expires = timedelta(minutes=get_session_timeout_minutes(db))
    branch = db.query(Branch).filter(Branch.id == staff.branch_id).first() if staff.branch_id else None
    window_accounts = get_branch_window_accounts(db, staff.branch_id) if staff.role == "branch_admin" else []
    access_token = create_access_token(
        data={
            "sub": staff.username,
            "role": "branch",
            "internal_role": staff.role,
            "branch_id": staff.branch_id,
            "account_scope": staff.account_scope or "full_branch",
            "service_window": staff.service_window,
            "service_window_label": get_window_display_label(staff),
            "assigned_window_number": get_assigned_window_number(staff),
            "user_id": staff.id,
            "type": "branch"
        },
        expires_delta=access_token_expires
    )
    
    staff.last_login = datetime.utcnow()
    db.commit()
    
    _branch_name = (branch.name if branch else None) or f"Branch {staff.branch_id}"
    log_activity(db, "Successful Branch Login", normalized_email, f"branch: {_branch_name} | role: {staff.role} | ip: {client_ip}", "security")
    
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": staff.id,
            "username": staff.username,
            "email": staff.email,
            "full_name": staff.full_name,
            "role": public_role(staff.role),
            "internal_role": staff.role,
            "branch_id": staff.branch_id,
            "dashboard_url": get_branch_dashboard_url(staff),
            "status": staff.status,
            "account_scope": staff.account_scope or "full_branch",
            "service_window": staff.service_window,
            "service_window_label": get_window_display_label(staff),
            "window_label": get_window_display_label(staff),
            "assigned_window_number": get_assigned_window_number(staff),
            "branch_window_count": branch.counters if branch else None,
            "window_accounts": [
                {
                    "id": account.id,
                    "username": account.username,
                    "full_name": account.full_name,
                    "service_window": account.service_window,
                    "service_window_label": get_window_display_label(account),
                    "assigned_window_number": get_assigned_window_number(account),
                    "window_label": get_window_display_label(account),
                }
                for account in window_accounts
            ],
        },
        "requires_mfa": False,
        "requires_captcha": False
    }


@router.get("/verify-email", response_class=HTMLResponse)
async def verify_branch_email(token: str, db: Session = Depends(get_db)):
    status_title = "Branch Email Verification Failed"
    status_message = "This verification link is invalid or has already been used."
    status_color = "#b91c1c"
    status_background = "#fef2f2"
    status_border = "#fecaca"
    dashboard_url = None

    invite = find_invite_by_token(db, Invite, token)
    if invite and (((get_decrypted_or_raw(invite, "role") or invite.role) != "branch") or invite.used):
        invite = None
    if invite and invite.expires_at >= datetime.utcnow():
        staff = db.query(BranchStaff).filter(BranchStaff.email == (get_decrypted_or_raw(invite, "email") or invite.email)).first()
        if staff:
            staff.is_verified = True
            staff.status = "Active"
            invite.used = True
            db.commit()
            dashboard_url = get_branch_dashboard_url(staff)
            status_title = "Branch Email Verified"
            status_message = "Your branch access email has been verified successfully."
            status_color = "#166534"
            status_background = "#f0fdf4"
            status_border = "#86efac"
        else:
            status_message = "The branch staff account linked to this verification email could not be found."
    elif invite and invite.expires_at < datetime.utcnow():
        status_message = "This verification link has expired. Please request a new verification email."

    # Validate and encode dashboard_url to prevent XSS
    # Implements OWASP XSS Prevention Cheat Sheet Rule #3 (Input Validation) and Rule #1 (Output Encoding)
    safe_dashboard_url = None
    if dashboard_url and is_safe_url(dashboard_url):
        safe_dashboard_url = escape(dashboard_url, quote=True)
    
    # Escape all dynamic values for defense-in-depth
    safe_status_title = escape(status_title, quote=True)
    safe_status_message = escape(status_message, quote=True)
    safe_status_color = escape(status_color, quote=True)
    safe_status_background = escape(status_background, quote=True)
    safe_status_border = escape(status_border, quote=True)

    return HTMLResponse(
        f"""
        <html>
          <head>
            <title>{safe_status_title}</title>
            <script>
              setTimeout(function() {{
                window.close();
              }}, 3000);
            </script>
          </head>
          <body style="font-family:Arial,Helvetica,sans-serif;background:#f3f6fb;padding:40px;color:#1f2937;">
            <div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:18px;padding:32px;box-shadow:0 18px 40px rgba(15,39,68,.10);border:1px solid {safe_status_border};background:{safe_status_background};">
              <h1 style="margin:0 0 16px;color:{safe_status_color};">{safe_status_title}</h1>
              <p style="margin:0 0 12px;line-height:1.7;">{safe_status_message}</p>
              {"<p style='margin:0 0 20px;line-height:1.7;'>You can now open the branch dashboard and sign in with your branch username and password.</p>" if safe_dashboard_url else "<p style='margin:0 0 20px;line-height:1.7;'>This window will close automatically in 3 seconds.</p>"}
              {f'<p style="margin:0 0 16px;"><a href="{safe_dashboard_url}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:700;">Open Branch Dashboard</a></p>' if safe_dashboard_url else ''}
              <p style="margin:0;font-size:14px;color:#6b7280;">This window will close automatically in 3 seconds. If it stays open, you can close it manually.</p>
            </div>
          </body>
        </html>
        """
    )

@router.post("/logout")
async def branch_logout(request: Request, db: Session = Depends(get_db)):
    """Branch logout"""
    client_ip = request.client.host
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            username = payload.get("sub")
            log_activity(db, "Branch Logout", username or "Unknown", f"IP: {client_ip}", "security")
        except:
            pass
    return {"message": "Logged out successfully"}

@router.get("/verify")
async def verify_token(request: Request, db: Session = Depends(get_db)):
    """Verify branch token"""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authorization header"
        )
    
    token = auth_header.split(" ")[1]
    
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        token_type = payload.get("type")
        managed_by = payload.get("managed_by")
        
        if token_type != "branch":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid token type"
            )
        
        staff = db.query(BranchStaff).filter(BranchStaff.username == username).first()
        if not staff or staff.status != "Active":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or inactive"
            )
        branch = db.query(Branch).filter(Branch.id == staff.branch_id).first() if staff.branch_id else None
        
        is_superadmin_managed_branch = managed_by == "superadmin"
        should_include_window_accounts = staff.role == "branch_admin" or is_superadmin_managed_branch
        window_accounts = get_branch_window_accounts(db, staff.branch_id) if should_include_window_accounts else []

        return {
            "valid": True,
            "server_started_at": SERVER_STARTED_AT,
        "user": {
            "id": staff.id,
            "username": "superadmin" if is_superadmin_managed_branch else staff.username,
            "email": staff.email,
            "full_name": "superadmin" if is_superadmin_managed_branch else staff.full_name,
                "role": public_role(staff.role),
                "internal_role": staff.role,
                "branch_id": staff.branch_id,
                "dashboard_url": get_branch_dashboard_url(staff),
                "account_scope": staff.account_scope or "full_branch",
                "service_window": staff.service_window,
            "service_window_label": get_window_display_label(staff),
            "window_label": get_window_display_label(staff),
            "assigned_window_number": get_assigned_window_number(staff),
            "branch_window_count": branch.counters if branch else None,
            "superadmin_managed_branch": is_superadmin_managed_branch,
            "window_accounts": [
                    {
                        "id": account.id,
                        "username": account.username,
                        "full_name": account.full_name,
                        "service_window": account.service_window,
                        "service_window_label": get_window_display_label(account),
                        "assigned_window_number": get_assigned_window_number(account),
                        "window_label": get_window_display_label(account),
                    }
                    for account in window_accounts
                ],
            }
        }
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token"
        )
