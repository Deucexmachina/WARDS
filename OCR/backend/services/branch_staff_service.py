import base64
import hashlib
import hmac
import os
import secrets
import smtplib
import ssl
import struct
from datetime import datetime
from email.message import EmailMessage
from html import escape as html_escape
from typing import Dict, List, Optional
from urllib.parse import quote

from sqlalchemy.orm import Session

from core.security_crypto import decrypt_optional_value, encrypt_optional_value
from core.security_hash import hash_optional_value
from core.security_phase2 import build_redacted_email, build_redacted_text, phase2_redaction_enabled
from database.models import BranchStaffAccount, ServiceWindowConfig


def _safe_html(text: str | None) -> str:
    """
    Safely escape text for HTML email templates.
    Prevents XSS by escaping HTML special characters.

    Args:
        text: The text to escape

    Returns:
        Escaped HTML-safe string, or empty string if input is None
    """
    if text is None:
        return ""
    return html_escape(str(text), quote=True)


WINDOW_CATALOG = [
    {
        "service_id": 1,
        "window_code": "RPT",
        "window_label": "RPT Window",
        "description": "Queue-only staff account for real property tax transactions.",
    },
    {
        "service_id": 2,
        "window_code": "BT",
        "window_label": "BT Window",
        "description": "Queue-only staff account for business tax and permit transactions.",
    },
    {
        "service_id": 3,
        "window_code": "MISC",
        "window_label": "MISC Window",
        "description": "Queue-only staff account for miscellaneous branch queue services.",
    },
    {
        "service_id": 4,
        "window_code": "QW4",
        "window_label": "Queue Window 4",
        "description": "Queue-only staff account for additional branch queue services.",
    },
    {
        "service_id": 5,
        "window_code": "QW5",
        "window_label": "Queue Window 5",
        "description": "Queue-only staff account for additional branch queue services.",
    },
]

MAX_WINDOWS = 5
MFA_ISSUER = "WARDS Queue System"
DEFAULT_WINDOW_COUNT = 3


def get_window_catalog() -> List[dict]:
    return [item.copy() for item in WINDOW_CATALOG]


def _normalize_window_count(value) -> int:
    if isinstance(value, int):
        return max(1, min(MAX_WINDOWS, value))

    normalized = str(value or "").strip()
    if normalized.isdigit():
        parsed = int(normalized)
        return max(1, min(MAX_WINDOWS, parsed))

    return DEFAULT_WINDOW_COUNT


def get_window_config(db: Session) -> ServiceWindowConfig:
    config = db.query(ServiceWindowConfig).filter(ServiceWindowConfig.id == 1).first()
    if not config:
        config = ServiceWindowConfig(id=1, window_count=DEFAULT_WINDOW_COUNT)
        db.add(config)
        db.commit()
        db.refresh(config)
    else:
        normalized_count = _normalize_window_count(config.window_count)
        if config.window_count != normalized_count:
            config.window_count = normalized_count
            db.commit()
            db.refresh(config)
    return config


def get_active_window_count(db: Session) -> int:
    return _normalize_window_count(get_window_config(db).window_count)


def update_window_count(db: Session, window_count: int) -> ServiceWindowConfig:
    if window_count < 1 or window_count > MAX_WINDOWS:
        raise ValueError(f"Service window count must be between 1 and {MAX_WINDOWS}.")

    config = get_window_config(db)
    config.window_count = window_count
    db.commit()
    db.refresh(config)
    return config


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120000)
    return f"{base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def verify_password(password: str, hashed_password: str) -> bool:
    try:
        salt_b64, digest_b64 = hashed_password.split("$", 1)
        salt = base64.b64decode(salt_b64.encode())
        expected = base64.b64decode(digest_b64.encode())
    except (ValueError, TypeError):
        return False

    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120000)
    return hmac.compare_digest(actual, expected)


