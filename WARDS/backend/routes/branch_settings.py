import json
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from slowapi import Limiter
from slowapi.util import get_remote_address
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from database.models import ActivityLog, Branch, BranchStaff, BranchSystemSetting, Service, get_db
from auth import require_branch_admin, verify_account_password
from utils.branch_appointment_settings import (
    delete_branch_schedule_history_entry,
    get_branch_schedule_history,
    get_branch_schedule_payload,
    publish_branch_schedule,
    save_branch_schedule_draft,
)
from utils.branch_system_settings import get_branch_settings_payload, update_branch_system_settings
from utils.field_crypto import get_decrypted_or_raw
from utils.system_settings import get_settings_payload
from utils.branch_window_config import (
    get_configured_window_accounts,
    get_default_window_label,
    get_service_window_display_label,
    normalize_service_window as normalize_window_service_code,
)


def get_rate_limit_key(request: Request) -> str:
    """Get rate limit key - user-based if authenticated, otherwise IP-based"""
    if hasattr(request.state, 'user') and request.state.user:
        return f"user:{request.state.user.id}"
    return get_remote_address(request)


limiter = Limiter(key_func=get_rate_limit_key)

router = APIRouter()


class AppointmentSchedulePayload(BaseModel):
    effective_date: str
    weekly_schedule: list[dict]
    date_overrides: list[dict]
    time_settings: dict
    reason: str | None = None

    @field_validator("date_overrides")
    @classmethod
    def validate_date_overrides(cls, v: list[dict]) -> list[dict]:
        for idx, override in enumerate(v):
            if not override.get("date"):
                raise ValueError(f"Calendar override #{idx + 1} is missing a date.")
            if not override.get("status"):
                raise ValueError(f"Calendar override #{idx + 1} is missing a status.")
        return v


class BranchSystemSettingsPayload(BaseModel):
    queueEnabled: bool
    maxQueuePerBranch: int
    maxQueuePerWindow: int
    queueTimeSlot: int
    enabledServices: list[str]
    paymentGatewayEnabled: bool
    receiptRequestEnabled: bool
    maintenanceMode: bool
    reason: str | None = None


