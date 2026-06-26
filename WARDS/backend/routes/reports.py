from fastapi import APIRouter, Depends, HTTPException, Query, Request

from slowapi import Limiter
from slowapi.util import get_remote_address
from fastapi.responses import Response
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta, time
from collections import Counter
from io import BytesIO
from textwrap import wrap
from xml.sax.saxutils import escape
import json

from database.models import (
    Report, get_db, ActivityLog, Branch, Queue, Payment,
    ReceiptRequest, QueueActivity, QueueHistory, ReceiptRequestHistory,
    Service, DiscrepancyReport, BranchSystemSetting, ReportHistory
)
from auth import get_current_admin_user
from auth import get_current_branch_staff, require_any_branch_staff
from utils.rbac import require_permission
from utils.field_crypto import (
    get_decrypted_or_raw,
    hash_aware_match,
    hash_optional_value,
    queue_value,
    receipt_request_value,
    receipt_request_history_value,
)

def get_rate_limit_key(request: Request) -> str:
    """Get rate limit key - user-based if authenticated, otherwise IP-based"""
    if hasattr(request.state, 'user') and request.state.user:
        return f"user:{request.state.user.id}"
    return get_remote_address(request)


limiter = Limiter(key_func=get_rate_limit_key)

router = APIRouter()
branch_router = APIRouter()

class ReportGenerateRequest(BaseModel):
    branch_id: Optional[str] = None
    reportType: Optional[str] = None
    dateFrom: Optional[str] = None
    dateTo: Optional[str] = None
    service_type: Optional[str] = None
    transaction_category: Optional[str] = None


class ReportAutomationSettingsPayload(BaseModel):
    enabled: bool = False
    frequency: str = "daily"
    dispatch_time: str = "17:00"
    weekday: int = 0
    month_day: int = 1
    reportType: str = "Daily"
    service_type: str = "All Services"
    transaction_category: str = "All Categories"


DEFAULT_REPORT_PAGE_SIZE = 5
MAX_REPORT_PAGE_SIZE = 5
DOCUMENT_REQUEST_SERVICE = "Document Request"
RECEIPT_REQUEST_FEE_CATEGORY = "Receipt Request Fee"
RECEIPT_REQUEST_FEE_AMOUNT = 50.0
REPORT_AUTOMATION_KEY = "branchReportAutomation"


def get_branch_display_name(branch: Branch) -> str:
    return get_decrypted_or_raw(branch, "name") or branch.name


def find_branch_by_display_name(db: Session, branch_name: Optional[str]) -> Branch | None:
    normalized = (branch_name or "").strip()
    if not normalized:
        return None

    direct_match = db.query(Branch).filter(Branch.name == normalized).first()
    if direct_match:
        return direct_match

    for branch in db.query(Branch).all():
        if get_branch_display_name(branch) == normalized:
            return branch

    return None


def normalize_service_type(service_type: Optional[str]) -> Optional[str]:
    normalized = (service_type or "").strip()
    if not normalized or normalized.lower() == "all services":
        return None
    return normalized


def normalize_transaction_category(transaction_category: Optional[str]) -> Optional[str]:
    normalized = (transaction_category or "").strip()
    if not normalized or normalized.lower() == "all categories":
        return None
    return normalized


def is_document_request_service(service_type: Optional[str]) -> bool:
    return (service_type or "").strip().lower() == DOCUMENT_REQUEST_SERVICE.lower()


def is_receipt_request_fee_category(transaction_category: Optional[str]) -> bool:
    return (transaction_category or "").strip().lower() == RECEIPT_REQUEST_FEE_CATEGORY.lower()


def is_completed_payment(status: Optional[str]) -> bool:
    normalized = (status or "").strip().lower()
    return normalized in {"verified", "payment verified", "confirmed"}


def is_pending_payment(status: Optional[str]) -> bool:
    normalized = (status or "").strip().lower()
    return normalized in {"pending", "payment required"}


def is_failed_payment(status: Optional[str]) -> bool:
    normalized = (status or "").strip().lower()
    return normalized in {"failed", "declined", "expired", "cancelled", "canceled"}


def is_completed_receipt_request(status: Optional[str]) -> bool:
    normalized = (status or "").strip().lower()
    return normalized in {"completed", "released"}


def is_pending_receipt_request(status: Optional[str]) -> bool:
    normalized = (status or "").strip().lower()
    return normalized not in {"completed", "released"}


def normalize_receipt_request_status(status: Optional[str]) -> str:
    normalized = (status or "").strip()
    return normalized or "Unknown"


def normalize_receipt_request_type(request_type: Optional[str]) -> str:
    normalized = (request_type or "").strip()
    return normalized or "Immediate"


def get_receipt_request_amount(receipt: ReceiptRequest) -> float:
    return RECEIPT_REQUEST_FEE_AMOUNT if receipt.fee_paid else 0.0


def average_duration_minutes(durations: List[float]) -> float:
    if not durations:
        return 0.0
    return round(sum(durations) / len(durations), 2)


