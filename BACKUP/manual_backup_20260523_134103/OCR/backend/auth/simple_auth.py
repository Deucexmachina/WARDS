from datetime import datetime, timedelta
from typing import Optional

from database.config import SessionLocal
from database.models import BranchStaffAccount
from services.branch_staff_service import (
    build_otpauth_uri,
    get_branch_staff_account_for_login,
    serialize_branch_account,
    verify_password,
    verify_totp_code,
)


USERS = {
    "admin": {
        "username": "admin",
        "password": "admin123",
        "full_name": "System Administrator",
        "role": "admin",
        "portal_access": "full_admin",
    }
}

sessions = {}
mfa_challenges = {}


def _open_db():
    return SessionLocal()


def _admin_user_payload(user: dict) -> dict:
    return {
        "username": user["username"],
        "full_name": user["full_name"],
        "role": user["role"],
        "portal_access": user["portal_access"],
    }


def _branch_user_payload(account) -> dict:
    return {
        "id": account.id,
        "username": account.username,
        "full_name": account.window_label,
        "role": "branch_staff",
        "portal_access": "queue_only",
        "service_id": account.service_id,
        "window_code": account.window_code,
        "window_label": account.window_label,
        "email": account.email,
    }


def verify_credentials(username: str, password: str) -> Optional[dict]:
    normalized_username = username.strip()
    user = USERS.get(normalized_username)
    if user and user["password"] == password:
        return {
            "auth_type": "admin",
            "user": _admin_user_payload(user),
        }

    db = _open_db()
    try:
        account = get_branch_staff_account_for_login(db, normalized_username)
        if account and verify_password(password, account.password_hash):
            return {
                "auth_type": "branch_staff",
                "user": _branch_user_payload(account),
                "challenge_token": create_mfa_challenge(account),
                "mfa_setup_required": not account.mfa_enabled,
                "mfa_secret": account.mfa_secret,
                "otpauth_uri": build_otpauth_uri(account.username, account.mfa_secret),
            }
    finally:
        db.close()

    return None


def create_mfa_challenge(account) -> str:
    token = f"mfa_{account.username}_{datetime.now().timestamp()}"
    mfa_challenges[token] = {
        "account_id": account.id,
        "username": account.username,
        "expires_at": datetime.now() + timedelta(minutes=5),
    }
    return token


def create_session(user: dict) -> str:
    token = f"session_{user['username']}_{datetime.now().timestamp()}"
    sessions[token] = {
        "user": user,
        "created_at": datetime.now(),
        "expires_at": datetime.now() + timedelta(hours=8),
    }
    return token


def complete_mfa_login(challenge_token: str, otp_code: str) -> Optional[dict]:
    challenge = mfa_challenges.get(challenge_token)
    if not challenge:
        return None

    if datetime.now() > challenge["expires_at"]:
        del mfa_challenges[challenge_token]
        return None

    db = _open_db()
    try:
        account = get_branch_staff_account_for_login(db, challenge["username"])
        if not account or account.id != challenge["account_id"]:
            return None

        if not verify_totp_code(account.mfa_secret, otp_code):
            return False

        account.mfa_enabled = True
        account.last_login = datetime.utcnow()
        db.commit()

        del mfa_challenges[challenge_token]
        return _branch_user_payload(account)
    finally:
        db.close()


def verify_session(token: str) -> Optional[dict]:
    session = sessions.get(token)
    if not session:
        return None

    if datetime.now() > session["expires_at"]:
        del sessions[token]
        return None

    user = session["user"]
    if user["role"] == "admin":
        admin = USERS.get(user["username"])
        if admin:
            return _admin_user_payload(admin)
        return None

    db = _open_db()
    try:
        account = get_branch_staff_account_for_login(db, user["username"])
        if account:
            return _branch_user_payload(account)
        return None
    finally:
        db.close()


def delete_session(token: str):
    if token in sessions:
        del sessions[token]


def list_active_branch_accounts() -> list[dict]:
    db = _open_db()
    try:
        accounts = (
            db.query(BranchStaffAccount)
            .filter_by(is_active=True)
            .order_by(BranchStaffAccount.service_id.asc())
            .all()
        )
        return [serialize_branch_account(account) for account in accounts]
    finally:
        db.close()
