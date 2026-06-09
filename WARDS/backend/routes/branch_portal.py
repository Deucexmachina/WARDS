from datetime import datetime, timedelta, timezone
from io import BytesIO
import json
import logging
import os
import re
from pathlib import Path
from typing import Optional

from typing import List

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError

from database.models import ActivityLog, Announcement, AnnouncementAttachment, AnnouncementView, Branch, BranchStaff, BusinessTaxApplication, CollectionAccount, Memo, MemoView, Payment, Policy, PolicyView, Queue, QueueHistory, ReceiptRequest, ReceiptRequestHistory, Remittance, RemittanceItem, get_db
from middleware.branch_auth import get_current_branch_staff, require_any_branch_staff
from utils.file_delivery import deliver_file_response
from utils.file_validation import validate_upload_file
from utils.announcement_attachments import (
    enforce_attachment_limit,
    remove_attachment_file,
    serialize_attachments,
    store_announcement_attachment,
    attachment_bytes,
)
from services.email_service import send_payment_receipt_email
from routes.payments import apply_business_tax_application_security_fields, revert_linked_request_status_for_declined_payment, update_linked_request_status
from utils.field_crypto import apply_announcement_view_security, apply_memo_security, apply_memo_view_security, apply_payment_security, apply_queue_security, apply_receipt_request_security, decrypt_optional_value, find_announcement_view, find_memo_view, get_announcement_viewed_ids, get_decrypted_or_raw, get_memo_viewed_ids, hash_aware_any, hash_aware_match, hash_optional_value, queue_value
from utils.security_validation import format_tin
from utils.branch_system_settings import get_branch_setting_value
from utils.branch_window_config import (
    default_assigned_window_number as resolve_default_assigned_window_number,
    get_branch_window_metadata,
    get_configured_window_accounts as load_configured_window_accounts,
    get_service_window_display_label,
    infer_service_window,
    normalize_service_window as normalize_window_service_code,
)
from utils.system_settings import SYSTEM_DISABLED_MESSAGE, get_setting_value

router = APIRouter()
logger = logging.getLogger(__name__)
REMITTANCE_REPORT_DIR = Path(__file__).resolve().parents[1] / "uploads" / "remittance_reports"
REMITTANCE_REPORT_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_REMITTANCE_REPORT_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}
MAX_REMITTANCE_REPORT_SIZE_BYTES = 10 * 1024 * 1024
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "output" / "payments" / "business-tax"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
MANILA_TIMEZONE = timezone(timedelta(hours=8))
STALE_CALLED_QUEUE_MINUTES = max(1, int(os.getenv("STALE_CALLED_QUEUE_MINUTES", "15")))


