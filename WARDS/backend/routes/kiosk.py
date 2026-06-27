"""
Kiosk Queue System — Public self-service queue ticket generation.
Citizens tap a service on a branch tablet and receive a queue number.
No login, no account required.
"""

import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from database.models import (
    ActivityLog,
    Branch,
    BranchStaff,
    KioskDevice,
    Queue,
    Service,
    get_db,
)
from auth import get_current_branch_staff
from utils.field_crypto import (
    get_decrypted_or_raw,
    hash_optional_value,
    queue_value,
    apply_queue_security,
)
from utils.security_validation import normalize_citizen_full_name, normalize_ph_contact_number
from utils.branch_system_settings import get_branch_setting_value
from utils.branch_window_config import (
    get_branch_configured_service_names,
    get_service_window_display_label,
    infer_service_window,
    normalize_service_window,
    get_branch_window_metadata,
)
from utils.branch_appointment_settings import (
    get_branch_immediate_queue_availability,
    get_window_capacity_snapshot,
)
from routes.public import (
    generate_next_queue_number,
    calculate_immediate_wait_metrics,
    get_service_processing_time_minutes,
    get_window_scoped_queue_snapshot,
)
from routes.branch_portal import (
    ensure_branch_queue_operations_enabled,
    log_branch_action,
    serialize_branch_queue,
    ACTIVE_PUBLIC_QUEUE_STATUSES,
    hash_aware_any,
    hash_aware_match,
)

router = APIRouter()
logger = logging.getLogger(__name__)

PAIRING_CODE_EXPIRY_MINUTES = 10
DEVICE_TOKEN_LENGTH = 48


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_kiosk_device_by_token(db: Session, token: str) -> Optional[KioskDevice]:
    """Look up a kiosk device by its bearer token hash."""
    token_hash = hash_optional_value(token)
    return db.query(KioskDevice).filter(
        KioskDevice.device_token_hash == token_hash,
        KioskDevice.status == "active",
    ).first()


