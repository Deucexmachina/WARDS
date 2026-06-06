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
import time

from database.models import CitizenUser, ActivityLog, EmailVerificationToken, get_db
from services.email_service import send_citizen_verification_link_email, smtp_is_configured
from utils.field_crypto import apply_citizen_user_security, apply_email_verification_token_security, find_citizen_by_email, hash_optional_value, serialize_citizen_user
from utils.security_validation import ensure_email_is_unique, normalize_email, validate_strong_password

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

SECRET_KEY = os.getenv("USER_SECRET_KEY", "your-user-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 1440  # 24 hours for citizens

login_attempts = {}
locked_accounts = {}
otp_storage = {}

MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_DURATION = 900
RATE_LIMIT_WINDOW = 60
MAX_REQUESTS_PER_WINDOW = 10

class UserRegisterRequest(BaseModel):
    email: EmailStr
    full_name: str
    contact_number: str
    password: str
    address: Optional[str] = None

class UserLoginRequest(BaseModel):
    email: EmailStr
    password: str
    otp: Optional[str] = None

class OTPRequest(BaseModel):
    email: EmailStr
    password: str

class Token(BaseModel):
    access_token: Optional[str] = None
    token_type: str
    user: Optional[dict] = None
    requires_email_verification: Optional[bool] = False
    message: Optional[str] = None

def validate_public_password(password: str):
    validate_strong_password(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

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

def record_failed_attempt(email: str):
    if email not in locked_accounts:
        locked_accounts[email] = {"attempts": 0, "locked_at": None}
    
    locked_accounts[email]["attempts"] += 1
    
    if locked_accounts[email]["attempts"] >= MAX_LOGIN_ATTEMPTS:
        locked_accounts[email]["locked_at"] = time.time()

def reset_failed_attempts(email: str):
    if email in locked_accounts:
        del locked_accounts[email]

def generate_otp() -> str:
    return str(secrets.randbelow(1000000)).zfill(6)

def log_activity(db: Session, action: str, user: str, details: str, log_type: str = "user_auth"):
    log = ActivityLog(
        action=action,
        user=user,
        details=details,
        type=log_type
    )
    db.add(log)
    db.commit()


def build_public_user_response(user: CitizenUser) -> dict:
    profile = serialize_citizen_user(user)
    return {
        "id": user.id,
        "email": profile["email"],
        "full_name": profile["full_name"],
        "contact_number": profile["contact_number"],
        "address": profile["address"],
    }

@router.post("/register", response_model=Token)
async def register_user(request: Request, user_data: UserRegisterRequest, db: Session = Depends(get_db)):
    client_ip = request.client.host
    
    if not check_rate_limit(client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please try again later."
        )
    
    normalized_email = normalize_email(user_data.email, check_deliverability=True)
    ensure_email_is_unique(db, normalized_email)

    validate_public_password(user_data.password)

    verification_required = smtp_is_configured()
    hashed_password = pwd_context.hash(user_data.password)
    new_user = CitizenUser(
        email=normalized_email,
        full_name=user_data.full_name,
        contact_number=user_data.contact_number,
        address=user_data.address,
        hashed_password=hashed_password,
        is_verified=not verification_required,
        status="Active"
    )

    db.add(new_user)
    db.flush()
    apply_citizen_user_security(new_user)

    if verification_required:
        verification_token = secrets.token_urlsafe(32)
        db.add(EmailVerificationToken(
            citizen_user_id=new_user.id,
            email=serialize_citizen_user(new_user)["email"],
            token=verification_token,
            expires_at=datetime.utcnow() + timedelta(hours=24),
        ))
        db.flush()
        token_record = db.query(EmailVerificationToken).filter(EmailVerificationToken.citizen_user_id == new_user.id).order_by(EmailVerificationToken.id.desc()).first()
        if token_record:
            apply_email_verification_token_security(token_record)
        verification_url = f"{str(request.base_url).rstrip('/')}/api/auth/user/verify-email?token={verification_token}"
        email_result = send_citizen_verification_link_email(
            serialize_citizen_user(new_user)["email"],
            verification_url,
        )
        if not email_result["sent"]:
            db.rollback()
            raise HTTPException(status_code=500, detail=email_result["message"])

    db.commit()
    db.refresh(new_user)

    if verification_required:
        return {
            "access_token": None,
            "token_type": "pending",
            "user": build_public_user_response(new_user),
            "requires_email_verification": True,
            "message": "Verification email sent. Please verify your email before logging in.",
        }

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={
            "sub": serialize_citizen_user(new_user)["email"],
            "user_id": new_user.id,
            "type": "user"
        },
        expires_delta=access_token_expires
    )
    
    log_activity(db, "User Registration", serialize_citizen_user(new_user)["email"], f"New user registered from IP: {client_ip}", "user_auth")
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": build_public_user_response(new_user)
    }


