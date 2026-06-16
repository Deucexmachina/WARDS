import hashlib
import hmac
import os
from typing import Optional


def _get_hash_secret() -> str:
    value = os.getenv("DATA_HASH_SECRET")
    if not value:
        raise RuntimeError(
            "Missing required environment variable: DATA_HASH_SECRET. "
            "Please ensure it is set in your .env file."
        )
    return value


def hash_sensitive_value(value: str) -> str:
    normalized = value.strip()
    secret = _get_hash_secret().encode("utf-8")
    return hmac.new(secret, normalized.encode("utf-8"), hashlib.sha256).hexdigest()


def hash_optional_value(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None

    normalized = value.strip()
    if not normalized:
        return None

    return hash_sensitive_value(normalized)


def normalize_hash_value(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def hash_record_parts(*parts) -> str:
    normalized = "|".join(normalize_hash_value(part) for part in parts)
    return hash_sensitive_value(normalized)