def _require_kiosk_token(request: Request, db: Session = Depends(get_db)) -> KioskDevice:
    """Dependency: validate kiosk device token from Authorization header."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Kiosk token required.")
    token = auth.split(" ", 1)[1]
    device = _get_kiosk_device_by_token(db, token)
    if not device:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired kiosk token.")
    device.last_heartbeat = datetime.now(timezone.utc)
    db.commit()
    return device


def _generate_pairing_code() -> str:
    """6-digit numeric pairing code."""
    return secrets.randbelow(900000) + 100000


def _generate_device_token() -> str:
    """URL-safe random token for kiosk device authentication."""
    return secrets.token_urlsafe(DEVICE_TOKEN_LENGTH)


def _kiosk_log(db: Session, action: str, branch_id: int, details: str):
    """Write an activity log entry scoped to kiosk actions."""
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    branch_name = get_decrypted_or_raw(branch, "name") or (branch.name if branch else f"Branch {branch_id}")
    db.add(ActivityLog(
        action=action,
        user="kiosk",
        details=f"branch: {branch_name} | {details}",
        type="branch_portal",
    ))
    db.commit()


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class KioskPairRequest(BaseModel):
    branch_id: int
    name: Optional[str] = Field(default="Kiosk")


class KioskPairingCodeResponse(BaseModel):
    pairing_code: str
    expires_at: datetime


class KioskVerifyRequest(BaseModel):
    pairing_code: str = Field(..., min_length=6, max_length=6)


class KioskVerifyResponse(BaseModel):
    device_token: str
    branch_id: int
    name: str


class KioskUnlockRequest(BaseModel):
    branch_id: int
    pin: str = Field(..., min_length=4, max_length=10)


class KioskUnlockResponse(BaseModel):
    device_token: str
    expires_at: datetime


class KioskTicketRequest(BaseModel):
    service_type: str = Field(..., min_length=1)
    taxpayer_name: Optional[str] = Field(default=None)
    contact_number: Optional[str] = Field(default=None)


class KioskTicketResponse(BaseModel):
    queue_number: str
    service_type: str
    estimated_wait_minutes: Optional[int]
    branch_name: str
    created_at: datetime


class KioskSetPinRequest(BaseModel):
    pin: str = Field(..., min_length=4, max_length=10)


class KioskDeviceResponse(BaseModel):
    id: str
    name: str
    branch_id: int
    status: str
    paired_at: Optional[datetime]
    last_heartbeat: Optional[datetime]


# ---------------------------------------------------------------------------
# Admin / Branch Staff endpoints
# ---------------------------------------------------------------------------

@router.post("/pair", response_model=KioskPairingCodeResponse)
async def generate_kiosk_pairing_code(
    req: KioskPairRequest,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    """Branch Admin / Staff generates a one-time pairing code for a new kiosk device."""
    if current_staff.branch_id != req.branch_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only pair kiosks for your own branch.")

    branch = db.query(Branch).filter(Branch.id == req.branch_id, Branch.status == "Active").first()
    if not branch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found.")

    code = str(_generate_pairing_code())
    device = KioskDevice(
        branch_id=req.branch_id,
        name=req.name or "Kiosk",
        pairing_code_hash=hash_optional_value(code),
        status="pending",
    )
    db.add(device)
    db.commit()
    db.refresh(device)

    expires_at = datetime.now(timezone.utc) + timedelta(minutes=PAIRING_CODE_EXPIRY_MINUTES)
    _kiosk_log(db, "Kiosk pairing initiated", req.branch_id, f"Pairing code generated for device {device.id}")

    return {"pairing_code": code, "expires_at": expires_at}


@router.post("/verify", response_model=KioskVerifyResponse)
async def verify_kiosk_pairing_code(
    req: KioskVerifyRequest,
    db: Session = Depends(get_db),
):
    """Kiosk tablet submits the 6-digit pairing code to receive a long-lived device token."""
    code_hash = hash_optional_value(req.pairing_code)
    device = db.query(KioskDevice).filter(
        KioskDevice.pairing_code_hash == code_hash,
        KioskDevice.status == "pending",
    ).first()

    if not device:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired pairing code.")

    # Burn the pairing code (one-time use)
    device.pairing_code_hash = None
    token = _generate_device_token()
    device.device_token_hash = hash_optional_value(token)
    device.status = "active"
    device.paired_at = datetime.now(timezone.utc)
    device.last_heartbeat = datetime.now(timezone.utc)
    db.commit()
    db.refresh(device)

    _kiosk_log(db, "Kiosk paired", device.branch_id, f"Device {device.id} paired successfully")

    return {"device_token": token, "branch_id": device.branch_id, "name": device.name}


@router.post("/unlock", response_model=KioskUnlockResponse)
async def unlock_kiosk(
    req: KioskUnlockRequest,
    db: Session = Depends(get_db),
):
    """Kiosk tablet unlocks for the day using the branch daily PIN."""
    branch = db.query(Branch).filter(Branch.id == req.branch_id, Branch.status == "Active").first()
    if not branch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found.")

    if not branch.kiosk_pin or branch.kiosk_pin != req.pin:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid PIN. Please contact branch staff.")

    # For simplicity in Option A, any correct PIN is accepted even without a specific device token.
    # The device token is used for subsequent ticket requests.
    expires_at = datetime.now(timezone.utc).replace(hour=23, minute=59, second=59, microsecond=999999)
    return {"device_token": "kiosk_unlocked", "expires_at": expires_at}


@router.get("/devices", response_model=list[KioskDeviceResponse])
async def list_kiosk_devices(
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    """List all kiosk devices for the branch admin's branch."""
    devices = db.query(KioskDevice).filter(
        KioskDevice.branch_id == current_staff.branch_id,
    ).order_by(KioskDevice.created_at.desc()).all()

    return [
        {
            "id": d.id,
            "name": d.name,
            "branch_id": d.branch_id,
            "status": d.status,
            "paired_at": d.paired_at,
            "last_heartbeat": d.last_heartbeat,
        }
        for d in devices
    ]


