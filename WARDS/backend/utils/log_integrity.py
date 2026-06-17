from __future__ import annotations

import hashlib
import hmac
import json
import os
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import event, select

try:
    MASTER_ROOT = Path(__file__).resolve().parents[3]
except IndexError:
    MASTER_ROOT = Path("/")
if str(MASTER_ROOT) not in sys.path:
    sys.path.insert(0, str(MASTER_ROOT))

from database.models import ActivityLog
from SECURITY.security_models import (
    SecurityAdminFileChange,
    SecurityDetectionEvent,
    SecurityIncident,
    SecurityRecoveryEvent,
)


INTEGRITY_COLUMNS = {"id", "integrity_hash", "previous_integrity_hash"}
PROTECTED_MODELS = (
    ActivityLog,
    SecurityDetectionEvent,
    SecurityRecoveryEvent,
    SecurityIncident,
    SecurityAdminFileChange,
)

DEFAULT_VALUES = {
    "action_logs": {},
    "activity_logs": {"created_at": datetime.utcnow},
    "security_detection_events": {"detected_at": datetime.utcnow, "target_type": "file", "is_legitimate": False},
    "security_recovery_events": {"started_at": datetime.utcnow, "status": "in_progress"},
    "security_incidents": {"created_at": datetime.utcnow, "status": "open"},
    "security_admin_file_changes": {"timestamp": datetime.utcnow},
}


def integrity_secret() -> str:
    value = os.getenv("LOG_INTEGRITY_SECRET") or os.getenv("DATA_HASH_SECRET")
    if not value:
        raise RuntimeError(
            "Missing required environment variable: LOG_INTEGRITY_SECRET or DATA_HASH_SECRET. "
            "Please ensure at least one is set in your .env file."
        )
    return value.strip()


def _json_default(value: Any):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return str(value)


def integrity_payload(record) -> dict[str, Any]:
    payload = {}
    for column in record.__table__.columns:
        if column.name in INTEGRITY_COLUMNS:
            continue
        payload[column.name] = getattr(record, column.name, None)
    payload["previous_integrity_hash"] = getattr(record, "previous_integrity_hash", None)
    return payload


def calculate_integrity_hash(record) -> str:
    encoded = json.dumps(integrity_payload(record), sort_keys=True, separators=(",", ":"), default=_json_default)
    return hmac.new(integrity_secret().encode("utf-8"), encoded.encode("utf-8"), hashlib.sha256).hexdigest()


def previous_hash_for(connection, target) -> str | None:
    table = target.__table__
    if "integrity_hash" not in table.c or "id" not in table.c:
        return None
    row = connection.execute(
        select(table.c.integrity_hash)
        .where(table.c.integrity_hash.is_not(None))
        .order_by(table.c.id.desc())
        .limit(1)
    ).first()
    return row[0] if row else None


def apply_insert_defaults(target) -> None:
    defaults = DEFAULT_VALUES.get(target.__tablename__, {})
    for field_name, value in defaults.items():
        if getattr(target, field_name, None) is not None:
            continue
        setattr(target, field_name, value() if callable(value) else value)


def sign_before_insert(mapper, connection, target) -> None:
    apply_insert_defaults(target)
    if not getattr(target, "previous_integrity_hash", None):
        target.previous_integrity_hash = previous_hash_for(connection, target)
    target.integrity_hash = calculate_integrity_hash(target)


def sign_before_update(mapper, connection, target) -> None:
    target.integrity_hash = calculate_integrity_hash(target)


def reject_activity_log_update(mapper, connection, target) -> None:
    raise RuntimeError("ActivityLog records are append-only and cannot be modified.")


def reject_protected_delete(mapper, connection, target) -> None:
    raise RuntimeError(f"{target.__class__.__name__} records are append-only and cannot be deleted.")


def verify_record_integrity(record) -> bool | None:
    stored = getattr(record, "integrity_hash", None)
    if not stored:
        return None
    return hmac.compare_digest(stored, calculate_integrity_hash(record))


def register_log_integrity_listeners() -> None:
    for model in PROTECTED_MODELS:
        event.listen(model, "before_insert", sign_before_insert, propagate=True)
        event.listen(model, "before_update", sign_before_update, propagate=True)
        event.listen(model, "before_delete", reject_protected_delete, propagate=True)
    # ActivityLog is strictly append-only: also reject updates
    event.listen(ActivityLog, "before_update", reject_activity_log_update, propagate=True)


def backfill_log_integrity_hashes(db) -> dict[str, int]:
    counts = {}
    for model in PROTECTED_MODELS:
        previous_hash = None
        updated = 0
        for record in db.query(model).order_by(model.id.asc()).all():
            if getattr(record, "integrity_hash", None):
                previous_hash = record.integrity_hash
                continue
            record.previous_integrity_hash = previous_hash
            record.integrity_hash = calculate_integrity_hash(record)
            previous_hash = record.integrity_hash
            db.add(record)
            updated += 1
        counts[model.__tablename__] = updated
    db.commit()
    return counts


register_log_integrity_listeners()
