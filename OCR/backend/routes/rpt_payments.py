import os
from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from auth.utils import create_access_token, verify_password
from core.security_crypto import decrypt_optional_value, encrypt_optional_value
from core.security_hash import hash_optional_value
from core.security_phase2 import build_redacted_email, build_redacted_text, phase2_redaction_enabled
from database.config import get_db
from database.models import (
    BranchOffice,
    RPTPaymentItem,
    RPTPaymentLog,
    RPTPaymentProof,
    RPTPaymentStatus,
    RPTPaymentTransaction,
    RPTPropertyRecord,
    RPTReleaseMethod,
    Taxpayer,
)
from services.rpt_payment_service import (
    SEARCH_LIMIT_PER_DAY,
    append_payment_log,
    build_receipt_number,
    build_verification_code,
    build_wards_transaction_number,
    compute_rpt_breakdown,
    create_paymongo_checkout_session,
    generate_official_receipt_pdf,
    get_payment_item_property_address,
    get_payment_item_taxpayer_name,
    get_payment_log_field,
    get_payment_proof_field,
    initialize_rpt_demo_data,
    is_valid_tdn_format,
    get_branch_name,
    get_property_address,
    get_property_taxpayer_name,
    get_taxpayer_email,
    get_taxpayer_full_name,
    get_transaction_field,
    list_active_branches,
    normalize_tdn,
    record_search,
    save_payment_proof,
    send_official_receipt_email,
    searches_remaining_today,
    serialize_property,
    verify_paymongo_signature,
    verify_recaptcha_token,
)

router = APIRouter(prefix="/api/rpt-payments", tags=["rpt-payments"])

ALLOWED_PROOF_TYPES = {"image/jpeg", "image/png", "application/pdf"}
MAX_PROOF_SIZE = 5 * 1024 * 1024


class TaxpayerLoginRequest(BaseModel):
    email: str
    password: str


class RPTSearchRequest(BaseModel):
    branch_id: int
    tdn: str
    recaptcha_token: Optional[str] = None


class CheckoutItemRequest(BaseModel):
    property_id: int


class CheckoutRequest(BaseModel):
    branch_id: int
    items: list[CheckoutItemRequest]
    payment_method: str
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None


class TreasuryDecisionRequest(BaseModel):
    action: str = Field(..., pattern="^(approve|reject|clarify)$")
    remarks: Optional[str] = None


class ReleaseReceiptRequest(BaseModel):
    release_method: str = Field(..., pattern="^(DOWNLOAD|EMAIL|BRANCH_PICKUP|COURIER)$")
    release_email: Optional[str] = None
    courier_name: Optional[str] = None
    courier_tracking_number: Optional[str] = None
    courier_rider_details: Optional[str] = None


def serialize_taxpayer(taxpayer: Taxpayer) -> dict:
    full_name = decrypt_optional_value(taxpayer.full_name_enc) or taxpayer.full_name
    email = decrypt_optional_value(taxpayer.email_enc) or taxpayer.email
    return {
        "id": taxpayer.id,
        "full_name": full_name,
        "email": email,
        "email_verified": taxpayer.email_verified,
    }


def get_current_taxpayer(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
) -> Taxpayer:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Taxpayer authentication is required.")

    token = authorization.replace("Bearer ", "")
    from auth.utils import decode_access_token

    payload = decode_access_token(token)
    if not payload or payload.get("role") != "taxpayer":
        raise HTTPException(status_code=401, detail="Invalid taxpayer session.")

    token_subject = payload.get("sub")
    taxpayer = db.query(Taxpayer).filter(
        or_(Taxpayer.email == token_subject, Taxpayer.email_hash == hash_optional_value(token_subject))
    ).first()
    if not taxpayer:
        raise HTTPException(status_code=401, detail="Taxpayer account not found.")

    return taxpayer


