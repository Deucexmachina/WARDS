import json
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from database.models import (
    ActivityLog,
    Branch,
    BranchAppointmentSchedule,
    BranchAppointmentScheduleAudit,
    BranchStaff,
    BranchOperatingHours,
    Policy,
    Queue,
)
from utils.branch_window_config import (
    get_branch_window_metadata,
    get_service_window_display_label,
    infer_service_window,
)
from utils.field_crypto import get_decrypted_or_raw, hash_aware_any, hash_aware_match, queue_value
from utils.branch_system_settings import get_branch_setting_value
from utils.system_settings import get_setting_value


PH_TIMEZONE = timezone(timedelta(hours=8))
WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
OVERRIDE_STATUSES = {"available", "unavailable", "holiday", "special_operations"}
APPOINTMENT_POLICY_CATEGORY = "Branch Appointment Schedule Updates"
NO_VISIBLE_CHANGES_MESSAGE = "No visible scheduling changes were detected."
ACTIVE_WINDOW_QUEUE_STATUSES = ("Pending", "Waiting", "Called", "Serving")
DEFAULT_APPOINTMENT_SLOT_INTERVAL = 30


def _current_ph_date() -> date:
    return datetime.now(PH_TIMEZONE).date()


def _current_ph_naive_datetime() -> datetime:
    return datetime.now(PH_TIMEZONE).replace(tzinfo=None)


def _format_time_label(value: str) -> str:
    parsed = datetime.strptime(value, "%H:%M")
    return parsed.strftime("%I:%M %p").lstrip("0")


def _format_time_window(opening_time: str, closing_time: str) -> str:
    return f"{_format_time_label(opening_time)}-{_format_time_label(closing_time)}"


def _get_effective_time_settings_for_date(time_settings: dict, selected_date: date) -> dict:
    return dict(time_settings or {})


def _append_reason(reasons: list[dict], code: str, label: str, detail: str):
    reasons.append({
        "code": code,
        "label": label,
        "detail": detail,
    })


def _build_unavailable_message(service_name: str, reasons: list[dict], next_step: str) -> str:
    if not reasons:
        return f"{service_name} are currently unavailable. {next_step}"

    if len(reasons) == 1:
        return f"{service_name} are unavailable because {reasons[0]['detail']}. {next_step}"

    lines = [f"{service_name} are currently unavailable due to branch schedule settings:"]
    lines.extend([f"- {reason['label']}" for reason in reasons[:3]])
    lines.append(next_step)
    return "\n".join(lines)


def normalize_service_window(service_type: Optional[str]) -> str:
    return infer_service_window(service_type)


def normalize_service_window_for_branch(db: Session, branch_id: int, service_type: Optional[str]) -> str:
    return get_branch_window_metadata(db, branch_id, service_type)["service_window"]


def get_service_window_label(service_window: str) -> str:
    return get_service_window_display_label(service_window)


def get_window_capacity_limit(db: Session, branch_id: int | None = None) -> int:
    if branch_id is not None:
        return get_branch_setting_value(db, "maxQueuePerWindow", branch_id)
    return get_setting_value(db, "maxQueuePerWindow")


def get_transaction_duration_minutes(db: Session, branch_id: int | None = None) -> int:
    if branch_id is not None:
        return get_branch_setting_value(db, "queueTimeSlot", branch_id)
    return get_setting_value(db, "queueTimeSlot")


def normalize_appointment_service_key(service_type: Optional[str]) -> str:
    return " ".join((service_type or "").strip().casefold().split())


def build_appointment_reservation_key(
    branch_id: int,
    appointment_time: datetime,
    service_type: Optional[str] = None,
) -> str:
    return f"{branch_id}|{appointment_time.strftime('%Y-%m-%dT%H:%M')}|{normalize_appointment_service_key(service_type)}"


def get_window_active_queue_count(db: Session, *, branch_id: int, service_window: str) -> int:
    candidate_queues = (
        db.query(Queue)
        .filter(
            Queue.branch_id == branch_id,
            hash_aware_any(Queue, "status", ACTIVE_WINDOW_QUEUE_STATUSES),
        )
        .all()
    )
    return sum(
        1
        for queue in candidate_queues
        if normalize_service_window_for_branch(db, branch_id, queue_value(queue, "service_type")) == service_window
    )


def get_window_capacity_snapshot(
    db: Session,
    *,
    branch_id: int,
    service_type: Optional[str],
) -> Optional[dict]:
    if not service_type:
        return None

    service_window = normalize_service_window_for_branch(db, branch_id, service_type)
    current_count = get_window_active_queue_count(db, branch_id=branch_id, service_window=service_window)
    max_capacity = get_window_capacity_limit(db, branch_id)
    remaining_capacity = max(0, max_capacity - current_count)
    return {
        "service_window": service_window,
        "window_label": get_service_window_label(service_window),
        "current_count": current_count,
        "max_capacity": max_capacity,
        "remaining_capacity": remaining_capacity,
        "is_full": current_count >= max_capacity,
    }


def _serialize_config(config: dict) -> str:
    return json.dumps(config, sort_keys=True)


