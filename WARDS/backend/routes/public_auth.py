import os

from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta
from typing import Optional
import secrets

from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from database.models import EmailVerificationToken, PublicUser, get_db
from services.email_service import send_citizen_verification_link_email, smtp_is_configured
from utils.field_crypto import apply_citizen_user_security, apply_email_verification_token_security, find_citizen_by_email, hash_optional_value, serialize_citizen_user
from utils.security_validation import (
    ensure_email_is_unique,
    normalize_citizen_full_name,
    normalize_email,
    normalize_ph_contact_number,
    validate_strong_password,
)

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Rate limiting configuration
limiter = Limiter(key_func=get_remote_address)

# JWT settings
SECRET_KEY = "your-secret-key-change-in-production"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 1440  # 24 hours

class PublicUserRegister(BaseModel):
    email: str
    full_name: str
    contact_number: str
    password: str

class PublicUserLogin(BaseModel):
    email: str
    password: str

class Token(BaseModel):
    access_token: Optional[str] = None
    token_type: str
    user: Optional[dict] = None
    requires_email_verification: Optional[bool] = False
    message: Optional[str] = None

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

@router.post("/register", response_model=Token)
@limiter.limit("5/minute;25/day")
async def register_public_user(request: Request, user_data: PublicUserRegister, db: Session = Depends(get_db)):
    """Register a new public user"""
    normalized_email = normalize_email(user_data.email, check_deliverability=True)
    normalized_full_name = normalize_citizen_full_name(user_data.full_name)
    normalized_contact_number = normalize_ph_contact_number(user_data.contact_number)
    ensure_email_is_unique(db, normalized_email)
    validate_strong_password(user_data.password)
    verification_required = smtp_is_configured()
    
    hashed_password = pwd_context.hash(user_data.password)
    new_user = PublicUser(
        email=normalized_email,
        full_name=normalized_full_name,
        contact_number=normalized_contact_number,
        hashed_password=hashed_password,
        is_verified=not verification_required
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
        verification_base_url = os.getenv("BACKEND_BASE_URL", "http://localhost:8000").rstrip("/")
        verification_url = f"{verification_base_url}/api/public/auth/verify-email?token={verification_token}"
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
            "user": {
                "id": new_user.id,
                "email": serialize_citizen_user(new_user)["email"],
                "full_name": serialize_citizen_user(new_user)["full_name"],
                "contact_number": serialize_citizen_user(new_user)["contact_number"]
            },
            "requires_email_verification": True,
            "message": "Verification email sent. Please verify your email before logging in.",
        }
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": serialize_citizen_user(new_user)["email"], "type": "public"},
        expires_delta=access_token_expires
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": new_user.id,
            "email": serialize_citizen_user(new_user)["email"],
            "full_name": serialize_citizen_user(new_user)["full_name"],
            "contact_number": serialize_citizen_user(new_user)["contact_number"]
        }
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

    user = db.query(PublicUser).filter(PublicUser.id == token_record.citizen_user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.is_verified = True
    token_record.used = True
    db.commit()
    return HTMLResponse("<html><body><h1>Email verified</h1><p>You can now return to WARDS and log in.</p></body></html>")

@router.post("/login", response_model=Token)
async def login_public_user(credentials: PublicUserLogin, db: Session = Depends(get_db)):
    """Login public user"""
    # Find user
    normalized_email = normalize_email(credentials.email)
    user = find_citizen_by_email(db, PublicUser, normalized_email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    
    # Verify password
    if not pwd_context.verify(credentials.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )

    if not user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email before logging in."
        )
    
    # Update last login
    user.last_login = datetime.utcnow()
    apply_citizen_user_security(user)
    db.commit()
    
    # Create access token
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": serialize_citizen_user(user)["email"], "type": "public"},
        expires_delta=access_token_expires
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": serialize_citizen_user(user)["email"],
            "full_name": serialize_citizen_user(user)["full_name"],
            "contact_number": serialize_citizen_user(user)["contact_number"]
        }
    }

@router.get("/me")
async def get_current_public_user(token: str, db: Session = Depends(get_db)):
    """Get current logged in public user"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    user = find_citizen_by_email(db, PublicUser, email)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {
        "id": user.id,
        "email": serialize_citizen_user(user)["email"],
        "full_name": serialize_citizen_user(user)["full_name"],
        "contact_number": serialize_citizen_user(user)["contact_number"]
    }

@router.post("/logout")
async def logout_public_user():
    """Logout public user (client-side token removal)"""
    return {"message": "Logged out successfully"}