def serialize_manila_datetime(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    if value.tzinfo is None:
        utc_time = value.replace(tzinfo=timezone.utc)
        return utc_time.astimezone(MANILA_TIMEZONE).isoformat()
    return value.astimezone(MANILA_TIMEZONE).isoformat()


def serialize_manila_native_datetime(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=MANILA_TIMEZONE).isoformat()
    return value.astimezone(MANILA_TIMEZONE).isoformat()


def serialize_queue_schedule_datetime(value: Optional[datetime], queue_type: Optional[str]) -> Optional[str]:
    if (queue_type or "").strip().lower() == "appointment":
        return serialize_manila_native_datetime(value)
    return serialize_manila_datetime(value)


def get_current_manila_naive() -> datetime:
    return datetime.now(MANILA_TIMEZONE).replace(tzinfo=None)


class BranchAnnouncementPayload(BaseModel):
    title: str
    content: str
    icon_type: Optional[str] = "megaphone"
    icon_color: Optional[str] = "blue"
    is_active: Optional[bool] = True


class BranchRemittanceCreatePayload(BaseModel):
    payment_ids: List[int]
    remarks: Optional[str] = None


class BranchMemoPayload(BaseModel):
    title: str
    content: str
    recipient_type: str = "specific_branches"
    priority: str = "normal"


def normalize_payment_status(status_value: Optional[str]) -> str:
    status_text = (status_value or "pending").strip().lower()
    status_workflow = (status_value or "").strip().upper()
    if status_workflow in {
        "PAYMENT_VERIFIED",
        "OR_GENERATED",
        "COMPLETED",
    }:
        return "confirmed"
    if status_workflow in {
        "PAYMENT_REJECTED",
        "RETURNED_FOR_CORRECTION",
    }:
        return "failed"
    if status_workflow in {
        "PROPERTY_SEARCHED",
        "PROPERTY_FOUND",
        "ADDED_TO_CART",
        "PAYMENT_INITIATED",
        "PAYMENT_SUBMITTED",
        "PENDING_TRANSACTION",
        "PENDING_TREASURY_VALIDATION",
        "CLARIFICATION_REQUESTED",
        "VALIDATED",
    }:
        return "pending"
    if status_text in {
        "verified",
        "payment verified",
        "payment_verified",
        "confirmed",
        "or_generated",
        "official_receipt_generated",
        "receipt_generated",
        "completed",
    }:
        return "confirmed"
    if status_text == "expired":
        return "expired"
    if status_text in {"failed", "declined", "rejected", "cancelled", "canceled", "payment_rejected", "returned_for_correction"}:
        return "failed"
    return "pending"


def get_effective_payment_status(payment: Payment) -> str:
    raw_status = normalize_payment_status(payment.status)
    paymongo_status = normalize_payment_status(payment.paymongo_status)
    workflow_status = (payment.status or "").strip().upper()

    if workflow_status in {
        "PAYMENT_INITIATED",
        "PAYMENT_SUBMITTED",
        "PENDING_TRANSACTION",
        "PENDING_TREASURY_VALIDATION",
        "CLARIFICATION_REQUESTED",
        "VALIDATED",
    }:
        return "pending"

    if raw_status in {"failed", "expired"}:
        return raw_status
    if paymongo_status in {"failed", "expired"}:
        return paymongo_status
    if payment.source_module == "receipt_request":
        if payment.verified_at is not None or raw_status == "confirmed":
            return "confirmed"
        return "pending"
    if payment.verified_at is not None or raw_status == "confirmed" or paymongo_status == "confirmed":
        return "confirmed"
    return "pending"


def format_currency(amount: float | int | None) -> str:
    return f"PHP {float(amount or 0):,.2f}"


def status_label(status_value: str) -> str:
    normalized = status_value.strip().lower()
    if normalized == "waiting":
        return "Waiting"
    if normalized == "called":
        return "Called"
    if normalized == "serving":
        return "Serving"
    if normalized == "skipped":
        return "Skipped"
    if normalized == "completed":
        return "Completed"
    return status_value


def get_queue_display_status(queue: Queue) -> str:
    normalized_status = ((queue_value(queue, "status") or "").strip().lower())
    if queue_value(queue, "queue_type") == "appointment" and normalized_status == "waiting":
        if queue.appointment_time and queue.appointment_time > get_current_manila_naive():
            return "Appointment"
        return "Waiting"
    return status_label(queue_value(queue, "status") or "Waiting")


def default_assigned_window_number(service_window: Optional[str]) -> int:
    return resolve_default_assigned_window_number(service_window)


def get_service_window_label_for_branch(db: Session, branch_id: int, service_window: str) -> str:
    metadata = get_branch_window_metadata(db, branch_id, service_window)
    return metadata["window_label"]


def serialize_queue(queue: Queue, assigned_window_number: Optional[int] = None, window_label: Optional[str] = None, service_window: Optional[str] = None):
    service_window = service_window or normalize_service_window(queue_value(queue, "service_type"))
    return {
        "id": queue.id,
        "queue_number": queue_value(queue, "queue_number"),
        "branch_id": queue.branch_id,
        "service_type": queue_value(queue, "service_type"),
        "taxpayer_name": queue_value(queue, "taxpayer_name"),
        "contact_number": queue_value(queue, "contact_number"),
        "email": queue_value(queue, "email"),
        "status": (queue_value(queue, "status") or "").lower(),
        "status_label": get_queue_display_status(queue),
        "queue_type": (queue_value(queue, "queue_type") or "immediate").lower(),
        "service_window": service_window,
        "assigned_window_number": assigned_window_number or default_assigned_window_number(service_window),
        "window_label": window_label or get_service_window_display_label(service_window),
        "appointment_time": serialize_queue_schedule_datetime(queue.appointment_time, queue_value(queue, "queue_type")),
        "estimated_wait_time": queue.estimated_wait_time,
        "recommended_arrival": serialize_manila_datetime(queue.recommended_arrival),
        "created_at": serialize_manila_datetime(queue.created_at),
        "served_at": serialize_manila_datetime(queue.served_at),
        "completed_at": serialize_manila_datetime(queue.completed_at),
    }


def serialize_branch_queue(db: Session, queue: Queue, branch_id: int, assigned_window_number: Optional[int] = None):
    service_window = normalize_service_window_for_branch(db, branch_id, queue_value(queue, "service_type"))
    return serialize_queue(
        queue,
        assigned_window_number=assigned_window_number or get_assigned_window_number_for_service(db, branch_id, service_window),
        window_label=get_service_window_label_for_branch(db, branch_id, service_window),
        service_window=service_window,
    )


def serialize_queue_history(queue: QueueHistory):
    completed_by = resolve_completed_by_display_name(queue)
    return {
        "id": queue.id,
        "queue_number": queue.queue_number,
        "branch_id": queue.branch_id,
        "service_type": queue.service_type,
        "service_window": queue.service_window,
        "taxpayer_name": queue.taxpayer_name,
        "contact_number": queue.contact_number,
        "email": queue.email,
        "status": (queue.final_status or "").lower(),
        "status_label": status_label(queue.final_status or "Completed"),
        "queue_type": (queue.queue_type or "immediate").lower(),
        "appointment_time": serialize_queue_schedule_datetime(queue.appointment_time, queue.queue_type),
        "estimated_wait_time": queue.estimated_wait_time,
        "recommended_arrival": serialize_manila_datetime(queue.recommended_arrival),
        "created_at": serialize_manila_datetime(queue.created_at),
        "served_at": serialize_manila_datetime(queue.served_at),
        "completed_at": serialize_manila_datetime(queue.completed_at),
        "completed_by": completed_by,
        "archived_at": serialize_manila_datetime(queue.archived_at),
    }


def log_branch_action(db: Session, staff: BranchStaff, action: str, details: str):
    db.add(ActivityLog(
        action=action,
        user=staff.username,
        details=f"Branch {staff.branch_id}: {details}",
        type="branch_portal",
    ))


def get_staff_display_name(staff: BranchStaff) -> str:
    return (staff.full_name or "").strip() or staff.username


def resolve_completed_by_display_name(queue: QueueHistory) -> str | None:
    completed_by = (queue.completed_by or "").strip()
    if not completed_by:
        return None

    branch_staff = getattr(queue, "branch", None)
    if branch_staff is not None:
        for staff in getattr(branch_staff, "branch_staff", []) or []:
            if staff.username == completed_by and (staff.full_name or "").strip():
                return staff.full_name.strip()

    return completed_by


def normalize_service_window(service_type: Optional[str]) -> str:
    return infer_service_window(service_type)


def normalize_service_window_for_branch(db: Session, branch_id: int, service_type: Optional[str]) -> str:
    return get_branch_window_metadata(db, branch_id, service_type)["service_window"]


def get_assigned_window_number_for_service(db: Session, branch_id: int, service_window: str) -> int:
    return get_branch_window_metadata(db, branch_id, service_window)["assigned_window_number"]


def get_configured_window_accounts(db: Session, branch_id: int) -> list[BranchStaff]:
    return load_configured_window_accounts(db, branch_id)


def get_assigned_window_number_for_staff(staff: BranchStaff, service_window: Optional[str] = None) -> int:
    return staff.assigned_window_number or default_assigned_window_number(service_window or staff.service_window)


def get_effective_assigned_window_number(db: Session, staff: BranchStaff, service_window: str) -> int:
    if is_queue_window_staff(staff):
        return get_assigned_window_number_for_staff(staff, service_window)
    return get_assigned_window_number_for_service(db, staff.branch_id, service_window)


def archive_completed_queue(db: Session, queue: Queue, completed_by: str) -> QueueHistory:
    decrypted_queue_number = queue_value(queue, "queue_number")
    existing_history = (
        db.query(QueueHistory)
        .filter(QueueHistory.queue_number == decrypted_queue_number)
        .first()
    )
    history_record = existing_history or QueueHistory(queue_number=decrypted_queue_number)
    history_record.citizen_user_id = queue.citizen_user_id
    history_record.branch_id = queue.branch_id
    history_record.service_type = queue_value(queue, "service_type")
    history_record.service_window = normalize_service_window_for_branch(db, queue.branch_id, queue_value(queue, "service_type"))
    history_record.taxpayer_name = queue_value(queue, "taxpayer_name")
    history_record.contact_number = queue_value(queue, "contact_number")
    history_record.email = queue_value(queue, "email")
    history_record.final_status = queue_value(queue, "status")
    history_record.queue_type = queue_value(queue, "queue_type") or "immediate"
    history_record.appointment_time = queue.appointment_time
    history_record.estimated_wait_time = queue.estimated_wait_time
    history_record.recommended_arrival = queue.recommended_arrival
    history_record.created_at = queue.created_at
    history_record.served_at = queue.served_at
    history_record.completed_at = queue.completed_at
    history_record.completed_by = completed_by
    history_record.archived_at = datetime.utcnow()
    db.add(history_record)
    return history_record


def is_queue_window_staff(staff: BranchStaff) -> bool:
    return staff.role == "branch_staff" and (staff.account_scope or "full_branch") == "queue_window" and bool(staff.service_window)


def ensure_queue_window_access(db: Session, current_staff: BranchStaff, queue: Queue):
    if not is_queue_window_staff(current_staff):
        return
    assigned_window = current_staff.service_window or "MISC"
    queue_window = normalize_service_window_for_branch(db, current_staff.branch_id, queue_value(queue, "service_type"))
    if queue_window != assigned_window:
        raise HTTPException(
            status_code=403,
            detail=f"This branch staff account can only manage {assigned_window} window queues.",
        )


def get_active_branch_queue(
    db: Session,
    branch_id: int,
    exclude_queue_id: Optional[int] = None,
    current_staff: Optional[BranchStaff] = None,
    service_window: Optional[str] = None,
) -> Optional[Queue]:
    queues = db.query(Queue).filter(
        Queue.branch_id == branch_id,
        hash_aware_any(Queue, "status", ["Called", "Serving"]),
    ).order_by(Queue.created_at.asc()).all()

    if exclude_queue_id is not None:
        queues = [queue for queue in queues if queue.id != exclude_queue_id]
    if current_staff is not None and is_queue_window_staff(current_staff):
        queues = [
            queue for queue in queues
            if normalize_service_window_for_branch(db, current_staff.branch_id, queue_value(queue, "service_type")) == current_staff.service_window
        ]
    elif service_window:
        queues = [
            queue for queue in queues
            if normalize_service_window_for_branch(db, branch_id, queue_value(queue, "service_type")) == service_window
        ]
    return queues[0] if queues else None


def get_active_branch_queues(
    db: Session,
    branch_id: int,
    *,
    current_staff: Optional[BranchStaff] = None,
    service_window: Optional[str] = None,
) -> list[Queue]:
    queues = db.query(Queue).filter(
        Queue.branch_id == branch_id,
        hash_aware_any(Queue, "status", ["Called", "Serving"]),
    ).order_by(Queue.created_at.asc()).all()

    if current_staff is not None and is_queue_window_staff(current_staff):
        queues = [
            queue for queue in queues
            if normalize_service_window_for_branch(db, current_staff.branch_id, queue_value(queue, "service_type")) == current_staff.service_window
        ]
    elif service_window:
        queues = [
            queue for queue in queues
            if normalize_service_window_for_branch(db, branch_id, queue_value(queue, "service_type")) == service_window
        ]
    return queues


def reconcile_active_queue_state(
    db: Session,
    current_staff: BranchStaff,
    service_window: Optional[str] = None,
) -> tuple[Optional[Queue], bool]:
    active_queues = get_active_branch_queues(db, current_staff.branch_id, current_staff=current_staff, service_window=service_window)
    if not active_queues:
        return None, False

    now = datetime.utcnow()
    queue_changed = False

    stale_called_queues = []
    for queue in active_queues:
        status_value = (queue_value(queue, "status") or "").strip().lower()
        if status_value != "called":
            continue
        reference_time = queue.served_at or queue.created_at
        if reference_time and reference_time <= now - timedelta(minutes=STALE_CALLED_QUEUE_MINUTES):
            stale_called_queues.append(queue)

    for queue in stale_called_queues:
        queue.status = "Skipped"
        apply_queue_security(queue)
        log_branch_action(
            db,
            current_staff,
            "Queue Recovery",
            f"Auto-skipped stale called queue {queue_value(queue, 'queue_number')} after {STALE_CALLED_QUEUE_MINUTES} minutes without progression",
        )
        queue_changed = True

    if queue_changed:
        db.flush()
        active_queues = get_active_branch_queues(db, current_staff.branch_id, current_staff=current_staff, service_window=service_window)
        if not active_queues:
            return None, True

    if len(active_queues) <= 1:
        return active_queues[0], queue_changed

    def queue_priority(queue: Queue) -> tuple[int, datetime]:
        status_value = (queue_value(queue, "status") or "").strip().lower()
        status_rank = 0 if status_value == "serving" else 1
        return (status_rank, queue.created_at or datetime.min)

    primary_queue = sorted(active_queues, key=queue_priority)[0]
    for queue in active_queues:
        if queue.id == primary_queue.id:
            continue
        status_value = (queue_value(queue, "status") or "").strip().lower()
        queue.status = "Skipped" if status_value == "serving" else "Waiting"
        apply_queue_security(queue)
        log_branch_action(
            db,
            current_staff,
            "Queue Recovery",
            f"Recovered duplicate active queue {queue_value(queue, 'queue_number')} by moving it to {queue_value(queue, 'status')}",
        )
        queue_changed = True

    if queue_changed:
        db.flush()

    return primary_queue, True


def get_next_waiting_queue_for_staff(
    db: Session,
    current_staff: BranchStaff,
    service_window: Optional[str] = None,
) -> Optional[Queue]:
    current_manila_time = get_current_manila_naive()
    candidate_ids = []
    for queue in (
        db.query(Queue)
        .filter(
            Queue.branch_id == current_staff.branch_id,
            hash_aware_match(Queue, "status", "Waiting"),
        )
        .order_by(Queue.created_at.asc())
        .all()
    ):
        queue_type = (queue_value(queue, "queue_type") or "immediate").strip().lower()
        is_immediate = queue_type != "appointment"
        is_ready_appointment = queue_type == "appointment" and queue.appointment_time and queue.appointment_time <= current_manila_time
        is_legacy_immediate = not queue_value(queue, "queue_type") and queue.appointment_time is None
        if is_immediate or is_ready_appointment or is_legacy_immediate:
            candidate_ids.append(queue.id)

    supports_row_locking = db.bind is not None and db.bind.dialect.name != "sqlite"
    for queue_id in candidate_ids:
        queue_query = db.query(Queue).filter(Queue.id == queue_id, Queue.branch_id == current_staff.branch_id)
        if supports_row_locking:
            queue_query = queue_query.with_for_update(skip_locked=True)
        queue = queue_query.first()
        if not queue or (queue_value(queue, "status") or "").strip().lower() != "waiting":
            continue
        if is_queue_window_staff(current_staff):
            queue_window = normalize_service_window_for_branch(db, current_staff.branch_id, queue_value(queue, "service_type"))
            if queue_window != current_staff.service_window:
                continue
        elif service_window:
            queue_window = normalize_service_window_for_branch(db, current_staff.branch_id, queue_value(queue, "service_type"))
            if queue_window != service_window:
                continue
        return queue

    return None


def is_queue_ready_to_call(queue: Queue) -> bool:
    queue_type = (queue_value(queue, "queue_type") or "immediate").strip().lower()
    if queue_type != "appointment":
        return True
    return bool(queue.appointment_time and queue.appointment_time <= get_current_manila_naive())


def normalize_requested_service_window(value: Optional[str]) -> Optional[str]:
    normalized = (value or "").strip().upper()
    if not normalized or normalized == "ALL":
        return None
    try:
        return normalize_window_service_code(normalized)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid queue window selected.")


def to_utc_iso(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat()


def parse_payment_metadata(payment: Payment) -> dict:
    if not payment.metadata_json:
        return {}
    try:
        parsed = json.loads(payment.metadata_json)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def build_bt_official_receipt_number(db: Session) -> str:
    year = datetime.utcnow().strftime("%Y")
    count = (
        db.query(BusinessTaxApplication)
        .filter(BusinessTaxApplication.official_receipt_number.isnot(None))
        .count()
        + 1
    )
    return f"OR-BT-{year}-{count:06d}"


def build_business_tax_official_receipt_pdf(payment: Payment, application: BusinessTaxApplication) -> bytes:
    lines = [
        "CITY TREASURER'S OFFICE",
        "BUSINESS TAX OFFICIAL RECEIPT",
        f"Official Receipt Number: {application.official_receipt_number or 'Pending'}",
        f"Reference Number: {payment.ref_number or 'N/A'}",
        f"Transaction Number: {payment.txn_id or 'N/A'}",
        f"Taxpayer Name: {application.taxpayer_name or payment.taxpayer_name or 'N/A'}",
        f"Business Name: {application.business_name or 'N/A'}",
        f"Mayor's Permit Number: {application.mayor_permit_number or 'N/A'}",
        f"SEC/DTI/CDA Number: {application.sec_dti_cda_number or 'N/A'}",
        f"Tax Type: {payment.tax_type or 'Business Tax'}",
        f"Amount Paid: PHP {float(payment.amount or 0):,.2f}",
        f"Branch: {application.branch_name or payment.branch or 'N/A'}",
        f"Verifier: {application.verified_by or 'Branch Treasury Personnel'}",
        f"Verified At: {(payment.verified_at or datetime.utcnow()).strftime('%B %d, %Y %I:%M %p')}",
        f"Verification Reference: {payment.ref_number or 'N/A'}",
    ]
    y = 760
    content = []
    for index, line in enumerate(lines):
        font = "F2" if index < 2 else "F1"
        size = 18 if index == 0 else 16 if index == 1 else 11
        escaped_line = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        content.append(f"BT /{font} {size} Tf 0.07 0.20 0.39 rg 1 0 0 1 72 {y} Tm ({escaped_line}) Tj ET")
        y -= 30
    content_stream = "\n".join(content).encode("utf-8")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(content_stream)).encode("utf-8") + b" >>\nstream\n" + content_stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    ]
    pdf = BytesIO()
    pdf.write(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(pdf.tell())
        pdf.write(f"{index} 0 obj\n".encode("utf-8"))
        pdf.write(obj)
        pdf.write(b"\nendobj\n")
    xref_position = pdf.tell()
    pdf.write(f"xref\n0 {len(objects) + 1}\n".encode("utf-8"))
    pdf.write(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.write(f"{offset:010d} 00000 n \n".encode("utf-8"))
    pdf.write(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_position}\n%%EOF".encode("utf-8"))
    return pdf.getvalue()


def get_payment_deduplication_key(payment: Payment) -> str:
    for prefix, value in (
        ("checkout", payment.paymongo_checkout_session_id),
        ("intent", payment.paymongo_payment_intent_id),
        ("paymongo-payment", payment.paymongo_payment_id),
        ("source", payment.paymongo_source_id),
        ("ref", payment.ref_number),
        ("txn", payment.txn_id),
    ):
        normalized = (value or "").strip()
        if normalized:
            return f"{prefix}:{normalized}"
    return f"id:{payment.id}"


def get_payment_preference_rank(payment: Payment) -> tuple[int, datetime, int]:
    normalized_status = get_effective_payment_status(payment)
    status_rank = {
        "confirmed": 3,
        "failed": 2,
        "pending": 1,
        "expired": 0,
    }.get(normalized_status, 0)
    event_time = payment.verified_at or payment.created_at or datetime.min
    return (status_rank, event_time, payment.id or 0)


def deduplicate_branch_payments(payments: list[Payment]) -> list[Payment]:
    unique_payments: dict[str, Payment] = {}
    for payment in payments:
        key = get_payment_deduplication_key(payment)
        existing = unique_payments.get(key)
        if not existing or get_payment_preference_rank(payment) > get_payment_preference_rank(existing):
            unique_payments[key] = payment

    return sorted(
        unique_payments.values(),
        key=lambda payment: payment.created_at or datetime.min,
        reverse=True,
    )


def resolve_branch_by_name_or_hash(db: Session, branch_name: str | None) -> Branch | None:
    normalized = (branch_name or "").strip()
    if not normalized:
        return None

    direct_match = db.query(Branch).filter(Branch.name == normalized).first()
    if direct_match:
        return direct_match

    target_hash = hash_optional_value(normalized)
    if target_hash:
        hashed_match = db.query(Branch).filter(Branch.name_hash == target_hash).first()
        if hashed_match:
            return hashed_match

    for branch in db.query(Branch).all():
        candidate = get_decrypted_or_raw(branch, "name") or branch.name or ""
        if candidate == normalized:
            return branch
        if hash_optional_value(candidate) == target_hash:
            return branch
    return None


def repair_branch_payment_association(payment: Payment, db: Session) -> bool:
    changed = False
    metadata = parse_payment_metadata(payment)

    current_branch = db.query(Branch).filter(Branch.id == payment.branch_id).first() if payment.branch_id else None
    current_branch_name = (get_decrypted_or_raw(current_branch, "name") or current_branch.name) if current_branch else None
    payment_branch_name = (get_decrypted_or_raw(payment, "branch") or payment.branch or "").strip()

    if current_branch and current_branch_name:
        if payment_branch_name != current_branch_name:
            payment.branch = current_branch_name
            apply_payment_security(payment)
            changed = True

    if payment.source_module == "business_tax_online_payment" and payment.related_request_id:
        application = (
            db.query(BusinessTaxApplication)
            .filter(BusinessTaxApplication.tracking_number == payment.related_request_id)
            .first()
        )
        if application:
            application_branch = db.query(Branch).filter(Branch.id == application.branch_id).first() if application.branch_id else None
            if not application_branch:
                application_branch = resolve_branch_by_name_or_hash(
                    db,
                    get_decrypted_or_raw(application, "branch_name") or application.branch_name,
                )

            if application_branch:
                application_branch_name = get_decrypted_or_raw(application_branch, "name") or application_branch.name
                if application.branch_id != application_branch.id:
                    application.branch_id = application_branch.id
                    changed = True
                if (get_decrypted_or_raw(application, "branch_name") or application.branch_name) != application_branch_name:
                    application.branch_name = application_branch_name
                    apply_business_tax_application_security_fields(application)
                    changed = True
                if payment.branch_id != application_branch.id:
                    payment.branch_id = application_branch.id
                    changed = True
                if payment_branch_name != application_branch_name:
                    payment.branch = application_branch_name
                    apply_payment_security(payment)
                    changed = True

    if payment.source_module == "receipt_request" and payment.related_request_id:
        receipt_request = (
            db.query(ReceiptRequest)
            .filter(hash_aware_match(ReceiptRequest, "request_id", payment.related_request_id))
            .first()
        )
        receipt_history = (
            db.query(ReceiptRequestHistory)
            .filter(hash_aware_match(ReceiptRequestHistory, "request_id", payment.related_request_id))
            .first()
        )
        related_branch_id = None
        if receipt_request and receipt_request.branch_id:
            related_branch_id = receipt_request.branch_id
        elif receipt_history and receipt_history.branch_id:
            related_branch_id = receipt_history.branch_id

        related_branch = db.query(Branch).filter(Branch.id == related_branch_id).first() if related_branch_id else None
        if not related_branch and payment_branch_name:
            related_branch = resolve_branch_by_name_or_hash(db, payment_branch_name)

        if related_branch:
            related_branch_name = get_decrypted_or_raw(related_branch, "name") or related_branch.name
            if receipt_request and receipt_request.branch_id != related_branch.id:
                receipt_request.branch_id = related_branch.id
                apply_receipt_request_security(receipt_request)
                changed = True
            if payment.branch_id != related_branch.id:
                payment.branch_id = related_branch.id
                changed = True
            if payment_branch_name != related_branch_name:
                payment.branch = related_branch_name
                apply_payment_security(payment)
                changed = True

    if payment.source_module == "rpt_online_payment":
        branch = current_branch
        if not branch:
            selected_branch_id = metadata.get("selected_branch_id")
            if selected_branch_id is not None:
                try:
                    branch = db.query(Branch).filter(Branch.id == int(selected_branch_id)).first()
                except (TypeError, ValueError):
                    branch = None
        if not branch:
            branch = resolve_branch_by_name_or_hash(db, metadata.get("selected_branch_name") or payment_branch_name)

        if branch:
            branch_name = get_decrypted_or_raw(branch, "name") or branch.name
            if payment.branch_id != branch.id:
                payment.branch_id = branch.id
                changed = True
            if payment_branch_name != branch_name:
                payment.branch = branch_name
                apply_payment_security(payment)
                changed = True

    return changed


def payment_belongs_to_branch(payment: Payment, branch: Branch, current_staff: BranchStaff, db: Session) -> bool:
    branch_id = current_staff.branch_id
    branch_name = get_decrypted_or_raw(branch, "name") or branch.name
    payment_branch_name = get_decrypted_or_raw(payment, "branch") or payment.branch
    metadata = parse_payment_metadata(payment)

    if payment.branch_id == branch_id:
        return True

    if payment_branch_name and payment_branch_name == branch_name:
        return True

    if payment.branch_hash and payment.branch_hash == hash_optional_value(branch_name):
        return True

    selected_branch_id = metadata.get("selected_branch_id")
    if selected_branch_id is not None:
        try:
            if int(selected_branch_id) == int(branch_id):
                return True
        except (TypeError, ValueError):
            pass

    selected_branch_name = (metadata.get("selected_branch_name") or "").strip()
    if selected_branch_name and selected_branch_name == branch_name:
        return True

    if payment.source_module == "business_tax_online_payment" and payment.related_request_id:
        application = (
            db.query(BusinessTaxApplication)
            .filter(BusinessTaxApplication.tracking_number == payment.related_request_id)
            .first()
        )
        if application and application.branch_id == branch_id:
            return True

    if payment.source_module == "receipt_request" and payment.related_request_id:
        receipt_request = (
            db.query(ReceiptRequest)
            .filter(hash_aware_match(ReceiptRequest, "request_id", payment.related_request_id))
            .first()
        )
        if receipt_request and receipt_request.branch_id == branch_id:
            return True

        receipt_request_history = (
            db.query(ReceiptRequestHistory)
            .filter(hash_aware_match(ReceiptRequestHistory, "request_id", payment.related_request_id))
            .first()
        )
        if receipt_request_history and receipt_request_history.branch_id == branch_id:
            return True

    return False


def resolve_branch_payment_display_name(payment: Payment, db: Session) -> str | None:
    branch = getattr(payment, "branch_record", None)
    if branch:
        branch_name = get_decrypted_or_raw(branch, "name") or branch.name
        if branch_name:
            return branch_name

    payment_branch_name = get_decrypted_or_raw(payment, "branch") or payment.branch
    if payment_branch_name and payment_branch_name.strip().upper() != "BRANCH_NAME":
        return payment_branch_name

    metadata = parse_payment_metadata(payment)
    selected_branch_name = (metadata.get("selected_branch_name") or "").strip()
    if selected_branch_name and selected_branch_name.upper() != "BRANCH_NAME":
        return selected_branch_name

    if payment.source_module == "receipt_request" and payment.related_request_id:
        receipt_request = (
            db.query(ReceiptRequest)
            .filter(hash_aware_match(ReceiptRequest, "request_id", payment.related_request_id))
            .first()
        )
        receipt_branch = getattr(receipt_request, "branch", None) if receipt_request else None
        if receipt_branch:
            return get_decrypted_or_raw(receipt_branch, "name") or receipt_branch.name

        receipt_request_history = (
            db.query(ReceiptRequestHistory)
            .filter(hash_aware_match(ReceiptRequestHistory, "request_id", payment.related_request_id))
            .first()
        )
        history_branch = getattr(receipt_request_history, "branch", None) if receipt_request_history else None
        if history_branch:
            return get_decrypted_or_raw(history_branch, "name") or history_branch.name

    return None


def resolve_branch_payment_tax_type(payment: Payment, db: Session) -> str | None:
    payment_tax_type = get_decrypted_or_raw(payment, "tax_type") or payment.tax_type
    if payment.source_module != "receipt_request" or not payment.related_request_id:
        return payment_tax_type

    receipt_request = (
        db.query(ReceiptRequest)
        .filter(hash_aware_match(ReceiptRequest, "request_id", payment.related_request_id))
        .first()
    )
    if receipt_request:
        return get_decrypted_or_raw(receipt_request, "tax_type") or receipt_request.tax_type or payment_tax_type

    receipt_request_history = (
        db.query(ReceiptRequestHistory)
        .filter(hash_aware_match(ReceiptRequestHistory, "request_id", payment.related_request_id))
        .first()
    )
    if receipt_request_history:
        return get_decrypted_or_raw(receipt_request_history, "tax_type") or receipt_request_history.tax_type or payment_tax_type

    return payment_tax_type


def get_branch_payments(current_staff: BranchStaff, branch: Branch, db: Session) -> list[Payment]:
    candidate_payments = (
        db.query(Payment)
        .order_by(Payment.created_at.asc(), Payment.id.asc())
        .all()
    )
    repaired = False
    for payment in candidate_payments:
        repaired = repair_branch_payment_association(payment, db) or repaired
    if repaired:
        db.flush()
    matched_payments = [
        payment
        for payment in candidate_payments
        if payment_belongs_to_branch(payment, branch, current_staff, db)
    ]
    return deduplicate_branch_payments(matched_payments)


def get_or_create_collection_account(db: Session, *, owner_type: str, branch: Branch | None = None) -> CollectionAccount:
    query = db.query(CollectionAccount).filter(CollectionAccount.owner_type == owner_type)
    if owner_type == "branch":
        if not branch:
            raise HTTPException(status_code=400, detail="Branch account requires a branch.")
        query = query.filter(CollectionAccount.branch_id == branch.id)
    else:
        query = query.filter(CollectionAccount.branch_id.is_(None))
    account = query.first()
    if account:
        return account
    account = CollectionAccount(
        owner_type=owner_type,
        branch_id=branch.id if branch else None,
        account_name=f"{get_decrypted_or_raw(branch, 'name') or branch.name} Collection Account" if branch else "Main Collection Account",
    )
    db.add(account)
    db.flush()
    return account


def is_payment_locked_for_remittance(db: Session, payment_id: int) -> bool:
    return (
        db.query(RemittanceItem)
        .join(Remittance, Remittance.id == RemittanceItem.remittance_id)
        .filter(
            RemittanceItem.payment_id == payment_id,
            Remittance.status.in_(["Submitted", "Accepted"]),
        )
        .first()
        is not None
    )


def get_branch_remittance_item_statuses(db: Session, payment_ids: list[int]) -> dict[int, str]:
    if not payment_ids:
        return {}
    rows = (
        db.query(RemittanceItem, Remittance)
        .join(Remittance, Remittance.id == RemittanceItem.remittance_id)
        .filter(RemittanceItem.payment_id.in_(payment_ids))
        .order_by(RemittanceItem.created_at.desc())
        .all()
    )
    statuses: dict[int, str] = {}
    for item, remittance in rows:
        statuses.setdefault(item.payment_id, remittance.status)
    return statuses


def serialize_remittance(db: Session, remittance: Remittance) -> dict:
    branch = db.query(Branch).filter(Branch.id == remittance.branch_id).first()
    items = list(remittance.items or [])
    return {
        "id": remittance.id,
        "remittance_number": remittance.remittance_number,
        "branch_id": remittance.branch_id,
        "branch_name": get_decrypted_or_raw(branch, "name") or branch.name if branch else f"Branch {remittance.branch_id}",
        "total_amount": float(remittance.total_amount or 0),
        "payment_count": remittance.payment_count or len(items),
        "status": remittance.status,
        "remarks": remittance.remarks,
        "report_file_name": remittance.report_file_name,
        "submitted_by": remittance.submitted_by,
        "reviewed_by": remittance.reviewed_by,
        "submitted_at": serialize_manila_datetime(remittance.submitted_at),
        "reviewed_at": serialize_manila_datetime(remittance.reviewed_at),
        "items": [
            {
                "id": item.id,
                "payment_id": item.payment_id,
                "amount": float(item.amount or 0),
                "ref_number": get_decrypted_or_raw(item.payment, "ref_number") or item.payment.ref_number if item.payment else None,
                "taxpayer_name": get_decrypted_or_raw(item.payment, "taxpayer_name") or item.payment.taxpayer_name if item.payment else None,
                "tax_type": get_decrypted_or_raw(item.payment, "tax_type") or item.payment.tax_type if item.payment else None,
            }
            for item in items
        ],
    }


async def store_remittance_report_file(file: UploadFile, remittance_number: str) -> tuple[str, str, str | None]:
    original_name = (file.filename or "").strip()
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Remittance report file is required.")

    extension, detected_mime = validate_upload_file(
        file,
        file_bytes,
        allowed_extensions=ALLOWED_REMITTANCE_REPORT_EXTENSIONS,
        max_size_bytes=MAX_REMITTANCE_REPORT_SIZE_BYTES,
    )

    safe_original = re.sub(r"[^A-Za-z0-9._-]+", "_", original_name).strip("._") or f"remittance-report{extension}"
    safe_remittance = re.sub(r"[^A-Za-z0-9-]+", "-", remittance_number).strip("-") or "remittance"
    stored_name = f"{safe_remittance}_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{safe_original}"
    destination = REMITTANCE_REPORT_DIR / stored_name
    destination.write_bytes(file_bytes)
    return str(destination), original_name or safe_original, detected_mime


def create_branch_remittance_record(
    db: Session,
    current_staff: BranchStaff,
    branch: Branch,
    payment_ids: list[int],
    remarks: str | None = None,
    report_file_path: str | None = None,
    report_file_name: str | None = None,
    report_file_mime: str | None = None,
    remittance_number: str | None = None,
) -> Remittance:
    unique_payment_ids = sorted({int(payment_id) for payment_id in payment_ids or []})
    if not unique_payment_ids:
        raise HTTPException(status_code=400, detail="Select at least one verified payment to remit.")

    candidate_payments = get_branch_payments(current_staff, branch, db)
    payment_lookup = {payment.id: payment for payment in candidate_payments}
    selected_payments = []
    for payment_id in unique_payment_ids:
        payment = payment_lookup.get(payment_id)
        if not payment:
            raise HTTPException(status_code=404, detail=f"Payment #{payment_id} is not available for this branch.")
        if get_effective_payment_status(payment) != "confirmed":
            raise HTTPException(status_code=400, detail=f"Payment #{payment_id} is not verified yet.")
        if is_payment_locked_for_remittance(db, payment.id):
            raise HTTPException(status_code=409, detail=f"Payment #{payment_id} is already included in an active remittance.")
        selected_payments.append(payment)

    total_amount = sum(float(payment.amount or 0) for payment in selected_payments)
    remittance_number = remittance_number or f"REM-{current_staff.branch_id}-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
    remittance = Remittance(
        remittance_number=remittance_number,
        branch_id=current_staff.branch_id,
        total_amount=total_amount,
        payment_count=len(selected_payments),
        status="Submitted",
        remarks=(remarks or "").strip() or None,
        report_file_path=report_file_path,
        report_file_name=report_file_name,
        report_file_mime=report_file_mime,
        submitted_by=current_staff.username,
        submitted_at=datetime.utcnow(),
    )
    db.add(remittance)
    db.flush()
    for payment in selected_payments:
        db.add(RemittanceItem(
            remittance_id=remittance.id,
            payment_id=payment.id,
            branch_id=current_staff.branch_id,
            amount=float(payment.amount or 0),
            status="Submitted",
        ))

    branch_account = get_or_create_collection_account(db, owner_type="branch", branch=branch)
    branch_account.current_balance = max(0.0, float(branch_account.current_balance or 0) - total_amount)
    branch_account.total_remitted = float(branch_account.total_remitted or 0) + total_amount
    branch_account.updated_at = datetime.utcnow()
    log_branch_action(db, current_staff, "Remittance Submitted", f"Submitted {remittance_number} for {format_currency(total_amount)}")
    return remittance


def branch_collection_summary(db: Session, branch: Branch, payments: list[Payment]) -> dict:
    account = get_or_create_collection_account(db, owner_type="branch", branch=branch)
    confirmed_payments = [payment for payment in payments if get_effective_payment_status(payment) == "confirmed"]
    statuses = get_branch_remittance_item_statuses(db, [payment.id for payment in confirmed_payments])
    available = [payment for payment in confirmed_payments if statuses.get(payment.id) not in {"Submitted", "Accepted"}]
    submitted = [payment for payment in confirmed_payments if statuses.get(payment.id) == "Submitted"]
    accepted = [payment for payment in confirmed_payments if statuses.get(payment.id) == "Accepted"]
    total_collected = sum(float(payment.amount or 0) for payment in confirmed_payments)
    pending_amount = sum(float(payment.amount or 0) for payment in submitted)
    remitted_amount = sum(float(payment.amount or 0) for payment in accepted)
    available_amount = sum(float(payment.amount or 0) for payment in available)
    account.total_collected = total_collected
    account.total_remitted = remitted_amount
    account.current_balance = available_amount
    account.updated_at = datetime.utcnow()
    return {
        "account": {
            "id": account.id,
            "account_name": account.account_name,
            "owner_type": account.owner_type,
            "branch_id": account.branch_id,
            "current_balance": account.current_balance,
            "total_collected": account.total_collected,
            "total_remitted": account.total_remitted,
        },
        "available_amount": available_amount,
        "pending_remittance_amount": pending_amount,
        "remitted_amount": remitted_amount,
        "verified_collection_amount": total_collected,
        "available_count": len(available),
        "pending_count": len(submitted),
        "remitted_count": len(accepted),
        "available_payments": available,
        "payment_remittance_statuses": statuses,
    }


def serialize_branch_policy(policy: Policy, current_username: str | None = None, db: Session | None = None):
    is_viewed = False
    if current_username and db:
        is_viewed = db.query(PolicyView).filter(
            PolicyView.policy_id == policy.id,
            PolicyView.viewer_username == current_username,
            PolicyView.viewer_type == "branch_staff",
        ).first() is not None

    def to_iso_utc(value):
        if value is None:
            return None
        return f"{value.isoformat()}Z"

    return {
        "id": policy.id,
        "title": policy.title,
        "category": policy.category,
        "content": policy.content,
        "author": policy.author,
        "is_viewed": is_viewed,
        "created_at": to_iso_utc(policy.created_at),
        "updated_at": to_iso_utc(policy.updated_at),
    }


def serialize_branch_announcement(announcement: Announcement, branch_name: Optional[str] = None, is_viewed: bool = False):
    source_name = branch_name or (announcement.branch.name if announcement.branch else None)
    title = decrypt_optional_value(getattr(announcement, "title_enc", None)) or announcement.title
    content = decrypt_optional_value(getattr(announcement, "content_enc", None)) or announcement.content
    attachments = serialize_attachments(
        announcement.attachments or [],
        base_path=f"/api/branch/announcements/{announcement.id}/attachments",
    )
    return {
        "id": announcement.id,
        "title": title,
        "content": content,
        "icon_type": announcement.icon_type,
        "icon_color": announcement.icon_color,
        "branch_id": announcement.branch_id,
        "branch_name": source_name,
        "source_label": source_name or "Main Admin",
        "is_branch_announcement": bool(announcement.branch_id),
        "publish_date": announcement.publish_date.isoformat() if announcement.publish_date else None,
        "is_active": announcement.is_active,
        "created_by": announcement.created_by,
        "created_at": announcement.created_at.isoformat() if announcement.created_at else None,
        "updated_at": announcement.updated_at.isoformat() if announcement.updated_at else None,
        "attachments": attachments,
        "is_viewed": bool(is_viewed),
    }


def mark_branch_announcement_viewed(
    db: Session,
    announcement_id: int,
    viewer_username: str,
    viewer_type: str = "branch_staff",
):
    existing_view = find_announcement_view(
        db,
        AnnouncementView,
        announcement_id,
        viewer_username,
        viewer_type,
    )
    if existing_view:
        return existing_view

    view = AnnouncementView(
        announcement_id=announcement_id,
        viewer_username=viewer_username,
        viewer_type=viewer_type,
    )
    db.add(view)
    db.flush()
    apply_announcement_view_security(view)
    return view


def get_branch_payment_query(current_staff: BranchStaff, branch: Branch, db: Session):
    branch_name = get_decrypted_or_raw(branch, "name") or branch.name
    branch_hash = hash_optional_value(branch_name)
    return (
        db.query(Payment)
        .filter(
            (Payment.branch_id == current_staff.branch_id) |
            ((Payment.branch_id == None) & ((Payment.branch == branch_name) | (Payment.branch_hash == branch_hash)))
        )
    )


def ensure_branch_queue_operations_enabled(db: Session, branch_id: int):
    if get_branch_setting_value(db, "maintenanceMode", branch_id):
        raise HTTPException(status_code=503, detail="Public services are temporarily unavailable because maintenance mode is active.")
    if not get_branch_setting_value(db, "queueEnabled", branch_id):
        raise HTTPException(status_code=403, detail=SYSTEM_DISABLED_MESSAGE)


@router.get("/dashboard")
async def get_branch_dashboard(
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    branch = db.query(Branch).filter(Branch.id == current_staff.branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    queues = db.query(Queue).filter(Queue.branch_id == current_staff.branch_id).all()
    payments = get_branch_payments(current_staff, branch, db)

    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    recent_cutoff = datetime.utcnow() - timedelta(hours=12)
    recent_queues = [queue for queue in queues if queue.created_at and queue.created_at >= recent_cutoff]

    buckets = []
    for index in range(6):
        bucket_start = datetime.utcnow() - timedelta(hours=(6 - index) * 2)
        bucket_end = bucket_start + timedelta(hours=2)
        buckets.append({
            "label": bucket_start.strftime("%H:%M"),
            "waiting": len([q for q in queues if queue_value(q, "status") == "Waiting" and q.created_at and bucket_start <= q.created_at < bucket_end]),
            "serving": len([q for q in queues if queue_value(q, "status") == "Serving" and q.served_at and bucket_start <= q.served_at < bucket_end]),
            "completed": len([q for q in queues if queue_value(q, "status") == "Completed" and q.completed_at and bucket_start <= q.completed_at < bucket_end]),
        })

    log_branch_action(db, current_staff, "Branch Dashboard Viewed", "Viewed branch dashboard")
    db.commit()

    return {
        "branch": {
            "id": branch.id,
            "name": get_decrypted_or_raw(branch, "name") or branch.name,
            "location": get_decrypted_or_raw(branch, "location") or branch.location,
            "status": branch.status,
            "counters": branch.counters,
        },
        "queue": {
            "waiting": len([q for q in queues if queue_value(q, "status") == "Waiting"]),
            "serving": len([q for q in queues if queue_value(q, "status") == "Serving"]),
            "skipped": len([q for q in queues if queue_value(q, "status") == "Skipped"]),
            "completed": len([q for q in queues if queue_value(q, "status") == "Completed"]),
        },
        "transactions": {
            "today_completed": len([q for q in queues if queue_value(q, "status") == "Completed" and q.completed_at and q.completed_at >= today]),
            "payments_pending": len([p for p in payments if get_effective_payment_status(p) == "pending"]),
            "payments_confirmed": len([p for p in payments if get_effective_payment_status(p) == "confirmed"]),
            "payments_failed": len([p for p in payments if get_effective_payment_status(p) == "failed"]),
        },
        "activity_trend": buckets,
        "recent_queue": [serialize_branch_queue(db, queue, current_staff.branch_id) for queue in sorted(recent_queues, key=lambda item: item.created_at, reverse=True)[:10]],
        "timestamp": datetime.utcnow().isoformat(),
    }


@router.get("/queue")
async def list_branch_queue(
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    query = db.query(Queue).filter(Queue.branch_id == current_staff.branch_id)
    if is_queue_window_staff(current_staff):
        queues = [
            queue
            for queue in query.order_by(Queue.created_at.asc()).all()
            if normalize_service_window_for_branch(db, current_staff.branch_id, queue_value(queue, "service_type")) == current_staff.service_window
        ]
    else:
        queues = query.order_by(Queue.created_at.asc()).all()
    return [serialize_branch_queue(db, queue, current_staff.branch_id) for queue in queues]


@router.get("/queue/history")
async def list_branch_queue_history(
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    query = db.query(QueueHistory).filter(QueueHistory.branch_id == current_staff.branch_id)
    if is_queue_window_staff(current_staff):
        history_entries = (
            query.filter(QueueHistory.service_window == current_staff.service_window)
            .order_by(QueueHistory.completed_at.desc(), QueueHistory.archived_at.desc())
            .all()
        )
    else:
        history_entries = query.order_by(QueueHistory.completed_at.desc(), QueueHistory.archived_at.desc()).all()
    return [serialize_queue_history(queue) for queue in history_entries]


@router.delete("/queue/history/{history_id}")
async def delete_branch_queue_history(
    history_id: int,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    queue_history = (
        db.query(QueueHistory)
        .filter(QueueHistory.id == history_id, QueueHistory.branch_id == current_staff.branch_id)
        .first()
    )
    if not queue_history:
        raise HTTPException(status_code=404, detail="Completed queue history record not found")

    if is_queue_window_staff(current_staff) and queue_history.service_window != current_staff.service_window:
        raise HTTPException(status_code=403, detail="This branch staff account can only manage its assigned queue history.")

    queue_number = queue_history.queue_number
    db.delete(queue_history)
    log_branch_action(db, current_staff, "Completed Queue History Deleted", f"Deleted completed queue history {queue_number}")
    db.commit()
    return {"success": True, "historyId": history_id, "queueNumber": queue_number}


@router.get("/queue/live-monitor")
async def get_live_queue_monitor(
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    branch = db.query(Branch).filter(Branch.id == current_staff.branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    
    query = db.query(Queue).filter(Queue.branch_id == current_staff.branch_id)
    if is_queue_window_staff(current_staff):
        queues = [
            queue
            for queue in query.order_by(Queue.created_at.asc()).all()
            if normalize_service_window_for_branch(db, current_staff.branch_id, queue_value(queue, "service_type")) == current_staff.service_window
        ]
    else:
        queues = query.order_by(Queue.created_at.asc()).all()
    
    windows_data = {}

    for account in get_configured_window_accounts(db, current_staff.branch_id):
        if is_queue_window_staff(current_staff) and account.service_window != current_staff.service_window:
            continue
        service_window = account.service_window or "MISC"
        windows_data[service_window] = {
            "window_label": get_service_window_display_label(service_window, account.service_window_label),
            "assigned_window_number": account.assigned_window_number or default_assigned_window_number(service_window),
            "serving": [],
            "waiting": [],
            "completed": [],
            "skipped": []
        }
    
    for queue in queues:
        status = (queue_value(queue, "status") or "").lower()
        service_window = normalize_service_window_for_branch(db, current_staff.branch_id, queue_value(queue, "service_type"))
        assigned_window_number = get_assigned_window_number_for_service(db, current_staff.branch_id, service_window)
        window_label = get_service_window_label_for_branch(db, current_staff.branch_id, service_window)
        
        if service_window not in windows_data:
            windows_data[service_window] = {
                "window_label": window_label,
                "assigned_window_number": assigned_window_number,
                "serving": [],
                "waiting": [],
                "completed": [],
                "skipped": []
            }
        
        queue_data = {
            "queue_number": queue_value(queue, "queue_number"),
            "service_window": service_window,
            "assigned_window_number": assigned_window_number,
            "window_label": window_label,
            "status": status,
        }
        
        if status in ["called", "serving"]:
            windows_data[service_window]["serving"].append(queue_data)
        elif status == "waiting":
            windows_data[service_window]["waiting"].append(queue_data)
        elif status == "completed":
            windows_data[service_window]["completed"].append(queue_data)
        elif status == "skipped":
            windows_data[service_window]["skipped"].append(queue_data)
    
    for window in windows_data:
        completed = windows_data[window]["completed"]
        windows_data[window]["completed"] = completed[-10:] if len(completed) > 10 else completed
    
    return {
        "branch": {
            "id": branch.id,
            "name": get_decrypted_or_raw(branch, "name") or branch.name,
            "counters": branch.counters or 1,
        },
        "windows": windows_data,
        "timestamp": datetime.utcnow().isoformat(),
    }


@router.post("/queue/call-next")
async def call_next_queue(
    service_window: Optional[str] = Query(None),
    queue_id: Optional[int] = Query(None),
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    ensure_branch_queue_operations_enabled(db, current_staff.branch_id)
    requested_service_window = normalize_requested_service_window(service_window)
    if is_queue_window_staff(current_staff):
        requested_service_window = current_staff.service_window
    for attempt in range(2):
        try:
            active_queue, recovered_state = reconcile_active_queue_state(db, current_staff, service_window=requested_service_window)
            if active_queue:
                if recovered_state:
                    db.commit()
                raise HTTPException(status_code=409, detail="Only one queue can be active at a time. Complete or skip the current queue before calling the next one.")

            queue = None
            if queue_id is not None:
                queue_query = db.query(Queue).filter(Queue.id == queue_id, Queue.branch_id == current_staff.branch_id)
                if db.bind is not None and db.bind.dialect.name != "sqlite":
                    queue_query = queue_query.with_for_update(skip_locked=True)
                queue = queue_query.first()
                if not queue:
                    raise HTTPException(status_code=404, detail="Selected queue record was not found.")
                ensure_queue_window_access(db, current_staff, queue)
                selected_queue_window = normalize_service_window_for_branch(db, current_staff.branch_id, queue_value(queue, "service_type"))
                if requested_service_window and selected_queue_window != requested_service_window:
                    raise HTTPException(status_code=403, detail="Selected queue does not belong to the chosen queue window.")
                if (queue_value(queue, "status") or "").strip().lower() != "waiting":
                    raise HTTPException(status_code=409, detail="Selected queue is no longer waiting.")
                if not is_queue_ready_to_call(queue):
                    raise HTTPException(status_code=404, detail="Selected appointment queue is not ready to call yet.")
            else:
                queue = get_next_waiting_queue_for_staff(db, current_staff, service_window=requested_service_window)
            if not queue:
                all_waiting = db.query(Queue).filter(
                    Queue.branch_id == current_staff.branch_id,
                    hash_aware_match(Queue, "status", "Waiting"),
                ).count()

                detail_msg = f"No ready queue numbers are available to call yet. (Total waiting queues: {all_waiting}"
                if requested_service_window:
                    detail_msg += f", Window: {requested_service_window}"
                detail_msg += ")"
                raise HTTPException(status_code=404, detail=detail_msg)

            queue.status = "Called"
            apply_queue_security(queue)
            log_branch_action(db, current_staff, "Queue Called", f"Called queue {queue_value(queue, 'queue_number')}")
            db.commit()
            db.refresh(queue)
            service_window = normalize_service_window_for_branch(db, current_staff.branch_id, queue_value(queue, "service_type"))
            return serialize_branch_queue(db, queue, current_staff.branch_id, assigned_window_number=get_effective_assigned_window_number(db, current_staff, service_window))
        except OperationalError:
            db.rollback()
            logger.exception(
                "Queue call-next database operation failed for branch_id=%s staff=%s service_window=%s queue_id=%s",
                current_staff.branch_id,
                current_staff.username,
                requested_service_window,
                queue_id,
            )
            if attempt == 1:
                raise
        except HTTPException:
            db.rollback()
            raise
        except Exception:
            db.rollback()
            logger.exception(
                "Queue call-next failed unexpectedly for branch_id=%s staff=%s service_window=%s queue_id=%s",
                current_staff.branch_id,
                current_staff.username,
                requested_service_window,
                queue_id,
            )
            raise


@router.post("/queue/{queue_id}/serve")
async def serve_queue(
    queue_id: int,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    ensure_branch_queue_operations_enabled(db, current_staff.branch_id)
    queue = db.query(Queue).filter(Queue.id == queue_id, Queue.branch_id == current_staff.branch_id).first()
    if not queue:
        raise HTTPException(status_code=404, detail="Queue record not found")
    ensure_queue_window_access(db, current_staff, queue)
    if queue_value(queue, "status") != "Called":
        raise HTTPException(status_code=409, detail="Only a called queue can be moved to serving.")
    active_queue = get_active_branch_queue(db, current_staff.branch_id, exclude_queue_id=queue.id, current_staff=current_staff)
    if active_queue:
        raise HTTPException(status_code=409, detail="Only one queue can be active at a time. Complete or skip the current queue before serving another one.")

    queue.status = "Serving"
    queue.served_at = datetime.utcnow()
    apply_queue_security(queue)
    log_branch_action(db, current_staff, "Queue Served", f"Serving queue {queue_value(queue, 'queue_number')}")
    db.commit()
    db.refresh(queue)
    service_window = normalize_service_window_for_branch(db, current_staff.branch_id, queue_value(queue, "service_type"))
    return serialize_branch_queue(db, queue, current_staff.branch_id, assigned_window_number=get_effective_assigned_window_number(db, current_staff, service_window))


@router.post("/queue/{queue_id}/skip")
async def skip_queue(
    queue_id: int,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    ensure_branch_queue_operations_enabled(db, current_staff.branch_id)
    queue = db.query(Queue).filter(Queue.id == queue_id, Queue.branch_id == current_staff.branch_id).first()
    if not queue:
        raise HTTPException(status_code=404, detail="Queue record not found")
    ensure_queue_window_access(db, current_staff, queue)
    if queue_value(queue, "status") not in {"Called", "Serving"}:
        raise HTTPException(status_code=409, detail="Only the active queue can be skipped.")
    queue.status = "Skipped"
    apply_queue_security(queue)
    log_branch_action(db, current_staff, "Queue Skipped", f"Skipped queue {queue_value(queue, 'queue_number')}")
    db.commit()
    db.refresh(queue)
    service_window = normalize_service_window_for_branch(db, current_staff.branch_id, queue_value(queue, "service_type"))
    return serialize_branch_queue(db, queue, current_staff.branch_id, assigned_window_number=get_effective_assigned_window_number(db, current_staff, service_window))


@router.post("/queue/{queue_id}/recall-skipped")
async def recall_skipped_queue(
    queue_id: int,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    ensure_branch_queue_operations_enabled(db, current_staff.branch_id)
    queue = db.query(Queue).filter(Queue.id == queue_id, Queue.branch_id == current_staff.branch_id).first()
    if not queue:
        raise HTTPException(status_code=404, detail="Skipped queue record not found")
    ensure_queue_window_access(db, current_staff, queue)
    if queue_value(queue, "status") != "Skipped":
        raise HTTPException(status_code=409, detail="Only skipped queue records can be pulled back to the current window.")
    active_queue = get_active_branch_queue(db, current_staff.branch_id, current_staff=current_staff)
    if active_queue:
        raise HTTPException(status_code=409, detail="Complete or skip the current active queue before pulling back a skipped queue.")

    queue.status = "Called"
    apply_queue_security(queue)
    log_branch_action(db, current_staff, "Skipped Queue Recalled", f"Pulled skipped queue {queue_value(queue, 'queue_number')} back to the current window")
    db.commit()
    db.refresh(queue)
    service_window = normalize_service_window_for_branch(db, current_staff.branch_id, queue_value(queue, "service_type"))
    return serialize_branch_queue(db, queue, current_staff.branch_id, assigned_window_number=get_effective_assigned_window_number(db, current_staff, service_window))


@router.delete("/queue/skipped")
async def delete_skipped_queues(
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    ensure_branch_queue_operations_enabled(db, current_staff.branch_id)
    skipped_queues = (
        db.query(Queue)
        .filter(Queue.branch_id == current_staff.branch_id, hash_aware_match(Queue, "status", "Skipped"))
        .order_by(Queue.created_at.asc())
        .all()
    )
    if is_queue_window_staff(current_staff):
        skipped_queues = [
            queue for queue in skipped_queues
            if normalize_service_window_for_branch(db, current_staff.branch_id, queue_value(queue, "service_type")) == current_staff.service_window
        ]

    count = len(skipped_queues)
    for queue in skipped_queues:
        db.delete(queue)
    log_branch_action(db, current_staff, "Skipped Queues Deleted", f"Deleted {count} skipped queue record(s)")
    db.commit()
    return {"success": True, "deleted": count}


@router.post("/queue/{queue_id}/complete")
async def complete_queue(
    queue_id: int,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    ensure_branch_queue_operations_enabled(db, current_staff.branch_id)
    queue = db.query(Queue).filter(Queue.id == queue_id, Queue.branch_id == current_staff.branch_id).first()
    if not queue:
        raise HTTPException(status_code=404, detail="Queue record not found")
    ensure_queue_window_access(db, current_staff, queue)
    if queue_value(queue, "status") != "Serving":
        raise HTTPException(status_code=409, detail="Only a serving queue can be completed.")

    queue.status = "Completed"
    queue.completed_at = datetime.utcnow()
    apply_queue_security(queue)
    archive_completed_queue(db, queue, get_staff_display_name(current_staff))
    queue_number = queue_value(queue, "queue_number")
    db.delete(queue)
    log_branch_action(db, current_staff, "Queue Completed", f"Completed queue {queue_number}")
    db.commit()
    return {"success": True, "queue_number": queue_number, "status": "completed"}


@router.delete("/queue/{queue_id}")
async def delete_queue(
    queue_id: int,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    ensure_branch_queue_operations_enabled(db, current_staff.branch_id)
    queue = db.query(Queue).filter(Queue.id == queue_id, Queue.branch_id == current_staff.branch_id).first()
    if not queue:
        raise HTTPException(status_code=404, detail="Queue record not found")
    ensure_queue_window_access(db, current_staff, queue)

    queue_number = queue_value(queue, "queue_number")
    db.delete(queue)
    log_branch_action(db, current_staff, "Queue Deleted", f"Deleted queue {queue_number}")
    db.commit()
    return {"success": True, "queueId": queue_id, "queueNumber": queue_number}


@router.get("/payments")
async def list_branch_payments(
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    branch = db.query(Branch).filter(Branch.id == current_staff.branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    payments = get_branch_payments(current_staff, branch, db)
    remittance_statuses = get_branch_remittance_item_statuses(db, [payment.id for payment in payments])
    log_branch_action(db, current_staff, "Payments Viewed", f"Viewed {branch.name} payments")
    db.commit()
    serialized = []
    for payment in payments:
        metadata = parse_payment_metadata(payment)
        bt_application = None
        if payment.source_module == "business_tax_online_payment" and payment.related_request_id:
            bt_application = db.query(BusinessTaxApplication).filter(
                BusinessTaxApplication.tracking_number == payment.related_request_id
            ).first()

        serialized.append({
            "id": payment.id,
            "ref_number": get_decrypted_or_raw(payment, "ref_number"),
            "transaction_id": get_decrypted_or_raw(payment, "txn_id"),
            "taxpayer_name": get_decrypted_or_raw(payment, "taxpayer_name"),
            "tax_type": resolve_branch_payment_tax_type(payment, db),
            "amount": float(payment.amount or 0),
            "payment_method": get_decrypted_or_raw(payment, "payment_method"),
            "branch": resolve_branch_payment_display_name(payment, db) or (get_decrypted_or_raw(branch, "name") or branch.name),
            "status": get_effective_payment_status(payment),
            "remittance_status": remittance_statuses.get(payment.id, "Available" if get_effective_payment_status(payment) == "confirmed" else "Not Eligible"),
            "workflow_status": payment.status,
            "tin": get_decrypted_or_raw(payment, "tin"),
            "email": get_decrypted_or_raw(payment, "email"),
            "property_ref_number": get_decrypted_or_raw(payment, "property_ref_number"),
            "created_at": to_utc_iso(payment.created_at),
            "verified_at": to_utc_iso(payment.verified_at),
            "source_module": payment.source_module or "tax_payment",
            "paymongo_checkout_session_id": get_decrypted_or_raw(payment, "paymongo_checkout_session_id"),
            "paymongo_payment_intent_id": get_decrypted_or_raw(payment, "paymongo_payment_intent_id"),
            "paymongo_payment_id": get_decrypted_or_raw(payment, "paymongo_payment_id"),
            "paymongo_status": get_decrypted_or_raw(payment, "paymongo_status"),
            "proof_file_name": get_decrypted_or_raw(payment, "proof_file_name"),
            "proof_uploaded_at": to_utc_iso(payment.proof_uploaded_at),
            "has_payment_proof": bool(get_decrypted_or_raw(payment, "proof_file_path")),
            "proof_download_url": f"/api/payments/{payment.id}/proof" if get_decrypted_or_raw(payment, "proof_file_path") else None,
            "metadata": metadata,
            "treasury_remarks": get_decrypted_or_raw(payment, "treasury_remarks"),
            "official_receipt_number": get_decrypted_or_raw(payment, "official_receipt_number"),
            "official_receipt_download_url": f"/api/payments/{payment.id}/official-receipt" if get_decrypted_or_raw(payment, "official_receipt_path") else None,
            "bt_application": {
                "tracking_number": bt_application.tracking_number,
                "business_name": bt_application.business_name,
                "owner_name": bt_application.owner_name,
                "mayor_permit_number": bt_application.mayor_permit_number,
                "sec_dti_cda_number": bt_application.sec_dti_cda_number,
                "application_status": bt_application.application_status,
                "sales_declaration_name": bt_application.sales_declaration_name,
                "sales_declaration_download_url": f"/api/payments/bt/applications/{bt_application.tracking_number}/files/sales-declaration" if bt_application.sales_declaration_path else None,
                "financial_statements_name": bt_application.financial_statements_name,
                "financial_statements_download_url": f"/api/payments/bt/applications/{bt_application.tracking_number}/files/financial-statements" if bt_application.financial_statements_path else None,
                "supporting_documents_name": bt_application.supporting_documents_name,
                "supporting_documents_download_url": f"/api/payments/bt/applications/{bt_application.tracking_number}/files/supporting-documents" if bt_application.supporting_documents_path else None,
                "proof_of_payment_name": bt_application.proof_of_payment_name,
                "proof_of_payment_download_url": f"/api/payments/bt/applications/{bt_application.tracking_number}/files/proof-of-payment" if bt_application.proof_of_payment_path else None,
                "official_receipt_number": bt_application.official_receipt_number,
                "official_receipt_download_url": f"/api/payments/bt/applications/{bt_application.tracking_number}/official-receipt" if bt_application.official_receipt_path else None,
                "verifier_remarks": bt_application.verifier_remarks,
            } if bt_application else None,
        })
    return serialized


@router.get("/payments/remittances/summary")
async def get_branch_remittance_summary(
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    branch = db.query(Branch).filter(Branch.id == current_staff.branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    payments = get_branch_payments(current_staff, branch, db)
    summary = branch_collection_summary(db, branch, payments)
    db.commit()
    return {
        **{key: value for key, value in summary.items() if key not in {"available_payments", "payment_remittance_statuses"}},
        "available_payments": [
            {
                "id": payment.id,
                "ref_number": get_decrypted_or_raw(payment, "ref_number"),
                "taxpayer_name": get_decrypted_or_raw(payment, "taxpayer_name"),
                "tax_type": resolve_branch_payment_tax_type(payment, db),
                "amount": float(payment.amount or 0),
                "verified_at": to_utc_iso(payment.verified_at),
            }
            for payment in summary["available_payments"]
        ],
    }


@router.get("/payments/remittances")
async def list_branch_remittances(
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    remittances = (
        db.query(Remittance)
        .filter(Remittance.branch_id == current_staff.branch_id)
        .order_by(Remittance.submitted_at.desc(), Remittance.id.desc())
        .all()
    )
    return [serialize_remittance(db, remittance) for remittance in remittances]


@router.post("/payments/remittances")
async def create_branch_remittance(
    payload: BranchRemittanceCreatePayload,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    branch = db.query(Branch).filter(Branch.id == current_staff.branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    remittance = create_branch_remittance_record(db, current_staff, branch, payload.payment_ids, payload.remarks)
    db.commit()
    db.refresh(remittance)
    return serialize_remittance(db, remittance)


@router.post("/payments/remittances/report")
async def create_branch_remittance_with_report(
    payment_ids: str = Form(...),
    report: UploadFile = File(...),
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    branch = db.query(Branch).filter(Branch.id == current_staff.branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    try:
        parsed_payment_ids = json.loads(payment_ids)
    except json.JSONDecodeError:
        parsed_payment_ids = [value.strip() for value in payment_ids.split(",") if value.strip()]
    if not isinstance(parsed_payment_ids, list):
        raise HTTPException(status_code=400, detail="Invalid payment selection.")

    remittance_number = f"REM-{current_staff.branch_id}-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
    report_file_path, report_file_name, report_file_mime = await store_remittance_report_file(report, remittance_number)
    try:
        remittance = create_branch_remittance_record(
            db,
            current_staff,
            branch,
            parsed_payment_ids,
            remarks=f"Remittance report uploaded: {report_file_name}",
            report_file_path=report_file_path,
            report_file_name=report_file_name,
            report_file_mime=report_file_mime,
            remittance_number=remittance_number,
        )
        db.commit()
        db.refresh(remittance)
        return serialize_remittance(db, remittance)
    except Exception:
        if report_file_path and os.path.exists(report_file_path):
            os.remove(report_file_path)
        raise


@router.put("/payments/{payment_id}/verify")
async def verify_branch_payment(
    payment_id: int,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    branch = db.query(Branch).filter(Branch.id == current_staff.branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    payment = db.query(Payment).filter(Payment.id == payment_id).first()
    if not payment or not payment_belongs_to_branch(payment, branch, current_staff, db):
        raise HTTPException(status_code=404, detail="Payment not found")
    if get_effective_payment_status(payment) != "pending":
        raise HTTPException(status_code=409, detail="Only pending payments can be verified.")

    payment.status = "PAYMENT_VERIFIED" if payment.source_module == "rpt_online_payment" else "Verified"
    payment.verified_at = datetime.utcnow()
    payment.treasury_updated_at = datetime.utcnow()
    update_linked_request_status(db, payment)
    if payment.source_module == "business_tax_online_payment" and payment.related_request_id:
        bt_application = db.query(BusinessTaxApplication).filter(
            BusinessTaxApplication.tracking_number == payment.related_request_id
        ).first()
        if bt_application:
            bt_application.application_status = "OR_GENERATED"
            bt_application.payment_status = "Verified"
            bt_application.verified_at = payment.verified_at
            bt_application.verified_by = current_staff.username
            bt_application.verifier_remarks = payment.treasury_remarks or "Business Tax payment verified by branch treasury."
            bt_application.official_receipt_number = bt_application.official_receipt_number or build_bt_official_receipt_number(db)
            receipt_bytes = build_business_tax_official_receipt_pdf(payment, bt_application)
            receipt_path = OUTPUT_DIR / f"{bt_application.tracking_number}-official-receipt.pdf"
            receipt_path.write_bytes(receipt_bytes)
            bt_application.official_receipt_path = str(receipt_path)
            bt_application.official_receipt_generated_at = datetime.utcnow()
            payment.status = "OR_GENERATED"
            payment.official_receipt_number = bt_application.official_receipt_number
            payment.official_receipt_path = bt_application.official_receipt_path
            payment.official_receipt_generated_at = bt_application.official_receipt_generated_at
            payment.treasury_remarks = bt_application.verifier_remarks
    if payment.email:
        email_result = send_payment_receipt_email(
            payment.email,
            {
                "ref_number": payment.ref_number,
                "verified_at": payment.verified_at,
                "taxpayer_name": payment.taxpayer_name,
                "tin": format_tin(payment.tin),
                "tax_type": payment.tax_type,
                "payment_method": payment.payment_method,
                "amount": format_currency(payment.amount),
                "status": "Payment Verified",
                "branch": payment.branch,
                "email_context": "branch_verified",
            },
        )
        if email_result.get("sent"):
            payment.receipt_sent_at = datetime.utcnow()
            log_branch_action(db, current_staff, "Verification Email Sent", f"Verification email sent for {payment.ref_number}")
        else:
            log_branch_action(
                db,
                current_staff,
                "Verification Email Not Sent",
                f"Verification email was not sent for {payment.ref_number}: {email_result.get('message')}",
            )
    log_branch_action(db, current_staff, "Payment Verified", f"Verified payment {payment.ref_number}")
    db.commit()

    return {"message": "Payment verified successfully", "status": payment.status}


@router.put("/payments/{payment_id}/decline")
async def decline_branch_payment(
    payment_id: int,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    branch = db.query(Branch).filter(Branch.id == current_staff.branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    payment = db.query(Payment).filter(Payment.id == payment_id).first()
    if not payment or not payment_belongs_to_branch(payment, branch, current_staff, db):
        raise HTTPException(status_code=404, detail="Payment not found")
    if get_effective_payment_status(payment) != "pending":
        raise HTTPException(status_code=409, detail="Only pending payments can be declined.")

    payment.status = "Rejected" if payment.source_module == "receipt_request" else "Failed"
    payment.treasury_updated_at = datetime.utcnow()
    revert_linked_request_status_for_declined_payment(db, payment)
    if payment.source_module == "business_tax_online_payment" and payment.related_request_id:
        bt_application = db.query(BusinessTaxApplication).filter(
            BusinessTaxApplication.tracking_number == payment.related_request_id
        ).first()
        if bt_application:
            bt_application.application_status = "RETURNED_FOR_CORRECTION"
            bt_application.payment_status = "Failed"
            bt_application.returned_at = datetime.utcnow()
            bt_application.verifier_remarks = "Business Tax submission was returned for correction by branch treasury personnel."
    log_branch_action(db, current_staff, "Payment Declined", f"Declined payment {payment.ref_number}")
    db.commit()

    return {"message": "Payment declined successfully", "status": payment.status}


@router.delete("/payments/{payment_id}")
async def delete_branch_payment(
    payment_id: int,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    branch = db.query(Branch).filter(Branch.id == current_staff.branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    payment = db.query(Payment).filter(Payment.id == payment_id).first()
    if not payment or not payment_belongs_to_branch(payment, branch, current_staff, db):
        raise HTTPException(status_code=404, detail="Payment not found")

    ref_number = payment.ref_number
    db.delete(payment)
    log_branch_action(db, current_staff, "Payment Deleted", f"Deleted payment {ref_number}")
    db.commit()

    return {"message": "Payment deleted successfully", "ref_number": ref_number}


@router.get("/memos")
async def list_branch_memos(
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    branch_lookup = {branch.id: (get_decrypted_or_raw(branch, "name") or branch.name) for branch in db.query(Branch).all()}
    branch_id_str = str(current_staff.branch_id or "")
    memos = (
        db.query(Memo)
        .order_by(Memo.created_at.desc())
        .all()
    )
    memos = [
        memo for memo in memos
        if (
            (get_decrypted_or_raw(memo, "author") or memo.author) == current_staff.username
            or
            (get_decrypted_or_raw(memo, "recipient_type") or memo.recipient_type) == "all"
            or (
                (get_decrypted_or_raw(memo, "recipient_type") or memo.recipient_type) == "specific_branches"
                and branch_id_str in ((get_decrypted_or_raw(memo, "recipients") or memo.recipients or ""))
            )
        )
    ]

    log_branch_action(db, current_staff, "Memos Viewed", f"Viewed {len(memos)} memo(s)")
    db.commit()

    return [
        {
            "id": memo.id,
            "title": get_decrypted_or_raw(memo, "title") or memo.title,
            "content": get_decrypted_or_raw(memo, "content") or memo.content,
            "recipient_type": get_decrypted_or_raw(memo, "recipient_type") or memo.recipient_type,
            "recipient_label": "All Branches" if (get_decrypted_or_raw(memo, "recipient_type") or memo.recipient_type) == "all" else ", ".join(
                branch_lookup.get(int(item.strip()), f"Branch {item.strip()}")
                for item in ((get_decrypted_or_raw(memo, "recipients") or memo.recipients or "")).split(",")
                if item.strip().isdigit()
            ),
            "author": get_decrypted_or_raw(memo, "author") or memo.author,
            "author_type": get_decrypted_or_raw(memo, "author_type") or getattr(memo, "author_type", "admin"),
            "is_mine": (get_decrypted_or_raw(memo, "author") or memo.author) == current_staff.username,
            "priority": get_decrypted_or_raw(memo, "priority") or memo.priority,
            "attachment_path": get_decrypted_or_raw(memo, "attachment_path") or memo.attachment_path,
            "attachment_filename": get_decrypted_or_raw(memo, "attachment_filename") or memo.attachment_filename,
            "is_viewed": find_memo_view(db, MemoView, memo.id, current_staff.username, "branch_staff") is not None,
            "created_at": memo.created_at.isoformat() if memo.created_at else None,
            "updated_at": memo.updated_at.isoformat() if memo.updated_at else None,
        }
        for memo in memos
    ]


def _require_branch_admin_memo_access(current_staff: BranchStaff):
    if current_staff.role != "branch_admin":
        raise HTTPException(status_code=403, detail="Only branch admins can manage internal memos.")


def _store_memo_attachment(attachment: Optional[UploadFile]) -> tuple[str | None, str | None]:
    if not attachment or not attachment.filename:
        return None, None

    file_bytes = attachment.file.read()
    validate_upload_file(
        attachment,
        file_bytes,
        allowed_extensions={".pdf", ".png", ".jpg", ".jpeg"},
    )

    upload_dir = Path("uploads/memos")
    upload_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", attachment.filename)
    file_path = upload_dir / f"{timestamp}_{safe_name}"
    file_path.write_bytes(file_bytes)
    return str(file_path), attachment.filename


@router.post("/memos")
async def create_branch_memo(
    title: str = Form(...),
    content: str = Form(...),
    priority: str = Form("normal"),
    attachment: Optional[UploadFile] = File(None),
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    _require_branch_admin_memo_access(current_staff)
    if not title.strip() or not content.strip():
        raise HTTPException(status_code=400, detail="Memo title and content are required.")
    attachment_path, attachment_filename = _store_memo_attachment(attachment)
    memo = Memo(
        title=title.strip(),
        content=content.strip(),
        recipients=str(current_staff.branch_id),
        recipient_type="specific_branches",
        priority=priority,
        author=current_staff.username,
        author_type="branch_staff",
        attachment_path=attachment_path,
        attachment_filename=attachment_filename,
    )
    db.add(memo)
    db.flush()
    apply_memo_security(memo)
    log_branch_action(db, current_staff, "Memo Created", f"Created internal memo: {title.strip()}")
    db.commit()
    db.refresh(memo)
    return {"id": memo.id, "message": "Memo created successfully"}


@router.put("/memos/{memo_id}")
async def update_branch_memo(
    memo_id: int,
    title: str = Form(...),
    content: str = Form(...),
    priority: str = Form("normal"),
    attachment: Optional[UploadFile] = File(None),
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    _require_branch_admin_memo_access(current_staff)
    memo = db.query(Memo).filter(Memo.id == memo_id).first()
    if not memo:
        raise HTTPException(status_code=404, detail="Memo not found")
    if (get_decrypted_or_raw(memo, "author") or memo.author) != current_staff.username:
        raise HTTPException(status_code=403, detail="You can only edit memos you created.")
    if attachment and attachment.filename:
        old_path = get_decrypted_or_raw(memo, "attachment_path") or memo.attachment_path
        if old_path and os.path.exists(old_path):
            os.remove(old_path)
        memo.attachment_path, memo.attachment_filename = _store_memo_attachment(attachment)
    memo.title = title.strip()
    memo.content = content.strip()
    memo.priority = priority
    memo.recipients = str(current_staff.branch_id)
    memo.recipient_type = "specific_branches"
    memo.updated_at = datetime.utcnow()
    apply_memo_security(memo)
    log_branch_action(db, current_staff, "Memo Updated", f"Updated internal memo: {title.strip()}")
    db.commit()
    return {"message": "Memo updated successfully"}


@router.delete("/memos/{memo_id}")
async def delete_branch_memo(
    memo_id: int,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    _require_branch_admin_memo_access(current_staff)
    memo = db.query(Memo).filter(Memo.id == memo_id).first()
    if not memo:
        raise HTTPException(status_code=404, detail="Memo not found")
    if (get_decrypted_or_raw(memo, "author") or memo.author) != current_staff.username:
        raise HTTPException(status_code=403, detail="You can only delete memos you created.")
    attachment_path = get_decrypted_or_raw(memo, "attachment_path") or memo.attachment_path
    if attachment_path and os.path.exists(attachment_path):
        os.remove(attachment_path)
    db.query(MemoView).filter(MemoView.memo_id == memo_id).delete()
    db.delete(memo)
    log_branch_action(db, current_staff, "Memo Deleted", f"Deleted internal memo #{memo_id}")
    db.commit()
    return {"message": "Memo deleted successfully"}


@router.get("/announcements")
async def list_branch_announcements(
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    branch = db.query(Branch).filter(Branch.id == current_staff.branch_id).first()
    branch_name = branch.name if branch else f"Branch {current_staff.branch_id}"
    announcements = (
        db.query(Announcement)
        .filter(Announcement.branch_id == current_staff.branch_id)
        .order_by(Announcement.created_at.desc())
        .all()
    )

    viewed_ids = set(get_announcement_viewed_ids(db, AnnouncementView, current_staff.username, "branch_staff"))
    return [
        serialize_branch_announcement(announcement, branch_name, announcement.id in viewed_ids)
        for announcement in announcements
    ]


@router.get("/announcements/unread-count")
async def get_branch_announcement_unread_count(
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    announcement_ids = [
        row[0]
        for row in db.query(Announcement.id).filter(Announcement.branch_id == current_staff.branch_id).all()
    ]
    viewed_ids = set(get_announcement_viewed_ids(db, AnnouncementView, current_staff.username, "branch_staff"))
    unread_count = len([announcement_id for announcement_id in announcement_ids if announcement_id not in viewed_ids])
    return {"unread_count": unread_count}


@router.post("/announcements/{announcement_id}/mark-viewed")
async def mark_branch_announcement_as_viewed(
    announcement_id: int,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    announcement = _get_owned_branch_announcement(db, announcement_id, current_staff)
    title = decrypt_optional_value(getattr(announcement, "title_enc", None)) or announcement.title
    try:
        mark_branch_announcement_viewed(db, announcement.id, current_staff.username, "branch_staff")
        log_branch_action(db, current_staff, "Announcement Viewed", f"Viewed announcement: {title}")
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as error:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to update announcement status") from error
    return {"message": "Announcement marked as viewed"}


@router.post("/announcements")
async def create_branch_announcement(
    payload: BranchAnnouncementPayload,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    branch = db.query(Branch).filter(Branch.id == current_staff.branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    try:
        announcement = Announcement(
            title=payload.title,
            content=payload.content,
            icon_type=payload.icon_type,
            icon_color=payload.icon_color,
            branch_id=current_staff.branch_id,
            created_by=current_staff.username,
            is_active=bool(payload.is_active),
            publish_date=datetime.utcnow() if payload.is_active else None,
        )
        db.add(announcement)
        db.flush()
        mark_branch_announcement_viewed(db, announcement.id, current_staff.username, "branch_staff")
        log_branch_action(db, current_staff, "Announcement Created", f"Created branch announcement: {payload.title}")
        db.commit()
        db.refresh(announcement)
    except HTTPException:
        db.rollback()
        raise
    except Exception as error:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to create branch announcement") from error

    return serialize_branch_announcement(announcement, branch.name, True)


@router.put("/announcements/{announcement_id}")
async def update_branch_announcement(
    announcement_id: int,
    payload: BranchAnnouncementPayload,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    branch = db.query(Branch).filter(Branch.id == current_staff.branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    announcement = (
        db.query(Announcement)
        .filter(
            Announcement.id == announcement_id,
            Announcement.branch_id == current_staff.branch_id
        )
        .first()
    )
    if not announcement:
        raise HTTPException(status_code=404, detail="Announcement not found")

    try:
        announcement.title = payload.title
        announcement.content = payload.content
        announcement.icon_type = payload.icon_type
        announcement.icon_color = payload.icon_color
        announcement.is_active = bool(payload.is_active)
        announcement.updated_at = datetime.utcnow()
        if announcement.is_active and not announcement.publish_date:
            announcement.publish_date = datetime.utcnow()

        mark_branch_announcement_viewed(db, announcement.id, current_staff.username, "branch_staff")
        log_branch_action(db, current_staff, "Announcement Updated", f"Updated branch announcement: {payload.title}")
        db.commit()
        db.refresh(announcement)
    except HTTPException:
        db.rollback()
        raise
    except Exception as error:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to update branch announcement") from error

    return serialize_branch_announcement(announcement, branch.name, True)


@router.delete("/announcements/{announcement_id}")
async def delete_branch_announcement(
    announcement_id: int,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    announcement = (
        db.query(Announcement)
        .filter(
            Announcement.id == announcement_id,
            Announcement.branch_id == current_staff.branch_id
        )
        .first()
    )
    if not announcement:
        raise HTTPException(status_code=404, detail="Announcement not found")

    title = decrypt_optional_value(getattr(announcement, "title_enc", None)) or announcement.title
    try:
        for attachment in list(announcement.attachments or []):
            remove_attachment_file(attachment)
        from utils.announcement_attachments import remove_announcement_directory
        remove_announcement_directory(announcement.id)
        db.query(AnnouncementView).filter(AnnouncementView.announcement_id == announcement.id).delete()
        db.delete(announcement)
        log_branch_action(db, current_staff, "Announcement Deleted", f"Deleted branch announcement: {title}")
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as error:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to delete branch announcement") from error

    return {"message": "Announcement deleted successfully"}


# ---------------------------------------------------------------------------
# Branch announcement attachment endpoints
# ---------------------------------------------------------------------------


def _get_owned_branch_announcement(
    db: Session, announcement_id: int, current_staff: BranchStaff
) -> Announcement:
    announcement = (
        db.query(Announcement)
        .filter(
            Announcement.id == announcement_id,
            Announcement.branch_id == current_staff.branch_id,
        )
        .first()
    )
    if not announcement:
        raise HTTPException(status_code=404, detail="Announcement not found")
    return announcement


@router.get("/announcements/{announcement_id}/attachments")
async def list_branch_announcement_attachments(
    announcement_id: int,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    announcement = _get_owned_branch_announcement(db, announcement_id, current_staff)
    return serialize_attachments(
        announcement.attachments or [],
        base_path=f"/api/branch/announcements/{announcement_id}/attachments",
    )


@router.post("/announcements/{announcement_id}/attachments")
async def upload_branch_announcement_attachments(
    announcement_id: int,
    files: List[UploadFile] = File(...),
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    announcement = _get_owned_branch_announcement(db, announcement_id, current_staff)
    if not files:
        raise HTTPException(status_code=400, detail="No files were provided")

    enforce_attachment_limit(len(announcement.attachments or []), len(files))

    saved: list[AnnouncementAttachment] = []
    try:
        for upload in files:
            file_bytes = await upload.read()
            attachment = store_announcement_attachment(
                announcement_id,
                upload,
                file_bytes,
                uploaded_by=getattr(current_staff, "username", None),
            )
            db.add(attachment)
            saved.append(attachment)
        db.flush()
        log_branch_action(
            db,
            current_staff,
            "Announcement Attachment Uploaded",
            f"Uploaded {len(saved)} attachment(s) to announcement #{announcement_id}",
        )
        db.commit()
    except HTTPException:
        db.rollback()
        for attachment in saved:
            remove_attachment_file(attachment)
        raise
    except Exception:
        db.rollback()
        for attachment in saved:
            remove_attachment_file(attachment)
        raise HTTPException(status_code=500, detail="Failed to save attachments")

    db.refresh(announcement)
    return serialize_attachments(
        announcement.attachments or [],
        base_path=f"/api/branch/announcements/{announcement_id}/attachments",
    )


def _get_branch_attachment_for_download(
    db: Session, announcement_id: int, attachment_id: int
) -> AnnouncementAttachment:
    """Public download lookup - branch announcements are visible publicly."""
    attachment = (
        db.query(AnnouncementAttachment)
        .filter(
            AnnouncementAttachment.id == attachment_id,
            AnnouncementAttachment.announcement_id == announcement_id,
        )
        .first()
    )
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if attachment_bytes(attachment) is None and not os.path.exists(attachment.file_path):
        raise HTTPException(status_code=404, detail="Attachment file is missing")
    return attachment


@router.get("/announcements/{announcement_id}/attachments/{attachment_id}/download")
async def download_branch_announcement_attachment(
    announcement_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
):
    attachment = _get_branch_attachment_for_download(db, announcement_id, attachment_id)
    content = attachment_bytes(attachment)
    if content is not None:
        return Response(
            content=content,
            media_type=attachment.mime_type or "application/octet-stream",
            headers={
                "Content-Disposition": f'attachment; filename="{attachment.original_filename}"',
                "X-Content-Type-Options": "nosniff",
            },
        )
    return FileResponse(
        attachment.file_path,
        media_type=attachment.mime_type or "application/octet-stream",
        filename=attachment.original_filename,
        headers={"X-Content-Type-Options": "nosniff"},
    )


@router.get("/announcements/{announcement_id}/attachments/{attachment_id}/preview")
async def preview_branch_announcement_attachment(
    announcement_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
):
    """Inline preview for browser-renderable types (images, PDFs).
    
    Only serves inline preview for verified safe types (PDF, PNG, JPEG).
    All other types are forced to download as attachment.
    Sends X-Content-Type-Options: nosniff to prevent MIME sniffing.
    """
    from utils.file_validation import SafeFileType
    
    attachment = _get_branch_attachment_for_download(db, announcement_id, attachment_id)
    
    mime_type = attachment.mime_type or "application/octet-stream"
    is_safe_preview = SafeFileType.is_safe_for_preview(mime_type)
    
    # For non-previewable types, force download as attachment
    disposition = "inline" if is_safe_preview else "attachment"
    
    content = attachment_bytes(attachment)
    if content is not None:
        headers = {
            "Content-Disposition": f'{disposition}; filename="{attachment.original_filename}"',
            "X-Content-Type-Options": "nosniff",
        }
        if not is_safe_preview:
            headers["Content-Security-Policy"] = "default-src 'none'; sandbox"
        return Response(content=content, media_type=mime_type, headers=headers)
    return FileResponse(
        attachment.file_path,
        media_type=mime_type,
        filename=attachment.original_filename,
        headers={
            "Content-Disposition": f'{disposition}; filename="{attachment.original_filename}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/announcements/{announcement_id}/attachments/{attachment_id}")
async def delete_branch_announcement_attachment(
    announcement_id: int,
    attachment_id: int,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    announcement = _get_owned_branch_announcement(db, announcement_id, current_staff)
    attachment = (
        db.query(AnnouncementAttachment)
        .filter(
            AnnouncementAttachment.id == attachment_id,
            AnnouncementAttachment.announcement_id == announcement.id,
        )
        .first()
    )
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    filename = attachment.original_filename
    remove_attachment_file(attachment)
    db.delete(attachment)
    log_branch_action(
        db,
        current_staff,
        "Announcement Attachment Removed",
        f"Removed attachment '{filename}' from announcement #{announcement.id}",
    )
    db.commit()
    return {"message": "Attachment removed successfully"}


@router.get("/policies")
async def list_branch_policies(
    current_staff: BranchStaff = Depends(require_any_branch_staff()),
    db: Session = Depends(get_db),
):
    policies = db.query(Policy).order_by(Policy.updated_at.desc()).all()

    log_branch_action(
        db,
        current_staff,
        "Policies Viewed",
        f"Viewed {len(policies)} published policy record(s)"
    )
    db.commit()

    return [serialize_branch_policy(policy, current_staff.username, db) for policy in policies]


@router.post("/policies/{policy_id}/mark-viewed")
async def mark_branch_policy_viewed(
    policy_id: int,
    current_staff: BranchStaff = Depends(require_any_branch_staff()),
    db: Session = Depends(get_db),
):
    policy = db.query(Policy).filter(Policy.id == policy_id).first()
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")

    existing_view = db.query(PolicyView).filter(
        PolicyView.policy_id == policy_id,
        PolicyView.viewer_username == current_staff.username,
        PolicyView.viewer_type == "branch_staff",
    ).first()
    if not existing_view:
        db.add(PolicyView(
            policy_id=policy_id,
            viewer_username=current_staff.username,
            viewer_type="branch_staff",
        ))
        db.commit()
    return {"message": "Policy marked as viewed"}


@router.get("/policies/unread-count")
async def get_branch_policy_unread_count(
    current_staff: BranchStaff = Depends(require_any_branch_staff()),
    db: Session = Depends(get_db),
):
    all_policy_ids = [policy.id for policy in db.query(Policy).all()]
    viewed_policy_ids = [
        view.policy_id for view in db.query(PolicyView).filter(
            PolicyView.viewer_username == current_staff.username,
            PolicyView.viewer_type == "branch_staff",
        ).all()
    ]
    unread_count = len([policy_id for policy_id in all_policy_ids if policy_id not in viewed_policy_ids])
    return {"unread_count": unread_count}

@router.post("/memos/{memo_id}/mark-viewed")
async def mark_branch_memo_viewed(
    memo_id: int,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db)
):
    """Mark a memo as viewed by the current branch staff"""
    memo = db.query(Memo).filter(Memo.id == memo_id).first()
    if not memo:
        raise HTTPException(status_code=404, detail="Memo not found")
    
    existing_view = find_memo_view(db, MemoView, memo_id, current_staff.username, "branch_staff")
    
    if not existing_view:
        new_view = MemoView(
            memo_id=memo_id,
            viewer_username=current_staff.username,
            viewer_type="branch_staff"
        )
        db.add(new_view)
        db.flush()
        apply_memo_view_security(new_view)
        db.commit()
    
    return {"message": "Memo marked as viewed"}

@router.get("/memos/{memo_id}/download-attachment")
async def download_branch_memo_attachment(
    memo_id: int,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db)
):
    """Download memo attachment for branch staff"""
    from fastapi.responses import FileResponse
    import os
    
    memo = db.query(Memo).filter(Memo.id == memo_id).first()
    if not memo:
        raise HTTPException(status_code=404, detail="Memo not found")
    
    branch_id_str = str(current_staff.branch_id or "")
    recipient_type = get_decrypted_or_raw(memo, "recipient_type") or memo.recipient_type
    recipients = get_decrypted_or_raw(memo, "recipients") or memo.recipients or ""
    if recipient_type == "specific_branches" and branch_id_str not in recipients:
        raise HTTPException(status_code=403, detail="Access denied")
    
    attachment_path = get_decrypted_or_raw(memo, "attachment_path") or memo.attachment_path
    attachment_filename = get_decrypted_or_raw(memo, "attachment_filename") or memo.attachment_filename
    if not attachment_path or not os.path.exists(attachment_path):
        raise HTTPException(status_code=404, detail="Attachment not found")
    
    return FileResponse(
        path=attachment_path,
        filename=attachment_filename or "attachment",
        media_type="application/octet-stream",
        headers={"X-Content-Type-Options": "nosniff"},
    )

@router.get("/memos/unread-count")
async def get_branch_unread_count(
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db)
):
    """Get count of unread memos for the current branch staff"""
    branch_id_str = str(current_staff.branch_id or "")
    all_memos = db.query(Memo).all()
    all_memos = [
        memo for memo in all_memos
        if (
            (get_decrypted_or_raw(memo, "recipient_type") or memo.recipient_type) == "all"
            or (
                (get_decrypted_or_raw(memo, "recipient_type") or memo.recipient_type) == "specific_branches"
                and branch_id_str in ((get_decrypted_or_raw(memo, "recipients") or memo.recipients or ""))
            )
        )
    ]
    
    all_memo_ids = [memo.id for memo in all_memos]
    viewed_memo_ids = get_memo_viewed_ids(db, MemoView, current_staff.username, "branch_staff")
    unread_count = len([mid for mid in all_memo_ids if mid not in viewed_memo_ids])
    return {"unread_count": unread_count}


@router.get("/receipts")
async def list_branch_receipts(current_staff: BranchStaff = Depends(get_current_branch_staff)):
    return []


@router.post("/receipts")
async def create_branch_receipt_placeholder(current_staff: BranchStaff = Depends(get_current_branch_staff)):
    return {"message": "Not implemented"}
