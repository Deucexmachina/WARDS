import json
import os
import re
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from database.models import (
    ActivityLog,
    Admin,
    Announcement,
    Branch,
    BranchAppointmentSchedule,
    BranchAppointmentScheduleAudit,
    BranchOperatingHours,
    BranchService,
    BranchStaff,
    BranchSystemSetting,
    BusinessTaxApplication,
    CollectionAccount,
    DiscrepancyReport,
    Invite,
    Payment,
    Queue,
    QueueActivity,
    QueueHistory,
    ReceiptRecord,
    ReceiptRequest,
    ReceiptRequestHistory,
    Remittance,
    RemittanceItem,
    ReportHistory,
    RPTPropertyRecord,
    TaxAssessmentRecord,
    TaxpayerIdentifierSubmission,
    Report,
    get_db,
)
from utils.field_crypto import apply_invite_security, find_active_invite_by_email_role, get_decrypted_or_raw
from auth import get_current_admin_user, require_main_admin
from services.email_service import send_branch_access_email, send_new_window_accounts_email, smtp_is_configured
from utils.field_crypto import build_redacted_text, get_decrypted_or_raw, set_encrypted_hash_companions
from auth import create_access_token, set_auth_cookie
from auth import hash_password, verify_password, verify_account_password, delete_mfa_secret
from auth import get_branch_dashboard_url, get_session_timeout_minutes, slugify_branch_name
from utils.security_validation import (
    ensure_branch_name_is_unique,
    ensure_email_is_unique,
    ensure_username_is_unique,
    normalize_branch_name,
    normalize_email,
    normalize_username,
    validate_strong_password,
)
from utils.branch_window_config import (
    MAX_QUEUE_WINDOW_ACCOUNTS,
    STANDARD_SERVICE_LABELS,
    default_assigned_window_number as resolve_default_assigned_window_number,
    default_service_window_for_position,
    get_configured_window_accounts,
    get_default_window_label,
    get_service_window_display_label,
    normalize_service_window as normalize_window_service_code,
)
from utils.rbac import require_permission

router = APIRouter()


def build_branch_dashboard_url(name: str) -> str:
    base_url = os.getenv("FRONTEND_BASE_URL", "http://localhost:3000").rstrip("/")
    return f"{base_url}/branch-dashboard/{slugify_branch_name(name)}"


def ensure_branch_dashboard_url(branch: Branch) -> Branch:
    if not branch.dashboard_url:
        branch.dashboard_url = build_branch_dashboard_url(get_decrypted_or_raw(branch, "name") or "")
    return branch


def apply_branch_security_fields(branch: Branch) -> Branch:
    branch_name = get_decrypted_or_raw(branch, "name") or branch.name
    branch_location = get_decrypted_or_raw(branch, "location") or branch.location
    branch_contact = get_decrypted_or_raw(branch, "contact") or branch.contact
    branch_dashboard_url = get_decrypted_or_raw(branch, "dashboard_url") or branch.dashboard_url
    set_encrypted_hash_companions(branch, "name", branch_name)
    set_encrypted_hash_companions(branch, "location", branch_location)
    set_encrypted_hash_companions(branch, "contact", branch_contact)
    set_encrypted_hash_companions(branch, "dashboard_url", branch_dashboard_url)
    branch.name = build_redacted_text("BRANCH_NAME", branch_name, 255)
    branch.location = build_redacted_text("BRANCH_LOCATION", branch_location, 255)
    branch.contact = build_redacted_text("BRANCH_CONTACT", branch_contact, 255)
    branch.dashboard_url = build_redacted_text("BRANCH_URL", branch_dashboard_url, 255)
    return branch


def get_branch_verification_status(branch: Branch, db: Session) -> str:
    branch_admin = (
        db.query(BranchStaff)
        .filter(BranchStaff.branch_id == branch.id, BranchStaff.role == "branch_admin")
        .order_by(BranchStaff.created_at.desc())
        .first()
    )
    if branch_admin and (not branch_admin.is_verified or branch_admin.status == "Pending Verification"):
        return "Pending"
    return branch.status


def serialize_branch(branch: Branch, db: Session) -> dict:
    ensure_branch_dashboard_url(branch)
    branch_name = get_decrypted_or_raw(branch, "name")
    branch_location = get_decrypted_or_raw(branch, "location")
    branch_contact = get_decrypted_or_raw(branch, "contact")
    branch_dashboard_url = get_decrypted_or_raw(branch, "dashboard_url")
    window_accounts = (
        db.query(BranchStaff)
        .filter(
            BranchStaff.branch_id == branch.id,
            BranchStaff.role == "branch_staff",
            BranchStaff.account_scope == "queue_window",
        )
        .order_by(BranchStaff.assigned_window_number.asc(), BranchStaff.created_at.asc())
        .all()
    )
    return {
        "id": branch.id,
        "name": branch_name,
        "location": branch_location,
        "contact": branch_contact,
        "dashboard_url": branch_dashboard_url,
        "counters": branch.counters,
        "status": branch.status,
        "verification_status": get_branch_verification_status(branch, db),
        "window_accounts": [
            {
                "id": account.id,
                "username": account.username,
                "email": account.email,
                "full_name": account.full_name,
                "service_window": account.service_window,
                "service_window_label": get_window_display_label(account),
                "assigned_window_number": account.assigned_window_number or default_assigned_window_number(account.service_window),
                "account_scope": account.account_scope,
                "status": account.status,
                "is_verified": account.is_verified,
            }
            for account in window_accounts
        ],
        "created_at": branch.created_at.isoformat() if branch.created_at else None,
    }


