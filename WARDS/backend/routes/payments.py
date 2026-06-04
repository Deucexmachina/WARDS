from datetime import datetime, timedelta, timezone
from io import BytesIO
import json
import random
import os
import re
from pathlib import Path
from textwrap import wrap
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import or_

from database.models import (
    ActivityLog,
    Branch,
    BusinessRegistry,
    BusinessTaxApplication,
    CitizenUser,
    CollectionAccount,
    Payment,
    ReceiptRequest,
    Remittance,
    RemittanceItem,
    TaxAssessmentRecord,
    get_db,
)
from middleware.admin_auth import require_main_admin
from middleware.user_auth import get_current_user
from services.email_service import send_payment_receipt_email
from services.paymongo import paymongo_service
from utils.branch_system_settings import get_branch_setting_value
from utils.field_crypto import apply_citizen_user_security, apply_payment_security, apply_receipt_request_security, build_redacted_text, find_payment_by_field, find_payment_by_ref_number, get_decrypted_or_raw, hash_aware_match, hash_optional_value, receipt_request_value, set_encrypted_hash_companions, tax_assessment_value
from utils.security_validation import format_tin, normalize_email, normalize_identity_name, normalize_tin, ensure_tin_is_unique
from utils.system_settings import SYSTEM_DISABLED_MESSAGE, get_setting_value

router = APIRouter()
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "output" / "payments"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
MAX_RPT_SEARCHES_PER_DAY = 50
MAX_PROOF_FILE_SIZE_BYTES = 5 * 1024 * 1024
MAX_BUSINESS_DOC_FILE_SIZE_BYTES = 10 * 1024 * 1024
MAX_BT_SEARCHES_PER_DAY = 50
RPT_TDN_PATTERN = re.compile(r"^[A-Z0-9-]{6,30}$")
BT_PERMIT_PATTERN = re.compile(r"^[A-Z0-9-]{6,30}$")
BT_REGISTRATION_PATTERN = re.compile(r"^[A-Z0-9-]{6,40}$")
RPT_NOT_FOUND_MESSAGE = "Tax Declaration Number not found. Please contact the Treasurer's Office. rptpayment@quezoncity.gov.ph."
BT_NOT_FOUND_MESSAGE = "Business registry record not found. Please verify the Mayor's Permit Number and SEC/DTI/CDA Number, or contact the Treasurer's Office."
RPT_FINAL_SUCCESS_STATUSES = {"PAYMENT_VERIFIED", "OR_GENERATED", "COMPLETED"}
RPT_FAILED_STATUSES = {"PAYMENT_REJECTED"}
RPT_PENDING_STATUSES = {
    "PROPERTY_SEARCHED",
    "PROPERTY_FOUND",
    "ADDED_TO_CART",
    "PAYMENT_INITIATED",
    "PAYMENT_SUBMITTED",
    "PENDING_TREASURY_VALIDATION",
    "CLARIFICATION_REQUESTED",
}
RPT_BLOCKING_PAYMENT_STATUSES = {
    "PAYMENT_INITIATED",
    "PAYMENT_SUBMITTED",
    "PENDING_TREASURY_VALIDATION",
    "CLARIFICATION_REQUESTED",
}
BT_BLOCKING_PAYMENT_STATUSES = {
    "PAYMENT_INITIATED",
    "PAYMENT_SUBMITTED",
    "PENDING_TREASURY_VALIDATION",
    "RETURNED_FOR_CORRECTION",
    "VALIDATED",
    "DOCUMENTS_UPLOADED",
}
BT_ALLOWED_UPLOAD_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".docx"}

SIMULATED_RPT_PROPERTIES = {
    "Galas Branch": {
        "RPT-GAL-2026-0001": {
            "taxpayer_name": "Justin Paolo M. Cortez",
            "property_address": "18 Sampaguita St., Galas, Quezon City",
            "fair_market_value": 1250000.0,
            "assessment_level": 0.2,
            "months_late": 2,
            "discount_rate": 0.0,
        },
        "RPT-GAL-2026-0002": {
            "taxpayer_name": "Justin Paolo M. Cortez",
            "property_address": "41 Maayos St., Galas, Quezon City",
            "fair_market_value": 2180000.0,
            "assessment_level": 0.2,
            "months_late": 0,
            "discount_rate": 0.1,
        },
    },
    "District 1 Branch": {
        "RPT-D1-2026-0001": {
            "taxpayer_name": "Maria Lourdes Santos",
            "property_address": "72 Sto. Domingo Ave., District 1, Quezon City",
            "fair_market_value": 1625000.0,
            "assessment_level": 0.2,
            "months_late": 1,
            "discount_rate": 0.05,
        },
    },
    "Novaliches Branch": {
        "RPT-NOV-2026-0001": {
            "taxpayer_name": "Ramon Dela Cruz",
            "property_address": "104 Quirino Highway, Novaliches, Quezon City",
            "fair_market_value": 2860000.0,
            "assessment_level": 0.2,
            "months_late": 3,
            "discount_rate": 0.0,
        },
    },
}
SIMULATED_RPT_BRANCH_ALIASES = {
    "galas": "Galas Branch",
    "galas - unang hakbang street": "Galas Branch",
    "galas branch": "Galas Branch",
    "district 1": "District 1 Branch",
    "district 1 - west avenue": "District 1 Branch",
    "district 1 branch": "District 1 Branch",
    "novaliches": "Novaliches Branch",
    "novaliches - quirino highway": "Novaliches Branch",
    "novaliches branch": "Novaliches Branch",
}
SIMULATED_BT_BRANCH_ALIASES = {
    "galas branch": "Galas",
    "galas": "Galas",
    "district 1 branch": "District 1",
    "district 1": "District 1",
    "novaliches branch": "Novaliches",
    "novaliches": "Novaliches",
}


class PaymentReferenceRequest(BaseModel):
    taxType: str
    taxpayerName: str
    tin: str
    refNumber: str | None = None
    email: str | None = None
    contactNumber: str
    amount: float
    branch: str
    paymentMethod: str
    bankCode: str | None = None


class PaymentProcessRequest(BaseModel):
    refNumber: str
    paymentMethod: str | None = None
    bankCode: str | None = None


class PayMongoWebhookPayload(BaseModel):
    data: dict


class RemittanceReviewPayload(BaseModel):
    remarks: str | None = None


class RptCartItem(BaseModel):
    tdn: str
    taxpayer_name: str
    property_address: str
    fair_market_value: float
    assessment_level: float
    assessed_value: float
    basic_tax_due: float
    sef_tax: float
    penalties: float
    discounts: float
    final_total_amount_due: float
    payment_option: str | None = None
    bill_coverage: str | None = None
    original_total_amount_due: float | None = None


class RptPaymentReferenceRequest(BaseModel):
    taxpayerName: str
    tin: str
    email: str | None = None
    contactNumber: str
    branchId: int
    paymentMethod: str
    bankCode: str | None = None
    cartItems: list[RptCartItem] = Field(default_factory=list)


class BusinessTaxValidationRequest(BaseModel):
    mayorPermitNumber: str
    secDtiCdaNumber: str


class BusinessTaxApplicationSearchQuery(BaseModel):
    searchField: str = "tracking_mp_no"
    searchTerm: str = ""
    applicationStatus: str = "ALL"


class BusinessTaxPaymentReferenceRequest(BaseModel):
    trackingNumber: str
    taxpayerName: str
    tin: str
    email: str | None = None
    contactNumber: str
    paymentMethod: str
    bankCode: str | None = None


class BusinessTaxCorrectionPayload(BaseModel):
    remarks: str = Field(default="Please review the submitted Business Tax documents and payment details.")


PUBLIC_PAYMENT_METHOD_CONFIG = {
    "gcash": {
        "stored_value": "gcash",
        "checkout_methods": ["gcash"],
    },
    "maya": {
        "stored_value": "maya",
        "checkout_methods": ["paymaya"],
    },
    "paymaya": {
        "stored_value": "maya",
        "checkout_methods": ["paymaya"],
    },
    "card": {
        "stored_value": "card",
        "checkout_methods": ["card"],
    },
    "banking": {
        "stored_value": "banking",
        "checkout_methods": ["card"],
    },
    "online_banking": {
        "stored_value": "banking",
        "checkout_methods": ["card"],
    },
    "grabpay": {
        "stored_value": "grabpay",
        "checkout_methods": ["grab_pay"],
    },
    "grab_pay": {
        "stored_value": "grabpay",
        "checkout_methods": ["grab_pay"],
    },
}
PH_MOBILE_PATTERN = re.compile(r"^(?:\+63|63|0)9\d{9}$")


def citizen_email(user: CitizenUser) -> str | None:
    return get_decrypted_or_raw(user, "email") or user.email


def citizen_name(user: CitizenUser) -> str | None:
    return get_decrypted_or_raw(user, "full_name") or user.full_name


def citizen_tin(user: CitizenUser) -> str | None:
    return get_decrypted_or_raw(user, "tin") or user.tin


def payment_value(payment: Payment, field_name: str):
    return get_decrypted_or_raw(payment, field_name)


def resolve_payment_branch_name(payment: Payment) -> str | None:
    branch = getattr(payment, "branch_record", None)
    if branch:
        branch_name = get_decrypted_or_raw(branch, "name") or branch.name
        if branch_name:
            return branch_name
    branch_name = payment_value(payment, "branch")
    if branch_name and branch_name.strip().upper() != "BRANCH_NAME":
        return branch_name
    metadata = parse_payment_metadata(payment)
    selected_branch_name = (metadata.get("selected_branch_name") or "").strip()
    if selected_branch_name and selected_branch_name.upper() != "BRANCH_NAME":
        return selected_branch_name
    return None


def to_utc_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat()


def serialize_payment(payment: Payment):
    metadata = parse_payment_metadata(payment)
    return {
        "id": payment.id,
        "ref_number": payment_value(payment, "ref_number"),
        "transaction_id": payment_value(payment, "txn_id"),
        "taxpayer_name": payment_value(payment, "taxpayer_name"),
        "tin": format_tin(payment_value(payment, "tin")),
        "email": payment_value(payment, "email"),
        "contact_number": payment_value(payment, "contact_number"),
        "property_ref_number": payment_value(payment, "property_ref_number"),
        "tax_type": payment_value(payment, "tax_type"),
        "amount": float(payment.amount or 0),
        "payment_method": payment_value(payment, "payment_method"),
        "status": normalize_payment_status(payment.status),
        "workflow_status": payment.status,
        "branch": resolve_payment_branch_name(payment) or payment_value(payment, "branch"),
        "branch_id": payment.branch_id,
        "branch_name": resolve_payment_branch_name(payment),
        "source_module": payment.source_module or "tax_payment",
        "related_request_id": payment.related_request_id,
        "paymongo_checkout_session_id": payment_value(payment, "paymongo_checkout_session_id"),
        "paymongo_source_id": payment_value(payment, "paymongo_source_id"),
        "paymongo_payment_id": payment_value(payment, "paymongo_payment_id"),
        "paymongo_checkout_url": payment_value(payment, "paymongo_checkout_url"),
        "paymongo_status": payment_value(payment, "paymongo_status"),
        "failure_reason": get_failure_reason_message(payment),
        "metadata": metadata,
        "proof_file_name": payment_value(payment, "proof_file_name"),
        "proof_uploaded_at": to_utc_iso(payment.proof_uploaded_at),
        "has_payment_proof": bool(payment_value(payment, "proof_file_path")),
        "proof_download_url": f"/api/payments/{payment.id}/proof" if payment_value(payment, "proof_file_path") else None,
        "treasury_remarks": payment_value(payment, "treasury_remarks"),
        "treasury_updated_at": to_utc_iso(payment.treasury_updated_at),
        "official_receipt_number": payment_value(payment, "official_receipt_number"),
        "official_receipt_generated_at": to_utc_iso(payment.official_receipt_generated_at),
        "official_receipt_download_url": f"/api/payments/{payment.id}/official-receipt" if payment_value(payment, "official_receipt_path") else None,
        "release_method": payment_value(payment, "release_method"),
        "release_details": parse_json_text(payment.release_details_json),
        "created_at": to_utc_iso(payment.created_at),
        "verified_at": to_utc_iso(payment.verified_at),
        "payment_expiry": to_utc_iso(payment.payment_expiry),
        "receipt_sent_at": to_utc_iso(payment.receipt_sent_at),
    }


def get_or_create_main_collection_account(db: Session) -> CollectionAccount:
    account = (
        db.query(CollectionAccount)
        .filter(CollectionAccount.owner_type == "main", CollectionAccount.branch_id.is_(None))
        .first()
    )
    if account:
        return account
    account = CollectionAccount(
        owner_type="main",
        branch_id=None,
        account_name="Main Collection Account",
    )
    db.add(account)
    db.flush()
    return account


def serialize_remittance(remittance: Remittance) -> dict:
    branch = remittance.branch
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
        "report_download_url": f"/api/payments/remittances/{remittance.id}/report" if remittance.report_file_path else None,
        "submitted_by": remittance.submitted_by,
        "reviewed_by": remittance.reviewed_by,
        "submitted_at": to_utc_iso(remittance.submitted_at),
        "reviewed_at": to_utc_iso(remittance.reviewed_at),
        "items": [
            {
                "id": item.id,
                "payment_id": item.payment_id,
                "amount": float(item.amount or 0),
                "ref_number": payment_value(item.payment, "ref_number") if item.payment else None,
                "taxpayer_name": payment_value(item.payment, "taxpayer_name") if item.payment else None,
                "tax_type": payment_value(item.payment, "tax_type") if item.payment else None,
            }
            for item in items
        ],
    }


def parse_json_text(value: str | None, fallback=None):
    if not value:
        return [] if fallback is None else fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return [] if fallback is None else fallback


def parse_payment_metadata(payment: Payment) -> dict:
    parsed = parse_json_text(payment.metadata_json, fallback={})
    return parsed if isinstance(parsed, dict) else {}


def set_payment_metadata(payment: Payment, payload: dict):
    payment.metadata_json = json.dumps(payload)


def parse_application_metadata(application: BusinessTaxApplication) -> dict:
    parsed = parse_json_text(application.metadata_json, fallback={})
    return parsed if isinstance(parsed, dict) else {}


def set_application_metadata(application: BusinessTaxApplication, payload: dict):
    application.metadata_json = json.dumps(payload)


def get_rpt_assessment_for_user(
    db: Session,
    current_user: CitizenUser,
    branch_id: int,
    tdn: str,
) -> TaxAssessmentRecord | None:
    return (
        db.query(TaxAssessmentRecord)
        .filter(
            TaxAssessmentRecord.citizen_user_id == current_user.id,
            hash_aware_match(TaxAssessmentRecord, "tax_type", "RPT"),
            hash_aware_match(TaxAssessmentRecord, "tdn", tdn),
            hash_aware_match(TaxAssessmentRecord, "assessment_status", "Active"),
            hash_aware_match(TaxAssessmentRecord, "verification_status", "Verified"),
            TaxAssessmentRecord.visible_to_taxpayer.is_(True),
            or_(TaxAssessmentRecord.branch_id == branch_id, TaxAssessmentRecord.branch_id.is_(None)),
        )
        .order_by(TaxAssessmentRecord.updated_at.desc(), TaxAssessmentRecord.created_at.desc())
        .first()
    )


def serialize_rpt_assessment_property(assessment: TaxAssessmentRecord) -> dict:
    return {
        "tdn": tax_assessment_value(assessment, "tdn"),
        "taxpayer_name": tax_assessment_value(assessment, "taxpayer_name"),
        "property_address": tax_assessment_value(assessment, "property_address") or "",
        "fair_market_value": float(assessment.fair_market_value or 0),
        "assessment_level": float(assessment.assessment_level or 0),
        "assessed_value": float(assessment.assessed_value or 0),
        "basic_tax_due": float(assessment.basic_tax_due or 0),
        "sef_tax": float(assessment.sef_tax or 0),
        "penalties": float(assessment.penalties or 0),
        "discounts": float(assessment.discounts or 0),
        "final_total_amount_due": float(assessment.final_total_amount_due or assessment.amount_due or 0),
        "type": tax_assessment_value(assessment, "property_type") or "Property",
    }