def to_iso_or_none(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def format_record_time_label(value: Optional[datetime]) -> str:
    if not value:
        return "N/A"
    return value.strftime("%H:%M:%S")


def sanitize_filename(value: str) -> str:
    safe = "".join(char if char.isalnum() or char in {"-", "_"} else "_" for char in value.strip())
    return safe.strip("_") or "branch_report"


def format_export_value(value: Any) -> str:
    if value is None:
        return "N/A"
    if isinstance(value, float):
        return f"{value:.2f}"
    return str(value)


def payment_value(payment: Payment, field_name: str) -> Optional[str]:
    return get_decrypted_or_raw(payment, field_name)


def queue_record_value(record: Queue | QueueHistory, field_name: str) -> Optional[str]:
    if isinstance(record, QueueHistory):
        if field_name == "status":
            return record.final_status or None
        return getattr(record, field_name, None)
    return queue_value(record, field_name)


def queue_record_datetime(record: Queue | QueueHistory, field_name: str) -> Optional[datetime]:
    return getattr(record, field_name, None)


def receipt_record_value(record: ReceiptRequest | ReceiptRequestHistory, field_name: str) -> Optional[str]:
    if isinstance(record, ReceiptRequestHistory):
        if field_name == "status":
            return receipt_request_history_value(record, "final_status")
        return receipt_request_history_value(record, field_name)
    if field_name == "status":
        return receipt_request_value(record, "status")
    return receipt_request_value(record, field_name)


def receipt_record_datetime(record: ReceiptRequest | ReceiptRequestHistory, field_name: str) -> Optional[datetime]:
    return getattr(record, field_name, None)


def dedupe_records(records: List[Any], key_builder) -> List[Any]:
    deduped: Dict[str, Any] = {}
    ordered_records = sorted(records, key=lambda item: key_builder(item)[1], reverse=True)
    for record in ordered_records:
        key, _ = key_builder(record)
        if key not in deduped:
            deduped[key] = record
    return list(deduped.values())


def build_payment_branch_filter(branch: Branch):
    branch_name = get_branch_display_name(branch)
    branch_hash = hash_optional_value(branch_name)
    return or_(
        Payment.branch_id == branch.id,
        and_(
            Payment.branch_id.is_(None),
            or_(
                Payment.branch == branch_name,
                Payment.branch_hash == branch_hash,
            ),
        ),
    )


def collect_queue_records(
    db: Session,
    *,
    branch_id: Optional[int],
    start_date: datetime,
    end_date: datetime,
    service_type: Optional[str],
) -> List[Queue | QueueHistory]:
    queue_query = db.query(Queue).filter(Queue.created_at.between(start_date, end_date))
    queue_history_query = db.query(QueueHistory).filter(QueueHistory.created_at.between(start_date, end_date))

    if branch_id:
        queue_query = queue_query.filter(Queue.branch_id == branch_id)
        queue_history_query = queue_history_query.filter(QueueHistory.branch_id == branch_id)

    if service_type:
        queue_query = queue_query.filter(hash_aware_match(Queue, "service_type", service_type))
        queue_history_query = queue_history_query.filter(QueueHistory.service_type == service_type)

    combined = queue_query.all() + queue_history_query.all()
    return dedupe_records(
        combined,
        lambda record: (
            queue_record_value(record, "queue_number") or f"queue-{getattr(record, 'id', 'unknown')}",
            queue_record_datetime(record, "completed_at")
            or queue_record_datetime(record, "archived_at")
            or queue_record_datetime(record, "created_at")
            or datetime.min,
        ),
    )


def collect_receipt_records(
    db: Session,
    *,
    branch_id: Optional[int],
    start_date: datetime,
    end_date: datetime,
    service_type: Optional[str],
    include_receipts_in_scope: bool,
) -> List[ReceiptRequest | ReceiptRequestHistory]:
    if not include_receipts_in_scope:
        return []

    receipt_query = db.query(ReceiptRequest).filter(ReceiptRequest.created_at.between(start_date, end_date))
    receipt_history_query = db.query(ReceiptRequestHistory).filter(ReceiptRequestHistory.created_at.between(start_date, end_date))

    if branch_id:
        receipt_query = receipt_query.filter(ReceiptRequest.branch_id == branch_id)
        receipt_history_query = receipt_history_query.filter(ReceiptRequestHistory.branch_id == branch_id)

    if service_type and service_type != DOCUMENT_REQUEST_SERVICE:
        receipt_query = receipt_query.filter(hash_aware_match(ReceiptRequest, "tax_type", service_type))
        receipt_history_query = receipt_history_query.filter(hash_aware_match(ReceiptRequestHistory, "tax_type", service_type))

    combined = receipt_query.all() + receipt_history_query.all()
    return dedupe_records(
        combined,
        lambda record: (
            receipt_record_value(record, "request_id")
            or receipt_record_value(record, "payment_ref_number")
            or f"receipt-{getattr(record, 'id', 'unknown')}",
            receipt_record_datetime(record, "processed_at")
            or receipt_record_datetime(record, "archived_at")
            or receipt_record_datetime(record, "created_at")
            or datetime.min,
        ),
    )


def collect_queue_activity_records(
    db: Session,
    *,
    branch_id: Optional[int],
    start_date: datetime,
    end_date: datetime,
    service_type: Optional[str],
) -> List[QueueActivity]:
    query = db.query(QueueActivity).filter(QueueActivity.timestamp.between(start_date, end_date))
    if branch_id:
        query = query.filter(QueueActivity.branch_id == branch_id)
    if service_type and service_type != DOCUMENT_REQUEST_SERVICE:
        query = query.filter(hash_aware_match(QueueActivity, "service_type", service_type))
    return query.order_by(QueueActivity.timestamp.asc()).all()


def calculate_operational_statistics(activities: List[QueueActivity]) -> Dict[str, Any]:
    if not activities:
        return {
            "total_snapshots": 0,
            "average_waiting": 0.0,
            "average_serving": 0.0,
            "average_completed": 0.0,
            "peak_waiting": 0,
            "peak_serving": 0,
            "peak_completed": 0,
            "latest_snapshot_at": None,
        }

    total_snapshots = len(activities)
    waiting_values = [activity.clients_waiting or 0 for activity in activities]
    serving_values = [activity.clients_being_served or 0 for activity in activities]
    completed_values = [activity.clients_completed or 0 for activity in activities]
    latest_snapshot = max((activity.timestamp for activity in activities if activity.timestamp), default=None)

    return {
        "total_snapshots": total_snapshots,
        "average_waiting": round(sum(waiting_values) / total_snapshots, 2),
        "average_serving": round(sum(serving_values) / total_snapshots, 2),
        "average_completed": round(sum(completed_values) / total_snapshots, 2),
        "peak_waiting": max(waiting_values, default=0),
        "peak_serving": max(serving_values, default=0),
        "peak_completed": max(completed_values, default=0),
        "latest_snapshot_at": latest_snapshot.isoformat() if latest_snapshot else None,
    }


def serialize_report_summary(report: Report) -> Dict[str, Any]:
    return {
        "id": report.id,
        "title": report.title,
        "branch_id": report.branch_id,
        "branch": report.branch,
        "report_type": report.report_type,
        "service_type": report.service_type or "All Services",
        "transaction_category": report.transaction_category or "All Categories",
        "date_from": report.date_from,
        "date_to": report.date_to,
        "generated_by": report.generated_by,
        "submitted_by": report.submitted_by,
        "submitted_at": report.submitted_at.isoformat() if report.submitted_at else None,
        "created_at": report.created_at.isoformat() if report.created_at else None,
    }


def get_branch_report_now() -> datetime:
    return datetime.utcnow() + timedelta(hours=8)


def get_default_report_automation_settings() -> Dict[str, Any]:
    return {
        "enabled": False,
        "frequency": "daily",
        "dispatch_time": "17:00",
        "weekday": 0,
        "month_day": 1,
        "reportType": "Daily",
        "service_type": "All Services",
        "transaction_category": "All Categories",
        "last_sent_at": None,
    }


def get_branch_report_automation_row(db: Session, branch_id: int) -> BranchSystemSetting | None:
    return (
        db.query(BranchSystemSetting)
        .filter(
            BranchSystemSetting.branch_id == branch_id,
            BranchSystemSetting.key == REPORT_AUTOMATION_KEY,
        )
        .first()
    )


def get_branch_report_automation_settings(db: Session, branch_id: int) -> Dict[str, Any]:
    defaults = get_default_report_automation_settings()
    row = get_branch_report_automation_row(db, branch_id)
    if not row or not row.value:
        return defaults

    try:
        parsed = json.loads(row.value)
    except json.JSONDecodeError:
        return defaults

    if not isinstance(parsed, dict):
        return defaults
    defaults.update(parsed)
    return defaults


def validate_report_automation_settings(payload: Dict[str, Any]) -> Dict[str, Any]:
    settings = get_default_report_automation_settings()
    settings.update(payload)

    frequency = str(settings.get("frequency") or "daily").strip().lower()
    if frequency not in {"daily", "weekly", "monthly"}:
        raise HTTPException(status_code=400, detail="Automatic sending frequency must be daily, weekly, or monthly.")
    settings["frequency"] = frequency

    dispatch_time = str(settings.get("dispatch_time") or "17:00").strip()
    try:
        datetime.strptime(dispatch_time, "%H:%M")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Automatic dispatch time must use 24-hour HH:MM format.") from exc
    settings["dispatch_time"] = dispatch_time

    weekday = int(settings.get("weekday", 0))
    if weekday < 0 or weekday > 6:
        raise HTTPException(status_code=400, detail="Weekly automatic sending day must be between 0 (Monday) and 6 (Sunday).")
    settings["weekday"] = weekday

    month_day = int(settings.get("month_day", 1))
    if month_day < 1 or month_day > 28:
        raise HTTPException(status_code=400, detail="Monthly automatic sending day must be between 1 and 28.")
    settings["month_day"] = month_day

    settings["reportType"] = (settings.get("reportType") or "Daily").strip() or "Daily"
    settings["service_type"] = (settings.get("service_type") or "All Services").strip() or "All Services"
    settings["transaction_category"] = (settings.get("transaction_category") or "All Categories").strip() or "All Categories"
    settings["enabled"] = bool(settings.get("enabled"))
    return settings


def save_branch_report_automation_settings(
    db: Session,
    *,
    branch: Branch,
    payload: Dict[str, Any],
    updated_by: str,
) -> Dict[str, Any]:
    settings = validate_report_automation_settings(payload)
    existing = get_branch_report_automation_row(db, branch.id)
    serialized_value = json.dumps(settings)

    if existing:
        existing.label = "Branch Report Automation"
        existing.category = "reporting"
        existing.value = serialized_value
        existing.value_json = serialized_value
        existing.value_type = "json"
        existing.description = "Automatic branch report dispatch settings."
        existing.updated_by = updated_by
        existing.updated_at = datetime.utcnow()
    else:
        db.add(BranchSystemSetting(
            branch_id=branch.id,
            key=REPORT_AUTOMATION_KEY,
            label="Branch Report Automation",
            category="reporting",
            value=serialized_value,
            value_json=serialized_value,
            value_type="json",
            description="Automatic branch report dispatch settings.",
            updated_by=updated_by,
            updated_at=datetime.utcnow(),
        ))

    db.add(ActivityLog(
        action="Branch Report Automation Updated",
        user=updated_by,
        details=f"Updated automatic report sending for {get_branch_display_name(branch)}",
        type="report",
    ))
    db.commit()
    return get_branch_report_automation_settings(db, branch.id)


def get_report_branch_id(db: Session, report: Report) -> Optional[int]:
    if report.branch_id:
        return report.branch_id

    if report.branch and report.branch != "All Branches":
        branch = find_branch_by_display_name(db, report.branch)
        return branch.id if branch else None

    return None


def build_report_history_response(query, *, page: int, page_size: int) -> Dict[str, Any]:
    total = query.count()
    total_pages = max(1, (total + page_size - 1) // page_size) if total else 1
    reports = (
        query.order_by(Report.created_at.desc(), Report.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    earliest_record = query.with_entities(func.min(Report.created_at)).scalar()
    earliest_record_date = earliest_record.date().isoformat() if earliest_record else None
    return {
        "items": [serialize_report_summary(report) for report in reports],
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
        "earliest_record_date": earliest_record_date,
    }


def build_report_record(
    *,
    request: ReportGenerateRequest,
    branch_id: Optional[int],
    branch_name: str,
    actor_username: str,
) -> Report:
    title = f"{request.reportType or 'Operational'} Report - {branch_name} - {datetime.now().strftime('%b %d, %Y')}"
    return Report(
        title=title,
        branch_id=branch_id,
        branch=branch_name,
        report_type=request.reportType or "Operational",
        service_type=request.service_type or "All Services",
        transaction_category=normalize_transaction_category(request.transaction_category),
        date_from=request.dateFrom,
        date_to=request.dateTo,
        generated_by=actor_username,
        submitted_by=actor_username,
        submitted_at=datetime.utcnow(),
    )


def create_branch_report_entry(
    *,
    db: Session,
    request: ReportGenerateRequest,
    branch_id: int,
    branch_name: str,
    actor_username: str,
    dispatch_mode: str,
) -> Dict[str, Any]:
    _, _, date_from, date_to = parse_report_date_range(request.dateFrom, request.dateTo)
    request.dateFrom = date_from
    request.dateTo = date_to

    metrics = calculate_report_metrics_sync(
        db=db,
        branch_id=branch_id,
        date_from=date_from,
        date_to=date_to,
        service_type=normalize_service_type(request.service_type),
        transaction_category=normalize_transaction_category(request.transaction_category),
    )

    report = build_report_record(
        request=request,
        branch_id=branch_id,
        branch_name=branch_name,
        actor_username=actor_username,
    )
    db.add(report)
    db.add(ActivityLog(
        action="Branch Report Submitted",
        user=actor_username,
        details=f"{dispatch_mode.title()} send: submitted {request.reportType or 'Operational'} report for {branch_name}",
        type="report",
    ))
    db.commit()
    db.refresh(report)

    return {
        "report": serialize_report_summary(report),
        "metrics": metrics,
    }


def validate_report_request(request: ReportGenerateRequest) -> None:
    missing_fields = []
    if not request.branch_id:
        missing_fields.append("Branch Office")
    if not request.reportType:
        missing_fields.append("Report Type")
    if not request.service_type:
        missing_fields.append("Service Activity")
    if not request.dateFrom:
        missing_fields.append("Date From")
    if not request.dateTo:
        missing_fields.append("Date To")

    if missing_fields:
        raise HTTPException(
            status_code=400,
            detail=f"Please fill all filters before generating a report. Missing: {', '.join(missing_fields)}."
        )


def resolve_branch_selection(
    db: Session,
    branch_value: Optional[str],
    *,
    enforced_branch_id: Optional[int] = None,
) -> tuple[Optional[int], str]:
    if enforced_branch_id:
        branch = db.query(Branch).filter(Branch.id == enforced_branch_id).first()
        if not branch:
            raise HTTPException(status_code=404, detail="Assigned branch not found.")
        return branch.id, get_branch_display_name(branch)

    if branch_value == "all":
        return None, "All Branches"

    try:
        branch_id = int(branch_value) if branch_value else None
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid branch selection.")

    if not branch_id:
        raise HTTPException(status_code=400, detail="Branch selection is required.")

    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Selected branch not found.")

    return branch.id, get_branch_display_name(branch)


TABULAR_EXPORT_SECTIONS = {
    "Service Utilization",
    "Transaction Categories",
    "Receipt Request Status Breakdown",
    "Receipt And Transaction Summary",
}


def is_tabular_export_section(title: str) -> bool:
    return title in TABULAR_EXPORT_SECTIONS


def build_export_sections(report: Report, metrics: Dict[str, Any]) -> List[tuple[str, List[List[str]]]]:
    sections: List[tuple[str, List[List[str]]]] = [
        (
            "Report Overview",
            [
                ["Title", report.title],
                ["Branch", report.branch],
                ["Report Type", report.report_type],
                ["Service Activity", report.service_type or "All Services"],
                ["Payment Category", report.transaction_category or "All Categories"],
                ["Date From", report.date_from or "N/A"],
                ["Date To", report.date_to or "N/A"],
                ["Generated At", report.created_at.isoformat() if report.created_at else "N/A"],
            ],
        ),
        (
            "Client Service Summary",
            [
                ["Total Clients Served", metrics.get("summary", {}).get("total_clients_served", 0)],
                ["Completed Clients", metrics.get("summary", {}).get("clients_completed", 0)],
                ["Clients Waiting", metrics.get("summary", {}).get("clients_waiting", 0)],
                ["Clients Serving", metrics.get("summary", {}).get("clients_serving", 0)],
                ["Completion Rate (%)", metrics.get("summary", {}).get("completion_rate", 0)],
                ["Average Wait Time (min)", metrics.get("summary", {}).get("avg_wait_time", 0)],
                ["Average Service Time (min)", metrics.get("summary", {}).get("avg_service_time", 0)],
            ],
        ),
        (
            "Transaction Overview",
            [
                ["Total Transactions", metrics.get("transactions", {}).get("total_transactions", 0)],
                ["Completed Transactions", metrics.get("transactions", {}).get("completed_transactions", 0)],
                ["Pending Transactions", metrics.get("transactions", {}).get("pending_transactions", 0)],
                ["Total Amount", metrics.get("transactions", {}).get("total_amount", 0)],
                ["Average Transaction Value", metrics.get("transactions", {}).get("average_transaction_value", 0)],
            ],
        ),
        (
            "Peak Analysis",
            [
                ["Peak Hour", metrics.get("peak_hours", {}).get("peak_hour", "N/A")],
                ["Peak Hour Count", metrics.get("peak_hours", {}).get("peak_count", 0)],
                ["Peak Weekday", metrics.get("peak_days", {}).get("peak_weekday", "N/A")],
                ["Peak Weekday Count", metrics.get("peak_days", {}).get("peak_count", 0)],
            ],
        ),
        (
            "Receipt Requests",
            [
                ["Total Requests", metrics.get("receipt_requests", {}).get("total_requests", 0)],
                ["Completed Requests", metrics.get("receipt_requests", {}).get("completed_requests", 0)],
                ["Pending Requests", metrics.get("receipt_requests", {}).get("pending_requests", 0)],
            ],
        ),
        (
            "Operational Statistics",
            [
                ["Queue Activity Snapshots", metrics.get("operational_statistics", {}).get("total_snapshots", 0)],
                ["Average Waiting", metrics.get("operational_statistics", {}).get("average_waiting", 0)],
                ["Average Serving", metrics.get("operational_statistics", {}).get("average_serving", 0)],
                ["Average Completed", metrics.get("operational_statistics", {}).get("average_completed", 0)],
                ["Peak Waiting", metrics.get("operational_statistics", {}).get("peak_waiting", 0)],
                ["Peak Serving", metrics.get("operational_statistics", {}).get("peak_serving", 0)],
                ["Peak Completed", metrics.get("operational_statistics", {}).get("peak_completed", 0)],
            ],
        ),
    ]

    service_rows = [["Service Activity", "Total", "Completed", "Success Rate (%)"]]
    for service, data in metrics.get("service_utilization", {}).items():
        success_rate = round((data["completed"] / data["count"] * 100), 1) if data.get("count") else 0
        service_rows.append([service, data.get("count", 0), data.get("completed", 0), success_rate])
    sections.append(("Service Utilization", service_rows))

    category_rows = [["Payment Category", "Count", "Total Amount"]]
    for category, data in metrics.get("transaction_categories", {}).items():
        category_rows.append([category, data.get("count", 0), data.get("amount", 0)])
    sections.append(("Transaction Categories", category_rows))

    receipt_status_rows = [["Receipt Status", "Count"]]
    for status, count in metrics.get("receipt_requests", {}).get("by_status", {}).items():
        receipt_status_rows.append([status, count])
    sections.append(("Receipt Request Status Breakdown", receipt_status_rows))

    receipt_transaction_rows = [["Summary Item", "Count", "Amount", "Status"]]
    for item in metrics.get("receipt_transaction_summary", []):
        receipt_transaction_rows.append([
            item.get("label", "N/A"),
            item.get("count", 0),
            item.get("amount", 0),
            item.get("status", "N/A"),
        ])
    sections.append(("Receipt And Transaction Summary", receipt_transaction_rows))

    operational = metrics.get("operational_problems", {})
    sections.append(
        (
            "Operational Problems",
            [
                ["Total Problems", operational.get("total_problems", 0)],
                ["Critical", operational.get("total_critical", 0)],
                ["Medium", operational.get("total_medium", 0)],
                ["Low", operational.get("total_low", 0)],
                [
                    "Most Problematic Branch",
                    operational.get("most_problematic_branch", {}).get("branch_name", "N/A")
                    if operational.get("most_problematic_branch")
                    else "N/A",
                ],
            ],
        )
    )

    return sections


def build_daily_trend(
    queues: List[Queue | QueueHistory],
    payments: List[Payment],
    receipts: List[ReceiptRequest | ReceiptRequestHistory],
    start_date: datetime,
    end_date: datetime,
    *,
    use_receipts_for_clients: bool = False,
    use_receipts_for_transactions: bool = False,
    include_receipt_transactions_in_totals: bool = False,
) -> List[Dict[str, Any]]:
    queue_counts = Counter()
    payment_counts = Counter()
    receipt_counts = Counter()
    revenue_by_date: Dict[str, float] = {}

    for queue in queues:
        created_at = queue_record_datetime(queue, "created_at")
        if created_at:
            date_key = created_at.date().isoformat()
            queue_counts[date_key] += 1

    for payment in payments:
        if payment.created_at:
            date_key = payment.created_at.date().isoformat()
            payment_counts[date_key] += 1
            if is_completed_payment(payment.status):
                revenue_by_date[date_key] = revenue_by_date.get(date_key, 0.0) + float(payment.amount or 0)

    for receipt in receipts:
        created_at = receipt_record_datetime(receipt, "created_at")
        if created_at:
            date_key = created_at.date().isoformat()
            receipt_counts[date_key] += 1
            revenue_by_date[date_key] = revenue_by_date.get(date_key, 0.0) + get_receipt_request_amount(receipt)

    trend_rows: List[Dict[str, Any]] = []
    current_date = start_date.date()
    final_date = end_date.date()
    while current_date <= final_date:
        date_key = current_date.isoformat()
        trend_rows.append({
            "date": date_key,
            "clients_served": receipt_counts.get(date_key, 0) if use_receipts_for_clients else queue_counts.get(date_key, 0),
            "transactions": (
                receipt_counts.get(date_key, 0)
                if use_receipts_for_transactions
                else payment_counts.get(date_key, 0) + (receipt_counts.get(date_key, 0) if include_receipt_transactions_in_totals else 0)
            ),
            "revenue": round(revenue_by_date.get(date_key, 0.0), 2),
        })
        current_date += timedelta(days=1)

    return trend_rows


def build_detailed_report_rows(
    queues: List[Queue | QueueHistory],
    payments: List[Payment],
    receipts: List[ReceiptRequest | ReceiptRequestHistory],
    *,
    include_queue_rows: bool = True,
    include_payment_rows: bool = True,
    include_receipt_rows: bool = True,
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []

    if include_queue_rows:
        for queue in queues:
            created_at = queue_record_datetime(queue, "created_at")
            rows.append({
                "reference": queue_record_value(queue, "queue_number") or f"QUEUE-{getattr(queue, 'id', 'unknown')}",
                "timestamp": to_iso_or_none(created_at),
                "date": created_at.date().isoformat() if created_at else None,
                "time": format_record_time_label(created_at),
                "service_type": queue_record_value(queue, "service_type") or "Service Activity",
                "category": "Queue Service",
                "status": queue_record_value(queue, "status") or "Unknown",
                "amount": None,
                "notes": f"{(queue_record_value(queue, 'queue_type') or 'Immediate').title()} queue for {queue_record_value(queue, 'taxpayer_name') or 'Walk-in taxpayer'}",
                "source_type": "Queue",
            })

    if include_payment_rows:
        for payment in payments:
            rows.append({
                "reference": payment_value(payment, "ref_number") or payment_value(payment, "txn_id") or f"PAYMENT-{payment.id}",
                "timestamp": to_iso_or_none(payment.created_at),
                "date": payment.created_at.date().isoformat() if payment.created_at else None,
                "time": format_record_time_label(payment.created_at),
                "service_type": payment_value(payment, "tax_type") or "Payment",
                "category": payment_value(payment, "tax_type") or "Payment",
                "status": payment_value(payment, "status") or "Unknown",
                "amount": float(payment.amount or 0),
                "notes": f"{payment_value(payment, 'payment_method') or 'Payment method unavailable'} payment by {payment_value(payment, 'taxpayer_name') or 'Unknown taxpayer'}",
                "source_type": "Payment",
            })

    if include_receipt_rows:
        for receipt in receipts:
            created_at = receipt_record_datetime(receipt, "created_at")
            rows.append({
                "reference": receipt_record_value(receipt, "request_id") or receipt_record_value(receipt, "payment_ref_number") or f"RECEIPT-{getattr(receipt, 'id', 'unknown')}",
                "timestamp": to_iso_or_none(created_at),
                "date": created_at.date().isoformat() if created_at else None,
                "time": format_record_time_label(created_at),
                "service_type": DOCUMENT_REQUEST_SERVICE,
                "category": receipt_record_value(receipt, "tax_type") or "Receipt Request",
                "status": receipt_record_value(receipt, "status") or "Unknown",
                "amount": get_receipt_request_amount(receipt) if getattr(receipt, "fee_paid", False) else None,
                "notes": f"{normalize_receipt_request_type(receipt_record_value(receipt, 'request_type'))} request for {receipt_record_value(receipt, 'taxpayer_name') or 'Unknown taxpayer'}",
                "source_type": "Receipt",
            })

    rows.sort(key=lambda row: row.get("timestamp") or "", reverse=True)
    return rows


def build_report_insights(
    *,
    service_breakdown: Dict[str, Dict[str, Any]],
    category_breakdown: Dict[str, Dict[str, Any]],
    peak_hours: Dict[str, Any],
    peak_days: Dict[str, Any],
    historical_comparison: Dict[str, Any],
    total_amount: float,
) -> Dict[str, Any]:
    most_used_service = None
    if service_breakdown:
        most_used_service = max(service_breakdown.items(), key=lambda item: item[1].get("count", 0))[0]

    top_transaction_category = None
    if category_breakdown:
        top_transaction_category = max(category_breakdown.items(), key=lambda item: item[1].get("count", 0))[0]

    clients_delta = historical_comparison.get("clients_served", {}).get("delta", 0)
    transactions_delta = historical_comparison.get("completed_transactions", {}).get("delta", 0)
    revenue_delta = historical_comparison.get("total_amount", {}).get("delta", 0)

    trend_parts = []
    trend_parts.append(
        "Client activity increased compared with the previous period."
        if clients_delta > 0
        else "Client activity declined compared with the previous period."
        if clients_delta < 0
        else "Client activity remained steady compared with the previous period."
    )
    trend_parts.append(
        "Completed transactions improved."
        if transactions_delta > 0
        else "Completed transactions decreased."
        if transactions_delta < 0
        else "Completed transactions stayed flat."
    )
    trend_parts.append(
        "Collections increased."
        if revenue_delta > 0
        else "Collections decreased."
        if revenue_delta < 0
        else "Collections were unchanged."
    )

    return {
        "most_used_service": most_used_service or "N/A",
        "top_transaction_category": top_transaction_category or "N/A",
        "busiest_day": peak_days.get("peak_date") or peak_days.get("peak_weekday") or "N/A",
        "busiest_time": peak_hours.get("peak_hour") or "N/A",
        "transaction_trend": " ".join(trend_parts),
        "operational_remark": (
            f"Revenue collected during the report period reached {total_amount:.2f}. "
            f"The branch should prioritize {most_used_service or 'its busiest service line'} during peak demand windows."
        ),
        "historical_change": (
            f"Compared with the previous period, client volume changed by {clients_delta}, "
            f"completed transactions changed by {transactions_delta}, and collections changed by {revenue_delta:.2f}."
        ),
    }


def build_excel_export(report: Report, metrics: Dict[str, Any]) -> bytes:
    report_period = f"{report.date_from or 'N/A'} to {report.date_to or 'N/A'}"
    rows_xml: List[str] = []
    rows_xml.append(
        '<Row ss:Height="24">'
        f'<Cell ss:MergeAcross="3" ss:StyleID="reportTitle"><Data ss:Type="String">{escape(report.title)}</Data></Cell>'
        "</Row>"
    )
    rows_xml.append(
        '<Row>'
        f'<Cell ss:StyleID="metaLabel"><Data ss:Type="String">Branch</Data></Cell>'
        f'<Cell ss:StyleID="metaValue"><Data ss:Type="String">{escape(report.branch or "All Branches")}</Data></Cell>'
        f'<Cell ss:StyleID="metaLabel"><Data ss:Type="String">Reporting Period</Data></Cell>'
        f'<Cell ss:StyleID="metaValue"><Data ss:Type="String">{escape(report_period)}</Data></Cell>'
        "</Row>"
    )
    rows_xml.append(
        '<Row>'
        f'<Cell ss:StyleID="metaLabel"><Data ss:Type="String">Generated</Data></Cell>'
        f'<Cell ss:StyleID="metaValue"><Data ss:Type="String">{escape(report.created_at.isoformat() if report.created_at else "N/A")}</Data></Cell>'
        f'<Cell ss:StyleID="metaLabel"><Data ss:Type="String">Export Format</Data></Cell>'
        '<Cell ss:StyleID="metaValue"><Data ss:Type="String">Excel</Data></Cell>'
        "</Row>"
    )
    rows_xml.append('<Row ss:Height="10"></Row>')

    for title, rows in build_export_sections(report, metrics):
        rows_xml.append(
            '<Row ss:Height="22">'
            f'<Cell ss:MergeAcross="3" ss:StyleID="sectionTitle"><Data ss:Type="String">{escape(title)}</Data></Cell>'
            '</Row>'
        )
        if is_tabular_export_section(title):
            for row_index, row in enumerate(rows):
                style = "tableHeader" if row_index == 0 else "tableCell"
                cell_xml = "".join(
                    f'<Cell ss:StyleID="{style}"><Data ss:Type="String">{escape(format_export_value(cell))}</Data></Cell>'
                    for cell in row
                )
                rows_xml.append(f'<Row>{cell_xml}</Row>')
        else:
            for row in rows:
                value = format_export_value(row[1]) if len(row) > 1 else ""
                rows_xml.append(
                    '<Row>'
                    f'<Cell ss:StyleID="labelCell"><Data ss:Type="String">{escape(format_export_value(row[0]))}</Data></Cell>'
                    f'<Cell ss:MergeAcross="2" ss:StyleID="valueCell"><Data ss:Type="String">{escape(value)}</Data></Cell>'
                    '</Row>'
                )
        rows_xml.append('<Row ss:Height="8"></Row>')

    workbook = f"""<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="reportTitle">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Font ss:Bold="1" ss:Size="14" ss:Color="#0F2F5F"/>
  </Style>
  <Style ss:ID="sectionTitle">
   <Alignment ss:Vertical="Center"/>
   <Font ss:Bold="1" ss:Size="11" ss:Color="#0F2F5F"/>
   <Interior ss:Color="#EAF1FB" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
   </Borders>
  </Style>
  <Style ss:ID="metaLabel">
   <Font ss:Bold="1" ss:Color="#475569"/>
  </Style>
  <Style ss:ID="metaValue">
   <Font ss:Color="#111827"/>
  </Style>
  <Style ss:ID="labelCell">
   <Font ss:Bold="1" ss:Color="#334155"/>
   <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
  </Style>
  <Style ss:ID="valueCell">
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
  </Style>
  <Style ss:ID="tableHeader">
   <Font ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#0F2F5F" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
  </Style>
  <Style ss:ID="tableCell">
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
  </Style>
 </Styles>
 <Worksheet ss:Name="Branch Report">
  <Table>
   <Column ss:Width="190"/>
   <Column ss:Width="165"/>
   <Column ss:Width="165"/>
   <Column ss:Width="165"/>
   {''.join(rows_xml)}
  </Table>
 </Worksheet>
</Workbook>"""
    return workbook.encode("utf-8")


def escape_pdf_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_pdf_export(report: Report, metrics: Dict[str, Any]) -> bytes:
    page_width = 612
    page_height = 792
    margin_x = 50
    top_y = 780
    bottom_y = 55
    line_gap = 14
    pages: List[List[str]] = []
    current_page: List[str] = []
    current_y = top_y

    def start_new_page():
        nonlocal current_page, current_y
        current_page = []
        current_y = top_y

    def close_page():
        nonlocal current_page
        pages.append(current_page)
        current_page = []

    def ensure_space(lines_needed: int = 1):
        nonlocal current_y
        if current_y - (lines_needed * line_gap) < bottom_y:
            close_page()
            start_new_page()

    def add_text(x: int, y: int, text: str, font: str = "F1", size: int = 10):
        current_page.append(f"BT /{font} {size} Tf 1 0 0 1 {x} {y} Tm ({escape_pdf_text(text)}) Tj ET")

    def add_wrapped_line(label: str, value: str, indent: int = 0):
        nonlocal current_y
        prefix = f"{label}: " if label else ""
        wrapped = wrap(f"{prefix}{value}", width=92 - indent) or [""]
        for line in wrapped:
            ensure_space()
            add_text(margin_x + indent, current_y, line, "F1", 10)
            current_y -= line_gap

    start_new_page()

    add_text(margin_x, current_y, report.title, "F2", 16)
    current_y -= 22
    add_text(
        margin_x,
        current_y,
        f"Branch: {report.branch}    Report Type: {report.report_type}    Period: {report.date_from or 'N/A'} to {report.date_to or 'N/A'}",
        "F1",
        10,
    )
    current_y -= 20

    for title, rows in build_export_sections(report, metrics):
        ensure_space(2)
        add_text(margin_x, current_y, title, "F2", 12)
        current_y -= 16

        if is_tabular_export_section(title):
            for row_index, row in enumerate(rows):
                row_text = " | ".join(format_export_value(cell) for cell in row)
                wrapped = wrap(row_text, width=94) or [""]
                for wrapped_index, line in enumerate(wrapped):
                    ensure_space()
                    add_text(margin_x, current_y, line, "F2" if row_index == 0 and wrapped_index == 0 else "F1", 10)
                    current_y -= line_gap
        else:
            for row in rows:
                label = format_export_value(row[0]) if row else ""
                value = format_export_value(row[1]) if len(row) > 1 else ""
                add_wrapped_line(label, value)

        current_y -= 8

    if current_page:
        close_page()

    objects: List[bytes] = []
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    page_object_numbers = [3 + index * 2 for index in range(len(pages))]
    content_object_numbers = [4 + index * 2 for index in range(len(pages))]
    kids = " ".join(f"{number} 0 R" for number in page_object_numbers)
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>".encode("utf-8"))

    regular_font_object_number = 3 + len(pages) * 2
    bold_font_object_number = regular_font_object_number + 1

    for page_index, page_commands in enumerate(pages):
        content_stream = "\n".join(page_commands).encode("utf-8")
        page_number = page_index + 1
        footer_command = (
            f"BT /F1 9 Tf 1 0 0 1 {page_width - 110} 30 Tm (Page {page_number} of {len(pages)}) Tj ET"
        ).encode("utf-8")
        if content_stream:
            content_stream += b"\n" + footer_command
        else:
            content_stream = footer_command

        content_object_number = content_object_numbers[page_index]
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {page_width} {page_height}] /Resources << /Font << /F1 {regular_font_object_number} 0 R /F2 {bold_font_object_number} 0 R >> >> /Contents {content_object_number} 0 R >>".encode(
                "utf-8"
            )
        )
        objects.append(
            b"<< /Length "
            + str(len(content_stream)).encode("utf-8")
            + b" >>\nstream\n"
            + content_stream
            + b"\nendstream"
        )

    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")

    pdf = BytesIO()
    pdf.write(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(pdf.tell())
        pdf.write(f"{index} 0 obj\n".encode("utf-8"))
        pdf.write(obj)
        pdf.write(b"\nendobj\n")

    xref_position = pdf.tell()
    pdf.write(f"xref\n0 {len(objects) + 1}\n".encode("utf-8"))
    pdf.write(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.write(f"{offset:010d} 00000 n \n".encode("utf-8"))
    pdf.write(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_position}\n%%EOF".encode(
            "utf-8"
        )
    )
    return pdf.getvalue()


def parse_report_date_range(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None
) -> tuple[datetime, datetime, str, str]:
    """Build an inclusive report date range from stored/requested date strings."""
    try:
        parsed_start = datetime.fromisoformat(date_from) if date_from else None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail='Invalid "Date From" value.') from exc

    try:
        parsed_end = datetime.fromisoformat(date_to) if date_to else None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail='Invalid "Date To" value.') from exc

    if parsed_start and parsed_end and parsed_end.date() < parsed_start.date():
        raise HTTPException(
            status_code=400,
            detail='Invalid date range. "Date To" must be the same as or later than "Date From".',
        )

    start_date = parsed_start or (datetime.utcnow() - timedelta(days=30))

    if parsed_end:
        if "T" not in date_to and parsed_end.time() == time.min:
            end_date = datetime.combine(parsed_end.date(), time.max)
        else:
            end_date = parsed_end
    else:
        end_date = datetime.utcnow()

    normalized_date_from = start_date.date().isoformat()
    normalized_date_to = end_date.date().isoformat()

    return start_date, end_date, normalized_date_from, normalized_date_to


