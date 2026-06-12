import json
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from database.models import ActivityLog, Policy, Service, SystemSetting, SystemSettingAudit
from utils.field_crypto import apply_system_setting_security, service_value, system_setting_value


SETTINGS_METADATA = {
    "queueEnabled": {
        "label": "Queue System Availability",
        "category": "Services",
        "type": "boolean",
        "description": "Controls whether the public can register for queue services.",
        "default": True,
    },
    "maxQueuePerBranch": {
        "label": "Maximum Queue Per Branch",
        "category": "Queue Operations",
        "type": "integer",
        "description": "Caps the number of active waiting and serving queue entries per branch.",
        "default": 100,
    },
    "maxQueuePerWindow": {
        "label": "Maximum Queue Per Window",
        "category": "Queue Operations",
        "type": "integer",
        "description": "Caps the number of active queue entries allowed for each service window before that window automatically closes to new queue registrations.",
        "default": 25,
    },
    "queueTimeSlot": {
        "label": "Queue Time Slot",
        "category": "Queue Operations",
        "type": "integer",
        "description": "Default queue timing in minutes used for branch wait estimates and fallback processing time.",
        "default": 15,
    },
    "enabledServices": {
        "label": "Enabled Public Services",
        "category": "Services",
        "type": "json",
        "description": "Service names available for public queueing and branch-facing service listings.",
        "default": [],
    },
    "paymentGatewayEnabled": {
        "label": "Online Payment Gateway Availability",
        "category": "Services",
        "type": "boolean",
        "description": "Controls whether online tax payments can be started from the public portal.",
        "default": True,
    },
    "receiptRequestEnabled": {
        "label": "Request Receipt Copy Availability",
        "category": "Services",
        "type": "boolean",
        "description": "Controls whether taxpayers can submit receipt copy requests through the public portal.",
        "default": True,
    },
    "maintenanceMode": {
        "label": "Maintenance Mode",
        "category": "Operational Defaults",
        "type": "boolean",
        "description": "Temporarily disables public-facing operational workflows while maintenance is ongoing.",
        "default": False,
    },
    "sessionTimeout": {
        "label": "Session Timeout",
        "category": "Authentication & Security",
        "type": "integer",
        "description": "Global session expiration window in minutes for authenticated portal sessions.",
        "default": 30,
    },
    "maxLoginAttempts": {
        "label": "Maximum Login Attempts",
        "category": "Authentication & Security",
        "type": "integer",
        "description": "Maximum failed login attempts before temporary account lockout is applied.",
        "default": 5,
    },
}

SYSTEM_CONFIGURATION_UPDATE_CATEGORY = "System Configuration Updates"
SYSTEM_DISABLED_MESSAGE = "This service is currently unavailable because it has been disabled by system administration."
BRANCH_QUEUE_DISABLED_MESSAGE = "Queue services are currently unavailable for this branch. Please try again later or contact the City Treasurer's Office."
PH_TIMEZONE = timezone(timedelta(hours=8))


def _serialize_value(value_type: str, value):
    if value_type == "boolean":
        return "true" if bool(value) else "false"
    if value_type == "integer":
        return str(int(value))
    if value_type == "json":
        return json.dumps(value)
    return str(value)


def _deserialize_value(value_type: str, raw_value: str):
    if value_type == "boolean":
        return (raw_value or "").strip().lower() == "true"
    if value_type == "integer":
        return int(raw_value)
    if value_type == "json":
        try:
            return json.loads(raw_value or "[]")
        except json.JSONDecodeError:
            return []
    return raw_value


def _to_iso_utc(value):
    if value is None:
        return None
    return f"{value.isoformat()}Z"


def _normalize_value(setting_key: str, value):
    metadata = SETTINGS_METADATA[setting_key]
    value_type = metadata["type"]

    if value_type == "boolean":
        return bool(value)
    if value_type == "integer":
        normalized = int(value)
        if normalized < 1 and setting_key != "sessionTimeout":
            raise HTTPException(status_code=400, detail=f"{metadata['label']} must be at least 1.")
        if setting_key == "sessionTimeout" and normalized < 5:
            raise HTTPException(status_code=400, detail="Session Timeout must be at least 5 minutes.")
        return normalized
    if value_type == "json":
        if not isinstance(value, list):
            raise HTTPException(status_code=400, detail=f"{metadata['label']} must be a list.")
        return sorted({str(item).strip() for item in value if str(item).strip()})
    return str(value).strip()