def get_bt_assessment_for_user(
    db: Session,
    current_user: CitizenUser,
    mayor_permit_number: str,
    sec_dti_cda_number: str,
) -> TaxAssessmentRecord | None:
    return (
        db.query(TaxAssessmentRecord)
        .filter(
            TaxAssessmentRecord.citizen_user_id == current_user.id,
            hash_aware_match(TaxAssessmentRecord, "tax_type", "BT"),
            hash_aware_match(TaxAssessmentRecord, "mayor_permit_number", mayor_permit_number),
            hash_aware_match(TaxAssessmentRecord, "sec_dti_cda_number", sec_dti_cda_number),
            hash_aware_match(TaxAssessmentRecord, "assessment_status", "Active"),
            TaxAssessmentRecord.visible_to_taxpayer.is_(True),
        )
        .order_by(TaxAssessmentRecord.updated_at.desc(), TaxAssessmentRecord.created_at.desc())
        .first()
    )


def upsert_business_registry_from_assessment(db: Session, assessment: TaxAssessmentRecord) -> BusinessRegistry:
    assessment_permit = tax_assessment_value(assessment, "mayor_permit_number")
    assessment_registration = tax_assessment_value(assessment, "sec_dti_cda_number")
    assessment_business_name = tax_assessment_value(assessment, "business_name")
    assessment_taxpayer_name = tax_assessment_value(assessment, "taxpayer_name")
    assessment_business_type = tax_assessment_value(assessment, "business_type")
    assessment_verification_status = tax_assessment_value(assessment, "verification_status")
    registry = db.query(BusinessRegistry).filter(
        hash_aware_match(BusinessRegistry, "mayor_permit_number", assessment_permit)
    ).first()
    if not registry:
        registry = BusinessRegistry(
            business_name=assessment_business_name or assessment_taxpayer_name,
            owner_name=assessment_taxpayer_name,
            mayor_permit_number=assessment_permit,
            sec_dti_cda_number=assessment_registration,
        )
        db.add(registry)
        db.flush()

    registry.business_name = assessment_business_name or assessment_taxpayer_name
    registry.owner_name = assessment_taxpayer_name
    registry.business_type = assessment_business_type
    registry.branch_id = assessment.branch_id
    registry.branch_assigned = (get_decrypted_or_raw(assessment.branch, "name") or assessment.branch.name) if assessment.branch else registry.branch_assigned
    registry.annual_gross_sales = float(assessment.annual_gross_sales or 0)
    registry.assessed_tax_due = float(assessment.amount_due or 0)
    registry.business_status = "ACTIVE" if assessment_verification_status == "Verified" else assessment_verification_status.upper().replace(" ", "_")
    apply_business_registry_security_fields(registry)
    return registry


def normalize_bt_mayor_permit(value: str) -> str:
    normalized = (value or "").strip().upper()
    if not normalized:
        raise HTTPException(status_code=400, detail="Mayor's Permit Number is required.")
    if not BT_PERMIT_PATTERN.fullmatch(normalized):
        raise HTTPException(status_code=400, detail="Invalid Mayor's Permit Number format.")
    return normalized


def normalize_bt_registration_number(value: str) -> str:
    normalized = (value or "").strip().upper()
    if not normalized:
        raise HTTPException(status_code=400, detail="SEC/DTI/CDA Number is required.")
    if not BT_REGISTRATION_PATTERN.fullmatch(normalized):
        raise HTTPException(status_code=400, detail="Invalid SEC/DTI/CDA Number format.")
    return normalized


def get_bt_search_usage(db: Session, user: CitizenUser) -> int:
    start, end = get_today_search_window()
    return (
        db.query(ActivityLog)
        .filter(
            ActivityLog.user == (user.email or user.full_name),
            ActivityLog.action == "Business Registry Search",
            ActivityLog.created_at >= start,
            ActivityLog.created_at < end,
        )
        .count()
    )


def build_bt_tracking_number(db: Session, branch: Branch | None) -> str:
    branch_code = "GEN"
    branch_name = (get_decrypted_or_raw(branch, "name") or branch.name) if branch else None
    if branch_name:
        branch_code = "".join(ch for ch in branch_name.upper() if ch.isalpha())[:3] or "GEN"
    year = datetime.utcnow().strftime("%Y")
    count = db.query(BusinessTaxApplication).count() + 1
    return f"BT-{branch_code}-{year}-{count:06d}"


def build_bt_payment_reference(db: Session, branch: Branch | None) -> str:
    branch_code = "GEN"
    branch_name = (get_decrypted_or_raw(branch, "name") or branch.name) if branch else None
    if branch_name:
        branch_code = "".join(ch for ch in branch_name.upper() if ch.isalpha())[:3] or "GEN"
    year = datetime.utcnow().strftime("%Y")
    while True:
        candidate = f"BT-{branch_code}-{year}-{random.randint(1, 999999):06d}"
        if not find_payment_by_ref_number(db, Payment, candidate):
            return candidate


def build_bt_official_receipt_number(db: Session) -> str:
    year = datetime.utcnow().strftime("%Y")
    count = (
        db.query(BusinessTaxApplication)
        .filter(BusinessTaxApplication.official_receipt_number.isnot(None))
        .count()
        + 1
    )
    return f"OR-BT-{year}-{count:06d}"


def get_business_registry_record(
    db: Session,
    mayor_permit_number: str,
    sec_dti_cda_number: str,
) -> BusinessRegistry | None:
    normalized_permit = normalize_bt_mayor_permit(mayor_permit_number)
    normalized_registration = normalize_bt_registration_number(sec_dti_cda_number)
    permit_hash = hash_optional_value(normalized_permit)
    registration_hash = hash_optional_value(normalized_registration)
    return (
        db.query(BusinessRegistry)
        .filter(
            or_(
                BusinessRegistry.mayor_permit_number == normalized_permit,
                BusinessRegistry.mayor_permit_number_hash == permit_hash,
            ),
            or_(
                BusinessRegistry.sec_dti_cda_number == normalized_registration,
                BusinessRegistry.sec_dti_cda_number_hash == registration_hash,
            ),
        )
        .first()
    )


def get_business_registry_by_permit(db: Session, mayor_permit_number: str) -> BusinessRegistry | None:
    normalized_permit = normalize_bt_mayor_permit(mayor_permit_number)
    permit_hash = hash_optional_value(normalized_permit)
    return (
        db.query(BusinessRegistry)
        .filter(
            or_(
                BusinessRegistry.mayor_permit_number == normalized_permit,
                BusinessRegistry.mayor_permit_number_hash == permit_hash,
            )
        )
        .first()
    )


def get_business_registry_by_registration(db: Session, sec_dti_cda_number: str) -> BusinessRegistry | None:
    normalized_registration = normalize_bt_registration_number(sec_dti_cda_number)
    registration_hash = hash_optional_value(normalized_registration)
    return (
        db.query(BusinessRegistry)
        .filter(
            or_(
                BusinessRegistry.sec_dti_cda_number == normalized_registration,
                BusinessRegistry.sec_dti_cda_number_hash == registration_hash,
            )
        )
        .first()
    )


def serialize_business_registry_record(record: BusinessRegistry):
    return {
        "id": record.id,
        "business_name": get_decrypted_or_raw(record, "business_name") or record.business_name,
        "owner_name": get_decrypted_or_raw(record, "owner_name") or record.owner_name,
        "mayor_permit_number": get_decrypted_or_raw(record, "mayor_permit_number") or record.mayor_permit_number,
        "sec_dti_cda_number": get_decrypted_or_raw(record, "sec_dti_cda_number") or record.sec_dti_cda_number,
        "business_type": get_decrypted_or_raw(record, "business_type") or record.business_type,
        "branch_id": record.branch_id,
        "branch_assigned": get_decrypted_or_raw(record, "branch_assigned") or record.branch_assigned,
        "business_status": record.business_status,
        "annual_gross_sales": float(record.annual_gross_sales or 0),
        "assessed_tax_due": float(record.assessed_tax_due or 0),
        "created_at": to_utc_iso(record.created_at),
    }


def apply_business_registry_security_fields(record: BusinessRegistry) -> BusinessRegistry:
    business_name = get_decrypted_or_raw(record, "business_name") or record.business_name
    owner_name = get_decrypted_or_raw(record, "owner_name") or record.owner_name
    permit_number = get_decrypted_or_raw(record, "mayor_permit_number") or record.mayor_permit_number
    registration_number = get_decrypted_or_raw(record, "sec_dti_cda_number") or record.sec_dti_cda_number
    business_type = get_decrypted_or_raw(record, "business_type") or record.business_type
    branch_assigned = get_decrypted_or_raw(record, "branch_assigned") or record.branch_assigned
    tin_value = get_decrypted_or_raw(record, "tin") or record.tin
    set_encrypted_hash_companions(record, "business_name", business_name)
    set_encrypted_hash_companions(record, "owner_name", owner_name)
    set_encrypted_hash_companions(record, "mayor_permit_number", permit_number)
    set_encrypted_hash_companions(record, "sec_dti_cda_number", registration_number)
    set_encrypted_hash_companions(record, "business_type", business_type)
    set_encrypted_hash_companions(record, "branch_assigned", branch_assigned)
    set_encrypted_hash_companions(record, "tin", tin_value)
    record.business_name = build_redacted_text("BUSINESS_NAME", business_name, 255)
    record.owner_name = build_redacted_text("BUSINESS_OWNER", owner_name, 255)
    record.mayor_permit_number = build_redacted_text("MAYOR_PERMIT", permit_number, 255)
    record.sec_dti_cda_number = build_redacted_text("REGISTRATION", registration_number, 255)
    record.business_type = build_redacted_text("BUSINESS_TYPE", business_type, 255)
    record.branch_assigned = build_redacted_text("BRANCH_ASSIGNMENT", branch_assigned, 255)
    record.tin = build_redacted_text("BUSINESS_TIN", tin_value, 255)
    return record


def apply_business_tax_application_security_fields(application: BusinessTaxApplication) -> BusinessTaxApplication:
    taxpayer_name = get_decrypted_or_raw(application, "taxpayer_name") or application.taxpayer_name
    taxpayer_email = get_decrypted_or_raw(application, "taxpayer_email") or application.taxpayer_email
    tin_value = get_decrypted_or_raw(application, "tin") or application.tin
    branch_name = get_decrypted_or_raw(application, "branch_name") or application.branch_name
    permit_number = get_decrypted_or_raw(application, "mayor_permit_number") or application.mayor_permit_number
    registration_number = get_decrypted_or_raw(application, "sec_dti_cda_number") or application.sec_dti_cda_number
    business_name = get_decrypted_or_raw(application, "business_name") or application.business_name
    owner_name = get_decrypted_or_raw(application, "owner_name") or application.owner_name
    business_type = get_decrypted_or_raw(application, "business_type") or application.business_type
    payment_ref_number = get_decrypted_or_raw(application, "payment_ref_number") or application.payment_ref_number
    verifier_remarks = get_decrypted_or_raw(application, "verifier_remarks") or application.verifier_remarks
    official_receipt_number = get_decrypted_or_raw(application, "official_receipt_number") or application.official_receipt_number
    set_encrypted_hash_companions(application, "taxpayer_name", taxpayer_name)
    set_encrypted_hash_companions(application, "taxpayer_email", taxpayer_email)
    set_encrypted_hash_companions(application, "tin", tin_value)
    set_encrypted_hash_companions(application, "branch_name", branch_name)
    set_encrypted_hash_companions(application, "mayor_permit_number", permit_number)
    set_encrypted_hash_companions(application, "sec_dti_cda_number", registration_number)
    set_encrypted_hash_companions(application, "business_name", business_name)
    set_encrypted_hash_companions(application, "owner_name", owner_name)
    set_encrypted_hash_companions(application, "business_type", business_type)
    set_encrypted_hash_companions(application, "payment_ref_number", payment_ref_number)
    set_encrypted_hash_companions(application, "verifier_remarks", verifier_remarks)
    set_encrypted_hash_companions(application, "official_receipt_number", official_receipt_number)
    application.taxpayer_name = build_redacted_text("BT_TAXPAYER", taxpayer_name, 255)
    application.taxpayer_email = build_redacted_text("BT_EMAIL", taxpayer_email, 255)
    application.tin = build_redacted_text("BT_TIN", tin_value, 255)
    application.branch_name = build_redacted_text("BT_BRANCH", branch_name, 255)
    application.mayor_permit_number = build_redacted_text("BT_PERMIT", permit_number, 255)
    application.sec_dti_cda_number = build_redacted_text("BT_REGISTRATION", registration_number, 255)
    application.business_name = build_redacted_text("BT_BUSINESS", business_name, 255)
    application.owner_name = build_redacted_text("BT_OWNER", owner_name, 255)
    application.business_type = build_redacted_text("BT_TYPE", business_type, 255)
    application.payment_ref_number = build_redacted_text("BT_PAYMENT_REF", payment_ref_number, 255)
    application.verifier_remarks = build_redacted_text("BT_REMARKS", verifier_remarks, 255)
    application.official_receipt_number = build_redacted_text("BT_OR", official_receipt_number, 255)
    return application


def serialize_business_tax_application(application: BusinessTaxApplication):
    metadata = parse_application_metadata(application)
    return {
        "id": application.id,
        "tracking_number": application.tracking_number,
        "taxpayer_name": get_decrypted_or_raw(application, "taxpayer_name") or application.taxpayer_name,
        "taxpayer_email": get_decrypted_or_raw(application, "taxpayer_email") or application.taxpayer_email,
        "tin": format_tin(get_decrypted_or_raw(application, "tin") or application.tin),
        "business_name": get_decrypted_or_raw(application, "business_name") or application.business_name,
        "owner_name": get_decrypted_or_raw(application, "owner_name") or application.owner_name,
        "mayor_permit_number": get_decrypted_or_raw(application, "mayor_permit_number") or application.mayor_permit_number,
        "sec_dti_cda_number": get_decrypted_or_raw(application, "sec_dti_cda_number") or application.sec_dti_cda_number,
        "business_type": get_decrypted_or_raw(application, "business_type") or application.business_type,
        "business_status": application.business_status,
        "application_status": application.application_status,
        "amount_due": float(application.amount_due or 0),
        "payment_status": application.payment_status,
        "payment_ref_number": get_decrypted_or_raw(application, "payment_ref_number") or application.payment_ref_number,
        "branch_id": application.branch_id,
        "branch_name": get_decrypted_or_raw(application, "branch_name") or application.branch_name,
        "official_receipt_number": get_decrypted_or_raw(application, "official_receipt_number") or application.official_receipt_number,
        "official_receipt_generated_at": to_utc_iso(application.official_receipt_generated_at),
        "official_receipt_download_url": f"/api/payments/bt/applications/{application.tracking_number}/official-receipt" if application.official_receipt_path else None,
        "sales_declaration_name": application.sales_declaration_name,
        "sales_declaration_download_url": f"/api/payments/bt/applications/{application.tracking_number}/files/sales-declaration" if application.sales_declaration_path else None,
        "financial_statements_name": application.financial_statements_name,
        "financial_statements_download_url": f"/api/payments/bt/applications/{application.tracking_number}/files/financial-statements" if application.financial_statements_path else None,
        "supporting_documents_name": application.supporting_documents_name,
        "supporting_documents_download_url": f"/api/payments/bt/applications/{application.tracking_number}/files/supporting-documents" if application.supporting_documents_path else None,
        "proof_of_payment_name": application.proof_of_payment_name,
        "proof_of_payment_download_url": f"/api/payments/bt/applications/{application.tracking_number}/files/proof-of-payment" if application.proof_of_payment_path else None,
        "verifier_remarks": get_decrypted_or_raw(application, "verifier_remarks") or application.verifier_remarks,
        "verified_at": to_utc_iso(application.verified_at),
        "verified_by": application.verified_by,
        "uploaded_at": to_utc_iso(application.uploaded_at),
        "created_at": to_utc_iso(application.created_at),
        "updated_at": to_utc_iso(application.updated_at),
        "metadata": metadata,
    }


def ensure_bt_registry_record_is_active(record: BusinessRegistry):
    normalized_status = (record.business_status or "").strip().upper()
    if normalized_status not in {"ACTIVE"}:
        raise HTTPException(
            status_code=403,
            detail=f"Business registry record is {normalized_status.lower()}. Only active businesses may proceed with online assessment.",
        )


