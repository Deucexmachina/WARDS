from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.models import ActivityLog, Admin, Branch, BranchStaff, CitizenUser, get_db
from middleware.admin_auth import require_main_admin
from utils.field_crypto import apply_citizen_user_security, get_decrypted_or_raw, serialize_citizen_user
from utils.security_validation import (
    ensure_email_is_unique,
    ensure_username_is_unique,
    normalize_email,
    normalize_username,
    normalize_citizen_full_name,
    validate_strong_password,
)
from utils.rbac import require_permission

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class UserCreate(BaseModel):
    username: Optional[str] = None
    email: str
    password: str
    role: str
    full_name: Optional[str] = None
    branch_id: Optional[int] = None
    service_window: Optional[str] = None
    assigned_window_number: Optional[int] = None
    status: str = "Active"


class UserUpdate(BaseModel):
    username: Optional[str] = None
    email: str
    password: Optional[str] = None
    role: str
    full_name: Optional[str] = None
    branch_id: Optional[int] = None
    service_window: Optional[str] = None
    assigned_window_number: Optional[int] = None
    status: str
    current_admin_password: str


class ProtectedAccountAction(BaseModel):
    current_admin_password: str


def is_admin_role(role: str) -> bool:
    return role in {"main_admin", "admin", "superadmin"}


def is_branch_role(role: str) -> bool:
    return role in {"branch_admin", "branch_staff"}


SERVICE_WINDOW_ALIASES = {
    "RPT": "RPT",
    "REAL_PROPERTY_TAX": "RPT",
    "BT": "BUSINESS",
    "BUSINESS": "BUSINESS",
    "BUSINESS_TAX": "BUSINESS",
    "MISC": "MISC",
    "MISCELLANEOUS": "MISC",
    "QW4": "QW4",
    "QUEUE_WINDOW_4": "QW4",
    "QW5": "QW5",
    "QUEUE_WINDOW_5": "QW5",
}

SERVICE_WINDOW_LABELS = {
    "RPT": "RPT",
    "BUSINESS": "BT",
    "MISC": "MISC",
    "QW4": "Queue Window 4",
    "QW5": "Queue Window 5",
}

MAX_ASSIGNED_WINDOW_NUMBER = 5


def is_internal_branch_email(email: str) -> bool:
    normalized = (email or "").strip().lower()
    local_part, separator, domain = normalized.partition("@")
    if not separator or domain != "branch.local" or not local_part:
        return False
    return all(character.isalnum() or character in "._-" for character in local_part)


def normalize_account_email(role: str, email: str) -> str:
    normalized = (email or "").strip().lower()
    if is_branch_role(role) and is_internal_branch_email(normalized):
        return normalized
    return normalize_email(normalized, check_deliverability=True)


def normalize_branch_service_window(value: Optional[str]) -> str:
    normalized = (value or "").strip().upper().replace(" ", "_")
    service_window = SERVICE_WINDOW_ALIASES.get(normalized)
    if not service_window:
        raise HTTPException(
            status_code=400,
            detail="Branch staff accounts require an assigned queue/service role: RPT, BT, MISC, Queue Window 4, or Queue Window 5.",
        )
    return service_window


def default_assigned_window_number(service_window: Optional[str]) -> int:
    defaults = {"RPT": 1, "BUSINESS": 2, "MISC": 3, "QW4": 4, "QW5": 5}
    return defaults.get(service_window or "", 1)


