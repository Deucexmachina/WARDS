from __future__ import annotations

import json
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from database.models import ActivityLog, Branch, BranchAppointmentScheduleAudit, BranchSystemSetting, Service
from utils.field_crypto import service_value
from utils.branch_window_config import get_branch_service_options
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


def cleanup_duplicate_branch_system_settings(db: Session) -> int:
    """Remove duplicate BranchSystemSetting rows, keeping only the newest per (branch_id, key).
    Returns the number of rows deleted."""
    from sqlalchemy import func

    subq = (
        db.query(
            func.max(BranchSystemSetting.id).label("max_id")
        )
        .group_by(BranchSystemSetting.branch_id, BranchSystemSetting.key)
        .subquery()
    )

    ids_to_keep = [r.max_id for r in db.query(subq.c.max_id).all()]
    if not ids_to_keep:
        return 0

    result = (
        db.query(BranchSystemSetting)
        .filter(~BranchSystemSetting.id.in_(ids_to_keep))
        .delete(synchronize_session=False)
    )
    db.commit()
    return result


def _get_branch_override_rows(db: Session, branch_id: int) -> list[BranchSystemSetting]:
    return (
        db.query(BranchSystemSetting)
        .filter(
            BranchSystemSetting.branch_id == branch_id,
            BranchSystemSetting.key.in_(list(BRANCH_SCOPED_SETTING_KEYS)),
        )
        .order_by(BranchSystemSetting.id.asc())
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


def _get_branch_service_names(db: Session, branch_id: int) -> list[str]:
    return sorted(
        {
            option["name"]
            for option in get_branch_service_options(db, branch_id)
            if option.get("name")
        }
    )


def get_branch_settings_payload(db: Session, branch_id: int) -> dict:
    global_payload = get_settings_payload(db)
    payload = {key: value for key, value in global_payload.items() if key in BRANCH_SCOPED_SETTING_KEYS}
    branch_service_names = _get_branch_service_names(db, branch_id)

    for row in _get_branch_override_rows(db, branch_id):
        payload[row.key] = _deserialize_value(row.value_type, row.value)

    payload["queueEnabled"] = bool(global_payload.get("queueEnabled")) and bool(payload.get("queueEnabled"))
    payload["maintenanceMode"] = bool(global_payload.get("maintenanceMode")) or bool(payload.get("maintenanceMode"))
    payload["paymentGatewayEnabled"] = bool(global_payload.get("paymentGatewayEnabled")) and bool(payload.get("paymentGatewayEnabled"))
    payload["receiptRequestEnabled"] = bool(global_payload.get("receiptRequestEnabled")) and bool(payload.get("receiptRequestEnabled"))

    if not payload["queueEnabled"]:
        payload["enabledServices"] = []
    elif "enabledServices" not in payload:
        payload["enabledServices"] = branch_service_names

    payload["serviceOptions"] = branch_service_names
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
    changed_by_full_name: str | None = None,
    changed_by_role: str = "branch_admin",
    reason: str | None = None,
) -> dict:
    normalized_payload = {key: value for key, value in payload.items() if key in BRANCH_SCOPED_SETTING_KEYS}
    if not normalized_payload:
        raise HTTPException(status_code=400, detail="No branch system settings were provided.")

    previous_settings_snapshot = get_branch_settings_payload(db, branch.id)
    global_payload = get_settings_payload(db)
    if "queueEnabled" in normalized_payload and not bool(normalized_payload["queueEnabled"]):
        normalized_payload["enabledServices"] = []

    changed = False
    change_lines: list[str] = []
    structured_changes: list[dict] = []
    existing_rows = {row.key: row for row in _get_branch_override_rows(db, branch.id)}

    # When re-enabling queue, remove a stale enabledServices=[] override
    # so it falls back to the branch's available services.
    if "queueEnabled" in normalized_payload and bool(normalized_payload["queueEnabled"]):
        es_row = existing_rows.get("enabledServices")
        if es_row and _deserialize_value(es_row.value_type, es_row.value) == []:
            db.delete(es_row)
            del existing_rows["enabledServices"]
            changed = True
            change_lines.append(
                f"{SETTINGS_METADATA['enabledServices']['label']}: Disabled -> Branch Default"
            )
            structured_changes.append({
                "key": "enabledServices",
                "label": SETTINGS_METADATA["enabledServices"]["label"],
                "category": SETTINGS_METADATA["enabledServices"]["category"],
                "previous_value": [],
                "updated_value": _get_branch_service_names(db, branch.id),
                "previous_value_label": "Disabled",
                "updated_value_label": "Branch Default",
            })
        # If the payload also sends an empty enabledServices, drop it so the
        # loop below doesn't recreate the stale empty override.
        if "enabledServices" in normalized_payload and not normalized_payload["enabledServices"]:
            del normalized_payload["enabledServices"]

    def _format_audit_value(value):
        if isinstance(value, bool):
          return "Enabled" if value else "Disabled"
        if isinstance(value, (list, tuple, set)):
            return json.dumps(list(value), ensure_ascii=False)
        if value is None:
            return "None"
        return str(value)

    for key, raw_value in list(normalized_payload.items()):
        metadata = SETTINGS_METADATA[key]
        normalized_value = _normalize_value(key, raw_value)

        if key == "queueEnabled":
            normalized_value = bool(normalized_value)
        if key == "maintenanceMode":
            normalized_value = bool(normalized_value)
        if key == "paymentGatewayEnabled":
            normalized_value = bool(normalized_value)
        if key == "receiptRequestEnabled":
            normalized_value = bool(normalized_value)

        row = existing_rows.get(key)

        # Deduplicate FIRST so previous_value is read from the newest row.
        if row:
            all_rows_for_key = (
                db.query(BranchSystemSetting)
                .filter(
                    BranchSystemSetting.branch_id == branch.id,
                    BranchSystemSetting.key == key,
                )
                .order_by(BranchSystemSetting.id.asc())
                .all()
            )
            if len(all_rows_for_key) > 1:
                for stale_row in all_rows_for_key[:-1]:
                    db.delete(stale_row)
                row = all_rows_for_key[-1]
                existing_rows[key] = row
                changed = True

        previous_value = _deserialize_value(row.value_type, row.value) if row else global_payload.get(key, SETTINGS_METADATA[key]["default"])

        if previous_value == normalized_value:
            continue

        change_lines.append(
            f"{metadata['label']}: {_format_audit_value(previous_value)} -> {_format_audit_value(normalized_value)}"
        )
        structured_changes.append({
            "key": key,
            "label": metadata["label"],
            "category": metadata["category"],
            "previous_value": previous_value,
            "updated_value": normalized_value,
            "previous_value_label": _format_audit_value(previous_value),
            "updated_value_label": _format_audit_value(normalized_value),
        })

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

    change_details = "; ".join(change_lines) if change_lines else "No field-level changes were recorded."
    db.add(ActivityLog(
        action="Branch System Settings Updated",
        user=changed_by,
        details=f"branch: {branch.name} | role: branch_admin | changes: {change_details}",
        type="branch_portal",
    ))
    updated_settings_snapshot = get_branch_settings_payload(db, branch.id)
    previous_audit_snapshot = {
        "audit_type": "system_settings",
        "branch_name": branch.name,
        "changed_by_username": changed_by,
        "changed_by_full_name": (changed_by_full_name or "").strip() or None,
        "user_role": changed_by_role,
        "settings": previous_settings_snapshot,
        "setting_changes": structured_changes,
    }
    new_audit_snapshot = {
        "audit_type": "system_settings",
        "branch_name": branch.name,
        "changed_by_username": changed_by,
        "changed_by_full_name": (changed_by_full_name or "").strip() or None,
        "user_role": changed_by_role,
        "settings": updated_settings_snapshot,
        "setting_changes": structured_changes,
    }
    db.add(BranchAppointmentScheduleAudit(
        branch_id=branch.id,
        action="system_settings_updated",
        change_summary="\n".join(change_lines),
        previous_config=json.dumps(previous_audit_snapshot, sort_keys=True),
        new_config=json.dumps(new_audit_snapshot, sort_keys=True),
        effective_date=datetime.utcnow().date().isoformat(),
        changed_by=changed_by,
        reason=(reason or "").strip() or None,
    ))
    db.commit()

    return {
        "branch_id": branch.id,
        "settings": updated_settings_snapshot,
    }
