from datetime import datetime, date, timedelta, timezone
from io import BytesIO
import asyncio
import hashlib
import mimetypes
import os
import re
import secrets
import time

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from fastapi.responses import FileResponse, StreamingResponse
from PIL import Image
import qrcode
from pydantic import BaseModel
from sqlalchemy.orm import Session

from slowapi import Limiter
from slowapi.util import get_remote_address

from database.models import ActivityLog, Branch, CitizenUser, Payment, Queue, ReceiptRecord, ReceiptRequest, ReceiptRequestHistory, get_db
from middleware.branch_auth import get_current_branch_staff
from services.ocr_runtime import run_ocr_in_executor
from services.ocr_service import OCRProcessingError, ocr_service
from services.email_service import send_receipt_release_email
from utils.branch_appointment_settings import validate_branch_appointment_datetime
from utils.branch_system_settings import get_branch_setting_value
from utils.field_crypto import apply_payment_security, apply_receipt_record_security, apply_receipt_request_history_security, apply_receipt_request_security, find_citizen_by_email, find_payment_by_ref_number, get_decrypted_or_raw, hash_aware_any, hash_aware_match, hash_optional_value, queue_value, receipt_record_value, receipt_request_history_value, receipt_request_value, set_encrypted_hash_companions
from utils.security_validation import normalize_email
from utils.system_settings import SYSTEM_DISABLED_MESSAGE, get_setting_value

router = APIRouter()
USER_SECRET_KEY = os.getenv("USER_SECRET_KEY", "your-user-secret-key-change-in-production")
UNIFIED_SECRET_KEY = os.getenv("AUTH_SECRET_KEY", "your-unified-auth-secret-change-in-production")
ALGORITHM = "HS256"
ACTIVE_QUEUE_STATUSES = ("Pending", "Waiting", "Called", "Serving")
optional_user_security = HTTPBearer(auto_error=False)
MOBILE_RECEIPT_UPLOAD_SESSIONS: dict[str, dict] = {}
MOBILE_RECEIPT_UPLOAD_TTL_SECONDS = 15 * 60
MANILA_TIMEZONE = timezone(timedelta(hours=8))

# Rate limiting configuration
def get_rate_limit_key(request: Request) -> str:
    """Get rate limit key - user-based if authenticated, otherwise IP-based"""
    # Try to get user ID from request state (set by auth middleware)
    if hasattr(request.state, 'user') and request.state.user:
        return f"user:{request.state.user.id}"
    # Fallback to IP
    return get_remote_address(request)

limiter = Limiter(key_func=get_rate_limit_key)

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads", "receipts")
RELEASE_UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads", "released_receipts")
NAME_PATTERN = re.compile(r"^[A-Za-z.\-' ]+$")
ALLOWED_RELEASE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_RELEASE_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_RELEASE_FILE_SIZE = 5 * 1024 * 1024
RECEIPT_REQUEST_FEE = 200.0
RECEIPT_REQUEST_REASON_OPTIONS = {
    "Lost original receipt",
    "Damaged receipt",
    "Personal record keeping",
    "Accounting requirement",
    "Bank or loan requirement",
    "Government compliance",
    "Other",
}


def unique_receipt_request_id() -> str:
    return f"REQ-{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}"


def unique_receipt_payment_refs() -> tuple[str, str]:
    timestamp = datetime.utcnow().strftime('%Y%m%d%H%M%S%f')
    return (f"RCP-{timestamp}", f"TXN-{timestamp[-12:]}")


def clear_receipt_payment_checkout_fields(payment: Payment):
    for field_name in (
        "paymongo_checkout_session_id",
        "paymongo_payment_intent_id",
        "paymongo_source_id",
        "paymongo_checkout_url",
        "paymongo_status",
    ):
        setattr(payment, field_name, None)
        set_encrypted_hash_companions(payment, field_name, None)


class PublicReceiptRequestCreate(BaseModel):
    taxpayerName: str
    taxType: str
    requestReason: str
    requestReasonOther: str | None = None
    branchId: int
    txnDate: str
    refNumber: str | None = None
    email: str


class ReceiptFeePaymentRequest(BaseModel):
    paymentMethod: str = "gcash"
    email: str | None = None
    taxpayerName: str | None = None
    transactionDate: str | None = None
    branchId: int | None = None
    taxType: str | None = None


class ReleaseReceiptResponse(BaseModel):
    requestId: str
    emailed: bool
    message: str


class ReceiptRecordPayload(BaseModel):
    receipt_number: str | None = None
    ref_number: str | None = None
    txn_id: str | None = None
    taxpayer_name: str | None = None
    transaction_date: str | None = None
    amount: float | None = None
    tax_type: str | None = None
    raw_text: str | None = None
    confidence: float | None = None
    source_image_path: str | None = None
    source_image_sha256: str | None = None
    source_image_ahash: str | None = None
    selected_category: str | None = None
    detected_category: str | None = None
    category_match: bool | None = None
    source_image_original_filename: str | None = None
    source_image_suggested_filename: str | None = None
    filename_matches_taxpayer: bool | None = None
    auto_rename_source_image: bool | None = None


class MobileReceiptUploadSessionCreate(BaseModel):
    queue_id: int
    category: str


def normalize_receipt_payment_method(payment_method: str | None) -> str:
    normalized = (payment_method or "gcash").strip().lower().replace(" ", "_")
    method_aliases = {
        "gcash": "gcash",
        "maya": "maya",
        "paymaya": "maya",
        "card": "card",
        "banking": "banking",
        "online_banking": "banking",
        "grabpay": "grabpay",
        "grab_pay": "grabpay",
    }
    resolved = method_aliases.get(normalized)
    if not resolved:
        raise HTTPException(status_code=400, detail="Unsupported payment method selected")
    return resolved


def get_current_manila_date_value() -> str:
    return datetime.now(MANILA_TIMEZONE).date().isoformat()


def derive_tax_type_from_queue_service(service_type: str | None) -> str:
    normalized = (service_type or "").strip().lower()
    if "real property" in normalized or "rpt" in normalized or "amilyar" in normalized:
        return "RPT"
    if "business" in normalized or normalized == "bt" or "permit" in normalized:
        return "BUSINESS"
    return "MISC"


def serialize_receipt_record(record: ReceiptRecord):
    return {
        "id": record.id,
        "branch_id": record.branch_id,
        "receipt_number": receipt_record_value(record, "receipt_number"),
        "ref_number": receipt_record_value(record, "ref_number"),
        "txn_id": receipt_record_value(record, "txn_id"),
        "taxpayer_name": receipt_record_value(record, "taxpayer_name"),
        "transaction_date": receipt_record_value(record, "transaction_date"),
        "amount": float(record.amount) if record.amount is not None else None,
        "tax_type": receipt_record_value(record, "tax_type"),
        "source_image_sha256": record.source_image_sha256,
        "source_image_ahash": record.source_image_ahash,
        "selected_category": record.selected_category,
        "detected_category": record.detected_category,
        "source_image_path": receipt_record_value(record, "source_image_path"),
        "raw_ocr_text": receipt_record_value(record, "raw_ocr_text"),
        "verification_status": receipt_record_value(record, "verification_status"),
        "confidence": record.confidence,
        "uploaded_by": record.uploaded_by,
        "created_at": record.created_at.isoformat() if record.created_at else None,
    }


def serialize_receipt_request(request: ReceiptRequest, db: Session):
    branch_name = None
    if request.branch_id:
        branch = db.query(Branch).filter(Branch.id == request.branch_id).first()
        branch_name = get_decrypted_or_raw(branch, "name") if branch else None

    payment = get_latest_receipt_request_payment(db, receipt_request_value(request, "request_id"))

    matched_receipt = None
    if request.matched_receipt_id:
        matched_receipt = db.query(ReceiptRecord).filter(ReceiptRecord.id == request.matched_receipt_id).first()

    payment_status = get_receipt_request_payment_status(request, payment)
    release_status = get_receipt_request_release_status(request)
    overall_status = get_receipt_request_overall_status(request, payment)
    next_action = get_receipt_request_next_action(request, payment)

    return {
        "requestId": receipt_request_value(request, "request_id"),
        "taxpayerName": receipt_request_value(request, "taxpayer_name"),
        "taxType": receipt_request_value(request, "tax_type"),
        "requestReason": receipt_request_value(request, "request_reason"),
        "requestReasonOther": receipt_request_value(request, "request_reason_other"),
        "transactionDate": receipt_request_value(request, "transaction_date"),
        "refNumber": receipt_request_value(request, "ref_number"),
        "email": receipt_request_value(request, "email"),
        "status": overall_status,
        "overallStatus": overall_status,
        "paymentStatus": payment_status,
        "releaseStatus": release_status,
        "nextAction": next_action,
        "feePaid": request.fee_paid,
        "branchId": request.branch_id,
        "branchName": branch_name,
        "matchedReceiptId": request.matched_receipt_id,
        "paymentRefNumber": payment.ref_number if payment else receipt_request_value(request, "payment_ref_number"),
        "releaseCopyFilename": receipt_request_value(request, "release_copy_filename"),
        "hasReleaseCopy": bool(receipt_request_value(request, "release_copy_path")),
        "processedAt": request.processed_at.isoformat() if request.processed_at else None,
        "createdAt": request.created_at.isoformat() if request.created_at else None,
        "matchedReceipt": serialize_receipt_record(matched_receipt) if matched_receipt else None,
        "payment": {
            "refNumber": payment.ref_number,
            "status": payment.status,
            "amount": float(payment.amount or 0),
            "paymentMethod": payment.payment_method,
        } if payment else None,
    }


