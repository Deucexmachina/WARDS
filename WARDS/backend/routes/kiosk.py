"""
Simple Kiosk Queue System — Public self-service via secret URL token.
Citizens tap a service on a branch tablet and receive a queue number.
No login, no pairing codes, no daily PINs.
Admin generates a secret URL once; tablet opens it and stays in kiosk mode.
"""

import logging
import secrets
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from database.models import ActivityLog, Branch, BranchStaff, Queue, Service, get_db
from auth import get_current_branch_staff
from utils.field_crypto import (
    apply_queue_security,
    get_decrypted_or_raw,
    hash_aware_any,
    hash_aware_match,
    queue_value,
)
from utils.security_validation import normalize_citizen_full_name
from utils.branch_system_settings import get_branch_setting_value
from utils.branch_appointment_settings import (
    get_branch_immediate_queue_availability,
    get_window_capacity_snapshot,
)
from utils.branch_window_config import infer_service_window, get_service_window_display_label
from routes.public import (
    ACTIVE_PUBLIC_QUEUE_STATUSES,
    calculate_immediate_wait_metrics,
    generate_next_queue_number,
    get_branch_configured_service_names,
    get_service_processing_time_minutes,
    get_window_scoped_queue_snapshot,
)

router = APIRouter()
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _generate_kiosk_token() -> str:
    """URL-safe random token for kiosk authentication."""
    return secrets.token_urlsafe(32)


def _kiosk_log(db: Session, branch_id: int, action: str, details: str):
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    branch_name = get_decrypted_or_raw(branch, "name") or (branch.name if branch else f"Branch {branch_id}")
    db.add(ActivityLog(
        action=action,
        user="kiosk",
        details=f"branch: {branch_name} | {details}",
        type="branch_portal",
    ))
    db.commit()


def _require_kiosk_token(request: Request, db: Session = Depends(get_db)) -> Branch:
    """Dependency: validate kiosk token from X-Kiosk-Token header."""
    token = request.headers.get("X-Kiosk-Token", "").strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Kiosk token required.")
    branch = db.query(Branch).filter(
        Branch.kiosk_enabled == True,
        Branch.kiosk_token == token,
        Branch.status == "Active",
    ).first()
    if not branch:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or disabled kiosk token.")
    return branch


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class KioskTicketRequest(BaseModel):
    service_type: str = Field(..., min_length=1)
    taxpayer_name: Optional[str] = Field(default=None)


class KioskTicketResponse(BaseModel):
    queue_number: str
    service_type: str
    estimated_wait_minutes: Optional[int]
    waiting_count: int
    serving_count: int
    branch_name: str
    created_at: datetime


class KioskStatusResponse(BaseModel):
    kiosk_enabled: bool
    branch_name: str


class KioskAdminResponse(BaseModel):
    kiosk_enabled: bool
    kiosk_url: Optional[str]


# ---------------------------------------------------------------------------
# Public Kiosk endpoints (no auth except token header)
# ---------------------------------------------------------------------------

@router.get("/status/{branch_id}", response_model=KioskStatusResponse)
async def get_kiosk_status(
    branch_id: int,
    db: Session = Depends(get_db),
):
    """Check whether a branch has kiosk mode enabled."""
    branch = db.query(Branch).filter(Branch.id == branch_id, Branch.status == "Active").first()
    if not branch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found.")
    return {
        "kiosk_enabled": bool(branch.kiosk_enabled),
        "branch_name": get_decrypted_or_raw(branch, "name") or branch.name,
    }


@router.get("/services")
async def get_kiosk_services(
    branch: Branch = Depends(_require_kiosk_token),
    db: Session = Depends(get_db),
):
    """List available queue services for the kiosk (protected by token)."""
    services = get_branch_configured_service_names(db, branch.id)
    if not services:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Queue services are not enabled for this branch.")

    result = []
    for svc in services:
        display = get_service_window_display_label(svc)
        result.append({
            "service_type": svc,
            "label": display or infer_service_window(svc),
        })
    return {"branch_id": branch.id, "branch_name": get_decrypted_or_raw(branch, "name") or branch.name, "services": result}


