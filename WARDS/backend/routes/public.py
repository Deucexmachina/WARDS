import os
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timedelta, timezone
import random
import re

from database.models import (
    Branch, CitizenUser, Queue, Service, BranchService, FAQ, TaxpayerGuide,
    BranchOperatingHours, Announcement, QueueActivity, ReceiptRequest,
    Payment, get_db
)
from utils.field_crypto import apply_queue_security, find_citizen_by_email, find_payment_by_ref_number, find_queue_by_queue_number, get_decrypted_or_raw, hash_aware_any, hash_aware_match, hash_optional_value, queue_value, service_value, taxpayer_guide_value
from utils.branch_appointment_settings import (
    build_appointment_reservation_key,
    get_branch_immediate_queue_availability,
    get_branch_appointment_availability,
    get_transaction_duration_minutes,
    normalize_appointment_service_key,
    normalize_service_window,
    get_window_capacity_snapshot,
    validate_branch_appointment_datetime,
)
from utils.security_validation import normalize_citizen_full_name, normalize_email, normalize_ph_contact_number
from utils.branch_system_settings import get_branch_setting_value
from utils.system_settings import SYSTEM_DISABLED_MESSAGE, get_setting_value
from utils.field_crypto import decrypt_optional_value
from utils.announcement_attachments import serialize_attachments

router = APIRouter()
USER_SECRET_KEY = os.getenv("USER_SECRET_KEY", "your-user-secret-key-change-in-production")
UNIFIED_SECRET_KEY = os.getenv("AUTH_SECRET_KEY", "your-unified-auth-secret-change-in-production")
ALGORITHM = "HS256"
ACTIVE_PUBLIC_QUEUE_STATUSES = ("Pending", "Waiting", "Called", "Serving")
ACTIVE_QUEUE_MESSAGE = "You already have an active queue request. Please complete or cancel your current queue before registering for another one."
optional_user_security = HTTPBearer(auto_error=False)
MANILA_TIMEZONE = timezone(timedelta(hours=8))


def serialize_manila_datetime(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=MANILA_TIMEZONE).isoformat()
    return value.astimezone(MANILA_TIMEZONE).isoformat()


def serialize_public_announcement(announcement: Announcement):
    branch_name = (get_decrypted_or_raw(announcement.branch, "name") or announcement.branch.name) if announcement.branch else None
    title = decrypt_optional_value(getattr(announcement, "title_enc", None)) or announcement.title
    content = decrypt_optional_value(getattr(announcement, "content_enc", None)) or announcement.content
    # Branch-owned announcements expose attachments through /api/branch/announcements/...
    # Main-admin announcements expose them through /api/announcements/...
    if announcement.branch_id:
        attachments_base = f"/api/branch/announcements/{announcement.id}/attachments"
    else:
        attachments_base = f"/api/announcements/{announcement.id}/attachments"
    attachments = serialize_attachments(
        getattr(announcement, "attachments", None) or [],
        base_path=attachments_base,
    )
    return {
        "id": announcement.id,
        "title": title,
        "content": content,
        "icon_type": announcement.icon_type,
        "icon_color": announcement.icon_color,
        "branch_id": announcement.branch_id,
        "branch_name": branch_name,
        "source_label": branch_name if branch_name else "Main Admin",
        "is_branch_announcement": bool(announcement.branch_id),
        "publish_date": announcement.publish_date.isoformat() if announcement.publish_date else None,
        "attachments": attachments,
    }


def validate_ph_mobile_number(value: Optional[str]) -> str:
    return normalize_ph_contact_number(value or "")


def validate_taxpayer_name(value: Optional[str]) -> str:
    return normalize_citizen_full_name(value or "")


def compute_recommended_arrival(
    *,
    queue_type: str,
    estimated_wait: int,
    appointment_time: Optional[datetime] = None,
) -> datetime:
    if queue_type == "appointment" and appointment_time is not None:
        return appointment_time - timedelta(minutes=5)
    return datetime.now() + timedelta(minutes=max(0, estimated_wait - 5))


def should_release_appointment_reservation(status_value: Optional[str]) -> bool:
    normalized_status = (status_value or "").strip()
    return bool(normalized_status) and normalized_status not in ACTIVE_PUBLIC_QUEUE_STATUSES


def resolve_public_branch_by_name(db: Session, branch_name: str | None) -> Branch | None:
    normalized = (branch_name or "").strip()
    if not normalized:
        return None
    direct_match = db.query(Branch).filter(Branch.name == normalized).first()
    if direct_match:
        return direct_match
    for branch in db.query(Branch).all():
        if (get_decrypted_or_raw(branch, "name") or branch.name) == normalized:
            return branch
    return None