def generate_temporary_password(length: int = 12) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def generate_username(service_id: int) -> str:
    return f"galas_staff{service_id}"


def generate_mfa_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode("utf-8").rstrip("=")


def _normalize_base32_secret(secret: str) -> str:
    padding = "=" * ((8 - len(secret) % 8) % 8)
    return f"{secret}{padding}"


def build_otpauth_uri(username: str, secret: str) -> str:
    label = quote(f"{MFA_ISSUER}:{username}")
    issuer = quote(MFA_ISSUER)
    return f"otpauth://totp/{label}?secret={secret}&issuer={issuer}"


def _generate_totp(secret: str, for_time: Optional[int] = None, step: int = 30) -> str:
    if for_time is None:
        for_time = int(datetime.utcnow().timestamp())

    counter = int(for_time / step)
    key = base64.b32decode(_normalize_base32_secret(secret), casefold=True)
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return f"{code % 1000000:06d}"


def verify_totp_code(secret: str, otp_code: str, window: int = 1) -> bool:
    now = int(datetime.utcnow().timestamp())
    normalized = otp_code.strip()

    if not normalized.isdigit() or len(normalized) != 6:
        return False

    for offset in range(-window, window + 1):
        if _generate_totp(secret, now + (offset * 30)) == normalized:
            return True
    return False


def send_branch_staff_credentials_email(
    recipient_email: str,
    window_label: str,
    username: str,
    temporary_password: str,
    mfa_secret: str,
) -> None:
    smtp_host = os.getenv("BREVO_SMTP_HOST", "smtp-relay.brevo.com").strip()
    smtp_port = int(os.getenv("BREVO_SMTP_PORT", "587"))
    smtp_username = os.getenv("BREVO_SMTP_USERNAME", "").strip()
    smtp_password = os.getenv("BREVO_SMTP_PASSWORD", "").strip()
    sender_email = os.getenv("BREVO_SENDER_EMAIL", "team.nano25@gmail.com").strip()
    sender_name = os.getenv("BREVO_SENDER_NAME", "WARDS Queue Management").strip()

    if not all([smtp_username, smtp_password, sender_email]):
        raise RuntimeError("Brevo SMTP settings are incomplete.")

    otpauth_uri = build_otpauth_uri(username, mfa_secret)
    message = EmailMessage()
    message["Subject"] = f"Your {window_label} queue staff account"
    message["From"] = f"{sender_name} <{sender_email}>"
    message["To"] = recipient_email
    message.set_content(
        "\n".join(
            [
                f"{window_label} queue-only account",
                "",
                f"Username: {username}",
                f"Temporary Password: {temporary_password}",
                "",
                "Microsoft Authenticator setup:",
                f"Manual key: {mfa_secret}",
                f"Setup link: {otpauth_uri}",
                "",
                "Sign in to WARDS, add this account to Microsoft Authenticator,",
                "then enter the 6-digit OTP code to finish first-time setup.",
            ]
        )
    )
    message.add_alternative(
        f"""\
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f7fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <div style="max-width:640px;margin:0 auto;padding:24px 16px;">
      <div style="background:#ffffff;border:1px solid #dbe7f3;border-radius:18px;overflow:hidden;">
        <div style="background:#123b6d;color:#ffffff;padding:24px 28px;">
          <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;opacity:0.85;">WARDS Queue Staff Portal</div>
          <h1 style="margin:10px 0 0;font-size:28px;line-height:1.2;">{_safe_html(window_label)} account credentials</h1>
        </div>
        <div style="padding:28px;">
          <p style="margin:0 0 18px;font-size:15px;line-height:1.7;">
            A queue-only branch staff account has been generated for this service window.
          </p>
          <div style="padding:18px;border:1px solid #dbe7f3;border-radius:14px;background:#f8fbff;">
            <p style="margin:0 0 8px;"><strong>Username:</strong> {_safe_html(username)}</p>
            <p style="margin:0;"><strong>Temporary Password:</strong> {_safe_html(temporary_password)}</p>
          </div>
          <div style="margin-top:18px;padding:18px;border:1px solid #e5e7eb;border-radius:14px;background:#fcfcfd;">
            <p style="margin:0 0 8px;"><strong>Microsoft Authenticator manual key:</strong> {_safe_html(mfa_secret)}</p>
            <p style="margin:0;font-size:14px;line-height:1.7;">
              During first login, add this account to Microsoft Authenticator using the manual key above,
              then enter the 6-digit OTP shown in the app.
            </p>
          </div>
          <p style="margin:18px 0 0;font-size:14px;line-height:1.7;">
            Setup link: <a href="{_safe_html(otpauth_uri)}">{_safe_html(otpauth_uri)}</a>
          </p>
        </div>
      </div>
    </div>
  </body>
</html>
""",
        subtype="html",
    )

    context = ssl.create_default_context()
    with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
        server.ehlo()
        server.starttls(context=context)
        server.ehlo()
        server.login(smtp_username, smtp_password)
        server.send_message(message)