def validate_report_filter_date_range(date_from: Optional[str], date_to: Optional[str]) -> None:
    if date_from:
        try:
            datetime.fromisoformat(date_from)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail='Invalid "Date From" value.') from exc

    if date_to:
        try:
            datetime.fromisoformat(date_to)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail='Invalid "Date To" value.') from exc

    if date_from and date_to:
        parse_report_date_range(date_from, date_to)


def build_scheduled_report_request(settings: Dict[str, Any], *, now: datetime) -> ReportGenerateRequest:
    frequency = settings.get("frequency", "daily")
    if frequency == "daily":
        start_date = now.date()
        report_type = settings.get("reportType") or "Daily"
    elif frequency == "weekly":
        start_date = (now - timedelta(days=6)).date()
        report_type = settings.get("reportType") or "Weekly"
    else:
        start_date = now.replace(day=1).date()
        report_type = settings.get("reportType") or "Monthly"

    return ReportGenerateRequest(
        reportType=report_type,
        dateFrom=start_date.isoformat(),
        dateTo=now.date().isoformat(),
        service_type=settings.get("service_type") or "All Services",
        transaction_category=settings.get("transaction_category") or "All Categories",
    )


def should_dispatch_automatic_report(settings: Dict[str, Any], now: datetime) -> bool:
    if not settings.get("enabled"):
        return False

    dispatch_time = datetime.strptime(settings.get("dispatch_time", "17:00"), "%H:%M").time()
    if now.time() < dispatch_time:
        return False

    last_sent_at_raw = settings.get("last_sent_at")
    last_sent_at = datetime.fromisoformat(last_sent_at_raw) if last_sent_at_raw else None
    if last_sent_at and last_sent_at.date() == now.date():
        return False

    frequency = settings.get("frequency", "daily")
    if frequency == "weekly":
        return now.weekday() == int(settings.get("weekday", 0))
    if frequency == "monthly":
        return now.day == int(settings.get("month_day", 1))
    return True