def serialize_receipt_request_history(history: ReceiptRequestHistory, db: Session):
    branch_name = None
    if history.branch_id:
        branch = db.query(Branch).filter(Branch.id == history.branch_id).first()
        branch_name = get_decrypted_or_raw(branch, "name") if branch else None

    payment = None
    history_payment_ref_number = receipt_request_history_value(history, "payment_ref_number")
    if history_payment_ref_number:
        payment = find_payment_by_ref_number(db, Payment, history_payment_ref_number)

    matched_receipt = None
    if history.matched_receipt_id:
        matched_receipt = db.query(ReceiptRecord).filter(ReceiptRecord.id == history.matched_receipt_id).first()

    return {
        "requestId": receipt_request_history_value(history, "request_id"),
        "taxpayerName": receipt_request_history_value(history, "taxpayer_name"),
        "taxType": receipt_request_history_value(history, "tax_type"),
        "requestReason": receipt_request_history_value(history, "request_reason"),
        "requestReasonOther": receipt_request_history_value(history, "request_reason_other"),
        "transactionDate": receipt_request_history_value(history, "transaction_date"),
        "refNumber": receipt_request_history_value(history, "ref_number"),
        "email": receipt_request_history_value(history, "email"),
        "status": receipt_request_history_value(history, "final_status"),
        "overallStatus": receipt_request_history_value(history, "final_status"),
        "paymentStatus": "Verified" if history.fee_paid else "Pending",
        "releaseStatus": "Released" if receipt_request_history_value(history, "final_status") in {"Released", "Completed"} else "Not Ready for Release",
        "feePaid": history.fee_paid,
        "branchId": history.branch_id,
        "branchName": branch_name,
        "matchedReceiptId": history.matched_receipt_id,
        "paymentRefNumber": receipt_request_history_value(history, "payment_ref_number"),
        "releaseCopyFilename": receipt_request_history_value(history, "release_copy_filename"),
        "hasReleaseCopy": bool(receipt_request_history_value(history, "release_copy_filename")),
        "processedAt": history.processed_at.isoformat() if history.processed_at else None,
        "createdAt": history.created_at.isoformat() if history.created_at else None,
        "archivedAt": history.archived_at.isoformat() if history.archived_at else None,
        "completedBy": history.completed_by,
        "matchedReceipt": serialize_receipt_record(matched_receipt) if matched_receipt else None,
        "payment": {
            "refNumber": payment.ref_number,
            "status": payment.status,
            "amount": float(payment.amount or 0),
            "paymentMethod": payment.payment_method,
        } if payment else None,
    }


def find_receipt_request_by_request_id(db: Session, request_id: str | None) -> ReceiptRequest | None:
    normalized_request_id = (request_id or "").strip()
    if not normalized_request_id:
        return None

    receipt_request = (
        db.query(ReceiptRequest)
        .filter(hash_aware_match(ReceiptRequest, "request_id", normalized_request_id))
        .first()
    )
    if receipt_request:
        return receipt_request

    # Fallback for legacy/encrypted rows whose hash companion may be stale.
    for candidate in db.query(ReceiptRequest).all():
        if receipt_request_value(candidate, "request_id") == normalized_request_id:
            return candidate

    return None


def validate_taxpayer_name(value: str) -> str:
    normalized = (value or "").strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="Taxpayer name is required")
    if not NAME_PATTERN.match(normalized):
        raise HTTPException(status_code=400, detail="Taxpayer name must contain letters only")
    return normalized


def validate_transaction_date(value: str) -> str:
    normalized = (value or "").strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="Transaction date is required")

    try:
        parsed_date = date.fromisoformat(normalized)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Transaction date must use a valid date.") from exc

    if parsed_date > datetime.now(MANILA_TIMEZONE).date():
        raise HTTPException(status_code=400, detail="Transaction date cannot be in the future.")

    return normalized


def validate_receipt_request_reason(reason: str | None, custom_reason: str | None) -> tuple[str, str | None]:
    normalized_reason = (reason or "").strip()
    if not normalized_reason:
        raise HTTPException(status_code=400, detail="Reason for request is required.")
    if normalized_reason not in RECEIPT_REQUEST_REASON_OPTIONS:
        raise HTTPException(status_code=400, detail="Please select a valid reason for request.")

    normalized_custom_reason = (custom_reason or "").strip() or None
    if normalized_reason == "Other":
        if not normalized_custom_reason:
            raise HTTPException(status_code=400, detail="Please provide your custom reason for request.")
        if len(normalized_custom_reason) > 255:
            raise HTTPException(status_code=400, detail="Custom reason must be 255 characters or less.")
    else:
        normalized_custom_reason = None

    return normalized_reason, normalized_custom_reason


def find_matching_receipt(db: Session, branch_id: int, ref_number: str, taxpayer_name: str, transaction_date: str, tax_type: str):
    query = db.query(ReceiptRecord)
    if branch_id:
        query = query.filter(ReceiptRecord.branch_id == branch_id)
    if ref_number:
        query = query.filter(hash_aware_match(ReceiptRecord, "ref_number", ref_number))
    if tax_type:
        query = query.filter(hash_aware_match(ReceiptRecord, "tax_type", tax_type))
    matches = query.order_by(ReceiptRecord.created_at.desc()).all()

    if not matches:
        return None

    normalized_name = (taxpayer_name or "").strip().lower()
    normalized_date = (transaction_date or "").strip()

    for record in matches:
        same_name = not normalized_name or ((receipt_record_value(record, "taxpayer_name") or "").strip().lower() == normalized_name)
        same_date = not normalized_date or ((receipt_record_value(record, "transaction_date") or "").strip() == normalized_date)
        if same_name or same_date:
            return record

    return matches[0]


def normalize_reference_number(value: str | None) -> str | None:
    normalized = (value or "").strip()
    return normalized or None


def get_latest_receipt_request_payment(db: Session, request_id: str | None) -> Payment | None:
    if not request_id:
        return None
    return (
        db.query(Payment)
        .filter(Payment.related_request_id == request_id)
        .order_by(Payment.created_at.desc(), Payment.id.desc())
        .first()
    )


def resolve_receipt_request_for_payment(
    db: Session,
    request_id: str | None,
    payment_data: ReceiptFeePaymentRequest,
) -> ReceiptRequest | None:
    normalized_request_id = (request_id or "").strip()
    if normalized_request_id:
        receipt_request = db.query(ReceiptRequest).filter(ReceiptRequest.request_id == normalized_request_id).first()
        if receipt_request:
            return receipt_request
        receipt_request = db.query(ReceiptRequest).filter(ReceiptRequest.request_id_hash == hash_optional_value(normalized_request_id)).first()
        if receipt_request:
            return receipt_request
        receipt_request = db.query(ReceiptRequest).filter(hash_aware_match(ReceiptRequest, "request_id", normalized_request_id)).first()
        if receipt_request:
            return receipt_request

    normalized_email = (payment_data.email or "").strip()
    if not normalized_email:
        return None

    try:
        normalized_email = normalize_email(normalized_email, check_deliverability=True)
    except HTTPException:
        return None

    matches = (
        db.query(ReceiptRequest)
        .filter(hash_aware_match(ReceiptRequest, "email", normalized_email))
        .order_by(ReceiptRequest.created_at.desc(), ReceiptRequest.id.desc())
        .all()
    )
    if not matches:
        return None

    normalized_taxpayer_name = (payment_data.taxpayerName or "").strip().lower()
    normalized_transaction_date = (payment_data.transactionDate or "").strip()
    normalized_tax_type = (payment_data.taxType or "").strip().upper()
    normalized_branch_id = payment_data.branchId

    filtered_matches = []
    for match in matches:
        if match.fee_paid:
            continue
        if normalized_branch_id and match.branch_id != normalized_branch_id:
            continue
        if normalized_taxpayer_name and (receipt_request_value(match, "taxpayer_name") or "").strip().lower() != normalized_taxpayer_name:
            continue
        if normalized_transaction_date and (receipt_request_value(match, "transaction_date") or "").strip() != normalized_transaction_date:
            continue
        if normalized_tax_type and (receipt_request_value(match, "tax_type") or "").strip().upper() != normalized_tax_type:
            continue
        filtered_matches.append(match)

    if filtered_matches:
        return filtered_matches[0]

    return next((match for match in matches if not match.fee_paid), None)


