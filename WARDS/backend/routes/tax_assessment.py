from __future__ import annotations

import json
import mimetypes
import re
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from passlib.context import CryptContext
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from database.models import (
    ActivityLog,
    Branch,
    BusinessRegistry,
    CitizenUser,
    TaxAssessmentRecord,
    TaxpayerIdentifierSubmission,
    get_db,
)
from middleware.admin_auth import require_main_admin
from middleware.user_auth import get_current_user
from services.email_service import (
    send_account_change_notification_email,
    send_taxpayer_identifier_submission_email,
    send_taxpayer_verification_status_email,
)
from utils.field_crypto import apply_citizen_user_security, apply_tax_assessment_record_security, apply_taxpayer_identifier_submission_security, build_redacted_text, get_decrypted_or_raw, hash_aware_match, hash_optional_value, set_encrypted_hash_companions, tax_assessment_value, taxpayer_submission_value
from utils.security_validation import (
    ensure_email_is_unique,
    ensure_tin_is_unique,
    normalize_citizen_full_name,
    normalize_email,
    normalize_identity_name,
    normalize_ph_contact_number,
    normalize_tin,
    validate_strong_password,
)

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

UPLOAD_DIR = Path(__file__).resolve().parents[1] / "uploads" / "taxpayer_identifiers"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_UPLOAD_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".doc", ".docx"}
MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024
TAXPAYER_TYPES = {"Individual", "Business Owner"}
SUBMISSION_TYPES = {"RPT", "BT"}
REVIEWABLE_STATUSES = {"Pending Verification", "Verified", "Rejected"}
ACTIVE_ASSESSMENT_STATUSES = {"Active", "Inactive"}
IDENTIFIER_PATTERN = re.compile(r"^[A-Z0-9-]{6,40}$")


class PublicProfileUpdateRequest(BaseModel):
    full_name: str
    email: str
    mobile_number: str
    address: str | None = None
    taxpayer_type: str
    tin: str | None = None
    current_password: str


class SubmissionReviewRequest(BaseModel):
    status: str
    remarks: str | None = None


class PublicPasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str
    confirm_new_password: str


class TaxAssessmentUpsertRequest(BaseModel):
    assessment_id: int | None = None
    citizen_user_id: int | None = None
    submission_id: int | None = None
    branch_id: int | None = None
    tax_type: str
    assessment_status: str = "Active"
    verification_status: str = "Verified"
    taxpayer_name: str
    taxpayer_email: str | None = None
    taxpayer_type: str = "Individual"
    mobile_number: str | None = None
    address: str | None = None
    tax_year: str | None = None
    remarks: str | None = None
    rejection_reason: str | None = None
    visible_to_taxpayer: bool = True
    tdn: str | None = None
    property_type: str | None = None
    property_address: str | None = None
    fair_market_value: float = Field(default=0, ge=0)
    assessment_level: float = Field(default=0, ge=0)
    months_late: int = Field(default=0, ge=0)
    discount_rate: float = Field(default=0, ge=0)
    mayor_permit_number: str | None = None
    sec_dti_cda_number: str | None = None
    business_name: str | None = None
    business_type: str | None = None
    annual_gross_sales: float = Field(default=0, ge=0)
    business_tax_rate: float = Field(default=0, ge=0)


def normalize_taxpayer_type(value: str) -> str:
    normalized = re.sub(r"\s+", " ", (value or "").strip())
    if normalized not in TAXPAYER_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported taxpayer type.")
    return normalized


def normalize_submission_type(value: str) -> str:
    normalized = (value or "").strip().upper()
    if normalized not in SUBMISSION_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported submission type.")
    return normalized


def normalize_identifier(value: str, label: str) -> str:
    normalized = (value or "").strip().upper()
    if not normalized or not IDENTIFIER_PATTERN.fullmatch(normalized):
        raise HTTPException(status_code=400, detail=f"Invalid {label} format.")
    return normalized


def normalize_mobile_number(value: str) -> str:
    return normalize_ph_contact_number(value)


def serialize_submission(record: TaxpayerIdentifierSubmission) -> dict:
    return {
        "id": record.id,
        "citizen_user_id": record.citizen_user_id,
        "branch_id": record.branch_id,
        "submission_type": taxpayer_submission_value(record, "submission_type"),
        "taxpayer_type": taxpayer_submission_value(record, "taxpayer_type"),
        "full_name": taxpayer_submission_value(record, "full_name"),
        "email": taxpayer_submission_value(record, "email"),
        "mobile_number": taxpayer_submission_value(record, "mobile_number"),
        "address": taxpayer_submission_value(record, "address"),
        "tdn": taxpayer_submission_value(record, "tdn"),
        "mayor_permit_number": taxpayer_submission_value(record, "mayor_permit_number"),
        "sec_dti_cda_number": taxpayer_submission_value(record, "sec_dti_cda_number"),
        "supporting_file_name": taxpayer_submission_value(record, "supporting_file_name"),
        "status": taxpayer_submission_value(record, "status"),
        "remarks": taxpayer_submission_value(record, "remarks"),
        "reviewed_by": taxpayer_submission_value(record, "reviewed_by"),
        "reviewed_at": record.reviewed_at.isoformat() if record.reviewed_at else None,
        "created_at": record.created_at.isoformat() if record.created_at else None,
        "updated_at": record.updated_at.isoformat() if record.updated_at else None,
        "file_download_url": f"/api/tax-assessment/submissions/{record.id}/file" if taxpayer_submission_value(record, "supporting_file_path") else None,
    }