def get_or_create_business_tax_application(
    db: Session,
    current_user: CitizenUser,
    registry_record: BusinessRegistry,
) -> BusinessTaxApplication:
    existing = (
        db.query(BusinessTaxApplication)
        .filter(
            BusinessTaxApplication.citizen_user_id == current_user.id,
            BusinessTaxApplication.business_registry_id == registry_record.id,
        )
        .order_by(BusinessTaxApplication.created_at.desc())
        .first()
    )
    if existing:
        resolved_branch = resolve_business_tax_branch(
            db,
            (get_decrypted_or_raw(existing, "branch_name") or existing.branch_name or get_decrypted_or_raw(registry_record, "branch_assigned") or registry_record.branch_assigned),
            existing.branch_id or registry_record.branch_id,
        )
        if resolved_branch and existing.branch_id != resolved_branch.id:
            existing.branch_id = resolved_branch.id
            existing.branch_name = get_decrypted_or_raw(resolved_branch, "name") or resolved_branch.name
            apply_business_tax_application_security_fields(existing)
            db.flush()
        return existing

    branch = registry_record.branch or resolve_business_tax_branch(
        db,
        get_decrypted_or_raw(registry_record, "branch_assigned") or registry_record.branch_assigned,
        registry_record.branch_id,
    )
    if branch and registry_record.branch_id != branch.id:
        registry_record.branch_id = branch.id
        registry_record.branch_assigned = get_decrypted_or_raw(branch, "name") or branch.name
        apply_business_registry_security_fields(registry_record)
    tracking_number = build_bt_tracking_number(db, branch)
    application = BusinessTaxApplication(
        tracking_number=tracking_number,
        citizen_user_id=current_user.id,
        taxpayer_name=citizen_name(current_user),
        taxpayer_email=citizen_email(current_user),
        tin=citizen_tin(current_user),
        business_registry_id=registry_record.id,
        branch_id=branch.id if branch else registry_record.branch_id,
        branch_name=(get_decrypted_or_raw(branch, "name") or branch.name) if branch else (get_decrypted_or_raw(registry_record, "branch_assigned") or registry_record.branch_assigned),
        mayor_permit_number=get_decrypted_or_raw(registry_record, "mayor_permit_number") or registry_record.mayor_permit_number,
        sec_dti_cda_number=get_decrypted_or_raw(registry_record, "sec_dti_cda_number") or registry_record.sec_dti_cda_number,
        business_name=get_decrypted_or_raw(registry_record, "business_name") or registry_record.business_name,
        owner_name=get_decrypted_or_raw(registry_record, "owner_name") or registry_record.owner_name,
        business_type=get_decrypted_or_raw(registry_record, "business_type") or registry_record.business_type,
        business_status=registry_record.business_status,
        application_status="VALIDATED",
        amount_due=float(registry_record.assessed_tax_due or 0),
        payment_status="Pending",
    )
    set_application_metadata(application, {
        "validation_timestamp": datetime.utcnow().isoformat(),
        "branch_assigned": (get_decrypted_or_raw(branch, "name") or branch.name) if branch else (get_decrypted_or_raw(registry_record, "branch_assigned") or registry_record.branch_assigned),
        "annual_gross_sales": float(registry_record.annual_gross_sales or 0),
    })
    apply_business_tax_application_security_fields(application)
    db.add(application)
    db.flush()
    return application


def get_business_tax_application_for_user(
    db: Session,
    tracking_number: str,
    current_user: CitizenUser,
) -> BusinessTaxApplication:
    application = (
        db.query(BusinessTaxApplication)
        .filter(
            BusinessTaxApplication.tracking_number == tracking_number,
            BusinessTaxApplication.citizen_user_id == current_user.id,
        )
        .first()
    )
    if not application:
        raise HTTPException(status_code=404, detail="Business Tax application not found.")
    return application


def get_active_bt_payment_for_user(db: Session, current_user: CitizenUser) -> Payment | None:
    query = db.query(Payment).filter(
        Payment.source_module == "business_tax_online_payment",
        Payment.status.in_(tuple(BT_BLOCKING_PAYMENT_STATUSES)),
    )
    if citizen_email(current_user):
        query = query.filter(
            or_(
                Payment.email == citizen_email(current_user),
                Payment.email_hash == hash_optional_value(citizen_email(current_user)),
            )
        )
    else:
        query = query.filter(
            or_(
                Payment.taxpayer_name == citizen_name(current_user),
                Payment.taxpayer_name_hash == hash_optional_value(citizen_name(current_user)),
                Payment.tin == citizen_tin(current_user),
                Payment.tin_hash == hash_optional_value(citizen_tin(current_user)),
            )
        )
    return query.order_by(Payment.created_at.desc()).first()


def update_bt_application_payment_state(
    db: Session,
    payment: Payment,
    *,
    application_status: str | None = None,
    payment_status: str | None = None,
    verifier_name: str | None = None,
    remarks: str | None = None,
):
    if payment.source_module != "business_tax_online_payment" or not payment.related_request_id:
        return
    application = db.query(BusinessTaxApplication).filter(
        BusinessTaxApplication.tracking_number == payment.related_request_id
    ).first()
    if not application:
        return

    if payment_status:
        application.payment_status = payment_status
    if application_status:
        application.application_status = application_status
    if verifier_name:
        application.verified_by = verifier_name
    if remarks:
        application.verifier_remarks = remarks
    if application_status in {"PAYMENT_SUBMITTED", "PENDING_TREASURY_VALIDATION"}:
        application.uploaded_at = application.uploaded_at or datetime.utcnow()
    if application_status in {"VERIFIED", "OR_GENERATED"}:
        application.verified_at = datetime.utcnow()
    apply_business_tax_application_security_fields(application)


def store_business_tax_upload(
    file_bytes: bytes,
    filename: str,
    tracking_number: str,
    suffix_label: str,
) -> Path:
    extension = Path(filename or "").suffix.lower()
    if extension not in BT_ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Allowed file types are PDF, JPG, PNG, and DOCX only.")
    if len(file_bytes) > MAX_BUSINESS_DOC_FILE_SIZE_BYTES:
        raise HTTPException(status_code=400, detail="Maximum file size is 10MB.")
    business_output_dir = OUTPUT_DIR / "business-tax"
    business_output_dir.mkdir(parents=True, exist_ok=True)
    safe_tracking = re.sub(r"[^A-Z0-9-]+", "-", tracking_number.upper())
    output_path = business_output_dir / f"{safe_tracking}-{suffix_label}{extension}"
    output_path.write_bytes(file_bytes)
    return output_path


def normalize_rpt_tdn(value: str) -> str:
    normalized = (value or "").strip().upper()
    if not normalized:
        raise HTTPException(status_code=400, detail="Tax Declaration Number is required.")
    if not RPT_TDN_PATTERN.fullmatch(normalized):
        raise HTTPException(status_code=400, detail="Invalid Tax Declaration Number format.")
    return normalized


def get_today_search_window() -> tuple[datetime, datetime]:
    now = datetime.utcnow()
    start = datetime(now.year, now.month, now.day)
    return start, start + timedelta(days=1)


def get_rpt_search_usage(db: Session, user: CitizenUser) -> int:
    start, end = get_today_search_window()
    return (
        db.query(ActivityLog)
        .filter(
            ActivityLog.user == (user.email or user.full_name),
            ActivityLog.action == "RPT Property Search",
            ActivityLog.created_at >= start,
            ActivityLog.created_at < end,
        )
        .count()
    )


def compute_rpt_breakdown(tdn: str, property_record: dict) -> dict:
    fair_market_value = float(property_record["fair_market_value"])
    assessment_level = float(property_record["assessment_level"])
    assessed_value = round(fair_market_value * assessment_level, 2)
    basic_tax_due = round(assessed_value * 0.02, 2)
    sef_tax = round(assessed_value * 0.01, 2)
    penalties = round((basic_tax_due + sef_tax) * 0.02 * float(property_record.get("months_late", 0)), 2)
    discounts = round(basic_tax_due * float(property_record.get("discount_rate", 0)), 2)
    final_total = round(basic_tax_due + sef_tax + penalties - discounts, 2)
    return {
        "tdn": tdn,
        "taxpayer_name": property_record["taxpayer_name"],
        "property_address": property_record["property_address"],
        "fair_market_value": fair_market_value,
        "assessment_level": assessment_level,
        "assessed_value": assessed_value,
        "basic_tax_due": basic_tax_due,
        "sef_tax": sef_tax,
        "penalties": penalties,
        "discounts": discounts,
        "final_total_amount_due": final_total,
    }


def normalize_rpt_payment_option(value: str | None) -> str:
    normalized = (value or "full").strip().lower()
    if normalized not in {"full", "quarterly"}:
        raise HTTPException(status_code=400, detail="Unsupported RPT payment option selected.")
    return normalized


def compute_rpt_amount_for_option(computed: dict, payment_option: str) -> tuple[float, str]:
    normalized_option = normalize_rpt_payment_option(payment_option)
    if normalized_option == "quarterly":
        quarterly_base = round((float(computed["basic_tax_due"]) + float(computed["sef_tax"])) / 4, 2)
        total_amount = round(quarterly_base + float(computed["penalties"]) - float(computed["discounts"]), 2)
        return max(total_amount, 0.0), "Current Quarter"
    return round(float(computed["final_total_amount_due"]), 2), "Full Year"


def resolve_rpt_branch_key(branch: Branch) -> str:
    branch_name = get_decrypted_or_raw(branch, "name") or branch.name
    branch_location = get_decrypted_or_raw(branch, "location") or branch.location
    normalized = (branch_name or "").strip().lower()
    direct_match = next(
        (key for key in SIMULATED_RPT_PROPERTIES.keys() if key.strip().lower() == normalized),
        None,
    )
    if direct_match:
        return direct_match
    alias = SIMULATED_RPT_BRANCH_ALIASES.get(normalized)
    if alias:
        return alias
    location = (branch_location or "").strip().lower()
    combined = f"{normalized} {location}".strip()
    if "galas" in combined:
        return "Galas Branch"
    if "district 1" in combined:
        return "District 1 Branch"
    if "novaliches" in combined:
        return "Novaliches Branch"
    return branch_name


def get_active_rpt_payment_for_user(db: Session, current_user: CitizenUser) -> Payment | None:
    query = db.query(Payment).filter(
        Payment.source_module == "rpt_online_payment",
        Payment.status.in_(tuple(RPT_BLOCKING_PAYMENT_STATUSES)),
    )

    if citizen_email(current_user):
        query = query.filter(
            or_(
                Payment.email == citizen_email(current_user),
                Payment.email_hash == hash_optional_value(citizen_email(current_user)),
            )
        )
    else:
        query = query.filter(
            or_(
                Payment.taxpayer_name == citizen_name(current_user),
                Payment.taxpayer_name_hash == hash_optional_value(citizen_name(current_user)),
                Payment.tin == citizen_tin(current_user),
                Payment.tin_hash == hash_optional_value(citizen_tin(current_user)),
            )
        )

    return query.order_by(Payment.created_at.desc()).first()


def is_rpt_tdn_settled(db: Session, branch_id: int, tdn: str) -> bool:
    settled_payments = (
        db.query(Payment)
        .filter(
            Payment.source_module == "rpt_online_payment",
            Payment.branch_id == branch_id,
            Payment.status.in_(tuple(RPT_FINAL_SUCCESS_STATUSES)),
        )
        .all()
    )

    normalized_tdn = normalize_rpt_tdn(tdn)
    for payment in settled_payments:
        metadata = parse_payment_metadata(payment)
        cart_items = metadata.get("cart_items") if isinstance(metadata.get("cart_items"), list) else []
        if any(normalize_rpt_tdn(item.get("tdn", "")) == normalized_tdn for item in cart_items if item.get("tdn")):
            return True
    return False


def map_workflow_status_to_serialized(status_value: str | None) -> str:
    normalized = (status_value or "").strip().upper()
    if normalized in RPT_FINAL_SUCCESS_STATUSES:
        return "confirmed"
    if normalized in RPT_FAILED_STATUSES:
        return "failed"
    if normalized in RPT_PENDING_STATUSES:
        return "pending"
    return ""


def mark_payment_submitted(payment: Payment):
    payment.paymongo_status = "paid"
    payment.verified_at = payment.verified_at or datetime.utcnow()
    if payment.source_module in {"rpt_online_payment", "business_tax_online_payment"}:
        payment.status = "PAYMENT_SUBMITTED"
        metadata = parse_payment_metadata(payment)
        metadata["payment_timestamp"] = payment.verified_at.isoformat()
        metadata["awaiting_treasury_validation"] = True
        set_payment_metadata(payment, metadata)
    else:
        payment.status = "Verified"
    apply_payment_security(payment)


def normalize_public_payment_method(payment_method: str | None) -> str:
    normalized = (payment_method or "").strip().lower().replace(" ", "_")
    payment_method_config = PUBLIC_PAYMENT_METHOD_CONFIG.get(normalized)
    if not payment_method_config:
        raise HTTPException(status_code=400, detail="Unsupported payment method selected")
    return payment_method_config["stored_value"]


def resolve_checkout_payment_methods(payment_method: str | None) -> list[str]:
    normalized = (payment_method or "").strip().lower().replace(" ", "_")
    payment_method_config = PUBLIC_PAYMENT_METHOD_CONFIG.get(normalized)
    if not payment_method_config:
        raise HTTPException(status_code=400, detail="Unsupported payment method selected")
    return payment_method_config["checkout_methods"]


def build_unique_payment_reference(db: Session) -> str:
    while True:
        ref_number = f"TXN-{random.randint(100000, 999999)}"
        if not find_payment_by_ref_number(db, Payment, ref_number):
            return ref_number


def normalize_contact_number(value: str | None) -> str:
    normalized = re.sub(r"[\s()-]", "", (value or "").strip())
    if not normalized:
        raise HTTPException(status_code=400, detail="Mobile number is required")
    if not PH_MOBILE_PATTERN.match(normalized):
        raise HTTPException(
            status_code=400,
            detail="Please enter a valid Philippine mobile number (e.g. 09XXXXXXXXX)",
        )
    return normalized


def normalize_optional_payment_email(value: str | None) -> str | None:
    normalized = (value or "").strip()
    if not normalized:
        return None
    return normalize_email(normalized, check_deliverability=True)


def resolve_branch(db: Session, branch_name: str | None) -> Branch | None:
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
        if (get_decrypted_or_raw(branch, "name") or branch.name) == normalized:
            return branch
    return None


def query_payments_for_branch_name(db: Session, branch_name: str | None):
    normalized = (branch_name or "").strip()
    query = db.query(Payment)
    if not normalized:
        return query
    target_hash = hash_optional_value(normalized)
    return query.filter(
        or_(
            Payment.branch == normalized,
            Payment.branch_hash == target_hash,
        )
    )


def resolve_business_tax_branch(db: Session, branch_name: str | None, branch_id: int | None = None) -> Branch | None:
    if branch_id:
        branch = db.query(Branch).filter(Branch.id == branch_id).first()
        if branch:
            return branch

    normalized = (branch_name or "").strip()
    if not normalized:
        return None

    direct_match = resolve_branch(db, normalized)
    if direct_match:
        return direct_match

    lowered = normalized.lower()
    alias_name = SIMULATED_BT_BRANCH_ALIASES.get(lowered)
    if alias_name:
        alias_match = resolve_branch(db, alias_name)
        if alias_match:
            return alias_match

    compact_normalized = re.sub(r"[^a-z0-9]+", "", lowered)
    for branch in db.query(Branch).all():
        compact_branch_name = re.sub(r"[^a-z0-9]+", "", ((get_decrypted_or_raw(branch, "name") or branch.name) or "").lower())
        if compact_branch_name == compact_normalized:
            return branch
        if compact_branch_name and compact_branch_name in compact_normalized:
            return branch
        if compact_normalized and compact_normalized in compact_branch_name:
            return branch

    return None


def format_currency(amount: float | int | None) -> str:
    return f"PHP {float(amount or 0):,.2f}"


def escape_pdf_text(value: str) -> str:
    return str(value or "").replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def format_receipt_timestamp(value: datetime | None) -> str:
    if not value:
        return "Pending"
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    local_value = value.astimezone(timezone(timedelta(hours=8)))
    return local_value.strftime("%B %d, %Y %I:%M %p PHT")