def is_declined_receipt_payment(payment: Payment | None) -> bool:
    if not payment:
        return False
    normalized_status = (payment.status or "").strip().lower()
    normalized_paymongo_status = (payment.paymongo_status or "").strip().lower()
    return normalized_status in {"failed", "declined", "payment_rejected", "expired", "cancelled", "canceled"} or normalized_paymongo_status in {
        "failed",
        "declined",
        "expired",
        "cancelled",
        "canceled",
    }


def is_verified_receipt_payment(payment: Payment | None) -> bool:
    if not payment:
        return False
    normalized_status = (payment.status or "").strip().lower()
    normalized_paymongo_status = (payment.paymongo_status or "").strip().lower()
    return (
        normalized_status in {"verified", "payment verified", "payment_submitted", "payment_verified", "or_generated", "completed", "confirmed"}
        or normalized_paymongo_status in {"paid", "succeeded"}
        or payment.verified_at is not None
    )


def get_receipt_request_payment_status(request: ReceiptRequest, payment: Payment | None) -> str:
    if request.fee_paid or is_verified_receipt_payment(payment):
        return "Verified"
    if is_declined_receipt_payment(payment):
        return "Declined"
    return "Pending"


def has_uploaded_release_copy(request: ReceiptRequest) -> bool:
    return bool(receipt_request_value(request, "release_copy_path"))


def get_receipt_request_release_status(request: ReceiptRequest) -> str:
    current_status = receipt_request_value(request, "status")
    if current_status in {"Released", "Completed"}:
        return "Released"
    if request.fee_paid and has_uploaded_release_copy(request):
        return "Ready for Release"
    return "Not Ready for Release"


def get_receipt_request_overall_status(request: ReceiptRequest, payment: Payment | None) -> str:
    current_status = receipt_request_value(request, "status")
    if current_status in {"Released", "Completed"}:
        return current_status
    payment_status = get_receipt_request_payment_status(request, payment)
    release_status = get_receipt_request_release_status(request)
    if payment_status == "Declined":
        return "Payment Declined"
    if payment_status == "Pending":
        return "Payment Pending"
    if release_status == "Ready for Release":
        return "Ready for Release"
    return "Not Ready for Release"


def get_receipt_request_next_action(request: ReceiptRequest, payment: Payment | None) -> str:
    payment_status = get_receipt_request_payment_status(request, payment)
    release_status = get_receipt_request_release_status(request)
    if payment_status in {"Pending", "Declined"}:
        return "Pay Request Fee"
    if release_status == "Ready for Release":
        return "Wait for Branch Release"
    return "Request Receipt"


def archive_receipt_request(
    db: Session,
    receipt_request: ReceiptRequest,
    completed_by: str,
):
    existing_history = (
        db.query(ReceiptRequestHistory)
        .filter(hash_aware_match(ReceiptRequestHistory, "request_id", receipt_request_value(receipt_request, "request_id")))
        .first()
    )

    history_record = existing_history or ReceiptRequestHistory(request_id=receipt_request_value(receipt_request, "request_id"))
    history_record.branch_id = receipt_request.branch_id
    history_record.taxpayer_name = receipt_request_value(receipt_request, "taxpayer_name")
    history_record.tax_type = receipt_request_value(receipt_request, "tax_type")
    history_record.request_reason = receipt_request_value(receipt_request, "request_reason")
    history_record.request_reason_other = receipt_request_value(receipt_request, "request_reason_other")
    history_record.request_type = receipt_request_value(receipt_request, "request_type")
    history_record.transaction_date = receipt_request_value(receipt_request, "transaction_date")
    history_record.ref_number = receipt_request_value(receipt_request, "ref_number")
    history_record.email = receipt_request_value(receipt_request, "email")
    history_record.final_status = receipt_request_value(receipt_request, "status")
    history_record.fee_paid = receipt_request.fee_paid
    history_record.matched_receipt_id = receipt_request.matched_receipt_id
    history_record.linked_queue_number = receipt_request_value(receipt_request, "linked_queue_number")
    history_record.appointment_time = receipt_request.appointment_time
    history_record.payment_ref_number = receipt_request_value(receipt_request, "payment_ref_number")
    history_record.release_copy_filename = receipt_request_value(receipt_request, "release_copy_filename")
    history_record.processed_at = receipt_request.processed_at
    history_record.completed_by = completed_by
    history_record.created_at = receipt_request.created_at
    history_record.archived_at = datetime.utcnow()
    apply_receipt_request_history_security(history_record)
    db.add(history_record)
    return history_record


def normalize_receipt_category(value: str | None) -> str:
    normalized = (value or "RPT").strip().upper()
    aliases = {
        "BT": "BUSINESS",
        "BUSINESS TAX": "BUSINESS",
        "MAYOR'S PERMIT": "BUSINESS",
        "MAYORS PERMIT": "BUSINESS",
        "MISCELLANEOUS": "MISC",
    }
    resolved = aliases.get(normalized, normalized)
    if resolved not in {"RPT", "BUSINESS", "MISC"}:
        raise HTTPException(status_code=400, detail="Unsupported receipt category. Use RPT, BT/BUSINESS, or MISC.")
    return resolved


def compute_image_sha256(image_bytes: bytes) -> str:
    return hashlib.sha256(image_bytes).hexdigest()


def compute_image_ahash(image_bytes: bytes) -> str:
    with Image.open(BytesIO(image_bytes)) as image:
        grayscale = image.convert("L").resize((8, 8))
        pixels = list(grayscale.getdata())

    average = sum(pixels) / len(pixels)
    bits = "".join("1" if pixel >= average else "0" for pixel in pixels)
    return f"{int(bits, 2):016x}"


def sanitize_receipt_filename_component(value: str | None) -> str:
    normalized = re.sub(r"[\\\\/:*?\"<>|]+", " ", (value or "").strip())
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized or "receipt"