def seed_system_settings(db: Session):
    service_names = sorted(
        [
            service_value(service, "name")
            for service in db.query(Service).filter(Service.is_active.is_(True)).all()
            if service_value(service, "name")
        ]
    )

    for key, metadata in SETTINGS_METADATA.items():
        setting = db.query(SystemSetting).filter(SystemSetting.key == key).first()
        default_value = service_names if key == "enabledServices" else metadata["default"]

        if setting:
            setting.label = system_setting_value(setting, "label") or metadata["label"]
            setting.category = system_setting_value(setting, "category") or metadata["category"]
            setting.value_type = system_setting_value(setting, "value_type") or metadata["type"]
            setting.description = system_setting_value(setting, "description") or metadata["description"]
            if system_setting_value(setting, "value") is None:
                setting.value = _serialize_value(metadata["type"], default_value)
            if system_setting_value(setting, "value_json") is None:
                setting.value_json = _serialize_value(metadata["type"], default_value)
            if key == "enabledServices" and system_setting_value(setting, "value") is None:
                setting.value = _serialize_value(metadata["type"], default_value)
                setting.value_json = setting.value
            apply_system_setting_security(setting)
            continue

        new_setting = SystemSetting(
            key=key,
            label=metadata["label"],
            category=metadata["category"],
            value_json=_serialize_value(metadata["type"], default_value),
            value=_serialize_value(metadata["type"], default_value),
            value_type=metadata["type"],
            description=metadata["description"],
            updated_by="system",
        )
        apply_system_setting_security(new_setting)
        db.add(new_setting)

    db.commit()


def get_settings_payload(db: Session) -> dict:
    seed_system_settings(db)

    payload = {}
    settings = db.query(SystemSetting).filter(SystemSetting.key.in_(list(SETTINGS_METADATA.keys()))).all()
    for setting in settings:
        payload[setting.key] = _deserialize_value(
            system_setting_value(setting, "value_type") or setting.value_type,
            system_setting_value(setting, "value") or setting.value,
        )

    if "enabledServices" not in payload:
        payload["enabledServices"] = sorted(
            [
                service_value(service, "name")
                for service in db.query(Service).filter(Service.is_active.is_(True)).all()
                if service_value(service, "name")
            ]
        )

    return payload


def get_setting_value(db: Session, key: str):
    return get_settings_payload(db).get(key, SETTINGS_METADATA[key]["default"])


def format_setting_value(setting_key: str, value) -> str:
    if setting_key == "enabledServices":
        return ", ".join(value) if value else "None"
    if isinstance(value, bool):
        return "Enabled" if value else "Disabled"
    if setting_key == "queueTimeSlot":
        return f"{value} minute(s)"
    return str(value)


def get_operational_effects(change_entries: list[dict]) -> list[str]:
    effect_lines = []
    if any(entry["key"] in {"queueEnabled", "maxQueuePerBranch", "maxQueuePerWindow", "queueTimeSlot", "enabledServices"} for entry in change_entries):
        effect_lines.append("Queue registration and service availability now follow the updated system-wide queue controls.")
    if any(entry["key"] in {"paymentGatewayEnabled"} for entry in change_entries):
        effect_lines.append("Online payment access now follows the updated payment gateway availability setting.")
    if any(entry["key"] in {"receiptRequestEnabled"} for entry in change_entries):
        effect_lines.append("Receipt copy requests now follow the updated public request availability setting.")
    if any(entry["key"] in {"maintenanceMode"} for entry in change_entries):
        effect_lines.append("Public-facing workflows now follow the updated maintenance mode status.")
    if any(entry["key"] in {"sessionTimeout", "maxLoginAttempts"} for entry in change_entries):
        effect_lines.append("Authentication and session handling now use the updated security defaults for new sessions.")
    return effect_lines or ["Dependent workflows now use the latest approved system configuration values."]