def serialize_assessment(record: TaxAssessmentRecord) -> dict:
    return {
        "id": record.id,
        "citizen_user_id": record.citizen_user_id,
        "submission_id": record.submission_id,
        "branch_id": record.branch_id,
        "tax_type": tax_assessment_value(record, "tax_type"),
        "assessment_status": tax_assessment_value(record, "assessment_status"),
        "verification_status": tax_assessment_value(record, "verification_status"),
        "taxpayer_name": tax_assessment_value(record, "taxpayer_name"),
        "taxpayer_email": tax_assessment_value(record, "taxpayer_email"),
        "taxpayer_type": tax_assessment_value(record, "taxpayer_type"),
        "mobile_number": tax_assessment_value(record, "mobile_number"),
        "address": tax_assessment_value(record, "address"),
        "tax_year": tax_assessment_value(record, "tax_year"),
        "remarks": tax_assessment_value(record, "remarks"),
        "rejection_reason": tax_assessment_value(record, "rejection_reason"),
        "visible_to_taxpayer": record.visible_to_taxpayer,
        "tdn": tax_assessment_value(record, "tdn"),
        "property_type": tax_assessment_value(record, "property_type"),
        "property_address": tax_assessment_value(record, "property_address"),
        "fair_market_value": float(record.fair_market_value or 0),
        "assessment_level": float(record.assessment_level or 0),
        "months_late": int(record.months_late or 0),
        "discount_rate": float(record.discount_rate or 0),
        "assessed_value": float(record.assessed_value or 0),
        "basic_tax_due": float(record.basic_tax_due or 0),
        "sef_tax": float(record.sef_tax or 0),
        "penalties": float(record.penalties or 0),
        "discounts": float(record.discounts or 0),
        "final_total_amount_due": float(record.final_total_amount_due or 0),
        "mayor_permit_number": tax_assessment_value(record, "mayor_permit_number"),
        "sec_dti_cda_number": tax_assessment_value(record, "sec_dti_cda_number"),
        "business_name": tax_assessment_value(record, "business_name"),
        "business_type": tax_assessment_value(record, "business_type"),
        "annual_gross_sales": float(record.annual_gross_sales or 0),
        "business_tax_rate": float(record.business_tax_rate or 0),
        "amount_due": float(record.amount_due or 0),
        "created_by": tax_assessment_value(record, "created_by"),
        "updated_by": tax_assessment_value(record, "updated_by"),
        "created_at": record.created_at.isoformat() if record.created_at else None,
        "updated_at": record.updated_at.isoformat() if record.updated_at else None,
    }


def compute_rpt_totals(fair_market_value: float, assessment_level: float, months_late: int, discount_rate: float) -> dict:
    assessed_value = round(float(fair_market_value or 0) * float(assessment_level or 0), 2)
    basic_tax_due = round(assessed_value * 0.02, 2)
    sef_tax = round(assessed_value * 0.01, 2)
    base_total = basic_tax_due + sef_tax
    penalties = round(base_total * 0.02 * int(months_late or 0), 2)
    discounts = round(base_total * float(discount_rate or 0), 2)
    final_total_amount_due = round(max(base_total + penalties - discounts, 0), 2)
    return {
        "assessed_value": assessed_value,
        "basic_tax_due": basic_tax_due,
        "sef_tax": sef_tax,
        "penalties": penalties,
        "discounts": discounts,
        "final_total_amount_due": final_total_amount_due,
    }


def compute_bt_amount(annual_gross_sales: float, business_tax_rate: float) -> float:
    return round(max(float(annual_gross_sales or 0) * float(business_tax_rate or 0), 0), 2)


def citizen_email(user: CitizenUser) -> str | None:
    return get_decrypted_or_raw(user, "email") or user.email


def citizen_name(user: CitizenUser) -> str | None:
    return get_decrypted_or_raw(user, "full_name") or user.full_name


def citizen_tin(user: CitizenUser) -> str | None:
    return get_decrypted_or_raw(user, "tin") or user.tin


def citizen_contact(user: CitizenUser) -> str | None:
    return get_decrypted_or_raw(user, "contact_number") or user.contact_number


def citizen_address(user: CitizenUser) -> str | None:
    return get_decrypted_or_raw(user, "address") or user.address


def get_citizen_profile_snapshot(user: CitizenUser) -> dict:
    return {
        "full_name": citizen_name(user),
        "email": citizen_email(user),
        "mobile_number": citizen_contact(user),
        "address": citizen_address(user),
        "taxpayer_type": user.taxpayer_type or "Individual",
        "tin": citizen_tin(user),
    }


def sync_citizen_profile_to_related_records(
    db: Session,
    *,
    citizen_user_id: int,
    full_name: str,
    email: str,
    mobile_number: str,
    address: str | None,
):
    submissions = (
        db.query(TaxpayerIdentifierSubmission)
        .filter(TaxpayerIdentifierSubmission.citizen_user_id == citizen_user_id)
        .all()
    )
    for submission in submissions:
        submission.full_name = full_name
        submission.email = email
        submission.mobile_number = mobile_number
        submission.address = address
        apply_taxpayer_identifier_submission_security(submission)

    assessments = (
        db.query(TaxAssessmentRecord)
        .filter(TaxAssessmentRecord.citizen_user_id == citizen_user_id)
        .all()
    )
    for assessment in assessments:
        assessment.taxpayer_name = full_name
        assessment.taxpayer_email = email
        assessment.mobile_number = mobile_number
        assessment.address = address
        apply_tax_assessment_record_security(assessment)