def normalize_receipt_filename_for_compare(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").strip().lower())


def build_receipt_filename(filename: str | None, taxpayer_name: str | None) -> str:
    extension = os.path.splitext(filename or "")[1].lower() or ".jpg"
    base_name = (taxpayer_name or "").strip() or "receipt"
    return f"{base_name}{extension}"


def build_receipt_filename_validation(
    *,
    filename: str | None,
    taxpayer_name: str | None,
) -> dict:
    original_filename = os.path.basename(filename or "receipt.jpg")
    suggested_filename = build_receipt_filename(original_filename, taxpayer_name)
    filename_stem = os.path.splitext(original_filename)[0]
    suggested_stem = os.path.splitext(suggested_filename)[0]
    filename_matches_taxpayer = (
        bool(taxpayer_name)
        and normalize_receipt_filename_for_compare(filename_stem) == normalize_receipt_filename_for_compare(suggested_stem)
    )
    return {
        "original_filename": original_filename,
        "suggested_filename": suggested_filename,
        "filename_matches_taxpayer": filename_matches_taxpayer,
        "message": (
            ""
            if filename_matches_taxpayer or not taxpayer_name
            else (
                f"The uploaded file name must match the taxpayer name. "
                f"Rename it to {suggested_filename} or use auto rename."
            )
        ),
    }


def rename_receipt_source_image(source_image_path: str | None, target_filename: str | None) -> str | None:
    if not source_image_path or not os.path.exists(source_image_path):
        return source_image_path

    directory, original_filename = os.path.split(source_image_path)
    extension = os.path.splitext(original_filename)[1].lower() or ".jpg"
    raw_target_filename = (target_filename or "").strip() or f"receipt{extension}"
    target_stem = os.path.splitext(raw_target_filename)[0]
    base_name = sanitize_receipt_filename_component(target_stem)
    candidate_name = f"{base_name}{extension}"
    candidate_path = os.path.join(directory, candidate_name)
    suffix = 1

    while os.path.exists(candidate_path) and os.path.abspath(candidate_path) != os.path.abspath(source_image_path):
        candidate_name = f"{base_name}_{suffix}{extension}"
        candidate_path = os.path.join(directory, candidate_name)
        suffix += 1

    if os.path.abspath(candidate_path) == os.path.abspath(source_image_path):
        return source_image_path

    os.replace(source_image_path, candidate_path)
    return candidate_path


def ensure_valid_image_upload(image_bytes: bytes):
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded image is empty")

    try:
        with Image.open(BytesIO(image_bytes)) as image:
            image.verify()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid image") from exc


def validate_receipt_document_analysis(
    *,
    raw_text: str | None,
    ref_number: str | None,
    taxpayer_name: str | None,
    transaction_date: str | None,
    amount: float | None,
):
    normalized_text = (raw_text or "").upper()
    receipt_keywords = [
        "OFFICIAL RECEIPT",
        "REPUBLIC OF THE PHILIPPINES",
        "CITY TREASURER",
        "MACHINE VALIDATION",
        "BILL NUMBER",
        "RECEIVED",
        "TOTAL",
        "AMOUNT",
        "PAYOR",
        "ACCOUNT CODE",
    ]
    matched_keywords = [keyword for keyword in receipt_keywords if keyword in normalized_text]
    populated_fields = sum(
        1 for value in [ref_number, taxpayer_name, transaction_date, amount] if value not in ("", None)
    )
    if len(matched_keywords) >= 2 or populated_fields >= 3:
        return
    raise HTTPException(
        status_code=400,
        detail=(
            "The uploaded file does not appear to be a valid receipt document. "
            "Please upload a legitimate receipt image with readable receipt details."
        ),
    )


def compare_taxpayer_names(left: str | None, right: str | None) -> bool:
    if not left or not right:
        return False
    return normalize_receipt_filename_for_compare(left) == normalize_receipt_filename_for_compare(right)


def ahash_distance(hash_a: str | None, hash_b: str | None) -> int:
    if not hash_a or not hash_b:
        return 64
    return bin(int(hash_a, 16) ^ int(hash_b, 16)).count("1")


def serialize_duplicate_record(record: ReceiptRecord | None) -> dict | None:
    if not record:
        return None
    return {
        "id": record.id,
        "ref_number": receipt_record_value(record, "ref_number"),
        "tax_type": receipt_record_value(record, "tax_type"),
        "taxpayer_name": receipt_record_value(record, "taxpayer_name"),
        "uploaded_by": record.uploaded_by,
        "created_at": record.created_at.isoformat() if record.created_at else None,
        "branch_id": record.branch_id,
    }


def find_duplicate_receipt_record(
    db: Session,
    image_sha256: str,
    image_ahash: str,
) -> tuple[ReceiptRecord | None, str | None]:
    exact_match = (
        db.query(ReceiptRecord)
        .filter(ReceiptRecord.source_image_sha256 == image_sha256)
        .order_by(ReceiptRecord.created_at.desc())
        .first()
    )
    if exact_match:
        return exact_match, "exact"

    similar_records = (
        db.query(ReceiptRecord)
        .filter(ReceiptRecord.source_image_ahash.isnot(None))
        .all()
    )
    for record in similar_records:
        if ahash_distance(record.source_image_ahash, image_ahash) <= 3:
            return record, "similar"

    return None, None


def cleanup_mobile_receipt_upload_sessions():
    now = time.time()
    expired_tokens = [
        token
        for token, session in MOBILE_RECEIPT_UPLOAD_SESSIONS.items()
        if float(session.get("expires_at") or 0) <= now
    ]
    for token in expired_tokens:
        MOBILE_RECEIPT_UPLOAD_SESSIONS.pop(token, None)


def get_mobile_receipt_upload_session(token: str) -> dict:
    cleanup_mobile_receipt_upload_sessions()
    session = MOBILE_RECEIPT_UPLOAD_SESSIONS.get(token)
    if not session:
        raise HTTPException(status_code=404, detail="Receipt upload session is invalid or has expired.")
    return session


def save_receipt_record_payload(
    *,
    db: Session,
    payload: ReceiptRecordPayload,
    branch_id: int,
    uploaded_by: str,
) -> ReceiptRecord:
    normalized_tax_type = normalize_receipt_category(payload.tax_type)
    selected_category = normalize_receipt_category(payload.selected_category or normalized_tax_type)
    detected_category = normalize_receipt_category(payload.detected_category or normalized_tax_type)

    if selected_category != normalized_tax_type:
        raise HTTPException(status_code=400, detail="The verified tax type must match the selected receipt category.")

    if detected_category != selected_category or payload.category_match is False:
        raise HTTPException(
            status_code=400,
            detail=f"Category validation failed. The uploaded receipt appears to be {detected_category}, not {selected_category}.",
        )

    duplicate_record, duplicate_type = find_duplicate_receipt_record(
        db,
        payload.source_image_sha256 or "",
        payload.source_image_ahash or "",
    )
    if duplicate_record:
        if duplicate_type == "exact":
            raise HTTPException(status_code=409, detail=f"This receipt image already exists as record #{duplicate_record.id}.")
        raise HTTPException(
            status_code=409,
            detail=f"This receipt image is too similar to existing record #{duplicate_record.id}. Please upload a different image.",
        )

    normalized_ref_number = normalize_reference_number(payload.ref_number)
    if normalized_ref_number:
        existing_reference_record = (
            db.query(ReceiptRecord)
            .filter(
                ReceiptRecord.branch_id == branch_id,
                hash_aware_match(ReceiptRecord, "ref_number", normalized_ref_number),
                hash_aware_match(ReceiptRecord, "tax_type", normalized_tax_type),
            )
            .first()
        )
        if existing_reference_record:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"A {normalized_tax_type} receipt with reference {normalized_ref_number} "
                    f"already exists as record #{existing_reference_record.id}."
                ),
            )

    validate_receipt_document_analysis(
        raw_text=payload.raw_text,
        ref_number=normalized_ref_number,
        taxpayer_name=payload.taxpayer_name,
        transaction_date=payload.transaction_date,
        amount=payload.amount,
    )

    filename_validation = build_receipt_filename_validation(
        filename=payload.source_image_original_filename or payload.source_image_suggested_filename or payload.source_image_path,
        taxpayer_name=payload.taxpayer_name,
    )
    if payload.taxpayer_name and not filename_validation["filename_matches_taxpayer"] and not payload.auto_rename_source_image:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "receipt_filename_mismatch",
                "message": filename_validation["message"],
                "extracted_taxpayer_name": payload.taxpayer_name,
                "suggested_filename": filename_validation["suggested_filename"],
                "original_filename": filename_validation["original_filename"],
            },
        )

    renamed_source_image_path = rename_receipt_source_image(
        payload.source_image_path,
        filename_validation["suggested_filename"],
    )

    record = ReceiptRecord(
        branch_id=branch_id,
        receipt_number=payload.receipt_number,
        ref_number=normalized_ref_number,
        txn_id=payload.txn_id or normalized_ref_number,
        taxpayer_name=payload.taxpayer_name,
        transaction_date=payload.transaction_date,
        amount=payload.amount,
        tax_type=normalized_tax_type,
        source_image_sha256=payload.source_image_sha256,
        source_image_ahash=payload.source_image_ahash,
        selected_category=selected_category,
        detected_category=detected_category,
        source_image_path=renamed_source_image_path,
        raw_ocr_text=payload.raw_text,
        verification_status="Verified",
        confidence=payload.confidence or 0.0,
        uploaded_by=uploaded_by,
    )
    apply_receipt_record_security(record)
    db.add(record)
    db.flush()

    linked_requests = db.query(ReceiptRequest).filter(hash_aware_match(ReceiptRequest, "ref_number", normalized_ref_number)).all()
    for request in linked_requests:
        request.matched_receipt_id = record.id
        request.branch_id = branch_id
        sync_request_status(request)

    db.add(ActivityLog(
        action="Receipt Record Saved",
        user=uploaded_by,
        details=f"Saved verified receipt record {normalized_ref_number or payload.receipt_number or record.id}",
        type="branch_receipts",
    ))
    return record