def get_staff_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication is required.")

    token = authorization.replace("Bearer ", "")
    from routes.admin_auth import verify_session

    user = verify_session(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session.")
    return user


def serialize_transaction(transaction: RPTPaymentTransaction, db: Session) -> dict:
    branch = db.query(BranchOffice).filter(BranchOffice.id == transaction.branch_id).first()
    taxpayer = db.query(Taxpayer).filter(Taxpayer.id == transaction.taxpayer_id).first()
    items = db.query(RPTPaymentItem).filter(RPTPaymentItem.transaction_id == transaction.id).all()
    proofs = db.query(RPTPaymentProof).filter(RPTPaymentProof.transaction_id == transaction.id).all()
    logs = (
        db.query(RPTPaymentLog)
        .filter(RPTPaymentLog.transaction_id == transaction.id)
        .order_by(RPTPaymentLog.created_at.desc())
        .all()
    )

    branch_name = get_branch_name(branch) if branch else None
    taxpayer_name = get_taxpayer_full_name(taxpayer) if taxpayer else None
    taxpayer_email = get_taxpayer_email(taxpayer) if taxpayer else None

    return {
        "id": transaction.id,
        "wards_transaction_no": transaction.wards_transaction_no,
        "branch_id": transaction.branch_id,
        "branch_name": branch_name,
        "taxpayer_name": taxpayer_name,
        "taxpayer_email": taxpayer_email,
        "status": transaction.status.value,
        "payment_method": transaction.payment_method,
        "total_amount": float(Decimal(transaction.total_amount)),
        "payment_timestamp": transaction.payment_timestamp.isoformat() if transaction.payment_timestamp else None,
        "paymongo_checkout_session_id": transaction.paymongo_checkout_session_id,
        "paymongo_payment_intent_id": transaction.paymongo_payment_intent_id,
        "paymongo_payment_id": transaction.paymongo_payment_id,
        "paymongo_reference_id": get_transaction_field(transaction, "paymongo_reference_id"),
        "paymongo_checkout_url": get_transaction_field(transaction, "paymongo_checkout_url"),
        "proof_reference": get_transaction_field(transaction, "proof_reference"),
        "treasury_remarks": get_transaction_field(transaction, "treasury_remarks"),
        "clarification_message": get_transaction_field(transaction, "clarification_message"),
        "official_receipt_number": transaction.official_receipt_number,
        "official_receipt_pdf_path": get_transaction_field(transaction, "official_receipt_pdf_path"),
        "official_receipt_qr_code": transaction.official_receipt_qr_code,
        "release_method": transaction.release_method.value if transaction.release_method else None,
        "release_email": get_transaction_field(transaction, "release_email"),
        "courier_name": get_transaction_field(transaction, "courier_name"),
        "courier_tracking_number": get_transaction_field(transaction, "courier_tracking_number"),
        "courier_rider_details": get_transaction_field(transaction, "courier_rider_details"),
        "completed_at": transaction.completed_at.isoformat() if transaction.completed_at else None,
        "created_at": transaction.created_at.isoformat() if transaction.created_at else None,
        "updated_at": transaction.updated_at.isoformat() if transaction.updated_at else None,
        "items": [
            {
                "tdn": item.tdn,
                "taxpayer_name": get_payment_item_taxpayer_name(item),
                "property_address": get_payment_item_property_address(item),
                "fair_market_value": float(Decimal(item.fair_market_value)),
                "assessment_level": float(Decimal(item.assessment_level)),
                "assessed_value": float(Decimal(item.assessed_value)),
                "basic_tax_due": float(Decimal(item.basic_tax_due)),
                "sef_tax": float(Decimal(item.sef_tax)),
                "penalties": float(Decimal(item.penalties)),
                "discounts": float(Decimal(item.discounts)),
                "total_amount": float(Decimal(item.total_amount)),
            }
            for item in items
        ],
        "proofs": [
            {
                "file_path": get_payment_proof_field(proof, "file_path"),
                "original_filename": get_payment_proof_field(proof, "original_filename"),
                "uploaded_at": proof.uploaded_at.isoformat() if proof.uploaded_at else None,
            }
            for proof in proofs
        ],
        "logs": [
            {
                "status": log.status.value,
                "message": get_payment_log_field(log, "message"),
                "actor": get_payment_log_field(log, "actor"),
                "created_at": log.created_at.isoformat() if log.created_at else None,
            }
            for log in logs
        ],
    }


@router.post("/auth/login")
async def login_taxpayer(request: TaxpayerLoginRequest, db: Session = Depends(get_db)):
    normalized_email = request.email.strip().lower()
    taxpayer = db.query(Taxpayer).filter(
        or_(Taxpayer.email == normalized_email, Taxpayer.email_hash == hash_optional_value(normalized_email))
    ).first()
    if not taxpayer or not verify_password(request.password, taxpayer.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")

    token_email = decrypt_optional_value(taxpayer.email_enc) or taxpayer.email
    token = create_access_token({"sub": token_email, "role": "taxpayer"})
    return {
        "access_token": token,
        "token_type": "bearer",
        "taxpayer": serialize_taxpayer(taxpayer),
    }


@router.get("/auth/me")
async def get_taxpayer_me(current_taxpayer: Taxpayer = Depends(get_current_taxpayer)):
    return serialize_taxpayer(current_taxpayer)


@router.get("/branches")
async def get_rpt_branches(db: Session = Depends(get_db)):
    initialize_rpt_demo_data(db)
    return [
        {
            "id": branch.id,
            "code": decrypt_optional_value(branch.code_enc) or branch.code,
            "name": get_branch_name(branch),
        }
        for branch in list_active_branches(db)
    ]


@router.post("/search")
async def search_rpt_property(
    request: RPTSearchRequest,
    db: Session = Depends(get_db),
    current_taxpayer: Taxpayer = Depends(get_current_taxpayer),
):
    initialize_rpt_demo_data(db)

    if not verify_recaptcha_token(request.recaptcha_token or ""):
        raise HTTPException(status_code=400, detail="reCAPTCHA validation failed.")

    remaining_before = searches_remaining_today(db, current_taxpayer.id)
    if remaining_before <= 0:
        raise HTTPException(status_code=429, detail="Daily TDN search limit reached.")

    if not is_valid_tdn_format(request.tdn):
        raise HTTPException(status_code=400, detail="Invalid TDN format.")

    branch = db.query(BranchOffice).filter(BranchOffice.id == request.branch_id, BranchOffice.is_active == True).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found.")

    normalized_tdn = normalize_tdn(request.tdn)
    record = (
        db.query(RPTPropertyRecord)
        .filter(
            RPTPropertyRecord.branch_id == branch.id,
            RPTPropertyRecord.tdn == normalized_tdn,
            RPTPropertyRecord.is_active == True,
        )
        .first()
    )

    record_search(db, current_taxpayer.id, branch.id, normalized_tdn, bool(record))
    remaining_after = searches_remaining_today(db, current_taxpayer.id)

    if not record:
        return {
            "status": RPTPaymentStatus.PROPERTY_SEARCHED.value,
            "searches_remaining": remaining_after,
            "search_limit": SEARCH_LIMIT_PER_DAY,
            "message": "Tax Declaration Number not found. Please contact the Treasurer's Office. rptpayment@quezoncity.gov.ph.",
            "property": None,
        }

    return {
        "status": RPTPaymentStatus.PROPERTY_FOUND.value,
        "searches_remaining": remaining_after,
        "search_limit": SEARCH_LIMIT_PER_DAY,
        "message": "Property record found.",
        "property": serialize_property(branch, record),
    }


@router.post("/checkout")
async def create_rpt_checkout(
    request: CheckoutRequest,
    db: Session = Depends(get_db),
    current_taxpayer: Taxpayer = Depends(get_current_taxpayer),
):
    initialize_rpt_demo_data(db)

    if request.payment_method not in {"GCASH", "MAYA", "CARD", "ONLINE_BANKING"}:
        raise HTTPException(status_code=400, detail="Unsupported payment method.")

    branch = db.query(BranchOffice).filter(BranchOffice.id == request.branch_id, BranchOffice.is_active == True).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found.")

    property_ids = [item.property_id for item in request.items]
    if not property_ids:
        raise HTTPException(status_code=400, detail="Select at least one TDN.")

    property_records = (
        db.query(RPTPropertyRecord)
        .filter(
            RPTPropertyRecord.branch_id == branch.id,
            RPTPropertyRecord.id.in_(property_ids),
            RPTPropertyRecord.is_active == True,
        )
        .all()
    )
    if len(property_records) != len(property_ids):
        raise HTTPException(status_code=400, detail="One or more selected properties are invalid.")

    transaction = RPTPaymentTransaction(
        wards_transaction_no="PENDING",
        taxpayer_id=current_taxpayer.id,
        branch_id=branch.id,
        status=RPTPaymentStatus.PAYMENT_INITIATED,
        payment_method=request.payment_method,
        total_amount=Decimal("0.00"),
    )
    db.add(transaction)
    db.commit()
    db.refresh(transaction)

    transaction.wards_transaction_no = build_wards_transaction_number(transaction.id)
    db.commit()
    db.refresh(transaction)

    serialized_items = []
    total_amount = Decimal("0.00")

    for record in property_records:
        breakdown = compute_rpt_breakdown(record)
        total_amount += breakdown.total_amount_due
        db.add(
            RPTPaymentItem(
                transaction_id=transaction.id,
                property_record_id=record.id,
                tdn=record.tdn,
                taxpayer_name=(
                    build_redacted_text("RPTITEMOWNER", get_property_taxpayer_name(record), 150)
                    if phase2_redaction_enabled() else get_property_taxpayer_name(record)
                ),
                taxpayer_name_enc=encrypt_optional_value(get_property_taxpayer_name(record)),
                taxpayer_name_hash=hash_optional_value(get_property_taxpayer_name(record)),
                property_address=(
                    build_redacted_text("RPTITEMADDR", get_property_address(record), 255)
                    if phase2_redaction_enabled() else get_property_address(record)
                ),
                property_address_enc=encrypt_optional_value(get_property_address(record)),
                property_address_hash=hash_optional_value(get_property_address(record)),
                fair_market_value=Decimal(record.fair_market_value),
                assessment_level=Decimal(record.assessment_level),
                assessed_value=breakdown.assessed_value,
                basic_tax_due=breakdown.basic_tax_due,
                sef_tax=breakdown.sef_tax,
                penalties=breakdown.penalties,
                discounts=breakdown.discounts,
                total_amount=breakdown.total_amount_due,
            )
        )
        serialized_items.append(
            {
                "tdn": record.tdn,
                "property_address": get_property_address(record),
                "total_amount": breakdown.total_amount_due,
            }
        )

    transaction.total_amount = total_amount
    db.commit()
    append_payment_log(
        db,
        transaction.id,
        RPTPaymentStatus.PAYMENT_INITIATED,
        "Payment checkout initiated from taxpayer portal.",
        get_taxpayer_email(current_taxpayer),
    )

    success_url = request.success_url or os.getenv("FRONTEND_BASE_URL", "https://nanowards.com").rstrip("/") + "/rpt-payment?status=success"
    cancel_url = request.cancel_url or os.getenv("FRONTEND_BASE_URL", "https://nanowards.com").rstrip("/") + "/rpt-payment?status=cancelled"

    paymongo_response = create_paymongo_checkout_session(
        taxpayer=current_taxpayer,
        wards_transaction_no=transaction.wards_transaction_no,
        payment_method=request.payment_method,
        items=serialized_items,
        total_amount=total_amount,
        success_url=success_url,
        cancel_url=cancel_url,
    )

    attributes = paymongo_response.get("data", {}).get("attributes", {})
    transaction.paymongo_checkout_session_id = paymongo_response.get("data", {}).get("id")
    checkout_url = attributes.get("checkout_url")
    transaction.paymongo_checkout_url = (
        build_redacted_text("CHECKOUTURL", checkout_url, 65535)
        if checkout_url and phase2_redaction_enabled() else checkout_url
    )
    transaction.paymongo_checkout_url_enc = encrypt_optional_value(checkout_url)
    transaction.paymongo_checkout_url_hash = hash_optional_value(checkout_url)
    paymongo_reference = attributes.get("reference_number") or transaction.wards_transaction_no
    transaction.paymongo_reference_id = (
        build_redacted_text("PMREF", paymongo_reference, 120)
        if phase2_redaction_enabled() else paymongo_reference
    )
    transaction.paymongo_reference_id_enc = encrypt_optional_value(paymongo_reference)
    transaction.paymongo_reference_id_hash = hash_optional_value(paymongo_reference)
    db.commit()
    db.refresh(transaction)

    return {
        "message": "Payment session created successfully.",
        "transaction": serialize_transaction(transaction, db),
        "checkout_url": get_transaction_field(transaction, "paymongo_checkout_url"),
        "payment_reference_id": get_transaction_field(transaction, "paymongo_reference_id"),
        "payment_timestamp": transaction.created_at.isoformat() if transaction.created_at else None,
    }


@router.post("/{transaction_id}/proof")
async def upload_payment_proof(
    transaction_id: int,
    paymongo_reference: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_taxpayer: Taxpayer = Depends(get_current_taxpayer),
):
    transaction = (
        db.query(RPTPaymentTransaction)
        .filter(
            RPTPaymentTransaction.id == transaction_id,
            RPTPaymentTransaction.taxpayer_id == current_taxpayer.id,
        )
        .first()
    )
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found.")

    if file.content_type not in ALLOWED_PROOF_TYPES:
        raise HTTPException(status_code=400, detail="Only JPG, PNG, or PDF files are allowed.")

    file_bytes = await file.read()
    if len(file_bytes) > MAX_PROOF_SIZE:
        raise HTTPException(status_code=400, detail="Payment proof exceeds 5MB.")

    relative_path = save_payment_proof(file_bytes, file.filename, transaction.wards_transaction_no)
    stored_file_path = build_redacted_text("PROOFPATH", relative_path, 255) if phase2_redaction_enabled() else relative_path
    stored_original_filename = build_redacted_text("PROOFFILE", file.filename, 255) if phase2_redaction_enabled() else file.filename
    db.add(
        RPTPaymentProof(
            transaction_id=transaction.id,
            file_path=stored_file_path,
            file_path_enc=encrypt_optional_value(relative_path),
            file_path_hash=hash_optional_value(relative_path),
            original_filename=stored_original_filename,
            original_filename_enc=encrypt_optional_value(file.filename),
            original_filename_hash=hash_optional_value(file.filename),
        )
    )
    proof_reference = paymongo_reference.strip()
    transaction.proof_reference = (
        build_redacted_text("PROOFREF", proof_reference, 150)
        if phase2_redaction_enabled() else proof_reference
    )
    transaction.proof_reference_enc = encrypt_optional_value(proof_reference)
    transaction.proof_reference_hash = hash_optional_value(proof_reference)
    transaction.status = RPTPaymentStatus.PENDING_TREASURY_VALIDATION
    db.commit()
    db.refresh(transaction)

    append_payment_log(
        db,
        transaction.id,
        RPTPaymentStatus.PENDING_TREASURY_VALIDATION,
        "Payment proof uploaded and sent to the Branch Payment Validation Queue.",
        get_taxpayer_email(current_taxpayer),
    )

    return {
        "message": "Payment proof submitted successfully.",
        "transaction": serialize_transaction(transaction, db),
    }


@router.get("/my-transactions")
async def get_my_rpt_transactions(
    db: Session = Depends(get_db),
    current_taxpayer: Taxpayer = Depends(get_current_taxpayer),
):
    transactions = (
        db.query(RPTPaymentTransaction)
        .filter(RPTPaymentTransaction.taxpayer_id == current_taxpayer.id)
        .order_by(RPTPaymentTransaction.created_at.desc())
        .all()
    )
    return [serialize_transaction(transaction, db) for transaction in transactions]


@router.post("/paymongo/webhook")
async def paymongo_webhook(request: Request, db: Session = Depends(get_db)):
    raw_body = await request.body()
    signature_header = request.headers.get("Paymongo-Signature", "")
    if not verify_paymongo_signature(raw_body, signature_header):
        raise HTTPException(status_code=400, detail="Invalid webhook signature.")

    payload = await request.json()
    event_attributes = payload.get("data", {}).get("attributes", {})
    event_type = event_attributes.get("type")
    checkout_payload = event_attributes.get("data", {})
    checkout_attributes = checkout_payload.get("attributes", {})
    reference_number = checkout_attributes.get("reference_number")

    transaction = (
        db.query(RPTPaymentTransaction)
        .filter(RPTPaymentTransaction.wards_transaction_no == reference_number)
        .first()
    )
    if not transaction:
        return {"status": "ignored", "message": "Transaction not found."}

    if event_type == "checkout_session.payment.paid":
        payments = checkout_attributes.get("payments", [])
        payment_intent = checkout_attributes.get("payment_intent", {})
        payment_details = payments[0] if payments else {}
        payment_attributes = payment_details.get("attributes", {})

        transaction.status = RPTPaymentStatus.PAYMENT_SUBMITTED
        transaction.paymongo_checkout_session_id = checkout_payload.get("id")
        transaction.paymongo_payment_intent_id = payment_intent.get("id")
        transaction.paymongo_payment_id = payment_details.get("id")
        transaction.payment_timestamp = datetime.utcnow()
        transaction.paymongo_reference_id = (
            build_redacted_text("PMREF", reference_number, 120)
            if phase2_redaction_enabled() else reference_number
        )
        transaction.paymongo_reference_id_enc = encrypt_optional_value(reference_number)
        transaction.paymongo_reference_id_hash = hash_optional_value(reference_number)
        db.commit()
        db.refresh(transaction)

        append_payment_log(
            db,
            transaction.id,
            RPTPaymentStatus.PAYMENT_SUBMITTED,
            f"PayMongo webhook confirmed paid checkout session via {payment_attributes.get('source', {}).get('type', 'paymongo')}.",
            "PayMongo Webhook",
        )

    return {"status": "received"}


@router.get("/admin/queue")
async def get_admin_payment_queue(
    branch_id: Optional[int] = None,
    status: Optional[str] = None,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    user = get_staff_user(authorization)
    if user.get("role") not in {"admin", "branch_staff"}:
        raise HTTPException(status_code=403, detail="Not authorized.")

    query = db.query(RPTPaymentTransaction)
    if branch_id:
        query = query.filter(RPTPaymentTransaction.branch_id == branch_id)
    if status:
        try:
            status_enum = RPTPaymentStatus(status)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid RPT payment status filter.") from exc
        query = query.filter(RPTPaymentTransaction.status == status_enum)
    transactions = query.order_by(RPTPaymentTransaction.created_at.desc()).all()
    return [serialize_transaction(transaction, db) for transaction in transactions]


@router.post("/admin/{transaction_id}/decision")
async def decide_payment(
    transaction_id: int,
    request: TreasuryDecisionRequest,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    user = get_staff_user(authorization)
    if user.get("role") not in {"admin", "branch_staff"}:
        raise HTTPException(status_code=403, detail="Not authorized.")

    transaction = db.query(RPTPaymentTransaction).filter(RPTPaymentTransaction.id == transaction_id).first()
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found.")

    action_map = {
        "approve": RPTPaymentStatus.PAYMENT_VERIFIED,
        "reject": RPTPaymentStatus.PAYMENT_REJECTED,
        "clarify": RPTPaymentStatus.CLARIFICATION_REQUESTED,
    }
    new_status = action_map[request.action]
    transaction.status = new_status
    treasury_remarks = (request.remarks or "").strip() or None
    transaction.treasury_remarks = (
        build_redacted_text("TREASURY", treasury_remarks, 65535)
        if treasury_remarks and phase2_redaction_enabled() else treasury_remarks
    )
    transaction.treasury_remarks_enc = encrypt_optional_value(treasury_remarks)
    transaction.treasury_remarks_hash = hash_optional_value(treasury_remarks)
    if new_status == RPTPaymentStatus.CLARIFICATION_REQUESTED:
        clarification_message = treasury_remarks
        transaction.clarification_message = (
            build_redacted_text("CLARIFY", clarification_message, 65535)
            if clarification_message and phase2_redaction_enabled() else clarification_message
        )
        transaction.clarification_message_enc = encrypt_optional_value(clarification_message)
        transaction.clarification_message_hash = hash_optional_value(clarification_message)
    else:
        transaction.clarification_message = None
        transaction.clarification_message_enc = None
        transaction.clarification_message_hash = None
    db.commit()
    db.refresh(transaction)

    append_payment_log(
        db,
        transaction.id,
        new_status,
        request.remarks or f"Transaction marked as {new_status.value}.",
        user.get("username", "treasury"),
    )

    return {
        "message": f"Transaction updated to {new_status.value}.",
        "transaction": serialize_transaction(transaction, db),
    }


@router.post("/admin/{transaction_id}/issue-or")
async def issue_official_receipt(
    transaction_id: int,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    user = get_staff_user(authorization)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admin treasury personnel may issue the official receipt.")

    transaction = db.query(RPTPaymentTransaction).filter(RPTPaymentTransaction.id == transaction_id).first()
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found.")
    if transaction.status != RPTPaymentStatus.PAYMENT_VERIFIED:
        raise HTTPException(status_code=400, detail="Payment must be verified before OR issuance.")

    taxpayer = db.query(Taxpayer).filter(Taxpayer.id == transaction.taxpayer_id).first()
    branch = db.query(BranchOffice).filter(BranchOffice.id == transaction.branch_id).first()
    items = db.query(RPTPaymentItem).filter(RPTPaymentItem.transaction_id == transaction.id).all()

    if not transaction.official_receipt_number:
        transaction.official_receipt_number = build_receipt_number(transaction.id)
        transaction.official_receipt_qr_code = build_verification_code(transaction.wards_transaction_no)

    receipt_payload = {
        "official_receipt_number": transaction.official_receipt_number,
        "official_receipt_qr_code": transaction.official_receipt_qr_code,
        "wards_transaction_no": transaction.wards_transaction_no,
        "taxpayer_name": get_taxpayer_full_name(taxpayer) if taxpayer else "",
        "branch_name": get_branch_name(branch) if branch else "",
        "payment_method": transaction.payment_method,
        "total_amount": float(Decimal(transaction.total_amount)),
    }
    item_payload = [
        {
            "tdn": item.tdn,
            "property_address": get_payment_item_property_address(item),
            "basic_tax_due": float(Decimal(item.basic_tax_due)),
            "sef_tax": float(Decimal(item.sef_tax)),
            "penalties": float(Decimal(item.penalties)),
            "discounts": float(Decimal(item.discounts)),
        }
        for item in items
    ]

    pdf_path = generate_official_receipt_pdf(receipt_payload, item_payload)
    transaction.official_receipt_pdf_path = (
        build_redacted_text("ORPDF", pdf_path, 255)
        if phase2_redaction_enabled() else pdf_path
    )
    transaction.official_receipt_pdf_path_enc = encrypt_optional_value(pdf_path)
    transaction.official_receipt_pdf_path_hash = hash_optional_value(pdf_path)
    transaction.status = RPTPaymentStatus.OR_GENERATED
    db.commit()
    db.refresh(transaction)

    append_payment_log(
        db,
        transaction.id,
        RPTPaymentStatus.OR_GENERATED,
        "Computerized Official Receipt generated by Branch Treasury.",
        user.get("username", "admin"),
    )

    return {
        "message": "Official Receipt generated successfully.",
        "transaction": serialize_transaction(transaction, db),
    }


@router.post("/admin/{transaction_id}/release")
async def release_official_receipt(
    transaction_id: int,
    request: ReleaseReceiptRequest,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    user = get_staff_user(authorization)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admin treasury personnel may release the official receipt.")

    transaction = db.query(RPTPaymentTransaction).filter(RPTPaymentTransaction.id == transaction_id).first()
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found.")
    if transaction.status != RPTPaymentStatus.OR_GENERATED:
        raise HTTPException(status_code=400, detail="Official Receipt must be generated before release.")

    transaction.release_method = RPTReleaseMethod(request.release_method)
    if transaction.release_method == RPTReleaseMethod.EMAIL and not request.release_email:
        raise HTTPException(status_code=400, detail="Release email is required for EMAIL release.")
    if transaction.release_method == RPTReleaseMethod.COURIER and (
        not request.courier_name or not request.courier_tracking_number
    ):
        raise HTTPException(status_code=400, detail="Courier name and tracking number are required for COURIER release.")

    transaction.release_email = (
        build_redacted_email("release", request.release_email, 255)
        if request.release_email and phase2_redaction_enabled() else request.release_email
    )
    transaction.release_email_enc = encrypt_optional_value(request.release_email)
    transaction.release_email_hash = hash_optional_value(request.release_email)
    transaction.courier_name = (
        build_redacted_text("COURIER", request.courier_name, 120)
        if request.courier_name and phase2_redaction_enabled() else request.courier_name
    )
    transaction.courier_name_enc = encrypt_optional_value(request.courier_name)
    transaction.courier_name_hash = hash_optional_value(request.courier_name)
    transaction.courier_tracking_number = (
        build_redacted_text("TRACKING", request.courier_tracking_number, 120)
        if request.courier_tracking_number and phase2_redaction_enabled() else request.courier_tracking_number
    )
    transaction.courier_tracking_number_enc = encrypt_optional_value(request.courier_tracking_number)
    transaction.courier_tracking_number_hash = hash_optional_value(request.courier_tracking_number)
    transaction.courier_rider_details = (
        build_redacted_text("RIDER", request.courier_rider_details, 65535)
        if request.courier_rider_details and phase2_redaction_enabled() else request.courier_rider_details
    )
    transaction.courier_rider_details_enc = encrypt_optional_value(request.courier_rider_details)
    transaction.courier_rider_details_hash = hash_optional_value(request.courier_rider_details)
    transaction.status = RPTPaymentStatus.COMPLETED
    transaction.completed_at = datetime.utcnow()

    if transaction.release_method == RPTReleaseMethod.EMAIL:
        taxpayer = db.query(Taxpayer).filter(Taxpayer.id == transaction.taxpayer_id).first()
        send_official_receipt_email(
            recipient_email=request.release_email.strip(),
            official_receipt_number=transaction.official_receipt_number or "",
            taxpayer_name=get_taxpayer_full_name(taxpayer) if taxpayer else "",
            pdf_relative_path=get_transaction_field(transaction, "official_receipt_pdf_path"),
        )

    db.commit()
    db.refresh(transaction)

    append_payment_log(
        db,
        transaction.id,
        RPTPaymentStatus.COMPLETED,
        f"Official Receipt released via {request.release_method}.",
        user.get("username", "admin"),
    )

    return {
        "message": "Official Receipt released successfully.",
        "transaction": serialize_transaction(transaction, db),
    }
