from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import or_

from auth.utils import get_password_hash
from core.security_crypto import decrypt_optional_value, encrypt_optional_value
from core.security_hash import hash_optional_value
from core.security_phase2 import build_redacted_email, build_redacted_text, phase2_redaction_enabled
from database.config import get_db
from database.models import Taxpayer, TaxpayerOTP
from services.taxpayer_auth_service import (
    TaxpayerAuthError,
    generate_otp,
    get_otp_cooldown_seconds,
    get_otp_expiry,
    hash_otp,
    send_otp_email,
    validate_email_format,
    verify_email_with_quickemailverification,
)

router = APIRouter()


class OTPRequest(BaseModel):
    email: str


class TaxpayerRegisterRequest(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=150)
    email: str
    password: str = Field(..., min_length=8, max_length=128)
    otp_code: str = Field(..., min_length=6, max_length=6)


@router.post("/request-otp")
async def request_taxpayer_otp(request: OTPRequest, db: Session = Depends(get_db)):
    email = validate_email_format(request.email)

    existing_taxpayer = db.query(Taxpayer).filter(
        or_(Taxpayer.email == email, Taxpayer.email_hash == hash_optional_value(email))
    ).first()
    if existing_taxpayer:
        raise HTTPException(status_code=400, detail="Email is already registered.")

    latest_otp = (
        db.query(TaxpayerOTP)
        .filter(or_(TaxpayerOTP.email == email, TaxpayerOTP.email_hash == hash_optional_value(email)))
        .order_by(TaxpayerOTP.created_at.desc())
        .first()
    )
    if latest_otp and latest_otp.created_at:
        cooldown_time = latest_otp.created_at + timedelta(seconds=get_otp_cooldown_seconds())
        if latest_otp.used_at is None and cooldown_time > datetime.utcnow():
            raise HTTPException(
                status_code=429,
                detail="Please wait before requesting another OTP.",
            )

    try:
        verification_result = verify_email_with_quickemailverification(email)
        otp_code = generate_otp()
        otp_record = TaxpayerOTP(
            email=build_redacted_email("otp", email, 255) if phase2_redaction_enabled() else email,
            email_enc=encrypt_optional_value(email),
            email_hash=hash_optional_value(email),
            otp_hash=hash_otp(email, otp_code),
            expires_at=get_otp_expiry(),
        )
        db.add(otp_record)
        db.flush()
        send_otp_email(email, otp_code)
        db.commit()
    except TaxpayerAuthError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        db.rollback()
        raise

    return {
        "message": "OTP sent successfully.",
        "email_check": {
            "result": verification_result.get("result"),
            "reason": verification_result.get("reason"),
            "safe_to_send": verification_result.get("safe_to_send"),
        },
    }


@router.post("/register")
async def register_taxpayer(request: TaxpayerRegisterRequest, db: Session = Depends(get_db)):
    email = validate_email_format(request.email)

    existing_taxpayer = db.query(Taxpayer).filter(
        or_(Taxpayer.email == email, Taxpayer.email_hash == hash_optional_value(email))
    ).first()
    if existing_taxpayer:
        raise HTTPException(status_code=400, detail="Email is already registered.")

    otp_record = (
        db.query(TaxpayerOTP)
        .filter(
            or_(TaxpayerOTP.email == email, TaxpayerOTP.email_hash == hash_optional_value(email)),
            TaxpayerOTP.used_at.is_(None),
        )
        .order_by(TaxpayerOTP.created_at.desc())
        .first()
    )

    if not otp_record:
        raise HTTPException(status_code=400, detail="No active OTP found for this email.")

    if otp_record.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="OTP has already expired.")

    if otp_record.otp_hash != hash_otp(email, request.otp_code):
        raise HTTPException(status_code=400, detail="Invalid OTP code.")

    stored_full_name = request.full_name.strip()
    stored_email = email
    if phase2_redaction_enabled():
        stored_full_name = build_redacted_text("TAXPAYER", request.full_name, 150)
        stored_email = build_redacted_email("taxpayer", email, 255)

    taxpayer = Taxpayer(
        full_name=stored_full_name,
        full_name_enc=encrypt_optional_value(request.full_name),
        email=stored_email,
        email_enc=encrypt_optional_value(email),
        email_hash=hash_optional_value(email),
        password_hash=get_password_hash(request.password),
        email_verified=True,
        email_verified_at=datetime.utcnow(),
    )

    otp_record.used_at = datetime.utcnow()
    db.add(taxpayer)
    db.commit()
    db.refresh(taxpayer)

    return {
        "message": "Taxpayer account created successfully.",
        "taxpayer": {
            "id": taxpayer.id,
            "full_name": decrypt_optional_value(taxpayer.full_name_enc) or request.full_name.strip(),
            "email": decrypt_optional_value(taxpayer.email_enc) or email,
            "email_verified": taxpayer.email_verified,
        },
    }
