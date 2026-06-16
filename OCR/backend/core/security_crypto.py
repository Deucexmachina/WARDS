import base64
import hashlib
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken


def _get_encryption_secret() -> str:
    value = os.getenv("DATA_ENCRYPTION_SECRET")
    if not value:
        raise RuntimeError(
            "Missing required environment variable: DATA_ENCRYPTION_SECRET. "
            "Please ensure it is set in your .env file."
        )
    return value


def _get_fernet() -> Fernet:
    secret = _get_encryption_secret().encode("utf-8")
    key = base64.urlsafe_b64encode(hashlib.sha256(secret).digest())
    return Fernet(key)


def encrypt_value(value: str) -> str:
    normalized = value.strip()
    return _get_fernet().encrypt(normalized.encode("utf-8")).decode("utf-8")


def encrypt_optional_value(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None

    normalized = value.strip()
    if not normalized:
        return None

    return encrypt_value(normalized)


def decrypt_optional_value(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None

    normalized = value.strip()
    if not normalized:
        return None

    try:
        return _get_fernet().decrypt(normalized.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return None