def build_payment_confirmation_pdf(payment: Payment) -> bytes:
    metadata = parse_payment_metadata(payment)
    cart_items = metadata.get("cart_items") if isinstance(metadata.get("cart_items"), list) else []
    page_width = 612
    page_height = 792
    margin_x = 44
    content_width = page_width - (margin_x * 2)
    commands: list[str] = []
    current_y = 0

    def add_text(
        x: float,
        y: float,
        text: str,
        font: str = "F1",
        size: int = 10,
        rgb: tuple[float, float, float] = (0, 0, 0),
    ):
        commands.append(
            f"BT /{font} {size} Tf {rgb[0]:.3f} {rgb[1]:.3f} {rgb[2]:.3f} rg 1 0 0 1 {x:.2f} {y:.2f} Tm ({escape_pdf_text(text)}) Tj ET"
        )

    def add_rect(
        x: float,
        y: float,
        width: float,
        height: float,
        fill_rgb: tuple[float, float, float] | None = None,
        stroke_rgb: tuple[float, float, float] | None = None,
        line_width: float = 1,
    ):
        parts = ["q"]
        if line_width:
            parts.append(f"{line_width:.2f} w")
        if fill_rgb:
            parts.append(f"{fill_rgb[0]:.3f} {fill_rgb[1]:.3f} {fill_rgb[2]:.3f} rg")
        if stroke_rgb:
            parts.append(f"{stroke_rgb[0]:.3f} {stroke_rgb[1]:.3f} {stroke_rgb[2]:.3f} RG")
        parts.append(f"{x:.2f} {y:.2f} {width:.2f} {height:.2f} re")
        if fill_rgb and stroke_rgb:
            parts.append("B")
        elif fill_rgb:
            parts.append("f")
        else:
            parts.append("S")
        parts.append("Q")
        commands.append(" ".join(parts))

    def add_line(
        x1: float,
        y1: float,
        x2: float,
        y2: float,
        rgb: tuple[float, float, float] = (0.86, 0.90, 0.96),
        line_width: float = 1,
    ):
        commands.append(
            f"q {line_width:.2f} w {rgb[0]:.3f} {rgb[1]:.3f} {rgb[2]:.3f} RG {x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S Q"
        )

    def add_wrapped_text(
        x: float,
        y: float,
        text: str,
        width: int,
        font: str = "F1",
        size: int = 10,
        rgb: tuple[float, float, float] = (0, 0, 0),
        line_gap: int = 13,
    ) -> float:
        lines = wrap(text, width=width) or [""]
        cursor_y = y
        for line in lines:
            add_text(x, cursor_y, line, font, size, rgb)
            cursor_y -= line_gap
        return cursor_y

    def add_detail_row(y: float, label_left: str, value_left: str, label_right: str, value_right: str):
        left_x = margin_x + 18
        right_x = margin_x + 275
        add_text(left_x, y, label_left.upper(), "F2", 8, (0.43, 0.50, 0.62))
        add_text(left_x, y - 16, value_left, "F2", 10, (0.11, 0.16, 0.24))
        add_text(right_x, y, label_right.upper(), "F2", 8, (0.43, 0.50, 0.62))
        add_text(right_x, y - 16, value_right, "F2", 10, (0.11, 0.16, 0.24))

    add_rect(0, 0, page_width, page_height, fill_rgb=(1, 1, 1))
    add_rect(margin_x, 675, content_width, 88, fill_rgb=(0.07, 0.20, 0.39))
    add_rect(margin_x, 640, content_width, 35, fill_rgb=(0.10, 0.34, 0.58))
    add_rect(margin_x, 54, content_width, 708, stroke_rgb=(0.83, 0.88, 0.94), line_width=1.1)

    add_text(margin_x + 20, 736, "CITY TREASURER'S OFFICE", "F2", 9, (0.84, 0.91, 0.98))
    add_text(margin_x + 20, 708, "OFFICIAL E-RECEIPT SUMMARY", "F2", 24, (1, 1, 1))
    add_text(
        margin_x + 20,
        653,
        "This document confirms your PayMongo payment and may be submitted to the branch treasury office for validation.",
        "F1",
        10,
        (0.92, 0.97, 1.0),
    )

    stage_text = (payment.status or "PAYMENT SUBMITTED").replace("_", " ").upper()
    badge_width = max(118, 8.5 * len(stage_text))
    badge_x = margin_x + content_width - badge_width - 20
    add_rect(badge_x, 698, badge_width, 26, fill_rgb=(0.82, 0.94, 0.86))
    add_text(badge_x + 16, 707, stage_text, "F2", 10, (0.07, 0.44, 0.22))

    add_rect(margin_x + 18, 572, content_width - 36, 58, fill_rgb=(0.95, 0.98, 1.0), stroke_rgb=(0.82, 0.88, 0.95))
    add_text(margin_x + 34, 606, "PAYMENT SUBMITTED", "F2", 12, (0.07, 0.20, 0.39))
    add_text(
        margin_x + 34,
        586,
        f"Reference {payment.ref_number or 'N/A'} has been recorded and is waiting for branch treasury validation.",
        "F1",
        10,
        (0.26, 0.33, 0.43),
    )

    add_rect(margin_x + 18, 332, content_width - 36, 224, stroke_rgb=(0.83, 0.88, 0.94))
    add_text(margin_x + 32, 535, "TRANSACTION DETAILS", "F2", 13, (0.07, 0.20, 0.39))
    add_line(margin_x + 32, 526, margin_x + content_width - 32, 526)

    detail_rows = [
        ("Reference Number", payment.ref_number or "N/A", "Transaction Number", payment.txn_id or "N/A"),
        ("Taxpayer Name", payment.taxpayer_name or "N/A", "Tax Type", payment.tax_type or "N/A"),
        ("Amount Paid", format_currency(payment.amount), "Payment Method", (payment.payment_method or "N/A").upper()),
        ("Branch", payment.branch or "N/A", "Payment Timestamp", format_receipt_timestamp(payment.verified_at or payment.created_at)),
        ("Receipt Email", payment.email or "N/A", "Current Stage", stage_text.title()),
    ]
    detail_y = 500
    for row in detail_rows:
        add_detail_row(detail_y, *row)
        add_line(margin_x + 32, detail_y - 28, margin_x + content_width - 32, detail_y - 28, (0.90, 0.93, 0.97), 0.8)
        detail_y -= 42

    cart_box_y = 156
    cart_box_height = 154
    add_rect(margin_x + 18, cart_box_y, content_width - 36, cart_box_height, stroke_rgb=(0.83, 0.88, 0.94))
    add_text(
        margin_x + 32,
        cart_box_y + cart_box_height - 22,
        "RPT PAYMENT ITEMS" if cart_items else "PAYMENT NOTES",
        "F2",
        13,
        (0.07, 0.20, 0.39),
    )

    items_y = cart_box_y + cart_box_height - 48
    if cart_items:
        for index, item in enumerate(cart_items[:3], start=1):
            payment_mode = item.get("payment_option", "full")
            payment_mode = payment_mode[:1].upper() + payment_mode[1:] if payment_mode else "Full"
            bill_coverage = item.get("bill_coverage", "Full Year")
            add_text(margin_x + 32, items_y, f"Item {index}", "F2", 9, (0.43, 0.50, 0.62))
            add_text(margin_x + 80, items_y, item.get("tdn", "N/A"), "F2", 11, (0.11, 0.16, 0.24))
            add_text(margin_x + content_width - 150, items_y, format_currency(item.get("final_total_amount_due", 0)), "F2", 11, (0.07, 0.20, 0.39))
            items_y = add_wrapped_text(
                margin_x + 80,
                items_y - 16,
                item.get("property_address", "N/A"),
                56,
                "F1",
                9,
                (0.35, 0.42, 0.51),
                11,
            )
            add_text(
                margin_x + 80,
                items_y - 2,
                f"Payment Mode: {payment_mode} | Bill Coverage: {bill_coverage}",
                "F1",
                9,
                (0.35, 0.42, 0.51),
            )
            items_y -= 16
            if index < min(len(cart_items), 3):
                add_line(margin_x + 32, items_y, margin_x + content_width - 32, items_y, (0.92, 0.94, 0.97), 0.8)
                items_y -= 16
        if len(cart_items) > 3:
            add_text(margin_x + 32, cart_box_y + 18, f"Additional items: {len(cart_items) - 3}", "F1", 9, (0.55, 0.61, 0.70))
    else:
        notes = [
            f"Payment type: {payment.tax_type or 'N/A'}",
            f"Processed through: {(payment.payment_method or 'N/A').upper()}",
            "This document serves as a clean payment summary while branch validation is in progress.",
        ]
        line_y = items_y
        for note in notes:
            line_y = add_wrapped_text(margin_x + 32, line_y, note, 64, "F1", 10, (0.35, 0.42, 0.51), 13) - 6

    total_box_width = 168
    total_box_height = 72
    total_box_x = margin_x + content_width - total_box_width
    total_box_y = 74
    add_rect(total_box_x, total_box_y, total_box_width, total_box_height, fill_rgb=(0.07, 0.20, 0.39))
    add_text(total_box_x + 18, total_box_y + 50, "TOTAL AMOUNT PAID", "F2", 9, (0.84, 0.91, 0.98))
    add_text(total_box_x + 18, total_box_y + 20, format_currency(payment.amount), "F2", 18, (1, 1, 1))

    add_rect(margin_x + 18, 72, content_width - total_box_width - 46, 74, fill_rgb=(0.98, 0.98, 0.96), stroke_rgb=(0.91, 0.88, 0.72))
    add_text(margin_x + 32, 124, "TREASURY VALIDATION NOTE", "F2", 10, (0.46, 0.34, 0.07))
    add_wrapped_text(
        margin_x + 32,
        105,
        "This payment confirmation is not yet the final Official Receipt. Final receipt issuance remains under the authority of the selected branch treasury office.",
        56,
        "F1",
        9,
        (0.38, 0.32, 0.18),
        11,
    )

    add_text(page_width - 145, 28, f"Generated {format_receipt_timestamp(datetime.utcnow())}", "F1", 8, (0.55, 0.61, 0.70))

    content_stream = "\n".join(commands).encode("utf-8")
    objects: list[bytes] = []
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objects.append(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    objects.append(
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {page_width} {page_height}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>".encode("utf-8")
    )
    objects.append(
        b"<< /Length "
        + str(len(content_stream)).encode("utf-8")
        + b" >>\nstream\n"
        + content_stream
        + b"\nendstream"
    )
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")

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


def build_business_tax_official_receipt_pdf(payment: Payment, application: BusinessTaxApplication) -> bytes:
    details = [
        f"Official Receipt Number: {get_decrypted_or_raw(application, 'official_receipt_number') or application.official_receipt_number or payment.official_receipt_number or 'Pending'}",
        f"Reference Number: {payment.ref_number or 'N/A'}",
        f"Transaction Number: {payment.txn_id or 'N/A'}",
        f"Taxpayer Name: {get_decrypted_or_raw(application, 'taxpayer_name') or application.taxpayer_name or payment.taxpayer_name or 'N/A'}",
        f"Business Name: {get_decrypted_or_raw(application, 'business_name') or application.business_name or 'N/A'}",
        f"Mayor's Permit Number: {get_decrypted_or_raw(application, 'mayor_permit_number') or application.mayor_permit_number or 'N/A'}",
        f"SEC/DTI/CDA Number: {get_decrypted_or_raw(application, 'sec_dti_cda_number') or application.sec_dti_cda_number or 'N/A'}",
        f"Tax Type: {payment.tax_type or 'Business Tax'}",
        f"Branch: {get_decrypted_or_raw(application, 'branch_name') or application.branch_name or payment.branch or 'N/A'}",
        f"Payment Method: {(payment.payment_method or 'N/A').upper()}",
        f"Amount Paid: {format_currency(payment.amount)}",
        f"Verified At: {format_receipt_timestamp(payment.verified_at)}",
        f"Verifier: {application.verified_by or 'Branch Treasury Personnel'}",
        f"QR / Verification Reference: {payment.ref_number or 'N/A'}",
    ]

    content_lines = [
        "BT /F2 22 Tf 0.07 0.20 0.39 rg 1 0 0 1 72 748 Tm (CITY TREASURER'S OFFICE) Tj ET",
        "BT /F2 18 Tf 0.12 0.29 0.55 rg 1 0 0 1 72 720 Tm (BUSINESS TAX OFFICIAL RECEIPT) Tj ET",
        "BT /F1 11 Tf 0.25 0.33 0.43 rg 1 0 0 1 72 694 Tm (This receipt was generated after branch verification of the submitted Business Tax payment.) Tj ET",
    ]

    y = 652
    for line in details:
        content_lines.append(
            f"BT /F1 11 Tf 0.11 0.16 0.24 rg 1 0 0 1 72 {y} Tm ({escape_pdf_text(line)}) Tj ET"
        )
        y -= 28

    content_lines.extend([
        "BT /F1 10 Tf 0.35 0.42 0.51 rg 1 0 0 1 72 190 Tm (This Business Tax Official Receipt is generated for capstone simulation purposes within WARDS.) Tj ET",
        f"BT /F1 10 Tf 0.35 0.42 0.51 rg 1 0 0 1 72 166 Tm ({escape_pdf_text(f'Generated {format_receipt_timestamp(datetime.utcnow())}')}) Tj ET",
    ])

    content_stream = "\n".join(content_lines).encode("utf-8")
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


def resolve_frontend_base_url(request: Request) -> str:
    origin = (request.headers.get("origin") or "").strip().rstrip("/")
    if origin:
        return origin

    referer = (request.headers.get("referer") or "").strip()
    if referer:
        parsed = urlparse(referer)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}"

    for env_name in ("FRONTEND_BASE_URL", "FRONTEND_URL"):
        frontend_url = (os.getenv(env_name) or "").strip()
        if frontend_url:
            return frontend_url.rstrip("/")

    return "http://localhost:3000"


def ensure_public_payment_gateway_enabled(db: Session, branch_id: int | None = None):
    if get_branch_setting_value(db, "maintenanceMode", branch_id):
        raise HTTPException(status_code=503, detail="Public services are temporarily unavailable because maintenance mode is active.")
    if not get_branch_setting_value(db, "paymentGatewayEnabled", branch_id):
        raise HTTPException(status_code=403, detail=SYSTEM_DISABLED_MESSAGE)


def verify_payment_identity(
    db: Session,
    citizen_user: CitizenUser,
    taxpayer_name: str,
    tin: str,
) -> str:
    normalized_request_name = normalize_identity_name(taxpayer_name)
    normalized_account_name = normalize_identity_name(citizen_name(citizen_user))
    normalized_tin = normalize_tin(tin)

    if not normalized_request_name or normalized_request_name != normalized_account_name:
        raise HTTPException(
            status_code=400,
            detail="TIN verification failed. The entered TIN does not match the registered citizen account. Please verify your information.",
        )

    if citizen_tin(citizen_user):
        if citizen_tin(citizen_user) != normalized_tin:
            raise HTTPException(
                status_code=400,
                detail="TIN verification failed. The entered TIN does not match the registered citizen account. Please verify your information.",
            )
    else:
        ensure_tin_is_unique(db, normalized_tin, exclude_citizen_id=citizen_user.id)
        citizen_user.tin = normalized_tin
        apply_citizen_user_security(citizen_user)

    return normalized_tin


def send_verified_payment_receipt_if_needed(db: Session, payment: Payment, trigger: str):
    recipient_email = payment_value(payment, "email")
    if payment.receipt_sent_at or not recipient_email:
        return

    is_rpt_submitted = payment.source_module == "rpt_online_payment" and payment.status == "PAYMENT_SUBMITTED"
    email_status = "Payment Submitted" if is_rpt_submitted else "Verified"
    email_context = "rpt_submitted" if is_rpt_submitted else "verified"

    email_result = send_payment_receipt_email(
        recipient_email,
        {
            "ref_number": payment_value(payment, "ref_number"),
            "verified_at": payment.verified_at,
            "taxpayer_name": payment_value(payment, "taxpayer_name"),
            "tin": format_tin(payment_value(payment, "tin")),
            "tax_type": payment_value(payment, "tax_type"),
            "payment_method": payment_value(payment, "payment_method"),
            "amount": format_currency(payment.amount),
            "status": email_status,
            "branch": payment_value(payment, "branch"),
            "email_context": email_context,
        },
    )

    if email_result.get("sent"):
        payment.receipt_sent_at = datetime.utcnow()
        db.add(ActivityLog(
            action="Payment Receipt Emailed",
            user=recipient_email or payment_value(payment, "taxpayer_name"),
            details=f"{'PayMongo confirmation' if is_rpt_submitted else 'Official receipt'} for {payment_value(payment, 'ref_number')} was emailed after {trigger}",
            type="transaction",
        ))
        return

    db.add(ActivityLog(
        action="Payment Receipt Email Not Sent",
        user=recipient_email or payment_value(payment, "taxpayer_name"),
        details=f"Receipt email for {payment_value(payment, 'ref_number')} was not sent after {trigger}: {email_result.get('message')}",
        type="transaction",
    ))


def normalize_payment_status(status_value: str | None) -> str:
    workflow_status = map_workflow_status_to_serialized(status_value)
    if workflow_status:
        return workflow_status
    normalized = (status_value or "pending").strip().lower()
    if normalized in {"verified", "payment verified", "confirmed", "paid", "succeeded", "successful", "success"}:
        return "confirmed"
    if normalized == "expired":
        return "expired"
    if normalized in {"failed", "declined", "cancelled", "canceled", "expired"}:
        return "failed"
    return "pending"


