import os
from typing import Optional

from core.security_hash import hash_optional_value


def phase2_redaction_enabled() -> bool:
    return os.getenv("WARDS_SECURITY_PHASE2_REDACT", "false").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _hash_prefix(value: Optional[str], length: int = 16) -> str:
    digest = hash_optional_value(value or "") or ("0" * 64)
    return digest[:length]


def build_redacted_text(prefix: str, value: Optional[str], max_length: int = 255) -> str:
    token = f"{prefix}_{_hash_prefix(value)}"
    return token[:max_length]


def build_redacted_email(prefix: str, value: Optional[str], max_length: int = 255) -> str:
    token = f"{prefix.lower()}.{_hash_prefix(value, 20)}@redacted.local"
    return token[:max_length]


def build_redacted_amount() -> str:
    return "0.00"