def resolve_authenticated_citizen(
    credentials: Optional[HTTPAuthorizationCredentials],
    db: Session,
) -> Optional[CitizenUser]:
    if credentials is None:
        return None

    token = credentials.credentials
    user = None

    try:
        payload = jwt.decode(token, UNIFIED_SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("email") or payload.get("sub")
        role = payload.get("role")
        token_type = payload.get("type")

        if email and token_type == "role_auth" and role == "public":
            user = find_citizen_by_email(db, CitizenUser, email)
    except JWTError:
        user = None

    if user is None:
        try:
            payload = jwt.decode(token, USER_SECRET_KEY, algorithms=[ALGORITHM])
            email = payload.get("sub")
            token_type = payload.get("type")

            if email and token_type == "user":
                user = find_citizen_by_email(db, CitizenUser, email)
        except JWTError as exc:
            raise HTTPException(status_code=401, detail="Could not validate credentials") from exc

    if user and user.status != "Active":
        raise HTTPException(status_code=403, detail="Account is not active")

    return user


def find_existing_active_queue(
    db: Session,
    citizen_user: Optional[CitizenUser],
    normalized_contact_number: str,
    email: Optional[str],
) -> Optional[Queue]:
    match_conditions = [hash_aware_match(Queue, "contact_number", normalized_contact_number)]

    candidate_emails = []
    if email:
        candidate_emails.append(email.strip().lower())
    resolved_citizen_email = (get_decrypted_or_raw(citizen_user, "email") or citizen_user.email) if citizen_user else None
    if resolved_citizen_email:
        candidate_emails.append(resolved_citizen_email.strip().lower())

    for candidate_email in {value for value in candidate_emails if value}:
        match_conditions.append(
            or_(
                func.lower(Queue.email) == candidate_email,
                Queue.email_hash == hash_optional_value(candidate_email),
            )
        )

    return (
        db.query(Queue)
        .filter(
            hash_aware_any(Queue, "status", ACTIVE_PUBLIC_QUEUE_STATUSES),
            or_(*match_conditions),
        )
        .order_by(Queue.created_at.desc())
        .first()
    )


def get_enabled_service_names(db: Session, branch_id: int | None = None) -> set[str]:
    configured_services = get_branch_setting_value(db, "enabledServices", branch_id) if branch_id else (get_setting_value(db, "enabledServices") or [])
    if configured_services:
        return set(configured_services)
    return {
        service_value(service, "name")
        for service in db.query(Service).filter(Service.is_active.is_(True)).all()
        if service_value(service, "name")
    }


def build_public_system_status(db: Session, branch_id: int | None = None) -> dict:
    enabled_service_names = sorted(get_enabled_service_names(db, branch_id))
    return {
        "maintenanceMode": bool(get_branch_setting_value(db, "maintenanceMode", branch_id) if branch_id else get_setting_value(db, "maintenanceMode")),
        "queueEnabled": bool(get_branch_setting_value(db, "queueEnabled", branch_id) if branch_id else get_setting_value(db, "queueEnabled")),
        "paymentGatewayEnabled": bool(get_branch_setting_value(db, "paymentGatewayEnabled", branch_id) if branch_id else get_setting_value(db, "paymentGatewayEnabled")),
        "receiptRequestEnabled": bool(get_branch_setting_value(db, "receiptRequestEnabled", branch_id) if branch_id else get_setting_value(db, "receiptRequestEnabled")),
        "enabledServices": enabled_service_names,
        "disabledMessage": SYSTEM_DISABLED_MESSAGE,
    }


def ensure_public_operations_available(db: Session, branch_id: int | None = None):
    if get_branch_setting_value(db, "maintenanceMode", branch_id):
        raise HTTPException(status_code=503, detail="Public services are temporarily unavailable because maintenance mode is active.")


def ensure_queue_registration_allowed(db: Session, branch_id: int | None = None):
    ensure_public_operations_available(db, branch_id)
    if not get_branch_setting_value(db, "queueEnabled", branch_id):
        raise HTTPException(status_code=403, detail=SYSTEM_DISABLED_MESSAGE)


def ensure_payment_gateway_available(db: Session, branch_id: int | None = None):
    ensure_public_operations_available(db, branch_id)
    if not get_branch_setting_value(db, "paymentGatewayEnabled", branch_id):
        raise HTTPException(status_code=403, detail=SYSTEM_DISABLED_MESSAGE)


def ensure_queue_operations_manageable(db: Session, branch_id: int | None = None):
    ensure_public_operations_available(db, branch_id)
    if not get_branch_setting_value(db, "queueEnabled", branch_id):
        raise HTTPException(status_code=403, detail=SYSTEM_DISABLED_MESSAGE)

# ============= Pydantic Models =============

class QueueRegistration(BaseModel):
    branch_id: int
    service_type: str
    taxpayer_name: Optional[str] = None
    contact_number: Optional[str] = None
    email: Optional[str] = None
    queue_type: str = "immediate"  # immediate or appointment
    appointment_time: Optional[str] = None


def normalize_queue_type(raw_value: Optional[str]) -> str:
    normalized = (raw_value or "immediate").strip().lower()
    if normalized not in {"immediate", "appointment"}:
        raise HTTPException(status_code=400, detail="Invalid queue type selected.")
    return normalized

class ReceiptRequestCreate(BaseModel):
    taxpayer_name: str
    transaction_date: str
    ref_number: Optional[str] = None
    email: str

class OnlinePaymentCreate(BaseModel):
    taxpayer_name: str
    tin: str
    tax_type: str
    amount: float
    payment_method: str
    branch: str

# ============= Branch Home Module =============

@router.get("/branches")
async def get_all_public_branches(db: Session = Depends(get_db)):
    """Get all active branches for public view"""
    branches = db.query(Branch).filter(Branch.status == "Active").all()
    
    result = []
    for branch in branches:
        branch_name = get_decrypted_or_raw(branch, "name") or branch.name
        branch_location = get_decrypted_or_raw(branch, "location") or branch.location
        branch_contact = get_decrypted_or_raw(branch, "contact") or branch.contact
        # Get current queue status
        waiting = db.query(Queue).filter(
            and_(Queue.branch_id == branch.id, hash_aware_match(Queue, "status", "Waiting"))
        ).count()
        
        # Get operating hours
        hours = db.query(BranchOperatingHours).filter(
            BranchOperatingHours.branch_id == branch.id
        ).all()
        queue_time_slot = get_transaction_duration_minutes()
        
        result.append({
            "id": branch.id,
            "name": branch_name,
            "location": branch_location,
            "contact": branch_contact,
            "counters": branch.counters,
            "current_waiting": waiting,
            "estimated_wait_time": waiting * queue_time_slot,
            "queue_level": "low" if waiting < 5 else "moderate" if waiting < 15 else "high",
            "operating_hours": [
                {
                    "day": h.day_of_week,
                    "opening": h.opening_time,
                    "closing": h.closing_time,
                    "is_open": h.is_open
                } for h in hours
            ]
        })
    
    return result

@router.get("/branches/{branch_id}")
async def get_branch_details(branch_id: int, db: Session = Depends(get_db)):
    """Get detailed branch information"""
    queue_time_slot = get_transaction_duration_minutes()
    enabled_service_names = get_enabled_service_names(db, branch_id)
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    
    # Get branch announcements
    announcements = db.query(Announcement).filter(
        Announcement.is_active == True,
        ((Announcement.branch_id == None) | (Announcement.branch_id == branch_id))
    ).order_by(Announcement.publish_date.desc()).limit(5).all()
    
    # Get available services
    branch_services = db.query(BranchService).filter(
        and_(
            BranchService.branch_id == branch_id,
            BranchService.is_available == True
        )
    ).all()
    
    services = []
    for bs in branch_services:
        service = db.query(Service).filter(Service.id == bs.service_id).first()
        service_name = service_value(service, "name") if service else None
        if service and service.is_active and service_name in enabled_service_names:
            services.append({
                "id": service.id,
                "name": service_name,
                "description": service_value(service, "description"),
                "category": service_value(service, "category"),
                "average_time": service.average_processing_time,
                "requires_appointment": service.requires_appointment
            })
    
    # Get operating hours
    hours = db.query(BranchOperatingHours).filter(
        BranchOperatingHours.branch_id == branch_id
    ).all()
    
    # Get current queue status
    waiting = db.query(Queue).filter(
        and_(Queue.branch_id == branch_id, hash_aware_match(Queue, "status", "Waiting"))
    ).count()
    
    return {
        "id": branch.id,
        "name": get_decrypted_or_raw(branch, "name") or branch.name,
        "location": get_decrypted_or_raw(branch, "location") or branch.location,
        "contact": get_decrypted_or_raw(branch, "contact") or branch.contact,
        "counters": branch.counters,
        "status": branch.status,
        "announcements": [serialize_public_announcement(a) for a in announcements],
        "services": services,
        "operating_hours": [
            {
                "day": h.day_of_week,
                "opening": h.opening_time,
                "closing": h.closing_time,
                "is_open": h.is_open
            } for h in hours
        ],
        "queue_status": {
            "waiting": waiting,
            "estimated_wait_time": waiting * queue_time_slot,
            "queue_level": "low" if waiting < 5 else "moderate" if waiting < 15 else "high"
        }
    }

# ============= Public Services Module =============

@router.get("/queue-status")
async def get_all_queue_status(db: Session = Depends(get_db)):
    """Get queue status for all branches"""
    branches = db.query(Branch).filter(Branch.status == "Active").all()
    
    result = []
    for branch in branches:
        queue_time_slot = get_transaction_duration_minutes()
        waiting = db.query(Queue).filter(
            and_(Queue.branch_id == branch.id, hash_aware_match(Queue, "status", "Waiting"))
        ).count()
        
        serving = db.query(Queue).filter(
            and_(Queue.branch_id == branch.id, hash_aware_any(Queue, "status", ["Called", "Serving"]))
        ).count()
        
        result.append({
            "branch_id": branch.id,
            "branch_name": get_decrypted_or_raw(branch, "name") or branch.name,
            "location": get_decrypted_or_raw(branch, "location") or branch.location,
            "waiting": waiting,
            "serving": serving,
            "estimated_wait_time": waiting * queue_time_slot,
            "queue_level": "low" if waiting < 5 else "moderate" if waiting < 15 else "high"
        })
    
    return result

@router.get("/announcements")
async def get_public_announcements(db: Session = Depends(get_db)):
    """Get all active public announcements"""
    announcements = db.query(Announcement).filter(
        Announcement.is_active == True
    ).order_by(Announcement.publish_date.desc()).all()
    
    return [serialize_public_announcement(a) for a in announcements]

@router.get("/faqs")
async def get_faqs(language: str = "en", db: Session = Depends(get_db)):
    """Get FAQs in specified language"""
    normalized_language = (language or "en").strip().lower()
    language_hash = hash_optional_value(normalized_language)
    faqs = db.query(FAQ).filter(
        and_(FAQ.language_hash == language_hash, FAQ.is_active == True)
    ).order_by(FAQ.order).all()
    
    return [
        {
            "id": f.id,
            "question": get_decrypted_or_raw(f, "question") or f.question,
            "answer": get_decrypted_or_raw(f, "answer") or f.answer,
            "category": get_decrypted_or_raw(f, "category") or f.category
        } for f in faqs
    ]

@router.get("/taxpayer-guide")
async def get_taxpayer_guide(language: str = "en", db: Session = Depends(get_db)):
    """Get taxpayer guide in specified language"""
    normalized_language = (language or "en").strip().lower()
    language_hash = hash_optional_value(normalized_language)
    guides = db.query(TaxpayerGuide).filter(
        and_(TaxpayerGuide.language_hash == language_hash, TaxpayerGuide.is_active == True)
    ).order_by(TaxpayerGuide.order).all()
    
    return [
        {
            "id": g.id,
            "title": taxpayer_guide_value(g, "title"),
            "content": taxpayer_guide_value(g, "content"),
            "category": taxpayer_guide_value(g, "category")
        } for g in guides
    ]

@router.get("/services")
async def get_all_services(db: Session = Depends(get_db)):
    """Get all available services"""
    ensure_public_operations_available(db)
    enabled_service_names = get_enabled_service_names(db)
    services = db.query(Service).filter(Service.is_active == True).all()
    
    return [
        {
            "id": s.id,
            "name": service_value(s, "name"),
            "description": service_value(s, "description"),
            "category": service_value(s, "category"),
            "average_time": s.average_processing_time,
            "requires_appointment": s.requires_appointment
        } for s in services if service_value(s, "name") in enabled_service_names
    ]


@router.get("/system-status")
async def get_public_system_status(db: Session = Depends(get_db)):
    return build_public_system_status(db)

# ============= Queueing Module =============

QUEUE_NUMBER_SUFFIX_PATTERN = re.compile(r"^(?P<prefix>[A-Z]{2}-)(?P<sequence>\d{3})$")
APPOINTMENT_QUEUE_NUMBER_SUFFIX_PATTERN = re.compile(r"^(?P<prefix>[A-Z]{2}A-)(?P<sequence>\d{3})$")


def build_branch_queue_identifier(branch_name: str) -> str:
    normalized_name = re.sub(r"\bBRANCH\b", "", (branch_name or "").upper())
    compact = re.sub(r"[^A-Z0-9]", "", normalized_name)
    if len(compact) >= 2:
        return compact[:2]
    return compact.ljust(2, "X") or "XX"


def build_queue_prefix(branch_name: str, queue_type: str) -> tuple[str, re.Pattern[str]]:
    branch_identifier = build_branch_queue_identifier(branch_name)
    if queue_type == "appointment":
        return f"{branch_identifier}A-", APPOINTMENT_QUEUE_NUMBER_SUFFIX_PATTERN
    return f"{branch_identifier}-", QUEUE_NUMBER_SUFFIX_PATTERN


def generate_next_queue_number(db: Session, branch_name: str, queue_type: str = "immediate") -> str:
    prefix, pattern = build_queue_prefix(branch_name, queue_type)
    next_sequence = 1
    candidate_numbers = []
    for queue in db.query(Queue).all():
        current_number = queue_value(queue, "queue_number")
        if current_number and current_number.startswith(prefix):
            candidate_numbers.append(current_number)

    if candidate_numbers:
        latest_number = sorted(candidate_numbers)[-1]
        match = pattern.match(latest_number)
        if match and match.group("prefix") == prefix:
            next_sequence = int(match.group("sequence")) + 1

    candidate = f"{prefix}{next_sequence:03d}"
    while find_queue_by_queue_number(db, Queue, candidate):
        next_sequence += 1
        candidate = f"{prefix}{next_sequence:03d}"

    return candidate

@router.post("/queue/analyze")
async def analyze_queue(branch_id: int, service_type: str, db: Session = Depends(get_db)):
    """Analyze queue and provide recommendations"""
    ensure_queue_registration_allowed(db, branch_id)
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    if service_type not in get_enabled_service_names(db, branch.id):
        raise HTTPException(status_code=400, detail=SYSTEM_DISABLED_MESSAGE)
    window_capacity = get_window_capacity_snapshot(db, branch_id=branch.id, service_type=service_type)
    if window_capacity and window_capacity["is_full"]:
        raise HTTPException(
            status_code=403,
            detail=f"Queue registration is temporarily closed because the {window_capacity['window_label']} has reached its maximum capacity of {window_capacity['max_capacity']}.",
        )
    
    # Get service processing time
    service = db.query(Service).filter(hash_aware_match(Service, "name", service_type)).first()
    avg_processing_time = get_transaction_duration_minutes()
    
    # Get current queue
    waiting = db.query(Queue).filter(
        and_(Queue.branch_id == branch_id, hash_aware_match(Queue, "status", "Waiting"))
    ).count()
    
    serving = db.query(Queue).filter(
        and_(Queue.branch_id == branch_id, hash_aware_any(Queue, "status", ["Called", "Serving"]))
    ).count()
    
    # Calculate estimated wait time based on number of counters
    # Assume branch has multiple counters that can serve clients in parallel
    num_counters = branch.counters if branch.counters > 0 else 1
    
    # If there are clients being served, they'll finish in avg_processing_time/2 on average
    # Then the waiting clients will be distributed across available counters
    time_for_serving = (serving * avg_processing_time) / (2 * num_counters) if serving > 0 else 0
    
    # Waiting clients are processed in parallel across counters
    # Calculate how many "rounds" of service needed
    rounds_needed = (waiting + serving) / num_counters
    time_for_waiting = rounds_needed * avg_processing_time
    
    # Total estimated wait time
    estimated_wait = int(time_for_serving + time_for_waiting)
    
    # Calculate recommended arrival time (arrive 5 minutes before your turn)
    recommended_arrival = compute_recommended_arrival(queue_type="immediate", estimated_wait=estimated_wait)
    
    return {
        "branch_name": get_decrypted_or_raw(branch, "name") or branch.name,
        "current_waiting": waiting,
        "current_serving": serving,
        "average_processing_time": avg_processing_time,
        "estimated_wait_time": int(estimated_wait),
        "recommended_arrival": serialize_manila_datetime(recommended_arrival),
        "queue_level": "low" if waiting < 5 else "moderate" if waiting < 15 else "high",
        "can_register": True,
        "window_capacity": window_capacity,
    }


@router.get("/branches/{branch_id}/appointment-availability")
async def get_branch_appointment_schedule_availability(
    branch_id: int,
    date: str,
    service_type: Optional[str] = None,
    db: Session = Depends(get_db),
):
    branch = db.query(Branch).filter(Branch.id == branch_id, Branch.status == "Active").first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    try:
        selected_date = datetime.fromisoformat(f"{date}T00:00:00").date()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid appointment date.") from exc

    availability = get_branch_appointment_availability(db, branch=branch, selected_date=selected_date, service_type=service_type)
    return {
        "branch_id": branch.id,
        "branch_name": get_decrypted_or_raw(branch, "name") or branch.name,
        "date": date,
        **availability,
    }


@router.get("/branches/{branch_id}/immediate-availability")
async def get_branch_immediate_queue_service_availability(
    branch_id: int,
    service_type: Optional[str] = None,
    db: Session = Depends(get_db),
):
    branch = db.query(Branch).filter(Branch.id == branch_id, Branch.status == "Active").first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    availability = get_branch_immediate_queue_availability(db, branch=branch, service_type=service_type)
    return {
        "branch_id": branch.id,
        "branch_name": get_decrypted_or_raw(branch, "name") or branch.name,
        **availability,
    }

@router.get("/queue/branch/{branch_id}")
async def get_branch_queues(branch_id: int, db: Session = Depends(get_db)):
    """Get all queues for a specific branch"""
    queues = db.query(Queue).filter(Queue.branch_id == branch_id).order_by(Queue.created_at.desc()).all()
    
    return [
        {
            "id": q.id,
            "queue_number": queue_value(q, "queue_number"),
            "taxpayer_name": queue_value(q, "taxpayer_name"),
            "contact_number": queue_value(q, "contact_number"),
            "service_type": queue_value(q, "service_type"),
            "status": queue_value(q, "status"),
            "queue_type": queue_value(q, "queue_type"),
            "estimated_wait_time": q.estimated_wait_time,
            "created_at": q.created_at.isoformat() if q.created_at else None
        }
        for q in queues
    ]

@router.put("/queue/{queue_id}/status")
async def update_queue_status(queue_id: int, status_update: dict, db: Session = Depends(get_db)):
    """Update queue status (for Branch Admin)"""
    ensure_queue_operations_manageable(db)
    queue = db.query(Queue).filter(Queue.id == queue_id).first()
    if not queue:
        raise HTTPException(status_code=404, detail="Queue not found")
    
    queue.status = status_update.get("status", queue_value(queue, "status"))
    if should_release_appointment_reservation(queue_value(queue, "status")):
        queue.appointment_reservation_key = None
    apply_queue_security(queue)
    db.commit()
    db.refresh(queue)
    
    return {"message": "Queue status updated", "queue_number": queue_value(queue, "queue_number"), "status": queue_value(queue, "status")}

@router.post("/queue/register")
async def register_queue(
    registration: QueueRegistration,
    db: Session = Depends(get_db),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(optional_user_security),
):
    """Register for queue (immediate or appointment)"""
    ensure_queue_registration_allowed(db, registration.branch_id)
    branch = db.query(Branch).filter(Branch.id == registration.branch_id, Branch.status == "Active").first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    if registration.service_type not in get_enabled_service_names(db, branch.id):
        raise HTTPException(status_code=400, detail=SYSTEM_DISABLED_MESSAGE)
    queue_type = normalize_queue_type(registration.queue_type)
    service = db.query(Service).filter(hash_aware_match(Service, "name", registration.service_type), Service.is_active == True).first()
    if not service:
        raise HTTPException(status_code=404, detail="Selected service is not available.")
    if service.requires_appointment and queue_type != "appointment":
        raise HTTPException(
            status_code=400,
            detail="Queue registration failed: Immediate queueing is unavailable because this service requires an appointment schedule. Please choose Appointment queueing.",
        )

    validated_taxpayer_name = validate_taxpayer_name(registration.taxpayer_name)
    validated_contact_number = validate_ph_mobile_number(registration.contact_number)
    current_citizen = resolve_authenticated_citizen(credentials, db)
    effective_email = (
        (registration.email or "").strip()
        or (current_citizen.email.strip() if current_citizen and current_citizen.email else "")
    ) or None
    if effective_email:
        effective_email = normalize_email(effective_email, check_deliverability=True)

    existing_active_queue = find_existing_active_queue(
        db,
        current_citizen,
        validated_contact_number,
        effective_email,
    )
    if existing_active_queue:
        raise HTTPException(status_code=409, detail=ACTIVE_QUEUE_MESSAGE)

    active_queue_count = db.query(Queue).filter(
        Queue.branch_id == registration.branch_id,
        hash_aware_any(Queue, "status", ACTIVE_PUBLIC_QUEUE_STATUSES)
    ).count()
    max_queue_per_branch = get_branch_setting_value(db, "maxQueuePerBranch", registration.branch_id)
    if active_queue_count >= max_queue_per_branch:
        raise HTTPException(status_code=403, detail="This branch has reached the current queue capacity limit.")

    branch_name = get_decrypted_or_raw(branch, "name") or branch.name
    queue_number = generate_next_queue_number(db, branch_name, queue_type)
    
    # Get service processing time
    avg_processing_time = get_transaction_duration_minutes()
    
    # Calculate estimated wait time based on number of counters
    waiting = db.query(Queue).filter(
        and_(Queue.branch_id == registration.branch_id, hash_aware_match(Queue, "status", "Waiting"))
    ).count()
    
    serving = db.query(Queue).filter(
        and_(Queue.branch_id == registration.branch_id, hash_aware_any(Queue, "status", ["Called", "Serving"]))
    ).count()
    
    # Use realistic calculation based on counters
    num_counters = branch.counters if branch.counters > 0 else 1
    time_for_serving = (serving * avg_processing_time) / (2 * num_counters) if serving > 0 else 0
    rounds_needed = (waiting + serving) / num_counters
    time_for_waiting = rounds_needed * avg_processing_time
    estimated_wait = int(time_for_serving + time_for_waiting)
    
    # Create queue entry
    appointment_time = None
    appointment_reservation_key = None
    if queue_type == "appointment":
        appointment_time = validate_branch_appointment_datetime(
            db,
            branch=branch,
            raw_value=registration.appointment_time,
            service_type=registration.service_type,
        )
        appointment_reservation_key = build_appointment_reservation_key(
            registration.branch_id,
            appointment_time,
            registration.service_type,
        )
        conflicting_appointment = (
            db.query(Queue)
            .filter(
                Queue.branch_id == registration.branch_id,
                hash_aware_match(Queue, "queue_type", "appointment"),
                Queue.appointment_time == appointment_time,
                hash_aware_any(Queue, "status", ACTIVE_PUBLIC_QUEUE_STATUSES),
            )
            .all()
        )
        normalized_service_key = normalize_appointment_service_key(registration.service_type)
        has_conflict = any(
            queue.appointment_reservation_key == appointment_reservation_key
            or normalize_appointment_service_key(queue_value(queue, "service_type")) == normalized_service_key
            for queue in conflicting_appointment
        )
        if has_conflict:
            raise HTTPException(
                status_code=409,
                detail="The selected appointment slot is no longer available. Please choose another available time.",
            )
    else:
        window_capacity = get_window_capacity_snapshot(db, branch_id=registration.branch_id, service_type=registration.service_type)
        if window_capacity and window_capacity["is_full"]:
            raise HTTPException(
                status_code=403,
                detail=f"Queue registration failed: The {window_capacity['window_label']} has reached its maximum capacity of {window_capacity['max_capacity']}. Queueing for this window is temporarily closed.",
            )
        immediate_availability = get_branch_immediate_queue_availability(db, branch=branch, service_type=registration.service_type)
        if not immediate_availability.get("is_available"):
            raise HTTPException(
                status_code=400,
                detail=immediate_availability.get("message") or "This branch is currently unavailable for the selected queue service based on its published operating schedule. Please choose another branch, service, or available schedule.",
            )
    
    recommended_arrival = compute_recommended_arrival(
        queue_type=queue_type,
        estimated_wait=estimated_wait,
        appointment_time=appointment_time,
    )
    
    new_queue = Queue(
        queue_number=queue_number,
        citizen_user_id=current_citizen.id if current_citizen else None,
        branch_id=registration.branch_id,
        service_type=registration.service_type,
        taxpayer_name=validated_taxpayer_name,
        contact_number=validated_contact_number,
        email=effective_email,
        queue_type=queue_type,
        appointment_time=appointment_time,
        appointment_reservation_key=appointment_reservation_key,
        estimated_wait_time=estimated_wait,
        recommended_arrival=recommended_arrival
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
        except IntegrityError as exc:
            db.rollback()
            integrity_message = str(getattr(exc, "orig", exc)).lower()
            if appointment_reservation_key and "appointment_reservation_key" in integrity_message:
                raise HTTPException(
                    status_code=409,
                    detail="The selected appointment slot is no longer available. Please choose another available time.",
                )
            if attempt == 0:
                new_queue.queue_number = generate_next_queue_number(db, branch_name, queue_type)
                apply_queue_security(new_queue)
                continue
            raise HTTPException(status_code=409, detail="Queue registration failed. Please try again.")
        except Exception as exc:
            db.rollback()
            raise HTTPException(status_code=500, detail="Queue registration failed. Please try again.") from exc

    if not persisted:
        raise HTTPException(status_code=500, detail="Queue registration failed. Please try again.")
    
    return {
        "queue_number": queue_value(new_queue, "queue_number"),
        "branch_name": branch_name,
        "service_type": registration.service_type,
        "queue_type": queue_type,
        "estimated_wait_time": new_queue.estimated_wait_time,
        "recommended_arrival": serialize_manila_datetime(new_queue.recommended_arrival),
        "appointment_time": serialize_manila_datetime(new_queue.appointment_time),
        "status": "Registered",
        "message": "Queue registration successful. Please arrive at the recommended time."
    }

@router.get("/queue/my-ticket")
async def get_my_active_ticket(
    db: Session = Depends(get_db),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(optional_user_security),
):
    """Get the authenticated citizen's active queue ticket"""
    current_citizen = resolve_authenticated_citizen(credentials, db)
    if not current_citizen:
        raise HTTPException(status_code=401, detail="Authentication required to view your ticket")
    
    # Find active queue for this citizen
    active_queue = (
        db.query(Queue)
        .filter(
            Queue.citizen_user_id == current_citizen.id,
            hash_aware_any(Queue, "status", ACTIVE_PUBLIC_QUEUE_STATUSES)
        )
        .order_by(Queue.created_at.desc())
        .first()
    )
    
    if not active_queue:
        return {"has_active_ticket": False, "ticket": None}
    
    branch = db.query(Branch).filter(Branch.id == active_queue.branch_id).first()
    
    # Calculate position in queue
    position = 0
    if queue_value(active_queue, "status") == "Waiting":
        position = db.query(Queue).filter(
            and_(
                Queue.branch_id == active_queue.branch_id,
                hash_aware_match(Queue, "status", "Waiting"),
                Queue.created_at < active_queue.created_at
            )
        ).count() + 1
    
    return {
        "has_active_ticket": True,
        "ticket": {
            "id": active_queue.id,
            "queue_number": queue_value(active_queue, "queue_number"),
            "branch_name": (get_decrypted_or_raw(branch, "name") or branch.name) if branch else "Unknown",
            "branch_address": (get_decrypted_or_raw(branch, "location") or branch.location) if branch else None,
            "service_type": queue_value(active_queue, "service_type"),
            "queue_type": queue_value(active_queue, "queue_type"),
            "taxpayer_name": queue_value(active_queue, "taxpayer_name"),
            "contact_number": queue_value(active_queue, "contact_number"),
            "email": queue_value(active_queue, "email"),
            "status": queue_value(active_queue, "status"),
            "position": position,
            "estimated_wait_time": active_queue.estimated_wait_time,
            "recommended_arrival": serialize_manila_datetime(active_queue.recommended_arrival),
            "appointment_time": serialize_manila_datetime(active_queue.appointment_time),
            "created_at": serialize_manila_datetime(active_queue.created_at),
            "served_at": serialize_manila_datetime(active_queue.served_at),
        }
    }

@router.get("/queue/{queue_number}")
async def check_queue_status(queue_number: str, db: Session = Depends(get_db)):
    """Check queue status by queue number"""
    queue = find_queue_by_queue_number(db, Queue, queue_number)
    if not queue:
        raise HTTPException(status_code=404, detail="Queue not found")
    
    branch = db.query(Branch).filter(Branch.id == queue.branch_id).first()
    
    # Calculate position in queue
    position = db.query(Queue).filter(
        and_(
            Queue.branch_id == queue.branch_id,
            hash_aware_match(Queue, "status", "Waiting"),
            Queue.created_at < queue.created_at
        )
    ).count() + 1 if queue_value(queue, "status") == "Waiting" else 0
    
    return {
        "queue_number": queue_value(queue, "queue_number"),
        "branch_name": (get_decrypted_or_raw(branch, "name") or branch.name) if branch else "Unknown",
        "service_type": queue_value(queue, "service_type"),
        "status": queue_value(queue, "status"),
        "position": position,
        "estimated_wait_time": queue.estimated_wait_time,
        "created_at": queue.created_at.isoformat()
    }

@router.get("/queue/history")
async def get_my_queue_history(
    db: Session = Depends(get_db),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(optional_user_security),
):
    """Get the authenticated citizen's queue history (completed, expired, cancelled)"""
    current_citizen = resolve_authenticated_citizen(credentials, db)
    if not current_citizen:
        raise HTTPException(status_code=401, detail="Authentication required to view your history")
    
    # Statuses that should be in history (not active)
    history_statuses = ["Completed", "Cancelled", "Expired", "Missed", "No Show"]
    
    history_queues = (
        db.query(Queue)
        .filter(
            Queue.citizen_user_id == current_citizen.id,
            hash_aware_any(Queue, "status", history_statuses)
        )
        .order_by(Queue.created_at.desc())
        .limit(50)
        .all()
    )
    
    history_items = []
    for queue in history_queues:
        branch = db.query(Branch).filter(Branch.id == queue.branch_id).first()
        history_items.append({
            "id": queue.id,
            "queue_number": queue_value(queue, "queue_number"),
            "branch_name": (get_decrypted_or_raw(branch, "name") or branch.name) if branch else "Unknown",
            "service_type": queue_value(queue, "service_type"),
            "queue_type": queue_value(queue, "queue_type"),
            "status": queue_value(queue, "status"),
            "created_at": serialize_manila_datetime(queue.created_at),
            "completed_at": serialize_manila_datetime(queue.completed_at),
            "served_at": serialize_manila_datetime(queue.served_at),
        })
    
    return {
        "history": history_items,
        "total": len(history_items)
    }

# ============= Receipt Requisition Module =============

@router.post("/receipt-request")
async def create_receipt_request(request: ReceiptRequestCreate, db: Session = Depends(get_db)):
    """Create a receipt request"""
    normalized_email = normalize_email(request.email, check_deliverability=True)
    # Generate request ID
    today = datetime.now().strftime("%Y%m%d")
    count = db.query(ReceiptRequest).filter(
        ReceiptRequest.request_id.like(f"RR-{today}-%")
    ).count()
    request_id = f"RR-{today}-{count + 1:04d}"
    
    new_request = ReceiptRequest(
        request_id=request_id,
        taxpayer_name=request.taxpayer_name,
        transaction_date=request.transaction_date,
        ref_number=request.ref_number,
        email=normalized_email,
        status="Payment Required",
        fee_paid=False
    )
    
    db.add(new_request)
    db.commit()
    db.refresh(new_request)
    
    return {
        "request_id": request_id,
        "taxpayer_name": request.taxpayer_name,
        "status": "Payment Required",
        "message": "Receipt request created. Please complete payment to process your request.",
        "payment_amount": 50.00,  # Fixed fee
        "payment_instructions": "Please proceed to online payment and use this request ID as reference."
    }

@router.get("/receipt-request/{request_id}")
async def check_receipt_request(request_id: str, db: Session = Depends(get_db)):
    """Check receipt request status"""
    request = db.query(ReceiptRequest).filter(
        ReceiptRequest.request_id == request_id
    ).first()
    
    if not request:
        raise HTTPException(status_code=404, detail="Receipt request not found")
    
    return {
        "request_id": request.request_id,
        "taxpayer_name": request.taxpayer_name,
        "transaction_date": request.transaction_date,
        "status": request.status,
        "fee_paid": request.fee_paid,
        "created_at": request.created_at.isoformat()
    }

# ============= Online Payment Processing Module =============

@router.post("/payment/initiate")
async def initiate_payment(payment: OnlinePaymentCreate, db: Session = Depends(get_db)):
    """Initiate online payment"""
    ensure_payment_gateway_available(db)
    # Generate reference number
    today = datetime.now().strftime("%Y%m%d")
    day_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)
    count = db.query(Payment).filter(Payment.created_at >= day_start, Payment.created_at < day_end).count()
    ref_number = f"PAY-{today}-{count + 1:04d}"
    
    # Generate transaction ID (simulated)
    txn_id = f"TXN-{random.randint(100000, 999999)}"
    
    branch_record = resolve_public_branch_by_name(db, payment.branch)
    new_payment = Payment(
        ref_number=ref_number,
        txn_id=txn_id,
        taxpayer_name=payment.taxpayer_name,
        tin=payment.tin,
        tax_type=payment.tax_type,
        amount=payment.amount,
        payment_method=payment.payment_method,
        branch_id=branch_record.id if branch_record else None,
        branch=payment.branch,
        status="Pending"
    )
    
    db.add(new_payment)
    db.commit()
    db.refresh(new_payment)
    
    return {
        "ref_number": ref_number,
        "txn_id": txn_id,
        "amount": payment.amount,
        "status": "Pending",
        "payment_url": f"https://payment-gateway.example.com/pay?ref={ref_number}",
        "message": "Payment initiated. Please complete payment through the payment gateway."
    }

@router.get("/payment/{ref_number}")
async def check_payment_status(ref_number: str, db: Session = Depends(get_db)):
    """Check payment status"""
    payment = find_payment_by_ref_number(db, Payment, ref_number)
    
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    
    return {
        "ref_number": get_decrypted_or_raw(payment, "ref_number") or payment.ref_number,
        "txn_id": get_decrypted_or_raw(payment, "txn_id") or payment.txn_id,
        "taxpayer_name": get_decrypted_or_raw(payment, "taxpayer_name") or payment.taxpayer_name,
        "tax_type": get_decrypted_or_raw(payment, "tax_type") or payment.tax_type,
        "amount": payment.amount,
        "status": payment.status,
        "created_at": payment.created_at.isoformat(),
        "verified_at": payment.verified_at.isoformat() if payment.verified_at else None
    }

@router.post("/payment/{ref_number}/verify")
async def verify_payment(ref_number: str, db: Session = Depends(get_db)):
    """Simulate payment verification (for testing)"""
    payment = find_payment_by_ref_number(db, Payment, ref_number)
    
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    
    payment.status = "Verified"
    payment.verified_at = datetime.utcnow()
    from utils.field_crypto import apply_payment_security
    apply_payment_security(payment)
    db.commit()
    
    return {
        "ref_number": get_decrypted_or_raw(payment, "ref_number") or payment.ref_number,
        "status": "Verified",
        "message": "Payment verified successfully"
    }