@router.get("/verify-email", response_class=HTMLResponse)
async def verify_email(token: str, db: Session = Depends(get_db)):
    token_hash = hash_optional_value(token)
    token_record = (
        db.query(EmailVerificationToken)
        .filter(EmailVerificationToken.token_hash == token_hash, EmailVerificationToken.used.is_(False))
        .first()
    )
    if not token_record or token_record.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Invalid or expired verification token")

    user = db.query(CitizenUser).filter(CitizenUser.id == token_record.citizen_user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.is_verified = True
    token_record.used = True
    db.commit()
    return HTMLResponse("<html><body><h1>Email verified</h1><p>You can now return to WARDS and log in.</p></body></html>")

@router.post("/request-otp")
async def request_otp(request: Request, credentials: OTPRequest, db: Session = Depends(get_db)):
    client_ip = request.client.host
    
    if not check_rate_limit(client_ip):
        log_activity(db, "OTP Request Rate Limited", credentials.email, f"IP: {client_ip}", "user_auth")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please try again later."
        )
    
    if is_account_locked(credentials.email):
        log_activity(db, "OTP Request on Locked Account", credentials.email, f"IP: {client_ip}", "user_auth")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is temporarily locked due to multiple failed login attempts. Please try again in 15 minutes."
        )
    
    normalized_email = normalize_email(credentials.email)
    user = find_citizen_by_email(db, CitizenUser, normalized_email)
    if not user or not pwd_context.verify(credentials.password, user.hashed_password):
        record_failed_attempt(normalized_email)
        log_activity(db, "Failed OTP Request", normalized_email, f"Invalid credentials from IP: {client_ip}", "user_auth")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    
    if user.status != "Active":
        log_activity(db, "OTP Request for Inactive Account", credentials.email, f"Status: {user.status}, IP: {client_ip}", "user_auth")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is not active"
        )
    
    otp = generate_otp()
    otp_storage[normalized_email] = {
        "otp": otp,
        "expires_at": time.time() + 300,
        "user_id": user.id
    }
    
    log_activity(db, "OTP Generated", normalized_email, f"OTP requested from IP: {client_ip}", "user_auth")
    
    
    return {
        "message": "OTP sent successfully",
        "otp": otp
    }

@router.post("/login", response_model=Token)
async def user_login(request: Request, credentials: UserLoginRequest, db: Session = Depends(get_db)):
    client_ip = request.client.host
    
    if not check_rate_limit(client_ip):
        log_activity(db, "Login Rate Limited", credentials.email, f"IP: {client_ip}", "user_auth")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Please try again later."
        )
    
    normalized_email = normalize_email(credentials.email)
    if is_account_locked(normalized_email):
        remaining_time = int(LOCKOUT_DURATION - (time.time() - locked_accounts[normalized_email]["locked_at"]))
        log_activity(db, "Login Attempt on Locked Account", normalized_email, f"IP: {client_ip}", "user_auth")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Account is locked. Please try again in {remaining_time // 60} minutes."
        )
    
    user = find_citizen_by_email(db, CitizenUser, normalized_email)
    if not user or not pwd_context.verify(credentials.password, user.hashed_password):
        record_failed_attempt(normalized_email)
        attempts_left = MAX_LOGIN_ATTEMPTS - locked_accounts.get(normalized_email, {}).get("attempts", 0)
        log_activity(db, "Failed Login Attempt", normalized_email, f"Invalid credentials from IP: {client_ip}, Attempts left: {attempts_left}", "user_auth")
        
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid email or password. {attempts_left} attempts remaining."
        )
    
    if user.status != "Active":
        log_activity(db, "Login Attempt for Inactive Account", normalized_email, f"Status: {user.status}, IP: {client_ip}", "user_auth")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is not active"
        )

    if not user.is_verified:
        raise HTTPException(status_code=403, detail="Please verify your email before logging in.")
    
    if not credentials.otp:
        log_activity(db, "Login Without OTP", credentials.email, f"IP: {client_ip}", "user_auth")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OTP is required. Please request an OTP first."
        )
    
    if credentials.email not in otp_storage:
        log_activity(db, "Login with Invalid OTP Session", credentials.email, f"IP: {client_ip}", "user_auth")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired OTP. Please request a new OTP."
        )
    
    otp_data = otp_storage[credentials.email]
    if time.time() > otp_data["expires_at"]:
        del otp_storage[credentials.email]
        log_activity(db, "Login with Expired OTP", credentials.email, f"IP: {client_ip}", "user_auth")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OTP has expired. Please request a new OTP."
        )
    
    if credentials.otp != otp_data["otp"]:
        record_failed_attempt(credentials.email)
        log_activity(db, "Login with Incorrect OTP", credentials.email, f"IP: {client_ip}", "user_auth")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid OTP"
        )
    
    del otp_storage[credentials.email]
    reset_failed_attempts(credentials.email)
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={
            "sub": serialize_citizen_user(user)["email"],
            "user_id": user.id,
            "type": "user"
        },
        expires_delta=access_token_expires
    )
    
    user.last_login = datetime.utcnow()
    apply_citizen_user_security(user)
    db.commit()
    
    log_activity(db, "Successful User Login", credentials.email, f"IP: {client_ip}", "user_auth")
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": build_public_user_response(user)
    }

@router.post("/logout")
async def user_logout(request: Request, db: Session = Depends(get_db)):
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
            "user": build_public_user_response(user)
        }
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token"
        )
    if not user.is_verified:
        raise HTTPException(status_code=403, detail="Please verify your email before logging in.")