def normalize_service_window(value: str) -> str:
    try:
        return normalize_window_service_code(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Unsupported service window: {value}")


def get_window_display_label(account: BranchStaff) -> str:
    return get_service_window_display_label(account.service_window, account.service_window_label)


def generate_window_username(db: Session, branch_name: str, assigned_window_number: int) -> str:
    branch_slug = slugify_branch_name(branch_name).replace("-", "")[:20]
    base_username = normalize_username(f"{branch_slug}_staff{assigned_window_number}")

    candidate = base_username
    counter = 1
    while db.query(BranchStaff).filter(BranchStaff.username == candidate).first():
        counter += 1
        candidate = normalize_username(f"{base_username}_{counter}")
    return candidate


def generate_window_password(service_window: str) -> str:
    service_slug = get_service_window_display_label(service_window).replace(" ", "")
    return f"Wards!{service_slug}{secrets.token_hex(4)}9"


def generate_window_internal_email(username: str) -> str:
    return f"{username}@branch.local"


def generate_window_full_name(branch_name: str, window_label: str) -> str:
    return f"{branch_name} {window_label} Staff"


def build_window_account_delivery_payload(
    *,
    username: str,
    email: str,
    full_name: str,
    service_window: str,
    assigned_window_number: int,
    window_label: str,
    temporary_password: str | None,
) -> dict:
    return {
        "service_window": service_window,
        "assigned_window_number": assigned_window_number,
        "window_label": window_label,
        "username": username,
        "email": email,
        "full_name": full_name,
        "status": "Active",
        "account_scope": "queue_window",
        "temporary_password": temporary_password,
        "mfa_required": True,
    }


def normalize_counter_count(counters: int) -> int:
    return max(1, min(int(counters or 1), MAX_QUEUE_WINDOW_ACCOUNTS))


def default_assigned_window_number(service_window: Optional[str]) -> int:
    return resolve_default_assigned_window_number(service_window)


def normalize_assigned_window_number(value: Optional[int], fallback_service_window: Optional[str] = None) -> int:
    if value is None:
        return default_assigned_window_number(fallback_service_window)
    try:
        window_number = int(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"Assigned window must be a number from 1 to {MAX_QUEUE_WINDOW_ACCOUNTS}.")
    if window_number < 1 or window_number > MAX_QUEUE_WINDOW_ACCOUNTS:
        raise HTTPException(status_code=400, detail=f"Assigned window must be between 1 and {MAX_QUEUE_WINDOW_ACCOUNTS}.")
    return window_number


class BranchWindowAccountCreate(BaseModel):
    id: Optional[int] = None
    service_window: str
    assigned_window_number: Optional[int] = None
    custom_label: Optional[str] = None

class BranchCreate(BaseModel):
    name: str
    location: str
    contact: str
    counters: int
    status: str = "Active"
    admin_username: Optional[str] = None
    admin_email: Optional[str] = None
    admin_password: Optional[str] = None
    window_accounts: List[BranchWindowAccountCreate] = []

class BranchUpdate(BaseModel):
    name: str
    location: str
    contact: str
    counters: int
    status: str
    window_accounts: List[BranchWindowAccountCreate] = []
    current_admin_password: str


class BranchDeleteRequest(BaseModel):
    current_admin_password: str


class ReassignWindowService(BaseModel):
    assigned_window_number: int
    service_window: str


class BranchReassignServicesRequest(BaseModel):
    window_services: List[ReassignWindowService]
    current_admin_password: str


def normalize_window_accounts_payload(
    requested_window_accounts: List[BranchWindowAccountCreate],
    normalized_counter_count: int,
) -> list[dict]:
    normalized_window_accounts = []
    used_service_windows: set[str] = set()
    used_assigned_window_numbers: set[int] = set()
    for index in range(normalized_counter_count):
        requested = requested_window_accounts[index] if index < len(requested_window_accounts) else None
        fallback_service_window = default_service_window_for_position(index)
        assigned_window_number = normalize_assigned_window_number(
            requested.assigned_window_number if requested else index + 1,
            fallback_service_window,
        )
        if assigned_window_number in used_assigned_window_numbers:
            raise HTTPException(status_code=400, detail=f"Window {assigned_window_number} is already assigned to another queue window staff account.")
        used_assigned_window_numbers.add(assigned_window_number)
        requested_role = (requested.service_window if requested else fallback_service_window or "").strip().upper()
        if requested_role == "OTHER":
            raise HTTPException(status_code=400, detail="Custom service windows are no longer supported in branch setup. Please assign one of the standard services.")
        service_window = normalize_service_window(requested.service_window) if requested else fallback_service_window
        window_label = get_default_window_label(service_window)
        if service_window in used_service_windows:
            role_label = STANDARD_SERVICE_LABELS.get(service_window, window_label)
            raise HTTPException(status_code=400, detail=f"{role_label} is already assigned to another window in this branch setup.")
        used_service_windows.add(service_window)
        normalized_window_accounts.append({
            "id": requested.id if requested else None,
            "service_window": service_window,
            "assigned_window_number": assigned_window_number,
            "window_label": window_label,
        })
    return normalized_window_accounts

@router.get("/")
async def get_all_branches(db: Session = Depends(get_db)):
    branches = db.query(Branch).all()
    return [serialize_branch(branch, db) for branch in branches]

@router.get("/{branch_id}")
async def get_branch(branch_id: int, db: Session = Depends(get_db)):
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    return serialize_branch(branch, db)


@router.post("/{branch_id}/superadmin-access")
async def create_superadmin_branch_session(
    branch_id: int,
    current_user: Admin = Depends(require_main_admin()),
    db: Session = Depends(get_db),
):
    if current_user.role != "superadmin":
        raise HTTPException(status_code=403, detail="Only the Superadmin account can manage a branch directly.")

    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    staff = (
        db.query(BranchStaff)
        .filter(BranchStaff.branch_id == branch_id, BranchStaff.role == "branch_admin", BranchStaff.status == "Active")
        .order_by(BranchStaff.id.asc())
        .first()
    )
    if not staff:
        raise HTTPException(status_code=404, detail="This branch does not have an active branch admin account to manage.")

    window_accounts = (
        db.query(BranchStaff)
        .filter(
            BranchStaff.branch_id == branch_id,
            BranchStaff.account_scope == "queue_window",
            BranchStaff.status == "Active",
        )
        .order_by(BranchStaff.assigned_window_number.asc(), BranchStaff.id.asc())
        .all()
    )

    access_token = create_access_token(
        "branch",
        {
            "sub": staff.username,
            "email": staff.email,
            "role": "branch",
            "internal_role": staff.role,
            "branch_id": staff.branch_id,
            "account_scope": staff.account_scope or "full_branch",
            "service_window": staff.service_window,
            "service_window_label": get_window_display_label(staff),
            "assigned_window_number": staff.assigned_window_number,
            "user_id": staff.id,
            "type": "branch",
            "managed_by": "superadmin",
        },
    )
    db.add(ActivityLog(
        action="Superadmin Branch Access",
        user=current_user.username,
        details=f"Superadmin opened branch dashboard for {get_decrypted_or_raw(branch, 'name') or branch.name}",
        type="security",
    ))
    db.commit()

    response = JSONResponse(
        content={
            "access_token": access_token,
            "token_type": "bearer",
            "user": {
                "id": staff.id,
                "username": "superadmin",
                "email": staff.email,
                "full_name": "superadmin",
                "role": "branch",
                "internal_role": staff.role,
                "branch_id": staff.branch_id,
                "dashboard_url": get_branch_dashboard_url(staff),
                "status": staff.status,
                "account_scope": staff.account_scope or "full_branch",
                "service_window": staff.service_window,
                "service_window_label": get_window_display_label(staff),
                "window_label": get_window_display_label(staff),
                "assigned_window_number": staff.assigned_window_number,
                "superadmin_managed_branch": True,
                "branch_name": get_decrypted_or_raw(branch, "name"),
                "window_accounts": [
                    {
                        "id": account.id,
                        "username": account.username,
                        "full_name": account.full_name,
                        "service_window": account.service_window,
                        "service_window_label": get_window_display_label(account),
                        "assigned_window_number": account.assigned_window_number or default_assigned_window_number(account.service_window),
                        "window_label": get_window_display_label(account),
                    }
                    for account in window_accounts
                ],
            },
        }
    )
    set_auth_cookie(response, "branch", access_token)
    return response

@router.post("/")
async def create_branch(
    branch: BranchCreate,
    current_user: Admin = Depends(require_main_admin()),
    db: Session = Depends(get_db)
):
    """Create new branch with optional admin account (main admin only)"""
    branch_name = normalize_branch_name(branch.name)
    ensure_branch_name_is_unique(db, branch_name)
    normalized_counter_count = normalize_counter_count(branch.counters)

    # Create the branch
    branch_data = {
        "name": branch_name,
        "location": branch.location,
        "contact": branch.contact,
        "dashboard_url": build_branch_dashboard_url(branch_name),
        "counters": normalized_counter_count,
        "status": branch.status
    }
    new_branch = Branch(**branch_data)
    db.add(new_branch)
    db.flush()  # Get the branch ID without committing
    
    email_delivery = None
    admin_invite = None
    window_account_deliveries = []
    reserved_emails: set[str] = set()

    if branch.admin_email:
        reserved_emails.add(normalize_email(branch.admin_email, check_deliverability=True))
    requested_window_accounts = branch.window_accounts or []
    normalized_window_accounts = normalize_window_accounts_payload(requested_window_accounts, normalized_counter_count)

    # Create admin account if credentials provided
    if branch.admin_username and branch.admin_email and branch.admin_password:
        if not smtp_is_configured():
            raise HTTPException(
                status_code=400,
                detail="SMTP email verification must be configured before creating a branch admin account.",
            )

        admin_username = normalize_username(branch.admin_username)
        admin_email = normalize_email(branch.admin_email, check_deliverability=True)
        ensure_username_is_unique(db, admin_username)
        ensure_email_is_unique(db, admin_email)
        validate_strong_password(branch.admin_password)

        # Create branch admin account
        hashed_password = hash_password(branch.admin_password)
        admin_user = BranchStaff(
            username=admin_username,
            email=admin_email,
            full_name=admin_username,
            hashed_password=hashed_password,
            role="branch_admin",
            branch_id=new_branch.id,
            is_verified=False,
            status="Pending Verification"
        )
        db.add(admin_user)
        delete_mfa_secret(db, "branch", admin_username)

        admin_invite = Invite(
            email=admin_email,
            role="branch",
            token=secrets.token_urlsafe(32),
            expires_at=datetime.utcnow() + timedelta(hours=24),
            used=False,
        )
        db.add(admin_invite)
        db.flush()
        apply_invite_security(admin_invite)
        
        log_details = f"Created branch: {branch.name} with admin account: {branch.admin_username}"
    else:
        log_details = f"Created branch: {branch.name}"

    for window_account in normalized_window_accounts:
        generated_username = generate_window_username(
            db,
            branch_name=new_branch.name,
            assigned_window_number=window_account["assigned_window_number"],
        )
        generated_password = generate_window_password(window_account["service_window"])
        generated_email = generate_window_internal_email(generated_username)
        if generated_email in reserved_emails:
            raise HTTPException(status_code=400, detail="Generated branch staff email alias collided with an existing branch account.")
        ensure_email_is_unique(db, generated_email)
        reserved_emails.add(generated_email)
        staff_full_name = generate_window_full_name(new_branch.name, window_account["window_label"])

        staff_user = BranchStaff(
            username=generated_username,
            email=generated_email,
            full_name=staff_full_name,
            hashed_password=hash_password(generated_password),
            role="branch_staff",
            branch_id=new_branch.id,
            account_scope="queue_window",
            service_window=window_account["service_window"],
            service_window_label=window_account["window_label"],
            assigned_window_number=window_account["assigned_window_number"],
            is_verified=True,
            status="Active",
        )
        db.add(staff_user)
        delete_mfa_secret(db, "branch", generated_username)
        db.flush()

        window_account_deliveries.append(build_window_account_delivery_payload(
            username=generated_username,
            email=generated_email,
            full_name=staff_full_name,
            service_window=window_account["service_window"],
            assigned_window_number=window_account["assigned_window_number"],
            window_label=window_account["window_label"],
            temporary_password=generated_password,
        ))
        db.add(ActivityLog(
            action="Branch Window Account Generated",
            user=current_user.username,
            details=f"Generated queue window account {generated_username} for {new_branch.name} {window_account['service_window']} window",
            type="admin",
        ))
    
    log = ActivityLog(
        action="Branch Created",
        user=current_user.username,
        details=log_details,
        type="admin"
    )
    db.add(log)
    if branch.admin_username and branch.admin_email and branch.admin_password:
        verification_url = None
        if admin_invite:
            verification_url = f"{os.getenv('BACKEND_BASE_URL', 'http://localhost:8000').rstrip('/')}/api/auth/unified/branch/verify-email?token={get_decrypted_or_raw(admin_invite, 'token') or admin_invite.token}"

        email_delivery = send_branch_access_email(
            recipient_email=branch.admin_email,
            branch_name=get_decrypted_or_raw(new_branch, "name") or new_branch.name,
            login_email=branch.admin_email,
            password=branch.admin_password,
            dashboard_url=get_decrypted_or_raw(new_branch, "dashboard_url") or build_branch_dashboard_url(get_decrypted_or_raw(new_branch, "name") or ""),
            verification_url=verification_url,
            queue_accounts=window_account_deliveries,
        )
        if admin_invite and not email_delivery["sent"]:
            raise HTTPException(
                status_code=500,
                detail="Branch admin email verification could not be sent. Please use a valid, reachable email address and try again.",
            )
        db.add(ActivityLog(
            action="Branch Access Email",
            user=current_user.username,
            details=f"{email_delivery['status'].upper()} to {branch.admin_email} for branch {new_branch.name}",
            type="admin",
        ))

    apply_branch_security_fields(new_branch)
    db.commit()
    db.refresh(new_branch)
    ensure_branch_dashboard_url(new_branch)
    
    response_payload = serialize_branch(new_branch, db)
    response_payload.update({
        "email_delivery": email_delivery,
        "admin_account_status": "Pending Verification" if branch.admin_username and branch.admin_email and branch.admin_password else None,
        "requires_admin_email_verification": bool(branch.admin_username and branch.admin_email and branch.admin_password),
        "window_accounts_created": window_account_deliveries,
    })
    return response_payload

@router.put("/{branch_id}")
async def update_branch(
    branch_id: int,
    branch: BranchUpdate,
    current_user: Admin = Depends(require_main_admin()),
    db: Session = Depends(get_db)
):
    """Update branch (main admin only)"""

    db_branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not db_branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    verify_account_password(branch.current_admin_password, current_user.hashed_password, detail="Incorrect password. Please try again.")

    normalized_name = normalize_branch_name(branch.name)
    ensure_branch_name_is_unique(db, normalized_name, exclude_branch_id=db_branch.id)
    normalized_counter_count = normalize_counter_count(branch.counters)
    normalized_window_accounts = normalize_window_accounts_payload(branch.window_accounts or [], normalized_counter_count)

    # Update only provided fields
    update_data = branch.dict(exclude_unset=True)
    update_data.pop("current_admin_password", None)
    update_data.pop("window_accounts", None)
    update_data["name"] = normalized_name
    update_data["counters"] = normalized_counter_count
    for key, value in update_data.items():
        setattr(db_branch, key, value)
    db_branch.dashboard_url = build_branch_dashboard_url(db_branch.name)

    existing_window_accounts = (
        db.query(BranchStaff)
        .filter(
            BranchStaff.branch_id == db_branch.id,
            BranchStaff.role == "branch_staff",
            BranchStaff.account_scope == "queue_window",
        )
        .order_by(BranchStaff.assigned_window_number.asc(), BranchStaff.id.asc())
        .all()
    )
    existing_by_id = {account.id: account for account in existing_window_accounts}
    unclaimed_accounts = [account for account in existing_window_accounts]
    reserved_emails = {account.email for account in existing_window_accounts if account.email}
    window_account_deliveries = []
    new_window_account_deliveries = []  # only brand-new accounts (counter increase)

    assigned_existing_ids: set[int] = set()

    for window_account in normalized_window_accounts:
        staff_account = None
        requested_id = window_account.get("id")
        if requested_id:
            staff_account = existing_by_id.get(requested_id)
            if not staff_account:
                raise HTTPException(status_code=400, detail="A selected queue window staff account no longer exists for this branch.")
        elif unclaimed_accounts:
            staff_account = unclaimed_accounts[0]

        if staff_account:
            previous_service_window = staff_account.service_window
            previous_assigned_window_number = staff_account.assigned_window_number
            previous_window_label = get_window_display_label(staff_account)
            staff_account.service_window = window_account["service_window"]
            staff_account.service_window_label = window_account["window_label"]
            staff_account.assigned_window_number = window_account["assigned_window_number"]
            staff_account.full_name = generate_window_full_name(normalized_name, window_account["window_label"])
            staff_account.status = "Active"
            if (
                previous_service_window != staff_account.service_window
                or previous_assigned_window_number != staff_account.assigned_window_number
                or previous_window_label != get_window_display_label(staff_account)
            ):
                refreshed_password = generate_window_password(window_account["service_window"])
                staff_account.hashed_password = hash_password(refreshed_password)
                delete_mfa_secret(db, "branch", staff_account.username)
                window_account_deliveries.append(build_window_account_delivery_payload(
                    username=staff_account.username,
                    email=staff_account.email,
                    full_name=staff_account.full_name,
                    service_window=staff_account.service_window,
                    assigned_window_number=staff_account.assigned_window_number,
                    window_label=get_window_display_label(staff_account),
                    temporary_password=refreshed_password,
                ))
            assigned_existing_ids.add(staff_account.id)
            if staff_account in unclaimed_accounts:
                unclaimed_accounts.remove(staff_account)
            continue

        generated_username = generate_window_username(
            db,
            branch_name=normalized_name,
            assigned_window_number=window_account["assigned_window_number"],
        )
        generated_password = generate_window_password(window_account["service_window"])
        generated_email = generate_window_internal_email(generated_username)
        if generated_email in reserved_emails:
            raise HTTPException(status_code=400, detail="Generated branch staff email alias collided with an existing branch account.")
        ensure_email_is_unique(db, generated_email)
        reserved_emails.add(generated_email)

        staff_user = BranchStaff(
            username=generated_username,
            email=generated_email,
            full_name=generate_window_full_name(normalized_name, window_account["window_label"]),
            hashed_password=hash_password(generated_password),
            role="branch_staff",
            branch_id=db_branch.id,
            account_scope="queue_window",
            service_window=window_account["service_window"],
            service_window_label=window_account["window_label"],
            assigned_window_number=window_account["assigned_window_number"],
            is_verified=True,
            status="Active",
        )
        db.add(staff_user)
        delete_mfa_secret(db, "branch", generated_username)
        new_account_payload = build_window_account_delivery_payload(
            username=generated_username,
            email=generated_email,
            full_name=staff_user.full_name,
            service_window=staff_user.service_window,
            assigned_window_number=staff_user.assigned_window_number,
            window_label=get_window_display_label(staff_user),
            temporary_password=generated_password,
        )
        window_account_deliveries.append(new_account_payload)
        new_window_account_deliveries.append(new_account_payload)

    deactivated_accounts = [
        account for account in existing_window_accounts
        if account.id not in assigned_existing_ids
    ]
    for staff_account in deactivated_accounts:
        staff_account.status = "Inactive"
        db.add(ActivityLog(
            action="Branch Window Account Deactivated",
            user=current_user.username,
            details=f"Auto-deactivated window account {staff_account.username} for {normalized_name} due to counter reduction",
            type="admin",
        ))
    deactivated_count = len(deactivated_accounts)

    # Sync branch enabledServices with all active service windows
    active_service_windows = sorted({
        account.service_window
        for account in get_configured_window_accounts(db, db_branch.id)
        if account.status == "Active" and account.service_window
    })
    branch_setting = db.query(BranchSystemSetting).filter(
        BranchSystemSetting.branch_id == db_branch.id,
        BranchSystemSetting.key == "enabledServices",
    ).first()
    if branch_setting:
        branch_setting.value = json.dumps(active_service_windows)
        branch_setting.value_json = json.dumps(active_service_windows)
    else:
        db.add(BranchSystemSetting(
            branch_id=db_branch.id,
            key="enabledServices",
            label="Enabled Public Services",
            category="Services",
            value=json.dumps(active_service_windows),
            value_json=json.dumps(active_service_windows),
            value_type="json",
            description="Service names available for public queueing and branch-facing service listings.",
        ))

    apply_branch_security_fields(db_branch)
    email_delivery = None

    # Send targeted email for newly added window accounts (counter increase)
    if new_window_account_deliveries:
        branch_admin = (
            db.query(BranchStaff)
            .filter(BranchStaff.branch_id == db_branch.id, BranchStaff.role == "branch_admin")
            .order_by(BranchStaff.created_at.desc())
            .first()
        )
        if branch_admin:
            email_delivery = send_new_window_accounts_email(
                recipient_email=branch_admin.email,
                branch_name=normalized_name,
                dashboard_url=get_decrypted_or_raw(db_branch, "dashboard_url") or db_branch.dashboard_url,
                new_accounts=new_window_account_deliveries,
                deactivated_count=deactivated_count,
            )
            db.add(ActivityLog(
                action="Branch New Window Credentials Email",
                user=current_user.username,
                details=f"{(email_delivery or {}).get('status', 'sent').upper()} to {branch_admin.email} — {len(new_window_account_deliveries)} new window account(s) added to {normalized_name}",
                type="admin",
            ))
    elif deactivated_count > 0 and window_account_deliveries:
        # Reassignments with deactivations — use existing branch access email
        branch_admin = (
            db.query(BranchStaff)
            .filter(BranchStaff.branch_id == db_branch.id, BranchStaff.role == "branch_admin")
            .order_by(BranchStaff.created_at.desc())
            .first()
        )
        if branch_admin:
            email_delivery = send_branch_access_email(
                recipient_email=branch_admin.email,
                branch_name=normalized_name,
                login_email=branch_admin.email,
                password=None,
                dashboard_url=get_decrypted_or_raw(db_branch, "dashboard_url") or db_branch.dashboard_url,
                queue_accounts=window_account_deliveries,
            )
            db.add(ActivityLog(
                action="Branch Window Credentials Email",
                user=current_user.username,
                details=f"{(email_delivery or {}).get('status', 'sent').upper()} to {branch_admin.email} for updated queue window assignments in {normalized_name}",
                type="admin",
            ))
    
    log = ActivityLog(
        action="Branch Updated",
        user=current_user.username,
        details=f"Updated branch: {db_branch.name}",
        type="admin"
    )
    db.add(log)
    db.commit()
    db.refresh(db_branch)
    ensure_branch_dashboard_url(db_branch)

    response_payload = serialize_branch(db_branch, db)
    response_payload.update({
        "email_delivery": email_delivery,
        "window_accounts_updated": window_account_deliveries,
        "new_window_accounts_added": len(new_window_account_deliveries),
        "window_accounts_deactivated": deactivated_count,
    })
    return response_payload


@router.put("/{branch_id}/reassign-services")
async def reassign_window_services(
    branch_id: int,
    payload: BranchReassignServicesRequest,
    current_user: Admin = Depends(require_main_admin()),
    db: Session = Depends(get_db)
):
    """Reassign service windows for existing branch window accounts without creating new accounts or resetting passwords."""
    db_branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not db_branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    verify_account_password(payload.current_admin_password, current_user.hashed_password, detail="Incorrect password. Please try again.")

    existing_accounts = (
        db.query(BranchStaff)
        .filter(
            BranchStaff.branch_id == db_branch.id,
            BranchStaff.role == "branch_staff",
            BranchStaff.account_scope == "queue_window",
            BranchStaff.status == "Active",
        )
        .all()
    )
    accounts_by_window = {account.assigned_window_number: account for account in existing_accounts}

    used_services: set[str] = set()
    updated_accounts = []

    for mapping in payload.window_services:
        service_window = normalize_service_window(mapping.service_window)
        window_label = get_default_window_label(service_window)
        if service_window in used_services:
            raise HTTPException(status_code=400, detail=f"{window_label} is already assigned to another window.")
        used_services.add(service_window)

        account = accounts_by_window.get(mapping.assigned_window_number)
        if not account:
            raise HTTPException(status_code=400, detail=f"No active window account found for Window {mapping.assigned_window_number}.")

        account.service_window = service_window
        account.service_window_label = window_label
        account.full_name = generate_window_full_name(get_decrypted_or_raw(db_branch, "name") or db_branch.name, window_label)
        updated_accounts.append({
            "id": account.id,
            "username": account.username,
            "assigned_window_number": account.assigned_window_number,
            "service_window": account.service_window,
            "window_label": get_window_display_label(account),
        })

    # Sync branch enabledServices with all active service windows
    active_service_windows = sorted({
        account.service_window
        for account in get_configured_window_accounts(db, db_branch.id)
        if account.status == "Active" and account.service_window
    })
    branch_setting = db.query(BranchSystemSetting).filter(
        BranchSystemSetting.branch_id == db_branch.id,
        BranchSystemSetting.key == "enabledServices",
    ).first()
    if branch_setting:
        branch_setting.value = json.dumps(active_service_windows)
        branch_setting.value_json = json.dumps(active_service_windows)
    else:
        db.add(BranchSystemSetting(
            branch_id=db_branch.id,
            key="enabledServices",
            label="Enabled Public Services",
            category="Services",
            value=json.dumps(active_service_windows),
            value_json=json.dumps(active_service_windows),
            value_type="json",
            description="Service names available for public queueing and branch-facing service listings.",
        ))

    apply_branch_security_fields(db_branch)
    branch_name = get_decrypted_or_raw(db_branch, "name") or db_branch.name
    assignments_summary = ", ".join(
        f"Window {a['assigned_window_number']}={a['window_label']}"
        for a in updated_accounts
    )
    db.add(ActivityLog(
        action="Branch Window Services Reassigned",
        user=current_user.username,
        details=f"branch_name: {branch_name} | role: admin | assignments: {assignments_summary}",
        type="admin",
    ))
    db.commit()
    db.refresh(db_branch)

    response_payload = serialize_branch(db_branch, db)
    response_payload.update({
        "window_accounts_updated": updated_accounts,
    })
    return response_payload

@router.delete("/{branch_id}")
async def delete_branch(
    branch_id: int,
    payload: BranchDeleteRequest,
    current_user: Admin = Depends(require_main_admin()),
    db: Session = Depends(get_db)
):
    """Delete branch (main admin only) - Also deletes all associated user accounts"""

    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    verify_account_password(payload.current_admin_password, current_user.hashed_password, detail="Incorrect password. Please try again.")

    # Delete records from child tables first to satisfy MySQL foreign keys.
    branch_users = db.query(BranchStaff).filter(BranchStaff.branch_id == branch_id).all()
    deleted_users_count = len(branch_users)
    for user in branch_users:
        db.delete(user)

    # RemittanceItem references both Remittance and Payment — delete before both
    db.query(RemittanceItem).filter(RemittanceItem.branch_id == branch_id).delete(synchronize_session=False)
    db.query(Remittance).filter(Remittance.branch_id == branch_id).delete(synchronize_session=False)
    db.query(CollectionAccount).filter(CollectionAccount.branch_id == branch_id).delete(synchronize_session=False)
    db.query(Payment).filter(Payment.branch_id == branch_id).delete(synchronize_session=False)
    db.query(BusinessTaxApplication).filter(BusinessTaxApplication.branch_id == branch_id).delete(synchronize_session=False)
    # TaxAssessmentRecord references TaxpayerIdentifierSubmission — delete before it
    db.query(TaxAssessmentRecord).filter(TaxAssessmentRecord.branch_id == branch_id).delete(synchronize_session=False)
    db.query(TaxpayerIdentifierSubmission).filter(TaxpayerIdentifierSubmission.branch_id == branch_id).delete(synchronize_session=False)
    db.query(RPTPropertyRecord).filter(RPTPropertyRecord.branch_id == branch_id).delete(synchronize_session=False)
    db.query(ReceiptRequest).filter(ReceiptRequest.branch_id == branch_id).delete(synchronize_session=False)
    db.query(ReceiptRequestHistory).filter(ReceiptRequestHistory.branch_id == branch_id).delete(synchronize_session=False)
    db.query(ReceiptRecord).filter(ReceiptRecord.branch_id == branch_id).delete(synchronize_session=False)
    db.query(Announcement).filter(Announcement.branch_id == branch_id).delete(synchronize_session=False)
    db.query(DiscrepancyReport).filter(DiscrepancyReport.branch_id == branch_id).delete(synchronize_session=False)
    db.query(BranchAppointmentScheduleAudit).filter(BranchAppointmentScheduleAudit.branch_id == branch_id).delete(synchronize_session=False)
    db.query(BranchAppointmentSchedule).filter(BranchAppointmentSchedule.branch_id == branch_id).delete(synchronize_session=False)
    db.query(BranchOperatingHours).filter(BranchOperatingHours.branch_id == branch_id).delete(synchronize_session=False)
    db.query(QueueActivity).filter(QueueActivity.branch_id == branch_id).delete(synchronize_session=False)
    db.query(Queue).filter(Queue.branch_id == branch_id).delete(synchronize_session=False)
    db.query(QueueHistory).filter(QueueHistory.branch_id == branch_id).delete(synchronize_session=False)
    db.query(BranchService).filter(BranchService.branch_id == branch_id).delete(synchronize_session=False)
    db.query(BranchSystemSetting).filter(BranchSystemSetting.branch_id == branch_id).delete(synchronize_session=False)
    db.query(Report).filter(Report.branch_id == branch_id).delete(synchronize_session=False)
    db.query(ReportHistory).filter(ReportHistory.branch_id == branch_id).delete(synchronize_session=False)

    # Log the deletion
    log = ActivityLog(
        action="Branch Deleted",
        user=current_user.username,
        details=f"Deleted branch: {get_decrypted_or_raw(branch, 'name') or branch.name} and {deleted_users_count} associated user account(s)",
        type="admin"
    )
    db.add(log)
    
    # Delete the branch
    db.delete(branch)
    db.commit()
    
    return {
        "message": "Branch deleted successfully",
        "deleted_users": deleted_users_count,
        "branch_name": get_decrypted_or_raw(branch, "name") or branch.name
    }


@router.post("/{branch_id}/resend-verification")
async def resend_branch_verification(
    branch_id: int,
    current_user: Admin = Depends(require_main_admin()),
    db: Session = Depends(get_db),
):
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    if not smtp_is_configured():
        raise HTTPException(
            status_code=400,
            detail="SMTP email verification must be configured before resending branch verification.",
        )

    branch_admin = (
        db.query(BranchStaff)
        .filter(BranchStaff.branch_id == branch_id, BranchStaff.role == "branch_admin")
        .order_by(BranchStaff.created_at.desc())
        .first()
    )
    if not branch_admin:
        raise HTTPException(status_code=404, detail="Branch admin account not found")
    if branch_admin.is_verified and branch_admin.status == "Active":
        raise HTTPException(status_code=400, detail="This branch admin account has already been verified.")

    invite = (
        find_active_invite_by_email_role(db, Invite, branch_admin.email, "branch")
    )
    if invite and invite.expires_at <= datetime.utcnow():
        invite = None
    if not invite:
        invite = Invite(
            email=branch_admin.email,
            role="branch",
            token=secrets.token_urlsafe(32),
            expires_at=datetime.utcnow() + timedelta(hours=24),
            used=False,
        )
        db.add(invite)
        db.flush()
        apply_invite_security(invite)

    verification_url = f"{os.getenv('BACKEND_BASE_URL', 'http://localhost:8000').rstrip('/')}/api/auth/unified/branch/verify-email?token={get_decrypted_or_raw(invite, 'token') or invite.token}"
    email_delivery = send_branch_access_email(
        recipient_email=branch_admin.email,
        branch_name=get_decrypted_or_raw(branch, "name") or branch.name,
        login_email=branch_admin.email,
        password=None,
        dashboard_url=build_branch_dashboard_url(get_decrypted_or_raw(branch, "name") or branch.name),
        verification_url=verification_url,
    )
    if not email_delivery["sent"]:
        raise HTTPException(
            status_code=500,
            detail="Branch admin verification email could not be resent. Please try again.",
        )

    db.add(ActivityLog(
        action="Branch Verification Email Resent",
        user=current_user.username,
        details=f"RESENT to {branch_admin.email} for branch {get_decrypted_or_raw(branch, 'name') or branch.name}",
        type="admin",
    ))
    db.commit()

    return {
        "message": f"Verification email resent to {branch_admin.email}. Branch admin access remains pending until the email is verified.",
        "branch_id": branch.id,
        "verification_status": "Pending",
    }

@router.get("/{branch_id}/queue")
async def get_branch_queue_status(branch_id: int, db: Session = Depends(get_db)):
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    
    return {
        "branchId": branch_id,
        "branchName": get_decrypted_or_raw(branch, "name") or branch.name,
        "waiting": 12,
        "serving": 3,
        "completed": 45
    }
