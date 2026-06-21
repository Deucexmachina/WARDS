import base64
import os
import smtplib
from email.message import EmailMessage
from datetime import datetime, timedelta
from pathlib import Path
from email.utils import make_msgid, parseaddr
from datetime import timezone
from html import escape as html_escape
import requests
try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
except ImportError:
    ZoneInfo = None
    ZoneInfoNotFoundError = Exception


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


BASE_DIR = Path(__file__).resolve().parents[2]
BRANDING_DIR = BASE_DIR / "frontend" / "src" / "assets" / "branding"
EMAIL_LOGOS = [
    {
        "filename": "wards_logo.png",
        "alt": "WARDS official logo",
        "fit": "contain",
        "padding": "8px",
    },
    {
        "filename": "qclogo_main.png",
        "alt": "Quezon City official logo",
        "fit": "contain",
        "padding": "8px",
    },
    {
        "filename": "galas_logo.png",
        "alt": "Galas Branch official logo",
        "fit": "contain",
        "padding": "6px",
    },
]


def _attachment_subtype(filename: str, default: str = "png") -> str:
    extension = os.path.splitext(filename)[1].lstrip(".").lower()
    if extension == "jpg":
        return "jpeg"
    return extension or default


def _env_flag(name: str, default: str = "true") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


def smtp_is_configured() -> bool:
    return bool(
        os.getenv("SENDGRID_API_KEY")
        or os.getenv("BREVO_API_KEY")
        or (
            os.getenv("SMTP_HOST")
            and os.getenv("SMTP_PORT")
            and os.getenv("SMTP_FROM_EMAIL")
        )
    )


def _send_via_sendgrid(message: EmailMessage) -> dict:
    api_key = os.getenv("SENDGRID_API_KEY")
    if not api_key:
        raise RuntimeError("SENDGRID_API_KEY is not set")

    from_name, from_email = parseaddr(str(message["From"]))
    _, to_email = parseaddr(str(message["To"]))

    payload = {
        "personalizations": [{"to": [{"email": to_email}]}],
        "from": {
            "email": from_email,
            "name": from_name or os.getenv("SMTP_FROM_NAME", "WARDS Admin"),
        },
        "subject": str(message["Subject"]),
        "content": [],
    }

    attachments = []
    if message.is_multipart():
        for part in message.walk():
            if part is message:
                continue
            ctype = part.get_content_type()
            if ctype == "text/plain":
                payload["content"].append({"type": "text/plain", "value": part.get_content()})
            elif ctype == "text/html":
                payload["content"].append({"type": "text/html", "value": part.get_content()})
            elif part.get_content_maintype() == "multipart":
                continue
            else:
                raw = part.get_payload(decode=True)
                if raw:
                    att = {
                        "content": base64.b64encode(raw).decode("ascii"),
                        "filename": part.get_filename() or "attachment",
                        "type": ctype,
                        "disposition": part.get_content_disposition() or "attachment",
                    }
                    cid = part.get("Content-ID")
                    if cid:
                        att["content_id"] = cid.strip("<>")
                    attachments.append(att)
    else:
        ctype = message.get_content_type()
        if ctype == "text/plain":
            payload["content"].append({"type": "text/plain", "value": message.get_content()})
        elif ctype == "text/html":
            payload["content"].append({"type": "text/html", "value": message.get_content()})

    if attachments:
        payload["attachments"] = attachments

    response = requests.post(
        "https://api.sendgrid.com/v3/mail/send",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=20,
    )
    response.raise_for_status()

    return {"sent": True, "status": "sent"}


