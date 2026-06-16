import base64
import binascii
import hashlib
import io
import secrets
import time
from datetime import datetime, timedelta
from typing import Optional

import pyotp
import qrcode
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from database.models import EmailOTP, MFASecret
from services.email_service import send_mfa_recovery_email
from utils.field_crypto import (
    apply_email_otp_security,
    apply_mfa_secret_security,
    find_mfa_secret_record,
    get_decrypted_or_raw,
    hash_optional_value,
)

MFA_RECOVERY_ROLE = "mfa_recovery"
MFA_RECOVERY_OTP_EXPIRES_MINUTES = 10
MFA_RECOVERY_RESEND_COOLDOWN_SECONDS = 120

mfa_recovery_rate_limits: dict[str, list[float]] = {}
mfa_recovery_confirm_rate_limits: dict[str, list[float]] = {}


def generate_mfa_secret() -> str:
    return pyotp.random_base32()


def generate_mfa_payload(portal: str, username: str, secret: str, issuer_name: str = None) -> dict:
    from auth.jwt_utils import PORTAL_CONFIG
    if issuer_name is None:
        issuer_name = PORTAL_CONFIG.get(portal, {}).get("issuer_name", "WARDS Portal")
    totp_uri = pyotp.TOTP(secret).provisioning_uri(name=username, issuer_name=issuer_name)
    qr = qrcode.QRCode(version=1, box_size=10, border=5)
    qr.add_data(totp_uri)
    qr.make(fit=True)
    image = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return {
        "message": "MFA setup successful",
        "portal": portal,
        "qr_code": f"data:image/png;base64,{base64.b64encode(buffer.getvalue()).decode()}",
        "manual_entry_key": secret,
        "totp_secret": secret,
    }


def get_mfa_secret(db: Session, portal: str, username: str) -> Optional[str]:
    record = find_mfa_secret_record(db, MFASecret, portal, username, enabled_only=True)
    if not record:
        return None
    secret = get_decrypted_or_raw(record, "secret")
    if not secret:
        return None
    normalized_secret = str(secret).strip().replace(" ", "")
    if not normalized_secret:
        return None
    try:
        base64.b32decode(normalized_secret, casefold=True)
    except (binascii.Error, ValueError):
        return None
    return normalized_secret


def save_mfa_secret(db: Session, portal: str, username: str, secret: str, enabled: bool = True):
    record = find_mfa_secret_record(db, MFASecret, portal, username, enabled_only=False)
    if record:
        record.portal = portal
        record.username = username
        record.secret = secret
        record.enabled = enabled
        apply_mfa_secret_security(record)
    else:
        record = MFASecret(portal=portal, username=username, secret=secret, enabled=enabled)
        apply_mfa_secret_security(record)
        db.add(record)
    db.commit()


def delete_mfa_secret(db: Session, portal: str, username: str) -> None:
    record = find_mfa_secret_record(db, MFASecret, portal, username, enabled_only=False)
    if record:
        db.delete(record)
        db.commit()


def get_mfa_secret_raw(db: Session, portal: str, username: str) -> Optional[MFASecret]:
    return find_mfa_secret_record(db, MFASecret, portal, username, enabled_only=False)


def hash_mfa_recovery_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def generate_mfa_recovery_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def find_active_mfa_recovery_otp(db: Session, email: str) -> Optional[EmailOTP]:
    now = datetime.utcnow()
    email_hash = hash_optional_value(email)
    role_hash = hash_optional_value(MFA_RECOVERY_ROLE)
    return (
        db.query(EmailOTP)
        .filter(
            EmailOTP.email_hash == email_hash,
            EmailOTP.role_hash == role_hash,
            EmailOTP.consumed_at.is_(None),
            EmailOTP.expires_at > now,
        )
        .order_by(EmailOTP.created_at.desc(), EmailOTP.id.desc())
        .first()
    )


def issue_mfa_recovery_otp(
    db: Session,
    email: str,
    *,
    allow_recent_existing: bool = False,
) -> tuple[EmailOTP, int]:
    now = datetime.utcnow()
    active_otp = find_active_mfa_recovery_otp(db, email)

    if active_otp and active_otp.last_sent_at:
        elapsed = int((now - active_otp.last_sent_at).total_seconds())
        remaining = max(MFA_RECOVERY_RESEND_COOLDOWN_SECONDS - elapsed, 0)
        if remaining > 0:
            if allow_recent_existing:
                return active_otp, remaining
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Please wait {remaining} seconds before requesting another verification code.",
            )

    if active_otp:
        active_otp.consumed_at = now

    verification_code = generate_mfa_recovery_code()
    otp_record = EmailOTP(
        email=email,
        role=MFA_RECOVERY_ROLE,
        code_hash=hash_mfa_recovery_code(verification_code),
        expires_at=now + timedelta(minutes=MFA_RECOVERY_OTP_EXPIRES_MINUTES),
        attempts=0,
        resend_count=(active_otp.resend_count + 1) if active_otp else 0,
        last_sent_at=now,
    )
    db.add(otp_record)
    db.flush()
    apply_email_otp_security(otp_record)

    email_result = send_mfa_recovery_email(
        recipient_email=email,
        verification_code=verification_code,
        expires_minutes=MFA_RECOVERY_OTP_EXPIRES_MINUTES,
    )
    if not email_result["sent"]:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=email_result["message"],
        )

    return otp_record, MFA_RECOVERY_RESEND_COOLDOWN_SECONDS


def check_mfa_recovery_rate_limit(email: str) -> bool:
    current_time = time.time()
    email_lower = email.lower()
    window = mfa_recovery_rate_limits.get(email_lower, [])
    window = [t for t in window if current_time - t < 3600]
    if len(window) >= 3:
        return False
    window.append(current_time)
    mfa_recovery_rate_limits[email_lower] = window
    return True


def check_mfa_recovery_confirm_rate_limit(email: str) -> bool:
    current_time = time.time()
    email_lower = email.lower()
    window = mfa_recovery_confirm_rate_limits.get(email_lower, [])
    window = [t for t in window if current_time - t < 60]
    if len(window) >= 5:
        return False
    window.append(current_time)
    mfa_recovery_confirm_rate_limits[email_lower] = window
    return True
