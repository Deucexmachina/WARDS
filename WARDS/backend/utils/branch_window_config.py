import re
from typing import Optional

from sqlalchemy.orm import Session

from database.models import BranchStaff

STANDARD_SERVICE_SEQUENCE = ["RPT", "BUSINESS", "MISC", "CTC", "PTR", "MARKET"]
MAX_QUEUE_WINDOW_ACCOUNTS = len(STANDARD_SERVICE_SEQUENCE)
LEGACY_QUEUE_WINDOW_ALIAS_MAX = 10
STANDARD_SERVICE_LABELS = {
    "RPT": "RPT",
    "BUSINESS": "BT",
    "MISC": "MISC",
    "CTC": "CTC",
    "PTR": "PTR",
    "MARKET": "MARKET",
}
STANDARD_SERVICE_DESCRIPTIONS = {
    "RPT": "Real Property Tax, Tax Clearance",
    "BUSINESS": "Business Tax, Business Retirement",
    "CTC": "Cedula (Individual / Corporation)",
    "PTR": "Professional Tax Receipt",
    "MISC": "Regulatory Fees, Service Charges, Contractor's Tax, Other Collections",
    "MARKET": "Market Business Tax and Market Fees",
}
SERVICE_WINDOW_ALIASES = {
    "RPT": "RPT",
    "REAL_PROPERTY_TAX": "RPT",
    "BT": "BUSINESS",
    "BUSINESS": "BUSINESS",
    "BUSINESS_TAX": "BUSINESS",
    "CTC": "CTC",
    "CEDULA": "CTC",
    "CEDULA_INDIVIDUAL_CORPORATION": "CTC",
    "PTR": "PTR",
    "PROFESSIONAL_TAX_RECEIPT": "PTR",
    "MISC": "MISC",
    "MISCELLANEOUS": "MISC",
    "MARKET": "MARKET",
    "MARKET_BUSINESS_TAX": "MARKET",
    "MARKET_FEES": "MARKET",
}
for window_number in range(4, LEGACY_QUEUE_WINDOW_ALIAS_MAX + 1):
    SERVICE_WINDOW_ALIASES[f"QW{window_number}"] = f"QW{window_number}"
    SERVICE_WINDOW_ALIASES[f"QUEUE_WINDOW_{window_number}"] = f"QW{window_number}"

for alias, target in list(SERVICE_WINDOW_ALIASES.items()):
    if not alias.endswith("_WINDOW"):
        window_alias = f"{alias}_WINDOW"
        if window_alias not in SERVICE_WINDOW_ALIASES:
            SERVICE_WINDOW_ALIASES[window_alias] = target

SERVICE_WINDOW_KEYWORDS = {
    "RPT": ("rpt", "real property", "amilyar", "property tax", "assessment"),
    "BUSINESS": ("business", "mayor", "permit", "bt", "city tax", "garbage fee", "sanitary", "zoning", "occupancy"),
    "CTC": ("ctc", "cedula", "community tax"),
    "PTR": ("ptr", "professional tax"),
    "MARKET": ("market", "market fee"),
    "MISC": ("misc", "miscellaneous", "regulatory", "service charge", "contractor", "other collection"),
}
RESERVED_CUSTOM_WINDOW_LABELS = set(SERVICE_WINDOW_ALIASES.keys())


def normalize_service_window_key(value: str | None) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", (value or "").strip().upper()).strip("_")


def normalize_service_window(value: str | None, *, allow_unknown_label: bool = False) -> str:
    normalized_key = normalize_service_window_key(value)
    if not normalized_key:
        return "MISC"
    service_window = SERVICE_WINDOW_ALIASES.get(normalized_key)
    if service_window:
        return service_window
    if allow_unknown_label:
        return re.sub(r"\s+", " ", (value or "").strip()).upper() or "MISC"
    raise ValueError(f"Unsupported service window: {value}")


def infer_service_window(value: str | None) -> str:
    normalized_text = " ".join((value or "").strip().casefold().split())
    if not normalized_text:
        return "MISC"
    try:
        return normalize_service_window(value)
    except ValueError:
        pass
    for service_window, keywords in SERVICE_WINDOW_KEYWORDS.items():
        if any(keyword in normalized_text for keyword in keywords):
            return service_window
    return "MISC"


def is_standard_service_window(service_window: str | None) -> bool:
    return (service_window or "").strip().upper() in STANDARD_SERVICE_LABELS


