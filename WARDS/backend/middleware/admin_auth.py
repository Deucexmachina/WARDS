from fastapi import HTTPException, status, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from jose import JWTError, jwt
from typing import Optional
import os

from database.models import Admin, BranchStaff, get_db, ActivityLog
from utils.token_revocation import is_token_revoked
from routes.unified_auth import decode_active_account_from_bearer_token

SECRET_KEY = os.getenv("ADMIN_SECRET_KEY", "your-admin-secret-key-change-in-production-immediately")
UNIFIED_SECRET_KEY = os.getenv("AUTH_SECRET_KEY", "your-unified-auth-secret-change-in-production")
BRANCH_SECRET_KEY = os.getenv("BRANCH_SECRET_KEY", "your-branch-secret-key-change-in-production")
ALGORITHM = "HS256"

security = HTTPBearer()


def _get_active_admin(db: Session, *, email: Optional[str] = None, username: Optional[str] = None):
    admin = None
    if email:
        admin = db.query(Admin).filter(Admin.email == email).first()
    if admin is None and username:
        admin = db.query(Admin).filter(Admin.username == username).first()
    return admin


def _get_active_branch_staff(db: Session, *, email: Optional[str] = None, username: Optional[str] = None):
    branch_staff = None
    if email:
        branch_staff = db.query(BranchStaff).filter(BranchStaff.email == email).first()
    if branch_staff is None and username:
        branch_staff = db.query(BranchStaff).filter(BranchStaff.username == username).first()
    return branch_staff

async def get_current_admin_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> Admin | BranchStaff:
    token = credentials.credentials
    if is_token_revoked(db, token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session has been logged out")
    
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    try:
        _, user, _payload = decode_active_account_from_bearer_token(
            token,
            db,
            allowed_portals=("admin", "branch"),
        )
    except HTTPException:
        try:
            from SECURITY.security_engine import record_context_detection

            record_context_detection(
                db,
                target_name="admin_session:legacy_middleware",
                actor="unknown_admin_token",
                change_type="invalid_admin_session",
                context={
                    "target_type": "admin_session",
                    "source_ip": request.client.host if request.client else "unknown",
                    "admin_session_valid": False,
                    "method_legitimate": False,
                },
                force_flag="unauthenticated_change",
            )
        except Exception:
            pass
        raise credentials_exception

    if user.status != "Active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is not active"
        )
    
    return user

def require_admin_role(*allowed_roles: str):
    async def role_checker(
        current_user: Admin | BranchStaff = Depends(get_current_admin_user),
        db: Session = Depends(get_db),
    ) -> Admin | BranchStaff:
        if current_user.role not in allowed_roles:
            try:
                db.add(ActivityLog(
                    action="Admin Authorization Denied",
                    user=current_user.username,
                    details=f"Role '{current_user.role}' attempted admin access requiring: {', '.join(allowed_roles)}",
                    type="security",
                ))
                db.commit()
            except Exception:
                db.rollback()
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required roles: {', '.join(allowed_roles)}"
            )
        return current_user
    return role_checker

def require_main_admin():
    return require_admin_role("main_admin", "superadmin")

def require_branch_admin_or_higher():
    return require_admin_role("main_admin", "superadmin", "branch_admin")

def require_any_admin():
    return require_admin_role("main_admin", "superadmin", "branch_admin", "branch_staff")

async def verify_branch_access(
    branch_id: int,
    current_user: Admin | BranchStaff = Depends(get_current_admin_user)
) -> Admin | BranchStaff:
    if current_user.role in {"main_admin", "superadmin"}:
        return current_user
    
    if current_user.role in ["branch_admin", "branch_staff"]:
        if current_user.branch_id != branch_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied to this branch"
            )
    
    return current_user

def log_admin_activity(action: str, details: str):
    async def activity_logger(
        request: Request,
        current_user: Admin | BranchStaff = Depends(get_current_admin_user),
        db: Session = Depends(get_db)
    ):
        log = ActivityLog(
            action=action,
            user=current_user.username,
            details=f"{details} | IP: {request.client.host}",
            type="admin_action"
        )
        db.add(log)
        db.commit()
        return current_user
    return activity_logger
