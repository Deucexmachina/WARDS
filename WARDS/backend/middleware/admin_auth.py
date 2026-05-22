from fastapi import HTTPException, status, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from jose import JWTError, jwt
from typing import Optional
import os

from database.models import Admin, BranchStaff, get_db, ActivityLog

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
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> Admin | BranchStaff:
    token = credentials.credentials
    
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    user = None

    # Support the newer unified auth token if it exists in this deployment.
    try:
        payload = jwt.decode(token, UNIFIED_SECRET_KEY, algorithms=[ALGORITHM])
        identifier = payload.get("email") or payload.get("sub")
        role = payload.get("role")
        token_type = payload.get("type")

        if identifier and token_type == "role_auth" and role == "admin":
            user = _get_active_admin(db, email=payload.get("email"), username=payload.get("sub"))
    except JWTError:
        pass

    # Support direct admin tokens issued by the current admin login flow.
    if user is None:
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            username = payload.get("sub")
            email = payload.get("email")
            token_type = payload.get("type")

            if token_type == "admin":
                user = _get_active_admin(db, email=email, username=username)
        except JWTError:
            pass

    # Support branch-scoped staff/admin tokens for routes that allow them.
    if user is None:
        try:
            payload = jwt.decode(token, BRANCH_SECRET_KEY, algorithms=[ALGORITHM])
            username = payload.get("sub")
            email = payload.get("email")
            token_type = payload.get("type")

            if token_type == "branch":
                user = _get_active_branch_staff(db, email=email, username=username)
        except JWTError:
            pass

    if user is None:
        raise credentials_exception

    if user.status != "Active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is not active"
        )
    
    return user

def require_admin_role(*allowed_roles: str):
    async def role_checker(
        current_user: Admin | BranchStaff = Depends(get_current_admin_user)
    ) -> Admin | BranchStaff:
        if current_user.role not in allowed_roles:
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