def get_current_staff_branch(current_staff: BranchStaff, db: Session) -> Branch:
    branch = db.query(Branch).filter(Branch.id == current_staff.branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found.")
    return branch


@router.get("/access")
async def get_branch_settings_access(
    current_staff: BranchStaff = Depends(require_branch_admin()),
):
    return {
        "allowed": True,
        "role": current_staff.role,
        "branch_id": current_staff.branch_id,
    }


@router.get("/appointments")
async def get_branch_appointment_settings(
    current_staff: BranchStaff = Depends(require_branch_admin()),
    db: Session = Depends(get_db),
):
    branch = get_current_staff_branch(current_staff, db)
    return get_branch_schedule_payload(db, branch.id)


@router.get("/system")
async def get_branch_system_settings(
    current_staff: BranchStaff = Depends(require_branch_admin()),
    db: Session = Depends(get_db),
):
    branch = get_current_staff_branch(current_staff, db)
    return get_branch_settings_payload(db, branch.id)


@router.put("/system")
@limiter.limit("10/minute")
async def save_branch_system_settings(
    request: Request,
    payload: BranchSystemSettingsPayload,
    current_staff: BranchStaff = Depends(require_branch_admin()),
    db: Session = Depends(get_db),
):
    branch = get_current_staff_branch(current_staff, db)
    return update_branch_system_settings(
        db,
        branch=branch,
        payload=payload.model_dump(exclude={"reason"}),
        changed_by=current_staff.username,
        changed_by_full_name=current_staff.full_name,
        changed_by_role=current_staff.role,
        reason=payload.reason,
    )


@router.get("/appointments/history")
async def get_branch_appointment_history(
    page: int = Query(1, ge=1),
    page_size: int = Query(5, ge=1, le=5),
    current_staff: BranchStaff = Depends(require_branch_admin()),
    db: Session = Depends(get_db),
):
    branch = get_current_staff_branch(current_staff, db)
    return get_branch_schedule_history(db, branch.id, page=page, page_size=page_size)


@router.delete("/appointments/history/{audit_id}")
async def delete_branch_appointment_history(
    audit_id: int,
    current_staff: BranchStaff = Depends(require_branch_admin()),
    db: Session = Depends(get_db),
):
    branch = get_current_staff_branch(current_staff, db)
    return delete_branch_schedule_history_entry(
        db,
        branch_id=branch.id,
        audit_id=audit_id,
        deleted_by=current_staff.username,
    )


@router.put("/appointments")
async def save_branch_appointment_settings(
    payload: AppointmentSchedulePayload,
    current_staff: BranchStaff = Depends(require_branch_admin()),
    db: Session = Depends(get_db),
):
    branch = get_current_staff_branch(current_staff, db)
    return save_branch_schedule_draft(
        db,
        branch=branch,
        config=payload.model_dump(exclude={"reason"}),
        changed_by=current_staff.username,
        reason=payload.reason,
    )


@router.post("/appointments/publish")
@limiter.limit("10/minute")
async def publish_branch_appointment_settings(
    request: Request,
    payload: AppointmentSchedulePayload,
    current_staff: BranchStaff = Depends(require_branch_admin()),
    db: Session = Depends(get_db),
):
    branch = get_current_staff_branch(current_staff, db)
    return publish_branch_schedule(
        db,
        branch=branch,
        changed_by=current_staff.username,
        config=payload.model_dump(exclude={"reason"}),
        reason=payload.reason,
    )


def _normalize_service_window(value: str) -> str:
    try:
        return normalize_window_service_code(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Unsupported service window: {value}")


def _get_window_display_label(account: BranchStaff) -> str:
    return get_service_window_display_label(account.service_window, account.service_window_label)


def _generate_window_full_name(branch_name: str, window_label: str) -> str:
    return f"{branch_name} {window_label} Staff"


class ReassignWindowService(BaseModel):
    assigned_window_number: int
    service_window: str


class BranchReassignServicesRequest(BaseModel):
    window_services: List[ReassignWindowService]
    current_admin_password: str


@router.get("/window-accounts")
async def get_branch_window_accounts(
    current_staff: BranchStaff = Depends(require_branch_admin()),
    db: Session = Depends(get_db),
):
    """List active queue window accounts for the current branch admin's branch.
    Only returns windows that are within the branch's configured counter count."""
    branch = get_current_staff_branch(current_staff, db)
    accounts = (
        db.query(BranchStaff)
        .filter(
            BranchStaff.branch_id == branch.id,
            BranchStaff.role == "branch_staff",
            BranchStaff.account_scope == "queue_window",
            BranchStaff.status == "Active",
            BranchStaff.assigned_window_number <= branch.counters,
        )
        .order_by(BranchStaff.assigned_window_number.asc(), BranchStaff.id.asc())
        .all()
    )
    return {
        "counters": branch.counters,
        "accounts": [
            {
                "id": a.id,
                "username": a.username,
                "full_name": a.full_name,
                "service_window": a.service_window,
                "service_window_label": _get_window_display_label(a),
                "assigned_window_number": a.assigned_window_number,
            }
            for a in accounts
        ],
    }


@router.put("/window-services")
@limiter.limit("10/minute")
async def reassign_branch_window_services(
    request: Request,
    payload: BranchReassignServicesRequest,
    current_staff: BranchStaff = Depends(require_branch_admin()),
    db: Session = Depends(get_db),
):
    """Reassign service windows for existing branch window accounts without creating new accounts or resetting passwords."""
    branch = get_current_staff_branch(current_staff, db)

    verify_account_password(
        payload.current_admin_password,
        current_staff.hashed_password,
        detail="Incorrect password. Please try again.",
    )

    if branch.counters < 1:
        raise HTTPException(status_code=400, detail="This branch has no configured queue windows.")

    existing_accounts = (
        db.query(BranchStaff)
        .filter(
            BranchStaff.branch_id == branch.id,
            BranchStaff.role == "branch_staff",
            BranchStaff.account_scope == "queue_window",
            BranchStaff.status == "Active",
            BranchStaff.assigned_window_number <= branch.counters,
        )
        .all()
    )
    accounts_by_window = {a.assigned_window_number: a for a in existing_accounts}

    used_services: set[str] = set()
    updated_accounts = []

    for mapping in payload.window_services:
        if mapping.assigned_window_number < 1 or mapping.assigned_window_number > branch.counters:
            raise HTTPException(status_code=400, detail=f"Window {mapping.assigned_window_number} is not available for this branch. Only windows 1 through {branch.counters} can be reassigned.")

        service_window = _normalize_service_window(mapping.service_window)
        window_label = get_default_window_label(service_window)
        if service_window in used_services:
            raise HTTPException(status_code=400, detail=f"{window_label} is already assigned to another window.")
        used_services.add(service_window)

        account = accounts_by_window.get(mapping.assigned_window_number)
        if not account:
            raise HTTPException(status_code=400, detail=f"No active window account found for Window {mapping.assigned_window_number}.")

        account.service_window = service_window
        account.service_window_label = window_label
        branch_name = get_decrypted_or_raw(branch, "name") or branch.name
        account.full_name = _generate_window_full_name(branch_name, window_label)
        updated_accounts.append({
            "id": account.id,
            "username": account.username,
            "assigned_window_number": account.assigned_window_number,
            "service_window": account.service_window,
            "window_label": _get_window_display_label(account),
        })

    # Sync branch enabledServices with all active service windows
    active_service_windows = sorted({
        account.service_window
        for account in get_configured_window_accounts(db, branch.id)
        if account.status == "Active" and account.service_window
    })
    branch_setting = db.query(BranchSystemSetting).filter(
        BranchSystemSetting.branch_id == branch.id,
        BranchSystemSetting.key == "enabledServices",
    ).first()
    if branch_setting:
        branch_setting.value = json.dumps(active_service_windows)
        branch_setting.value_json = json.dumps(active_service_windows)
    else:
        db.add(BranchSystemSetting(
            branch_id=branch.id,
            key="enabledServices",
            label="Enabled Public Services",
            category="Services",
            value=json.dumps(active_service_windows),
            value_json=json.dumps(active_service_windows),
            value_type="json",
            description="Service names available for public queueing and branch-facing service listings.",
        ))

    branch_name = get_decrypted_or_raw(branch, "name") or branch.name
    assignments_summary = ", ".join(
        f"Window {a['assigned_window_number']}={a['window_label']}"
        for a in updated_accounts
    )
    db.add(ActivityLog(
        action="Branch Window Services Reassigned",
        user=current_staff.username,
        details=f"branch_name: {branch_name} | role: branch_admin | assignments: {assignments_summary}",
        type="branch_admin",
    ))
    db.commit()

    return {
        "message": "Window services reassigned successfully.",
        "window_accounts_updated": updated_accounts,
    }
