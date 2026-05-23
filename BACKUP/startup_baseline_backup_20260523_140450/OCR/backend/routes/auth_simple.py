from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import Optional
from auth.simple_auth import (
    verify_credentials,
    create_session,
    verify_session,
    delete_session,
    complete_mfa_login,
)

router = APIRouter()

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

@router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    """Login endpoint for admin and queue-only branch staff users."""
    auth_result = verify_credentials(request.username, request.password)
    
    if not auth_result:
        raise HTTPException(
            status_code=401,
            detail="Incorrect username or password"
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
        "user": user
    }


@router.post("/verify-mfa", response_model=LoginResponse)
async def verify_mfa(request: MFAVerifyRequest):
    """Complete MFA setup/login for queue-only branch staff accounts."""
    user = complete_mfa_login(request.challenge_token, request.otp_code)

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

@router.post("/logout")
async def logout(authorization: Optional[str] = Header(None)):
    """Logout endpoint"""
    if authorization and authorization.startswith("Bearer "):
        token = authorization.replace("Bearer ", "")
        delete_session(token)
    
    return {"message": "Successfully logged out"}

@router.get("/verify")
async def verify_token(authorization: Optional[str] = Header(None)):
    """Verify if token is valid"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    token = authorization.replace("Bearer ", "")
    user = verify_session(token)
    
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    return {
        "valid": True,
        "user": user
    }

@router.get("/me")
async def get_current_user(authorization: Optional[str] = Header(None)):
    """Get current user information"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    token = authorization.replace("Bearer ", "")
    user = verify_session(token)
    
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    return user
