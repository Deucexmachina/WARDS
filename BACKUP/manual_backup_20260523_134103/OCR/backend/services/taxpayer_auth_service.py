import hashlib
import os
import re
import secrets
import smtplib
import ssl
from datetime import datetime, timedelta
from email.message import EmailMessage
from json import JSONDecodeError, loads
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import urlopen


EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class TaxpayerAuthError(Exception):
    pass


def normalize_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1", "yes", "y"}
    return bool(value)


def validate_email_format(email: str) -> str:
    normalized_email = email.strip().lower()
    if not EMAIL_PATTERN.match(normalized_email):
        raise TaxpayerAuthError("Please enter a valid email address.")
    return normalized_email


def verify_email_with_quickemailverification(email: str) -> dict:
    api_key = os.getenv("QUICKEMAILVERIFICATION_API_KEY", "").strip()
    if not api_key:
        raise TaxpayerAuthError("QuickEmailVerification API key is missing.")

    request_url = (
        "https://api.quickemailverification.com/v1/verify"
        f"?email={quote(email)}&apikey={quote(api_key)}"
    )

    try:
        with urlopen(request_url, timeout=10) as response:
            payload = loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise TaxpayerAuthError(
            "Email verification service returned an error."
            + (f" {detail}" if detail else "")
        ) from exc
    except (URLError, TimeoutError, JSONDecodeError) as exc:
        raise TaxpayerAuthError(
            "Email verification service is currently unavailable."
        ) from exc

    if not payload.get("success"):
        message = payload.get("message") or "Unable to verify email address."
        raise TaxpayerAuthError(message)

    if payload.get("result") != "valid":
        suggestion = payload.get("did_you_mean")
        message = "Email address could not be verified."
        if suggestion:
            message += f" Did you mean {suggestion}?"
        raise TaxpayerAuthError(message)

    if normalize_bool(payload.get("disposable")):
        raise TaxpayerAuthError("Disposable email addresses are not allowed.")

    return payload


def generate_otp() -> str:
    return f"{secrets.randbelow(1000000):06d}"


def hash_otp(email: str, otp_code: str) -> str:
    otp_secret = os.getenv("OTP_HASH_SECRET", "wards-taxpayer-otp-secret")
    return hashlib.sha256(f"{email}:{otp_code}:{otp_secret}".encode("utf-8")).hexdigest()


def get_otp_expiry() -> datetime:
    expiry_minutes = int(os.getenv("OTP_EXPIRE_MINUTES", "10"))
    return datetime.utcnow() + timedelta(minutes=expiry_minutes)


def get_otp_cooldown_seconds() -> int:
    return int(os.getenv("OTP_RESEND_COOLDOWN_SECONDS", "60"))


def send_otp_email(recipient_email: str, otp_code: str) -> None:
    smtp_host = os.getenv("BREVO_SMTP_HOST", "smtp-relay.brevo.com").strip()
    smtp_port = int(os.getenv("BREVO_SMTP_PORT", "587"))
    smtp_username = os.getenv("BREVO_SMTP_USERNAME", "").strip()
    smtp_password = os.getenv("BREVO_SMTP_PASSWORD", "").strip()
    sender_email = os.getenv("BREVO_SENDER_EMAIL", "team.nano25@gmail.com").strip()
    sender_name = os.getenv("BREVO_SENDER_NAME", "WARDS Taxpayer Verification").strip()
    expiry_minutes = os.getenv("OTP_EXPIRE_MINUTES", "10")

    if not all([smtp_username, smtp_password, sender_email]):
        raise TaxpayerAuthError("Brevo SMTP settings are incomplete.")

    message = EmailMessage()
    message["Subject"] = "Your WARDS taxpayer verification code"
    message["From"] = f"{sender_name} <{sender_email}>"
    message["To"] = recipient_email
    message.set_content(
        "\n".join(
            [
                "WARDS Taxpayer Verification",
                "",
                "Use the verification code below to continue your signup:",
                f"OTP Code: {otp_code}",
                "",
                f"This code will expire in {expiry_minutes} minutes.",
                "If you did not request this code, you can ignore this email.",
            ]
        )
    )
    message.add_alternative(
        f"""\
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <div style="margin:0;padding:32px 16px;background-color:#f4f7fb;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;margin:0 auto;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;">
        <tr>
          <td style="padding:28px 32px;background:linear-gradient(135deg,#0f172a 0%,#1d4ed8 100%);color:#ffffff;">
            <div style="font-size:12px;letter-spacing:1.4px;text-transform:uppercase;opacity:0.8;">WARDS Portal</div>
            <h1 style="margin:10px 0 0;font-size:28px;line-height:1.2;font-weight:700;">Taxpayer Verification Code</h1>
            <p style="margin:12px 0 0;font-size:15px;line-height:1.6;color:#dbeafe;">
              Use the one-time passcode below to complete your account registration.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#374151;">
              Hello,
            </p>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
              We received a request to verify this email address for your WARDS taxpayer account.
              Please enter the code below to continue.
            </p>
            <div style="margin:0 0 24px;padding:22px 24px;border:1px solid #dbeafe;border-radius:16px;background:linear-gradient(180deg,#eff6ff 0%,#f8fbff 100%);text-align:center;">
              <div style="margin:0 0 10px;font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:#1d4ed8;font-weight:700;">
                Verification Code
              </div>
              <div style="font-size:36px;line-height:1;letter-spacing:8px;font-weight:700;color:#0f172a;">
                {otp_code}
              </div>
            </div>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;">
              <tr>
                <td style="padding:16px 18px;background-color:#f9fafb;border-radius:12px;border:1px solid #e5e7eb;">
                  <p style="margin:0;font-size:14px;line-height:1.7;color:#4b5563;">
                    This code will expire in <strong>{expiry_minutes} minutes</strong>.
                    For your security, do not share this code with anyone.
                  </p>
                </td>
              </tr>
            </table>
            <p style="margin:0;font-size:14px;line-height:1.7;color:#6b7280;">
              If you did not request this verification, you can safely ignore this email.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px 28px;border-top:1px solid #e5e7eb;background-color:#fcfcfd;">
            <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#6b7280;">
              This is an automated message from WARDS. Please do not reply directly to this email.
            </p>
            <p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">
              WARDS Taxpayer Services
            </p>
          </td>
        </tr>
      </table>
    </div>
  </body>
</html>
""",
        subtype="html",
    )

    context = ssl.create_default_context()

    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
            server.ehlo()
            server.starttls(context=context)
            server.ehlo()
            server.login(smtp_username, smtp_password)
            server.send_message(message)
    except smtplib.SMTPException as exc:
        raise TaxpayerAuthError("Failed to send OTP email.") from exc
