import os
from typing import Optional

from sqlalchemy.orm import Session

from utils.system_settings import get_setting_value
from utils.field_crypto import get_decrypted_or_raw


def get_session_timeout_minutes(db: Session) -> int:
    configured_timeout = int(get_setting_value(db, "sessionTimeout") or 30)
    return max(configured_timeout, 30)


def slugify_branch_name(name: str) -> str:
    value = "".join(char.lower() if char.isalnum() else "-" for char in name.strip())
    slug = "-".join(part for part in value.split("-") if part)
    return slug or "branch"


def get_branch_dashboard_url(account: object) -> str:
    branch = getattr(account, "branch", None)
    if branch:
        branch_dashboard_url = get_decrypted_or_raw(branch, "dashboard_url") or getattr(branch, "dashboard_url", None)
        if branch_dashboard_url:
            return branch_dashboard_url

    base_url = os.getenv("FRONTEND_BASE_URL", "http://localhost:3000").rstrip("/")
    branch_name = (get_decrypted_or_raw(branch, "name") or getattr(branch, "name", "")) if branch else ""
    if branch_name:
        return f"{base_url}/branch-dashboard/{slugify_branch_name(branch_name)}"

    branch_id = getattr(account, "branch_id", None)
    return f"{base_url}/branch-dashboard/branch-{branch_id or 'portal'}"


def get_branch_window_label(account: object) -> Optional[str]:
    service_window = getattr(account, "service_window", None)
    if not service_window:
        return None
    return getattr(account, "service_window_label", None) or {
        "RPT": "RPT Window",
        "BUSINESS": "BT Window",
        "MISC": "MISC Window",
        "QW4": "Queue Window 4",
        "QW5": "Queue Window 5",
    }.get(service_window, service_window)


def get_branch_assigned_window_number(account: object) -> Optional[int]:
    service_window = getattr(account, "service_window", None)
    if not service_window:
        return None
    assigned_window_number = getattr(account, "assigned_window_number", None)
    if assigned_window_number:
        return assigned_window_number
    return {
        "RPT": 1,
        "BUSINESS": 2,
        "MISC": 3,
        "QW4": 4,
        "QW5": 5,
    }.get(service_window)