@router.post("/unpair/{device_id}")
async def unpair_kiosk_device(
    device_id: str,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    """Admin unpairs / deactivates a kiosk device."""
    device = db.query(KioskDevice).filter(
        KioskDevice.id == device_id,
        KioskDevice.branch_id == current_staff.branch_id,
    ).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found.")

    device.status = "unpaired"
    device.device_token_hash = None
    db.commit()
    _kiosk_log(db, "Kiosk unpaired", current_staff.branch_id, f"Device {device_id} unpaired by {current_staff.username}")
    return {"message": "Kiosk device unpaired successfully."}


@router.post("/pin")
async def set_kiosk_daily_pin(
    req: KioskSetPinRequest,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    """Branch Admin sets the daily kiosk unlock PIN."""
    branch = db.query(Branch).filter(Branch.id == current_staff.branch_id).first()
    if not branch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found.")

    branch.kiosk_pin = req.pin
    db.commit()
    _kiosk_log(db, "Kiosk PIN updated", current_staff.branch_id, f"Daily kiosk PIN updated by {current_staff.username}")
    return {"message": "Kiosk PIN updated successfully."}


# ---------------------------------------------------------------------------
# Public Kiosk endpoints (no auth except device token)
# ---------------------------------------------------------------------------

@router.get("/services/{branch_id}")
async def get_kiosk_services(
    branch_id: int,
    db: Session = Depends(get_db),
):
    """List available queue services for a branch (shown on kiosk screen)."""
    branch = db.query(Branch).filter(Branch.id == branch_id, Branch.status == "Active").first()
    if not branch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found.")

    services = get_branch_configured_service_names(db, branch_id)
    if not services:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Queue services are not enabled for this branch.")

    result = []
    for svc in services:
        display = get_service_window_display_label(db, branch_id, svc)
        result.append({
            "service_type": svc,
            "label": display or normalize_service_window(svc),
        })
    return {"branch_id": branch_id, "branch_name": get_decrypted_or_raw(branch, "name") or branch.name, "services": result}


@router.post("/ticket", response_model=KioskTicketResponse)
async def create_kiosk_ticket(
    req: KioskTicketRequest,
    device: KioskDevice = Depends(_require_kiosk_token),
    db: Session = Depends(get_db),
):
    """Citizen on the kiosk tablet selects a service and receives a queue ticket."""
    branch_id = device.branch_id
    ensure_branch_queue_operations_enabled(db, branch_id)

    branch = db.query(Branch).filter(Branch.id == branch_id, Branch.status == "Active").first()
    if not branch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found.")

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
    # Use immediate prefix for kiosk tickets (same format as old walk-in)
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
    contact = normalize_ph_contact_number(req.contact_number) if req.contact_number else None

    new_queue = Queue(
        queue_number=queue_number,
        branch_id=branch_id,
        service_type=req.service_type,
        taxpayer_name=taxpayer_name,
        contact_number=contact,
        queue_type="kiosk",
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

    _kiosk_log(db, "Kiosk ticket issued", branch_id, f"Ticket {queue_value(new_queue, 'queue_number')} issued for {req.service_type}")
    return {
        "queue_number": queue_value(new_queue, "queue_number"),
        "service_type": req.service_type,
        "estimated_wait_minutes": wait_metrics["estimated_wait_time"],
        "branch_name": branch_name,
        "created_at": new_queue.created_at,
    }


@router.get("/display/{branch_id}")
async def get_kiosk_display(
    branch_id: int,
    db: Session = Depends(get_db),
):
    """Public lobby display — current queue status for a branch."""
    branch = db.query(Branch).filter(Branch.id == branch_id, Branch.status == "Active").first()
    if not branch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found.")

    now_serving = db.query(Queue).filter(
        Queue.branch_id == branch_id,
        Queue.status == "Serving",
    ).order_by(Queue.served_at.asc()).all()

    upcoming = db.query(Queue).filter(
        Queue.branch_id == branch_id,
        Queue.status == "Waiting",
    ).order_by(Queue.created_at.asc()).limit(10).all()

    return {
        "branch_name": get_decrypted_or_raw(branch, "name") or branch.name,
        "now_serving": [queue_value(q, "queue_number") for q in now_serving],
        "upcoming": [queue_value(q, "queue_number") for q in upcoming],
        "waiting_count": len(upcoming),
        "serving_count": len(now_serving),
    }