def _send_via_brevo(message: EmailMessage) -> dict:
    api_key = os.getenv("BREVO_API_KEY")
    if not api_key:
        raise RuntimeError("BREVO_API_KEY is not set")

    from_name, from_email = parseaddr(str(message["From"]))
    _, to_email = parseaddr(str(message["To"]))

    payload = {
        "sender": {
            "name": from_name or os.getenv("SMTP_FROM_NAME", "WARDS Admin"),
            "email": from_email,
        },
        "to": [{"email": to_email}],
        "subject": str(message["Subject"]),
    }

    attachments = []
    if message.is_multipart():
        for part in message.walk():
            if part is message:
                continue
            ctype = part.get_content_type()
            if ctype == "text/plain":
                payload["textContent"] = part.get_content()
            elif ctype == "text/html":
                payload["htmlContent"] = part.get_content()
            elif part.get_content_maintype() == "multipart":
                continue
            else:
                raw = part.get_payload(decode=True)
                if raw:
                    att = {
                        "name": part.get_filename() or "attachment",
                        "content": base64.b64encode(raw).decode("ascii"),
                    }
                    attachments.append(att)
    else:
        ctype = message.get_content_type()
        if ctype == "text/plain":
            payload["textContent"] = message.get_content()
        elif ctype == "text/html":
            payload["htmlContent"] = message.get_content()

    if attachments:
        payload["attachment"] = attachments

    response = requests.post(
        "https://api.brevo.com/v3/smtp/email",
        headers={
            "api-key": api_key,
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=20,
    )
    response.raise_for_status()

    return {"sent": True, "status": "sent"}


def _send_email_message(message: EmailMessage) -> dict:
    if os.getenv("SENDGRID_API_KEY"):
        return _send_via_sendgrid(message)
    if os.getenv("BREVO_API_KEY"):
        return _send_via_brevo(message)

    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_username = os.getenv("SMTP_USERNAME")
    smtp_password = os.getenv("SMTP_PASSWORD")
    use_tls = _env_flag("SMTP_USE_TLS", "true")

    with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as server:
        server.ehlo()
        if use_tls:
            server.starttls()
            server.ehlo()
        if smtp_username and smtp_password:
            server.login(smtp_username, smtp_password)
        server.send_message(message)

    return {
        "sent": True,
        "status": "sent",
    }


def _manila_now() -> datetime:
    return datetime.now(MANILA_TIMEZONE).replace(tzinfo=None)


def _coerce_manila_datetime(value: datetime | str | None) -> datetime | None:
    if value is None:
        return None

    parsed_value = value
    if isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            return None
        try:
            parsed_value = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
        except ValueError:
            return None

    if isinstance(parsed_value, datetime):
        if parsed_value.tzinfo is not None:
            return parsed_value.astimezone(MANILA_TIMEZONE).replace(tzinfo=None)
        return (parsed_value.replace(tzinfo=timezone.utc).astimezone(MANILA_TIMEZONE)).replace(tzinfo=None)

    return None


def _format_manila_timestamp(value: datetime | str | None = None) -> str:
    timestamp = _coerce_manila_datetime(value) or _manila_now()
    return timestamp.strftime("%B %d, %Y at %I:%M %p") + " PHT"


def _resolve_account_type_label(account_type: str) -> str:
    mapping = {
        "public": "Citizen User",
        "admin": "Main Admin",
        "branch": "Branch Admin",
        "branch_staff": "Branch Staff",
    }
    return mapping.get(account_type, account_type)


def _truncate_user_agent(user_agent: str | None) -> str | None:
    if not user_agent:
        return None
    cleaned = " ".join(user_agent.split())
    return cleaned[:180] + "..." if len(cleaned) > 180 else cleaned


def _load_email_logos() -> list[dict]:
    smtp_from_email = (os.getenv("SMTP_FROM_EMAIL") or "").strip()
    logo_cid_domain = smtp_from_email.split("@", 1)[1] if "@" in smtp_from_email else "treasury.local"
    logos: list[dict] = []
    for logo in EMAIL_LOGOS:
        logo_path = BRANDING_DIR / logo["filename"]
        if not logo_path.exists():
            continue
        logos.append(
            {
                **logo,
                "path": logo_path,
                "cid": make_msgid(domain=logo_cid_domain)[1:-1],
            }
        )
    return logos


def _build_logo_strip_html(logos: list[dict]) -> str:
    if not logos:
        return ""
    logo_items = "".join(
        f"""
        <div style="width:74px;height:74px;overflow:hidden;display:flex;align-items:center;justify-content:center;">
          <img src="cid:{logo['cid']}" alt="{logo['alt']}" style="width:100%;height:100%;object-fit:{logo['fit']};padding:{logo['padding']};display:block;" />
        </div>
        """
        for logo in logos
    )
    return f"""
    <div style="display:flex;justify-content:center;margin-bottom:18px;">
      <div style="display:inline-flex;gap:16px;align-items:center;justify-content:center;flex-wrap:wrap;">
        {logo_items}
      </div>
    </div>
    """


def _build_email_shell_header(title: str, subtitle: str, logos: list[dict]) -> str:
    return f"""
    <div style="background:linear-gradient(135deg,#0f2744 0%,#163a61 100%);border-radius:24px 24px 0 0;padding:26px 28px 30px;color:#ffffff;text-align:center;">
      {_build_logo_strip_html(logos)}
      <div style="margin-top:20px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.78;">City Treasurer's Office</div>
      <h1 style="margin:10px 0 8px;font-size:30px;line-height:1.15;font-weight:700;">{title}</h1>
      <p style="margin:0 auto;max-width:460px;font-size:15px;line-height:1.7;opacity:.92;">{subtitle}</p>
    </div>
    """


def _attach_inline_logos(message: EmailMessage, logos: list[dict]):
    if not logos:
        return
    html_part = message.get_payload()[-1]
    for logo in logos:
        with open(logo["path"], "rb") as image_file:
            html_part.add_related(
                image_file.read(),
                maintype="image",
                subtype=_attachment_subtype(logo["filename"]),
                cid=f"<{logo['cid']}>",
                filename=logo["filename"],
                disposition="inline",
            )


def _build_branch_access_text(
    branch_name: str,
    dashboard_url: str,
    login_email: str,
    password: str | None,
    verification_url: str | None = None,
    queue_accounts: list[dict] | None = None,
) -> str:
    lines = [
        "WARDS Branch Dashboard Access",
        "",
        f"You have been granted access to the WARDS branch dashboard for {branch_name}.",
    ]

    if verification_url:
        lines.extend([
            "",
            "Step 1: Verify your email first",
            "- Before you can sign in, you must verify this email address using the link below:",
            f"- {verification_url}",
            "- Do not attempt to log in until email verification is complete.",
        ])

    lines.extend(
        [
            "",
            "Step 2: Use your branch access details",
            f"- Branch dashboard: {dashboard_url}",
            f"- Login email: {login_email}",
            f"- {'Temporary password' if password else 'Password'}: {password or 'Use your existing branch password'}",
            "",
            "Important notes",
            "- This project is not deployed yet, so the link currently points to localhost.",
            "- Open the link on the local machine where WARDS is running.",
            "- After your first sign-in, please set up MFA in Microsoft Authenticator when prompted.",
        ]
    )

    if queue_accounts:
        lines.extend(
            [
                "",
                "Step 3: Generated queue window staff accounts",
                "- The service counter count also created queue-only branch staff accounts automatically.",
                "- Use the credentials below for queue-window-only access. Each account must set up Microsoft Authenticator MFA on first login.",
            ]
        )
        for account in queue_accounts:
            window_name = f"Window {account.get('assigned_window_number')} - {account.get('window_label') or account.get('service_window')}"
            lines.extend(
                [
                    "",
                    window_name,
                    f"- Login email: {account['email']}",
                    f"- Temporary password: {account['temporary_password']}",
                    f"- Access scope: {account.get('account_scope', 'queue_window')}",
                ]
            )

    lines.extend(
        [
            "",
            "If you were not expecting this access email, please contact the WARDS main administrator.",
            "",
            "City Treasurer's Office",
            "WARDS Admin",
        ]
    )

    return "\n".join(lines)


def _build_branch_access_html(
    branch_name: str,
    dashboard_url: str,
    login_email: str,
    password: str | None,
    verification_url: str | None = None,
    queue_accounts: list[dict] | None = None,
) -> str:
    verification_block = ""
    if verification_url:
        verification_block = f"""
        <div style="background:#fff8e8;border:1px solid #f4d58d;border-radius:14px;padding:18px 20px;margin:20px 0;">
          <h2 style="margin:0 0 12px;font-size:17px;color:#7c4a03;">Step 1: Verify Your Email First</h2>
          <p style="margin:0 0 14px;font-size:15px;line-height:1.7;">
            Before you can sign in, verify this email address by opening the link below.
          </p>
          <p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#7c4a03;">
            Do not use the dashboard email and password until this verification step is complete.
          </p>
          <p style="margin:0;">
            <a href="{_safe_html(verification_url)}" style="display:inline-block;background:#d97706;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:700;">
              Verify Email Address
            </a>
          </p>
        </div>
        """

    queue_accounts_block = ""
    if queue_accounts:
        queue_rows = "".join(
            f"""
            <tr>
              <td style="padding:12px 0;border-bottom:1px solid #e5e7eb;vertical-align:top;">
                <div style="font-weight:700;color:#0f2744;">Window {_safe_html(str(account.get('assigned_window_number')))} - {_safe_html(account.get('window_label') or account.get('service_window', ''))}</div>
                <div style="margin-top:4px;font-size:14px;color:#475569;">Login Email: <strong>{_safe_html(account['email'])}</strong></div>
                <div style="margin-top:4px;font-size:14px;color:#475569;">Temporary Password: <strong>{_safe_html(account['temporary_password'])}</strong></div>
                <div style="margin-top:4px;font-size:13px;color:#6b7280;">Queue-only access with Microsoft Authenticator MFA required on first login.</div>
              </td>
            </tr>
            """
            for account in queue_accounts
        )
        queue_accounts_block = f"""
        <div style="background:#f8fbff;border:1px solid #d7e5f5;border-radius:14px;padding:18px 20px;margin:20px 0;">
          <h2 style="margin:0 0 14px;font-size:17px;color:#0f2744;">Step 3: Generated Queue Window Staff Accounts</h2>
          <p style="margin:0 0 12px;font-size:14px;line-height:1.7;color:#546273;">
            These queue-only branch staff accounts were generated automatically from the selected service counter count.
          </p>
          <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
            {queue_rows}
          </table>
        </div>
        """

    return f"""
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
      <div style="background:#0f2744;border-radius:18px 18px 0 0;padding:24px 28px;color:#ffffff;">
        <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;opacity:.8;">City Treasurer's Office</div>
        <h1 style="margin:10px 0 0;font-size:28px;line-height:1.2;">WARDS Branch Dashboard Access</h1>
      </div>
      <div style="background:#ffffff;border-radius:0 0 18px 18px;padding:28px;box-shadow:0 18px 40px rgba(15,39,68,.10);">
        <p style="margin:0 0 16px;font-size:16px;line-height:1.7;">
          You have been granted access to the WARDS branch dashboard for
          <strong>{_safe_html(branch_name)}</strong>.
        </p>

        {verification_block}

        <div style="background:#f8fbff;border:1px solid #d7e5f5;border-radius:14px;padding:18px 20px;margin:20px 0;">
          <h2 style="margin:0 0 14px;font-size:17px;color:#0f2744;">Step 2: Branch Access Details</h2>
          <p style="margin:0 0 10px;font-size:15px;"><strong>Branch dashboard:</strong> <a href="{_safe_html(dashboard_url)}" style="color:#1d4ed8;text-decoration:none;">{_safe_html(dashboard_url)}</a></p>
          <p style="margin:0 0 10px;font-size:15px;"><strong>Login email:</strong> {_safe_html(login_email)}</p>
          <p style="margin:0;font-size:15px;"><strong>{"Temporary password" if password else "Password"}:</strong> {_safe_html(password or "Use your existing branch password")}</p>
        </div>

        <div style="background:#fff8e8;border:1px solid #f4d58d;border-radius:14px;padding:18px 20px;margin:20px 0;">
          <h2 style="margin:0 0 12px;font-size:17px;color:#7c4a03;">Important Notes</h2>
          <ul style="padding-left:18px;margin:0;color:#5b6471;font-size:14px;line-height:1.7;">
            <li>After your first sign-in, please set up MFA in Microsoft Authenticator when prompted.</li>
          </ul>
        </div>

        {queue_accounts_block}

        <p style="margin:24px 0 0;font-size:14px;line-height:1.7;color:#5b6471;">
          If you were not expecting this access email, please contact the WARDS main administrator.
        </p>

        <p style="margin:24px 0 0;font-size:14px;line-height:1.7;color:#1f2937;">
          City Treasurer's Office<br>
          <strong>WARDS Admin</strong>
        </p>
      </div>
    </div>
  </body>
</html>
"""


def _build_citizen_verification_text(verification_code: str, expires_minutes: int) -> str:
    registered_at = _format_manila_timestamp()
    return "\n".join(
        [
            "Welcome to WARDS",
            "",
            "Your citizen account registration was received successfully.",
            "Account Type: Citizen User",
            f"Registered On: {registered_at}",
            "",
            "Use the verification code below to activate your account:",
            verification_code,
            "",
            f"This code expires in {expires_minutes} minutes.",
            "After verification, your account will be activated and ready for sign-in.",
            "If you did not create this account, you can ignore this message.",
            "",
            "City Treasurer's Office",
            "WARDS Admin",
        ]
    )


def _build_citizen_verification_html(verification_code: str, expires_minutes: int, logos: list[dict]) -> str:
    registered_at = _format_manila_timestamp()
    return f"""
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
      {_build_email_shell_header("Welcome to WARDS", "Your citizen account has been created successfully. Complete the email verification step below to activate it and continue using WARDS services.", [])}
      <div style="background:#ffffff;border-radius:0 0 24px 24px;padding:30px 30px 32px;box-shadow:0 18px 40px rgba(15,39,68,.10);border:1px solid #dbe3ef;border-top:none;">
        <div style="background:#f8fbff;border:1px solid #dbe7f3;border-radius:18px;padding:20px 22px;margin:0 0 22px;">
          <h2 style="margin:0 0 12px;font-size:17px;color:#0f2744;">Registration Confirmation</h2>
          <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#546273;"><strong>Account Type:</strong> Citizen User</p>
          <p style="margin:0;font-size:14px;line-height:1.7;color:#546273;"><strong>Registered On:</strong> {_safe_html(registered_at)}</p>
        </div>
        <div style="background:#f8fbff;border:1px solid #dbe7f3;border-radius:18px;padding:20px 22px;margin:0 0 22px;">
          <h2 style="margin:0 0 10px;font-size:17px;color:#0f2744;">Verify and Activate Your Account</h2>
          <p style="margin:0;font-size:14px;line-height:1.7;color:#546273;">
            Enter the verification code below in WARDS. Once verified, your account will be activated and ready for sign-in.
          </p>
        </div>
        <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:16px;padding:18px 20px;margin:0 0 22px;text-align:center;">
          <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#64748b;">Verification Code</p>
          <p style="margin:0;font-size:34px;line-height:1.2;font-weight:800;letter-spacing:.28em;color:#166534;">{_safe_html(verification_code)}</p>
          <p style="margin:10px 0 0;font-size:13px;line-height:1.7;color:#5b6471;">This code expires in {_safe_html(str(expires_minutes))} minutes.</p>
        </div>
        <p style="margin:22px 0 0;font-size:14px;line-height:1.7;color:#5b6471;">
          If you did not create this account, you can safely ignore this message.
        </p>
        <p style="margin:24px 0 0;font-size:14px;line-height:1.7;color:#1f2937;">
          City Treasurer's Office<br><strong>WARDS Admin</strong>
        </p>
      </div>
    </div>
  </body>
</html>
"""


def send_branch_access_email(
    recipient_email: str,
    branch_name: str,
    login_email: str,
    password: str | None,
    dashboard_url: str | None = None,
    verification_url: str | None = None,
    queue_accounts: list[dict] | None = None,
) -> dict:
    dashboard_url = (
        dashboard_url
        or f"{os.getenv('FRONTEND_BASE_URL', 'http://localhost:3000').rstrip('/')}/branch-dashboard"
    )

    if not smtp_is_configured():
        return {
            "sent": False,
            "status": "skipped",
            "message": "SMTP is not configured. Branch created, but no email was sent.",
            "dashboard_url": dashboard_url,
        }

    smtp_from_email = os.getenv("SMTP_FROM_EMAIL")
    smtp_from_name = os.getenv("SMTP_FROM_NAME", "WARDS Admin")

    message = EmailMessage()
    message["Subject"] = f"Branch Dashboard Access for {branch_name} | WARDS"
    message["From"] = f"{smtp_from_name} <{smtp_from_email}>"
    message["To"] = recipient_email
    message.set_content(_build_branch_access_text(branch_name, dashboard_url, login_email, password, verification_url, queue_accounts))
    message.add_alternative(
        _build_branch_access_html(branch_name, dashboard_url, login_email, password, verification_url, queue_accounts),
        subtype="html",
    )

    try:
        result = _send_email_message(message)
        return {**result, "message": f"Branch access email sent to {recipient_email}.", "dashboard_url": dashboard_url}
    except Exception as exc:
        return {
            "sent": False,
            "status": "failed",
            "message": f"Branch created, but the email could not be sent: {exc}",
            "dashboard_url": dashboard_url,
        }


def send_new_window_accounts_email(
    recipient_email: str,
    branch_name: str,
    dashboard_url: str | None,
    new_accounts: list[dict],
    deactivated_count: int = 0,
) -> dict:
    """Send branch admin an email listing newly generated queue window accounts."""
    dashboard_url = (
        dashboard_url
        or f"{os.getenv('FRONTEND_BASE_URL', 'http://localhost:3000').rstrip('/')}/branch-dashboard"
    )

    if not smtp_is_configured():
        return {
            "sent": False,
            "status": "skipped",
            "message": "SMTP is not configured. Window accounts created but no email was sent.",
            "dashboard_url": dashboard_url,
        }

    smtp_from_email = os.getenv("SMTP_FROM_EMAIL")
    smtp_from_name = os.getenv("SMTP_FROM_NAME", "WARDS Admin")

    deactivation_note = (
        f"\n\nNote: {deactivated_count} previously active window account(s) have been automatically deactivated because the number of service counters was reduced."
        if deactivated_count > 0 else ""
    )

    # Plain-text body
    lines = [
        f"WARDS — New Queue Window Account(s) Added: {branch_name}",
        "",
        f"The following new queue window staff account(s) have been generated for {branch_name}.",
        "Use the credentials below to log in to each queue window. Each account requires Microsoft Authenticator MFA on first login.",
    ]
    for account in new_accounts:
        window_name = f"Window {account.get('assigned_window_number')} - {account.get('window_label') or account.get('service_window', '')}"
        lines.extend([
            "",
            window_name,
            f"  Login Email:        {account['email']}",
            f"  Temporary Password: {account['temporary_password']}",
            f"  Access Scope:       Queue-window only",
        ])
    lines.extend([
        deactivation_note,
        "",
        "If you were not expecting this email, please contact the WARDS main administrator.",
        "",
        "City Treasurer's Office",
        "WARDS Admin",
    ])
    plain_text = "\n".join(lines)

    # HTML body
    account_rows = "".join(
        f"""
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #e5e7eb;vertical-align:top;">
            <div style="font-weight:700;color:#0f2744;">
              Window {_safe_html(str(account.get('assigned_window_number')))} — {_safe_html(account.get('window_label') or account.get('service_window', ''))}
            </div>
            <div style="margin-top:4px;font-size:14px;color:#475569;">Login Email: <strong>{_safe_html(account['email'])}</strong></div>
            <div style="margin-top:4px;font-size:14px;color:#475569;">Temporary Password: <strong>{_safe_html(account['temporary_password'])}</strong></div>
            <div style="margin-top:4px;font-size:13px;color:#6b7280;">Queue-only access · Microsoft Authenticator MFA required on first login.</div>
          </td>
        </tr>
        """
        for account in new_accounts
    )

    deactivation_block = ""
    if deactivated_count > 0:
        deactivation_block = f"""
        <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:12px;padding:14px 18px;margin:20px 0;">
          <strong style="color:#7c4a03;">&#9888; {deactivated_count} window account(s) deactivated.</strong>
          <p style="margin:6px 0 0;font-size:14px;color:#7c4a03;line-height:1.6;">
            The number of service counters was reduced. The affected queue window account(s) have been automatically set to <strong>Inactive</strong> and can no longer log in.
          </p>
        </div>
        """

    html_body = f"""
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
      <div style="background:#0f2744;border-radius:18px 18px 0 0;padding:24px 28px;color:#ffffff;">
        <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;opacity:.8;">City Treasurer's Office</div>
        <h1 style="margin:10px 0 0;font-size:26px;line-height:1.2;">New Queue Window Account(s) Added</h1>
        <p style="margin:8px 0 0;font-size:15px;opacity:.9;">{_safe_html(branch_name)}</p>
      </div>
      <div style="background:#ffffff;border-radius:0 0 18px 18px;padding:28px;box-shadow:0 18px 40px rgba(15,39,68,.10);">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
          The following new queue window staff account(s) have been generated for <strong>{_safe_html(branch_name)}</strong>.
          Use the credentials below to log in. Each account requires Microsoft Authenticator MFA setup on first login.
        </p>

        {deactivation_block}

        <div style="background:#f8fbff;border:1px solid #d7e5f5;border-radius:14px;padding:18px 20px;margin:0 0 20px;">
          <h2 style="margin:0 0 14px;font-size:17px;color:#0f2744;">New Window Account Credentials</h2>
          <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
            {account_rows}
          </table>
        </div>

        <div style="background:#fff8e8;border:1px solid #f4d58d;border-radius:14px;padding:16px 20px;margin:0 0 20px;">
          <h2 style="margin:0 0 10px;font-size:15px;color:#7c4a03;">Important Notes</h2>
          <ul style="padding-left:18px;margin:0;color:#5b6471;font-size:14px;line-height:1.7;">
            <li>These accounts are for queue-window-only access. They cannot access the full branch dashboard.</li>
            <li>Each account must complete Microsoft Authenticator MFA setup on first login.</li>
            <li>If this project is running locally, open the branch dashboard on the same machine where WARDS is running.</li>
          </ul>
        </div>

        <p style="margin:20px 0 0;font-size:14px;line-height:1.7;color:#5b6471;">
          If you were not expecting this email, please contact the WARDS main administrator.
        </p>
        <p style="margin:20px 0 0;font-size:14px;line-height:1.7;color:#1f2937;">
          City Treasurer's Office<br><strong>WARDS Admin</strong>
        </p>
      </div>
    </div>
  </body>
</html>
"""

    message = EmailMessage()
    message["Subject"] = f"New Queue Window Account(s) Added — {branch_name} | WARDS"
    message["From"] = f"{smtp_from_name} <{smtp_from_email}>"
    message["To"] = recipient_email
    message.set_content(plain_text)
    message.add_alternative(html_body, subtype="html")

    try:
        result = _send_email_message(message)
        return {**result, "message": f"New window account credentials sent to {recipient_email}.", "dashboard_url": dashboard_url}
    except Exception as exc:
        return {
            "sent": False,
            "status": "failed",
            "message": f"Window accounts created but the email could not be sent: {exc}",
            "dashboard_url": dashboard_url,
        }


def _build_mfa_recovery_text(verification_code: str, expires_minutes: int) -> str:
    return "\n".join(
        [
            "City Treasurer's Office",
            "WARDS Security Verification",
            "",
            "You requested to reset your Multi-Factor Authentication (MFA) setup.",
            "",
            "Use the verification code below to continue:",
            verification_code,
            "",
            f"This code will expire in {expires_minutes} minutes. Please do not share this code with anyone.",
            "",
            "If you did not request this MFA reset, please ignore this email or contact the system administrator immediately.",
            "",
            "WARDS Public Service System",
            "City Treasurer's Office",
        ]
    )


def _build_mfa_recovery_html(verification_code: str, expires_minutes: int, logos: list[dict]) -> str:
    return f"""
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
      {_build_email_shell_header("MFA Reset Verification", "Verify your identity to reset your Multi-Factor Authentication setup and restore secure access to your account.", logos)}
      <div style="background:#ffffff;border-radius:0 0 24px 24px;padding:30px 30px 32px;box-shadow:0 18px 40px rgba(15,39,68,.10);border:1px solid #dbe3ef;border-top:none;">
        <div style="background:#f8fbff;border:1px solid #dbe7f3;border-radius:18px;padding:20px 22px;margin:0 0 22px;">
          <h2 style="margin:0 0 10px;font-size:17px;color:#0f2744;">Security Verification</h2>
          <p style="margin:0;font-size:14px;line-height:1.7;color:#546273;">
            You requested to reset your Multi-Factor Authentication (MFA) setup.
            Enter the verification code below in WARDS to continue.
          </p>
        </div>
        <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:16px;padding:18px 20px;margin:0 0 22px;text-align:center;">
          <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#64748b;">Verification Code</p>
          <p style="margin:0;font-size:34px;line-height:1.2;font-weight:800;letter-spacing:.28em;color:#166534;">{_safe_html(verification_code)}</p>
          <p style="margin:10px 0 0;font-size:13px;line-height:1.7;color:#5b6471;">This code expires in {_safe_html(str(expires_minutes))} minutes.</p>
        </div>
        <div style="background:#fff8e8;border:1px solid #f4d58d;border-radius:14px;padding:14px 18px;margin:0 0 22px;">
          <p style="margin:0;font-size:13px;line-height:1.7;color:#7c4a03;">
            <strong>Security Reminder:</strong> Please do not share this code with anyone. If you did not request this MFA reset, please ignore this email or contact the system administrator immediately.
          </p>
        </div>
        <p style="margin:24px 0 0;font-size:14px;line-height:1.7;color:#1f2937;">
          City Treasurer's Office<br><strong>WARDS Public Service System</strong>
        </p>
      </div>
    </div>
  </body>
</html>
"""


def send_mfa_recovery_email(recipient_email: str, verification_code: str, expires_minutes: int = 10) -> dict:
    if not smtp_is_configured():
        print(f"\n[DEV] MFA Recovery Email (SMTP not configured)\n  To: {recipient_email}\n  Code: {verification_code}\n  Expires: {expires_minutes} min\n")
        return {
            "sent": False,
            "status": "skipped",
            "message": "SMTP is not configured. Recovery email was not sent.",
        }

    smtp_from_email = os.getenv("SMTP_FROM_EMAIL")
    smtp_from_name = os.getenv("SMTP_FROM_NAME", "WARDS Admin")
    logos = _load_email_logos()
    message = EmailMessage()
    message["Subject"] = "WARDS MFA Reset Verification Code"
    message["From"] = f"{smtp_from_name} <{smtp_from_email}>"
    message["To"] = recipient_email
    message.set_content(_build_mfa_recovery_text(verification_code, expires_minutes))
    message.add_alternative(_build_mfa_recovery_html(verification_code, expires_minutes, logos), subtype="html")
    _attach_inline_logos(message, logos)

    try:
        result = _send_email_message(message)
        return {**result, "message": f"MFA recovery email sent to {recipient_email}."}
    except Exception as exc:
        return {
            "sent": False,
            "status": "failed",
            "message": f"MFA recovery email could not be sent: {exc}",
        }


def send_citizen_verification_email(recipient_email: str, verification_code: str, expires_minutes: int = 10) -> dict:
    if not smtp_is_configured():
        return {
            "sent": False,
            "status": "skipped",
            "message": "SMTP is not configured. Verification email was not sent.",
        }

    smtp_from_email = os.getenv("SMTP_FROM_EMAIL")
    smtp_from_name = os.getenv("SMTP_FROM_NAME", "WARDS Admin")
    message = EmailMessage()
    message["Subject"] = "Verify Your WARDS Account"
    message["From"] = f"{smtp_from_name} <{smtp_from_email}>"
    message["To"] = recipient_email
    message.set_content(_build_citizen_verification_text(verification_code, expires_minutes))
    message.add_alternative(_build_citizen_verification_html(verification_code, expires_minutes, []), subtype="html")

    try:
        result = _send_email_message(message)
        return {**result, "message": f"Verification email sent to {recipient_email}."}
    except Exception as exc:
        return {
            "sent": False,
            "status": "failed",
            "message": f"Verification email could not be sent: {exc}",
        }


def send_citizen_verification_link_email(recipient_email: str, verification_url: str) -> dict:
    if not smtp_is_configured():
        return {
            "sent": False,
            "status": "skipped",
            "message": "SMTP is not configured. Verification email was not sent.",
        }

    smtp_from_email = os.getenv("SMTP_FROM_EMAIL")
    smtp_from_name = os.getenv("SMTP_FROM_NAME", "WARDS Admin")

    message = EmailMessage()
    message["Subject"] = "Verify Your WARDS Account"
    message["From"] = f"{smtp_from_name} <{smtp_from_email}>"
    message["To"] = recipient_email
    message.set_content(
        "\n".join(
            [
                "Welcome to WARDS",
                "",
                "Your citizen account registration was received successfully.",
                "Use the verification link below to activate your account:",
                verification_url,
                "",
                "If you did not create this account, you can ignore this message.",
                "",
                "City Treasurer's Office",
                "WARDS Admin",
            ]
        )
    )
    message.add_alternative(
        f"""
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
      {_build_email_shell_header("Welcome to WARDS", "Your citizen account has been created successfully. Complete the email verification step below to activate it and continue using WARDS services.", [])}
      <div style="background:#ffffff;border-radius:0 0 24px 24px;padding:30px 30px 32px;box-shadow:0 18px 40px rgba(15,39,68,.10);border:1px solid #dbe3ef;border-top:none;">
        <div style="background:#f8fbff;border:1px solid #dbe7f3;border-radius:18px;padding:20px 22px;margin:0 0 22px;">
          <h2 style="margin:0 0 10px;font-size:17px;color:#0f2744;">Verify and Activate Your Account</h2>
          <p style="margin:0;font-size:14px;line-height:1.7;color:#546273;">
            Select the button below to verify your email address and activate your WARDS account.
          </p>
        </div>
        <div style="text-align:center;margin:0 0 22px;">
          <a href="{_safe_html(verification_url)}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:10px;font-weight:700;">
            Verify My Account
          </a>
        </div>
        <p style="margin:0;font-size:14px;line-height:1.7;color:#546273;word-break:break-word;">
          If the button does not open, use this link:<br>
          <a href="{_safe_html(verification_url)}" style="color:#166534;">{_safe_html(verification_url)}</a>
        </p>
        <p style="margin:22px 0 0;font-size:14px;line-height:1.7;color:#5b6471;">
          If you did not create this account, you can safely ignore this message.
        </p>
        <p style="margin:24px 0 0;font-size:14px;line-height:1.7;color:#1f2937;">
          City Treasurer's Office<br><strong>WARDS Admin</strong>
        </p>
      </div>
    </div>
  </body>
</html>
""",
        subtype="html",
    )

    try:
        result = _send_email_message(message)
        return {**result, "message": f"Verification email sent to {recipient_email}."}
    except Exception as exc:
        return {
            "sent": False,
            "status": "failed",
            "message": f"Verification email could not be sent: {exc}",
        }


def send_receipt_release_email(
    recipient_email: str,
    taxpayer_name: str,
    request_id: str,
    branch_name: str,
    attachment_path: str,
    attachment_name: str,
) -> dict:
    if not smtp_is_configured():
        return {
            "sent": False,
            "status": "skipped",
            "message": "SMTP is not configured. Receipt copy was released, but no email was sent.",
        }

    smtp_from_email = os.getenv("SMTP_FROM_EMAIL")
    smtp_from_name = os.getenv("SMTP_FROM_NAME", "WARDS Admin")

    message = EmailMessage()
    message["Subject"] = f"Your Receipt Copy is Ready | {request_id}"
    message["From"] = f"{smtp_from_name} <{smtp_from_email}>"
    message["To"] = recipient_email
    message.set_content(
        "\n".join(
            [
                f"Hello {taxpayer_name},",
                "",
                f"Your requested receipt copy ({request_id}) has been processed by {branch_name}.",
                "The finished copy is attached to this email.",
                "",
                "City Treasurer's Office",
                "WARDS Admin",
            ]
        )
    )
    message.add_alternative(
        f"""
        <html>
          <body style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
            <p>Hello <strong>{_safe_html(taxpayer_name)}</strong>,</p>
            <p>Your requested receipt copy <strong>{_safe_html(request_id)}</strong> has been processed by <strong>{_safe_html(branch_name)}</strong>.</p>
            <p>The finished copy is attached to this email.</p>
            <p>City Treasurer's Office<br><strong>WARDS Admin</strong></p>
          </body>
        </html>
        """,
        subtype="html",
    )

    with open(attachment_path, "rb") as attachment_file:
        message.add_attachment(
            attachment_file.read(),
            maintype="image",
            subtype=_attachment_subtype(attachment_name),
            filename=attachment_name,
        )

    try:
        result = _send_email_message(message)
        return {**result, "message": f"Released receipt copy emailed to {recipient_email}."}
    except Exception as exc:
        return {
            "sent": False,
            "status": "failed",
            "message": f"Receipt copy was released, but the email could not be sent: {exc}",
        }


def _format_receipt_timestamp(value: datetime | str | None) -> str:
    if value is None:
        return "Pending verification time"
    return _format_manila_timestamp(value)


def _build_payment_receipt_html(payment_details: dict, logos: list[dict]) -> str:
    email_context = payment_details.get("email_context") or "verified"
    if email_context == "rpt_submitted":
        document_title = "PayMongo Payment Confirmation"
        header_title = "PayMongo Payment Confirmation"
        header_subtitle = "Your payment was captured successfully through PayMongo. Please keep this email as your payment reference while your branch treasury office completes validation."
        summary_title = "Payment Submitted"
        summary_text = f"Your transaction for <b>{payment_details['tax_type']}</b> has been recorded under reference <b>{payment_details['ref_number']}</b> and is now waiting for branch treasury validation."
        status_label = "Current Payment Status"
        footer_text = "This email is your PayMongo payment confirmation from WARDS. Keep this file as reference and upload or present it when required by the branch treasury workflow."
    elif email_context == "branch_verified":
        document_title = "Branch Payment Verification Notice"
        header_title = "Branch Payment Verification Notice"
        header_subtitle = "Your payment has been reviewed and verified by the branch treasury office. Official receipt issuance remains subject to the branch release workflow."
        summary_title = "Payment Verified by Branch Treasury"
        summary_text = f"Your transaction for <b>{payment_details['tax_type']}</b> under reference <b>{payment_details['ref_number']}</b> has been verified by the assigned branch treasury personnel."
        status_label = "Branch Verification Status"
        footer_text = "This notice confirms that the branch treasury office verified your payment in WARDS. Keep this email for your records while final receipt release proceeds."
    else:
        document_title = "Official Payment Receipt"
        header_title = "Official Payment Receipt"
        header_subtitle = "Your payment has been verified successfully. The transaction summary below is your official email confirmation from WARDS."
        summary_title = "Payment Confirmed"
        summary_text = f"Your transaction for <b>{payment_details['tax_type']}</b> has been recorded under reference <b>{payment_details['ref_number']}</b>."
        status_label = "Verified Payment Status"
        footer_text = "This receipt was generated electronically by WARDS after payment verification. Keep this file for your audit and compliance records."

    return f"""
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>{_safe_html(document_title)}</title>
    <style>
      body {{
        margin: 0;
        padding: 32px;
        font-family: Arial, Helvetica, sans-serif;
        background: #f3f6fb;
        color: #1f2937;
      }}
      .receipt {{
        max-width: 760px;
        margin: 0 auto;
        background: #ffffff;
        border: 1px solid #d6dce7;
        border-radius: 24px;
        overflow: hidden;
        box-shadow: 0 18px 40px rgba(15,39,68,.10);
      }}
      .content {{
        padding: 30px 32px 34px;
      }}
      .summary {{
        background: #f8fbff;
        border: 1px solid #dbe7f3;
        border-radius: 18px;
        padding: 18px 20px;
        margin-bottom: 24px;
      }}
      .summary strong {{
        display: block;
        margin-bottom: 6px;
        color: #0f2744;
        font-size: 17px;
      }}
      .grid {{
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }}
      .grid td {{
        padding: 12px 0;
        border-bottom: 1px solid #e5e7eb;
        vertical-align: top;
        font-size: 14px;
        line-height: 1.6;
      }}
      .label {{
        width: 40%;
        font-weight: 700;
        color: #475569;
      }}
      .value {{
        color: #111827;
        font-weight: 600;
        padding-left: 14px;
      }}
      .status {{
        display: inline-block;
        padding: 6px 12px;
        border-radius: 999px;
        background: #dcfce7;
        color: #166534;
        font-weight: 700;
      }}
      .footer {{
        margin-top: 24px;
        font-size: 13px;
        line-height: 1.7;
        color: #64748b;
      }}
    </style>
  </head>
  <body>
    <div class="receipt">
      {_build_email_shell_header(header_title, header_subtitle, [])}
      <div class="content">
        <div class="summary">
          <strong>{_safe_html(summary_title)}</strong>
          <span>{summary_text}</span>
        </div>
        <table class="grid" role="presentation">
          <tr><td class="label">Payment Reference Number</td><td class="value">{_safe_html(payment_details["ref_number"])}</td></tr>
          <tr><td class="label">Transaction Date and Time</td><td class="value">{_safe_html(payment_details["verified_at"])}</td></tr>
          <tr><td class="label">Taxpayer Name</td><td class="value">{_safe_html(payment_details["taxpayer_name"])}</td></tr>
          <tr><td class="label">TIN</td><td class="value">{_safe_html(payment_details["tin"])}</td></tr>
          <tr><td class="label">Payment Type</td><td class="value">{_safe_html(payment_details["tax_type"])}</td></tr>
          <tr><td class="label">Payment Method</td><td class="value">{_safe_html(payment_details["payment_method"])}</td></tr>
          <tr><td class="label">Amount Paid</td><td class="value">{_safe_html(payment_details["amount"])}</td></tr>
          <tr><td class="label">{_safe_html(status_label)}</td><td class="value"><span class="status">{_safe_html(payment_details["status"])}</span></td></tr>
          <tr><td class="label">Branch</td><td class="value">{_safe_html(payment_details["branch"])}</td></tr>
          <tr><td class="label">Receipt Email</td><td class="value">{_safe_html(payment_details["email"])}</td></tr>
        </table>
        <p class="footer">
          {footer_text}
        </p>
      </div>
    </div>
  </body>
</html>
"""


def send_payment_receipt_email(
    recipient_email: str,
    payment_details: dict,
) -> dict:
    if not recipient_email:
        return {
            "sent": False,
            "status": "skipped",
            "message": "No recipient email is available for this payment receipt.",
        }

    if not smtp_is_configured():
        return {
            "sent": False,
            "status": "skipped",
            "message": "SMTP is not configured. Payment was verified, but no receipt email was sent.",
        }

    smtp_from_email = os.getenv("SMTP_FROM_EMAIL")
    smtp_from_name = os.getenv("SMTP_FROM_NAME", "WARDS Admin")
    verified_at = payment_details.get("verified_at")
    if isinstance(verified_at, (datetime, str)):
        verified_at_text = _format_receipt_timestamp(verified_at)
    else:
        verified_at_text = str(verified_at or "Pending verification time")

    prepared_details = {
        "ref_number": payment_details.get("ref_number") or "N/A",
        "verified_at": verified_at_text,
        "taxpayer_name": payment_details.get("taxpayer_name") or "N/A",
        "tin": payment_details.get("tin") or "N/A",
        "tax_type": payment_details.get("tax_type") or "N/A",
        "payment_method": payment_details.get("payment_method") or "N/A",
        "amount": payment_details.get("amount") or "PHP 0.00",
        "status": payment_details.get("status") or "Verified",
        "branch": payment_details.get("branch") or "N/A",
        "email": recipient_email,
        "email_context": payment_details.get("email_context") or "verified",
    }
    receipt_html = _build_payment_receipt_html(prepared_details, [])
    is_rpt_submitted_email = prepared_details["email_context"] == "rpt_submitted"
    is_branch_verified_email = prepared_details["email_context"] == "branch_verified"
    message = EmailMessage()
    message["Subject"] = (
        f"PayMongo Payment Confirmation | {prepared_details['ref_number']}"
        if is_rpt_submitted_email
        else (
            f"Branch Payment Verified | {prepared_details['ref_number']}"
            if is_branch_verified_email
            else f"Official Payment Receipt | {prepared_details['ref_number']}"
        )
    )
    message["From"] = f"{smtp_from_name} <{smtp_from_email}>"
    message["To"] = recipient_email
    message.set_content(
        "\n".join(
            (
                [
                    f"Hello {prepared_details['taxpayer_name']},",
                    "",
                    "Your PayMongo payment was captured successfully.",
                    f"Reference Number: {prepared_details['ref_number']}",
                    f"Transaction Date and Time: {prepared_details['verified_at']}",
                    f"TIN: {prepared_details['tin']}",
                    f"Payment Type: {prepared_details['tax_type']}",
                    f"Payment Method: {prepared_details['payment_method']}",
                    f"Amount Paid: {prepared_details['amount']}",
                    f"Status: {prepared_details['status']}",
                    "",
                    "Keep this email as your payment confirmation and upload or present it if the branch treasury workflow asks for supporting proof.",
                    "",
                    "City Treasurer's Office",
                    "WARDS Admin",
                ]
                if is_rpt_submitted_email
                else (
                    [
                        f"Hello {prepared_details['taxpayer_name']},",
                        "",
                        "Your payment has been verified by the branch treasury office.",
                        f"Reference Number: {prepared_details['ref_number']}",
                        f"Verification Date and Time: {prepared_details['verified_at']}",
                        f"TIN: {prepared_details['tin']}",
                        f"Payment Type: {prepared_details['tax_type']}",
                        f"Payment Method: {prepared_details['payment_method']}",
                        f"Amount Paid: {prepared_details['amount']}",
                        f"Status: {prepared_details['status']}",
                        "",
                        "Please keep this email while final receipt release is being processed by the branch treasury office.",
                        "",
                        "City Treasurer's Office",
                        "WARDS Admin",
                    ]
                    if is_branch_verified_email
                    else [
                        f"Hello {prepared_details['taxpayer_name']},",
                        "",
                        "Your payment has been verified successfully.",
                        f"Reference Number: {prepared_details['ref_number']}",
                        f"Transaction Date and Time: {prepared_details['verified_at']}",
                        f"TIN: {prepared_details['tin']}",
                        f"Payment Type: {prepared_details['tax_type']}",
                        f"Payment Method: {prepared_details['payment_method']}",
                        f"Amount Paid: {prepared_details['amount']}",
                        f"Status: {prepared_details['status']}",
                        "",
                        "This email serves as your official payment confirmation.",
                        "",
                        "City Treasurer's Office",
                        "WARDS Admin",
                    ]
                )
            )
        )
    )
    message.add_alternative(receipt_html, subtype="html")

    try:
        result = _send_email_message(message)
        return {**result, "message": f"Payment receipt email sent to {recipient_email}."}
    except Exception as exc:
        return {
            "sent": False,
            "status": "failed",
            "message": f"Payment was verified, but the receipt email could not be sent: {exc}",
        }


def _build_password_reset_text(
    display_name: str,
    account_type: str,
    reset_url: str,
    expires_minutes: int,
) -> str:
    return "\n".join(
        [
            "WARDS Password Reset Request",
            "",
            f"Hello {display_name},",
            "",
            "We received a request to reset your WARDS password.",
            f"Account Type: {_resolve_account_type_label(account_type)}",
            f"Reset Link Expires In: {expires_minutes} minutes",
            "",
            "Open the secure password reset link below:",
            reset_url,
            "",
            "If you did not request this password reset, you can ignore this email.",
            "",
            "City Treasurer's Office",
            "WARDS Admin",
        ]
    )


def _build_password_reset_html(
    display_name: str,
    account_type: str,
    reset_url: str,
    expires_minutes: int,
) -> str:
    return f"""
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
      {_build_email_shell_header("Password Reset Request", "Use the secure link below to reset your password and regain access to your WARDS account.", [])}
      <div style="background:#ffffff;border-radius:0 0 24px 24px;padding:30px 30px 32px;box-shadow:0 18px 40px rgba(15,39,68,.10);border:1px solid #dbe3ef;border-top:none;">
        <p style="margin:0 0 18px;font-size:16px;line-height:1.75;">Hello <strong>{display_name}</strong>,</p>
        <div style="background:#f8fbff;border:1px solid #dbe7f3;border-radius:18px;padding:20px 22px;margin:0 0 22px;">
          <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#546273;"><strong>Account Type:</strong> {_resolve_account_type_label(account_type)}</p>
          <p style="margin:0;font-size:14px;line-height:1.7;color:#546273;"><strong>Reset Link Expires In:</strong> {expires_minutes} minutes</p>
        </div>
        <p style="margin:0 0 24px;font-size:14px;line-height:1.7;color:#546273;">
          Click the button below to set a new password. For security, use the link before it expires.
        </p>
        <p style="margin:0 0 24px;text-align:center;">
          <a href="{reset_url}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:12px;font-weight:700;box-shadow:0 10px 24px rgba(29,78,216,.22);">
            Reset Password
          </a>
        </p>
        <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:16px;padding:16px 18px;">
          <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#64748b;">Reset Link</p>
          <p style="margin:0;font-size:14px;line-height:1.7;color:#5b6471;word-break:break-word;">
            If the button does not work, copy and paste this link into your browser:<br>
            <a href="{reset_url}" style="color:#1d4ed8;text-decoration:none;">{reset_url}</a>
          </p>
        </div>
        <p style="margin:22px 0 0;font-size:14px;line-height:1.7;color:#5b6471;">
          If you did not request a password reset, you can safely ignore this message.
        </p>
      </div>
    </div>
  </body>
</html>
"""


def send_password_reset_email(
    recipient_email: str,
    display_name: str,
    account_type: str,
    reset_url: str,
    expires_minutes: int = 30,
) -> dict:
    if not smtp_is_configured():
        return {
            "sent": False,
            "status": "skipped",
            "message": "SMTP is not configured. Password reset email was not sent.",
        }

    smtp_from_email = os.getenv("SMTP_FROM_EMAIL")
    smtp_from_name = os.getenv("SMTP_FROM_NAME", "WARDS Admin")
    message = EmailMessage()
    message["Subject"] = "Reset Your WARDS Password"
    message["From"] = f"{smtp_from_name} <{smtp_from_email}>"
    message["To"] = recipient_email
    message.set_content(_build_password_reset_text(display_name, account_type, reset_url, expires_minutes))
    message.add_alternative(_build_password_reset_html(display_name, account_type, reset_url, expires_minutes), subtype="html")

    try:
        result = _send_email_message(message)
        return {**result, "message": f"Password reset email sent to {recipient_email}."}
    except Exception as exc:
        return {
            "sent": False,
            "status": "failed",
            "message": f"Password reset email could not be sent: {exc}",
        }


def _build_login_notice_text(
    display_name: str,
    account_type: str,
    logged_in_at: datetime,
    ip_address: str | None,
    user_agent: str | None,
) -> str:
    lines = [
        "Successful Login Notice",
        "",
        f"Hello {display_name},",
        "",
        f"Your {_resolve_account_type_label(account_type)} account was successfully accessed on {_format_manila_timestamp(logged_in_at)}.",
        f"Account Type: {_resolve_account_type_label(account_type)}",
    ]
    if ip_address:
        lines.append(f"IP Address: {ip_address}")
    if user_agent:
        lines.append(f"Device/Browser: {_truncate_user_agent(user_agent)}")
    lines.extend(
        [
            "",
            "If this login was not you, please change your password immediately and contact your system administrator.",
            "",
            "City Treasurer's Office",
            "WARDS Admin",
        ]
    )
    return "\n".join(lines)


def _build_login_notice_html(
    display_name: str,
    account_type: str,
    logged_in_at: datetime,
    ip_address: str | None,
    user_agent: str | None,
) -> str:
    login_rows = [
        ("Account Type", _resolve_account_type_label(account_type)),
        ("Login Time", _format_manila_timestamp(logged_in_at)),
    ]
    if ip_address:
        login_rows.append(("IP Address", ip_address))
    if user_agent:
        login_rows.append(("Device / Browser", _truncate_user_agent(user_agent)))

    rows_html = "".join(
        f"<tr><td style=\"padding:10px 0;border-bottom:1px solid #e5e7eb;font-weight:700;color:#475569;width:38%;\">{_safe_html(label)}</td><td style=\"padding:10px 0 10px 14px;border-bottom:1px solid #e5e7eb;color:#111827;\">{_safe_html(value)}</td></tr>"
        for label, value in login_rows
    )

    return f"""
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
      {_build_email_shell_header("Successful Login Notice", "This security message confirms that your WARDS account was accessed successfully.", [])}
      <div style="background:#ffffff;border-radius:0 0 24px 24px;padding:30px 30px 32px;box-shadow:0 18px 40px rgba(15,39,68,.10);border:1px solid #dbe3ef;border-top:none;">
        <p style="margin:0 0 20px;font-size:16px;line-height:1.75;">Hello <strong>{_safe_html(display_name)}</strong>,</p>
        <table style="width:100%;border-collapse:collapse;table-layout:fixed;">{rows_html}</table>
        <p style="margin:22px 0 0;font-size:14px;line-height:1.7;color:#5b6471;">
          If this login was not you, please change your password immediately and contact your system administrator.
        </p>
      </div>
    </div>
  </body>
</html>
"""


def send_login_notification_email(
    recipient_email: str,
    display_name: str,
    account_type: str,
    logged_in_at: datetime,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> dict:
    if not recipient_email:
        return {
            "sent": False,
            "status": "skipped",
            "message": "No recipient email is available for the login notification.",
        }

    if not smtp_is_configured():
        return {
            "sent": False,
            "status": "skipped",
            "message": "SMTP is not configured. Login notification email was not sent.",
        }

    smtp_from_email = os.getenv("SMTP_FROM_EMAIL")
    smtp_from_name = os.getenv("SMTP_FROM_NAME", "WARDS Admin")
    message = EmailMessage()
    message["Subject"] = "Successful Login Notice | WARDS"
    message["From"] = f"{smtp_from_name} <{smtp_from_email}>"
    message["To"] = recipient_email
    message.set_content(_build_login_notice_text(display_name, account_type, logged_in_at, ip_address, user_agent))
    message.add_alternative(_build_login_notice_html(display_name, account_type, logged_in_at, ip_address, user_agent), subtype="html")

    try:
        result = _send_email_message(message)
        return {**result, "message": f"Login notification email sent to {recipient_email}."}
    except Exception as exc:
        return {
            "sent": False,
            "status": "failed",
            "message": f"Login notification email could not be sent: {exc}",
        }


def send_security_incident_alert_email(
    recipient_emails: list[str],
    incident: dict,
    detection: dict | None = None,
    recoveries: list[dict] | None = None,
) -> dict:
    recipients = sorted({email.strip() for email in (recipient_emails or []) if email and email.strip()})
    if not recipients:
        return {"sent": False, "status": "skipped", "message": "No admin recipients were available."}
    if not smtp_is_configured():
        return {"sent": False, "status": "skipped", "message": "SMTP is not configured. Security incident alert was not sent."}

    recovery_lines = [
        f"- {item.get('recovery_type', 'recovery')}: {item.get('status', 'unknown')} ({item.get('summary') or 'No summary'})"
        for item in (recoveries or [])
    ] or ["- No recovery event has been recorded yet."]
    text = "\n".join([
        "WARDS Security Incident Alert",
        "",
        f"Incident ID: SEC-{incident.get('id')}",
        f"Severity: {incident.get('severity_level')}",
        f"Status: {incident.get('status')}",
        f"Incident Type: {incident.get('incident_type')}",
        f"Description: {incident.get('description')}",
        "",
        "Related Detection",
        f"- Detection ID: {detection.get('id') if detection else 'N/A'}",
        f"- Target: {detection.get('target_name') if detection else 'N/A'}",
        f"- Change Type: {detection.get('change_type') if detection else 'N/A'}",
        f"- Trigger: {detection.get('trigger_summary') if detection else 'N/A'}",
        "",
        "Recovery Summary",
        *recovery_lines,
        "",
        "Review this incident in the Security Dashboard.",
        "",
        "City Treasurer's Office",
        "WARDS Security Monitor",
    ])

    html_recovery = "".join(f"<li>{_safe_html(line[2:])}</li>" for line in recovery_lines)
    html = f"""
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <div style="max-width:680px;margin:0 auto;padding:32px 20px;">
      {_build_email_shell_header("Security Incident Alert", "A security incident was logged by the WARDS monitoring system.", [])}
      <div style="background:#ffffff;border-radius:0 0 24px 24px;padding:30px;border:1px solid #dbe3ef;border-top:none;">
        <h2 style="margin:0 0 14px;color:#991b1b;">SEC-{_safe_html(str(incident.get('id')))} - {_safe_html(incident.get('severity_level', ''))}</h2>
        <p style="line-height:1.7;margin:0 0 18px;">{_safe_html(incident.get('description') or 'No description provided.')}</p>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:8px 0;font-weight:700;">Incident Type</td><td>{_safe_html(incident.get('incident_type', ''))}</td></tr>
          <tr><td style="padding:8px 0;font-weight:700;">Status</td><td>{_safe_html(incident.get('status', ''))}</td></tr>
          <tr><td style="padding:8px 0;font-weight:700;">Target</td><td>{_safe_html(detection.get('target_name') if detection else 'N/A')}</td></tr>
          <tr><td style="padding:8px 0;font-weight:700;">Change Type</td><td>{_safe_html(detection.get('change_type') if detection else 'N/A')}</td></tr>
        </table>
        <h3 style="margin:22px 0 10px;color:#0f2744;">Recovery Summary</h3>
        <ul style="line-height:1.7;">{html_recovery}</ul>
      </div>
    </div>
  </body>
</html>
"""

    message = EmailMessage()
    message["Subject"] = f"WARDS Security Incident SEC-{incident.get('id')} | {incident.get('severity_level')}"
    message["From"] = f"{os.getenv('SMTP_FROM_NAME', 'WARDS Admin')} <{os.getenv('SMTP_FROM_EMAIL')}>"
    message["To"] = ", ".join(recipients)
    message.set_content(text)
    message.add_alternative(html, subtype="html")
    try:
        result = _send_email_message(message)
        return {**result, "message": f"Security incident alert sent to {len(recipients)} admin(s)."}
    except Exception as exc:
        return {"sent": False, "status": "failed", "message": f"Security incident alert could not be sent: {exc}"}


def _build_registration_notice_text(
    display_name: str,
    account_type: str,
    registered_at: datetime,
) -> str:
    return "\n".join(
        [
            "WARDS Registration Confirmation",
            "",
            f"Hello {display_name},",
            "",
            "Your WARDS account registration was completed successfully.",
            f"Account Type: {_resolve_account_type_label(account_type)}",
            f"Registered On: {_format_manila_timestamp(registered_at)}",
            "",
            "You can now sign in using your registered account credentials.",
            "",
            "City Treasurer's Office",
            "WARDS Admin",
        ]
    )


def _build_registration_notice_html(
    display_name: str,
    account_type: str,
    registered_at: datetime,
) -> str:
    return f"""
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
      {_build_email_shell_header("Registration Confirmation", "Your WARDS account has been set up successfully and is ready for secure access.", [])}
      <div style="background:#ffffff;border-radius:0 0 24px 24px;padding:30px 30px 32px;box-shadow:0 18px 40px rgba(15,39,68,.10);border:1px solid #dbe3ef;border-top:none;">
        <p style="margin:0 0 18px;font-size:16px;line-height:1.75;">Hello <strong>{_safe_html(display_name)}</strong>,</p>
        <div style="background:#f8fbff;border:1px solid #dbe7f3;border-radius:18px;padding:20px 22px;">
          <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#546273;"><strong>Account Type:</strong> {_safe_html(_resolve_account_type_label(account_type))}</p>
          <p style="margin:0;font-size:14px;line-height:1.7;color:#546273;"><strong>Registered On:</strong> {_safe_html(_format_manila_timestamp(registered_at))}</p>
        </div>
        <p style="margin:22px 0 0;font-size:14px;line-height:1.7;color:#5b6471;">
          You can now sign in using your registered account credentials.
        </p>
      </div>
    </div>
  </body>
</html>
"""


def send_registration_confirmation_email(
    recipient_email: str,
    display_name: str,
    account_type: str,
    registered_at: datetime,
) -> dict:
    if not recipient_email:
        return {
            "sent": False,
            "status": "skipped",
            "message": "No recipient email is available for the registration confirmation.",
        }

    if not smtp_is_configured():
        return {
            "sent": False,
            "status": "skipped",
            "message": "SMTP is not configured. Registration confirmation email was not sent.",
        }

    smtp_from_email = os.getenv("SMTP_FROM_EMAIL")
    smtp_from_name = os.getenv("SMTP_FROM_NAME", "WARDS Admin")
    message = EmailMessage()
    message["Subject"] = "Registration Confirmation | WARDS"
    message["From"] = f"{smtp_from_name} <{smtp_from_email}>"
    message["To"] = recipient_email
    message.set_content(_build_registration_notice_text(display_name, account_type, registered_at))
    message.add_alternative(_build_registration_notice_html(display_name, account_type, registered_at), subtype="html")

    try:
        result = _send_email_message(message)
        return {**result, "message": f"Registration confirmation email sent to {recipient_email}."}
    except Exception as exc:
        return {
            "sent": False,
            "status": "failed",
            "message": f"Registration confirmation email could not be sent: {exc}",
        }


def _build_account_change_text(
    display_name: str,
    account_type: str,
    change_summary: str,
    changed_fields: list[str],
) -> str:
    fields = ", ".join(changed_fields or ["Account information"])
    return "\n".join(
        [
            "WARDS Account Change Notice",
            "",
            f"Hello {display_name},",
            "",
            change_summary,
            f"Account Type: {_resolve_account_type_label(account_type)}",
            f"Changed Fields: {fields}",
            f"Changed On: {_format_manila_timestamp()}",
            "",
            "If you did not make this change, please sign in and change your password immediately or contact the WARDS administrator.",
            "",
            "City Treasurer's Office",
            "WARDS Admin",
        ]
    )


def _build_account_change_html(
    display_name: str,
    account_type: str,
    change_summary: str,
    changed_fields: list[str],
) -> str:
    field_rows = "".join(
        f"<li style=\"margin:0 0 6px;color:#475569;\">{_safe_html(field)}</li>"
        for field in (changed_fields or ["Account information"])
    )
    return f"""
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
      {_build_email_shell_header("Account Change Notice", "This security message confirms a recent change to your WARDS account.", [])}
      <div style="background:#ffffff;border-radius:0 0 24px 24px;padding:30px 30px 32px;box-shadow:0 18px 40px rgba(15,39,68,.10);border:1px solid #dbe3ef;border-top:none;">
        <p style="margin:0 0 18px;font-size:16px;line-height:1.75;">Hello <strong>{_safe_html(display_name)}</strong>,</p>
        <div style="background:#f8fbff;border:1px solid #dbe7f3;border-radius:18px;padding:20px 22px;margin:0 0 22px;">
          <p style="margin:0 0 10px;font-size:14px;line-height:1.7;color:#546273;"><strong>Account Type:</strong> {_safe_html(_resolve_account_type_label(account_type))}</p>
          <p style="margin:0 0 10px;font-size:14px;line-height:1.7;color:#546273;"><strong>Change:</strong> {_safe_html(change_summary)}</p>
          <p style="margin:0;font-size:14px;line-height:1.7;color:#546273;"><strong>Changed On:</strong> {_safe_html(_format_manila_timestamp())}</p>
        </div>
        <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:16px;padding:16px 18px;">
          <p style="margin:0 0 10px;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#64748b;">Changed Fields</p>
          <ul style="padding-left:18px;margin:0;font-size:14px;line-height:1.7;">{field_rows}</ul>
        </div>
        <p style="margin:22px 0 0;font-size:14px;line-height:1.7;color:#5b6471;">
          If you did not make this change, please sign in and change your password immediately or contact the WARDS administrator.
        </p>
      </div>
    </div>
  </body>
</html>
"""


def send_account_change_notification_email(
    recipient_email: str,
    display_name: str,
    account_type: str,
    change_summary: str,
    changed_fields: list[str],
    subject: str | None = None,
) -> dict:
    if not recipient_email:
        return {
            "sent": False,
            "status": "skipped",
            "message": "No recipient email is available for the account change notification.",
        }

    if not smtp_is_configured():
        return {
            "sent": False,
            "status": "skipped",
            "message": "SMTP is not configured. Account change notification email was not sent.",
        }

    smtp_from_email = os.getenv("SMTP_FROM_EMAIL")
    smtp_from_name = os.getenv("SMTP_FROM_NAME", "WARDS Admin")
    message = EmailMessage()
    message["Subject"] = subject or "Account Change Notice | WARDS"
    message["From"] = f"{smtp_from_name} <{smtp_from_email}>"
    message["To"] = recipient_email
    message.set_content(_build_account_change_text(display_name, account_type, change_summary, changed_fields))
    message.add_alternative(_build_account_change_html(display_name, account_type, change_summary, changed_fields), subtype="html")

    try:
        result = _send_email_message(message)
        return {**result, "message": f"Account change notification email sent to {recipient_email}."}
    except Exception as exc:
        return {
            "sent": False,
            "status": "failed",
            "message": f"Account change notification email could not be sent: {exc}",
        }


def send_taxpayer_identifier_submission_email(
    recipient_email: str,
    display_name: str,
    submission_type: str,
    identifier_value: str,
    submitted_at: datetime,
) -> dict:
    if not recipient_email:
        return {"sent": False, "status": "skipped", "message": "No recipient email is available."}
    if not smtp_is_configured():
        return {"sent": False, "status": "skipped", "message": "SMTP is not configured."}

    identifier_label = "Tax Declaration Number" if submission_type == "RPT" else "Business Identifier"
    message = EmailMessage()
    message["Subject"] = f"{submission_type} Identifier Submitted | WARDS"
    message["From"] = f"{os.getenv('SMTP_FROM_NAME', 'WARDS Admin')} <{os.getenv('SMTP_FROM_EMAIL')}>"
    message["To"] = recipient_email
    message.set_content(
        "\n".join(
            [
                f"Hello {display_name},",
                "",
                "Your taxpayer identifier submission has been received by WARDS.",
                f"Submission Type: {submission_type}",
                f"{identifier_label}: {identifier_value}",
                "Current Status: Pending Verification",
                f"Submitted On: {_format_manila_timestamp(submitted_at)}",
                "",
                "You can monitor the verification status inside your taxpayer account.",
                "",
                "City Treasurer's Office",
                "WARDS Admin",
            ]
        )
    )
    message.add_alternative(
        f"""
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
      {_build_email_shell_header("Identifier Submission Received", "Your taxpayer identifier has been recorded and is now pending treasury verification.", [])}
      <div style="background:#ffffff;border-radius:0 0 24px 24px;padding:30px 30px 32px;box-shadow:0 18px 40px rgba(15,39,68,.10);border:1px solid #dbe3ef;border-top:none;">
        <p style="margin:0 0 18px;font-size:16px;line-height:1.75;">Hello <strong>{display_name}</strong>,</p>
        <div style="background:#f8fbff;border:1px solid #dbe7f3;border-radius:18px;padding:20px 22px;">
          <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#546273;"><strong>Submission Type:</strong> {submission_type}</p>
          <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#546273;"><strong>{identifier_label}:</strong> {identifier_value}</p>
          <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#546273;"><strong>Status:</strong> Pending Verification</p>
          <p style="margin:0;font-size:14px;line-height:1.7;color:#546273;"><strong>Submitted On:</strong> {_format_manila_timestamp(submitted_at)}</p>
        </div>
        <p style="margin:22px 0 0;font-size:14px;line-height:1.7;color:#5b6471;">
          You can monitor the verification status inside your taxpayer account.
        </p>
      </div>
    </div>
  </body>
</html>
""",
        subtype="html",
    )

    try:
        result = _send_email_message(message)
        return {**result, "message": f"Submission confirmation email sent to {recipient_email}."}
    except Exception as exc:
        return {"sent": False, "status": "failed", "message": f"Submission confirmation email could not be sent: {exc}"}


def send_taxpayer_verification_status_email(
    recipient_email: str,
    display_name: str,
    submission_type: str,
    status_label: str,
    identifier_value: str,
    remarks: str | None = None,
) -> dict:
    if not recipient_email:
        return {"sent": False, "status": "skipped", "message": "No recipient email is available."}
    if not smtp_is_configured():
        return {"sent": False, "status": "skipped", "message": "SMTP is not configured."}

    identifier_label = "Tax Declaration Number" if submission_type == "RPT" else "Business Identifier"
    remarks_text = (remarks or "").strip() or "No additional remarks provided."
    message = EmailMessage()
    message["Subject"] = f"{submission_type} Verification Status Updated | WARDS"
    message["From"] = f"{os.getenv('SMTP_FROM_NAME', 'WARDS Admin')} <{os.getenv('SMTP_FROM_EMAIL')}>"
    message["To"] = recipient_email
    message.set_content(
        "\n".join(
            [
                f"Hello {display_name},",
                "",
                "Your taxpayer identifier verification status has been updated.",
                f"Submission Type: {submission_type}",
                f"{identifier_label}: {identifier_value}",
                f"Current Status: {status_label}",
                f"Remarks: {remarks_text}",
                "",
                "You can review the same status inside your taxpayer account.",
                "",
                "City Treasurer's Office",
                "WARDS Admin",
            ]
        )
    )
    message.add_alternative(
        f"""
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
      {_build_email_shell_header("Verification Status Updated", "Your taxpayer identifier review has been updated by the treasury office.", [])}
      <div style="background:#ffffff;border-radius:0 0 24px 24px;padding:30px 30px 32px;box-shadow:0 18px 40px rgba(15,39,68,.10);border:1px solid #dbe3ef;border-top:none;">
        <p style="margin:0 0 18px;font-size:16px;line-height:1.75;">Hello <strong>{display_name}</strong>,</p>
        <div style="background:#f8fbff;border:1px solid #dbe7f3;border-radius:18px;padding:20px 22px;">
          <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#546273;"><strong>Submission Type:</strong> {submission_type}</p>
          <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#546273;"><strong>{identifier_label}:</strong> {identifier_value}</p>
          <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#546273;"><strong>Status:</strong> {status_label}</p>
          <p style="margin:0;font-size:14px;line-height:1.7;color:#546273;"><strong>Remarks:</strong> {remarks_text}</p>
        </div>
      </div>
    </div>
  </body>
</html>
""",
        subtype="html",
    )

    try:
        result = _send_email_message(message)
        return {**result, "message": f"Verification status email sent to {recipient_email}."}
    except Exception as exc:
        return {"sent": False, "status": "failed", "message": f"Verification status email could not be sent: {exc}"}
try:
    MANILA_TIMEZONE = ZoneInfo("Asia/Manila") if ZoneInfo else timezone(timedelta(hours=8))
except ZoneInfoNotFoundError:
    MANILA_TIMEZONE = timezone(timedelta(hours=8))