def dispatch_due_automatic_branch_report(
    db: Session,
    *,
    current_staff,
) -> Dict[str, Any] | None:
    branch = db.query(Branch).filter(Branch.id == current_staff.branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Assigned branch not found.")

    settings = get_branch_report_automation_settings(db, branch.id)
    now = get_branch_report_now()
    if not should_dispatch_automatic_report(settings, now):
        return None

    report_request = build_scheduled_report_request(settings, now=now)
    result = create_branch_report_entry(
        db=db,
        request=report_request,
        branch_id=branch.id,
        branch_name=get_branch_display_name(branch),
        actor_username=current_staff.username,
        dispatch_mode="automatic",
    )

    settings["last_sent_at"] = now.isoformat()
    save_branch_report_automation_settings(
        db,
        branch=branch,
        payload=settings,
        updated_by=current_staff.username,
    )
    return result

@router.post("/generate")
@limiter.limit("10/minute")
async def generate_report(
    request: Request,
    payload: ReportGenerateRequest,
    current_user = Depends(get_current_admin_user),
):
    raise HTTPException(
        status_code=403,
        detail="Report generation is available from the Branch Reports module only.",
    )


@branch_router.post("/generate")
async def generate_branch_report(
    request: ReportGenerateRequest,
    db: Session = Depends(get_db),
    current_staff = Depends(require_any_branch_staff()),
):
    validate_report_request(request)

    branch_id, branch_name = resolve_branch_selection(
        db,
        request.branch_id,
        enforced_branch_id=current_staff.branch_id,
    )

    return create_branch_report_entry(
        db=db,
        request=request,
        branch_id=branch_id,
        branch_name=branch_name,
        actor_username=current_staff.username,
        dispatch_mode="manual",
    )


@branch_router.get("/automation")
async def get_branch_report_automation(
    db: Session = Depends(get_db),
    current_staff = Depends(get_current_branch_staff),
):
    return get_branch_report_automation_settings(db, current_staff.branch_id)


@branch_router.put("/automation")
async def update_branch_report_automation(
    payload: ReportAutomationSettingsPayload,
    db: Session = Depends(get_db),
    current_staff = Depends(get_current_branch_staff),
):
    branch = db.query(Branch).filter(Branch.id == current_staff.branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Assigned branch not found.")
    return save_branch_report_automation_settings(
        db,
        branch=branch,
        payload=payload.model_dump(),
        updated_by=current_staff.username,
    )

def calculate_report_metrics_sync(
    db: Session,
    branch_id: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    service_type: Optional[str] = None,
    transaction_category: Optional[str] = None
) -> Dict[str, Any]:
    """Calculate comprehensive operational metrics for the report"""

    # Parse dates using an inclusive end-of-day range for date-only inputs
    start_date, end_date, normalized_date_from, normalized_date_to = parse_report_date_range(date_from, date_to)
    normalized_service_type = normalize_service_type(service_type)
    normalized_transaction_category = normalize_transaction_category(transaction_category)
    is_document_request_report = is_document_request_service(normalized_service_type)
    is_receipt_fee_report = is_receipt_request_fee_category(normalized_transaction_category)
    include_receipts_in_scope = (
        normalized_service_type is None
        or is_document_request_report
        or is_receipt_fee_report
    )

    branch = db.query(Branch).filter(Branch.id == branch_id).first() if branch_id else None

    queue_records = [] if is_document_request_report else collect_queue_records(
        db,
        branch_id=branch_id,
        start_date=start_date,
        end_date=end_date,
        service_type=normalized_service_type,
    )

    payment_query = db.query(Payment).filter(Payment.created_at.between(start_date, end_date))
    if branch:
        payment_query = payment_query.filter(build_payment_branch_filter(branch))
    if normalized_transaction_category:
        if is_receipt_fee_report:
            payment_query = payment_query.filter(False)
        else:
            payment_query = payment_query.filter(hash_aware_match(Payment, "tax_type", normalized_transaction_category))
    payments = payment_query.all()

    receipt_records = collect_receipt_records(
        db,
        branch_id=branch_id,
        start_date=start_date,
        end_date=end_date,
        service_type=normalized_service_type,
        include_receipts_in_scope=include_receipts_in_scope,
    )
    operational_activities = collect_queue_activity_records(
        db,
        branch_id=branch_id,
        start_date=start_date,
        end_date=end_date,
        service_type=normalized_service_type,
    )

    # Calculate clients served metrics
    if is_document_request_report:
        total_clients = len(receipt_records)
        clients_completed = len([r for r in receipt_records if is_completed_receipt_request(receipt_record_value(r, "status"))])
        clients_waiting = len([r for r in receipt_records if is_pending_receipt_request(receipt_record_value(r, "status"))])
        clients_serving = 0
    else:
        total_clients = len(queue_records)
        clients_completed = len([q for q in queue_records if (queue_record_value(q, "status") or "").lower() == "completed"])
        clients_waiting = len([q for q in queue_records if (queue_record_value(q, "status") or "").lower() == "waiting"])
        clients_serving = len([q for q in queue_records if (queue_record_value(q, "status") or "").lower() == "serving"])

    wait_times = []
    service_times = []
    if not is_document_request_report:
        for queue in queue_records:
            created_at = queue_record_datetime(queue, "created_at")
            served_at = queue_record_datetime(queue, "served_at")
            completed_at = queue_record_datetime(queue, "completed_at")
            estimated_wait_time = getattr(queue, "estimated_wait_time", None)

            if created_at and served_at and served_at >= created_at:
                wait_times.append((served_at - created_at).total_seconds() / 60)
            elif estimated_wait_time is not None:
                wait_times.append(float(estimated_wait_time))

            if served_at and completed_at and completed_at >= served_at:
                service_times.append((completed_at - served_at).total_seconds() / 60)

    # Calculate transaction volumes
    if is_document_request_report or is_receipt_fee_report:
        total_transactions = len(receipt_records)
        verified_transactions = len([r for r in receipt_records if bool(getattr(r, "fee_paid", False))])
        pending_transactions = len([r for r in receipt_records if not getattr(r, "fee_paid", False) and is_pending_receipt_request(receipt_record_value(r, "status"))])
        failed_transactions = 0
        total_amount = sum(get_receipt_request_amount(receipt) for receipt in receipt_records if getattr(receipt, "fee_paid", False))
    else:
        receipt_verified_transactions = len([r for r in receipt_records if bool(getattr(r, "fee_paid", False))]) if include_receipts_in_scope else 0
        receipt_pending_transactions = len([r for r in receipt_records if not getattr(r, "fee_paid", False) and is_pending_receipt_request(receipt_record_value(r, "status"))]) if include_receipts_in_scope else 0
        total_transactions = len(payments) + (len(receipt_records) if include_receipts_in_scope else 0)
        verified_transactions = len([p for p in payments if is_completed_payment(payment_value(p, "status"))]) + receipt_verified_transactions
        pending_transactions = len([p for p in payments if is_pending_payment(payment_value(p, "status"))]) + receipt_pending_transactions
        failed_transactions = len([p for p in payments if is_failed_payment(payment_value(p, "status"))])
        total_amount = (
            sum((p.amount or 0) for p in payments if is_completed_payment(payment_value(p, "status")))
            + (sum(get_receipt_request_amount(receipt) for receipt in receipt_records if getattr(receipt, "fee_paid", False)) if include_receipts_in_scope else 0)
        )

    # Calculate service utilization by type
    service_breakdown = {}
    if is_document_request_report:
        if receipt_records:
            service_breakdown[DOCUMENT_REQUEST_SERVICE] = {
                "count": len(receipt_records),
                "completed": len([r for r in receipt_records if is_completed_receipt_request(receipt_record_value(r, "status"))]),
            }
    else:
        for queue in queue_records:
            service = queue_record_value(queue, "service_type") or "Unknown"
            # Exclude cedula services
            if service and "cedula" in service.lower():
                continue
            if service not in service_breakdown:
                service_breakdown[service] = {"count": 0, "completed": 0}
            service_breakdown[service]["count"] += 1
            if (queue_record_value(queue, "status") or "").lower() == "completed":
                service_breakdown[service]["completed"] += 1

    # Calculate transaction category breakdown
    category_breakdown = {}
    if is_document_request_report or is_receipt_fee_report:
        if receipt_records:
            category_breakdown[RECEIPT_REQUEST_FEE_CATEGORY] = {
                "count": len(receipt_records),
                "amount": float(total_amount),
            }
    else:
        for payment in payments:
            category = payment_value(payment, "tax_type") or "Unknown"
            # Exclude cedula transactions
            if category and "cedula" in category.lower():
                continue
            if category not in category_breakdown:
                category_breakdown[category] = {"count": 0, "amount": 0}
            category_breakdown[category]["count"] += 1
            if is_completed_payment(payment_value(payment, "status")):
                category_breakdown[category]["amount"] += payment.amount or 0
        if include_receipts_in_scope and receipt_records:
            category_breakdown[RECEIPT_REQUEST_FEE_CATEGORY] = {
                "count": len(receipt_records),
                "amount": float(sum(get_receipt_request_amount(receipt) for receipt in receipt_records if getattr(receipt, "fee_paid", False))),
            }

    # Calculate receipt request metrics
    total_receipt_requests = len(receipt_records)
    completed_receipts = len([r for r in receipt_records if is_completed_receipt_request(receipt_record_value(r, "status"))])
    pending_receipts = len([r for r in receipt_records if is_pending_receipt_request(receipt_record_value(r, "status"))])
    receipt_status_breakdown: Dict[str, int] = {}
    receipt_type_breakdown = {"Immediate": 0, "Appointment": 0}
    for receipt in receipt_records:
        status_label = normalize_receipt_request_status(receipt_record_value(receipt, "status"))
        receipt_status_breakdown[status_label] = receipt_status_breakdown.get(status_label, 0) + 1

        type_label = normalize_receipt_request_type(receipt_record_value(receipt, "request_type"))
        if type_label.lower() == "appointment":
            receipt_type_breakdown["Appointment"] += 1
        else:
            receipt_type_breakdown["Immediate"] += 1

    # Calculate daily averages
    days_in_period = max((end_date.date() - start_date.date()).days + 1, 1)
    avg_clients_per_day = total_clients / days_in_period
    avg_transactions_per_day = total_transactions / days_in_period

    # Calculate peak operating hours
    peak_hours = calculate_peak_hours(receipt_records if is_document_request_report else queue_records)

    # Calculate peak days
    peak_days = calculate_peak_days(receipt_records if is_document_request_report else queue_records)

    # Calculate operational problems by branch
    operational_problems = calculate_operational_problems(db, branch_id, start_date, end_date)
    operational_statistics = calculate_operational_statistics(operational_activities)

    # Get branch-specific data if filtering by branch
    branch_data = None
    if branch:
        branch_data = {
            "id": branch.id,
            "name": get_branch_display_name(branch),
            "location": branch.location,
            "counters": branch.counters,
            "status": branch.status
        }

    historical_comparison = calculate_historical_comparison(
        db=db,
        branch_id=branch_id,
        start_date=start_date,
        end_date=end_date,
        service_type=normalized_service_type,
        transaction_category=normalized_transaction_category,
        current_clients=total_clients,
        current_completed_transactions=verified_transactions,
        current_total_amount=float(total_amount),
        current_receipt_requests=total_receipt_requests,
    )
    detailed_rows = build_detailed_report_rows(
        queue_records,
        payments,
        receipt_records,
        include_queue_rows=not is_document_request_report,
        include_payment_rows=not (is_document_request_report or is_receipt_fee_report),
        include_receipt_rows=include_receipts_in_scope,
    )
    daily_trend = build_daily_trend(
        queue_records,
        payments,
        receipt_records,
        start_date,
        end_date,
        use_receipts_for_clients=is_document_request_report,
        use_receipts_for_transactions=(is_document_request_report or is_receipt_fee_report),
        include_receipt_transactions_in_totals=(include_receipts_in_scope and not (is_document_request_report or is_receipt_fee_report)),
    )
    insights = build_report_insights(
        service_breakdown=service_breakdown,
        category_breakdown=category_breakdown,
        peak_hours=peak_hours,
        peak_days=peak_days,
        historical_comparison=historical_comparison,
        total_amount=float(total_amount),
    )
    most_used_service = insights.get("most_used_service")
    receipt_transaction_summary = [
        {
            "label": "Verified Transactions",
            "count": verified_transactions,
            "amount": float(total_amount),
            "status": "Verified",
        },
        {
            "label": "Pending Transactions",
            "count": pending_transactions,
            "amount": 0.0,
            "status": "Pending",
        },
        {
            "label": "Declined / Failed Transactions",
            "count": failed_transactions,
            "amount": 0.0,
            "status": "Declined",
        },
        {
            "label": "Receipt Requests Ready for Release",
            "count": receipt_status_breakdown.get("Ready for Release", 0),
            "amount": 0.0,
            "status": "Ready for Release",
        },
        {
            "label": "Receipt Requests Released / Completed",
            "count": completed_receipts,
            "amount": 0.0,
            "status": "Released",
        },
    ]

    return {
        "summary": {
            "total_clients_served": total_clients,
            "clients_completed": clients_completed,
            "clients_waiting": clients_waiting,
            "clients_serving": clients_serving,
            "completion_rate": round((clients_completed / total_clients * 100) if total_clients > 0 else 0, 2),
            "avg_wait_time": average_duration_minutes(wait_times),
            "avg_service_time": average_duration_minutes(service_times),
            "most_used_service": most_used_service,
        },
        "transactions": {
            "total_transactions": total_transactions,
            "verified_transactions": verified_transactions,
            "completed_transactions": verified_transactions,
            "pending_transactions": pending_transactions,
            "failed_transactions": failed_transactions,
            "cancelled_failed_transactions": failed_transactions,
            "total_amount": float(total_amount),
            "average_transaction_value": float(total_amount / verified_transactions) if verified_transactions > 0 else 0
        },
        "service_utilization": service_breakdown,
        "transaction_categories": category_breakdown,
        "receipt_requests": {
            "total_requests": total_receipt_requests,
            "completed_requests": completed_receipts,
            "pending_requests": pending_receipts,
            "by_status": receipt_status_breakdown,
            "by_type": receipt_type_breakdown,
        },
        "receipt_transaction_summary": receipt_transaction_summary,
        "daily_averages": {
            "clients_per_day": round(avg_clients_per_day, 2),
            "transactions_per_day": round(avg_transactions_per_day, 2)
        },
        "historical_comparison": historical_comparison,
        "period": {
            "date_from": normalized_date_from,
            "date_to": normalized_date_to
        },
        "daily_trend": daily_trend,
        "detailed_rows": detailed_rows,
        "insights": insights,
        "branch": branch_data,
        "operational_statistics": operational_statistics,
        "peak_hours": peak_hours,
        "peak_operating_hours": peak_hours,
        "peak_days": peak_days,
        "operational_problems": operational_problems
    }

def calculate_peak_hours(queues: List[Any]) -> Dict[str, Any]:
    """Calculate peak operating hours based on queue activity"""
    hour_counts = Counter()
    
    for queue in queues:
        created_at = queue_record_datetime(queue, "created_at") if isinstance(queue, (Queue, QueueHistory)) else receipt_record_datetime(queue, "created_at")
        if created_at:
            hour = created_at.hour
            hour_counts[hour] += 1
    
    if not hour_counts:
        return {
            "peak_hour": None,
            "peak_hour_count": 0,
            "hourly_distribution": {}
        }
    
    peak_hour = hour_counts.most_common(1)[0][0]
    peak_count = hour_counts[peak_hour]
    
    # Format hours as readable time ranges
    hourly_dist = {}
    for hour, count in sorted(hour_counts.items()):
        time_range = f"{hour:02d}:00-{hour:02d}:59"
        hourly_dist[time_range] = count
    
    return {
        "peak_hour": f"{peak_hour:02d}:00-{peak_hour:02d}:59",
        "peak_count": peak_count,
        "peak_hour_count": peak_count,
        "hourly_distribution": hourly_dist
    }

def calculate_peak_days(queues: List[Any]) -> Dict[str, Any]:
    """Calculate peak days based on queue activity"""
    day_counts = Counter()
    weekday_counts = Counter()
    
    for queue in queues:
        created_at = queue_record_datetime(queue, "created_at") if isinstance(queue, (Queue, QueueHistory)) else receipt_record_datetime(queue, "created_at")
        if created_at:
            date_str = created_at.strftime('%Y-%m-%d')
            day_counts[date_str] += 1

            weekday = created_at.strftime('%A')
            weekday_counts[weekday] += 1
    
    if not day_counts:
        return {
            "peak_date": None,
            "peak_date_count": 0,
            "peak_weekday": None,
            "weekday_distribution": {}
        }
    
    peak_date = day_counts.most_common(1)[0][0]
    peak_date_count = day_counts[peak_date]
    
    peak_weekday = weekday_counts.most_common(1)[0][0] if weekday_counts else None
    peak_weekday_count = weekday_counts[peak_weekday] if peak_weekday else 0
    
    return {
        "peak_date": peak_date,
        "peak_date_count": peak_date_count,
        "peak_weekday": peak_weekday,
        "peak_count": peak_weekday_count,
        "weekday_distribution": dict(weekday_counts)
    }


def calculate_historical_comparison(
    *,
    db: Session,
    branch_id: Optional[int],
    start_date: datetime,
    end_date: datetime,
    service_type: Optional[str],
    transaction_category: Optional[str],
    current_clients: int,
    current_completed_transactions: int,
    current_total_amount: float,
    current_receipt_requests: int,
) -> Dict[str, Any]:
    period_days = max((end_date.date() - start_date.date()).days + 1, 1)
    previous_end = start_date - timedelta(seconds=1)
    previous_start = previous_end - timedelta(days=period_days - 1)
    is_document_request_report = is_document_request_service(service_type)
    is_receipt_fee_report = is_receipt_request_fee_category(transaction_category)
    include_receipts_in_scope = service_type is None or is_document_request_report or is_receipt_fee_report

    payment_query = db.query(Payment).filter(Payment.created_at.between(previous_start, previous_end))
    branch = db.query(Branch).filter(Branch.id == branch_id).first() if branch_id else None
    if branch:
        payment_query = payment_query.filter(build_payment_branch_filter(branch))

    if transaction_category:
        if is_receipt_fee_report:
            payment_query = payment_query.filter(False)
        else:
            payment_query = payment_query.filter(hash_aware_match(Payment, "tax_type", transaction_category))

    previous_queues = [] if is_document_request_report else collect_queue_records(
        db,
        branch_id=branch_id,
        start_date=previous_start,
        end_date=previous_end,
        service_type=service_type,
    )
    previous_payments = payment_query.all()
    previous_receipts = collect_receipt_records(
        db,
        branch_id=branch_id,
        start_date=previous_start,
        end_date=previous_end,
        service_type=service_type,
        include_receipts_in_scope=include_receipts_in_scope,
    )

    previous_clients = (
        len(previous_receipts)
        if is_document_request_report
        else len(previous_queues)
    )
    if is_document_request_report or is_receipt_fee_report:
        previous_completed_transactions = len([receipt for receipt in previous_receipts if getattr(receipt, "fee_paid", False)])
        previous_total_amount = float(sum(get_receipt_request_amount(receipt) for receipt in previous_receipts if getattr(receipt, "fee_paid", False)))
    else:
        previous_completed_transactions = (
            len([payment for payment in previous_payments if is_completed_payment(payment_value(payment, "status"))])
            + (len([receipt for receipt in previous_receipts if getattr(receipt, "fee_paid", False)]) if include_receipts_in_scope else 0)
        )
        previous_total_amount = float(
            sum((payment.amount or 0) for payment in previous_payments if is_completed_payment(payment_value(payment, "status")))
            + (
                sum(get_receipt_request_amount(receipt) for receipt in previous_receipts if getattr(receipt, "fee_paid", False))
                if include_receipts_in_scope
                else 0
            )
        )
    previous_receipt_requests = len(previous_receipts)

    def delta(current_value: float, previous_value: float) -> float:
        return round(current_value - previous_value, 2)

    return {
        "current_period": {
            "date_from": start_date.date().isoformat(),
            "date_to": end_date.date().isoformat(),
        },
        "previous_period": {
            "date_from": previous_start.date().isoformat(),
            "date_to": previous_end.date().isoformat(),
        },
        "clients_served": {
            "current": current_clients,
            "previous": previous_clients,
            "delta": delta(current_clients, previous_clients),
        },
        "completed_transactions": {
            "current": current_completed_transactions,
            "previous": previous_completed_transactions,
            "delta": delta(current_completed_transactions, previous_completed_transactions),
        },
        "total_amount": {
            "current": round(current_total_amount, 2),
            "previous": round(previous_total_amount, 2),
            "delta": delta(current_total_amount, previous_total_amount),
        },
        "receipt_requests": {
            "current": current_receipt_requests,
            "previous": previous_receipt_requests,
            "delta": delta(current_receipt_requests, previous_receipt_requests),
        },
    }

def calculate_operational_problems(
    db: Session,
    branch_id: Optional[int] = None,
    start_date: datetime = None,
    end_date: datetime = None
) -> Dict[str, Any]:
    """Calculate operational problems by branch and severity"""
    
    # Query discrepancy reports as operational problems
    query = db.query(DiscrepancyReport)
    
    if start_date and end_date:
        query = query.filter(DiscrepancyReport.created_at.between(start_date, end_date))
    
    if branch_id:
        query = query.filter(DiscrepancyReport.branch_id == branch_id)
    
    discrepancies = query.all()
    
    # Categorize by branch and severity
    branch_problems = {}
    severity_mapping = {
        'Payment Discrepancy': 'Critical',
        'Transaction Mismatch': 'Critical',
        'Receipt Issue': 'Medium',
        'System Error': 'Critical',
        'Data Entry Error': 'Low',
        'Other': 'Low'
    }
    
    for disc in discrepancies:
        branch = db.query(Branch).filter(Branch.id == disc.branch_id).first()
        if not branch:
            continue
        
        branch_name = get_branch_display_name(branch)
        if branch_name not in branch_problems:
            branch_problems[branch_name] = {
                'branch_id': branch.id,
                'total_problems': 0,
                'low': 0,
                'medium': 0,
                'critical': 0,
                'pending': 0,
                'resolved': 0
            }
        
        branch_problems[branch_name]['total_problems'] += 1
        
        # Determine severity
        severity = severity_mapping.get(disc.discrepancy_type, 'Low')
        if severity == 'Critical':
            branch_problems[branch_name]['critical'] += 1
        elif severity == 'Medium':
            branch_problems[branch_name]['medium'] += 1
        else:
            branch_problems[branch_name]['low'] += 1
        
        # Track status
        if disc.status in ['Pending Review', 'Under Investigation']:
            branch_problems[branch_name]['pending'] += 1
        elif disc.status in ['Verified', 'Resolved']:
            branch_problems[branch_name]['resolved'] += 1
    
    # Find branch with most problems
    most_problematic_branch = None
    max_problems = 0
    
    for branch_name, data in branch_problems.items():
        if data['total_problems'] > max_problems:
            max_problems = data['total_problems']
            most_problematic_branch = {
                'branch_name': branch_name,
                'branch_id': data['branch_id'],
                'total_problems': data['total_problems'],
                'critical': data['critical'],
                'medium': data['medium'],
                'low': data['low'],
                'pending': data['pending'],
                'resolved': data['resolved']
            }
    
    return {
        'by_branch': branch_problems,
        'most_problematic_branch': most_problematic_branch,
        'total_problems': sum(data['total_problems'] for data in branch_problems.values()),
        'total_critical': sum(data['critical'] for data in branch_problems.values()),
        'total_medium': sum(data['medium'] for data in branch_problems.values()),
        'total_low': sum(data['low'] for data in branch_problems.values())
    }

@router.get("/")
async def get_all_reports(
    page: int = Query(1, ge=1),
    page_size: int = Query(DEFAULT_REPORT_PAGE_SIZE, ge=1, le=MAX_REPORT_PAGE_SIZE),
    search: Optional[str] = Query(None),
    branch: Optional[str] = Query(None),
    service_type: Optional[str] = Query(None),
    transaction_category: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user = Depends(get_current_admin_user)
):
    require_permission("view_all_branches")(current_user)
    query = db.query(Report)
    validate_report_filter_date_range(date_from, date_to)

    if search:
        term = f"%{search.strip()}%"
        query = query.filter(
            Report.title.ilike(term) |
            Report.branch.ilike(term) |
            Report.generated_by.ilike(term)
        )

    if branch:
        query = query.filter(Report.branch == branch)
    if service_type and service_type.strip():
        query = query.filter(Report.service_type == service_type.strip())
    if transaction_category and transaction_category.strip():
        query = query.filter(Report.transaction_category == transaction_category.strip())
    if date_from:
        query = query.filter(Report.created_at >= datetime.fromisoformat(date_from))
    if date_to:
        query = query.filter(Report.created_at < datetime.fromisoformat(date_to) + timedelta(days=1))

    return build_report_history_response(query, page=page, page_size=page_size)


@branch_router.get("/")
async def get_branch_reports(
    page: int = Query(1, ge=1),
    page_size: int = Query(DEFAULT_REPORT_PAGE_SIZE, ge=1, le=MAX_REPORT_PAGE_SIZE),
    search: Optional[str] = Query(None),
    service_type: Optional[str] = Query(None),
    transaction_category: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_staff = Depends(get_current_branch_staff),
):
    dispatch_due_automatic_branch_report(db, current_staff=current_staff)
    query = db.query(Report).filter(Report.branch_id == current_staff.branch_id)
    validate_report_filter_date_range(date_from, date_to)

    if search:
        term = f"%{search.strip()}%"
        query = query.filter(
            Report.title.ilike(term) |
            Report.report_type.ilike(term) |
            Report.generated_by.ilike(term)
        )
    if service_type and service_type.strip():
        query = query.filter(Report.service_type == service_type.strip())
    if transaction_category and transaction_category.strip():
        query = query.filter(Report.transaction_category == transaction_category.strip())
    if date_from:
        query = query.filter(Report.created_at >= datetime.fromisoformat(date_from))
    if date_to:
        query = query.filter(Report.created_at < datetime.fromisoformat(date_to) + timedelta(days=1))

    return build_report_history_response(query, page=page, page_size=page_size)

@router.get("/history")
async def get_report_history(
    page: int = Query(1, ge=1),
    page_size: int = Query(DEFAULT_REPORT_PAGE_SIZE, ge=1, le=MAX_REPORT_PAGE_SIZE),
    db: Session = Depends(get_db),
    current_user = Depends(get_current_admin_user)
):
    require_permission("view_all_branches")(current_user)
    query = db.query(ReportHistory)
    
    total = query.count()
    total_pages = max(1, (total + page_size - 1) // page_size) if total else 1
    history_items = (
        query.order_by(ReportHistory.deleted_at.desc(), ReportHistory.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    
    return {
        "items": [
            {
                "id": item.id,
                "original_report_id": item.original_report_id,
                "title": item.title,
                "branch_id": item.branch_id,
                "branch": item.branch,
                "report_type": item.report_type,
                "service_type": item.service_type or "All Services",
                "transaction_category": item.transaction_category or "All Categories",
                "date_from": item.date_from,
                "date_to": item.date_to,
                "generated_by": item.generated_by,
                "submitted_by": item.submitted_by,
                "submitted_at": item.submitted_at.isoformat() if item.submitted_at else None,
                "created_at": item.created_at.isoformat() if item.created_at else None,
                "deleted_at": item.deleted_at.isoformat() if item.deleted_at else None,
                "deleted_by": item.deleted_by,
                "status": item.status,
            }
            for item in history_items
        ],
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
    }

@router.get("/{report_id}")
async def get_report_details(
    report_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_admin_user)
):
    """Get detailed report data for a specific report
    
    Note: Metrics are ALWAYS recalculated fresh from the database to ensure
    administrators see current and accurate data, not cached values.
    """
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    branch_id = get_report_branch_id(db, report)
    
    # Recalculate metrics fresh from database for current, accurate data
    metrics = calculate_report_metrics_sync(
        db=db,
        branch_id=branch_id,
        date_from=report.date_from,
        date_to=report.date_to,
        service_type=normalize_service_type(report.service_type),
        transaction_category=report.transaction_category
    )
    
    return {
        "report": serialize_report_summary(report),
        "metrics": metrics
    }


@branch_router.get("/history")
async def get_branch_report_history(
    page: int = Query(1, ge=1),
    page_size: int = Query(DEFAULT_REPORT_PAGE_SIZE, ge=1, le=MAX_REPORT_PAGE_SIZE),
    db: Session = Depends(get_db),
    current_staff = Depends(get_current_branch_staff),
):
    query = db.query(ReportHistory).filter(ReportHistory.branch_id == current_staff.branch_id)
    
    total = query.count()
    total_pages = max(1, (total + page_size - 1) // page_size) if total else 1
    history_items = (
        query.order_by(ReportHistory.deleted_at.desc(), ReportHistory.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    
    return {
        "items": [
            {
                "id": item.id,
                "original_report_id": item.original_report_id,
                "title": item.title,
                "branch_id": item.branch_id,
                "branch": item.branch,
                "report_type": item.report_type,
                "service_type": item.service_type or "All Services",
                "transaction_category": item.transaction_category or "All Categories",
                "date_from": item.date_from,
                "date_to": item.date_to,
                "generated_by": item.generated_by,
                "submitted_by": item.submitted_by,
                "submitted_at": item.submitted_at.isoformat() if item.submitted_at else None,
                "created_at": item.created_at.isoformat() if item.created_at else None,
                "deleted_at": item.deleted_at.isoformat() if item.deleted_at else None,
                "deleted_by": item.deleted_by,
                "status": item.status,
            }
            for item in history_items
        ],
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
    }


@branch_router.get("/{report_id}/export/{format}")
async def export_branch_report(
    report_id: int,
    format: str,
    db: Session = Depends(get_db),
    current_staff = Depends(get_current_branch_staff),
):
    """Export branch report in PDF or Excel format
    
    Note: Metrics are ALWAYS recalculated fresh from the database to ensure
    exported reports contain current and accurate data.
    """
    report = db.query(Report).filter(
        Report.id == report_id,
        Report.branch_id == current_staff.branch_id,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    if format.lower() not in ["pdf", "excel"]:
        raise HTTPException(status_code=400, detail="Invalid format. Use 'pdf' or 'excel'")
    
    branch_id = get_report_branch_id(db, report)
    
    # Recalculate metrics fresh from database for current, accurate export data
    metrics = calculate_report_metrics_sync(
        db=db,
        branch_id=branch_id,
        date_from=report.date_from,
        date_to=report.date_to,
        service_type=normalize_service_type(report.service_type),
        transaction_category=normalize_transaction_category(report.transaction_category)
    )
    
    base_filename = sanitize_filename(report.title)
    export_format = format.lower()
    filename = f"{base_filename}.pdf" if export_format == "pdf" else f"{base_filename}.xls"
    
    # Log activity
    log = ActivityLog(
        action="Branch Report Exported",
        user=current_staff.username,
        details=f"Exported branch report '{report.title}' as {format.upper()}",
        type="report"
    )
    db.add(log)
    db.commit()
    
    if export_format == "pdf":
        content = build_pdf_export(report, metrics)
        media_type = "application/pdf"
    else:
        content = build_excel_export(report, metrics)
        media_type = "application/vnd.ms-excel"
    
    response = Response(content=content, media_type=media_type)
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@branch_router.get("/{report_id}")
async def get_branch_report_details(
    report_id: int,
    db: Session = Depends(get_db),
    current_staff = Depends(get_current_branch_staff),
):
    report = db.query(Report).filter(
        Report.id == report_id,
        Report.branch_id == current_staff.branch_id,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    branch_id = get_report_branch_id(db, report)
    metrics = calculate_report_metrics_sync(
        db=db,
        branch_id=branch_id,
        date_from=report.date_from,
        date_to=report.date_to,
        service_type=normalize_service_type(report.service_type),
        transaction_category=normalize_transaction_category(report.transaction_category),
    )

    return {
        "report": serialize_report_summary(report),
        "metrics": metrics,
    }

@router.get("/{report_id}/export/{format}")
async def export_report(
    report_id: int, 
    format: str, 
    db: Session = Depends(get_db),
    current_user = Depends(get_current_admin_user)
):
    """Export report in PDF or Excel format
    
    Note: Metrics are ALWAYS recalculated fresh from the database to ensure
    exported reports contain current and accurate data.
    """
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    if format.lower() not in ["pdf", "excel"]:
        raise HTTPException(status_code=400, detail="Invalid format. Use 'pdf' or 'excel'")
    
    branch_id = get_report_branch_id(db, report)
    
    # Recalculate metrics fresh from database for current, accurate export data
    metrics = calculate_report_metrics_sync(
        db=db,
        branch_id=branch_id,
        date_from=report.date_from,
        date_to=report.date_to,
        service_type=normalize_service_type(report.service_type),
        transaction_category=normalize_transaction_category(report.transaction_category)
    )
    
    base_filename = sanitize_filename(report.title)
    export_format = format.lower()
    filename = f"{base_filename}.pdf" if export_format == "pdf" else f"{base_filename}.xls"
    
    # Log activity
    log = ActivityLog(
        action="Report Exported",
        user=current_user.username,
        details=f"Exported report '{report.title}' as {format.upper()}",
        type="report"
    )
    db.add(log)
    db.commit()
    
    if export_format == "pdf":
        content = build_pdf_export(report, metrics)
        media_type = "application/pdf"
    else:
        content = build_excel_export(report, metrics)
        media_type = "application/vnd.ms-excel"

    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/{report_id}")
async def delete_report(
    report_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_admin_user),
):
    require_permission("view_all_branches")(current_user)
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    title = report.title
    
    # Move to ReportHistory instead of permanent deletion
    history_entry = ReportHistory(
        original_report_id=report.id,
        title=report.title,
        branch_id=report.branch_id,
        branch=report.branch,
        report_type=report.report_type,
        service_type=report.service_type,
        transaction_category=report.transaction_category,
        date_from=report.date_from,
        date_to=report.date_to,
        generated_by=report.generated_by,
        submitted_by=report.submitted_by,
        submitted_at=report.submitted_at,
        created_at=report.created_at,
        deleted_at=datetime.utcnow(),
        deleted_by=current_user.username,
        status="Archived"
    )
    db.add(history_entry)
    
    db.add(ActivityLog(
        action="Report Archived",
        user=current_user.username,
        details=f"Archived submitted report '{title}' to Report History",
        type="report",
    ))
    db.delete(report)
    db.commit()
    return {"archived_id": report_id, "title": title}


@router.post("/history/{history_id}/recover")
async def recover_report(
    history_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_admin_user),
):
    require_permission("view_all_branches")(current_user)
    history_entry = db.query(ReportHistory).filter(ReportHistory.id == history_id).first()
    if not history_entry:
        raise HTTPException(status_code=404, detail="Report history entry not found")

    # Check if a report with the same original_id already exists in active reports
    if history_entry.original_report_id:
        existing_report = db.query(Report).filter(Report.id == history_entry.original_report_id).first()
        if existing_report:
            raise HTTPException(status_code=400, detail="A report with this ID already exists in active reports")

    # Create new report from history entry
    recovered_report = Report(
        title=history_entry.title,
        branch_id=history_entry.branch_id,
        branch=history_entry.branch,
        report_type=history_entry.report_type,
        service_type=history_entry.service_type,
        transaction_category=history_entry.transaction_category,
        date_from=history_entry.date_from,
        date_to=history_entry.date_to,
        generated_by=history_entry.generated_by,
        submitted_by=history_entry.submitted_by,
        submitted_at=history_entry.submitted_at,
        created_at=history_entry.created_at,
    )
    db.add(recovered_report)
    db.flush()  # Get the new report ID

    # Delete the history entry after successful recovery
    db.delete(history_entry)

    db.add(ActivityLog(
        action="Report Recovered",
        user=current_user.username,
        details=f"Recovered report '{history_entry.title}' from Report History to Active Reports",
        type="report",
    ))
    db.commit()
    return {"recovered_id": recovered_report.id, "title": history_entry.title}


@router.delete("/history/{history_id}")
async def delete_report_history(
    history_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_admin_user),
):
    require_permission("view_all_branches")(current_user)
    history_entry = db.query(ReportHistory).filter(ReportHistory.id == history_id).first()
    if not history_entry:
        raise HTTPException(status_code=404, detail="Report history entry not found")

    title = history_entry.title
    
    db.add(ActivityLog(
        action="Report History Deleted",
        user=current_user.username,
        details=f"Permanently deleted report '{title}' from Report History",
        type="report",
    ))
    db.delete(history_entry)
    db.commit()
    return {"deleted_id": history_id, "title": title}


@branch_router.delete("/{report_id}")
async def delete_branch_report(
    report_id: int,
    db: Session = Depends(get_db),
    current_staff = Depends(get_current_branch_staff),
):
    report = db.query(Report).filter(
        Report.id == report_id,
        Report.branch_id == current_staff.branch_id,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    title = report.title
    
    # Move to ReportHistory instead of permanent deletion
    history_entry = ReportHistory(
        original_report_id=report.id,
        title=report.title,
        branch_id=report.branch_id,
        branch=report.branch,
        report_type=report.report_type,
        service_type=report.service_type,
        transaction_category=report.transaction_category,
        date_from=report.date_from,
        date_to=report.date_to,
        generated_by=report.generated_by,
        submitted_by=report.submitted_by,
        submitted_at=report.submitted_at,
        created_at=report.created_at,
        deleted_at=datetime.utcnow(),
        deleted_by=current_staff.username,
        status="Archived"
    )
    db.add(history_entry)
    
    db.add(ActivityLog(
        action="Branch Report Archived",
        user=current_staff.username,
        details=f"Archived branch report '{title}' to Report History",
        type="report",
    ))
    db.delete(report)
    db.commit()
    return {"archived_id": report_id, "title": title}