def normalize_assigned_window_number(value: Optional[int], service_window: Optional[str]) -> int:
    if value is None:
        return default_assigned_window_number(service_window)
    try:
        window_number = int(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Assigned physical window must be a number from 1 to 5.")
    if window_number < 1 or window_number > MAX_ASSIGNED_WINDOW_NUMBER:
        raise HTTPException(status_code=400, detail="Assigned physical window must be between 1 and 5.")
    return window_number


def serialize_account(user, branch_name: Optional[str] = None):
    citizen_profile = serialize_citizen_user(user) if isinstance(user, CitizenUser) else None
    service_window = getattr(user, "service_window", None)
    service_window_label = getattr(user, "service_window_label", None) or SERVICE_WINDOW_LABELS.get(service_window, service_window)
    return {
        "id": user.id,
        "username": getattr(user, "username", None),
        "email": citizen_profile["email"] if citizen_profile else user.email,
        "role": user.role,
        "full_name": citizen_profile["full_name"] if citizen_profile else getattr(user, "full_name", None),
        "branch_id": getattr(user, "branch_id", None),
        "branch_name": branch_name or "All Branches",
        "account_scope": getattr(user, "account_scope", None),
        "service_window": service_window,
        "service_window_label": service_window_label,
        "assigned_window_number": getattr(user, "assigned_window_number", None) or default_assigned_window_number(service_window),
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


def protected_admin_label(current_user: Admin) -> str:
    return "super admin" if current_user.role == "superadmin" else "main admin"


def verify_protected_account_password(current_user: Admin, password: str):
    if not password or not pwd_context.verify(password, current_user.hashed_password):
        raise HTTPException(
            status_code=401,
            detail=f"Incorrect {protected_admin_label(current_user)} password",
        )


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
        serialize_account(
            user,
            (get_decrypted_or_raw(branch, "name") or branch.name) if branch else "Unassigned Branch",
        )
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

    email = normalize_account_email(user.role, user.email)
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
        service_window = None
        assigned_window_number = None
        account_scope = "full_branch"
        if user.role == "branch_staff":
            service_window = normalize_branch_service_window(user.service_window)
            assigned_window_number = normalize_assigned_window_number(user.assigned_window_number, service_window)
            account_scope = "queue_window"
        account = BranchStaff(
            username=username,
            email=email,
            full_name=normalize_citizen_full_name(user.full_name or username),
            hashed_password=pwd_context.hash(user.password),
            branch_id=user.branch_id,
            role=user.role,
            account_scope=account_scope,
            service_window=service_window,
            service_window_label=SERVICE_WINDOW_LABELS.get(service_window, service_window) if service_window else None,
            assigned_window_number=assigned_window_number,
            status=user.status,
            is_verified=True,
        )
        branch = db.query(Branch).filter(Branch.id == user.branch_id).first()
        branch_name = (get_decrypted_or_raw(branch, "name") or branch.name) if branch else "Unassigned Branch"
    elif user.role == "public":
        account = CitizenUser(
            email=email,
            full_name=normalize_citizen_full_name(user.full_name or email.split("@", 1)[0]),
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

    verify_protected_account_password(current_user, user.current_admin_password)

    account = find_account(db, user_id, user.role)
    if not account:
        raise HTTPException(status_code=404, detail="User not found")

    email = normalize_account_email(user.role, user.email)
    exclude_admin_id = account.id if isinstance(account, Admin) else None
    exclude_branch_staff_id = account.id if isinstance(account, BranchStaff) else None
    exclude_citizen_id = account.id if isinstance(account, CitizenUser) else None
    ensure_email_is_unique(
        db,
        email,
        exclude_admin_id=exclude_admin_id,
        exclude_branch_staff_id=exclude_branch_staff_id,
        exclude_citizen_id=exclude_citizen_id,
    )

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
        if user.full_name:
            account.full_name = normalize_citizen_full_name(user.full_name)
        if user.role == "branch_staff":
            account.service_window = normalize_branch_service_window(user.service_window)
            account.service_window_label = SERVICE_WINDOW_LABELS.get(account.service_window, account.service_window)
            account.assigned_window_number = normalize_assigned_window_number(user.assigned_window_number, account.service_window)
            account.account_scope = "queue_window"
        else:
            account.service_window = None
            account.service_window_label = None
            account.assigned_window_number = None
            account.account_scope = "full_branch"
        branch = db.query(Branch).filter(Branch.id == user.branch_id).first()
        branch_name = (get_decrypted_or_raw(branch, "name") or branch.name) if branch else "Unassigned Branch"
    else:
        if user.role != "public":
            raise HTTPException(status_code=400, detail="Citizen accounts must keep a public role")
        if user.full_name:
            account.full_name = normalize_citizen_full_name(user.full_name)
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

    if payload is None:
        raise HTTPException(status_code=401, detail=f"Incorrect {protected_admin_label(current_user)} password")
    verify_protected_account_password(current_user, payload.current_admin_password)

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

    if payload is None:
        raise HTTPException(status_code=401, detail=f"Incorrect {protected_admin_label(current_user)} password")
    verify_protected_account_password(current_user, payload.current_admin_password)

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
