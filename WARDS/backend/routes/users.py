from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from slowapi import Limiter
from slowapi.util import get_remote_address
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from database.models import ActivityLog, Admin, Branch, BranchStaff, CitizenUser, PrivacyConsent, Queue, QueueHistory, TaxAssessmentRecord, TaxpayerIdentifierSubmission, get_db
from auth import get_current_admin_user, get_current_branch_staff, hash_password, verify_password, verify_account_password
from utils.field_crypto import apply_citizen_user_security, get_decrypted_or_raw, serialize_citizen_user
from utils.security_validation import (
    ensure_contact_number_is_unique,
    ensure_email_is_unique,
    ensure_username_is_unique,
    normalize_email,
    normalize_username,
    normalize_citizen_full_name,
    normalize_ph_contact_number,
    validate_strong_password,
)
from utils.rbac import require_permission

def get_rate_limit_key(request: Request) -> str:
    """Get rate limit key - user-based if authenticated, otherwise IP-based"""
    if hasattr(request.state, 'user') and request.state.user:
        return f"user:{request.state.user.id}"
    return get_remote_address(request)


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


limiter = Limiter(key_func=get_rate_limit_key)

router = APIRouter()
security = HTTPBearer(auto_error=False)


async def get_accounts_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> Admin | BranchStaff:
    try:
        return await get_current_admin_user(request, credentials, db)
    except HTTPException as admin_exc:
        try:
            staff = await get_current_branch_staff(request, credentials, db)
        except HTTPException:
            raise admin_exc
        if staff.role != "branch_admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only Branch Admin accounts can manage branch accounts.",
            )
        return staff


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
    model_config = ConfigDict(extra="forbid")

    email: str
    password: Optional[str] = None
    role: str
    username: Optional[str] = None
    full_name: Optional[str] = None
    contact_number: Optional[str] = None
    current_admin_password: str


class ProtectedAccountAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

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
        "contact_number": citizen_profile["contact_number"] if citizen_profile else None,
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


def get_branch_managed_citizen_ids(db: Session, branch_id: int) -> set[int]:
    citizen_ids: set[int] = set()

    def add_values(values):
        citizen_ids.update(
            value for value in values
            if value is not None
        )

    add_values(
        row[0]
        for row in db.query(TaxpayerIdentifierSubmission.citizen_user_id)
        .filter(
            TaxpayerIdentifierSubmission.branch_id == branch_id,
            TaxpayerIdentifierSubmission.citizen_user_id.isnot(None),
        )
        .all()
    )
    add_values(
        row[0]
        for row in db.query(TaxAssessmentRecord.citizen_user_id)
        .filter(
            TaxAssessmentRecord.branch_id == branch_id,
            TaxAssessmentRecord.citizen_user_id.isnot(None),
        )
        .all()
    )
    add_values(
        row[0]
        for row in db.query(Queue.citizen_user_id)
        .filter(
            Queue.branch_id == branch_id,
            Queue.citizen_user_id.isnot(None),
        )
        .all()
    )
    add_values(
        row[0]
        for row in db.query(QueueHistory.citizen_user_id)
        .filter(
            QueueHistory.branch_id == branch_id,
            QueueHistory.citizen_user_id.isnot(None),
        )
        .all()
    )

    return citizen_ids


def can_manage_account(current_user: Admin | BranchStaff, account, db: Session) -> bool:
    if current_user.role in {"main_admin", "superadmin"}:
        return True

    if current_user.role != "branch_admin":
        return False

    if isinstance(account, Admin):
        return False

    if isinstance(account, BranchStaff):
        return (
            account.branch_id == current_user.branch_id
            and account.role in {"branch_admin", "branch_staff"}
        )

    if isinstance(account, CitizenUser):
        if not current_user.branch_id:
            return False
        return account.id in get_branch_managed_citizen_ids(db, current_user.branch_id)

    return False


def ensure_manageable_account(current_user: Admin | BranchStaff, account, db: Session):
    if not can_manage_account(current_user, account, db):
        raise HTTPException(status_code=403, detail="You are not authorized to manage this account.")


