from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from database.models import ActivityLog, Admin, BranchStaff, CitizenUser, get_db
from middleware.admin_auth import get_current_admin_user
from utils.field_crypto import apply_citizen_user_security, serialize_citizen_user
from utils.security_validation import (
    ensure_email_is_unique,
    ensure_username_is_unique,
    normalize_email,
    normalize_username,
    validate_strong_password,
)

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class AdminUserCreate(BaseModel):
    email: EmailStr
    password: str
    role: str
    username: Optional[str] = None
    full_name: Optional[str] = None
    branch_id: Optional[int] = None
    status: str = "Active"


class AdminUserUpdate(BaseModel):
    email: EmailStr
    role: str
    username: Optional[str] = None
    full_name: Optional[str] = None
    branch_id: Optional[int] = None
    password: Optional[str] = None
    status: str = "Active"


def ensure_admin_role(current_admin):
    if current_admin.role not in {"main_admin", "admin", "superadmin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")


def normalize_role(role: str) -> str:
    if role in {"admin", "main_admin"}:
        return "admin"
    if role in {"branch", "branch_admin", "branch_staff"}:
        return "branch"
    return "public"


def unique_username(db: Session, model, email: str, requested: Optional[str] = None):
    base = requested or email.split("@", 1)[0].replace(".", "_").replace("-", "_")
    username = base
    counter = 1
    while db.query(model).filter(model.username == username).first():
        counter += 1
        username = f"{base}_{counter}"
    return username


def serialize_user(user, role: str):
    citizen_profile = serialize_citizen_user(user) if role == "public" else None
    data = {
        "id": user.id,
        "email": citizen_profile["email"] if citizen_profile else user.email,
        "role": role,
        "status": getattr(user, "status", "Active"),
        "created_at": user.created_at.isoformat() if getattr(user, "created_at", None) else None,
        "last_login": user.last_login.isoformat() if getattr(user, "last_login", None) else None,
    }
    if role in {"admin", "branch"}:
        data["username"] = user.username
    if role == "branch":
        data["full_name"] = user.full_name
        data["branch_id"] = user.branch_id
    if role == "public":
        data["full_name"] = citizen_profile["full_name"]
        data["contact_number"] = citizen_profile["contact_number"]
    return data


def find_user(db: Session, role: str, user_id: int):
    if role == "admin":
        return db.query(Admin).filter(Admin.id == user_id).first()
    if role == "branch":
        return db.query(BranchStaff).filter(BranchStaff.id == user_id).first()
    if role == "public":
        return db.query(CitizenUser).filter(CitizenUser.id == user_id).first()
    return None


@router.get("/users")
async def list_users(current_admin=Depends(get_current_admin_user), db: Session = Depends(get_db)):
    ensure_admin_role(current_admin)
    admins = [serialize_user(user, "admin") for user in db.query(Admin).all()]
    branches = [serialize_user(user, "branch") for user in db.query(BranchStaff).all()]
    publics = [serialize_user(user, "public") for user in db.query(CitizenUser).all()]
    return admins + branches + publics


@router.post("/users")
async def create_user(
    user_data: AdminUserCreate,
    current_admin=Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    ensure_admin_role(current_admin)
    role = normalize_role(user_data.role)
    email = normalize_email(user_data.email, check_deliverability=True)
    ensure_email_is_unique(db, email)
    validate_strong_password(user_data.password)

    hashed_password = pwd_context.hash(user_data.password)
    if role == "admin":
        requested_username = normalize_username(user_data.username) if user_data.username else None
        username = unique_username(db, Admin, email, requested_username)
        ensure_username_is_unique(db, username)
        user = Admin(
            username=username,
            email=email,
            hashed_password=hashed_password,
            role="main_admin",
            status=user_data.status,
            is_verified=True,
        )
    elif role == "branch":
        requested_username = normalize_username(user_data.username) if user_data.username else None
        username = unique_username(db, BranchStaff, email, requested_username)
        ensure_username_is_unique(db, username)
        user = BranchStaff(
            username=username,
            email=email,
            full_name=user_data.full_name or email.split("@", 1)[0],
            hashed_password=hashed_password,
            branch_id=user_data.branch_id,
            role="branch_staff",
            status=user_data.status,
            is_verified=True,
        )
    else:
        user = CitizenUser(
            email=email,
            full_name=user_data.full_name or email.split("@", 1)[0],
            contact_number="",
            hashed_password=hashed_password,
            role="public",
            status=user_data.status,
            is_verified=True,
        )

    db.add(user)
    if role == "public":
        apply_citizen_user_security(user)
    db.add(ActivityLog(
        action="Admin User Created",
        user=current_admin.username,
        details=f"Created {role} account for {email}",
        type="admin_user",
    ))
    db.commit()
    db.refresh(user)
    return serialize_user(user, role)


@router.put("/users/{role}/{user_id}")
async def update_user(
    role: str,
    user_id: int,
    user_data: AdminUserUpdate,
    current_admin=Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    ensure_admin_role(current_admin)
    role = normalize_role(role)
    user = find_user(db, role, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    email = normalize_email(user_data.email, check_deliverability=True)
    exclude_admin_id = user.id if role == "admin" else None
    exclude_branch_staff_id = user.id if role == "branch" else None
    ensure_email_is_unique(db, email, exclude_admin_id=exclude_admin_id, exclude_branch_staff_id=exclude_branch_staff_id)
    user.email = email
    user.status = user_data.status
    if user_data.password:
        validate_strong_password(user_data.password)
        user.hashed_password = pwd_context.hash(user_data.password)
    if role in {"admin", "branch"} and user_data.username:
        username = normalize_username(user_data.username)
        ensure_username_is_unique(db, username, exclude_admin_id=exclude_admin_id, exclude_branch_staff_id=exclude_branch_staff_id)
        user.username = username
    if role == "branch":
        user.full_name = user_data.full_name or user.full_name
        user.branch_id = user_data.branch_id
    if role == "public":
        user.full_name = user_data.full_name or user.full_name
        apply_citizen_user_security(user)

    db.add(ActivityLog(
        action="Admin User Updated",
        user=current_admin.username,
        details=f"Updated {role} account for {user.email}",
        type="admin_user",
    ))
    db.commit()
    return serialize_user(user, role)


@router.put("/users/{role}/{user_id}/deactivate")
async def deactivate_user(
    role: str,
    user_id: int,
    current_admin=Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    ensure_admin_role(current_admin)
    role = normalize_role(role)
    user = find_user(db, role, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.status = "Inactive"
    db.add(ActivityLog(
        action="Admin User Deactivated",
        user=current_admin.username,
        details=f"Deactivated {role} account for {user.email}",
        type="admin_user",
    ))
    db.commit()
    return {"message": "User deactivated successfully"}


@router.delete("/users/{role}/{user_id}")
async def delete_user(
    role: str,
    user_id: int,
    current_admin=Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    ensure_admin_role(current_admin)
    role = normalize_role(role)
    user = find_user(db, role, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.add(ActivityLog(
        action="Admin User Deleted",
        user=current_admin.username,
        details=f"Deleted {role} account for {user.email}",
        type="admin_user",
    ))
    db.delete(user)
    db.commit()
    return {"message": "User deleted successfully"}
