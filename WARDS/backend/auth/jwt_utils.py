import os
import uuid
from datetime import datetime, timedelta
from typing import Optional

from jose import jwt

ALGORITHM = "HS256"
REFRESH_TOKEN_EXPIRE_DAYS = 7


def _require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(
            f"Missing required environment variable: {name}. "
            "Please ensure it is set in your .env file."
        )
    return value


# Load all authentication secrets from environment.
# These MUST be configured in the .env file — no hardcoded fallbacks.
ADMIN_SECRET_KEY = _require_env("ADMIN_SECRET_KEY")
USER_SECRET_KEY = _require_env("USER_SECRET_KEY")
BRANCH_SECRET_KEY = _require_env("BRANCH_SECRET_KEY")
PASSWORD_RESET_SECRET_KEY = _require_env("PASSWORD_RESET_SECRET_KEY")

PORTAL_CONFIG = {
    "unknown": {
        "secret_key": USER_SECRET_KEY,
        "token_type": "user",
        "expires_minutes": 30,
        "captcha_threshold": 1,
        "lockout_duration": 120,
        "issuer_name": "WARDS Portal",
    },
    "public": {
        "secret_key": USER_SECRET_KEY,
        "token_type": "user",
        "expires_minutes": 30,
        "captcha_threshold": 1,
        "lockout_duration": 120,
        "issuer_name": "WARDS Public Portal",
    },
    "admin": {
        "secret_key": ADMIN_SECRET_KEY,
        "token_type": "admin",
        "expires_minutes": 30,
        "captcha_threshold": 1,
        "lockout_duration": 120,
        "issuer_name": "WARDS Admin Portal",
    },
    "branch": {
        "secret_key": BRANCH_SECRET_KEY,
        "token_type": "branch",
        "expires_minutes": 30,
        "captcha_threshold": 1,
        "lockout_duration": 120,
        "issuer_name": "WARDS Branch Portal",
    },
}


def create_access_token(portal: str, data: dict) -> str:
    config = PORTAL_CONFIG.get(portal, PORTAL_CONFIG["unknown"])
    expires_delta = timedelta(minutes=config["expires_minutes"])
    to_encode = data.copy()
    to_encode["exp"] = datetime.utcnow() + expires_delta
    to_encode.setdefault("jti", str(uuid.uuid4()))
    return jwt.encode(to_encode, config["secret_key"], algorithm=ALGORITHM)


def create_refresh_token(portal: str, data: dict) -> str:
    config = PORTAL_CONFIG.get(portal, PORTAL_CONFIG["unknown"])
    to_encode = data.copy()
    to_encode["type"] = "refresh"
    to_encode["portal"] = portal
    to_encode["exp"] = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.setdefault("jti", str(uuid.uuid4()))
    return jwt.encode(to_encode, config["secret_key"], algorithm=ALGORITHM)


def decode_token(token: str, secret: str, options: dict | None = None) -> dict:
    kwargs = {}
    if options is not None:
        kwargs["options"] = options
    return jwt.decode(token, secret, algorithms=[ALGORITHM], **kwargs)


def get_portal_config(portal: str) -> dict:
    return PORTAL_CONFIG.get(portal, PORTAL_CONFIG["unknown"])
