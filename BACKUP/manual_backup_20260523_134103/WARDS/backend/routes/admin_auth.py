from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta
from typing import Optional
import os
import secrets
import time

from database.models import Admin, ActivityLog, get_db

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

SECRET_KEY = os.getenv("ADMIN_SECRET_KEY", "your-admin-secret-key-change-in-production-immediately")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

login_attempts = {}
locked_accounts = {}
otp_storage = {}

MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_DURATION = 900
RATE_LIMIT_WINDOW = 60
MAX_REQUESTS_PER_WINDOW = 10

class AdminLoginRequest(BaseModel):
    username: str
    password: str
    otp: Optional[str] = None

class OTPRequest(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    user: dict
    requires_otp: Optional[bool] = False

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

def is_account_locked(username: str) -> bool:
    if username in locked_accounts:
        lock_time = locked_accounts[username]["locked_at"]
        if time.time() - lock_time < LOCKOUT_DURATION:
            return True
        else:
            del locked_accounts[username]
    return False

def record_failed_attempt(username: str):
    if username not in locked_accounts:
        locked_accounts[username] = {"attempts": 0, "locked_at": None}
    
    locked_accounts[username]["attempts"] += 1
    
    if locked_accounts[username]["attempts"] >= MAX_LOGIN_ATTEMPTS:
        locked_accounts[username]["locked_at"] = time.time()

def reset_failed_attempts(username: str):
    if username in locked_accounts:
        del locked_accounts[username]

def generate_otp() -> str:
    return str(secrets.randbelow(1000000)).zfill(6)

def log_activity(db: Session, action: str, user: str, details: str, log_type: str = "security"):
    log = ActivityLog(
        action=action,
        user=user,
        details=details,
        type=log_type
    )
    db.add(log)
    db.commit()

@router.post("/request-otp")
async def request_otp(request: Request, credentials: OTPRequest, db: Session = Depends(get_db)):
    client_ip = request.client.host
    
    if not check_rate_limit(client_ip):
        log_activity(db, "OTP Request Rate Limited", credentials.username, f"IP: {client_ip}", "security")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please try again later."
        )
    
    if is_account_locked(credentials.username):
        log_activity(db, "OTP Request on Locked Account", credentials.username, f"IP: {client_ip}", "security")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is temporarily locked due to multiple failed login attempts. Please try again in 15 minutes."
        )
    
    admin = db.query(Admin).filter(Admin.username == credentials.username).first()
    
    # Debug logging
    print(f"[ADMIN AUTH DEBUG] OTP Request for username: {credentials.username}")
    print(f"[ADMIN AUTH DEBUG] Admin found: {admin is not None}")
    
    if not admin:
        record_failed_attempt(credentials.username)
        log_activity(db, "Failed OTP Request", credentials.username, f"Admin not found, IP: {client_ip}", "security")
        print(f"[ADMIN AUTH DEBUG] Admin not found in database")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )
    
    print(f"[ADMIN AUTH DEBUG] Admin ID: {admin.id}, Status: {admin.status}")
    print(f"[ADMIN AUTH DEBUG] Verifying password...")
    
    password_valid = pwd_context.verify(credentials.password, admin.hashed_password)
    print(f"[ADMIN AUTH DEBUG] Password valid: {password_valid}")
    
    if not password_valid:
        record_failed_attempt(credentials.username)
        log_activity(db, "Failed OTP Request", credentials.username, f"Invalid password from IP: {client_ip}", "security")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )
    
    if admin.status != "Active":
        log_activity(db, "OTP Request for Inactive Account", credentials.username, f"Status: {admin.status}, IP: {client_ip}", "security")
        print(f"[ADMIN AUTH DEBUG] Admin account not active: {admin.status}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is not active"
        )
    
    otp = generate_otp()
    otp_storage[credentials.username] = {
        "otp": otp,
        "expires_at": time.time() + 300,
        "user_id": admin.id
    }
    
    print(f"[ADMIN AUTH DEBUG] OTP generated successfully: {otp}")
    
    log_activity(db, "OTP Generated", credentials.username, f"OTP requested from IP: {client_ip}", "security")
    
    print(f"[SECURITY] OTP for {credentials.username}: {otp}")
    
    return {
        "message": "OTP sent successfully",
        "otp": otp
    }

@router.post("/login", response_model=Token)
async def admin_login(request: Request, credentials: AdminLoginRequest, db: Session = Depends(get_db)):
    client_ip = request.client.host
    
    if not check_rate_limit(client_ip):
        log_activity(db, "Login Rate Limited", credentials.username, f"IP: {client_ip}", "security")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Please try again later."
        )
    
    if is_account_locked(credentials.username):
        remaining_time = int(LOCKOUT_DURATION - (time.time() - locked_accounts[credentials.username]["locked_at"]))
        log_activity(db, "Login Attempt on Locked Account", credentials.username, f"IP: {client_ip}", "security")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Account is locked. Please try again in {remaining_time // 60} minutes."
        )
    
    admin = db.query(Admin).filter(Admin.username == credentials.username).first()
    if not admin or not pwd_context.verify(credentials.password, admin.hashed_password):
        record_failed_attempt(credentials.username)
        attempts_left = MAX_LOGIN_ATTEMPTS - locked_accounts.get(credentials.username, {}).get("attempts", 0)
        log_activity(db, "Failed Login Attempt", credentials.username, f"Invalid credentials from IP: {client_ip}, Attempts left: {attempts_left}", "security")
        
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid username or password. {attempts_left} attempts remaining."
        )
    
    if admin.status != "Active":
        log_activity(db, "Login Attempt for Inactive Account", credentials.username, f"Status: {admin.status}, IP: {client_ip}", "security")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is not active"
        )
    
    if not credentials.otp:
        log_activity(db, "Login Without OTP", credentials.username, f"IP: {client_ip}", "security")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OTP is required. Please request an OTP first."
        )
    
    if credentials.username not in otp_storage:
        log_activity(db, "Login with Invalid OTP Session", credentials.username, f"IP: {client_ip}", "security")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired OTP. Please request a new OTP."
        )
    
    otp_data = otp_storage[credentials.username]
    if time.time() > otp_data["expires_at"]:
        del otp_storage[credentials.username]
        log_activity(db, "Login with Expired OTP", credentials.username, f"IP: {client_ip}", "security")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OTP has expired. Please request a new OTP."
        )
    
    if credentials.otp != otp_data["otp"]:
        record_failed_attempt(credentials.username)
        log_activity(db, "Login with Incorrect OTP", credentials.username, f"IP: {client_ip}", "security")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid OTP"
        )
    
    del otp_storage[credentials.username]
    reset_failed_attempts(credentials.username)
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={
            "sub": admin.username,
            "role": admin.role,
            "user_id": admin.id,
            "type": "admin"
        },
        expires_delta=access_token_expires
    )
    
    admin.last_login = datetime.utcnow()
    db.commit()
    
    log_activity(db, "Successful Admin Login", credentials.username, f"Role: {admin.role}, IP: {client_ip}", "security")
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": admin.id,
            "username": admin.username,
            "email": admin.email,
            "role": admin.role,
            "status": admin.status
        }
    }

@router.post("/logout")
async def admin_logout(request: Request, db: Session = Depends(get_db)):
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
            "user": {
                "id": admin.id,
                "username": admin.username,
                "email": admin.email,
                "role": admin.role
            }
        }
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token"
        )