def serialize_branch_account(account: BranchStaffAccount) -> dict:
    account = hydrate_branch_staff_account(account)
    return {
        "id": account.id,
        "window_code": account.window_code,
        "window_label": account.window_label,
        "service_id": account.service_id,
        "email": account.email,
        "username": account.username,
        "mfa_enabled": account.mfa_enabled,
        "is_active": account.is_active,
        "portal_access": "queue_only",
        "last_login": account.last_login.isoformat() if account.last_login else None,
        "created_at": account.created_at.isoformat() if account.created_at else None,
    }


def hydrate_branch_staff_account(account: Optional[BranchStaffAccount]) -> Optional[BranchStaffAccount]:
    if not account:
        return account

    decrypted_username = decrypt_optional_value(account.username_enc)
    decrypted_email = decrypt_optional_value(account.email_enc)
    decrypted_window_label = decrypt_optional_value(account.window_label_enc)
    decrypted_mfa_secret = decrypt_optional_value(account.mfa_secret_enc)

    account.username = decrypted_username or account.username
    account.email = decrypted_email or account.email
    account.window_label = decrypted_window_label or account.window_label
    account.mfa_secret = decrypted_mfa_secret or account.mfa_secret
    return account


def sync_branch_staff_accounts(
    db: Session,
    window_count: int,
    assignments: List[Dict[str, str]],
) -> Dict[str, object]:
    if window_count < 1 or window_count > MAX_WINDOWS:
        raise ValueError(f"Service window count must be between 1 and {MAX_WINDOWS}.")

    selected_windows = WINDOW_CATALOG[:window_count]
    assignment_map = {
        item["window_code"]: item["email"].strip().lower()
        for item in assignments
        if item.get("window_code") and item.get("email")
    }

    missing = [item["window_label"] for item in selected_windows if item["window_code"] not in assignment_map]
    if missing:
        missing_windows = ", ".join(missing)
        raise ValueError(f"Email is required for: {missing_windows}.")

    created_or_updated = []
    for window in WINDOW_CATALOG:
        account = (
            db.query(BranchStaffAccount)
            .filter(BranchStaffAccount.window_code == window["window_code"])
            .first()
        )
        account = hydrate_branch_staff_account(account)

        if window["service_id"] <= window_count:
            recipient_email = assignment_map[window["window_code"]]
            should_create = account is None
            should_reset = should_create or account.email != recipient_email or not account.is_active

            if should_create:
                generated_username = generate_username(window["service_id"])
                generated_mfa_secret = generate_mfa_secret()
                stored_window_label = window["window_label"]
                stored_email = recipient_email
                stored_username = generated_username
                stored_mfa_secret = generated_mfa_secret

                if phase2_redaction_enabled():
                    stored_window_label = build_redacted_text("WINDOWLABEL", window["window_label"], 100)
                    stored_email = build_redacted_email("branchstaff", recipient_email, 255)
                    stored_username = build_redacted_text("STAFFACCOUNT", generated_username, 80)
                    stored_mfa_secret = build_redacted_text("MFASECRET", generated_mfa_secret, 64)

                account = BranchStaffAccount(
                    window_code=window["window_code"],
                    window_label=stored_window_label,
                    window_label_enc=encrypt_optional_value(window["window_label"]),
                    window_label_hash=hash_optional_value(window["window_label"]),
                    service_id=window["service_id"],
                    email=stored_email,
                    email_enc=encrypt_optional_value(recipient_email),
                    email_hash=hash_optional_value(recipient_email),
                    username=stored_username,
                    username_enc=encrypt_optional_value(generated_username),
                    username_hash=hash_optional_value(generated_username),
                    password_hash="",
                    mfa_secret=stored_mfa_secret,
                    mfa_secret_enc=encrypt_optional_value(generated_mfa_secret),
                    mfa_enabled=False,
                    is_active=True,
                )
                db.add(account)
            else:
                account.window_label = window["window_label"]
                account.window_label_enc = encrypt_optional_value(window["window_label"])
                account.window_label_hash = hash_optional_value(window["window_label"])
                account.service_id = window["service_id"]
                account.email = recipient_email
                account.email_enc = encrypt_optional_value(recipient_email)
                account.email_hash = hash_optional_value(recipient_email)
                account.username = generate_username(window["service_id"])
                account.username_enc = encrypt_optional_value(account.username)
                account.username_hash = hash_optional_value(account.username)
                account.is_active = True

                if phase2_redaction_enabled():
                    account.window_label = build_redacted_text("WINDOWLABEL", window["window_label"], 100)
                    account.email = build_redacted_email("branchstaff", recipient_email, 255)
                    account.username = build_redacted_text("STAFFACCOUNT", generate_username(window["service_id"]), 80)

            if should_reset:
                temporary_password = generate_temporary_password()
                actual_username = generate_username(window["service_id"])
                actual_mfa_secret = generate_mfa_secret()
                account.password_hash = hash_password(temporary_password)
                account.mfa_secret = actual_mfa_secret
                account.mfa_secret_enc = encrypt_optional_value(actual_mfa_secret)
                account.mfa_enabled = False
                account.temp_password_sent_at = datetime.utcnow()

                if phase2_redaction_enabled():
                    account.mfa_secret = build_redacted_text("MFASECRET", actual_mfa_secret, 64)

                send_branch_staff_credentials_email(
                    recipient_email=recipient_email,
                    window_label=window["window_label"],
                    username=actual_username,
                    temporary_password=temporary_password,
                    mfa_secret=actual_mfa_secret,
                )
                created_or_updated.append(window["window_label"])
        elif account:
            account.is_active = False

    update_window_count(db, window_count)
    db.commit()

    active_accounts = (
        db.query(BranchStaffAccount)
        .filter(BranchStaffAccount.is_active == True)
        .order_by(BranchStaffAccount.service_id.asc())
        .all()
    )

    return {
        "window_count": window_count,
        "generated_windows": created_or_updated,
        "accounts": [serialize_branch_account(account) for account in active_accounts],
    }


def get_branch_staff_account_for_login(db: Session, identifier: str) -> Optional[BranchStaffAccount]:
    normalized = identifier.strip()
    normalized_lower = normalized.lower()
    account = (
        db.query(BranchStaffAccount)
        .filter(
            (BranchStaffAccount.username == normalized) |
            (BranchStaffAccount.email == normalized_lower) |
            (BranchStaffAccount.username_hash == hash_optional_value(normalized)) |
            (BranchStaffAccount.email_hash == hash_optional_value(normalized_lower)),
            BranchStaffAccount.is_active == True,
        )
        .first()
    )
    return hydrate_branch_staff_account(account)