def _deserialize_config(raw_value: Optional[str]) -> dict:
    if not raw_value:
        return default_branch_schedule_config()
    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError:
        return default_branch_schedule_config()
    return normalize_schedule_config(parsed)


def _deserialize_audit_payload(action: str, raw_value: Optional[str]) -> dict:
    if action == "system_settings_updated":
        if not raw_value:
            return {}
        try:
            parsed = json.loads(raw_value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return _deserialize_config(raw_value)


def default_branch_schedule_config() -> dict:
    weekly_schedule = []
    for day_name in WEEKDAY_NAMES:
        weekly_schedule.append({
            "day": day_name,
            "is_available": day_name != "Sunday",
        })

    return {
        "effective_date": _current_ph_date().isoformat(),
        "weekly_schedule": weekly_schedule,
        "date_overrides": [],
        "time_settings": {
            "opening_time": "08:00",
            "closing_time": "17:00",
            "break_start": "",
            "break_end": "",
            "last_appointment_time": "17:00",
            "slot_interval_minutes": DEFAULT_APPOINTMENT_SLOT_INTERVAL,
        },
    }


def normalize_schedule_config(config: dict) -> dict:
    defaults = default_branch_schedule_config()
    weekly_lookup = {entry["day"]: bool(entry.get("is_available")) for entry in config.get("weekly_schedule", []) if entry.get("day") in WEEKDAY_NAMES}
    normalized_weekly = [
        {
            "day": day_name,
            "is_available": weekly_lookup.get(day_name, next(item["is_available"] for item in defaults["weekly_schedule"] if item["day"] == day_name)),
        }
        for day_name in WEEKDAY_NAMES
    ]

    normalized_overrides = []
    seen_dates = set()
    for override in config.get("date_overrides", []):
        override_date = (override.get("date") or "").strip()
        status = (override.get("status") or "").strip().lower()
        if not override_date or override_date in seen_dates or status not in OVERRIDE_STATUSES:
            continue
        normalized_overrides.append({
            "date": override_date,
            "status": status,
            "label": (override.get("label") or "").strip(),
            "notes": (override.get("notes") or "").strip(),
        })
        seen_dates.add(override_date)
    normalized_overrides.sort(key=lambda item: item["date"])

    time_settings = config.get("time_settings", {})
    normalized_time_settings = {
        "opening_time": (time_settings.get("opening_time") or defaults["time_settings"]["opening_time"]).strip(),
        "closing_time": (time_settings.get("closing_time") or defaults["time_settings"]["closing_time"]).strip(),
        "break_start": (time_settings.get("break_start") or "").strip(),
        "break_end": (time_settings.get("break_end") or "").strip(),
        "last_appointment_time": (time_settings.get("last_appointment_time") or defaults["time_settings"]["last_appointment_time"]).strip(),
        "slot_interval_minutes": DEFAULT_APPOINTMENT_SLOT_INTERVAL,
    }

    effective_date = (config.get("effective_date") or defaults["effective_date"]).strip()

    return {
        "effective_date": effective_date,
        "weekly_schedule": normalized_weekly,
        "date_overrides": normalized_overrides,
        "time_settings": normalized_time_settings,
    }


def validate_schedule_config(config: dict) -> dict:
    normalized = normalize_schedule_config(config)
    today = _current_ph_date()

    try:
        effective_date = date.fromisoformat(normalized["effective_date"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Effective date must be a valid date.") from exc

    if effective_date < today:
        raise HTTPException(status_code=400, detail="Effective date must be from the current date onward.")

    try:
        opening_time = datetime.strptime(normalized["time_settings"]["opening_time"], "%H:%M").time()
        closing_time = datetime.strptime(normalized["time_settings"]["closing_time"], "%H:%M").time()
        last_appointment_time = datetime.strptime(normalized["time_settings"]["last_appointment_time"], "%H:%M").time()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Opening, closing, and last appointment times must be valid.") from exc

    if opening_time >= closing_time:
        raise HTTPException(status_code=400, detail="Closing time must be later than opening time.")
    if last_appointment_time < opening_time or last_appointment_time > closing_time:
        raise HTTPException(status_code=400, detail="Last appointment cutoff must stay within operating hours.")

    break_start_raw = normalized["time_settings"]["break_start"]
    break_end_raw = normalized["time_settings"]["break_end"]
    if bool(break_start_raw) != bool(break_end_raw):
        raise HTTPException(status_code=400, detail="Lunch break must include both start and end times.")

    if break_start_raw and break_end_raw:
        try:
            break_start = datetime.strptime(break_start_raw, "%H:%M").time()
            break_end = datetime.strptime(break_end_raw, "%H:%M").time()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Lunch break times must be valid.") from exc
        if break_start >= break_end:
            raise HTTPException(status_code=400, detail="Lunch break end time must be later than the start time.")
        if break_start < opening_time or break_end > closing_time:
            raise HTTPException(status_code=400, detail="Lunch break must stay within the branch operating hours.")
    else:
        break_start = None
        break_end = None

    normalized["time_settings"]["slot_interval_minutes"] = DEFAULT_APPOINTMENT_SLOT_INTERVAL

    seen_dates = set()
    for override in normalized["date_overrides"]:
        try:
            override_date = date.fromisoformat(override["date"])
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Override date {override['date']} is invalid.") from exc
        if override_date < today:
            raise HTTPException(status_code=400, detail="Date overrides must be from the current date onward.")
        if override["date"] in seen_dates:
            raise HTTPException(status_code=400, detail=f"Duplicate override date found for {override['date']}.")
        seen_dates.add(override["date"])

    return normalized


def get_or_create_branch_schedule(db: Session, branch_id: int) -> BranchAppointmentSchedule:
    schedule = db.query(BranchAppointmentSchedule).filter(BranchAppointmentSchedule.branch_id == branch_id).first()
    if schedule:
        if not schedule.draft_config:
            schedule.draft_config = _serialize_config(default_branch_schedule_config())
        if not schedule.published_config:
            schedule.published_config = schedule.draft_config
        if not schedule.effective_date:
            schedule.effective_date = _current_ph_date().isoformat()
        return schedule

    default_config = default_branch_schedule_config()
    schedule = BranchAppointmentSchedule(
        branch_id=branch_id,
        draft_config=_serialize_config(default_config),
        published_config=_serialize_config(default_config),
        effective_date=default_config["effective_date"],
    )
    db.add(schedule)
    db.commit()
    db.refresh(schedule)
    return schedule


def _build_change_summary(previous_config: dict, new_config: dict) -> list[str]:
    summary_lines = []
    previous_weekly = {entry["day"]: bool(entry.get("is_available")) for entry in previous_config.get("weekly_schedule", [])}
    new_weekly = {entry["day"]: bool(entry.get("is_available")) for entry in new_config.get("weekly_schedule", [])}

    for day_name in WEEKDAY_NAMES:
        if previous_weekly.get(day_name) != new_weekly.get(day_name):
            summary_lines.append(
                f"{day_name}: {'Available' if previous_weekly.get(day_name) else 'Closed'} -> {'Available' if new_weekly.get(day_name) else 'Closed'}"
            )

    previous_time = previous_config.get("time_settings", {})
    new_time = new_config.get("time_settings", {})
    time_fields = {
        "opening_time": "Opening Time",
        "closing_time": "Closing Time",
        "break_start": "Lunch Break Start",
        "break_end": "Lunch Break End",
        "last_appointment_time": "Last Appointment Cutoff",
        "slot_interval_minutes": "Slot Interval",
    }
    for field_name, label in time_fields.items():
        if previous_time.get(field_name) != new_time.get(field_name):
            previous_value = previous_time.get(field_name) or "None"
            new_value = new_time.get(field_name) or "None"
            if field_name.endswith("_time") or field_name.startswith("break_"):
                previous_value = _format_time_label(previous_value) if previous_value not in {"None", ""} else "None"
                new_value = _format_time_label(new_value) if new_value not in {"None", ""} else "None"
            if field_name == "slot_interval_minutes":
                previous_value = f"{previous_value} minute(s)"
                new_value = f"{new_value} minute(s)"
            summary_lines.append(f"{label}: {previous_value} -> {new_value}")

    previous_overrides = {entry["date"]: entry for entry in previous_config.get("date_overrides", [])}
    new_overrides = {entry["date"]: entry for entry in new_config.get("date_overrides", [])}
    all_override_dates = sorted(set(previous_overrides.keys()) | set(new_overrides.keys()))
    for override_date in all_override_dates:
        previous_entry = previous_overrides.get(override_date)
        new_entry = new_overrides.get(override_date)
        if previous_entry == new_entry:
            continue
        previous_label = previous_entry["status"].replace("_", " ").title() if previous_entry else "Not Set"
        new_label = new_entry["status"].replace("_", " ").title() if new_entry else "Removed"
        summary_lines.append(f"Date Override {override_date}: {previous_label} -> {new_label}")

    if previous_config.get("effective_date") != new_config.get("effective_date"):
        summary_lines.append(f"Effective Date: {previous_config.get('effective_date')} -> {new_config.get('effective_date')}")

    return summary_lines or [NO_VISIBLE_CHANGES_MESSAGE]


def _serialize_audit_entry(entry: BranchAppointmentScheduleAudit) -> dict:
    previous_payload = _deserialize_audit_payload(entry.action, entry.previous_config)
    new_payload = _deserialize_audit_payload(entry.action, entry.new_config)
    audit_type = "system_settings" if entry.action == "system_settings_updated" else "appointment_schedule"
    previous_config = previous_payload.get("settings", {}) if audit_type == "system_settings" else previous_payload
    new_config = new_payload.get("settings", {}) if audit_type == "system_settings" else new_payload
    return {
        "id": entry.id,
        "branch_id": entry.branch_id,
        "audit_type": audit_type,
        "action": entry.action,
        "change_summary": [line for line in (entry.change_summary or "").split("\n") if line.strip()],
        "previous_config": previous_config,
        "new_config": new_config,
        "effective_date": entry.effective_date,
        "changed_by": entry.changed_by,
        "branch_name": new_payload.get("branch_name") or previous_payload.get("branch_name"),
        "changed_by_username": new_payload.get("changed_by_username") or previous_payload.get("changed_by_username") or entry.changed_by,
        "changed_by_full_name": new_payload.get("changed_by_full_name") or previous_payload.get("changed_by_full_name"),
        "user_role": new_payload.get("user_role") or previous_payload.get("user_role"),
        "setting_changes": new_payload.get("setting_changes") or previous_payload.get("setting_changes") or [],
        "reason": entry.reason,
        "changed_at": f"{entry.changed_at.isoformat()}Z" if entry.changed_at else None,
    }


def get_branch_schedule_payload(db: Session, branch_id: int) -> dict:
    schedule = get_or_create_branch_schedule(db, branch_id)
    return {
        "branch_id": branch_id,
        "draft": _deserialize_config(schedule.draft_config),
        "published": _deserialize_config(schedule.published_config),
        "effective_date": schedule.effective_date,
        "updated_by": schedule.updated_by,
        "published_by": schedule.published_by,
        "updated_at": f"{schedule.updated_at.isoformat()}Z" if schedule.updated_at else None,
        "published_at": f"{schedule.published_at.isoformat()}Z" if schedule.published_at else None,
    }


def get_branch_schedule_history(db: Session, branch_id: int, *, page: int = 1, page_size: int = 5) -> dict:
    query = db.query(BranchAppointmentScheduleAudit).filter(BranchAppointmentScheduleAudit.branch_id == branch_id)
    total = query.count()
    entries = (
        query
        .order_by(BranchAppointmentScheduleAudit.changed_at.desc(), BranchAppointmentScheduleAudit.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    total_pages = max(1, (total + page_size - 1) // page_size) if total else 1
    return {
        "items": [_serialize_audit_entry(entry) for entry in entries],
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
    }


def delete_branch_schedule_history_entry(
    db: Session,
    *,
    branch_id: int,
    audit_id: int,
    deleted_by: str,
) -> dict:
    entry = (
        db.query(BranchAppointmentScheduleAudit)
        .filter(
            BranchAppointmentScheduleAudit.id == audit_id,
            BranchAppointmentScheduleAudit.branch_id == branch_id,
        )
        .first()
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Appointment schedule audit history entry not found.")

    db.delete(entry)
    db.add(ActivityLog(
        action="Branch Appointment Schedule Audit Entry Deleted",
        user=deleted_by,
        details=f"Deleted appointment schedule audit entry {audit_id} for branch {branch_id}",
        type="branch_portal",
    ))
    db.commit()
    return {"deleted_id": audit_id}


def save_branch_schedule_draft(
    db: Session,
    *,
    branch: Branch,
    config: dict,
    changed_by: str,
    reason: Optional[str] = None,
) -> dict:
    validated_config = validate_schedule_config(config)
    schedule = get_or_create_branch_schedule(db, branch.id)
    previous_config = _deserialize_config(schedule.draft_config)
    schedule.draft_config = _serialize_config(validated_config)
    schedule.effective_date = validated_config["effective_date"]
    schedule.updated_by = changed_by
    schedule.updated_at = datetime.utcnow()

    change_summary = _build_change_summary(previous_config, validated_config)
    db.add(BranchAppointmentScheduleAudit(
        branch_id=branch.id,
        action="saved",
        change_summary="\n".join(change_summary),
        previous_config=_serialize_config(previous_config),
        new_config=schedule.draft_config,
        effective_date=validated_config["effective_date"],
        changed_by=changed_by,
        reason=(reason or "").strip() or None,
    ))
    db.add(ActivityLog(
        action="Branch Appointment Schedule Saved",
        user=changed_by,
        details=f"Saved appointment schedule draft for {branch.name}",
        type="branch_portal",
    ))
    db.commit()
    db.refresh(schedule)
    return {
        "schedule": get_branch_schedule_payload(db, branch.id),
        "change_summary": change_summary,
    }


def sync_branch_operating_hours(db: Session, branch_id: int, published_config: dict):
    weekly_lookup = {entry["day"]: bool(entry["is_available"]) for entry in published_config.get("weekly_schedule", [])}
    time_settings = published_config.get("time_settings", {})
    opening_time = time_settings.get("opening_time", "08:00")
    closing_time = time_settings.get("closing_time", "17:00")

    existing_rows = {
        row.day_of_week: row
        for row in db.query(BranchOperatingHours).filter(BranchOperatingHours.branch_id == branch_id).all()
    }

    for day_name in WEEKDAY_NAMES:
        row = existing_rows.get(day_name)
        if not row:
            row = BranchOperatingHours(branch_id=branch_id, day_of_week=day_name)
            db.add(row)
        row.opening_time = opening_time
        row.closing_time = closing_time
        row.is_open = weekly_lookup.get(day_name, False)


def publish_branch_schedule(
    db: Session,
    *,
    branch: Branch,
    changed_by: str,
    config: Optional[dict] = None,
    reason: Optional[str] = None,
) -> dict:
    schedule = get_or_create_branch_schedule(db, branch.id)
    draft_config = validate_schedule_config(config or _deserialize_config(schedule.draft_config))
    previous_published = _deserialize_config(schedule.published_config)

    schedule.draft_config = _serialize_config(draft_config)
    schedule.published_config = _serialize_config(draft_config)
    schedule.effective_date = draft_config["effective_date"]
    schedule.published_by = changed_by
    schedule.published_at = datetime.utcnow()
    schedule.updated_by = changed_by
    schedule.updated_at = datetime.utcnow()

    change_summary = _build_change_summary(previous_published, draft_config)
    if change_summary == [NO_VISIBLE_CHANGES_MESSAGE]:
        raise HTTPException(
            status_code=400,
            detail="No configuration changes were detected. Update the branch schedule before publishing the configuration.",
        )
    db.add(BranchAppointmentScheduleAudit(
        branch_id=branch.id,
        action="published",
        change_summary="\n".join(change_summary),
        previous_config=_serialize_config(previous_published),
        new_config=schedule.published_config,
        effective_date=draft_config["effective_date"],
        changed_by=changed_by,
        reason=(reason or "").strip() or None,
    ))

    sync_branch_operating_hours(db, branch.id, draft_config)

    weekly_summary = ", ".join(
        entry["day"] for entry in draft_config["weekly_schedule"] if entry["is_available"]
    ) or "No available weekdays"
    time_settings = draft_config["time_settings"]
    appointment_window = (
        f"{_format_time_label(time_settings['opening_time'])} to {_format_time_label(time_settings['closing_time'])}"
    )
    cutoff_label = _format_time_label(time_settings["last_appointment_time"])

    branch_display_name = get_decrypted_or_raw(branch, "name") or branch.name

    notice_lines = [
        "Branch Appointment Schedule Update",
        "",
        f"Branch: {branch_display_name}",
        f"Effective date: {draft_config['effective_date']}",
        f"Updated by: {changed_by}",
        f"Reason: {(reason or '').strip() or 'No reason provided.'}",
        "",
        "Updated Appointment Availability:",
        f"- Weekly availability: {weekly_summary}",
        f"- Appointment window: {appointment_window}",
        f"- Last appointment cutoff: {cutoff_label}",
    ]

    if time_settings.get("break_start") and time_settings.get("break_end"):
        notice_lines.append(
            f"- Lunch break: {_format_time_label(time_settings['break_start'])} to {_format_time_label(time_settings['break_end'])}"
        )

    if draft_config["date_overrides"]:
        notice_lines.append("- Date overrides:")
        for override in draft_config["date_overrides"]:
            label = override["status"].replace("_", " ").title()
            extra = f" ({override['label']})" if override.get("label") else ""
            notice_lines.append(f"  - {override['date']}: {label}{extra}")

    notice_lines.extend([
        "",
        "What changed:",
        *[f"- {line}" for line in change_summary],
        "",
        "Branch Guidance:",
        "- Citizens can only book appointment queue slots that follow this published branch schedule.",
        "- Review the queueing module and inform branch personnel of any operating-hour or closure updates.",
    ])

    policy = Policy(
        title=f"{branch_display_name} Appointment Schedule Update - {draft_config['effective_date']}",
        category=APPOINTMENT_POLICY_CATEGORY,
        content="\n".join(notice_lines),
        author=changed_by,
    )
    db.add(policy)
    db.add(ActivityLog(
        action="Branch Appointment Schedule Published",
        user=changed_by,
        details=f"Published appointment schedule for {branch_display_name}",
        type="branch_portal",
    ))
    db.commit()
    db.refresh(schedule)
    db.refresh(policy)

    return {
        "schedule": get_branch_schedule_payload(db, branch.id),
        "change_summary": change_summary,
        "notice": {
            "id": policy.id,
            "title": policy.title,
            "category": policy.category,
            "author": policy.author,
            "created_at": f"{policy.created_at.isoformat()}Z" if policy.created_at else None,
        },
    }


def get_published_branch_schedule(db: Session, branch_id: int) -> dict:
    schedule = get_or_create_branch_schedule(db, branch_id)
    published_config = _deserialize_config(schedule.published_config)

    # Published schedules must remain usable after their effective date passes.
    # Re-validating them with draft-save rules would incorrectly reject any
    # active schedule whose start date is already in the past.
    return normalize_schedule_config(published_config)


def _get_schedule_day_status(
    published_config: dict,
    selected_date: date,
) -> tuple[bool, str, str]:
    try:
        effective_date = date.fromisoformat(published_config["effective_date"])
    except ValueError:
        effective_date = _current_ph_date()

    if selected_date < _current_ph_date():
        return False, "past_date", "The selected appointment date has already passed. Please choose a current or future date."

    if selected_date < effective_date:
        return False, "before_effective_date", f"This branch schedule will take effect on {effective_date.isoformat()}. Please choose that date or a later available date."

    weekday_name = WEEKDAY_NAMES[selected_date.weekday()]
    weekly_lookup = {entry["day"]: bool(entry["is_available"]) for entry in published_config["weekly_schedule"]}
    is_available = weekly_lookup.get(weekday_name, False)
    status = "available" if is_available else "weekly_closure"
    message = ""

    override = next((item for item in published_config["date_overrides"] if item["date"] == selected_date.isoformat()), None)
    if override:
        override_status = override["status"]
        if override_status in {"unavailable", "holiday"}:
            is_available = False
            status = override_status
            if override_status == "holiday":
                override_label = override.get("label") or "holiday"
                message = f"This branch is closed on {selected_date.isoformat()} for {override_label}. Please choose another available date."
            else:
                override_label = override.get("label") or "a branch closure"
                message = f"Appointments are unavailable on {selected_date.isoformat()} due to {override_label}. Please choose another available date."
        elif override_status in {"available", "special_operations"}:
            is_available = True
            status = override_status
            if override_status == "special_operations":
                override_label = override.get("label") or "special branch operations"
                message = f"Appointments are available on {selected_date.isoformat()} for {override_label}. Please select from the available time slots."

    if not is_available and not message and status == "weekly_closure":
        message = f"This branch does not accept appointments on {weekday_name}s. Please choose another available date."

    return is_available, status, message


def get_branch_immediate_queue_availability(db: Session, *, branch: Branch, service_type: Optional[str] = None) -> dict:
    if not bool(get_branch_setting_value(db, "queueEnabled", branch.id)):
        reasons = []
        _append_reason(
            reasons,
            "queue_disabled",
            "Queueing is disabled by system administration",
            "queueing has been disabled by system administration",
        )
        return {
            "is_available": False,
            "message": _build_unavailable_message(
                "Immediate queueing",
                reasons,
                "Please try again after queueing is re-enabled.",
            ),
            "status": "queue_disabled",
            "reasons": reasons,
            "window_capacity": get_window_capacity_snapshot(db, branch_id=branch.id, service_type=service_type),
        }

    published_config = get_published_branch_schedule(db, branch.id)
    today = _current_ph_date()
    is_available, status, message = _get_schedule_day_status(published_config, today)
    time_settings = _get_effective_time_settings_for_date(published_config["time_settings"], today)
    now_ph = datetime.now(PH_TIMEZONE)
    current_time = now_ph.time()
    opening_time = datetime.strptime(time_settings["opening_time"], "%H:%M").time()
    closing_time = datetime.strptime(time_settings["closing_time"], "%H:%M").time()
    break_start = datetime.strptime(time_settings["break_start"], "%H:%M").time() if time_settings.get("break_start") else None
    break_end = datetime.strptime(time_settings["break_end"], "%H:%M").time() if time_settings.get("break_end") else None
    operating_window = _format_time_window(time_settings["opening_time"], time_settings["closing_time"])
    reasons = []

    if not is_available:
        if status == "weekly_closure":
            weekday_name = WEEKDAY_NAMES[today.weekday()]
            _append_reason(
                reasons,
                "weekly_closure",
                f"Closed today ({weekday_name})",
                f"this branch is closed on {weekday_name}s",
            )
        elif status == "holiday":
            override = next((item for item in published_config["date_overrides"] if item["date"] == today.isoformat()), None)
            holiday_name = override.get("label") if override else None
            _append_reason(
                reasons,
                "holiday",
                f"Holiday closure{f' ({holiday_name})' if holiday_name else ''}",
                f"the branch is closed today for {holiday_name or 'a holiday'}",
            )
        elif status == "unavailable":
            override = next((item for item in published_config["date_overrides"] if item["date"] == today.isoformat()), None)
            override_label = override.get("label") if override else None
            _append_reason(
                reasons,
                "date_unavailable",
                f"Closed today{f' ({override_label})' if override_label else ''}",
                f"today is marked unavailable in the branch schedule{f' for {override_label}' if override_label else ''}",
            )
        elif status == "before_effective_date":
            effective_date = published_config.get("effective_date")
            _append_reason(
                reasons,
                "before_effective_date",
                f"Schedule not yet active (effective {effective_date})",
                f"the published branch schedule takes effect on {effective_date}",
            )

    window_capacity = get_window_capacity_snapshot(db, branch_id=branch.id, service_type=service_type)
    if window_capacity and window_capacity["is_full"]:
        _append_reason(
            reasons,
            "window_capacity_reached",
            f"{window_capacity['window_label']} queue capacity reached",
            f"the {window_capacity['window_label'].lower()} has reached its maximum queue capacity of {window_capacity['max_capacity']}",
        )

    if current_time < opening_time:
        _append_reason(
            reasons,
            "before_opening_hours",
            f"Outside operating hours ({operating_window})",
            f"the branch is outside its operating hours ({operating_window})",
        )
    if current_time > closing_time:
        _append_reason(
            reasons,
            "after_closing_hours",
            f"Outside operating hours ({operating_window})",
            f"the branch is outside its operating hours ({operating_window})",
        )
    if break_start and break_end and break_start <= current_time < break_end:
        break_window = f"{_format_time_label(time_settings['break_start'])}-{_format_time_label(time_settings['break_end'])}"
        _append_reason(
            reasons,
            "break_time",
            f"Lunch / temporary break period ({break_window})",
            f"the branch is currently on its scheduled break period ({break_window})",
        )

    if reasons:
        primary_status = reasons[0]["code"]
        return {
            "is_available": False,
            "message": _build_unavailable_message(
                "Immediate queueing",
                reasons,
                "Please choose another branch, service, or available schedule.",
            ),
            "status": primary_status,
            "reasons": reasons,
            "window_capacity": window_capacity,
        }

    return {
        "is_available": True,
        "message": "",
        "status": "available",
        "reasons": [],
        "window_capacity": window_capacity,
    }


def get_branch_appointment_availability(
    db: Session,
    *,
    branch: Branch,
    selected_date: date,
    service_type: Optional[str] = None,
) -> dict:
    if not bool(get_branch_setting_value(db, "queueEnabled", branch.id)):
        reasons = []
        _append_reason(
            reasons,
            "queue_disabled",
            "Queueing is disabled by system administration",
            "queueing has been disabled by system administration",
        )
        return {
            "is_available": False,
            "message": _build_unavailable_message(
                "Appointments",
                reasons,
                "Please try again after queueing is re-enabled.",
            ),
            "available_slots": [],
            "status": "queue_disabled",
            "reasons": reasons,
            "window_capacity": get_window_capacity_snapshot(db, branch_id=branch.id, service_type=service_type),
        }

    published_config = get_published_branch_schedule(db, branch.id)
    is_available, status, message = _get_schedule_day_status(published_config, selected_date)
    if not is_available:
        reasons = []
        if status == "past_date":
            _append_reason(
                reasons,
                "past_date",
                "Selected date has already passed",
                "the selected date has already passed",
            )
        elif status == "before_effective_date":
            effective_date = published_config.get("effective_date")
            _append_reason(
                reasons,
                "before_effective_date",
                f"Schedule not yet active (effective {effective_date})",
                f"the published branch schedule takes effect on {effective_date}",
            )
        elif status == "weekly_closure":
            weekday_name = WEEKDAY_NAMES[selected_date.weekday()]
            _append_reason(
                reasons,
                "weekly_closure",
                f"Branch is closed on {weekday_name}s",
                f"this branch is closed on {weekday_name}s",
            )
        elif status == "holiday":
            override = next((item for item in published_config["date_overrides"] if item["date"] == selected_date.isoformat()), None)
            holiday_name = override.get("label") if override else None
            _append_reason(
                reasons,
                "holiday",
                f"Holiday closure{f' ({holiday_name})' if holiday_name else ''}",
                f"the branch is closed on the selected date for {holiday_name or 'a holiday'}",
            )
        elif status == "unavailable":
            override = next((item for item in published_config["date_overrides"] if item["date"] == selected_date.isoformat()), None)
            override_label = override.get("label") if override else None
            _append_reason(
                reasons,
                "date_unavailable",
                f"Selected date is marked unavailable{f' ({override_label})' if override_label else ''}",
                f"the selected date is marked unavailable in the branch schedule{f' for {override_label}' if override_label else ''}",
            )
        return {
            "is_available": False,
            "message": _build_unavailable_message(
                "Appointments",
                reasons,
                "Please choose another available date.",
            ) if reasons else (message or "Appointments are currently unavailable for the selected branch on this date/time. Please choose another available schedule."),
            "available_slots": [],
            "status": status,
            "reasons": reasons,
            "window_capacity": get_window_capacity_snapshot(db, branch_id=branch.id, service_type=service_type),
        }

    time_settings = _get_effective_time_settings_for_date(published_config["time_settings"], selected_date)
    opening_time = datetime.strptime(time_settings["opening_time"], "%H:%M").time()
    closing_time = datetime.strptime(time_settings["closing_time"], "%H:%M").time()
    last_appointment_time = datetime.strptime(time_settings["last_appointment_time"], "%H:%M").time()
    break_start = datetime.strptime(time_settings["break_start"], "%H:%M").time() if time_settings.get("break_start") else None
    break_end = datetime.strptime(time_settings["break_end"], "%H:%M").time() if time_settings.get("break_end") else None
    slot_interval = int(time_settings["slot_interval_minutes"])

    slot_cursor = datetime.combine(selected_date, opening_time)
    slot_end_limit = datetime.combine(selected_date, last_appointment_time)
    now = _current_ph_naive_datetime()
    window_capacity = get_window_capacity_snapshot(db, branch_id=branch.id, service_type=service_type)
    available_slots = []

    while slot_cursor <= slot_end_limit:
        slot_time = slot_cursor.time()
        in_break = break_start and break_end and break_start <= slot_time < break_end
        after_close = slot_time > closing_time
        if not in_break and not after_close and slot_cursor >= now:
            booked_appointments = (
                db.query(Queue)
                .filter(
                    Queue.branch_id == branch.id,
                    hash_aware_match(Queue, "queue_type", "appointment"),
                    Queue.appointment_time == slot_cursor,
                    hash_aware_any(Queue, "status", ACTIVE_WINDOW_QUEUE_STATUSES),
                )
                .all()
            )
            if service_type:
                normalized_service_key = normalize_appointment_service_key(service_type)
                booked_count = sum(
                    1
                    for queue in booked_appointments
                    if normalize_appointment_service_key(queue_value(queue, "service_type")) == normalized_service_key
                )
            else:
                booked_count = len(booked_appointments)
            if booked_count < 1:
                available_slots.append({
                    "value": slot_time.strftime("%H:%M"),
                    "label": slot_cursor.strftime("%I:%M %p").lstrip("0"),
                    "remaining_capacity": 1 - booked_count,
                })
        slot_cursor += timedelta(minutes=slot_interval)

    if not available_slots:
        reasons = []
        now_ph = _current_ph_naive_datetime()
        operating_window = _format_time_window(time_settings["opening_time"], time_settings["closing_time"])
        if selected_date == now_ph.date() and now_ph.time() > last_appointment_time:
            _append_reason(
                reasons,
                "after_operating_hours",
                f"No appointment slots remain for today ({operating_window})",
                f"today's appointment window ({operating_window}) has already ended for this branch",
            )
            return {
                "is_available": False,
                "message": _build_unavailable_message(
                    "Appointments",
                    reasons,
                    "Please choose the next available date.",
                ),
                "available_slots": [],
                "status": "after_operating_hours",
                "reasons": reasons,
                "window_capacity": window_capacity,
            }

        _append_reason(
            reasons,
            "fully_booked",
            "Appointment slots are fully booked",
            "all appointment slots for the selected date are fully booked",
        )
        return {
            "is_available": False,
            "message": _build_unavailable_message(
                "Appointments",
                reasons,
                "Please choose another available date or branch.",
            ),
            "available_slots": [],
            "status": "fully_booked",
            "reasons": reasons,
            "window_capacity": window_capacity,
        }

    return {
        "is_available": True,
        "message": message,
        "available_slots": available_slots,
        "status": status,
        "time_settings": time_settings,
        "reasons": [],
        "window_capacity": window_capacity,
    }


def validate_branch_appointment_datetime(
    db: Session,
    *,
    branch: Branch,
    raw_value: Optional[str],
    service_type: Optional[str] = None,
) -> datetime:
    if not raw_value:
        raise HTTPException(status_code=400, detail="Please select an appointment date and time.")

    normalized = raw_value.strip().replace("Z", "")
    try:
        appointment_time = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid appointment date and time.") from exc

    if appointment_time < _current_ph_naive_datetime():
        raise HTTPException(status_code=400, detail="Appointment date and time must be from the current date onward.")

    availability = get_branch_appointment_availability(
        db,
        branch=branch,
        selected_date=appointment_time.date(),
        service_type=service_type,
    )
    time_settings = _get_effective_time_settings_for_date(
        availability.get("time_settings", {}),
        appointment_time.date(),
    )
    slot_value = appointment_time.strftime("%H:%M")
    if not availability.get("is_available"):
        raise HTTPException(
            status_code=400,
            detail=availability.get("message") or "Appointments are currently unavailable for the selected branch on this date/time. Please choose another available schedule.",
        )

    if time_settings:
        opening_time = datetime.strptime(time_settings.get("opening_time", "08:00"), "%H:%M").time()
        closing_time = datetime.strptime(time_settings.get("closing_time", "17:00"), "%H:%M").time()
        last_appointment_time = datetime.strptime(time_settings.get("last_appointment_time", "17:00"), "%H:%M").time()
        break_start = datetime.strptime(time_settings["break_start"], "%H:%M").time() if time_settings.get("break_start") else None
        break_end = datetime.strptime(time_settings["break_end"], "%H:%M").time() if time_settings.get("break_end") else None
        requested_time = appointment_time.time()
        operating_window = _format_time_window(time_settings.get("opening_time", "08:00"), time_settings.get("closing_time", "17:00"))

        if requested_time < opening_time or requested_time > closing_time:
            raise HTTPException(
                status_code=400,
                detail=f"Queue registration failed: Appointments are unavailable because the selected time is outside this branch's operating hours ({operating_window}). Please choose another available time.",
            )

        if requested_time > last_appointment_time:
            raise HTTPException(
                status_code=400,
                detail=f"Queue registration failed: Appointments are unavailable because the selected time is beyond this branch's last appointment cutoff ({_format_time_label(time_settings.get('last_appointment_time', '17:00'))}). Please choose an earlier available time.",
            )

        if break_start and break_end and break_start <= requested_time < break_end:
            break_window = f"{_format_time_label(time_settings['break_start'])}-{_format_time_label(time_settings['break_end'])}"
            raise HTTPException(
                status_code=400,
                detail=f"Queue registration failed: Appointments are unavailable because the branch is on its scheduled break period ({break_window}). Please choose another available time.",
            )

    matched_slot = next((slot for slot in availability.get("available_slots", []) if slot["value"] == slot_value), None)
    if not matched_slot:
        operating_window = _format_time_window(
            time_settings.get("opening_time", "08:00"),
            time_settings.get("closing_time", "17:00"),
        )
        raise HTTPException(
            status_code=400,
            detail=f"Appointments are unavailable because the selected time slot is no longer available within this branch's schedule ({operating_window}). Please choose another available time.",
        )

    return appointment_time
