import re
from typing import Optional

from email_validator import EmailNotValidError, validate_email
from fastapi import HTTPException, status
import os
import requests
from sqlalchemy.orm import Session

from database.models import Admin, Branch, BranchStaff, CitizenUser
from utils.field_crypto import find_citizen_by_email, find_citizen_by_tin, hash_optional_value


DUPLICATE_EMAIL_MESSAGE = "This email has already been used."
EMAIL_INVALID_MESSAGE = "Please enter a valid email address."
PASSWORD_INVALID_MESSAGE = (
    "Password must be more than 12 characters long and include at least one uppercase letter, "
    "one lowercase letter, and at least one number or special character."
)
TIN_INVALID_MESSAGE = "Invalid TIN. Please enter a valid 9–12 digit Tax Identification Number."

USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")
TIN_ALLOWED_PATTERN = re.compile(r"^[\d\s-]+$")
TIN_DIGITS_PATTERN = re.compile(r"^\d{9,12}$")
CITIZEN_FULL_NAME_PATTERN = re.compile(r"^[A-Za-z ]+$")
PH_CONTACT_DIGITS_PATTERN = re.compile(r"^9\d{9}$")

QUICK_EMAIL_VERIFICATION_URL = "https://api.quickemailverification.com/v1/verify"
QUICK_EMAIL_VERIFICATION_TIMEOUT_SECONDS = float(
    os.getenv("QUICKEMAILVERIFICATION_TIMEOUT_SECONDS", "8")
)


def _coerce_qev_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def normalize_email(email: str, *, check_deliverability: bool = False) -> str:
    try:
        validated = validate_email(email.strip(), check_deliverability=check_deliverability)
    except EmailNotValidError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please enter a real, deliverable email address." if check_deliverability else EMAIL_INVALID_MESSAGE,
        ) from exc
    normalized_email = validated.normalized.lower()

    if check_deliverability:
        verify_with_quickemailverification(normalized_email)

    return normalized_email


def verify_with_quickemailverification(email: str):
    api_key = (os.getenv("QUICKEMAILVERIFICATION_API_KEY") or "").strip()
    if not api_key:
        return

    try:
        response = requests.get(
            QUICK_EMAIL_VERIFICATION_URL,
            params={"email": email, "apikey": api_key},
            timeout=QUICK_EMAIL_VERIFICATION_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException:
        # Keep citizen registration available even if the external verifier is down.
        return

    if not _coerce_qev_bool(payload.get("success", False)):
        return

    result = str(payload.get("result") or "").strip().lower()
    reason = str(payload.get("reason") or "").strip().lower()
    disposable = _coerce_qev_bool(payload.get("disposable"))
    safe_to_send = _coerce_qev_bool(payload.get("safe_to_send"))
    did_you_mean = str(payload.get("did_you_mean") or "").strip()

    if disposable:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Disposable email addresses are not allowed. Please use a permanent email address.",
        )

    if safe_to_send and result == "valid":
        return

    if did_you_mean:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Please enter a valid email address. Did you mean {did_you_mean}?",
        )

    if result == "invalid":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please enter a real, deliverable email address.",
        )

    # Allow registration to continue for inconclusive results such as accept-all,
    # unknown, or temporary third-party uncertainty. The email verification OTP
    # step still protects account activation.
    return


def normalize_branch_name(name: str) -> str:
    cleaned = re.sub(r"\s+", " ", name or "").strip()
    if not cleaned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Branch name is required.")
    return cleaned


def normalize_citizen_full_name(full_name: str) -> str:
    cleaned = re.sub(r"\s+", " ", (full_name or "").strip())
    if not cleaned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Full name is required.")
    if not CITIZEN_FULL_NAME_PATTERN.fullmatch(cleaned):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Full name must contain letters and spaces only.",
        )
    return cleaned


def normalize_ph_contact_number(contact_number: str) -> str:
    raw_value = (contact_number or "").strip()
    if not raw_value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Contact number is required.")

    normalized = re.sub(r"\D", "", raw_value)
    subscriber_number = normalized

    if subscriber_number.startswith("63"):
        subscriber_number = subscriber_number[2:]
    elif subscriber_number.startswith("0"):
        subscriber_number = subscriber_number[1:]

    if not PH_CONTACT_DIGITS_PATTERN.fullmatch(subscriber_number):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Contact number must begin with 9 and contain exactly 10 digits.",
        )

    return f"+63{subscriber_number}"


