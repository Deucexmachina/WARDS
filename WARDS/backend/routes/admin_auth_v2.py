"""
Admin Authentication with TOTP MFA and reCAPTCHA
Security Level: HIGH
- TOTP-based MFA (Microsoft Authenticator compatible)
- reCAPTCHA after 3 failed attempts
- Account lockout after 5 failed attempts (2 minutes)
- RBAC enforcement
- Comprehensive activity logging
"""
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import JSONResponse
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

from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from database.models import Admin, ActivityLog, MFASecret, get_db
from utils.system_settings import get_setting_value
from utils.field_crypto import apply_mfa_secret_security, find_mfa_secret_record, get_decrypted_or_raw

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Rate limiting configuration
limiter = Limiter(key_func=get_remote_address)

SECRET_KEY = os.getenv("ADMIN_SECRET_KEY", "your-admin-secret-key-change-in-production-immediately")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
RECAPTCHA_SECRET_KEY = os.getenv("RECAPTCHA_SECRET_KEY", "6LdOdsAsAAAAAHPw5OFtL757OAFc7SRJB618yE-D")
SERVER_STARTED_AT = datetime.utcnow().isoformat()

# Security tracking
login_attempts = {}
locked_accounts = {}

MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_DURATION = 120  # 2 minutes
CAPTCHA_THRESHOLD = 3  # Show captcha after 3 failed attempts
RATE_LIMIT_WINDOW = 60
MAX_REQUESTS_PER_WINDOW = 30

class AdminLoginRequest(BaseModel):
    email: str
    password: str
    totp_code: Optional[str] = None
    recaptcha_token: Optional[str] = None

class AdminSetupMFARequest(BaseModel):
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
    return int(get_setting_value(db, "sessionTimeout") or ACCESS_TOKEN_EXPIRE_MINUTES)


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
        print(f"[ADMIN AUTH] reCAPTCHA verification error: {e}")
        return False

def check_rate_limit(ip_address: str) -> bool:
    """Check if IP has exceeded rate limit"""
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
    """Check if account is locked due to failed attempts"""
    if username in locked_accounts:
        lock_time = locked_accounts[username]["locked_at"]
        if time.time() - lock_time < LOCKOUT_DURATION:
            return True
        else:
            del locked_accounts[username]
    return False

def record_failed_attempt(username: str, db: Session):
    """Record failed login attempt"""
    if username not in locked_accounts:
        locked_accounts[username] = {"attempts": 0, "locked_at": None}
    
    locked_accounts[username]["attempts"] += 1
    
    if locked_accounts[username]["attempts"] >= get_max_login_attempts(db):
        locked_accounts[username]["locked_at"] = time.time()

def reset_failed_attempts(username: str):
    """Reset failed attempts after successful login"""
    if username in locked_accounts:
        del locked_accounts[username]

def requires_captcha(username: str) -> bool:
    """Check if user needs to solve captcha"""
    if username in locked_accounts:
        return locked_accounts[username]["attempts"] >= CAPTCHA_THRESHOLD
    return False

def log_activity(db: Session, action: str, user: str, details: str, log_type: str = "admin_auth"):
    """Log security activity"""
    log = ActivityLog(
        action=action,
        user=user,
        details=details,
        type=log_type
    )
    db.add(log)
    db.commit()

def get_mfa_secret(db: Session, username: str) -> Optional[str]:
    mfa = find_mfa_secret_record(db, MFASecret, "admin", username, enabled_only=True)
    return (get_decrypted_or_raw(mfa, "secret") or mfa.secret) if mfa else None

def save_mfa_secret(db: Session, username: str, secret: str):
    mfa = find_mfa_secret_record(db, MFASecret, "admin", username)
    if mfa:
        mfa.portal = "admin"
        mfa.username = username
        mfa.secret = secret
        mfa.enabled = True
        apply_mfa_secret_security(mfa)
    else:
        mfa = MFASecret(portal="admin", username=username, secret=secret, enabled=True)
        apply_mfa_secret_security(mfa)
        db.add(mfa)
    db.commit()


def normalize_admin_email(email: str) -> str:
    return str(email).strip().lower()

def public_role(role: str) -> str:
    return "admin" if role in {"admin", "main_admin", "superadmin"} else role

def get_current_admin_from_token(request: Request, db: Session) -> Admin:
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

        if token_type != "admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid token type"
            )

        admin = db.query(Admin).filter(Admin.username == username).first()
        if not admin or admin.status != "Active":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or inactive"
            )

        return admin
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token"
        )

@router.post("/setup-mfa")
async def setup_mfa(request: Request, credentials: AdminSetupMFARequest, db: Session = Depends(get_db)):
    """
    Setup TOTP-based MFA for admin user
    Returns QR code for Microsoft Authenticator
    """
    client_ip = request.client.host
    
    # Verify credentials
    normalized_email = normalize_admin_email(credentials.email)
    admin = db.query(Admin).filter(Admin.email == normalized_email).first()
    if not admin or not pwd_context.verify(credentials.password, admin.hashed_password):
        log_activity(db, "Failed MFA Setup", normalized_email, f"Invalid credentials from IP: {client_ip}", "security")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    
    # Generate TOTP secret
    totp_secret = pyotp.random_base32()
    save_mfa_secret(db, admin.username, totp_secret)
    
    # Generate QR code
    totp_uri = pyotp.totp.TOTP(totp_secret).provisioning_uri(
        name=admin.username,
        issuer_name="WARDS Admin Portal"
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
async def setup_mfa_authenticated(request: Request, db: Session = Depends(get_db)):
    admin = get_current_admin_from_token(request, db)
    client_ip = request.client.host

    totp_secret = pyotp.random_base32()
    save_mfa_secret(db, admin.username, totp_secret)

    totp_uri = pyotp.totp.TOTP(totp_secret).provisioning_uri(
        name=admin.username,
        issuer_name="WARDS Admin Portal"
    )

    qr = qrcode.QRCode(version=1, box_size=10, border=5)
    qr.add_data(totp_uri)
    qr.make(fit=True)

    img = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format='PNG')
    qr_code_base64 = base64.b64encode(buffer.getvalue()).decode()

    log_activity(db, "Authenticated MFA Setup Initiated", admin.username, f"IP: {client_ip}", "security")

    return {
        "message": "MFA setup successful",
        "totp_secret": totp_secret,
        "qr_code": f"data:image/png;base64,{qr_code_base64}",
        "manual_entry_key": totp_secret
    }