def update_linked_request_status(db: Session, payment: Payment):
    if payment.source_module == "business_tax_online_payment":
        update_bt_application_payment_state(
            db,
            payment,
            application_status="PENDING_TREASURY_VALIDATION",
            payment_status=payment.status,
        )
        return

    if payment.source_module != "receipt_request" or not payment.related_request_id:
        return

    receipt_request = db.query(ReceiptRequest).filter(
        hash_aware_match(ReceiptRequest, "request_id", payment.related_request_id)
    ).first()
    if not receipt_request:
        return

    receipt_request.fee_paid = True
    receipt_request.payment_ref_number = payment_value(payment, "ref_number")
    if receipt_request_value(receipt_request, "release_copy_path"):
        receipt_request.status = "Ready for Release"
    else:
        receipt_request.status = "Pending Branch Review"
    receipt_request.processed_at = datetime.utcnow()
    apply_receipt_request_security(receipt_request)


def revert_linked_request_status_for_declined_payment(db: Session, payment: Payment):
    if payment.source_module != "receipt_request" or not payment.related_request_id:
        return

    receipt_request = db.query(ReceiptRequest).filter(
        hash_aware_match(ReceiptRequest, "request_id", payment.related_request_id)
    ).first()
    if not receipt_request:
        return

    if receipt_request_value(receipt_request, "status") in {"Released", "Completed"}:
        return

    receipt_request.fee_paid = False
    receipt_request.payment_ref_number = None
    receipt_request.status = "Payment Required"
    receipt_request.processed_at = datetime.utcnow()
    apply_receipt_request_security(receipt_request)


def is_confirmed_payment(payment: Payment) -> bool:
    payment_status = (payment.status or "").strip().lower()
    paymongo_status = (payment_value(payment, "paymongo_status") or "").strip().lower()
    return (
        payment_status in {"verified", "payment verified", "confirmed", "paid", "succeeded", "successful", "success"}
        or paymongo_status in {"paid", "succeeded"}
        or payment.verified_at is not None
    )


def get_failure_status(payment: Payment) -> str | None:
    payment_status = (payment.status or "").strip().lower()
    paymongo_status = (payment_value(payment, "paymongo_status") or "").strip().lower()

    if payment_status in {"expired"} or paymongo_status == "expired":
        return "Expired"
    if payment_status in {"failed", "declined", "cancelled", "canceled"} or paymongo_status in {"failed", "declined", "cancelled", "canceled"}:
        return "Failed"
    return None


def get_failure_reason_message(payment: Payment) -> str | None:
    failure_status = get_failure_status(payment)
    if failure_status == "Expired":
        return "The payment session expired before the transaction was completed."
    if failure_status == "Failed":
        return "The payment was cancelled, declined, or failed during authorization."
    return None


def infer_failed_status_from_error(failed_code: str | None, failed_message: str | None) -> str | None:
    error_text = " ".join(filter(None, [failed_code, failed_message])).strip().lower()
    if not error_text:
        return None
    if "expire" in error_text or failed_code == "CLOSED":
        return "expired"
    return "failed"


def extract_error_code_and_message(error_payload: dict | None) -> tuple[str | None, str | None]:
    if not isinstance(error_payload, dict):
        return None, None

    return (
        error_payload.get("code") or error_payload.get("failed_code"),
        error_payload.get("message") or error_payload.get("detail") or error_payload.get("failed_message"),
    )


def update_payment_from_payment_intent(payment: Payment, payment_intent_payload: dict):
    payment_intent_data = payment_intent_payload.get("data", {}) or {}
    payment_intent_id = payment_intent_data.get("id")
    payment_intent_attrs = payment_intent_data.get("attributes", {}) or {}
    payment_intent_status = (payment_intent_attrs.get("status") or "").strip().lower()
    intent_payments = payment_intent_attrs.get("payments") or []
    latest_payment = intent_payments[-1] if intent_payments else None
    latest_payment_attrs = latest_payment.get("attributes", {}) if latest_payment else {}
    latest_payment_status = (latest_payment_attrs.get("status") or "").strip().lower()
    latest_payment_id = latest_payment.get("id") if latest_payment else None

    intent_error_code, intent_error_message = extract_error_code_and_message(
        payment_intent_attrs.get("last_payment_error")
    )
    latest_error_code, latest_error_message = extract_error_code_and_message(
        latest_payment_attrs.get("last_payment_error")
    )
    latest_error_code = latest_payment_attrs.get("failed_code") or latest_error_code
    latest_error_message = latest_payment_attrs.get("failed_message") or latest_error_message

    inferred_failed_status = (
        infer_failed_status_from_error(latest_error_code, latest_error_message)
        or infer_failed_status_from_error(intent_error_code, intent_error_message)
    )

    payment.paymongo_payment_intent_id = payment_intent_id or payment.paymongo_payment_intent_id
    if latest_payment_id:
        payment.paymongo_payment_id = latest_payment_id

    if latest_payment_status:
        payment.paymongo_status = inferred_failed_status or latest_payment_status
    elif inferred_failed_status:
        payment.paymongo_status = inferred_failed_status
    elif payment_intent_status:
        payment.paymongo_status = payment_intent_status

    if latest_payment_status == "paid" or payment_intent_status == "succeeded":
        mark_payment_submitted(payment)
    elif inferred_failed_status == "expired":
        payment.status = "Expired"
    elif inferred_failed_status == "failed":
        payment.status = "Failed"
    elif latest_payment_status in {"failed", "declined", "cancelled", "canceled"}:
        payment.status = "Failed"
    apply_payment_security(payment)


def log_failed_payment_transition(db: Session, payment: Payment, previous_status: str | None):
    current_status = (payment.status or "").strip()
    if current_status not in {"Failed", "Expired"}:
        return
    if (previous_status or "").strip() == current_status:
        return

    db.add(ActivityLog(
        action="Payment Not Completed",
        user=payment.email or payment.taxpayer_name,
        details=f"Payment {payment.ref_number} marked as {current_status.lower()} via checkout status check",
        type="transaction",
    ))


def has_terminal_payment_status(payment: Payment) -> bool:
    return normalize_payment_status(payment.status) in {"confirmed", "failed", "expired"}


def has_active_checkout_session(payment: Payment) -> bool:
    if not payment_value(payment, "paymongo_checkout_session_id") or not payment_value(payment, "paymongo_checkout_url"):
        return False
    return not has_terminal_payment_status(payment)


def update_payment_from_checkout_session(payment: Payment, checkout_session: dict):
    session_data = checkout_session.get("data", {})
    session_id = session_data.get("id")
    attributes = session_data.get("attributes", {})
    session_status = (attributes.get("status") or "").strip().lower()
    payment_intent = attributes.get("payment_intent", {}) or {}
    payment_intent_id = payment_intent.get("id")
    payment_intent_attrs = payment_intent.get("attributes", {}) or {}
    payment_intent_status = (payment_intent_attrs.get("status") or "").strip().lower()
    checkout_payments = attributes.get("payments") or []
    intent_payments = payment_intent_attrs.get("payments") or []
    payments = checkout_payments or intent_payments

    payment.paymongo_checkout_session_id = session_id or payment.paymongo_checkout_session_id
    payment.paymongo_payment_intent_id = payment_intent_id or payment.paymongo_payment_intent_id
    payment.paymongo_checkout_url = attributes.get("checkout_url") or payment.paymongo_checkout_url

    latest_payment = payments[-1] if payments else None
    latest_payment_attrs = latest_payment.get("attributes", {}) if latest_payment else {}
    latest_payment_status = (latest_payment_attrs.get("status") or "").strip().lower()
    latest_payment_id = latest_payment.get("id") if latest_payment else None
    latest_payment_error = latest_payment_attrs.get("last_payment_error") or {}
    payment_intent_error = payment_intent_attrs.get("last_payment_error") or {}
    latest_error_code, latest_error_message = extract_error_code_and_message(latest_payment_error)
    intent_error_code, intent_error_message = extract_error_code_and_message(payment_intent_error)
    latest_failed_code = latest_payment_attrs.get("failed_code") or latest_error_code
    latest_failed_message = latest_payment_attrs.get("failed_message") or latest_error_message

    if latest_payment_id:
        payment.paymongo_payment_id = latest_payment_id

    failure_message = (
        latest_failed_message
        or intent_error_message
        or intent_error_code
        or latest_failed_code
    )
    inferred_failed_status = (
        infer_failed_status_from_error(latest_failed_code, latest_failed_message)
        or infer_failed_status_from_error(intent_error_code, intent_error_message)
    )

    if latest_payment_status:
        payment.paymongo_status = inferred_failed_status or latest_payment_status
    elif session_status == "expired":
        payment.paymongo_status = "expired"
    elif session_status in {"cancelled", "canceled"}:
        payment.paymongo_status = "failed"
    elif payment_intent_status in {"failed", "declined", "cancelled", "canceled"}:
        payment.paymongo_status = payment_intent_status
    elif inferred_failed_status:
        payment.paymongo_status = inferred_failed_status
    elif failure_message:
        payment.paymongo_status = "failed"
    elif payment_intent_status:
        payment.paymongo_status = payment_intent_status
    else:
        payment.paymongo_status = session_status or payment.paymongo_status

    if latest_payment_status == "paid":
        mark_payment_submitted(payment)
    elif inferred_failed_status == "expired":
        payment.status = "Expired"
    elif inferred_failed_status == "failed":
        payment.status = "Failed"
    elif latest_payment_status in {"failed", "declined", "cancelled", "canceled"}:
        payment.status = "Failed"
    elif session_status == "expired":
        payment.status = "Expired"
    elif session_status in {"cancelled", "canceled"}:
        payment.status = "Failed"
    elif payment_intent_status in {"failed", "declined", "cancelled", "canceled"} or failure_message:
        payment.status = "Failed"
    apply_payment_security(payment)


@router.get("/rpt/search")
async def search_rpt_property(
    branch_id: int = Query(...),
    tdn: str = Query(...),
    db: Session = Depends(get_db),
    current_user: CitizenUser = Depends(get_current_user),
):
    ensure_public_payment_gateway_enabled(db, branch_id)
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Selected branch not found.")
    branch_key = resolve_rpt_branch_key(branch)

    search_count = get_rpt_search_usage(db, current_user)
    if search_count >= MAX_RPT_SEARCHES_PER_DAY:
        raise HTTPException(status_code=429, detail="You have reached your daily TDN search limit.")

    normalized_tdn = normalize_rpt_tdn(tdn)
    if is_rpt_tdn_settled(db, branch.id, normalized_tdn):
        db.add(ActivityLog(
            action="RPT Property Search",
            user=citizen_email(current_user) or citizen_name(current_user),
            details=f"Branch: {branch.name}; TDN: {normalized_tdn}; Found: no; Reason: settled",
            type="transaction",
        ))
        apply_payment_security(payment)
        db.commit()
        searches_used = search_count + 1
        searches_remaining = max(MAX_RPT_SEARCHES_PER_DAY - searches_used, 0)
        raise HTTPException(
            status_code=404,
            detail={
                "message": RPT_NOT_FOUND_MESSAGE,
                "searchesRemaining": searches_remaining,
                "searchesUsed": searches_used,
                "searchLimit": MAX_RPT_SEARCHES_PER_DAY,
            },
        )
    property_record = SIMULATED_RPT_PROPERTIES.get(branch_key, {}).get(normalized_tdn)
    assessment_record = get_rpt_assessment_for_user(db, current_user, branch.id, normalized_tdn)
    db.add(ActivityLog(
        action="RPT Property Search",
        user=citizen_email(current_user) or citizen_name(current_user),
        details=f"Branch: {branch.name}; TDN: {normalized_tdn}; Found: {'yes' if (assessment_record or property_record) else 'no'}",
        type="transaction",
    ))
    db.commit()

    searches_used = search_count + 1
    searches_remaining = max(MAX_RPT_SEARCHES_PER_DAY - searches_used, 0)
    if not assessment_record and not property_record:
        raise HTTPException(
            status_code=404,
            detail={
                "message": RPT_NOT_FOUND_MESSAGE,
                "searchesRemaining": searches_remaining,
                "searchesUsed": searches_used,
                "searchLimit": MAX_RPT_SEARCHES_PER_DAY,
            },
        )

    return {
        "status": "PROPERTY_FOUND",
        "branch": {"id": branch.id, "name": branch.name, "location": branch.location},
        "property": serialize_rpt_assessment_property(assessment_record) if assessment_record else compute_rpt_breakdown(normalized_tdn, property_record),
        "searchesRemaining": searches_remaining,
        "searchesUsed": searches_used,
        "searchLimit": MAX_RPT_SEARCHES_PER_DAY,
    }


@router.get("/rpt/active-payment")
async def get_active_rpt_payment(
    db: Session = Depends(get_db),
    current_user: CitizenUser = Depends(get_current_user),
):
    ensure_public_payment_gateway_enabled(db)
    active_payment = get_active_rpt_payment_for_user(db, current_user)
    return {"payment": serialize_payment(active_payment) if active_payment else None}


@router.post("/rpt/generate-reference")
async def generate_rpt_payment_reference(
    request: RptPaymentReferenceRequest,
    db: Session = Depends(get_db),
    current_user: CitizenUser = Depends(get_current_user),
):
    ensure_public_payment_gateway_enabled(db, request.branchId)
    active_payment = get_active_rpt_payment_for_user(db, current_user)
    if active_payment:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "You already have a pending RPT online payment awaiting treasury action. Please wait for branch verification before creating another payment.",
                "activePayment": serialize_payment(active_payment),
            },
        )
    if not request.cartItems:
        raise HTTPException(status_code=400, detail="Add at least one property to your cart before proceeding.")

    branch = db.query(Branch).filter(Branch.id == request.branchId).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Selected branch not found.")
    branch_key = resolve_rpt_branch_key(branch)

    payment_method = normalize_public_payment_method(request.paymentMethod)
    contact_number = normalize_contact_number(request.contactNumber)
    normalized_tin = verify_payment_identity(db, current_user, request.taxpayerName, request.tin)

    validated_items = []
    total_amount = 0.0
    for item in request.cartItems:
        normalized_item_tdn = normalize_rpt_tdn(item.tdn)
        assessment_record = get_rpt_assessment_for_user(db, current_user, branch.id, normalized_item_tdn)
        if assessment_record:
            computed = serialize_rpt_assessment_property(assessment_record)
        else:
            branch_properties = SIMULATED_RPT_PROPERTIES.get(branch_key, {})
            source_record = branch_properties.get(normalize_rpt_tdn(item.tdn))
            if not source_record:
                raise HTTPException(status_code=404, detail=f"TDN {item.tdn} is not available in the selected branch.")
            computed = compute_rpt_breakdown(normalize_rpt_tdn(item.tdn), source_record)
        selected_payment_option = normalize_rpt_payment_option(item.payment_option)
        selected_amount, bill_coverage = compute_rpt_amount_for_option(computed, selected_payment_option)
        validated_item = {
            **computed,
            "payment_option": selected_payment_option,
            "bill_coverage": item.bill_coverage or bill_coverage,
            "original_total_amount_due": computed["final_total_amount_due"],
            "final_total_amount_due": selected_amount,
        }
        validated_items.append(validated_item)
        total_amount += selected_amount

    ref_number = build_unique_payment_reference(db)
    txn_id = f"TX-{datetime.utcnow().strftime('%Y')}-{random.randint(10000, 99999)}"
    expiry = datetime.utcnow() + timedelta(hours=24)
    metadata = {
        "is_rpt_workflow": True,
        "cart_items": validated_items,
        "search_limit": MAX_RPT_SEARCHES_PER_DAY,
        "selected_branch_id": branch.id,
        "selected_branch_name": branch.name,
        "payment_timestamp": datetime.utcnow().isoformat(),
        "status_flow": [
            "PROPERTY_SEARCHED",
            "PROPERTY_FOUND",
            "ADDED_TO_CART",
            "PAYMENT_INITIATED",
            "PAYMENT_SUBMITTED",
            "PENDING_TREASURY_VALIDATION",
            "PAYMENT_VERIFIED",
            "PAYMENT_REJECTED",
            "CLARIFICATION_REQUESTED",
            "OR_GENERATED",
            "COMPLETED",
        ],
    }

    payment = Payment(
        ref_number=ref_number,
        txn_id=txn_id,
        taxpayer_name=citizen_name(current_user),
        tin=normalized_tin,
        property_ref_number=", ".join(item["tdn"] for item in validated_items),
        tax_type="Real Property Tax",
        amount=round(total_amount, 2),
        payment_method=payment_method,
        branch_id=branch.id,
        branch=branch.name,
        email=citizen_email(current_user),
        contact_number=contact_number,
        status="PAYMENT_INITIATED",
        source_module="rpt_online_payment",
        payment_expiry=expiry,
    )
    set_payment_metadata(payment, metadata)
    db.add(payment)
    db.add(ActivityLog(
        action="RPT Payment Reference Generated",
        user=citizen_email(current_user) or citizen_name(current_user),
        details=f"Reference {ref_number} generated for {len(validated_items)} RPT cart item(s) in {branch.name}",
        type="transaction",
    ))
    db.commit()
    db.refresh(payment)

    return {
        "refNumber": ref_number,
        "txnId": txn_id,
        "amount": round(total_amount, 2),
        "expiry": expiry.strftime("%b %d, %Y %I:%M %p"),
        "status": "PAYMENT_INITIATED",
        "paymentId": payment.id,
        "paymentMethod": payment_method,
        "contactNumber": contact_number,
        "cartItems": validated_items,
    }