def verify_citizen_password(user: CitizenUser, password: str | None):
    if not password or not pwd_context.verify(password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect account password.")


def changed_profile_fields(current_user: CitizenUser, payload: PublicProfileUpdateRequest, normalized_email: str, mobile_number: str, taxpayer_type: str, normalized_tin: str | None) -> list[str]:
    changes = []
    comparisons = (
        ("Full Name", citizen_name(current_user), re.sub(r"\s+", " ", (payload.full_name or "").strip())),
        ("Email Address", citizen_email(current_user), normalized_email),
        ("Contact Number", citizen_contact(current_user), mobile_number),
        ("Address", citizen_address(current_user) or "", (payload.address or "").strip()),
        ("Taxpayer Type", current_user.taxpayer_type or "Individual", taxpayer_type),
        ("Tax Identification Number", citizen_tin(current_user) or "", normalized_tin or ""),
    )
    for label, old_value, new_value in comparisons:
        if (old_value or "") != (new_value or ""):
            changes.append(label)
    return changes


def validate_assessment_payload(payload: TaxAssessmentUpsertRequest, *, tax_type: str, taxpayer_type: str):
    taxpayer_name = re.sub(r"\s+", " ", (payload.taxpayer_name or "").strip())
    if not taxpayer_name:
        raise HTTPException(status_code=400, detail="Taxpayer Name is required.")

    if payload.taxpayer_email:
        normalize_email(payload.taxpayer_email)

    if payload.mobile_number:
        normalize_mobile_number(payload.mobile_number)

    if tax_type == "RPT":
        if not (payload.property_type or "").strip():
            raise HTTPException(status_code=400, detail="Property Type is required for RPT assessments.")
        if not (payload.property_address or "").strip():
            raise HTTPException(status_code=400, detail="Property Address is required for RPT assessments.")
        if float(payload.fair_market_value or 0) <= 0:
            raise HTTPException(status_code=400, detail="Fair Market Value must be greater than 0.")
        if float(payload.assessment_level or 0) <= 0 or float(payload.assessment_level or 0) > 1:
            raise HTTPException(status_code=400, detail="Assessment Level must be greater than 0 and not exceed 1.")
        if float(payload.discount_rate or 0) < 0 or float(payload.discount_rate or 0) > 1:
            raise HTTPException(status_code=400, detail="Discount Rate must be between 0 and 1.")
        return

    if taxpayer_type != "Business Owner":
        raise HTTPException(status_code=400, detail="Business Tax assessments require taxpayer type Business Owner.")
    if not (payload.business_name or "").strip():
        raise HTTPException(status_code=400, detail="Business Name is required for BT assessments.")
    if not (payload.business_type or "").strip():
        raise HTTPException(status_code=400, detail="Business Type is required for BT assessments.")
    if float(payload.annual_gross_sales or 0) <= 0:
        raise HTTPException(status_code=400, detail="Annual Gross Sales must be greater than 0.")
    if float(payload.business_tax_rate or 0) <= 0 or float(payload.business_tax_rate or 0) > 1:
        raise HTTPException(status_code=400, detail="Business Tax Rate must be greater than 0 and not exceed 1.")


def ensure_identifier_not_owned_by_another_user(
    db: Session,
    *,
    submission_type: str,
    citizen_user_id: int,
    tdn: str | None = None,
    mayor_permit_number: str | None = None,
    sec_dti_cda_number: str | None = None,
    exclude_submission_id: int | None = None,
    exclude_assessment_id: int | None = None,
):
    submission_query = db.query(TaxpayerIdentifierSubmission).filter(
        TaxpayerIdentifierSubmission.citizen_user_id != citizen_user_id,
    )
    assessment_query = db.query(TaxAssessmentRecord).filter(
        TaxAssessmentRecord.citizen_user_id != citizen_user_id,
    )

    if exclude_submission_id:
        submission_query = submission_query.filter(TaxpayerIdentifierSubmission.id != exclude_submission_id)
    if exclude_assessment_id:
        assessment_query = assessment_query.filter(TaxAssessmentRecord.id != exclude_assessment_id)

    if submission_type == "RPT" and tdn:
        if submission_query.filter(hash_aware_match(TaxpayerIdentifierSubmission, "tdn", tdn)).first():
            raise HTTPException(status_code=400, detail="This Tax Declaration Number is already submitted by another taxpayer.")
        if assessment_query.filter(hash_aware_match(TaxAssessmentRecord, "tdn", tdn)).first():
            raise HTTPException(status_code=400, detail="This Tax Declaration Number is already assigned to another taxpayer.")

    if submission_type == "BT" and mayor_permit_number and sec_dti_cda_number:
        if submission_query.filter(
            hash_aware_match(TaxpayerIdentifierSubmission, "mayor_permit_number", mayor_permit_number),
            hash_aware_match(TaxpayerIdentifierSubmission, "sec_dti_cda_number", sec_dti_cda_number),
        ).first():
            raise HTTPException(status_code=400, detail="This Business Tax identifier is already submitted by another taxpayer.")
        if assessment_query.filter(
            hash_aware_match(TaxAssessmentRecord, "mayor_permit_number", mayor_permit_number),
            hash_aware_match(TaxAssessmentRecord, "sec_dti_cda_number", sec_dti_cda_number),
        ).first():
            raise HTTPException(status_code=400, detail="This Business Tax identifier is already assigned to another taxpayer.")


def store_supporting_file(upload: UploadFile, file_bytes: bytes, submission_type: str, identifier_value: str) -> tuple[str, str, str]:
    extension = Path(upload.filename or "document").suffix.lower()
    if extension not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported file type. Use PDF, PNG, JPG, JPEG, DOC, or DOCX.")
    if len(file_bytes) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(status_code=400, detail="Uploaded file exceeds the 10MB limit.")

    safe_identifier = re.sub(r"[^A-Z0-9-]", "", identifier_value.upper())[:40]
    filename = f"{submission_type.lower()}-{safe_identifier}-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}{extension}"
    destination = UPLOAD_DIR / filename
    destination.write_bytes(file_bytes)
    mime_type = upload.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return str(destination), upload.filename or filename, mime_type


def sync_business_registry_from_assessment(db: Session, assessment: TaxAssessmentRecord):
    assessment_tax_type = tax_assessment_value(assessment, "tax_type")
    assessment_permit = tax_assessment_value(assessment, "mayor_permit_number")
    assessment_registration = tax_assessment_value(assessment, "sec_dti_cda_number")
    assessment_taxpayer_name = tax_assessment_value(assessment, "taxpayer_name")
    assessment_business_name = tax_assessment_value(assessment, "business_name")
    assessment_business_type = tax_assessment_value(assessment, "business_type")
    assessment_verification_status = tax_assessment_value(assessment, "verification_status")

    if assessment_tax_type != "BT" or not assessment_permit or not assessment_registration:
        return

    record = db.query(BusinessRegistry).filter(
        or_(
            BusinessRegistry.mayor_permit_number == assessment_permit,
            BusinessRegistry.mayor_permit_number_hash == hash_optional_value(assessment_permit),
        )
    ).first()
    if not record:
        record = BusinessRegistry(
            business_name=assessment_business_name or assessment_taxpayer_name,
            owner_name=assessment_taxpayer_name,
            mayor_permit_number=assessment_permit,
            sec_dti_cda_number=assessment_registration,
        )
        db.add(record)

    record.business_name = assessment_business_name or assessment_taxpayer_name
    record.owner_name = assessment_taxpayer_name
    record.business_type = assessment_business_type
    record.branch_id = assessment.branch_id
    record.branch_assigned = (get_decrypted_or_raw(assessment.branch, "name") or assessment.branch.name) if assessment.branch else record.branch_assigned
    record.annual_gross_sales = float(assessment.annual_gross_sales or 0)
    record.assessed_tax_due = float(assessment.amount_due or 0)
    record.business_status = "ACTIVE" if assessment_verification_status == "Verified" else "PENDING_VERIFICATION"
    for field_name in (
        "business_name",
        "owner_name",
        "mayor_permit_number",
        "sec_dti_cda_number",
        "business_type",
        "branch_assigned",
        "tin",
    ):
        set_encrypted_hash_companions(record, field_name)
    record.business_name = build_redacted_text("BUSINESS_NAME", assessment_business_name or assessment_taxpayer_name, 255)
    record.owner_name = build_redacted_text("BUSINESS_OWNER", assessment_taxpayer_name, 255)
    record.mayor_permit_number = build_redacted_text("MAYOR_PERMIT", assessment_permit, 255)
    record.sec_dti_cda_number = build_redacted_text("REGISTRATION", assessment_registration, 255)
    record.business_type = build_redacted_text("BUSINESS_TYPE", assessment_business_type, 255)
    record.branch_assigned = build_redacted_text("BRANCH_ASSIGNMENT", (get_decrypted_or_raw(assessment.branch, "name") or assessment.branch.name) if assessment.branch else record.branch_assigned, 255)
    record.tin = build_redacted_text("BUSINESS_TIN", getattr(assessment, "tin", None), 255)


@router.get("/user/account")
async def get_public_account_management(
    db: Session = Depends(get_db),
    current_user: CitizenUser = Depends(get_current_user),
):
    submissions = (
        db.query(TaxpayerIdentifierSubmission)
        .filter(TaxpayerIdentifierSubmission.citizen_user_id == current_user.id)
        .order_by(TaxpayerIdentifierSubmission.created_at.desc())
        .all()
    )
    assessments = (
        db.query(TaxAssessmentRecord)
        .filter(TaxAssessmentRecord.citizen_user_id == current_user.id)
        .order_by(TaxAssessmentRecord.created_at.desc())
        .all()
    )
    return {
        "profile": {
            "id": current_user.id,
            "full_name": citizen_name(current_user),
            "email": citizen_email(current_user),
            "mobile_number": citizen_contact(current_user),
            "address": citizen_address(current_user),
            "taxpayer_type": current_user.taxpayer_type or "Individual",
            "tin": citizen_tin(current_user),
        },
        "submissions": [serialize_submission(record) for record in submissions],
        "assessments": [serialize_assessment(record) for record in assessments],
    }


@router.put("/user/account/profile")
async def update_public_account_profile(
    payload: PublicProfileUpdateRequest,
    db: Session = Depends(get_db),
    current_user: CitizenUser = Depends(get_current_user),
):
    verify_citizen_password(current_user, payload.current_password)
    normalized_email = normalize_email(payload.email, check_deliverability=True)
    ensure_email_is_unique(db, normalized_email, exclude_citizen_id=current_user.id)
    taxpayer_type = normalize_taxpayer_type(payload.taxpayer_type)
    mobile_number = normalize_mobile_number(payload.mobile_number)
    full_name = normalize_citizen_full_name(payload.full_name)

    normalized_tin = None
    if (payload.tin or "").strip():
        normalized_tin = normalize_tin(payload.tin)
        ensure_tin_is_unique(db, normalized_tin, exclude_citizen_id=current_user.id)

    previous_email = citizen_email(current_user)
    previous_name = citizen_name(current_user) or full_name
    changes = changed_profile_fields(current_user, payload, normalized_email, mobile_number, taxpayer_type, normalized_tin)

    current_user.full_name = full_name
    current_user.email = normalized_email
    current_user.contact_number = mobile_number
    current_user.address = (payload.address or "").strip() or None
    current_user.taxpayer_type = taxpayer_type
    current_user.tin = normalized_tin
    apply_citizen_user_security(current_user)
    sync_citizen_profile_to_related_records(
        db,
        citizen_user_id=current_user.id,
        full_name=full_name,
        email=normalized_email,
        mobile_number=mobile_number,
        address=current_user.address,
    )

    db.add(ActivityLog(
        action="Public Taxpayer Profile Updated",
        user=normalized_email,
        details=f"Taxpayer profile updated for citizen user {current_user.id}",
        type="user",
    ))
    db.commit()
    db.refresh(current_user)

    recipients = [email for email in {previous_email, citizen_email(current_user)} if email]
    for recipient_email in recipients:
        send_account_change_notification_email(
            recipient_email=recipient_email,
            display_name=previous_name,
            account_type="public",
            change_summary="Your taxpayer profile information was updated.",
            changed_fields=changes or ["Taxpayer Profile"],
        )

    return {
        "message": "Account profile updated successfully.",
        "profile": {
            "id": current_user.id,
            **get_citizen_profile_snapshot(current_user),
        },
    }


@router.put("/user/account/password")
async def change_public_account_password(
    payload: PublicPasswordChangeRequest,
    db: Session = Depends(get_db),
    current_user: CitizenUser = Depends(get_current_user),
):
    verify_citizen_password(current_user, payload.current_password)
    if payload.new_password != payload.confirm_new_password:
        raise HTTPException(status_code=400, detail="New password and confirmation do not match.")
    if pwd_context.verify(payload.new_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="New password must be different from your current password.")
    validate_strong_password(payload.new_password)

    current_user.hashed_password = pwd_context.hash(payload.new_password)
    db.add(ActivityLog(
        action="Public Taxpayer Password Changed",
        user=citizen_email(current_user),
        details=f"Password changed for citizen user {current_user.id}",
        type="user",
    ))
    db.commit()

    send_account_change_notification_email(
        recipient_email=citizen_email(current_user),
        display_name=citizen_name(current_user) or "Taxpayer",
        account_type="public",
        change_summary="Your WARDS account password was changed.",
        changed_fields=["Password"],
    )

    return {"message": "Password changed successfully."}


@router.post("/user/account/submissions")
async def create_taxpayer_identifier_submission(
    submission_type: str = Form(...),
    taxpayer_type: str = Form(...),
    branch_id: int | None = Form(default=None),
    full_name: str = Form(...),
    email: str = Form(...),
    mobile_number: str = Form(...),
    address: str | None = Form(default=None),
    tdn: str | None = Form(default=None),
    mayor_permit_number: str | None = Form(default=None),
    sec_dti_cda_number: str | None = Form(default=None),
    supporting_file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: CitizenUser = Depends(get_current_user),
):
    normalized_submission_type = normalize_submission_type(submission_type)
    normalized_taxpayer_type = normalize_taxpayer_type(taxpayer_type)
    profile_snapshot = get_citizen_profile_snapshot(current_user)
    normalized_email = normalize_email(profile_snapshot["email"] or email)
    normalized_mobile = normalize_mobile_number(profile_snapshot["mobile_number"] or mobile_number)
    normalized_full_name = re.sub(r"\s+", " ", (profile_snapshot["full_name"] or full_name).strip())
    if not normalized_full_name:
        raise HTTPException(status_code=400, detail="Full Name is required.")
    normalized_address = (profile_snapshot["address"] or address or "").strip() or None
    normalized_taxpayer_type = normalize_taxpayer_type(profile_snapshot["taxpayer_type"] or normalized_taxpayer_type)

    normalized_tdn = None
    normalized_permit = None
    normalized_registration = None
    identifier_value = ""

    if normalized_submission_type == "RPT":
        normalized_tdn = normalize_identifier(tdn or "", "Tax Declaration Number")
        identifier_value = normalized_tdn
    else:
        if normalized_taxpayer_type != "Business Owner":
            raise HTTPException(status_code=400, detail="Business Tax submissions require taxpayer type Business Owner.")
        normalized_permit = normalize_identifier(mayor_permit_number or "", "Mayor's Permit Number")
        normalized_registration = normalize_identifier(sec_dti_cda_number or "", "SEC/DTI/CDA Number")
        identifier_value = f"{normalized_permit} / {normalized_registration}"

    ensure_identifier_not_owned_by_another_user(
        db,
        submission_type=normalized_submission_type,
        citizen_user_id=current_user.id,
        tdn=normalized_tdn,
        mayor_permit_number=normalized_permit,
        sec_dti_cda_number=normalized_registration,
    )

    file_bytes = await supporting_file.read()
    stored_path, stored_name, stored_mime = store_supporting_file(
        supporting_file,
        file_bytes,
        normalized_submission_type,
        normalized_tdn or normalized_permit or "identifier",
    )

    branch = db.query(Branch).filter(Branch.id == branch_id).first() if branch_id else None
    submission = TaxpayerIdentifierSubmission(
        citizen_user_id=current_user.id,
        branch_id=branch.id if branch else None,
        submission_type=normalized_submission_type,
        taxpayer_type=normalized_taxpayer_type,
        full_name=normalized_full_name,
        email=normalized_email,
        mobile_number=normalized_mobile,
        address=normalized_address,
        tdn=normalized_tdn,
        mayor_permit_number=normalized_permit,
        sec_dti_cda_number=normalized_registration,
        supporting_file_path=stored_path,
        supporting_file_name=stored_name,
        supporting_file_mime=stored_mime,
        status="Pending Verification",
    )
    apply_taxpayer_identifier_submission_security(submission)
    db.add(submission)
    db.add(ActivityLog(
        action="Taxpayer Identifier Submitted",
        user=citizen_email(current_user),
        details=f"{normalized_submission_type} identifier submitted by citizen user {current_user.id}",
        type="user",
    ))
    db.commit()
    db.refresh(submission)

    send_taxpayer_identifier_submission_email(
        recipient_email=taxpayer_submission_value(submission, "email"),
        display_name=taxpayer_submission_value(submission, "full_name"),
        submission_type=taxpayer_submission_value(submission, "submission_type"),
        identifier_value=identifier_value,
        submitted_at=submission.created_at,
    )

    return {
        "message": "Identifier submission saved and marked Pending Verification.",
        "submission": serialize_submission(submission),
    }


@router.get("/user/account/assessments")
async def list_public_assessments(
    tax_type: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: CitizenUser = Depends(get_current_user),
):
    query = db.query(TaxAssessmentRecord).filter(
        TaxAssessmentRecord.citizen_user_id == current_user.id,
        TaxAssessmentRecord.visible_to_taxpayer.is_(True),
    )
    if tax_type:
        query = query.filter(hash_aware_match(TaxAssessmentRecord, "tax_type", normalize_submission_type(tax_type)))
    assessments = query.order_by(TaxAssessmentRecord.created_at.desc()).all()
    return {"items": [serialize_assessment(record) for record in assessments]}


@router.get("/submissions/{submission_id}/file")
async def download_submission_file(
    submission_id: int,
    db: Session = Depends(get_db),
    current_user: CitizenUser | None = Depends(get_current_user),
):
    submission = db.query(TaxpayerIdentifierSubmission).filter(TaxpayerIdentifierSubmission.id == submission_id).first()
    file_path_value = taxpayer_submission_value(submission, "supporting_file_path") if submission else None
    if not submission or not file_path_value:
        raise HTTPException(status_code=404, detail="Supporting file not found.")

    path = Path(file_path_value)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Supporting file is no longer available.")

    is_public_owner = current_user is not None and submission.citizen_user_id == current_user.id
    if not is_public_owner:
        raise HTTPException(status_code=403, detail="You do not have access to this file.")

    return FileResponse(
        path,
        filename=taxpayer_submission_value(submission, "supporting_file_name") or path.name,
        media_type=taxpayer_submission_value(submission, "supporting_file_mime"),
    )


@router.get("/admin/submissions")
async def list_taxpayer_submissions(
    search: str | None = Query(default=None),
    status_filter: str | None = Query(default=None),
    submission_type: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user=Depends(require_main_admin()),
):
    query = db.query(TaxpayerIdentifierSubmission)
    if submission_type:
        query = query.filter(hash_aware_match(TaxpayerIdentifierSubmission, "submission_type", normalize_submission_type(submission_type)))
    if status_filter:
        query = query.filter(hash_aware_match(TaxpayerIdentifierSubmission, "status", status_filter))
    items = query.order_by(TaxpayerIdentifierSubmission.created_at.desc()).all()
    if search:
        term = search.strip().lower()
        items = [
            item for item in items
            if any(
                term in ((taxpayer_submission_value(item, field_name) or "").lower())
                for field_name in ("full_name", "tdn", "mayor_permit_number", "sec_dti_cda_number")
            )
        ]
    return {"items": [serialize_submission(item) for item in items]}


@router.get("/admin/submissions/{submission_id}/file")
async def download_submission_file_admin(
    submission_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_main_admin()),
):
    submission = db.query(TaxpayerIdentifierSubmission).filter(TaxpayerIdentifierSubmission.id == submission_id).first()
    file_path_value = taxpayer_submission_value(submission, "supporting_file_path") if submission else None
    if not submission or not file_path_value:
        raise HTTPException(status_code=404, detail="Supporting file not found.")
    path = Path(file_path_value)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Supporting file is no longer available.")
    return FileResponse(
        path,
        filename=taxpayer_submission_value(submission, "supporting_file_name") or path.name,
        media_type=taxpayer_submission_value(submission, "supporting_file_mime"),
    )


