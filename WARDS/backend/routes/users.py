from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from database.models import ActivityLog, Admin, Branch, BranchStaff, CitizenUser, get_db
from middleware.admin_auth import require_main_admin
from utils.field_crypto import apply_citizen_user_security, serialize_citizen_user
from utils.security_validation import (
    ensure_email_is_unique,
    ensure_username_is_unique,
    normalize_email,
    normalize_username,
    validate_strong_password,
)
from utils.rbac import require_permission

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class UserCreate(BaseModel):
    username: Optional[str] = None
    email: EmailStr
    password: str
    role: str
    full_name: Optional[str] = None
    branch_id: Optional[int] = None
    status: str = "Active"


class UserUpdate(BaseModel):
    username: Optional[str] = None
    email: EmailStr
    password: Optional[str] = None
    role: str
    full_name: Optional[str] = None
    branch_id: Optional[int] = None
    status: str
    current_admin_password: str


class ProtectedAccountAction(BaseModel):
    current_admin_password: str


def is_admin_role(role: str) -> bool:
    return role in {"main_admin", "admin", "superadmin"}


def is_branch_role(role: str) -> bool:
    return role in {"branch_admin", "branch_staff"}


def serialize_account(user, branch_name: Optional[str] = None):
    citizen_profile = serialize_citizen_user(user) if isinstance(user, CitizenUser) else None
    return {
        "id": user.id,
        "username": getattr(user, "username", None),
        "email": citizen_profile["email"] if citizen_profile else user.email,
        "role": user.role,
        "full_name": citizen_profile["full_name"] if citizen_profile else getattr(user, "full_name", None),
        "branch_id": getattr(user, "branch_id", None),
        "branch_name": branch_name or "All Branches",
        "status": user.status,
        "last_login": user.last_login.isoformat() if user.last_login else None,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


def serialize_account_row(row):
    return {
        "id": row.id,
        "username": row.username,
        "email": row.email,
        "role": row.role,
        "full_name": row.full_name,
        "branch_id": row.branch_id,
        "branch_name": row.branch_name or "All Branches",
        "status": row.status,
        "last_login": row.last_login.isoformat() if row.last_login else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def account_sort_value(account: dict):
    created_at = account.get("created_at")
    if not created_at:
        return datetime.min
    try:
        return datetime.fromisoformat(created_at)
    except ValueError:
        return datetime.min


def require_accounts_access(current_user):
    require_permission("manage_users")(current_user)
    return current_user


def find_account(db: Session, user_id: int, role: Optional[str] = None):
    if role:
        if is_admin_role(role):
            return db.query(Admin).filter(Admin.id == user_id).first()
        if is_branch_role(role):
            return db.query(BranchStaff).filter(BranchStaff.id == user_id).first()
        if role == "public":
            return db.query(CitizenUser).filter(CitizenUser.id == user_id).first()

    account = db.query(Admin).filter(Admin.id == user_id).first()
    if account:
        return account
    account = db.query(BranchStaff).filter(BranchStaff.id == user_id).first()
    if account:
        return account
    return db.query(CitizenUser).filter(CitizenUser.id == user_id).first()


@router.get("/")
async def get_all_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    current_user: Admin = Depends(require_main_admin()),
    db: Session = Depends(get_db),
):
    require_accounts_access(current_user)

    accounts = [serialize_account(user, "All Branches") for user in db.query(Admin).all()]
    accounts.extend(
        serialize_account(user, branch.name if branch else "Unassigned Branch")
        for user, branch in db.query(BranchStaff, Branch).outerjoin(Branch, Branch.id == BranchStaff.branch_id).all()
    )
    accounts.extend(serialize_account(user, "Public Portal") for user in db.query(CitizenUser).all())
    accounts.sort(key=lambda account: (account_sort_value(account), account.get("id") or 0), reverse=True)

    total = len(accounts)
    total_pages = max(1, (total + page_size - 1) // page_size)
    start = (page - 1) * page_size
    end = start + page_size

    return {
        "items": accounts[start:end],
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
    }


@router.post("/")
async def create_user(
    user: UserCreate,
    current_user: Admin = Depends(require_main_admin()),
    db: Session = Depends(get_db),
):
    require_accounts_access(current_user)

    email = normalize_email(user.email, check_deliverability=True)
    ensure_email_is_unique(db, email)
    validate_strong_password(user.password)
    username = normalize_username(user.username) if user.username else None

    if is_branch_role(user.role) and not user.branch_id:
        raise HTTPException(status_code=400, detail="Branch assignment is required for branch accounts")

    if is_admin_role(user.role):
        if not username:
            raise HTTPException(status_code=400, detail="Username is required for admin accounts")
        ensure_username_is_unique(db, username)
        account = Admin(
            username=username,
            email=email,
            hashed_password=pwd_context.hash(user.password),
            role=user.role,
            status=user.status,
            is_verified=True,
        )
        branch_name = "All Branches"
    elif is_branch_role(user.role):
        if not username:
            raise HTTPException(status_code=400, detail="Username is required for branch accounts")
        ensure_username_is_unique(db, username)
        account = BranchStaff(
            username=username,
            email=email,
            full_name=user.full_name or username,
            hashed_password=pwd_context.hash(user.password),
            branch_id=user.branch_id,
            role=user.role,
            status=user.status,
            is_verified=True,
        )
        branch = db.query(Branch).filter(Branch.id == user.branch_id).first()
        branch_name = branch.name if branch else "Unassigned Branch"
    elif user.role == "public":
        account = CitizenUser(
            email=email,
            full_name=user.full_name or email.split("@", 1)[0],
            contact_number="",
            hashed_password=pwd_context.hash(user.password),
            role="public",
            status=user.status,
            is_verified=True,
        )
        branch_name = "Public Portal"
    else:
        raise HTTPException(status_code=400, detail="Unsupported account role")

    db.add(account)
    if isinstance(account, CitizenUser):
        apply_citizen_user_security(account)
    db.add(ActivityLog(
        action="User Account Created",
        user=current_user.username,
        details=f"Created account: {username or user.full_name or email} with role {user.role}",
        type="admin",
    ))
    db.commit()
    db.refresh(account)

    return serialize_account(account, branch_name)


@router.put("/{user_id}")
async def update_user(
    user_id: int,
    user: UserUpdate,
    current_user: Admin = Depends(require_main_admin()),
    db: Session = Depends(get_db),
):
    require_accounts_access(current_user)

    if not user.current_admin_password or not pwd_context.verify(user.current_admin_password, current_user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect main admin password")

    account = find_account(db, user_id, user.role)
    if not account:
        raise HTTPException(status_code=404, detail="User not found")

    email = normalize_email(user.email, check_deliverability=True)
    exclude_admin_id = account.id if isinstance(account, Admin) else None
    exclude_branch_staff_id = account.id if isinstance(account, BranchStaff) else None
    ensure_email_is_unique(db, email, exclude_admin_id=exclude_admin_id, exclude_branch_staff_id=exclude_branch_staff_id)

    account.email = email
    account.status = user.status

    if user.password:
        validate_strong_password(user.password)
        account.hashed_password = pwd_context.hash(user.password)

    if isinstance(account, Admin):
        if not is_admin_role(user.role):
            raise HTTPException(status_code=400, detail="Admin accounts must keep an admin role")
        if not user.username:
            raise HTTPException(status_code=400, detail="Username is required for admin accounts")
        username = normalize_username(user.username)
        ensure_username_is_unique(db, username, exclude_admin_id=exclude_admin_id, exclude_branch_staff_id=exclude_branch_staff_id)
        account.username = username
        account.role = user.role
        branch_name = "All Branches"
    elif isinstance(account, BranchStaff):
        if not is_branch_role(user.role):
            raise HTTPException(status_code=400, detail="Branch accounts must keep a branch role")
        if not user.branch_id:
            raise HTTPException(status_code=400, detail="Branch assignment is required for branch accounts")
        if not user.username:
            raise HTTPException(status_code=400, detail="Username is required for branch accounts")
        username = normalize_username(user.username)
        ensure_username_is_unique(db, username, exclude_admin_id=exclude_admin_id, exclude_branch_staff_id=exclude_branch_staff_id)
        account.username = username
        account.role = user.role
        account.branch_id = user.branch_id
        account.full_name = user.full_name or account.full_name or username
        branch = db.query(Branch).filter(Branch.id == user.branch_id).first()
        branch_name = branch.name if branch else "Unassigned Branch"
    else:
        if user.role != "public":
            raise HTTPException(status_code=400, detail="Citizen accounts must keep a public role")
        account.full_name = user.full_name or account.full_name
        apply_citizen_user_security(account)
        branch_name = "Public Portal"

    db.add(ActivityLog(
        action="User Account Updated",
        user=current_user.username,
        details=f"Updated account: {getattr(account, 'username', None) or getattr(account, 'full_name', None) or account.email}",
        type="admin",
    ))
    db.commit()
    db.refresh(account)

    return serialize_account(account, branch_name)


@router.put("/{user_id}/deactivate")
async def deactivate_user(
    user_id: int,
    role: Optional[str] = Query(None),
    payload: ProtectedAccountAction = None,
    current_user: Admin = Depends(require_main_admin()),
    db: Session = Depends(get_db),
):
    require_accounts_access(current_user)

    if payload is None or not payload.current_admin_password or not pwd_context.verify(payload.current_admin_password, current_user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect main admin password")

    account = find_account(db, user_id, role)
    if not account:
        raise HTTPException(status_code=404, detail="User not found")

    account.status = "Inactive"
    db.add(ActivityLog(
        action="User Account Deactivated",
        user=current_user.username,
        details=f"Deactivated account: {getattr(account, 'username', None) or getattr(account, 'full_name', None) or account.email}",
        type="admin",
    ))
    db.commit()

    return {"message": "User deactivated successfully"}


@router.delete("/{user_id}")
async def delete_user(
    user_id: int,
    role: Optional[str] = Query(None),
    payload: ProtectedAccountAction = None,
    current_user: Admin = Depends(require_main_admin()),
    db: Session = Depends(get_db),
):
    require_accounts_access(current_user)

    if payload is None or not payload.current_admin_password or not pwd_context.verify(payload.current_admin_password, current_user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect main admin password")

    account = find_account(db, user_id, role)
    if not account:
        raise HTTPException(status_code=404, detail="User not found")

    if isinstance(account, Admin) and account.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    db.add(ActivityLog(
        action="User Account Deleted",
        user=current_user.username,
        details=f"Deleted account: {getattr(account, 'username', None) or getattr(account, 'full_name', None) or account.email}",
        type="admin",
    ))
    db.delete(account)
    db.commit()

    return {"message": "User deleted successfully"}