@router.post("/bt/validate-record")
async def validate_business_tax_record(
    request: BusinessTaxValidationRequest,
    db: Session = Depends(get_db),
    current_user: CitizenUser = Depends(get_current_user),
):
    ensure_public_payment_gateway_enabled(db)
    search_count = get_bt_search_usage(db, current_user)
    if search_count >= MAX_BT_SEARCHES_PER_DAY:
        raise HTTPException(status_code=429, detail="You have reached your daily Business Tax validation search limit.")

    normalized_permit = normalize_bt_mayor_permit(request.mayorPermitNumber)
    normalized_registration = normalize_bt_registration_number(request.secDtiCdaNumber)

    linked_bt_assessment = get_bt_assessment_for_user(
        db,
        current_user,
        normalized_permit,
        normalized_registration,
    )
    if linked_bt_assessment:
        linked_status = tax_assessment_value(linked_bt_assessment, "verification_status")
        if linked_status == "Rejected":
            raise HTTPException(status_code=403, detail="This Business Tax submission was rejected. Please review the remarks in your taxpayer account.")
        if linked_status != "Verified":
            raise HTTPException(status_code=403, detail="This Business Tax submission is still pending verification.")
        permit_record = upsert_business_registry_from_assessment(db, linked_bt_assessment)
        registration_record = permit_record
    else:
        permit_record = get_business_registry_by_permit(db, normalized_permit)
        registration_record = get_business_registry_by_registration(db, normalized_registration)

    db.add(ActivityLog(
        action="Business Registry Search",
        user=citizen_email(current_user) or citizen_name(current_user),
        details=(
            f"Mayor Permit: {normalized_permit}; Registration: {normalized_registration}; "
            f"Permit Found: {'yes' if permit_record else 'no'}; Registration Found: {'yes' if registration_record else 'no'}"
        ),
        type="transaction",
    ))

    searches_used = search_count + 1
    searches_remaining = max(MAX_BT_SEARCHES_PER_DAY - searches_used, 0)

    if not permit_record:
        db.commit()
        raise HTTPException(
            status_code=404,
            detail={
                "message": "Mayor's Permit Number not found in the Business Registry.",
                "searchesRemaining": searches_remaining,
                "searchesUsed": searches_used,
                "searchLimit": MAX_BT_SEARCHES_PER_DAY,
            },
        )
    if not registration_record:
        db.commit()
        raise HTTPException(
            status_code=404,
            detail={
                "message": "SEC/DTI/CDA Number not found in the Business Registry.",
                "searchesRemaining": searches_remaining,
                "searchesUsed": searches_used,
                "searchLimit": MAX_BT_SEARCHES_PER_DAY,
            },
        )
    if permit_record.id != registration_record.id:
        db.commit()
        raise HTTPException(
            status_code=409,
            detail={
                "message": "The Mayor's Permit Number and SEC/DTI/CDA Number do not belong to the same registered business.",
                "searchesRemaining": searches_remaining,
                "searchesUsed": searches_used,
                "searchLimit": MAX_BT_SEARCHES_PER_DAY,
            },
        )

    ensure_bt_registry_record_is_active(permit_record)

    normalized_owner_name = normalize_identity_name(permit_record.owner_name)
    normalized_user_name = normalize_identity_name(citizen_name(current_user))
    if normalized_owner_name and normalized_user_name and normalized_owner_name != normalized_user_name:
        db.commit()
        raise HTTPException(
            status_code=403,
            detail="This business registry record is not linked to the authenticated taxpayer account.",
        )

    application = get_or_create_business_tax_application(db, current_user, permit_record)
    db.add(ActivityLog(
        action="Business Tax Application Validated",
        user=citizen_email(current_user) or citizen_name(current_user),
        details=f"Tracking {application.tracking_number} validated for {permit_record.business_name}",
        type="transaction",
    ))
    db.commit()
    db.refresh(application)

    return {
        "status": "VALIDATED",
        "registry": serialize_business_registry_record(permit_record),
        "application": serialize_business_tax_application(application),
        "searchesRemaining": searches_remaining,
        "searchesUsed": searches_used,
        "searchLimit": MAX_BT_SEARCHES_PER_DAY,
    }


@router.get("/bt/applications")
async def list_business_tax_applications(
    searchField: str = Query(default="tracking_mp_no"),
    searchTerm: str = Query(default=""),
    applicationStatus: str = Query(default="ALL"),
    db: Session = Depends(get_db),
    current_user: CitizenUser = Depends(get_current_user),
):
    ensure_public_payment_gateway_enabled(db)
    base_query = db.query(BusinessTaxApplication).filter(
        BusinessTaxApplication.citizen_user_id == current_user.id
    )

    normalized_status = (applicationStatus or "ALL").strip().upper()
    if normalized_status != "ALL":
        base_query = base_query.filter(BusinessTaxApplication.application_status == normalized_status)

    query = base_query
    normalized_search_term = (searchTerm or "").strip()
    if normalized_search_term:
        like_term = f"%{normalized_search_term}%"
        normalized_field = (searchField or "tracking_mp_no").strip().lower()
        if normalized_field == "tracking_mp_no":
            query = query.filter(
                or_(
                    BusinessTaxApplication.tracking_number.ilike(like_term),
                    BusinessTaxApplication.mayor_permit_number_hash == hash_optional_value(normalized_search_term.upper()),
                )
            )
        elif normalized_field == "mayors_permit_number":
            query = query.filter(BusinessTaxApplication.mayor_permit_number_hash == hash_optional_value(normalized_search_term.upper()))
        elif normalized_field == "business_name":
            applications = query.order_by(BusinessTaxApplication.created_at.desc()).all()
            filtered = [
                application for application in applications
                if normalized_search_term.lower() in ((get_decrypted_or_raw(application, "business_name") or application.business_name or "").lower())
            ]
            return {"items": [serialize_business_tax_application(application) for application in filtered], "count": len(filtered)}
        elif normalized_field == "owner_name":
            applications = query.order_by(BusinessTaxApplication.created_at.desc()).all()
            filtered = [
                application for application in applications
                if normalized_search_term.lower() in ((get_decrypted_or_raw(application, "owner_name") or application.owner_name or "").lower())
            ]
            return {"items": [serialize_business_tax_application(application) for application in filtered], "count": len(filtered)}
        else:
            raise HTTPException(status_code=400, detail="Unsupported Business Tax search field.")

    applications = query.order_by(BusinessTaxApplication.created_at.desc()).all()
    return {
        "items": [serialize_business_tax_application(application) for application in applications],
        "count": len(applications),
    }


@router.get("/bt/applications/{tracking_number}")
async def get_business_tax_application(
    tracking_number: str,
    db: Session = Depends(get_db),
    current_user: CitizenUser = Depends(get_current_user),
):
    ensure_public_payment_gateway_enabled(db)
    application = get_business_tax_application_for_user(db, tracking_number, current_user)
    return serialize_business_tax_application(application)


@router.post("/bt/applications/{tracking_number}/uploads")
async def upload_business_tax_documents(
    tracking_number: str,
    sales_declaration: UploadFile | None = File(default=None),
    financial_statements: UploadFile | None = File(default=None),
    supporting_documents: UploadFile | None = File(default=None),
    db: Session = Depends(get_db),
    current_user: CitizenUser = Depends(get_current_user),
):
    ensure_public_payment_gateway_enabled(db)
    application = get_business_tax_application_for_user(db, tracking_number, current_user)

    if not any([sales_declaration, financial_statements, supporting_documents]):
        raise HTTPException(status_code=400, detail="Please upload at least one Business Tax document.")

    upload_count = 0
    for upload, suffix, path_field, name_field in (
        (sales_declaration, "sales-declaration", "sales_declaration_path", "sales_declaration_name"),
        (financial_statements, "financial-statements", "financial_statements_path", "financial_statements_name"),
        (supporting_documents, "supporting-documents", "supporting_documents_path", "supporting_documents_name"),
    ):
        if upload is None:
            continue
        file_bytes = await upload.read()
        stored_path = store_business_tax_upload(file_bytes, upload.filename or suffix, tracking_number, suffix)
        setattr(application, path_field, str(stored_path))
        setattr(application, name_field, upload.filename or stored_path.name)
        upload_count += 1

    application.uploaded_at = datetime.utcnow()
    application.application_status = "DOCUMENTS_UPLOADED"
    metadata = parse_application_metadata(application)
    metadata["document_upload_timestamp"] = application.uploaded_at.isoformat()
    set_application_metadata(application, metadata)
    apply_business_tax_application_security_fields(application)

    db.add(ActivityLog(
        action="Business Tax Documents Uploaded",
        user=citizen_email(current_user) or citizen_name(current_user),
        details=f"{upload_count} document(s) uploaded for {tracking_number}",
        type="transaction",
    ))
    db.commit()
    db.refresh(application)
    return serialize_business_tax_application(application)


@router.post("/bt/applications/{tracking_number}/generate-reference")
async def generate_business_tax_reference(
    tracking_number: str,
    request: BusinessTaxPaymentReferenceRequest,
    db: Session = Depends(get_db),
    current_user: CitizenUser = Depends(get_current_user),
):
    active_payment = get_active_bt_payment_for_user(db, current_user)
    if active_payment:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "You already have a pending Business Tax online payment awaiting branch validation.",
                "activePayment": serialize_payment(active_payment),
            },
        )

    application = get_business_tax_application_for_user(db, tracking_number, current_user)
    if not application.sales_declaration_path or not application.financial_statements_path:
        raise HTTPException(
            status_code=400,
            detail="Upload the Sales Declaration and Financial Statements before generating a Business Tax payment reference.",
        )

    branch = resolve_business_tax_branch(db, get_decrypted_or_raw(application, "branch_name") or application.branch_name, application.branch_id)
    if not branch:
        raise HTTPException(status_code=404, detail="Assigned branch not found for this Business Tax application.")
    ensure_public_payment_gateway_enabled(db, branch.id)
    if application.branch_id != branch.id or (get_decrypted_or_raw(application, "branch_name") or application.branch_name) != (get_decrypted_or_raw(branch, "name") or branch.name):
        application.branch_id = branch.id
        application.branch_name = get_decrypted_or_raw(branch, "name") or branch.name

    registry_record = db.query(BusinessRegistry).filter(BusinessRegistry.id == application.business_registry_id).first()
    if registry_record and (registry_record.branch_id != branch.id or (get_decrypted_or_raw(registry_record, "branch_assigned") or registry_record.branch_assigned) != (get_decrypted_or_raw(branch, "name") or branch.name)):
        registry_record.branch_id = branch.id
        registry_record.branch_assigned = get_decrypted_or_raw(branch, "name") or branch.name
        apply_business_registry_security_fields(registry_record)

    payment_method = normalize_public_payment_method(request.paymentMethod)
    contact_number = normalize_contact_number(request.contactNumber)
    normalized_tin = verify_payment_identity(db, current_user, request.taxpayerName, request.tin)

    ref_number = build_bt_payment_reference(db, branch)
    txn_id = f"TX-BT-{datetime.utcnow().strftime('%Y')}-{random.randint(10000, 99999)}"
    expiry = datetime.utcnow() + timedelta(hours=24)

    payment_metadata = {
        "is_business_tax_workflow": True,
        "tracking_number": application.tracking_number,
        "business_name": get_decrypted_or_raw(application, "business_name") or application.business_name,
        "owner_name": get_decrypted_or_raw(application, "owner_name") or application.owner_name,
        "mayor_permit_number": get_decrypted_or_raw(application, "mayor_permit_number") or application.mayor_permit_number,
        "sec_dti_cda_number": get_decrypted_or_raw(application, "sec_dti_cda_number") or application.sec_dti_cda_number,
        "business_status": application.business_status,
        "application_status": application.application_status,
        "source_documents": {
            "sales_declaration_name": application.sales_declaration_name,
            "sales_declaration_download_url": f"/api/payments/bt/applications/{application.tracking_number}/files/sales-declaration" if application.sales_declaration_path else None,
            "financial_statements_name": application.financial_statements_name,
            "financial_statements_download_url": f"/api/payments/bt/applications/{application.tracking_number}/files/financial-statements" if application.financial_statements_path else None,
            "supporting_documents_name": application.supporting_documents_name,
            "supporting_documents_download_url": f"/api/payments/bt/applications/{application.tracking_number}/files/supporting-documents" if application.supporting_documents_path else None,
        },
    }

    payment = Payment(
        ref_number=ref_number,
        txn_id=txn_id,
        taxpayer_name=citizen_name(current_user),
        tin=normalized_tin,
        property_ref_number=get_decrypted_or_raw(application, "mayor_permit_number") or application.mayor_permit_number,
        tax_type="Business Tax",
        amount=round(float(application.amount_due or 0), 2),
        payment_method=payment_method,
        branch_id=branch.id,
        branch=get_decrypted_or_raw(branch, "name") or branch.name,
        email=citizen_email(current_user),
        contact_number=contact_number,
        status="PAYMENT_INITIATED",
        source_module="business_tax_online_payment",
        related_request_id=application.tracking_number,
        payment_expiry=expiry,
    )
    set_payment_metadata(payment, payment_metadata)
    db.add(payment)

    application.payment_ref_number = ref_number
    application.payment_status = "PAYMENT_INITIATED"
    application.application_status = "PAYMENT_INITIATED"
    apply_business_tax_application_security_fields(application)

    db.add(ActivityLog(
        action="Business Tax Payment Reference Generated",
        user=citizen_email(current_user) or citizen_name(current_user),
        details=f"Reference {ref_number} generated for {tracking_number}",
        type="transaction",
    ))
    db.commit()
    db.refresh(payment)
    db.refresh(application)

    return {
        "refNumber": ref_number,
        "txnId": txn_id,
        "amount": round(float(application.amount_due or 0), 2),
        "expiry": expiry.strftime("%b %d, %Y %I:%M %p"),
        "status": "PAYMENT_INITIATED",
        "paymentId": payment.id,
        "paymentMethod": payment_method,
        "contactNumber": contact_number,
        "application": serialize_business_tax_application(application),
    }


@router.post("/generate-reference")
async def generate_payment_reference(
    request: PaymentReferenceRequest,
    db: Session = Depends(get_db),
    current_user: CitizenUser = Depends(get_current_user),
):
    payment_method = normalize_public_payment_method(request.paymentMethod)
    contact_number = normalize_contact_number(request.contactNumber)
    normalized_tin = verify_payment_identity(db, current_user, request.taxpayerName, request.tin)
    ref_number = build_unique_payment_reference(db)
    txn_id = f"TX-{datetime.utcnow().strftime('%Y')}-{random.randint(10000, 99999)}"
    expiry = datetime.utcnow() + timedelta(hours=24)

    branch = resolve_branch(db, request.branch)
    if not branch:
        raise HTTPException(status_code=404, detail="Selected branch not found")
    ensure_public_payment_gateway_enabled(db, branch.id)
    if request.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")

    payment = Payment(
        ref_number=ref_number,
        txn_id=txn_id,
        taxpayer_name=citizen_name(current_user),
        tin=normalized_tin,
        property_ref_number=request.refNumber,
        tax_type=request.taxType,
        amount=request.amount,
        payment_method=payment_method,
        branch_id=branch.id if branch else None,
        branch=request.branch,
        email=citizen_email(current_user),
        contact_number=contact_number,
        status="Pending",
        source_module="tax_payment",
        payment_expiry=expiry,
    )
    apply_payment_security(payment)
    db.add(payment)
    db.add(ActivityLog(
        action="Payment Reference Generated",
        user=citizen_email(current_user) or citizen_name(current_user),
        details=f"Reference {ref_number} generated for {citizen_name(current_user)}",
        type="transaction",
    ))
    db.commit()
    db.refresh(payment)

    return {
        "refNumber": ref_number,
        "txnId": txn_id,
        "amount": request.amount,
        "expiry": expiry.strftime("%b %d, %Y %I:%M %p"),
        "status": "Pending",
        "paymentId": payment.id,
        "paymentMethod": payment_method,
        "contactNumber": contact_number,
    }