@router.put("/admin/submissions/{submission_id}/review")
async def review_taxpayer_submission(
    submission_id: int,
    payload: SubmissionReviewRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_main_admin()),
):
    submission = db.query(TaxpayerIdentifierSubmission).filter(TaxpayerIdentifierSubmission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Taxpayer submission not found.")

    if payload.status not in REVIEWABLE_STATUSES:
        raise HTTPException(status_code=400, detail="Unsupported verification status.")

    submission.status = payload.status
    submission.remarks = (payload.remarks or "").strip() or None
    submission.reviewed_by = current_user.username
    submission.reviewed_at = datetime.utcnow()
    apply_taxpayer_identifier_submission_security(submission)

    if payload.status == "Verified":
        owner = db.query(CitizenUser).filter(CitizenUser.id == submission.citizen_user_id).first()
        if owner:
            owner.taxpayer_type = submission.taxpayer_type
            owner.address = submission.address or owner.address
            owner.contact_number = submission.mobile_number or owner.contact_number
            apply_citizen_user_security(owner)

    db.add(ActivityLog(
        action="Taxpayer Submission Reviewed",
        user=current_user.username,
        details=f"Submission {submission.id} marked {submission.status}",
        type="admin",
    ))
    db.commit()
    db.refresh(submission)

    identifier_value = taxpayer_submission_value(submission, "tdn") or f"{taxpayer_submission_value(submission, 'mayor_permit_number') or 'N/A'} / {taxpayer_submission_value(submission, 'sec_dti_cda_number') or 'N/A'}"
    send_taxpayer_verification_status_email(
        recipient_email=taxpayer_submission_value(submission, "email"),
        display_name=taxpayer_submission_value(submission, "full_name"),
        submission_type=taxpayer_submission_value(submission, "submission_type"),
        status_label=taxpayer_submission_value(submission, "status"),
        identifier_value=identifier_value,
        remarks=taxpayer_submission_value(submission, "remarks"),
    )

    return {"message": "Submission review saved.", "submission": serialize_submission(submission)}


@router.delete("/admin/submissions/{submission_id}")
async def delete_taxpayer_submission(
    submission_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_main_admin()),
):
    submission = db.query(TaxpayerIdentifierSubmission).filter(TaxpayerIdentifierSubmission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Taxpayer submission not found.")

    linked_assessment = db.query(TaxAssessmentRecord).filter(TaxAssessmentRecord.submission_id == submission.id).first()
    if linked_assessment:
        raise HTTPException(status_code=400, detail="Delete the linked assessment first before removing this taxpayer submission.")

    if submission.supporting_file_path:
        path = Path(taxpayer_submission_value(submission, "supporting_file_path") or submission.supporting_file_path)
        if path.exists():
            path.unlink()

    db.add(ActivityLog(
        action="Taxpayer Submission Deleted",
        user=current_user.username,
        details=f"Submission {submission.id} deleted",
        type="admin",
    ))
    db.delete(submission)
    db.commit()
    return {"message": "Taxpayer submission deleted successfully."}


@router.get("/admin/assessments")
async def list_tax_assessments(
    search: str | None = Query(default=None),
    tax_type: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user=Depends(require_main_admin()),
):
    query = db.query(TaxAssessmentRecord)
    if tax_type:
        query = query.filter(hash_aware_match(TaxAssessmentRecord, "tax_type", normalize_submission_type(tax_type)))
    items = query.order_by(TaxAssessmentRecord.created_at.desc()).all()
    if search:
        term = search.strip().lower()
        items = [
            item for item in items
            if any(
                term in ((tax_assessment_value(item, field_name) or "").lower())
                for field_name in ("taxpayer_name", "tdn", "mayor_permit_number", "sec_dti_cda_number", "business_name")
            )
        ]
    return {"items": [serialize_assessment(item) for item in items]}


@router.post("/admin/assessments")
async def upsert_tax_assessment(
    payload: TaxAssessmentUpsertRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_main_admin()),
):
    tax_type = normalize_submission_type(payload.tax_type)
    taxpayer_type = normalize_taxpayer_type(payload.taxpayer_type)
    assessment_status = (payload.assessment_status or "Active").strip()
    verification_status = (payload.verification_status or "Verified").strip()
    if assessment_status not in ACTIVE_ASSESSMENT_STATUSES:
        raise HTTPException(status_code=400, detail="Unsupported assessment status.")
    if verification_status not in REVIEWABLE_STATUSES:
        raise HTTPException(status_code=400, detail="Unsupported verification status.")

    record = None
    if payload.assessment_id:
        record = db.query(TaxAssessmentRecord).filter(TaxAssessmentRecord.id == payload.assessment_id).first()
        if not record:
            raise HTTPException(status_code=404, detail="Assessment record not found.")

    citizen_user = None
    if payload.citizen_user_id:
        citizen_user = db.query(CitizenUser).filter(CitizenUser.id == payload.citizen_user_id).first()
        if not citizen_user:
            raise HTTPException(status_code=404, detail="Taxpayer account not found.")

    submission = None
    if payload.submission_id:
        submission = db.query(TaxpayerIdentifierSubmission).filter(TaxpayerIdentifierSubmission.id == payload.submission_id).first()
        if not submission:
            raise HTTPException(status_code=404, detail="Taxpayer submission not found.")
        if citizen_user is None:
            citizen_user = db.query(CitizenUser).filter(CitizenUser.id == submission.citizen_user_id).first()

    if not citizen_user:
        raise HTTPException(status_code=400, detail="Select a taxpayer account or submission before creating an assessment.")

    branch = None
    if payload.branch_id:
        branch = db.query(Branch).filter(Branch.id == payload.branch_id).first()
        if not branch:
            raise HTTPException(status_code=404, detail="Assigned branch not found.")

    normalized_tdn = normalize_identifier(payload.tdn or "", "Tax Declaration Number") if tax_type == "RPT" else None
    normalized_permit = normalize_identifier(payload.mayor_permit_number or "", "Mayor's Permit Number") if tax_type == "BT" else None
    normalized_registration = normalize_identifier(payload.sec_dti_cda_number or "", "SEC/DTI/CDA Number") if tax_type == "BT" else None

    if tax_type == "RPT":
        if not normalized_tdn:
            raise HTTPException(status_code=400, detail="Tax Declaration Number is required for RPT assessments.")
    else:
        if taxpayer_type != "Business Owner":
            raise HTTPException(status_code=400, detail="Business Tax assessments require taxpayer type Business Owner.")
        if not normalized_permit or not normalized_registration:
            raise HTTPException(status_code=400, detail="Mayor's Permit Number and SEC/DTI/CDA Number are required for BT assessments.")

    validate_assessment_payload(payload, tax_type=tax_type, taxpayer_type=taxpayer_type)

    ensure_identifier_not_owned_by_another_user(
        db,
        submission_type=tax_type,
        citizen_user_id=citizen_user.id,
        tdn=normalized_tdn,
        mayor_permit_number=normalized_permit,
        sec_dti_cda_number=normalized_registration,
        exclude_assessment_id=record.id if record else None,
    )

    if record is None:
        record = TaxAssessmentRecord(
            citizen_user_id=citizen_user.id,
            submission_id=submission.id if submission else None,
            created_by=current_user.username,
        )
        db.add(record)

    record.citizen_user_id = citizen_user.id
    record.submission_id = submission.id if submission else record.submission_id
    record.branch_id = branch.id if branch else None
    record.tax_type = tax_type
    record.assessment_status = assessment_status
    record.verification_status = verification_status
    record.taxpayer_name = payload.taxpayer_name.strip()
    record.taxpayer_email = payload.taxpayer_email or citizen_user.email
    record.taxpayer_type = taxpayer_type
    record.mobile_number = payload.mobile_number or citizen_user.contact_number
    record.address = payload.address or citizen_user.address
    record.tax_year = (payload.tax_year or "").strip() or None
    record.remarks = (payload.remarks or "").strip() or None
    record.rejection_reason = (payload.rejection_reason or "").strip() or None
    record.visible_to_taxpayer = payload.visible_to_taxpayer
    record.updated_by = current_user.username
    record.tdn = normalized_tdn
    record.property_type = (payload.property_type or "").strip() or None
    record.property_address = (payload.property_address or "").strip() or None
    record.fair_market_value = payload.fair_market_value
    record.assessment_level = payload.assessment_level
    record.months_late = payload.months_late
    record.discount_rate = payload.discount_rate
    record.mayor_permit_number = normalized_permit
    record.sec_dti_cda_number = normalized_registration
    record.business_name = (payload.business_name or "").strip() or None
    record.business_type = (payload.business_type or "").strip() or None
    record.annual_gross_sales = payload.annual_gross_sales
    record.business_tax_rate = payload.business_tax_rate

    if tax_type == "RPT":
        totals = compute_rpt_totals(payload.fair_market_value, payload.assessment_level, payload.months_late, payload.discount_rate)
        record.assessed_value = totals["assessed_value"]
        record.basic_tax_due = totals["basic_tax_due"]
        record.sef_tax = totals["sef_tax"]
        record.penalties = totals["penalties"]
        record.discounts = totals["discounts"]
        record.final_total_amount_due = totals["final_total_amount_due"]
        record.amount_due = totals["final_total_amount_due"]
    else:
        record.assessed_value = 0
        record.basic_tax_due = 0
        record.sef_tax = 0
        record.penalties = 0
        record.discounts = 0
        record.final_total_amount_due = 0
        record.amount_due = compute_bt_amount(payload.annual_gross_sales, payload.business_tax_rate)

    if submission:
        submission.status = verification_status
        submission.remarks = record.remarks or record.rejection_reason
        submission.reviewed_by = current_user.username
        submission.reviewed_at = datetime.utcnow()
        apply_taxpayer_identifier_submission_security(submission)

    citizen_user.taxpayer_type = taxpayer_type
    citizen_user.contact_number = record.mobile_number or citizen_user.contact_number
    citizen_user.address = record.address or citizen_user.address

    if tax_type == "BT":
        sync_business_registry_from_assessment(db, record)

    apply_tax_assessment_record_security(record)

    db.add(ActivityLog(
        action="Tax Assessment Saved",
        user=current_user.username,
        details=f"{tax_type} assessment saved for citizen user {citizen_user.id}",
        type="admin",
    ))
    db.commit()
    db.refresh(record)
    return {"message": "Tax assessment saved successfully.", "assessment": serialize_assessment(record)}


@router.delete("/admin/assessments/{assessment_id}")
async def delete_tax_assessment(
    assessment_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_main_admin()),
):
    record = db.query(TaxAssessmentRecord).filter(TaxAssessmentRecord.id == assessment_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Assessment record not found.")

    db.add(ActivityLog(
        action="Tax Assessment Deleted",
        user=current_user.username,
        details=f"{tax_assessment_value(record, 'tax_type') or record.tax_type} assessment {record.id} deleted",
        type="admin",
    ))
    db.delete(record)
    db.commit()
    return {"message": "Assessment deleted successfully."}