def build_receipt_ocr_result(
    *,
    db: Session,
    image_data: bytes,
    file: UploadFile,
    file_path: str,
    category: str,
    branch_id: int,
    uploaded_by: str,
    allow_exact_duplicate_match: bool = False,
) -> dict:
    normalized_category = normalize_receipt_category(category)
    image_sha256 = compute_image_sha256(image_data)
    image_ahash = compute_image_ahash(image_data)
    duplicate_record, duplicate_type = find_duplicate_receipt_record(db, image_sha256, image_ahash)

    if duplicate_type == "exact" and not allow_exact_duplicate_match:
        raise HTTPException(
            status_code=409,
            detail=(
                f"This receipt image was already uploaded by {duplicate_record.uploaded_by or 'another user'} "
                f"on record #{duplicate_record.id}."
            ),
        )

    try:
        result = ocr_service.process_receipt(
            image_path=file_path,
            filename=os.path.basename(file.filename or "receipt.jpg"),
            category=normalized_category,
        )
    except OCRProcessingError as exc:
        status_code = 504 if "timed out" in str(exc).lower() else 500
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    raw_detected_category = (result.get("detected_category") or normalized_category).strip().upper()
    if raw_detected_category == "UNKNOWN":
        raise HTTPException(
            status_code=400,
            detail=(
                "The uploaded file does not appear to be a valid receipt document. "
                "Please upload a legitimate receipt image with readable receipt details."
            ),
        )
    detected_category = normalize_receipt_category(raw_detected_category)
    category_match = result.get("category_match", True)
    if detected_category != normalized_category or category_match is False:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Receipt category validation failed. This looks like a {detected_category} receipt, "
                f"but the queue requires {normalized_category}. Please upload the correct receipt type."
            ),
        )

    duplicate_warning = ""
    save_blocked = False
    if duplicate_type == "similar" and duplicate_record:
        save_blocked = True
        duplicate_warning = (
            f"This receipt image looks very similar to existing record #{duplicate_record.id}. "
            "Please upload a different receipt image."
        )

    validate_receipt_document_analysis(
        raw_text=result.get("raw_text"),
        ref_number=result.get("ref_number"),
        taxpayer_name=result.get("taxpayer_name"),
        transaction_date=result.get("transaction_date"),
        amount=result.get("amount"),
    )

    filename_validation = build_receipt_filename_validation(
        filename=file.filename or os.path.basename(file_path),
        taxpayer_name=result.get("taxpayer_name"),
    )
    if result.get("taxpayer_name") and not filename_validation["filename_matches_taxpayer"]:
        save_blocked = True

    result["source_image_path"] = file_path
    result["source_image_sha256"] = image_sha256
    result["source_image_ahash"] = image_ahash
    result["branch_id"] = branch_id
    result["uploaded_by"] = uploaded_by
    result["category"] = normalized_category
    result["selected_category"] = normalized_category
    result["duplicate_detected"] = duplicate_record is not None
    result["duplicate_type"] = duplicate_type
    result["duplicate_record"] = serialize_duplicate_record(duplicate_record)
    result["duplicate_warning"] = duplicate_warning
    result["save_blocked"] = save_blocked
    result["source_image_original_filename"] = os.path.basename(file.filename or os.path.basename(file_path))
    result["source_image_suggested_filename"] = filename_validation["suggested_filename"]
    result["filename_matches_taxpayer"] = filename_validation["filename_matches_taxpayer"]
    result["file_name_validation_message"] = filename_validation["message"]
    result["auto_rename_source_image"] = False
    return result


async def build_receipt_ocr_result_async(**kwargs) -> dict:
    try:
        return await run_ocr_in_executor(build_receipt_ocr_result, **kwargs)
    except asyncio.TimeoutError as exc:
        raise HTTPException(
            status_code=504,
            detail="Receipt OCR timed out. Please try again with a clearer or smaller image.",
        ) from exc
    except OCRProcessingError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def is_appointment_request(request: ReceiptRequest) -> bool:
    return (receipt_request_value(request, "request_type") or "").strip().lower() == "appointment"


def normalize_request_type(value: str) -> str:
    normalized = (value or "").strip().lower()
    if normalized == "appointment":
        return "Appointment"
    return "Immediate"


def validate_receipt_appointment_datetime(
    db: Session,
    branch: Branch,
    request_type: str,
    appointment_date: str | None,
    appointment_slot: str | None,
) -> datetime | None:
    if request_type != "Appointment":
        return None

    normalized_date = (appointment_date or "").strip()
    normalized_slot = (appointment_slot or "").strip()

    if not normalized_date:
        raise HTTPException(status_code=400, detail="Please select an appointment date.")
    if not normalized_slot:
        raise HTTPException(status_code=400, detail="Please select an appointment time within the branch operating hours.")

    return validate_branch_appointment_datetime(
        db,
        branch=branch,
        raw_value=f"{normalized_date}T{normalized_slot}:00",
    )


def sync_request_status(request: ReceiptRequest):
    if receipt_request_value(request, "status") in {"Released", "Completed"}:
        return

    if request.fee_paid and has_uploaded_release_copy(request):
        request.status = "Ready for Release"
    elif request.fee_paid:
        request.status = "Pending Branch Review"
    else:
        request.status = "Payment Required"
    apply_receipt_request_security(request)


def find_open_receipt_request(db: Session, email: str) -> ReceiptRequest | None:
    candidates = (
        db.query(ReceiptRequest)
        .filter(hash_aware_match(ReceiptRequest, "email", email))
        .order_by(ReceiptRequest.created_at.desc(), ReceiptRequest.id.desc())
        .all()
    )
    for candidate in candidates:
        if receipt_request_value(candidate, "status") not in {"Released", "Completed"}:
            return candidate
    return None


def find_linked_queue_receipt_request(
    db: Session,
    linked_queue_number: str,
) -> tuple[str, str] | None:
    normalized_queue_number = (linked_queue_number or "").strip()
    if not normalized_queue_number:
        return None

    active_request = (
        db.query(ReceiptRequest)
        .filter(hash_aware_match(ReceiptRequest, "linked_queue_number", normalized_queue_number))
        .order_by(ReceiptRequest.created_at.desc(), ReceiptRequest.id.desc())
        .first()
    )
    if active_request:
        return ("active", receipt_request_value(active_request, "request_id"))

    return None


def ensure_receipt_requests_enabled(db: Session, branch_id: int | None = None):
    if get_branch_setting_value(db, "maintenanceMode", branch_id):
        raise HTTPException(status_code=503, detail="Public services are temporarily unavailable because maintenance mode is active.")
    if not get_branch_setting_value(db, "receiptRequestEnabled", branch_id):
        raise HTTPException(status_code=403, detail=SYSTEM_DISABLED_MESSAGE)


def resolve_authenticated_citizen(
    credentials: HTTPAuthorizationCredentials | None,
    db: Session,
) -> CitizenUser | None:
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


def resolve_linked_active_queue(
    db: Session,
    *,
    current_citizen: CitizenUser | None,
    linked_queue_number: str | None,
) -> Queue | None:
    normalized_queue_number = (linked_queue_number or "").strip()
    if not normalized_queue_number or not current_citizen:
        return None

    query = db.query(Queue).filter(hash_aware_any(Queue, "status", ACTIVE_QUEUE_STATUSES))
    query = query.filter(Queue.citizen_user_id == current_citizen.id)
    query = query.filter(hash_aware_match(Queue, "queue_number", normalized_queue_number))

    return query.order_by(Queue.created_at.desc(), Queue.id.desc()).first()


@router.get("/records")
async def list_receipt_records(current_staff=Depends(get_current_branch_staff), db: Session = Depends(get_db)):
    records = (
        db.query(ReceiptRecord)
        .filter(ReceiptRecord.branch_id == current_staff.branch_id)
        .order_by(ReceiptRecord.created_at.desc())
        .all()
    )
    return [serialize_receipt_record(record) for record in records]