def normalize_username(username: str) -> str:
    cleaned = (username or "").strip()
    if not cleaned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username is required.")
    if not USERNAME_PATTERN.fullmatch(cleaned):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username must be 3-32 characters and may only contain letters, numbers, dots, underscores, or hyphens.",
        )
    return cleaned


def validate_strong_password(password: str):
    password_bytes = password.encode("utf-8")

    if len(password) <= 12:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=PASSWORD_INVALID_MESSAGE)
    if len(password_bytes) > 72:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password is too long for secure processing. Please use 72 bytes or fewer.",
        )
    if not re.search(r"[A-Z]", password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=PASSWORD_INVALID_MESSAGE)
    if not re.search(r"[a-z]", password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=PASSWORD_INVALID_MESSAGE)
    if not re.search(r"[\d\W]", password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=PASSWORD_INVALID_MESSAGE)


def normalize_tin(tin: str) -> str:
    raw_value = (tin or "").strip()
    if not raw_value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=TIN_INVALID_MESSAGE)
    if not TIN_ALLOWED_PATTERN.fullmatch(raw_value):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=TIN_INVALID_MESSAGE)

    normalized = re.sub(r"\D", "", raw_value)
    if not TIN_DIGITS_PATTERN.fullmatch(normalized):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=TIN_INVALID_MESSAGE)
    return normalized


def format_tin(tin: str | None) -> str | None:
    normalized = re.sub(r"\D", "", tin or "")
    if not normalized:
        return None
    return "-".join(normalized[index:index + 3] for index in range(0, len(normalized), 3))


def normalize_identity_name(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip()).casefold()


def ensure_email_is_unique(
    db: Session,
    email: str,
    *,
    exclude_admin_id: Optional[int] = None,
    exclude_branch_staff_id: Optional[int] = None,
    exclude_citizen_id: Optional[int] = None,
):
    admin_query = db.query(Admin).filter(Admin.email == email)
    if exclude_admin_id is not None:
        admin_query = admin_query.filter(Admin.id != exclude_admin_id)
    if admin_query.first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=DUPLICATE_EMAIL_MESSAGE)

    branch_query = db.query(BranchStaff).filter(BranchStaff.email == email)
    if exclude_branch_staff_id is not None:
        branch_query = branch_query.filter(BranchStaff.id != exclude_branch_staff_id)
    if branch_query.first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=DUPLICATE_EMAIL_MESSAGE)

    citizen_match = find_citizen_by_email(db, CitizenUser, email)
    if citizen_match and (exclude_citizen_id is None or citizen_match.id != exclude_citizen_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=DUPLICATE_EMAIL_MESSAGE)


def ensure_tin_is_unique(
    db: Session,
    tin: str,
    *,
    exclude_citizen_id: Optional[int] = None,
):
    citizen_match = find_citizen_by_tin(db, CitizenUser, tin)
    if citizen_match and (exclude_citizen_id is None or citizen_match.id != exclude_citizen_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This TIN is already registered to another citizen account.",
        )


def ensure_username_is_unique(
    db: Session,
    username: str,
    *,
    exclude_admin_id: Optional[int] = None,
    exclude_branch_staff_id: Optional[int] = None,
):
    admin_query = db.query(Admin).filter(Admin.username == username)
    if exclude_admin_id is not None:
        admin_query = admin_query.filter(Admin.id != exclude_admin_id)
    if admin_query.first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This username is already in use.")

    branch_query = db.query(BranchStaff).filter(BranchStaff.username == username)
    if exclude_branch_staff_id is not None:
        branch_query = branch_query.filter(BranchStaff.id != exclude_branch_staff_id)
    if branch_query.first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This username is already in use.")


def ensure_branch_name_is_unique(db: Session, branch_name: str, *, exclude_branch_id: Optional[int] = None):
    query = db.query(Branch).filter(Branch.name.ilike(branch_name))
    if exclude_branch_id is not None:
        query = query.filter(Branch.id != exclude_branch_id)
    if query.first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This branch name has already been used.")