def protected_admin_label(current_user: Admin | BranchStaff) -> str:
    if current_user.role == "superadmin":
        return "super admin"
    if current_user.role == "branch_admin":
        return "branch admin"
    return "main admin"


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
    branch_id: Optional[int] = Query(None),
    current_user: Admin | BranchStaff = Depends(get_accounts_current_user),
    db: Session = Depends(get_db),
):
    require_accounts_access(current_user)

    accounts = []
    effective_branch_id = branch_id or (current_user.branch_id if current_user.role == "branch_admin" else None)

    if effective_branch_id:
        branch_name = "Unassigned Branch"
        branch = db.query(Branch).filter(Branch.id == effective_branch_id).first()
        if branch:
            branch_name = (get_decrypted_or_raw(branch, "name") or branch.name)

        accounts.extend(
            serialize_account(user, branch_name)
            for user in db.query(BranchStaff)
            .filter(
                BranchStaff.branch_id == effective_branch_id,
                BranchStaff.role.in_(["branch_admin", "branch_staff"]),
            )
            .all()
        )

        citizen_ids = get_branch_managed_citizen_ids(db, effective_branch_id)
        if citizen_ids:
            accounts.extend(
                serialize_account(user, "Public Portal")
                for user in db.query(CitizenUser).filter(CitizenUser.id.in_(citizen_ids)).all()
            )
    elif current_user.role in {"main_admin", "superadmin"}:
        accounts.extend(serialize_account(user, "All Branches") for user in db.query(Admin).all())
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
    page = min(max(1, page), total_pages)
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
@limiter.limit("10/minute")
async def create_user(
    request: Request,
    user: UserCreate,
    current_user: Admin | BranchStaff = Depends(get_accounts_current_user),
    db: Session = Depends(get_db),
):
    require_accounts_access(current_user)

    if current_user.role not in {"main_admin", "superadmin"}:
        raise HTTPException(status_code=403, detail="Only Main Admin and Super Admin can create accounts.")

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
            hashed_password=hash_password(user.password),
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
            hashed_password=hash_password(user.password),
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
            hashed_password=hash_password(user.password),
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
    log_branch = db.query(Branch).filter(Branch.id == getattr(account, "branch_id", None)).first() if getattr(account, "branch_id", None) else None
    log_branch_name = get_decrypted_or_raw(log_branch, "name") or log_branch.name if log_branch else None
    branch_prefix = f"branch: {log_branch_name} | " if log_branch_name else ""
    db.add(ActivityLog(
        action="User Account Created",
        user=current_user.username,
        details=f"{branch_prefix}Created account: {username or user.full_name or email} with role {user.role} | ip: {_get_client_ip(request)}",
        type="admin",
    ))
    db.commit()
    db.refresh(account)

    return serialize_account(account, branch_name)


@router.put("/{user_id}")
@limiter.limit("10/minute")
async def update_user(
    request: Request,
    user_id: int,
    user: UserUpdate,
    current_user: Admin | BranchStaff = Depends(get_accounts_current_user),
    db: Session = Depends(get_db),
):
    require_accounts_access(current_user)

    verify_account_password(user.current_admin_password, current_user.hashed_password, detail=f"Incorrect {protected_admin_label(current_user)} password")

    account = find_account(db, user_id, user.role)
    if not account:
        raise HTTPException(status_code=404, detail="User not found")
    ensure_manageable_account(current_user, account, db)

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

    if user.password:
        validate_strong_password(user.password)
        account.hashed_password = hash_password(user.password)

    if isinstance(account, Admin):
        if not is_admin_role(user.role):
            raise HTTPException(status_code=400, detail="Admin accounts must keep an admin role")
        if user.role == "main_admin" and current_user.role not in {"main_admin", "superadmin"}:
            raise HTTPException(status_code=403, detail="Only Main Admin or Super Admin can assign the main_admin role")
        if user.username:
            username = normalize_username(user.username)
            ensure_username_is_unique(db, username, exclude_admin_id=account.id)
            account.username = username
        if user.full_name:
            account.full_name = normalize_citizen_full_name(user.full_name)
        branch_name = "All Branches"
    elif isinstance(account, BranchStaff):
        if not is_branch_role(user.role):
            raise HTTPException(status_code=400, detail="Branch accounts must keep a branch role")
        if user.username:
            username = normalize_username(user.username)
            ensure_username_is_unique(db, username, exclude_branch_staff_id=account.id)
            account.username = username
        if user.full_name:
            account.full_name = normalize_citizen_full_name(user.full_name)
        branch = db.query(Branch).filter(Branch.id == account.branch_id).first()
        branch_name = (get_decrypted_or_raw(branch, "name") or branch.name) if branch else "Unassigned Branch"
    else:
        if user.role != "public":
            raise HTTPException(status_code=400, detail="Citizen accounts must keep a public role")
        if user.contact_number is not None:
            normalized_contact = normalize_ph_contact_number(user.contact_number)
            ensure_contact_number_is_unique(db, normalized_contact, exclude_citizen_id=account.id)
            account.contact_number = normalized_contact
        if user.full_name:
            account.full_name = normalize_citizen_full_name(user.full_name)
        apply_citizen_user_security(account)
        branch_name = "Public Portal"

    log_branch = db.query(Branch).filter(Branch.id == getattr(account, "branch_id", None)).first() if getattr(account, "branch_id", None) else None
    log_branch_name = get_decrypted_or_raw(log_branch, "name") or log_branch.name if log_branch else None
    branch_prefix = f"branch: {log_branch_name} | " if log_branch_name else ""
    db.add(ActivityLog(
        action="User Account Updated",
        user=current_user.username,
        details=f"{branch_prefix}Updated account: {getattr(account, 'username', None) or getattr(account, 'full_name', None) or account.email} | ip: {_get_client_ip(request)}",
        type="admin",
    ))
    db.commit()
    db.refresh(account)

    return serialize_account(account, branch_name)