@router.post("/login", response_model=Token)
@limiter.limit("3/minute")
async def admin_login(request: Request, credentials: AdminLoginRequest, db: Session = Depends(get_db)):
    """
    Admin login with TOTP MFA and reCAPTCHA
    """
    client_ip = request.client.host
    normalized_email = normalize_admin_email(credentials.email)
    
    # Check account lockout
    if is_account_locked(normalized_email):
        remaining_time = int(LOCKOUT_DURATION - (time.time() - locked_accounts[normalized_email]["locked_at"]))
        log_activity(db, "Login Attempt on Locked Account", normalized_email, f"IP: {client_ip}", "security")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Account is locked. Please try again in {remaining_time} seconds."
        )
    
    # Verify admin exists
    admin = db.query(Admin).filter(Admin.email == normalized_email).first()
    
    print(f"[ADMIN AUTH] Login attempt for email: {normalized_email}")
    print(f"[ADMIN AUTH] Admin found: {admin is not None}")
    
    if not admin:
        record_failed_attempt(normalized_email, db)
        log_activity(db, "Failed Login", normalized_email, f"Admin not found, IP: {client_ip}", "security")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    
    # Verify password
    print(f"[ADMIN AUTH] Verifying password...")
    password_valid = pwd_context.verify(credentials.password, admin.hashed_password)
    print(f"[ADMIN AUTH] Password valid: {password_valid}")
    
    if not password_valid:
        record_failed_attempt(normalized_email, db)
        log_activity(db, "Failed Login", normalized_email, f"Invalid password, IP: {client_ip}", "security")
        
        # Check if captcha is now required
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
    
    # Check account status
    if admin.status != "Active":
        log_activity(db, "Login Attempt for Inactive Account", normalized_email, f"Status: {admin.status}, IP: {client_ip}", "security")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is not active"
        )
    
    # Verify TOTP code
    totp_secret = get_mfa_secret(db, admin.username)
    if not totp_secret:
        # MFA not set up yet
        log_activity(db, "Login Without MFA Setup", normalized_email, f"IP: {client_ip}", "security")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="MFA not configured. Please setup MFA first.",
            headers={"X-Requires-MFA-Setup": "true"}
        )
    
    if not credentials.totp_code:
        # First step passed, now require TOTP
        return {
            "access_token": "",
            "token_type": "bearer",
            "user": {},
            "requires_mfa": True,
            "requires_captcha": requires_captcha(normalized_email)
        }
    
    # Verify TOTP code
    totp = pyotp.TOTP(totp_secret)
    if not totp.verify(credentials.totp_code, valid_window=1):
        record_failed_attempt(normalized_email, db)
        log_activity(db, "Failed TOTP Verification", normalized_email, f"IP: {client_ip}", "security")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid TOTP code"
        )
    
    # All checks passed - create token
    reset_failed_attempts(normalized_email)
    
    access_token_expires = timedelta(minutes=get_session_timeout_minutes(db))
    access_token = create_access_token(
        data={
            "sub": admin.username,
            "role": "admin",
            "internal_role": admin.role,
            "user_id": admin.id,
            "type": "admin"
        },
        expires_delta=access_token_expires
    )
    
    admin.last_login = datetime.utcnow()
    db.commit()
    
    log_activity(db, "Successful Admin Login", normalized_email, f"Role: {admin.role}, IP: {client_ip}", "security")
    
    print(f"[ADMIN AUTH] Login successful for {normalized_email}")
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": admin.id,
            "username": admin.username,
            "email": admin.email,
            "role": public_role(admin.role),
            "internal_role": admin.role,
            "status": admin.status
        },
        "requires_mfa": False,
        "requires_captcha": False
    }

@router.post("/logout")
async def admin_logout(request: Request, db: Session = Depends(get_db)):
    """Admin logout"""
    client_ip = request.client.host
    
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            username = payload.get("sub")
            log_activity(db, "Admin Logout", username or "Unknown", f"IP: {client_ip}", "security")
        except:
            pass
    
    return {"message": "Logged out successfully"}

@router.get("/verify")
async def verify_token(request: Request, db: Session = Depends(get_db)):
    """Verify admin token"""
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
        
        if token_type != "admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid token type"
            )
        
        admin = db.query(Admin).filter(Admin.username == username).first()
        if not admin or admin.status != "Active":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or inactive"
            )
        
        return {
            "valid": True,
            "server_started_at": SERVER_STARTED_AT,
            "user": {
                "id": admin.id,
                "username": admin.username,
                "email": admin.email,
                "role": public_role(admin.role),
                "internal_role": admin.role
            }
        }
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token"
        )