@router.post("/process")
async def process_payment(request: PaymentProcessRequest, http_request: Request, db: Session = Depends(get_db)):
    payment = find_payment_by_ref_number(db, Payment, request.refNumber)
    if not payment:
        raise HTTPException(status_code=404, detail="Payment reference not found")
    ensure_public_payment_gateway_enabled(db, payment.branch_id)

    if request.paymentMethod:
        payment.payment_method = normalize_public_payment_method(request.paymentMethod)
        apply_payment_security(payment)

    frontend_url = resolve_frontend_base_url(http_request)

    if has_active_checkout_session(payment):
        return {
            "message": "Existing checkout session reused",
            "status": normalize_payment_status(payment.status).capitalize(),
            "checkoutUrl": payment_value(payment, "paymongo_checkout_url"),
            "checkoutSessionId": payment_value(payment, "paymongo_checkout_session_id"),
            "refNumber": payment_value(payment, "ref_number"),
        }
    
    try:
        selected_method = request.paymentMethod or payment.payment_method or "gcash"
        normalized_payment_method = normalize_public_payment_method(selected_method)
        checkout_payment_methods = resolve_checkout_payment_methods(selected_method)
        payment.payment_method = normalized_payment_method
        
        metadata = {
            "ref_number": payment_value(payment, "ref_number"),
            "txn_id": payment_value(payment, "txn_id"),
            "taxpayer_name": payment_value(payment, "taxpayer_name"),
            "tin": payment_value(payment, "tin"),
            "tax_type": payment_value(payment, "tax_type"),
            "branch": payment_value(payment, "branch"),
            "email": payment_value(payment, "email") or "",
            "contact_number": payment_value(payment, "contact_number") or "",
            "selected_bank": (request.bankCode or "").strip().lower(),
            "payment_method": normalized_payment_method,
        }
        existing_metadata = parse_payment_metadata(payment)
        if existing_metadata:
            metadata.update(existing_metadata)
        
        ref_number = payment_value(payment, "ref_number")
        taxpayer_name = payment_value(payment, "taxpayer_name")
        taxpayer_email = payment_value(payment, "email")
        contact_number = payment_value(payment, "contact_number")
        tax_type = payment_value(payment, "tax_type")
        description = f"{tax_type} - {taxpayer_name} ({ref_number})"

        checkout_response = paymongo_service.create_checkout_session(
            amount=payment.amount,
            item_name=tax_type,
            reference_number=ref_number,
            payment_method_types=checkout_payment_methods,
            success_url=f"{frontend_url}/payment/status?ref={ref_number}&merchant_return=1",
            cancel_url=f"{frontend_url}/payment/failed?ref={ref_number}",
            description=description,
            billing={
                "name": taxpayer_name,
                "email": taxpayer_email or "taxpayer@example.com",
                "phone": contact_number or "",
            },
            metadata=metadata,
            send_email_receipt=False,
        )

        checkout_data = checkout_response.get("data", {})
        checkout_attrs = checkout_data.get("attributes", {})
        checkout_session_id = checkout_data.get("id")
        payment_intent = checkout_attrs.get("payment_intent", {}) or {}
        payment_intent_id = payment_intent.get("id")
        payment_intent_status = payment_intent.get("attributes", {}).get("status")
        checkout_url = checkout_attrs.get("checkout_url")

        payment.paymongo_checkout_session_id = checkout_session_id
        payment.paymongo_payment_intent_id = payment_intent_id
        payment.paymongo_source_id = None
        payment.paymongo_checkout_url = checkout_url
        payment.paymongo_status = payment_intent_status or checkout_attrs.get("status")
        payment.status = "PAYMENT_INITIATED" if (existing_metadata.get("is_rpt_workflow") or existing_metadata.get("is_business_tax_workflow")) else "Pending"
        set_payment_metadata(payment, metadata)
        
        db.add(ActivityLog(
            action="PayMongo Checkout Session Created",
            user=taxpayer_email or taxpayer_name,
            details=f"PayMongo checkout session created for {request.refNumber}",
            type="transaction",
        ))
        db.commit()
        db.refresh(payment)
        
        return {
            "message": "Checkout session created successfully",
            "status": "Pending",
            "checkoutUrl": checkout_url,
            "checkoutSessionId": checkout_session_id,
            "refNumber": payment_value(payment, "ref_number")
        }
        
    except Exception as e:
        db.add(ActivityLog(
            action="PayMongo Error",
            user=payment.email or payment.taxpayer_name,
            details=f"PayMongo error for {request.refNumber}: {str(e)}",
            type="error",
        ))
        db.commit()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create PayMongo checkout: {str(e)}"
        )


@router.get("/verify/{ref_number}")
async def verify_payment(ref_number: str, db: Session = Depends(get_db)):
    payment = find_payment_by_ref_number(db, Payment, ref_number)
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    return serialize_payment(payment)


@router.get("/remittances")
async def list_main_remittances(
    current_admin=Depends(require_main_admin()),
    db: Session = Depends(get_db),
):
    remittances = db.query(Remittance).order_by(Remittance.submitted_at.desc(), Remittance.id.desc()).all()
    accepted_amount = sum(float(remittance.total_amount or 0) for remittance in remittances if remittance.status == "Accepted")
    pending_amount = sum(float(remittance.total_amount or 0) for remittance in remittances if remittance.status == "Submitted")
    account = get_or_create_main_collection_account(db)
    account.current_balance = accepted_amount
    account.total_collected = accepted_amount
    account.updated_at = datetime.utcnow()
    db.commit()
    return {
        "account": {
            "id": account.id,
            "account_name": account.account_name,
            "owner_type": account.owner_type,
            "current_balance": account.current_balance,
            "total_collected": account.total_collected,
        },
        "pending_amount": pending_amount,
        "accepted_amount": accepted_amount,
        "remittances": [serialize_remittance(remittance) for remittance in remittances],
    }


@router.get("/remittances/{remittance_id}/report")
async def download_remittance_report(
    remittance_id: int,
    current_admin=Depends(require_main_admin()),
    db: Session = Depends(get_db),
):
    remittance = db.query(Remittance).filter(Remittance.id == remittance_id).first()
    if not remittance:
        raise HTTPException(status_code=404, detail="Remittance not found")
    if not remittance.report_file_path:
        raise HTTPException(status_code=404, detail="No remittance report was uploaded for this batch.")
    report_path = Path(remittance.report_file_path)
    if not report_path.exists():
        raise HTTPException(status_code=404, detail="Remittance report file is missing.")
    return FileResponse(
        report_path,
        filename=remittance.report_file_name or report_path.name,
        media_type=remittance.report_file_mime or "application/octet-stream",
    )


@router.post("/remittances/{remittance_id}/accept")
async def accept_main_remittance(
    remittance_id: int,
    payload: RemittanceReviewPayload | None = None,
    current_admin=Depends(require_main_admin()),
    db: Session = Depends(get_db),
):
    remittance = db.query(Remittance).filter(Remittance.id == remittance_id).first()
    if not remittance:
        raise HTTPException(status_code=404, detail="Remittance not found")
    if remittance.status != "Submitted":
        raise HTTPException(status_code=409, detail="Only submitted remittances can be accepted.")
    remittance.status = "Accepted"
    remittance.reviewed_by = getattr(current_admin, "username", None) or getattr(current_admin, "email", "main_admin")
    remittance.reviewed_at = datetime.utcnow()
    if payload and payload.remarks:
        remittance.remarks = payload.remarks.strip()
    for item in remittance.items or []:
        item.status = "Accepted"
    account = get_or_create_main_collection_account(db)
    account.current_balance = float(account.current_balance or 0) + float(remittance.total_amount or 0)
    account.total_collected = float(account.total_collected or 0) + float(remittance.total_amount or 0)
    account.updated_at = datetime.utcnow()
    db.add(ActivityLog(
        action="Remittance Accepted",
        user=remittance.reviewed_by,
        details=f"Accepted remittance {remittance.remittance_number}",
        type="remittance",
    ))
    db.commit()
    db.refresh(remittance)
    return serialize_remittance(remittance)


@router.post("/remittances/{remittance_id}/reject")
async def reject_main_remittance(
    remittance_id: int,
    payload: RemittanceReviewPayload | None = None,
    current_admin=Depends(require_main_admin()),
    db: Session = Depends(get_db),
):
    remittance = db.query(Remittance).filter(Remittance.id == remittance_id).first()
    if not remittance:
        raise HTTPException(status_code=404, detail="Remittance not found")
    if remittance.status != "Submitted":
        raise HTTPException(status_code=409, detail="Only submitted remittances can be rejected.")
    remittance.status = "Rejected"
    remittance.reviewed_by = getattr(current_admin, "username", None) or getattr(current_admin, "email", "main_admin")
    remittance.reviewed_at = datetime.utcnow()
    if payload and payload.remarks:
        remittance.remarks = payload.remarks.strip()
    for item in remittance.items or []:
        item.status = "Rejected"
    db.add(ActivityLog(
        action="Remittance Rejected",
        user=remittance.reviewed_by,
        details=f"Rejected remittance {remittance.remittance_number}",
        type="remittance",
    ))
    db.commit()
    db.refresh(remittance)
    return serialize_remittance(remittance)


@router.get("/transactions")
async def get_transactions(db: Session = Depends(get_db)):
    payments = db.query(Payment).order_by(Payment.created_at.asc()).limit(50).all()
    return [serialize_payment(payment) for payment in payments]


@router.get("/")
async def get_all_payments(branch: str = None, db: Session = Depends(get_db)):
    query = db.query(Payment)
    if branch:
        query = query_payments_for_branch_name(db, branch)
    payments = query.order_by(Payment.created_at.asc()).all()
    return [serialize_payment(payment) for payment in payments]


@router.put("/{payment_id}/verify")
async def verify_payment_by_id(payment_id: int, db: Session = Depends(get_db)):
    payment = db.query(Payment).filter(Payment.id == payment_id).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    payment.status = "PAYMENT_VERIFIED" if payment.source_module == "rpt_online_payment" else "Verified"
    payment.verified_at = datetime.utcnow()
    payment.treasury_updated_at = datetime.utcnow()
    update_linked_request_status(db, payment)
    if payment.source_module == "business_tax_online_payment" and payment.related_request_id:
        application = db.query(BusinessTaxApplication).filter(
            BusinessTaxApplication.tracking_number == payment.related_request_id
        ).first()
        if application:
            application.application_status = "OR_GENERATED"
            application.payment_status = "Verified"
            application.verified_at = payment.verified_at
            application.verified_by = "branch_admin"
            application.verifier_remarks = payment.treasury_remarks or "Business Tax payment verified by branch treasury."
            application.official_receipt_number = application.official_receipt_number or build_bt_official_receipt_number(db)
            receipt_bytes = build_business_tax_official_receipt_pdf(payment, application)
            bt_output_dir = OUTPUT_DIR / "business-tax"
            bt_output_dir.mkdir(parents=True, exist_ok=True)
            receipt_path = bt_output_dir / f"{application.tracking_number}-official-receipt.pdf"
            receipt_path.write_bytes(receipt_bytes)
            application.official_receipt_path = str(receipt_path)
            application.official_receipt_generated_at = datetime.utcnow()
            payment.status = "OR_GENERATED"
            payment.official_receipt_number = application.official_receipt_number
            payment.official_receipt_path = application.official_receipt_path
            payment.official_receipt_generated_at = application.official_receipt_generated_at
            apply_business_tax_application_security_fields(application)
    send_verified_payment_receipt_if_needed(db, payment, "manual branch verification")

    db.add(ActivityLog(
        action="Payment Verified",
        user="branch_admin",
        details=f"Payment {payment.ref_number} verified by branch admin",
        type="transaction",
    ))
    db.commit()

    return {"message": "Payment verified successfully", "status": payment.status}


@router.put("/{payment_id}/decline")
async def decline_payment(payment_id: int, db: Session = Depends(get_db)):
    payment = db.query(Payment).filter(Payment.id == payment_id).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    
    payment.status = "PAYMENT_REJECTED" if payment.source_module == "rpt_online_payment" else "Failed"
    payment.treasury_updated_at = datetime.utcnow()
    revert_linked_request_status_for_declined_payment(db, payment)
    if payment.source_module == "business_tax_online_payment" and payment.related_request_id:
        application = db.query(BusinessTaxApplication).filter(
            BusinessTaxApplication.tracking_number == payment.related_request_id
        ).first()
        if application:
            application.application_status = "RETURNED_FOR_CORRECTION"
            application.payment_status = "Failed"
            application.returned_at = datetime.utcnow()
            application.verifier_remarks = "Business Tax submission was returned for correction by the branch treasury office."
            apply_business_tax_application_security_fields(application)
    db.add(ActivityLog(
        action="Payment Declined",
        user="branch_admin",
        details=f"Payment {payment.ref_number} declined by branch admin",
        type="transaction",
    ))
    db.commit()
    
    return {"message": "Payment declined successfully", "status": payment.status}


@router.put("/{payment_id}/clarification")
async def request_payment_clarification(
    payment_id: int,
    remarks: str = Form(""),
    db: Session = Depends(get_db),
):
    payment = db.query(Payment).filter(Payment.id == payment_id).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    payment.status = "CLARIFICATION_REQUESTED"
    payment.treasury_remarks = remarks.strip() or "Please provide clarification regarding this payment."
    payment.treasury_updated_at = datetime.utcnow()
    if payment.source_module == "business_tax_online_payment" and payment.related_request_id:
        application = db.query(BusinessTaxApplication).filter(
            BusinessTaxApplication.tracking_number == payment.related_request_id
        ).first()
        if application:
            application.application_status = "RETURNED_FOR_CORRECTION"
            application.payment_status = "Pending"
            application.verifier_remarks = payment.treasury_remarks
            application.returned_at = datetime.utcnow()
            apply_business_tax_application_security_fields(application)
    apply_payment_security(payment)
    db.add(ActivityLog(
        action="Payment Clarification Requested",
        user="branch_admin",
        details=f"Clarification requested for {payment.ref_number}",
        type="transaction",
    ))
    db.commit()
    db.refresh(payment)
    return serialize_payment(payment)


@router.post("/rpt/upload-proof/{ref_number}")
@router.post("/bt/upload-proof/{ref_number}")
async def upload_public_payment_proof(
    ref_number: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: CitizenUser = Depends(get_current_user),
):
    payment = find_payment_by_ref_number(db, Payment, ref_number)
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    if payment.source_module not in {"rpt_online_payment", "business_tax_online_payment"}:
        raise HTTPException(status_code=400, detail="Payment proof upload is only available for public tax payment workflows.")
    if payment.email and citizen_email(current_user) and payment.email.lower() != citizen_email(current_user).lower():
        raise HTTPException(status_code=403, detail="You are not authorized to upload proof for this transaction.")

    extension = Path(file.filename or "").suffix.lower()
    if extension not in {".jpg", ".jpeg", ".png", ".pdf"}:
        raise HTTPException(status_code=400, detail="Allowed file types are JPG, PNG, and PDF only.")

    file_bytes = await file.read()
    if len(file_bytes) > MAX_PROOF_FILE_SIZE_BYTES:
        raise HTTPException(status_code=400, detail="Maximum file size is 5MB.")

    proof_path = OUTPUT_DIR / f"{payment.ref_number}-proof{extension}"
    proof_path.write_bytes(file_bytes)
    payment.proof_file_path = str(proof_path)
    payment.proof_file_name = file.filename or proof_path.name
    payment.proof_uploaded_at = datetime.utcnow()
    if payment.status in {"PAYMENT_SUBMITTED", "PAYMENT_INITIATED"}:
        payment.status = "PENDING_TREASURY_VALIDATION"

    if payment.source_module == "business_tax_online_payment" and payment.related_request_id:
        application = db.query(BusinessTaxApplication).filter(
            BusinessTaxApplication.tracking_number == payment.related_request_id
        ).first()
        if application:
            application.proof_of_payment_path = str(proof_path)
            application.proof_of_payment_name = file.filename or proof_path.name
            application.payment_status = payment.status
            application.application_status = "PENDING_TREASURY_VALIDATION"
            application.uploaded_at = datetime.utcnow()
            apply_business_tax_application_security_fields(application)
    apply_payment_security(payment)

    db.add(ActivityLog(
        action="Business Tax Payment Proof Uploaded" if payment.source_module == "business_tax_online_payment" else "RPT Payment Proof Uploaded",
        user=citizen_email(current_user) or citizen_name(current_user),
        details=f"Proof uploaded for {payment.ref_number}",
        type="transaction",
    ))
    db.commit()
    db.refresh(payment)
    return serialize_payment(payment)