def update_system_settings(db: Session, payload: dict, changed_by: str, reason: str | None = None):
    seed_system_settings(db)

    normalized_payload = dict(payload)
    if normalized_payload.get("queueEnabled") is False:
        normalized_payload["enabledServices"] = []

    updated_settings = {}
    change_entries = []

    for key in SETTINGS_METADATA:
        if key not in normalized_payload:
            continue

        setting = db.query(SystemSetting).filter(SystemSetting.key == key).first()
        metadata = SETTINGS_METADATA[key]
        previous_value = _deserialize_value(
            system_setting_value(setting, "value_type") or setting.value_type,
            system_setting_value(setting, "value") or setting.value,
        )
        normalized_value = _normalize_value(key, normalized_payload[key])

        if key == "enabledServices":
            active_service_names = {
                service_value(service, "name")
                for service in db.query(Service).filter(Service.is_active.is_(True)).all()
                if service_value(service, "name")
            }
            normalized_value = [service for service in normalized_value if service in active_service_names]

        if previous_value == normalized_value:
            updated_settings[key] = normalized_value
            continue

        setting.value = _serialize_value(metadata["type"], normalized_value)
        setting.value_json = setting.value
        setting.value_type = metadata["type"]
        setting.updated_by = changed_by
        setting.updated_at = datetime.utcnow()
        apply_system_setting_security(setting)
        updated_settings[key] = normalized_value

        audit_entry = SystemSettingAudit(
            setting_key=key,
            setting_label=metadata["label"],
            category=metadata["category"],
            previous_value=_serialize_value(metadata["type"], previous_value),
            new_value=_serialize_value(metadata["type"], normalized_value),
            changed_by=changed_by,
            reason=(reason or "").strip() or None,
        )
        db.add(audit_entry)
        change_entries.append({
            "key": key,
            "label": metadata["label"],
            "category": metadata["category"],
            "previous_value": previous_value,
            "new_value": normalized_value,
        })
    if not change_entries:
        raise HTTPException(
            status_code=400,
            detail="No configuration changes were detected. Update at least one setting before publishing the configuration.",
        )

    timestamp = datetime.now(PH_TIMEZONE)
    effect_lines = get_operational_effects(change_entries)
    formatted_change_lines = [
        f"- {entry['label']}: {format_setting_value(entry['key'], entry['previous_value'])} -> {format_setting_value(entry['key'], entry['new_value'])}"
        for entry in change_entries
    ]

    policy_content_lines = [
        "Official Notice: System Configuration Update",
        "",
        "The following system settings were updated by the Main Office:",
        *formatted_change_lines,
        "",
        "Implementation Details:",
        f"- Effective date: {timestamp.strftime('%B %d, %Y')}",
        f"- Effective time: {timestamp.strftime('%I:%M:%S %p')}",
        f"- Updated by: {changed_by}",
        f"- Reason: {(reason or '').strip() or 'No reason provided.'}",
        "",
        "Operational Effect:",
        *[f"- {line}" for line in effect_lines],
        "",
        "Branch Guidance:",
        "- Review the updated configuration before continuing branch operations that depend on queueing, services, payments, or access controls.",
    ]

    policy = Policy(
        title=f"System Configuration Update - {timestamp.strftime('%B %d, %Y %I:%M %p')}",
        category=SYSTEM_CONFIGURATION_UPDATE_CATEGORY,
        content="\n".join(policy_content_lines),
        author=changed_by,
    )
    db.add(policy)

    db.add(ActivityLog(
        action="Settings Updated",
        user=changed_by,
        details=" | ".join(
            [
                f"{entry['label']}: {format_setting_value(entry['key'], entry['previous_value'])} -> {format_setting_value(entry['key'], entry['new_value'])}"
                for entry in change_entries
            ]
        ) + (f" | Reason: {reason.strip()}" if (reason or "").strip() else ""),
        type="admin",
    ))

    db.commit()
    db.refresh(policy)

    return {
        "settings": get_settings_payload(db),
        "changes": change_entries,
        "notice": {
            "id": policy.id,
            "title": policy.title,
            "category": policy.category,
            "author": policy.author,
            "created_at": _to_iso_utc(policy.created_at),
            "updated_at": _to_iso_utc(policy.updated_at),
        },
    }

def get_settings_audit_history(
    db: Session,
    *,
    page: int = 1,
    page_size: int = 10,
    search: str | None = None,
    category: str | None = None,
) -> dict:
    seed_system_settings(db)
    query = db.query(SystemSettingAudit).filter(SystemSettingAudit.setting_key.in_(list(SETTINGS_METADATA.keys())))
    if search:
        search_term = f"%{search.strip()}%"
        query = query.filter(
            (SystemSettingAudit.setting_label.ilike(search_term)) |
            (SystemSettingAudit.changed_by.ilike(search_term)) |
            (SystemSettingAudit.reason.ilike(search_term))
        )
    if category:
        query = query.filter(SystemSettingAudit.category == category)

    total = query.count()
    entries = (
        query
        .order_by(SystemSettingAudit.changed_at.desc(), SystemSettingAudit.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    history = []
    for entry in entries:
        if entry.setting_key not in SETTINGS_METADATA:
            continue
        metadata = SETTINGS_METADATA.get(entry.setting_key, {})
        value_type = metadata.get("type", "string")
        previous_value = _deserialize_value(value_type, entry.previous_value) if entry.previous_value is not None else None
        new_value = _deserialize_value(value_type, entry.new_value)

        history.append({
            "id": entry.id,
            "setting_key": entry.setting_key,
            "setting_label": entry.setting_label,
            "category": entry.category,
            "previous_value": previous_value,
            "new_value": new_value,
            "previous_value_label": format_setting_value(entry.setting_key, previous_value) if previous_value is not None else "Not previously set",
            "new_value_label": format_setting_value(entry.setting_key, new_value),
            "changed_by": entry.changed_by,
            "reason": entry.reason,
            "changed_at": _to_iso_utc(entry.changed_at),
        })

    total_pages = max(1, (total + page_size - 1) // page_size) if total else 1
    return {
        "items": history,
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
        "categories": sorted({metadata["category"] for metadata in SETTINGS_METADATA.values()}),
    }


def delete_settings_audit_entry(db: Session, audit_id: int, deleted_by: str) -> dict:
    entry = db.query(SystemSettingAudit).filter(SystemSettingAudit.id == audit_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Audit history entry not found.")

    setting_label = entry.setting_label
    db.delete(entry)
    db.add(ActivityLog(
        action="Settings Audit Entry Deleted",
        user=deleted_by,
        details=f"Deleted configuration audit entry for {setting_label}",
        type="admin",
    ))
    db.commit()
    return {"deleted_id": audit_id, "setting_label": setting_label}