@router.put("/{user_id}/deactivate")
async def deactivate_user(
    request: Request,
    user_id: int,
    role: Optional[str] = Query(None),
    payload: ProtectedAccountAction = None,
    current_user: Admin | BranchStaff = Depends(get_accounts_current_user),
    db: Session = Depends(get_db),
):
    require_accounts_access(current_user)

    if payload is None:
        raise HTTPException(status_code=401, detail=f"Incorrect {protected_admin_label(current_user)} password")
    verify_account_password(payload.current_admin_password, current_user.hashed_password, detail=f"Incorrect {protected_admin_label(current_user)} password")

    account = find_account(db, user_id, role)
    if not account:
        raise HTTPException(status_code=404, detail="User not found")
    ensure_manageable_account(current_user, account, db)

    account.status = "Inactive"
    log_branch = db.query(Branch).filter(Branch.id == getattr(account, "branch_id", None)).first() if getattr(account, "branch_id", None) else None
    log_branch_name = get_decrypted_or_raw(log_branch, "name") or log_branch.name if log_branch else None
    branch_prefix = f"branch: {log_branch_name} | " if log_branch_name else ""
    db.add(ActivityLog(
        action="User Account Deactivated",
        user=current_user.username,
        details=f"{branch_prefix}Deactivated account: {getattr(account, 'username', None) or getattr(account, 'full_name', None) or account.email} | ip: {_get_client_ip(request)}",
        type="admin",
    ))
    db.commit()

    return {"message": "User deactivated successfully"}


@router.put("/{user_id}/activate")
async def activate_user(
    request: Request,
    user_id: int,
    role: Optional[str] = Query(None),
    payload: ProtectedAccountAction = None,
    current_user: Admin | BranchStaff = Depends(get_accounts_current_user),
    db: Session = Depends(get_db),
):
    require_accounts_access(current_user)

    if payload is None:
        raise HTTPException(status_code=401, detail=f"Incorrect {protected_admin_label(current_user)} password")
    verify_account_password(payload.current_admin_password, current_user.hashed_password, detail=f"Incorrect {protected_admin_label(current_user)} password")

    account = find_account(db, user_id, role)
    if not account:
        raise HTTPException(status_code=404, detail="User not found")
    ensure_manageable_account(current_user, account, db)

    account.status = "Active"
    log_branch = db.query(Branch).filter(Branch.id == getattr(account, "branch_id", None)).first() if getattr(account, "branch_id", None) else None
    log_branch_name = get_decrypted_or_raw(log_branch, "name") or log_branch.name if log_branch else None
    branch_prefix = f"branch: {log_branch_name} | " if log_branch_name else ""
    db.add(ActivityLog(
        action="User Account Activated",
        user=current_user.username,
        details=f"{branch_prefix}Activated account: {getattr(account, 'username', None) or getattr(account, 'full_name', None) or account.email} | ip: {_get_client_ip(request)}",
        type="admin",
    ))
    db.commit()

    return {"message": "User activated successfully"}


@router.delete("/{user_id}")
@limiter.limit("10/minute")
async def delete_user(
    request: Request,
    user_id: int,
    role: Optional[str] = Query(None),
    payload: ProtectedAccountAction = None,
    current_user: Admin | BranchStaff = Depends(get_accounts_current_user),
    db: Session = Depends(get_db),
):
    require_accounts_access(current_user)

    if payload is None:
        raise HTTPException(status_code=401, detail=f"Incorrect {protected_admin_label(current_user)} password")
    verify_account_password(payload.current_admin_password, current_user.hashed_password, detail=f"Incorrect {protected_admin_label(current_user)} password")

    account = find_account(db, user_id, role)
    if not account:
        raise HTTPException(status_code=404, detail="User not found")
    ensure_manageable_account(current_user, account, db)

    if isinstance(account, Admin) and account.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    # Delete related privacy consents before deleting citizen user to avoid constraint violations
    if isinstance(account, CitizenUser):
        db.query(PrivacyConsent).filter(PrivacyConsent.citizen_user_id == account.id).delete()

    log_branch = db.query(Branch).filter(Branch.id == getattr(account, "branch_id", None)).first() if getattr(account, "branch_id", None) else None
    log_branch_name = get_decrypted_or_raw(log_branch, "name") or log_branch.name if log_branch else None
    branch_prefix = f"branch: {log_branch_name} | " if log_branch_name else ""
    db.add(ActivityLog(
        action="User Account Deleted",
        user=current_user.username,
        details=f"{branch_prefix}Deleted account: {getattr(account, 'username', None) or getattr(account, 'full_name', None) or account.email} | ip: {_get_client_ip(request)}",
        type="admin",
    ))
    db.delete(account)
    db.commit()

    return {"message": "User deleted successfully"}