@router.get("/bt/applications/{tracking_number}/files/{file_type}")
async def download_business_tax_application_file(
    tracking_number: str,
    file_type: str,
    db: Session = Depends(get_db),
    current_user: CitizenUser = Depends(get_current_user),
):
    application = get_business_tax_application_for_user(db, tracking_number, current_user)
    path_map = {
        "sales-declaration": (application.sales_declaration_path, application.sales_declaration_name),
        "financial-statements": (application.financial_statements_path, application.financial_statements_name),
        "supporting-documents": (application.supporting_documents_path, application.supporting_documents_name),
        "proof-of-payment": (application.proof_of_payment_path, application.proof_of_payment_name),
    }
    if file_type not in path_map:
        raise HTTPException(status_code=404, detail="Business Tax file not found.")
    file_path, file_name = path_map[file_type]
    if not file_path:
        raise HTTPException(status_code=404, detail="Business Tax file not found.")
    return FileResponse(file_path, filename=file_name or Path(file_path).name)


@router.get("/bt/applications/{tracking_number}/official-receipt")
async def download_business_tax_official_receipt(
    tracking_number: str,
    db: Session = Depends(get_db),
    current_user: CitizenUser = Depends(get_current_user),
):
    application = get_business_tax_application_for_user(db, tracking_number, current_user)
    if not application.official_receipt_path:
        raise HTTPException(status_code=404, detail="Official receipt not available yet.")
    return FileResponse(
        application.official_receipt_path,
        filename=Path(application.official_receipt_path).name,
    )


@router.get("/{payment_id}/proof")
async def download_payment_proof(payment_id: int, db: Session = Depends(get_db)):
    payment = db.query(Payment).filter(Payment.id == payment_id).first()
    proof_path = payment_value(payment, "proof_file_path") if payment else None
    proof_name = payment_value(payment, "proof_file_name") if payment else None
    if not payment or not proof_path:
        raise HTTPException(status_code=404, detail="Payment proof not found")
    return FileResponse(proof_path, filename=proof_name or Path(proof_path).name)


@router.get("/{payment_id}/official-receipt")
async def download_official_receipt(payment_id: int, db: Session = Depends(get_db)):
    payment = db.query(Payment).filter(Payment.id == payment_id).first()
    official_receipt_path = payment_value(payment, "official_receipt_path") if payment else None
    if not payment or not official_receipt_path:
        raise HTTPException(status_code=404, detail="Official receipt not found")
    return FileResponse(official_receipt_path, filename=Path(official_receipt_path).name)


@router.get("/{payment_id}/payment-confirmation")
async def download_payment_confirmation(payment_id: int, db: Session = Depends(get_db)):
    payment = db.query(Payment).filter(Payment.id == payment_id).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    pdf_bytes = build_payment_confirmation_pdf(payment)
    filename = f"{payment_value(payment, 'ref_number') or f'payment-{payment.id}'}-confirmation.pdf"
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/paymongo/webhook")
async def paymongo_webhook(payload: PayMongoWebhookPayload, db: Session = Depends(get_db)):
    """
    Handle PayMongo webhook events for payment status updates
    """
    try:
        event_data = payload.data
        event_type = event_data.get("attributes", {}).get("type")
        
        if event_type == "source.chargeable":
            source_id = event_data.get("attributes", {}).get("data", {}).get("id")
            
            payment = find_payment_by_field(db, Payment, "paymongo_source_id", source_id)
            
            if payment:
                try:
                    if payment.paymongo_payment_id or is_confirmed_payment(payment):
                        return {"status": "success", "message": "Webhook already processed"}
                    payment_response = paymongo_service.create_payment(
                        source_id=source_id,
                        amount=payment.amount,
                        description=f"{payment.tax_type} - {payment.ref_number}"
                    )
                    
                    payment_data = payment_response.get("data", {})
                    payment_id = payment_data.get("id")
                    payment_status = payment_data.get("attributes", {}).get("status")
                    
                    payment.paymongo_payment_id = payment_id
                    payment.paymongo_status = payment_status
                    
                    if payment_status == "paid":
                        mark_payment_submitted(payment)
                        update_linked_request_status(db, payment)
                        send_verified_payment_receipt_if_needed(db, payment, "PayMongo source webhook")
                        
                        db.add(ActivityLog(
                            action="Payment Verified via PayMongo",
                            user=payment.email or payment.taxpayer_name,
                            details=f"Payment {payment.ref_number} verified via PayMongo webhook",
                            type="transaction",
                        ))
                    
                    apply_payment_security(payment)
                    db.commit()
                    
                except Exception as e:
                    db.add(ActivityLog(
                        action="PayMongo Webhook Error",
                        user="system",
                        details=f"Error processing webhook for source {source_id}: {str(e)}",
                        type="error",
                    ))
                    db.commit()
        
        elif event_type == "payment.paid":
            payment_id = event_data.get("attributes", {}).get("data", {}).get("id")
            payment_attrs = event_data.get("attributes", {}).get("data", {}).get("attributes", {})
            payment_intent_id = payment_attrs.get("payment_intent_id")
            metadata = payment_attrs.get("metadata", {}) or {}
            
            payment = find_payment_by_field(db, Payment, "paymongo_payment_id", payment_id)
            if not payment and payment_intent_id:
                payment = find_payment_by_field(db, Payment, "paymongo_payment_intent_id", payment_intent_id)
            if not payment and metadata.get("ref_number"):
                payment = find_payment_by_ref_number(db, Payment, metadata.get("ref_number"))
            
            if payment and payment.status not in {"Verified", "PAYMENT_SUBMITTED"}:
                mark_payment_submitted(payment)
                payment.paymongo_status = "paid"
                payment.paymongo_payment_id = payment_id
                update_linked_request_status(db, payment)
                send_verified_payment_receipt_if_needed(db, payment, "PayMongo payment webhook")
                
                db.add(ActivityLog(
                    action="Payment Verified via PayMongo",
                    user=payment.email or payment.taxpayer_name,
                    details=f"Payment {payment.ref_number} verified via PayMongo webhook",
                    type="transaction",
                ))
                apply_payment_security(payment)
                db.commit()
        
        elif event_type == "payment.failed":
            payment_id = event_data.get("attributes", {}).get("data", {}).get("id")
            payment_attrs = event_data.get("attributes", {}).get("data", {}).get("attributes", {})
            payment_intent_id = payment_attrs.get("payment_intent_id")
            metadata = payment_attrs.get("metadata", {}) or {}
            
            payment = find_payment_by_field(db, Payment, "paymongo_payment_id", payment_id)
            if not payment and payment_intent_id:
                payment = find_payment_by_field(db, Payment, "paymongo_payment_intent_id", payment_intent_id)
            if not payment and metadata.get("ref_number"):
                payment = find_payment_by_ref_number(db, Payment, metadata.get("ref_number"))
            
            if payment:
                payment.status = "PAYMENT_REJECTED" if payment.source_module == "rpt_online_payment" else "Failed"
                payment.paymongo_status = "failed"
                payment.paymongo_payment_id = payment_id
                
                db.add(ActivityLog(
                    action="Payment Failed",
                    user=payment.email or payment.taxpayer_name,
                    details=f"Payment {payment.ref_number} failed via PayMongo",
                    type="transaction",
                ))
                apply_payment_security(payment)
                db.commit()

        elif event_type == "checkout_session.payment.paid":
            checkout_session_data = event_data.get("attributes", {}).get("data", {}) or {}
            checkout_session_id = checkout_session_data.get("id")
            checkout_attrs = checkout_session_data.get("attributes", {}) or {}
            metadata = checkout_attrs.get("metadata", {}) or {}
            checkout_payments = checkout_attrs.get("payments") or []
            payment_id = checkout_payments[-1].get("id") if checkout_payments else None

            payment = None
            if checkout_session_id:
                payment = find_payment_by_field(db, Payment, "paymongo_checkout_session_id", checkout_session_id)
            if not payment and metadata.get("ref_number"):
                payment = find_payment_by_ref_number(db, Payment, metadata.get("ref_number"))

            if payment:
                if payment.status in {"Verified", "PAYMENT_SUBMITTED"}:
                    payment.paymongo_status = "paid"
                    if payment_id:
                        payment.paymongo_payment_id = payment_id
                    apply_payment_security(payment)
                    db.commit()
                    return {"status": "success", "message": "Webhook already processed"}
                update_payment_from_checkout_session(payment, {"data": checkout_session_data})
                update_linked_request_status(db, payment)
                if payment.status in {"Verified", "PAYMENT_SUBMITTED"}:
                    send_verified_payment_receipt_if_needed(db, payment, "PayMongo checkout webhook")
                db.add(ActivityLog(
                    action="Payment Verified via Checkout Session",
                    user=payment.email or payment.taxpayer_name,
                    details=f"Payment {payment.ref_number} verified via checkout session webhook",
                    type="transaction",
                ))
                apply_payment_security(payment)
                db.commit()
        
        return {"status": "success", "message": "Webhook processed"}
        
    except Exception as e:
        db.add(ActivityLog(
            action="Webhook Processing Error",
            user="system",
            details=f"Error processing PayMongo webhook: {str(e)}",
            type="error",
        ))
        db.commit()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/paymongo/status/{ref_number}")
async def check_paymongo_status(ref_number: str, db: Session = Depends(get_db)):
    """
    Check payment status from PayMongo and update local database
    """
    payment = find_payment_by_ref_number(db, Payment, ref_number)
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    
    if is_confirmed_payment(payment):
        if payment.status not in {"Verified", "PAYMENT_SUBMITTED", "PAYMENT_VERIFIED", "OR_GENERATED", "COMPLETED"}:
            mark_payment_submitted(payment)
            send_verified_payment_receipt_if_needed(db, payment, "status reconciliation")
            apply_payment_security(payment)
            db.commit()
            db.refresh(payment)
        return serialize_payment(payment)

    if payment.paymongo_checkout_session_id:
        try:
            previous_status = payment.status
            checkout_session = paymongo_service.retrieve_checkout_session(payment.paymongo_checkout_session_id)
            update_payment_from_checkout_session(payment, checkout_session)

            if (
                not is_confirmed_payment(payment)
                and not get_failure_status(payment)
                and payment.paymongo_payment_intent_id
            ):
                payment_intent = paymongo_service.retrieve_payment_intent(payment.paymongo_payment_intent_id)
                update_payment_from_payment_intent(payment, payment_intent)

            if payment.status in {"Verified", "PAYMENT_SUBMITTED"}:
                update_linked_request_status(db, payment)
                send_verified_payment_receipt_if_needed(db, payment, "checkout status reconciliation")
            else:
                failure_status = get_failure_status(payment)
                if failure_status and payment.status != failure_status:
                    payment.status = failure_status

            log_failed_payment_transition(db, payment, previous_status)

            db.commit()
            db.refresh(payment)
        except Exception as e:
            db.add(ActivityLog(
                action="Checkout Session Status Check Error",
                user="system",
                details=f"Error checking checkout session status for {ref_number}: {str(e)}",
                type="error",
            ))
            db.commit()

        return serialize_payment(payment)
    
    if not payment.paymongo_source_id:
        return serialize_payment(payment)
    
    try:
        source_response = paymongo_service.retrieve_source(payment.paymongo_source_id)
        source_data = source_response.get("data", {})
        source_status = source_data.get("attributes", {}).get("status")
        
        payment.paymongo_status = source_status

        if source_status in {"cancelled", "canceled", "failed", "expired"}:
            payment.status = "Expired" if source_status == "expired" else ("PAYMENT_REJECTED" if payment.source_module == "rpt_online_payment" else "Failed")
            db.add(ActivityLog(
                action="Payment Not Completed",
                user=payment.email or payment.taxpayer_name,
                details=f"Payment {ref_number} marked as {payment.status.lower()} from source status {source_status}",
                type="transaction",
            ))
        
        # Handle different source statuses
        if source_status == "chargeable" and not payment.paymongo_payment_id:
            try:
                payment_response = paymongo_service.create_payment(
                    source_id=payment.paymongo_source_id,
                    amount=payment.amount,
                    description=f"{payment.tax_type} - {payment.ref_number}"
                )
                
                payment_data = payment_response.get("data", {})
                payment_id = payment_data.get("id")
                payment_status = payment_data.get("attributes", {}).get("status")
                
                payment.paymongo_payment_id = payment_id
                payment.paymongo_status = payment_status
                
                # In test mode, payment might be immediately paid
                if payment_status == "paid":
                    mark_payment_submitted(payment)
                    update_linked_request_status(db, payment)
                    send_verified_payment_receipt_if_needed(db, payment, "source status reconciliation")
                    db.add(ActivityLog(
                        action="Payment Verified",
                        user=payment.email or payment.taxpayer_name,
                        details=f"Payment {ref_number} verified via status check",
                        type="transaction",
                    ))
                elif payment_status == "failed":
                    payment.status = "PAYMENT_REJECTED" if payment.source_module == "rpt_online_payment" else "Failed"
                    payment.paymongo_status = "failed"
                    db.add(ActivityLog(
                        action="Payment Failed",
                        user=payment.email or payment.taxpayer_name,
                        details=f"Payment {ref_number} failed",
                        type="transaction",
                    ))
                    
            except Exception as e:
                db.add(ActivityLog(
                    action="Payment Creation Error",
                    user="system",
                    details=f"Error creating payment from source for {ref_number}: {str(e)}",
                    type="error",
                ))
        
        elif payment.paymongo_payment_id:
            payment_response = paymongo_service.retrieve_payment(payment.paymongo_payment_id)
            payment_data = payment_response.get("data", {})
            payment_status = payment_data.get("attributes", {}).get("status")
            
            payment.paymongo_status = payment_status
            
            if payment_status == "paid" and payment.status not in {"Verified", "PAYMENT_SUBMITTED"}:
                mark_payment_submitted(payment)
                update_linked_request_status(db, payment)
                send_verified_payment_receipt_if_needed(db, payment, "payment status reconciliation")
                db.add(ActivityLog(
                    action="Payment Verified",
                    user=payment.email or payment.taxpayer_name,
                    details=f"Payment {ref_number} verified via status check",
                    type="transaction",
                ))
            elif payment_status == "failed" and payment.status not in {"Failed", "PAYMENT_REJECTED"}:
                payment.status = "PAYMENT_REJECTED" if payment.source_module == "rpt_online_payment" else "Failed"
                payment.paymongo_status = "failed"
                db.add(ActivityLog(
                    action="Payment Failed",
                    user=payment.email or payment.taxpayer_name,
                    details=f"Payment {ref_number} failed",
                    type="transaction",
                ))

        failure_status = get_failure_status(payment)
        if failure_status and payment.status != failure_status:
            payment.status = failure_status

        if is_confirmed_payment(payment) and payment.status not in {"Verified", "PAYMENT_SUBMITTED", "PAYMENT_VERIFIED", "OR_GENERATED", "COMPLETED"}:
            mark_payment_submitted(payment)
            send_verified_payment_receipt_if_needed(db, payment, "final payment reconciliation")
        
        db.commit()
        db.refresh(payment)
        
    except Exception as e:
        db.add(ActivityLog(
            action="PayMongo Status Check Error",
            user="system",
            details=f"Error checking PayMongo status for {ref_number}: {str(e)}",
            type="error",
        ))
        db.commit()
    
    return serialize_payment(payment)


@router.delete("/{payment_id}")
async def delete_payment(payment_id: int, db: Session = Depends(get_db)):
    payment = db.query(Payment).filter(Payment.id == payment_id).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    
    ref_number = payment.ref_number
    taxpayer_name = payment.taxpayer_name
    
    db.delete(payment)
    db.add(ActivityLog(
        action="Payment Deleted",
        user="branch_personnel",
        details=f"Payment {ref_number} for {taxpayer_name} was deleted",
        type="transaction",
    ))
    db.commit()
    
    return {"message": "Payment deleted successfully", "ref_number": ref_number}
