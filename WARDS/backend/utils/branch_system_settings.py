from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from database.models import ActivityLog, Branch, BranchSystemSetting, Service
from utils.field_crypto import service_value
from utils.system_settings import (
    SETTINGS_METADATA,
    _deserialize_value,
    _normalize_value,
    _serialize_value,
    get_settings_payload,
)


BRANCH_SCOPED_SETTING_KEYS = {
    "queueEnabled",
    "maxQueuePerBranch",
    "maxQueuePerWindow",
    "queueTimeSlot",
    "enabledServices",
    "paymentGatewayEnabled",
    "receiptRequestEnabled",
    "maintenanceMode",
}


def _get_branch_override_rows(db: Session, branch_id: int) -> list[BranchSystemSetting]:
    return (
        db.query(BranchSystemSetting)
        .filter(
            BranchSystemSetting.branch_id == branch_id,
            BranchSystemSetting.key.in_(list(BRANCH_SCOPED_SETTING_KEYS)),
        )
        .all()
    )


def _get_active_service_names(db: Session) -> list[str]:
    return sorted(
        [
            service_value(service, "name")
            for service in db.query(Service).filter(Service.is_active.is_(True)).all()
            if service_value(service, "name")
        ]
    )


def get_branch_settings_payload(db: Session, branch_id: int) -> dict:
    global_payload = get_settings_payload(db)
    payload = {key: value for key, value in global_payload.items() if key in BRANCH_SCOPED_SETTING_KEYS}

    for row in _get_branch_override_rows(db, branch_id):
        payload[row.key] = _deserialize_value(row.value_type, row.value)

    payload["queueEnabled"] = bool(global_payload.get("queueEnabled")) and bool(payload.get("queueEnabled"))
    payload["maintenanceMode"] = bool(global_payload.get("maintenanceMode")) or bool(payload.get("maintenanceMode"))
    payload["paymentGatewayEnabled"] = bool(global_payload.get("paymentGatewayEnabled")) and bool(payload.get("paymentGatewayEnabled"))
    payload["receiptRequestEnabled"] = bool(global_payload.get("receiptRequestEnabled")) and bool(payload.get("receiptRequestEnabled"))

    global_services = set(global_payload.get("enabledServices") or [])
    branch_services = set(payload.get("enabledServices") or [])
    effective_services = sorted(global_services & branch_services) if branch_services else sorted(global_services)
    if not payload["queueEnabled"]:
        effective_services = []
    payload["enabledServices"] = effective_services

    payload["serviceOptions"] = _get_active_service_names(db)
    return payload


def get_branch_setting_value(db: Session, key: str, branch_id: int | None = None):
    if not branch_id or key not in BRANCH_SCOPED_SETTING_KEYS:
        return get_settings_payload(db).get(key, SETTINGS_METADATA[key]["default"])
    return get_branch_settings_payload(db, branch_id).get(key, SETTINGS_METADATA[key]["default"])


def update_branch_system_settings(
    db: Session,
    *,
    branch: Branch,
    payload: dict,
    changed_by: str,
) -> dict:
    normalized_payload = {key: value for key, value in payload.items() if key in BRANCH_SCOPED_SETTING_KEYS}
    if not normalized_payload:
        raise HTTPException(status_code=400, detail="No branch system settings were provided.")

    global_payload = get_settings_payload(db)
    active_service_names = set(_get_active_service_names(db))
    if normalized_payload.get("queueEnabled") is False:
        normalized_payload["enabledServices"] = []

    changed = False
    existing_rows = {row.key: row for row in _get_branch_override_rows(db, branch.id)}

    for key, raw_value in normalized_payload.items():
        metadata = SETTINGS_METADATA[key]
        normalized_value = _normalize_value(key, raw_value)

        if key == "enabledServices":
            normalized_value = [service for service in normalized_value if service in active_service_names]
            normalized_value = [service for service in normalized_value if service in set(global_payload.get("enabledServices") or [])]

        if key == "queueEnabled":
            normalized_value = bool(normalized_value)
        if key == "maintenanceMode":
            normalized_value = bool(normalized_value)
        if key == "paymentGatewayEnabled":
            normalized_value = bool(normalized_value)
        if key == "receiptRequestEnabled":
            normalized_value = bool(normalized_value)

        row = existing_rows.get(key)
        previous_value = _deserialize_value(row.value_type, row.value) if row else global_payload.get(key, SETTINGS_METADATA[key]["default"])

        if previous_value == normalized_value:
            continue

        serialized_value = _serialize_value(metadata["type"], normalized_value)
        if not row:
            row = BranchSystemSetting(
                branch_id=branch.id,
                key=key,
                label=metadata["label"],
                category=metadata["category"],
                value=serialized_value,
                value_json=serialized_value,
                value_type=metadata["type"],
                description=metadata["description"],
                updated_by=changed_by,
                updated_at=datetime.utcnow(),
            )
            db.add(row)
            existing_rows[key] = row
        else:
            row.label = metadata["label"]
            row.category = metadata["category"]
            row.value = serialized_value
            row.value_json = serialized_value
            row.value_type = metadata["type"]
            row.description = metadata["description"]
            row.updated_by = changed_by
            row.updated_at = datetime.utcnow()

        changed = True

    if not changed:
        # No changes detected, but return success anyway
        return {
            "branch_id": branch.id,
            "settings": get_branch_settings_payload(db, branch.id),
            "message": "No changes were needed - settings are already up to date.",
        }

    db.add(ActivityLog(
        action="Branch System Settings Updated",
        user=changed_by,
        details=f"Updated branch-only system settings for {branch.name}",
        type="branch_portal",
    ))
    db.commit()

    return {
        "branch_id": branch.id,
        "settings": get_branch_settings_payload(db, branch.id),
    }