def get_service_window_display_label(service_window: str | None, fallback_label: str | None = None) -> str:
    normalized = (service_window or "").strip().upper()
    if fallback_label and fallback_label.strip():
        return fallback_label.strip()
    if normalized in STANDARD_SERVICE_LABELS:
        return STANDARD_SERVICE_LABELS[normalized]
    if normalized.startswith("QW") and normalized[2:].isdigit():
        return f"Window {normalized[2:]}"
    return normalized or "MISC"


def get_default_window_label(service_window: str | None) -> str:
    normalized = (service_window or "").strip().upper()
    if normalized in STANDARD_SERVICE_LABELS:
        return STANDARD_SERVICE_LABELS[normalized]
    if normalized.startswith("QW") and normalized[2:].isdigit():
        return f"Window {normalized[2:]}"
    return get_service_window_display_label(normalized)


def default_service_window_for_position(index: int) -> str:
    if 0 <= index < len(STANDARD_SERVICE_SEQUENCE):
        return STANDARD_SERVICE_SEQUENCE[index]
    return f"QW{index + 1}"


def default_assigned_window_number(service_window: Optional[str]) -> int:
    normalized = (service_window or "").strip().upper()
    if normalized in STANDARD_SERVICE_SEQUENCE:
        return STANDARD_SERVICE_SEQUENCE.index(normalized) + 1
    if normalized.startswith("QW") and normalized[2:].isdigit():
        return int(normalized[2:])
    return 1


def normalize_service_label_text(value: str | None) -> str:
    return " ".join((value or "").strip().casefold().split())


def get_configured_window_accounts(db: Session, branch_id: int, *, active_only: bool = True) -> list[BranchStaff]:
    query = (
        db.query(BranchStaff)
        .filter(
            BranchStaff.branch_id == branch_id,
            BranchStaff.role == "branch_staff",
            BranchStaff.account_scope == "queue_window",
        )
        .order_by(BranchStaff.assigned_window_number.asc(), BranchStaff.id.asc())
    )
    if active_only:
        query = query.filter(BranchStaff.status == "Active")
    return query.all()


def get_branch_window_account_for_service(db: Session, branch_id: int, service_type: Optional[str]) -> BranchStaff | None:
    accounts = get_configured_window_accounts(db, branch_id)
    if not accounts:
        return None

    normalized_label = normalize_service_label_text(service_type)
    inferred_window = infer_service_window(service_type)

    for account in accounts:
        if normalize_service_label_text(account.service_window_label) == normalized_label:
            return account

    for account in accounts:
        if (account.service_window or "").strip().upper() == inferred_window:
            return account

    for account in accounts:
        if get_service_window_display_label(account.service_window, account.service_window_label).casefold() == normalized_label:
            return account

    return None


def get_branch_window_metadata(db: Session, branch_id: int, service_type: Optional[str]) -> dict:
    account = get_branch_window_account_for_service(db, branch_id, service_type)
    if account:
        service_window = (account.service_window or "").strip().upper() or infer_service_window(service_type)
        return {
            "service_window": service_window,
            "assigned_window_number": account.assigned_window_number or default_assigned_window_number(service_window),
            "window_label": get_service_window_display_label(service_window, account.service_window_label),
            "service_label": get_service_window_display_label(service_window, account.service_window_label),
        }

    service_window = infer_service_window(service_type)
    return {
        "service_window": service_window,
        "assigned_window_number": default_assigned_window_number(service_window),
        "window_label": get_default_window_label(service_window),
        "service_label": get_default_window_label(service_window),
    }


def get_branch_service_options(db: Session, branch_id: int) -> list[dict]:
    options = []
    seen = set()
    for account in get_configured_window_accounts(db, branch_id):
        service_window = (account.service_window or "").strip().upper() or "MISC"
        display_label = get_service_window_display_label(service_window, account.service_window_label)
        dedupe_key = (service_window, display_label.casefold())
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        options.append({
            "code": service_window,
            "name": display_label,
            "display_label": display_label,
            "description": STANDARD_SERVICE_DESCRIPTIONS.get(service_window, display_label),
            "service_window": service_window,
            "window_label": display_label,
            "assigned_window_number": account.assigned_window_number or default_assigned_window_number(service_window),
            "requires_appointment": False,
            "average_time": None,
        })
    return options