@router.post("/records/ocr-upload")
@limiter.limit("20/hour;100/day")
async def upload_receipt_for_ocr(
    request: Request,
    file: UploadFile = File(...),
    category: str = Form("RPT"),
    current_staff=Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    normalized_category = normalize_receipt_category(category)
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    image_data = await file.read()
    ensure_valid_image_upload(image_data)

    original_name = os.path.basename(file.filename or "receipt.jpg")
    safe_name = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{original_name}"
    file_path = os.path.join(UPLOAD_DIR, safe_name)

    with open(file_path, "wb") as output_file:
        output_file.write(image_data)

    try:
        return await build_receipt_ocr_result_async(
            db=db,
            image_data=image_data,
            file=file,
            file_path=file_path,
            category=normalized_category,
            branch_id=current_staff.branch_id,
            uploaded_by=current_staff.username,
        )
    except Exception:
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except OSError:
                pass
        raise


@router.post("/records/mobile-upload-sessions")
async def create_mobile_receipt_upload_session(
    payload: MobileReceiptUploadSessionCreate,
    current_staff=Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    normalized_category = normalize_receipt_category(payload.category)
    queue = (
        db.query(Queue)
        .filter(Queue.id == payload.queue_id, Queue.branch_id == current_staff.branch_id)
        .first()
    )
    if not queue:
        raise HTTPException(status_code=404, detail="Queue record not found for mobile receipt upload.")

    token = secrets.token_urlsafe(32)
    frontend_base_url = os.getenv("FRONTEND_BASE_URL", "http://localhost:3000").rstrip("/")
    upload_url = f"{frontend_base_url}/mobile-receipt-upload/{token}"
    MOBILE_RECEIPT_UPLOAD_SESSIONS[token] = {
        "token": token,
        "queue_id": queue.id,
        "queue_number": queue_value(queue, "queue_number"),
        "branch_id": current_staff.branch_id,
        "category": normalized_category,
        "created_by": current_staff.username,
        "created_at": datetime.utcnow().isoformat(),
        "expires_at": time.time() + MOBILE_RECEIPT_UPLOAD_TTL_SECONDS,
        "status": "pending",
        "result": None,
        "error": "",
    }
    return {
        "token": token,
        "upload_url": upload_url,
        "expires_in_seconds": MOBILE_RECEIPT_UPLOAD_TTL_SECONDS,
        "status": "pending",
    }


@router.get("/records/mobile-upload-sessions/{token}")
async def get_mobile_receipt_upload_session_status(
    token: str,
    current_staff=Depends(get_current_branch_staff),
):
    session = get_mobile_receipt_upload_session(token)
    if session["branch_id"] != current_staff.branch_id:
        raise HTTPException(status_code=403, detail="This upload session belongs to another branch.")
    return {
        "token": token,
        "queue_id": session["queue_id"],
        "queue_number": session["queue_number"],
        "category": session["category"],
        "status": session["status"],
        "result": session.get("result"),
        "error": session.get("error") or "",
    }


@router.get("/records/mobile-upload-sessions/{token}/qr")
async def get_mobile_receipt_upload_qr(
    token: str,
):
    session = get_mobile_receipt_upload_session(token)
    frontend_base_url = os.getenv("FRONTEND_BASE_URL", "http://localhost:3000").rstrip("/")
    upload_url = f"{frontend_base_url}/mobile-receipt-upload/{token}"
    image = qrcode.make(upload_url)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    buffer.seek(0)
    return StreamingResponse(buffer, media_type="image/png")


@router.get("/records/mobile-upload-sessions/{token}/public")
async def get_mobile_receipt_upload_public_session(token: str):
    session = get_mobile_receipt_upload_session(token)
    return {
        "queue_number": session["queue_number"],
        "category": session["category"],
        "status": session["status"],
        "expires_at": session["expires_at"],
        "result": session.get("result"),
        "record_id": session.get("record_id"),
        "error": session.get("error") or "",
    }


@router.post("/records/mobile-upload-sessions/{token}/upload")
@limiter.limit("20/hour")
async def upload_mobile_receipt_for_ocr(
    request: Request,
    token: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    session = get_mobile_receipt_upload_session(token)
    if session.get("status") in {"processed", "saved"}:
        raise HTTPException(status_code=409, detail="A receipt has already been uploaded for this session.")

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    image_data = await file.read()
    ensure_valid_image_upload(image_data)

    original_name = os.path.basename(file.filename or "mobile-receipt.jpg")
    safe_name = f"mobile_{token[:10]}_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{original_name}"
    file_path = os.path.join(UPLOAD_DIR, safe_name)
    with open(file_path, "wb") as output_file:
        output_file.write(image_data)

    session["status"] = "processing"
    try:
        result = await build_receipt_ocr_result_async(
            db=db,
            image_data=image_data,
            file=file,
            file_path=file_path,
            category=session["category"],
            branch_id=session["branch_id"],
            uploaded_by=f"mobile:{session['created_by']}",
        )
    except HTTPException as exc:
        session["status"] = "error"
        session["error"] = exc.detail.get("message") if isinstance(exc.detail, dict) else str(exc.detail)
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except OSError:
                pass
        raise
    except Exception as exc:
        session["status"] = "error"
        session["error"] = str(exc)
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except OSError:
                pass
        raise HTTPException(status_code=500, detail="Receipt OCR processing failed.") from exc

    session["status"] = "processed"
    session["result"] = result
    session["error"] = ""
    return {
        "message": "Receipt uploaded and parsed. Please review the OCR result before saving.",
        "status": "processed",
        "category": session["category"],
        "result": result,
    }


@router.post("/records/mobile-upload-sessions/{token}/save")
async def save_mobile_receipt_record(
    token: str,
    payload: ReceiptRecordPayload,
    db: Session = Depends(get_db),
):
    session = get_mobile_receipt_upload_session(token)
    if session.get("status") not in {"processed", "saved"} or not session.get("result"):
        raise HTTPException(status_code=400, detail="Upload and parse a receipt before saving.")
    if session.get("record_id"):
        raise HTTPException(status_code=409, detail=f"This mobile receipt was already saved as record #{session['record_id']}.")

    normalized_tax_type = normalize_receipt_category(payload.tax_type)
    if normalized_tax_type != session["category"]:
        raise HTTPException(status_code=400, detail=f"This session only accepts {session['category']} receipts.")

    record = save_receipt_record_payload(
        db=db,
        payload=payload,
        branch_id=session["branch_id"],
        uploaded_by=f"mobile:{session['created_by']}",
    )
    db.commit()
    db.refresh(record)
    session["status"] = "saved"
    session["record_id"] = record.id
    session["result"] = {
        **session["result"],
        **payload.dict(),
    }
    session["error"] = ""
    return {
        "message": "Receipt saved to Receipt Management.",
        "status": "saved",
        "record": serialize_receipt_record(record),
    }


@router.post("/records")
async def save_receipt_record(
    payload: ReceiptRecordPayload,
    current_staff=Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    record = save_receipt_record_payload(
        db=db,
        payload=payload,
        branch_id=current_staff.branch_id,
        uploaded_by=current_staff.username,
    )
    db.commit()
    db.refresh(record)
    return serialize_receipt_record(record)


@router.delete("/records/{record_id}")
async def delete_receipt_record(
    record_id: int,
    current_staff=Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    record = (
        db.query(ReceiptRecord)
        .filter(
            ReceiptRecord.id == record_id,
            ReceiptRecord.branch_id == current_staff.branch_id,
        )
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Receipt record not found")

    linked_requests = db.query(ReceiptRequest).filter(ReceiptRequest.matched_receipt_id == record.id).all()
    for request in linked_requests:
        request.matched_receipt_id = None
        sync_request_status(request)

    linked_history = db.query(ReceiptRequestHistory).filter(ReceiptRequestHistory.matched_receipt_id == record.id).all()
    for history in linked_history:
        history.matched_receipt_id = None

    record_label = receipt_record_value(record, "ref_number") or receipt_record_value(record, "receipt_number") or str(record.id)
    db.delete(record)
    db.add(ActivityLog(
        action="Receipt Record Deleted",
        user=current_staff.username,
        details=f"Deleted verified receipt record {record_label}",
        type="branch_receipts",
    ))
    db.commit()
    return {"success": True, "recordId": record_id}


@router.get("/records/{record_id}/image")
async def download_receipt_record_image(
    record_id: int,
    current_staff=Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    record = (
        db.query(ReceiptRecord)
        .filter(
            ReceiptRecord.id == record_id,
            ReceiptRecord.branch_id == current_staff.branch_id,
        )
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Receipt record not found")
    source_image_path = receipt_record_value(record, "source_image_path")
    if not source_image_path or not os.path.exists(source_image_path):
        raise HTTPException(status_code=404, detail="No receipt image found for this record")

    return FileResponse(
        source_image_path,
        media_type="application/octet-stream",
        filename=os.path.basename(source_image_path),
    )


@router.get("/requests")
async def list_receipt_requests(current_staff=Depends(get_current_branch_staff), db: Session = Depends(get_db)):
    requests = (
        db.query(ReceiptRequest)
        .filter(ReceiptRequest.branch_id == current_staff.branch_id)
        .order_by(ReceiptRequest.created_at.asc())
        .all()
    )
    return [serialize_receipt_request(request, db) for request in requests]


@router.get("/requests/history")
async def list_receipt_request_history(current_staff=Depends(get_current_branch_staff), db: Session = Depends(get_db)):
    requests = (
        db.query(ReceiptRequestHistory)
        .filter(ReceiptRequestHistory.branch_id == current_staff.branch_id)
        .order_by(ReceiptRequestHistory.archived_at.asc(), ReceiptRequestHistory.created_at.asc())
        .all()
    )
    return [serialize_receipt_request_history(request, db) for request in requests]


@router.delete("/requests/history/{request_id}")
async def delete_receipt_request_history(
    request_id: str,
    current_staff=Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    receipt_request = (
        db.query(ReceiptRequestHistory)
        .filter(hash_aware_match(ReceiptRequestHistory, "request_id", request_id))
        .first()
    )
    if not receipt_request:
        raise HTTPException(status_code=404, detail="Completed receipt request not found")

    if receipt_request.branch_id and receipt_request.branch_id != current_staff.branch_id:
        raise HTTPException(status_code=403, detail="Request belongs to another branch")

    db.delete(receipt_request)
    db.add(ActivityLog(
        action="Completed Receipt Request Deleted",
        user=current_staff.username,
        details=f"Deleted completed receipt request {request_id}",
        type="branch_receipts",
    ))
    db.commit()
    return {"success": True, "requestId": request_id}


@router.delete("/requests/{request_id}")
async def delete_receipt_request(
    request_id: str,
    current_staff=Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    receipt_request = find_receipt_request_by_request_id(db, request_id)
    if not receipt_request:
        raise HTTPException(status_code=404, detail="Receipt request not found")

    if receipt_request.branch_id and receipt_request.branch_id != current_staff.branch_id:
        raise HTTPException(status_code=403, detail="Request belongs to another branch")

    linked_payments = db.query(Payment).filter(Payment.related_request_id == request_id).all()
    removed_pending_payments = 0
    preserved_terminal_payments = 0
    for payment in linked_payments:
        if is_verified_receipt_payment(payment) or is_declined_receipt_payment(payment):
            preserved_terminal_payments += 1
            continue
        db.delete(payment)
        removed_pending_payments += 1

    release_copy_path = receipt_request_value(receipt_request, "release_copy_path")
    if release_copy_path and os.path.exists(release_copy_path):
        try:
            os.remove(release_copy_path)
        except OSError:
            pass

    db.delete(receipt_request)
    db.add(ActivityLog(
        action="Receipt Request Deleted",
        user=current_staff.username,
        details=(
            f"Deleted receipt request {request_id}; "
            f"removed {removed_pending_payments} pending payment record(s) and preserved "
            f"{preserved_terminal_payments} verified/declined payment record(s)"
        ),
        type="branch_receipts",
    ))
    db.commit()
    return {"success": True, "requestId": request_id}


@router.post("/requests/{request_id}/release")
async def release_receipt_request(request_id: str, current_staff=Depends(get_current_branch_staff), db: Session = Depends(get_db)):
    receipt_request = find_receipt_request_by_request_id(db, request_id)
    if not receipt_request:
        raise HTTPException(status_code=404, detail="Receipt request not found")

    if receipt_request.branch_id and receipt_request.branch_id != current_staff.branch_id:
        raise HTTPException(status_code=403, detail="Request belongs to another branch")

    payment = get_latest_receipt_request_payment(db, receipt_request_value(receipt_request, "request_id"))
    if not receipt_request.fee_paid and not is_verified_receipt_payment(payment):
        raise HTTPException(status_code=400, detail="Receipt request fee has not been paid")

    current_release_copy_path = receipt_request_value(receipt_request, "release_copy_path")
    current_release_copy_filename = receipt_request_value(receipt_request, "release_copy_filename")
    if not current_release_copy_path or not os.path.exists(current_release_copy_path):
        raise HTTPException(status_code=400, detail="Upload the finished receipt copy first")

    receipt_request.branch_id = current_staff.branch_id
    final_status = "Completed" if is_appointment_request(receipt_request) else "Released"
    receipt_request.status = final_status
    receipt_request.processed_at = datetime.utcnow()
    apply_receipt_request_security(receipt_request)
    archive_receipt_request(db, receipt_request, current_staff.username)

    branch = db.query(Branch).filter(Branch.id == current_staff.branch_id).first()
    branch_name = branch.name if branch else f"Branch {current_staff.branch_id}"
    email_result = send_receipt_release_email(
        recipient_email=receipt_request_value(receipt_request, "email"),
        taxpayer_name=receipt_request_value(receipt_request, "taxpayer_name"),
        request_id=request_id,
        branch_name=branch_name,
        attachment_path=current_release_copy_path,
        attachment_name=current_release_copy_filename or os.path.basename(current_release_copy_path),
    )

    if not email_result["sent"]:
        raise HTTPException(
            status_code=500,
            detail=email_result["message"] or "Failed to send receipt release email.",
        )

    release_copy_path = current_release_copy_path
    request_email = receipt_request_value(receipt_request, "email")
    taxpayer_name = receipt_request_value(receipt_request, "taxpayer_name")
    db.delete(receipt_request)

    db.add(ActivityLog(
        action="Receipt Request Released" if final_status == "Released" else "Receipt Appointment Completed",
        user=current_staff.username,
        details=(
            f"Released and cleared receipt request {request_id} while preserving the linked payment history"
            if final_status == "Released"
            else f"Completed appointment receipt request {request_id} through the receipt release workflow"
        ),
        type="branch_receipts",
    ))
    db.commit()

    if release_copy_path and os.path.exists(release_copy_path):
        try:
            os.remove(release_copy_path)
        except OSError:
            pass

    return {
        "success": True,
        "requestId": request_id,
        "emailSent": True,
        "emailMessage": email_result["message"],
        "deleted": True,
        "email": request_email,
        "taxpayerName": taxpayer_name,
    }


@router.post("/requests/{request_id}/complete-appointment")
async def complete_appointment_request(request_id: str, current_staff=Depends(get_current_branch_staff), db: Session = Depends(get_db)):
    receipt_request = find_receipt_request_by_request_id(db, request_id)
    if not receipt_request:
        raise HTTPException(status_code=404, detail="Receipt request not found")
    if receipt_request.branch_id != current_staff.branch_id:
        raise HTTPException(status_code=403, detail="Request belongs to another branch")
    if not is_appointment_request(receipt_request):
        raise HTTPException(status_code=400, detail="Only appointment requests can be completed here")
    if not receipt_request.fee_paid:
        raise HTTPException(status_code=400, detail="Receipt request fee has not been paid")

    receipt_request.status = "Completed"
    receipt_request.processed_at = datetime.utcnow()
    apply_receipt_request_security(receipt_request)
    archive_receipt_request(db, receipt_request, current_staff.username)
    request_label = receipt_request_value(receipt_request, "request_id") or request_id
    db.delete(receipt_request)
    db.add(ActivityLog(
        action="Receipt Appointment Completed",
        user=current_staff.username,
        details=f"Completed appointment receipt request {request_label}",
        type="branch_receipts",
    ))
    db.commit()
    return {
        "success": True,
        "requestId": request_label,
        "message": f"Appointment request {request_label} completed successfully.",
    }


@router.post("/requests/{request_id}/upload-release-copy")
async def upload_release_copy(
    request_id: str,
    file: UploadFile = File(...),
    auto_rename: bool = Form(False),
    current_staff=Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    receipt_request = find_receipt_request_by_request_id(db, request_id)
    if not receipt_request:
        raise HTTPException(status_code=404, detail="Receipt request not found")
    if receipt_request.branch_id != current_staff.branch_id:
        raise HTTPException(status_code=403, detail="Request belongs to another branch")

    extension = os.path.splitext(file.filename or "")[1].lower()
    if extension not in ALLOWED_RELEASE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only JPG, JPEG, PNG, and WEBP files are allowed")
    if file.content_type and file.content_type.lower() not in ALLOWED_RELEASE_MIME_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported image format uploaded")

    file_bytes = await file.read()
    if len(file_bytes) > MAX_RELEASE_FILE_SIZE:
        raise HTTPException(status_code=400, detail="Image must not exceed 5 MB")
    ensure_valid_image_upload(file_bytes)

    os.makedirs(RELEASE_UPLOAD_DIR, exist_ok=True)
    safe_name = f"{request_id}_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}{extension}"
    file_path = os.path.join(RELEASE_UPLOAD_DIR, safe_name)
    with open(file_path, "wb") as output_file:
        output_file.write(file_bytes)

    expected_tax_type = normalize_receipt_category(receipt_request_value(receipt_request, "tax_type") or "RPT")
    try:
        analysis = await build_receipt_ocr_result_async(
            db=db,
            image_data=file_bytes,
            file=file,
            file_path=file_path,
            category=expected_tax_type,
            branch_id=current_staff.branch_id,
            uploaded_by=current_staff.username,
            allow_exact_duplicate_match=True,
        )
    except Exception:
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except OSError:
                pass
        raise

    expected_taxpayer_name = receipt_request_value(receipt_request, "taxpayer_name")
    extracted_taxpayer_name = (analysis.get("taxpayer_name") or "").strip() or expected_taxpayer_name
    if analysis.get("taxpayer_name") and expected_taxpayer_name and not compare_taxpayer_names(analysis.get("taxpayer_name"), expected_taxpayer_name):
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except OSError:
                pass
        raise HTTPException(
            status_code=400,
            detail=(
                f"This receipt belongs to {analysis.get('taxpayer_name')}, but the request expects "
                f"{expected_taxpayer_name}. Please upload the correct taxpayer receipt."
            ),
        )

    filename_validation = build_receipt_filename_validation(
        filename=file.filename or safe_name,
        taxpayer_name=extracted_taxpayer_name,
    )
    if extracted_taxpayer_name and not filename_validation["filename_matches_taxpayer"] and not auto_rename:
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except OSError:
                pass
        raise HTTPException(
            status_code=400,
            detail={
                "code": "receipt_filename_mismatch",
                "message": filename_validation["message"],
                "extracted_taxpayer_name": extracted_taxpayer_name,
                "suggested_filename": filename_validation["suggested_filename"],
                "original_filename": filename_validation["original_filename"],
            },
        )

    renamed_release_copy_path = rename_receipt_source_image(file_path, filename_validation["suggested_filename"])
    final_release_copy_filename = os.path.basename(renamed_release_copy_path or file_path)

    previous_release_copy_path = receipt_request_value(receipt_request, "release_copy_path")
    receipt_request.release_copy_path = renamed_release_copy_path
    receipt_request.release_copy_filename = final_release_copy_filename
    sync_request_status(receipt_request)
    apply_receipt_request_security(receipt_request)
    db.add(ActivityLog(
        action="Receipt Release Copy Uploaded",
        user=current_staff.username,
        details=f"Uploaded finished copy for {request_id}",
        type="branch_receipts",
    ))
    db.commit()

    if previous_release_copy_path and previous_release_copy_path != file_path and os.path.exists(previous_release_copy_path):
        try:
            os.remove(previous_release_copy_path)
        except OSError:
            pass

    return serialize_receipt_request(receipt_request, db)


@router.get("/requests/{request_id}/release-copy")
async def download_release_copy(
    request_id: str,
    current_staff=Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    receipt_request = find_receipt_request_by_request_id(db, request_id)
    if not receipt_request:
        raise HTTPException(status_code=404, detail="Receipt request not found")
    if receipt_request.branch_id != current_staff.branch_id:
        raise HTTPException(status_code=403, detail="Request belongs to another branch")
    release_copy_path = receipt_request_value(receipt_request, "release_copy_path")
    release_copy_filename = receipt_request_value(receipt_request, "release_copy_filename")
    if not release_copy_path or not os.path.exists(release_copy_path):
        raise HTTPException(status_code=404, detail="No uploaded release copy found")

    return FileResponse(
        release_copy_path,
        media_type=mimetypes.guess_type(release_copy_filename or release_copy_path)[0] or "application/octet-stream",
        filename=release_copy_filename or os.path.basename(release_copy_path),
    )


@router.post("/request")
@limiter.limit("5/hour")
async def create_receipt_request(
    request: Request,
    receipt_req: PublicReceiptRequestCreate,
    db: Session = Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(optional_user_security),
):
    taxpayer_name = validate_taxpayer_name(receipt_req.taxpayerName)
    transaction_date = validate_transaction_date((receipt_req.txnDate or "").strip())
    normalized_email = normalize_email(receipt_req.email, check_deliverability=True)
    normalized_ref_number = normalize_reference_number(receipt_req.refNumber)
    request_reason, request_reason_other = validate_receipt_request_reason(receipt_req.requestReason, receipt_req.requestReasonOther)
    _ = resolve_authenticated_citizen(credentials, db)
    tax_type = normalize_receipt_category(receipt_req.taxType)
    branch_id = receipt_req.branchId
    ensure_receipt_requests_enabled(db, branch_id)
    branch = db.query(Branch).filter(Branch.id == branch_id, Branch.status == "Active").first()
    if not branch:
        raise HTTPException(status_code=404, detail="Selected branch not found")
    request_id = unique_receipt_request_id()
    matched_receipt = find_matching_receipt(db, branch_id, normalized_ref_number, taxpayer_name, transaction_date, tax_type)

    receipt_request = ReceiptRequest(
        request_id=request_id,
        taxpayer_name=taxpayer_name,
        tax_type=tax_type,
        request_reason=request_reason,
        request_reason_other=request_reason_other,
        transaction_date=transaction_date,
        ref_number=normalized_ref_number,
        email=normalized_email,
        fee_paid=False,
        branch_id=branch_id,
        matched_receipt_id=matched_receipt.id if matched_receipt else None,
    )
    sync_request_status(receipt_request)
    apply_receipt_request_security(receipt_request)
    db.add(receipt_request)
    db.add(ActivityLog(
        action="Receipt Request Created",
        user=normalized_email,
        details=f"Created receipt request {request_id}",
        type="public_receipts",
    ))
    db.commit()

    return serialize_receipt_request(receipt_request, db) | {"fee": RECEIPT_REQUEST_FEE}


@router.get("/request/{request_id}")
async def get_request_status(request_id: str, db: Session = Depends(get_db)):
    normalized_request_id = (request_id or "").strip()
    receipt_request = db.query(ReceiptRequest).filter(ReceiptRequest.request_id == normalized_request_id).first()
    if not receipt_request:
        receipt_request = db.query(ReceiptRequest).filter(ReceiptRequest.request_id_hash == hash_optional_value(normalized_request_id)).first()
    if not receipt_request:
        receipt_request = db.query(ReceiptRequest).filter(hash_aware_match(ReceiptRequest, "request_id", normalized_request_id)).first()
    if not receipt_request:
        raise HTTPException(status_code=404, detail="Request not found")
    ensure_receipt_requests_enabled(db, receipt_request.branch_id)
    return serialize_receipt_request(receipt_request, db) | {"fee": RECEIPT_REQUEST_FEE}


@router.post("/request/{request_id}/pay")
async def pay_request_fee(
    request_id: str,
    payment_data: ReceiptFeePaymentRequest,
    db: Session = Depends(get_db),
):
    receipt_request = resolve_receipt_request_for_payment(db, request_id, payment_data)
    if not receipt_request:
        raise HTTPException(status_code=404, detail="Request not found")
    ensure_receipt_requests_enabled(db, receipt_request.branch_id)
    resolved_request_id = receipt_request_value(receipt_request, "request_id")
    normalized_payment_method = normalize_receipt_payment_method(payment_data.paymentMethod)

    existing_payment = db.query(Payment).filter(Payment.related_request_id == resolved_request_id).order_by(Payment.created_at.desc()).first()
    if existing_payment and (existing_payment.status or "").lower() in {"pending", "pending over-the-counter payment", "verified", "payment verified"}:
        previous_method = get_decrypted_or_raw(existing_payment, "payment_method") or existing_payment.payment_method
        if previous_method != normalized_payment_method:
            clear_receipt_payment_checkout_fields(existing_payment)
        existing_payment.payment_method = normalized_payment_method
        apply_payment_security(existing_payment)
        db.commit()
        return {
            "requestId": resolved_request_id,
            "paymentRefNumber": get_decrypted_or_raw(existing_payment, "ref_number") or existing_payment.ref_number,
            "txnId": get_decrypted_or_raw(existing_payment, "txn_id") or existing_payment.txn_id,
            "amount": float(existing_payment.amount or 0),
            "status": existing_payment.status,
            "paymentMethod": normalized_payment_method,
        }

    branch_name = "Unassigned"
    if receipt_request.branch_id:
        branch = db.query(Branch).filter(Branch.id == receipt_request.branch_id).first()
        if branch:
            branch_name = branch.name

    payment_ref, txn_id = unique_receipt_payment_refs()
    payment = Payment(
        ref_number=payment_ref,
        txn_id=txn_id,
        taxpayer_name=receipt_request_value(receipt_request, "taxpayer_name"),
        tin="",
        tax_type="Receipt Request Fee",
        amount=RECEIPT_REQUEST_FEE,
        payment_method=normalized_payment_method,
        branch_id=receipt_request.branch_id,
        branch=branch_name,
        email=receipt_request_value(receipt_request, "email"),
        status="Pending",
        source_module="receipt_request",
        related_request_id=resolved_request_id,
    )
    receipt_request.payment_ref_number = payment_ref
    apply_receipt_request_security(receipt_request)
    apply_payment_security(payment)
    db.add(payment)
    db.add(ActivityLog(
        action="Receipt Request Fee Initiated",
        user=receipt_request_value(receipt_request, "email"),
        details=f"Payment {payment_ref} initiated for receipt request {resolved_request_id} via {normalized_payment_method}",
        type="public_receipts",
    ))
    db.commit()

    return {
        "requestId": resolved_request_id,
        "paymentRefNumber": payment_ref,
        "txnId": txn_id,
        "amount": RECEIPT_REQUEST_FEE,
        "status": "Pending",
        "paymentMethod": normalized_payment_method,
        "placeholderGateway": "PayMongo Placeholder",
    }


@router.post("/upload-proof")
async def upload_proof(file: UploadFile = File(...)):
    return {"message": "Proof uploaded successfully", "filename": file.filename}
