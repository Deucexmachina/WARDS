from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.models import Branch, BranchStaff, Service, get_db
from middleware.branch_auth import require_branch_admin
from utils.branch_appointment_settings import (
    delete_branch_schedule_history_entry,
    get_branch_schedule_history,
    get_branch_schedule_payload,
    publish_branch_schedule,
    save_branch_schedule_draft,
)
from utils.branch_system_settings import get_branch_settings_payload, update_branch_system_settings
from utils.system_settings import get_settings_payload


router = APIRouter()


class AppointmentSchedulePayload(BaseModel):
    effective_date: str
    weekly_schedule: list[dict]
    date_overrides: list[dict]
    time_settings: dict
    reason: str | None = None


class BranchSystemSettingsPayload(BaseModel):
    queueEnabled: bool
    maxQueuePerBranch: int
    maxQueuePerWindow: int
    queueTimeSlot: int
    enabledServices: list[str]
    paymentGatewayEnabled: bool
    receiptRequestEnabled: bool
    maintenanceMode: bool


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
async def save_branch_system_settings(
    payload: BranchSystemSettingsPayload,
    current_staff: BranchStaff = Depends(require_branch_admin()),
    db: Session = Depends(get_db),
):
    branch = get_current_staff_branch(current_staff, db)
    return update_branch_system_settings(
        db,
        branch=branch,
        payload=payload.model_dump(),
        changed_by=current_staff.username,
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
async def publish_branch_appointment_settings(
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