@router.post("/ticket", response_model=KioskTicketResponse)
async def create_kiosk_ticket(
    req: KioskTicketRequest,
    branch: Branch = Depends(_require_kiosk_token),
    db: Session = Depends(get_db),
):
    """Citizen on the kiosk tablet selects a service and receives a queue ticket."""
    branch_id = branch.id

    if not get_branch_setting_value(db, "queueEnabled", branch_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Queue is currently disabled for this branch.")

    configured_services = get_branch_configured_service_names(db, branch_id)
    if not configured_services:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Queue services are not enabled for this branch.")

    normalized_service = infer_service_window(req.service_type)
    if normalized_service not in configured_services:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid service type selected.")

    # Capacity checks
    active_queue_count = db.query(Queue).filter(
        Queue.branch_id == branch_id,
        hash_aware_any(Queue, "status", ACTIVE_PUBLIC_QUEUE_STATUSES),
    ).count()
    max_queue = get_branch_setting_value(db, "maxQueuePerBranch", branch_id)
    if active_queue_count >= max_queue:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This branch has reached the current queue capacity limit.")

    window_capacity = get_window_capacity_snapshot(db, branch_id=branch_id, service_type=req.service_type)
    if window_capacity and window_capacity["is_full"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Queue registration failed: The {window_capacity['window_label']} has reached its maximum capacity.",
        )

    availability = get_branch_immediate_queue_availability(db, branch=branch, service_type=req.service_type)
    if not availability.get("is_available"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=availability.get("message") or "This branch is currently unavailable for the selected queue service.",
        )

    branch_name = get_decrypted_or_raw(branch, "name") or branch.name
    queue_number = generate_next_queue_number(db, branch_name, "immediate")

    service = db.query(Service).filter(hash_aware_match(Service, "name", req.service_type), Service.is_active == True).first()
    avg_processing_time = get_service_processing_time_minutes(service, db, branch_id)
    queue_snapshot = get_window_scoped_queue_snapshot(db, branch_id, req.service_type)
    wait_metrics = calculate_immediate_wait_metrics(
        branch=branch,
        average_processing_time=avg_processing_time,
        waiting_count=queue_snapshot["waiting_count"],
        serving_count=queue_snapshot["serving_count"],
    )

    taxpayer_name = normalize_citizen_full_name(req.taxpayer_name) if req.taxpayer_name else "Kiosk User"

    new_queue = Queue(
        queue_number=queue_number,
        branch_id=branch_id,
        service_type=req.service_type,
        taxpayer_name=taxpayer_name,
        queue_type="immediate",
        status="Waiting",
        estimated_wait_time=wait_metrics["estimated_wait_time"],
        recommended_arrival=wait_metrics["recommended_arrival"],
    )
    apply_queue_security(new_queue)

    persisted = False
    for attempt in range(2):
        db.add(new_queue)
        try:
            db.commit()
            db.refresh(new_queue)
            persisted = bool(new_queue.id)
            if persisted:
                break
        except IntegrityError:
            db.rollback()
            if attempt == 0:
                new_queue.queue_number = generate_next_queue_number(db, branch_name, "immediate")
                apply_queue_security(new_queue)
                continue
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Queue ticket generation failed. Please try again.")
        except Exception:
            db.rollback()
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Queue ticket generation failed. Please try again.")

    if not persisted:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Queue ticket generation failed. Please try again.")

    _kiosk_log(db, branch_id, "Kiosk ticket issued", f"Ticket {queue_value(new_queue, 'queue_number')} issued for {req.service_type}")
    return {
        "queue_number": queue_value(new_queue, "queue_number"),
        "service_type": req.service_type,
        "estimated_wait_minutes": wait_metrics["estimated_wait_time"],
        "waiting_count": queue_snapshot["waiting_count"],
        "serving_count": queue_snapshot["serving_count"],
        "branch_name": branch_name,
        "created_at": new_queue.created_at,
    }


# ---------------------------------------------------------------------------
# Admin endpoints (Branch Admin controls kiosk)
# ---------------------------------------------------------------------------

@router.get("/admin", response_model=KioskAdminResponse)
async def get_kiosk_admin(
    current_staff: BranchStaff = Depends(get_current_branch_staff),  # noqa: F811
    db: Session = Depends(get_db),
):
    """Get current kiosk status and secret URL for the branch admin."""
    branch = db.query(Branch).filter(Branch.id == current_staff.branch_id).first()
    if not branch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found.")

    kiosk_url = None
    if branch.kiosk_enabled and branch.kiosk_token:
        # Build absolute URL from request base
        kiosk_url = f"/kiosk/{branch.id}?token={branch.kiosk_token}"

    return {
        "kiosk_enabled": bool(branch.kiosk_enabled),
        "kiosk_url": kiosk_url,
    }


@router.post("/admin/enable")
async def enable_kiosk(
    current_staff: BranchStaff = Depends(get_current_branch_staff),  # noqa: F811
    db: Session = Depends(get_db),
):
    """Enable kiosk mode and generate a new secret token."""
    branch = db.query(Branch).filter(Branch.id == current_staff.branch_id).first()
    if not branch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found.")

    branch.kiosk_enabled = True
    branch.kiosk_token = _generate_kiosk_token()
    db.commit()
    db.refresh(branch)

    _kiosk_log(db, branch.id, "Kiosk enabled", f"Kiosk enabled by {current_staff.username}")

    return {
        "message": "Kiosk enabled successfully.",
        "kiosk_url": f"/kiosk/{branch.id}?token={branch.kiosk_token}",
    }


@router.post("/admin/disable")
async def disable_kiosk(
    current_staff: BranchStaff = Depends(get_current_branch_staff),  # noqa: F811
    db: Session = Depends(get_db),
):
    """Disable kiosk mode and invalidate the current token."""
    branch = db.query(Branch).filter(Branch.id == current_staff.branch_id).first()
    if not branch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found.")

    branch.kiosk_enabled = False
    branch.kiosk_token = None
    db.commit()

    _kiosk_log(db, branch.id, "Kiosk disabled", f"Kiosk disabled by {current_staff.username}")

    return {"message": "Kiosk disabled successfully."}


@router.post("/admin/regenerate")
async def regenerate_kiosk_token(
    current_staff: BranchStaff = Depends(get_current_branch_staff),  # noqa: F811
    db: Session = Depends(get_db),
):
    """Generate a new kiosk token (invalidates any existing tablet)."""
    branch = db.query(Branch).filter(Branch.id == current_staff.branch_id).first()
    if not branch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found.")

    if not branch.kiosk_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Kiosk is not enabled. Please enable it first.")

    branch.kiosk_token = _generate_kiosk_token()
    db.commit()
    db.refresh(branch)

    _kiosk_log(db, branch.id, "Kiosk token regenerated", f"Token regenerated by {current_staff.username}")

    return {
        "message": "Kiosk token regenerated successfully.",
        "kiosk_url": f"/kiosk/{branch.id}?token={branch.kiosk_token}",
    }
