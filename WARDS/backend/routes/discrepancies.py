from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import re
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.models import ActivityLog, Branch, BranchStaff, DiscrepancyReport, get_db
from middleware.admin_auth import require_main_admin
from middleware.branch_auth import get_current_branch_staff, require_branch_admin
from utils.field_crypto import apply_discrepancy_report_security, get_decrypted_or_raw

router = APIRouter()
UPLOAD_DIR = Path("uploads/discrepancies")
ALLOWED_ATTACHMENT_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
}
MANILA_TZ = timezone(timedelta(hours=8))
CLOSED_DISCREPANCY_STATUSES = {"Solved", "Rejected"}
REDACTED_PATTERN = re.compile(r"^[A-Z0-9_]+_[0-9a-f]{16}$")


class DiscrepancyVerify(BaseModel):
    status: str
    verification_notes: str | None = None


class BranchDiscrepancyReply(BaseModel):
    reply_notes: str


def parse_conversation_thread(raw_thread: str | None) -> list[dict]:
    if not raw_thread:
        return []

    try:
        parsed = json.loads(raw_thread)
    except json.JSONDecodeError:
        return []

    return parsed if isinstance(parsed, list) else []


def discrepancy_value(report: DiscrepancyReport, field_name: str) -> str | None:
    return get_decrypted_or_raw(report, field_name)


def clean_display_value(value: str | None, fallback: str | None = None) -> str | None:
    normalized = (value or "").strip()
    if not normalized:
        return fallback
    if REDACTED_PATTERN.match(normalized):
        return fallback
    return value


def save_conversation_thread(report: DiscrepancyReport, thread_entries: list[dict]):
    report.conversation_thread = json.dumps(thread_entries)


def append_thread_entry(
    report: DiscrepancyReport,
    sender_role: str,
    sender_name: str,
    message: str,
    created_at: datetime,
    status_value: str | None = None,
):
    thread_entries = parse_conversation_thread(discrepancy_value(report, "conversation_thread"))
    if not thread_entries and report.created_at is not None:
        thread_entries = build_fallback_thread(report)
    thread_entries.append({
        "sender_role": sender_role,
        "sender_name": sender_name,
        "message": message,
        "created_at": created_at.isoformat(),
        "status": status_value,
    })
    save_conversation_thread(report, thread_entries)


def build_fallback_thread(report: DiscrepancyReport) -> list[dict]:
    reported_by = clean_display_value(discrepancy_value(report, "reported_by"), "Branch Staff")
    thread_entries = [{
        "sender_role": "branch_admin",
        "sender_name": reported_by,
        "message": discrepancy_value(report, "description"),
        "created_at": report.created_at.isoformat() if report.created_at else None,
        "status": "Pending Review",
        "label": "Initial discrepancy report",
    }]

    verification_notes = discrepancy_value(report, "verification_notes")
    verified_by = clean_display_value(discrepancy_value(report, "verified_by"), "Main Admin")
    if verification_notes or verified_by:
        thread_entries.append({
            "sender_role": "main_admin",
            "sender_name": verified_by or "Main Admin",
            "message": verification_notes or "",
            "created_at": report.verified_at.isoformat() if report.verified_at else report.updated_at.isoformat() if report.updated_at else None,
            "status": report.status,
        })

    branch_reply_notes = discrepancy_value(report, "branch_reply_notes")
    branch_replied_by = clean_display_value(discrepancy_value(report, "branch_replied_by"), "Branch Staff")
    if branch_reply_notes or branch_replied_by:
        thread_entries.append({
            "sender_role": "branch_admin",
            "sender_name": branch_replied_by or reported_by,
            "message": branch_reply_notes or "",
            "created_at": report.branch_replied_at.isoformat() if report.branch_replied_at else report.updated_at.isoformat() if report.updated_at else None,
            "status": report.status,
        })

    return thread_entries


def get_thread_timestamp(entry: dict) -> datetime | None:
    created_at = entry.get("created_at")
    if not created_at:
        return None
    try:
        return datetime.fromisoformat(created_at)
    except ValueError:
        return None


def has_unread_thread_entries(report: DiscrepancyReport, viewer: str) -> bool:
    thread_entries = parse_conversation_thread(discrepancy_value(report, "conversation_thread")) or build_fallback_thread(report)
    last_viewed = report.last_viewed_by_admin if viewer == "admin" else report.last_viewed_by_branch
    counterparty_roles = {"main_admin"} if viewer == "branch" else {"branch_admin", "initial_report"}

    for entry in thread_entries:
        if entry.get("sender_role") not in counterparty_roles:
            continue
        entry_timestamp = get_thread_timestamp(entry)
        if entry_timestamp is None:
            continue
        if last_viewed is None or entry_timestamp > last_viewed:
            return True

    return False


def serialize_discrepancy(report: DiscrepancyReport) -> dict:
    variance = None
    if report.system_amount is not None and report.actual_amount is not None:
        variance = float(report.actual_amount - report.system_amount)

    thread_entries = parse_conversation_thread(discrepancy_value(report, "conversation_thread")) or build_fallback_thread(report)

    branch_name = clean_display_value(discrepancy_value(report.branch, "name") if report.branch else None, f"Branch {report.branch_id}")

    return {
        "id": report.id,
        "branch_id": report.branch_id,
        "branch_name": branch_name,
        "title": clean_display_value(discrepancy_value(report, "title"), report.title),
        "report_date": discrepancy_value(report, "report_date"),
        "discrepancy_type": clean_display_value(discrepancy_value(report, "discrepancy_type"), report.discrepancy_type),
        "system_amount": float(report.system_amount) if report.system_amount is not None else None,
        "actual_amount": float(report.actual_amount) if report.actual_amount is not None else None,
        "variance_amount": variance,
        "description": clean_display_value(discrepancy_value(report, "description"), report.description),
        "supporting_documents": clean_display_value(discrepancy_value(report, "supporting_documents"), report.supporting_documents),
        "attachment_filename": clean_display_value(discrepancy_value(report, "attachment_filename"), report.attachment_filename),
        "submitted_offline": bool(report.submitted_offline),
        "status": report.status,
        "verification_notes": clean_display_value(discrepancy_value(report, "verification_notes"), report.verification_notes),
        "branch_reply_notes": clean_display_value(discrepancy_value(report, "branch_reply_notes"), report.branch_reply_notes),
        "conversation_thread": thread_entries,
        "reported_by": clean_display_value(discrepancy_value(report, "reported_by"), "Branch Staff"),
        "verified_by": clean_display_value(discrepancy_value(report, "verified_by"), None),
        "branch_replied_by": clean_display_value(discrepancy_value(report, "branch_replied_by"), None),
        "verified_at": report.verified_at.isoformat() if report.verified_at else None,
        "branch_replied_at": report.branch_replied_at.isoformat() if report.branch_replied_at else None,
        "last_viewed_by_branch": report.last_viewed_by_branch.isoformat() if report.last_viewed_by_branch else None,
        "last_viewed_by_admin": report.last_viewed_by_admin.isoformat() if report.last_viewed_by_admin else None,
        "has_unread_for_branch": has_unread_thread_entries(report, "branch"),
        "has_unread_for_admin": has_unread_thread_entries(report, "admin"),
        "created_at": report.created_at.isoformat() if report.created_at else None,
        "updated_at": report.updated_at.isoformat() if report.updated_at else None,
    }


def log_action(db: Session, action: str, user: str, details: str, log_type: str):
    db.add(ActivityLog(action=action, user=user, details=details, type=log_type))


def validate_report_date(report_date: str) -> str:
    try:
        parsed = date.fromisoformat(report_date)
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Report date must use YYYY-MM-DD format") from error

    today_in_manila = datetime.now(MANILA_TZ).date()
    if parsed < today_in_manila:
        raise HTTPException(status_code=400, detail="Report date cannot be earlier than today's date")

    return parsed.isoformat()


async def save_attachment(attachment: UploadFile | None) -> tuple[str | None, str | None]:
    if not attachment or not attachment.filename:
        return None, None

    if attachment.content_type and attachment.content_type not in ALLOWED_ATTACHMENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Attachment must be a PDF, image, or Word document",
        )

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = attachment.filename.replace("\\", "_").replace("/", "_").replace(" ", "_")
    stored_name = f"{uuid4().hex}_{safe_name}"
    file_path = UPLOAD_DIR / stored_name
    content = await attachment.read()
    file_path.write_bytes(content)
    return str(file_path), attachment.filename


@router.get("/branch/unread-count")
async def get_branch_discrepancy_unread_count(
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    """Get count of branch discrepancy reports needing branch attention"""
    reports = (
        db.query(DiscrepancyReport)
        .filter(DiscrepancyReport.branch_id == current_staff.branch_id)
        .all()
    )
    
    unread_count = 0
    for report in reports:
        if report.status not in CLOSED_DISCREPANCY_STATUSES or has_unread_thread_entries(report, "branch"):
            unread_count += 1
    
    return {"unread_count": unread_count}


@router.get("/branch")
async def get_branch_discrepancies(
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    reports = (
        db.query(DiscrepancyReport)
        .filter(DiscrepancyReport.branch_id == current_staff.branch_id)
        .order_by(DiscrepancyReport.created_at.desc())
        .all()
    )
    return [serialize_discrepancy(report) for report in reports]


@router.post("/branch")
async def create_branch_discrepancy(
    title: str = Form(...),
    report_date: str = Form(...),
    discrepancy_type: str = Form(...),
    system_amount: float | None = Form(None),
    actual_amount: float | None = Form(None),
    description: str = Form(...),
    other_specification: str | None = Form(None),
    supporting_documents: str | None = Form(None),
    submitted_offline: bool = Form(False),
    attachment: UploadFile | None = File(None),
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    branch = db.query(Branch).filter(Branch.id == current_staff.branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    normalized_report_date = validate_report_date(report_date)

    normalized_title = title.strip()
    if not normalized_title:
        raise HTTPException(status_code=400, detail="Discrepancy title is required")

    description = description.strip()
    if not description:
        raise HTTPException(status_code=400, detail="Discrepancy details are required")

    normalized_discrepancy_type = discrepancy_type.strip()
    if not normalized_discrepancy_type:
        raise HTTPException(status_code=400, detail="Discrepancy type is required")
    normalized_other_specification = (other_specification or "").strip()
    if normalized_discrepancy_type.lower() == "other" and not normalized_other_specification:
        raise HTTPException(
            status_code=400,
            detail="Please provide additional details when discrepancy type is set to Other",
        )
    if normalized_other_specification:
        description = f"{description}\n\nOther specification: {normalized_other_specification}"

    attachment_path, attachment_filename = await save_attachment(attachment)
    actor_label = clean_display_value(current_staff.username, "Branch Staff")

    report = DiscrepancyReport(
        branch_id=current_staff.branch_id,
        title=normalized_title,
        report_date=normalized_report_date,
        discrepancy_type=normalized_discrepancy_type,
        system_amount=system_amount,
        actual_amount=actual_amount,
        description=description,
        supporting_documents=(supporting_documents or "").strip() or None,
        attachment_path=attachment_path,
        attachment_filename=attachment_filename,
        submitted_offline=submitted_offline,
        status="Pending Review",
        reported_by=actor_label,
        last_viewed_by_branch=datetime.utcnow(),
    )
    append_thread_entry(
        report,
        "initial_report",
        actor_label,
        description,
        report.created_at or datetime.utcnow(),
        "Pending Review",
    )
    apply_discrepancy_report_security(report)
    db.add(report)
    log_action(
        db,
        "Discrepancy Submitted",
        current_staff.username,
        f"Branch {discrepancy_value(branch, 'name') or branch.name} submitted discrepancy '{discrepancy_value(report, 'discrepancy_type') or report.discrepancy_type}'",
        "discrepancy",
    )
    db.commit()
    db.refresh(report)
    return serialize_discrepancy(report)


@router.delete("/branch/{report_id}")
async def delete_branch_discrepancy(
    report_id: int,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    report = (
        db.query(DiscrepancyReport)
        .filter(
            DiscrepancyReport.id == report_id,
            DiscrepancyReport.branch_id == current_staff.branch_id,
        )
        .first()
    )
    if not report:
        raise HTTPException(status_code=404, detail="Discrepancy report not found")

    log_action(
        db,
        "Discrepancy Deleted",
        current_staff.username,
        f"Deleted discrepancy #{report.id} for branch {current_staff.branch_id}",
        "discrepancy",
    )
    if report.attachment_path:
        attachment_path = Path(discrepancy_value(report, "attachment_path"))
        if attachment_path.exists():
            attachment_path.unlink()
    db.delete(report)
    db.commit()
    return {"message": "Discrepancy report deleted successfully"}


@router.get("/admin/unread-count")
async def get_admin_discrepancy_unread_count(
    current_user=Depends(require_main_admin()),
    db: Session = Depends(get_db),
):
    """Get count of discrepancy reports with unread updates for Main Admin."""
    reports = db.query(DiscrepancyReport).all()

    unread_count = 0
    for report in reports:
        if has_unread_thread_entries(report, "admin"):
            unread_count += 1

    return {"unread_count": unread_count}


@router.get("/admin")
async def get_admin_discrepancies(
    current_user=Depends(require_main_admin()),
    db: Session = Depends(get_db),
):
    reports = db.query(DiscrepancyReport).order_by(DiscrepancyReport.created_at.desc()).all()
    return [serialize_discrepancy(report) for report in reports]


@router.get("/branch/{report_id}/attachment")
async def download_branch_discrepancy_attachment(
    report_id: int,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    report = (
        db.query(DiscrepancyReport)
        .filter(
            DiscrepancyReport.id == report_id,
            DiscrepancyReport.branch_id == current_staff.branch_id,
        )
        .first()
    )
    if not report:
        raise HTTPException(status_code=404, detail="Discrepancy report not found")
    if not report.attachment_path or not report.attachment_filename:
        raise HTTPException(status_code=404, detail="No attachment uploaded for this discrepancy report")

    attachment_path = Path(discrepancy_value(report, "attachment_path"))
    if not attachment_path.exists():
        raise HTTPException(status_code=404, detail="Attached file could not be found")

    return FileResponse(path=attachment_path, filename=discrepancy_value(report, "attachment_filename"))


@router.get("/admin/{report_id}/attachment")
async def download_admin_discrepancy_attachment(
    report_id: int,
    current_user=Depends(require_main_admin()),
    db: Session = Depends(get_db),
):
    report = db.query(DiscrepancyReport).filter(DiscrepancyReport.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Discrepancy report not found")
    if not report.attachment_path or not report.attachment_filename:
        raise HTTPException(status_code=404, detail="No attachment uploaded for this discrepancy report")

    attachment_path = Path(discrepancy_value(report, "attachment_path"))
    if not attachment_path.exists():
        raise HTTPException(status_code=404, detail="Attached file could not be found")

    return FileResponse(path=attachment_path, filename=discrepancy_value(report, "attachment_filename"))


@router.put("/branch/{report_id}/mark-viewed")
async def mark_discrepancy_viewed(
    report_id: int,
    current_staff: BranchStaff = Depends(get_current_branch_staff),
    db: Session = Depends(get_db),
):
    report = (
        db.query(DiscrepancyReport)
        .filter(
            DiscrepancyReport.id == report_id,
            DiscrepancyReport.branch_id == current_staff.branch_id,
        )
        .first()
    )
    if not report:
        raise HTTPException(status_code=404, detail="Discrepancy report not found")

    report.last_viewed_by_branch = datetime.utcnow()
    db.commit()
    return {"message": "Marked as viewed"}


@router.put("/branch/{report_id}/reply")
async def reply_to_admin_discrepancy_response(
    report_id: int,
    payload: BranchDiscrepancyReply,
    current_staff: BranchStaff = Depends(require_branch_admin()),
    db: Session = Depends(get_db),
):
    report = (
        db.query(DiscrepancyReport)
        .filter(
            DiscrepancyReport.id == report_id,
            DiscrepancyReport.branch_id == current_staff.branch_id,
        )
        .first()
    )
    if not report:
        raise HTTPException(status_code=404, detail="Discrepancy report not found")

    if (report.status or "").strip() in CLOSED_DISCREPANCY_STATUSES:
        raise HTTPException(status_code=400, detail="This discrepancy report is already closed and can no longer receive branch replies.")

    if not ((discrepancy_value(report, "verification_notes") or "").strip() or (discrepancy_value(report, "verified_by") or "").strip()):
        raise HTTPException(status_code=400, detail="Branch replies are only allowed after Main Admin has responded.")

    reply_notes = (payload.reply_notes or "").strip()
    if not reply_notes:
        raise HTTPException(status_code=400, detail="Reply notes are required.")
    actor_label = clean_display_value(current_staff.username, "Branch Staff")

    if not parse_conversation_thread(discrepancy_value(report, "conversation_thread")):
        save_conversation_thread(report, build_fallback_thread(report))

    report.branch_reply_notes = reply_notes
    report.branch_replied_by = actor_label
    report.branch_replied_at = datetime.utcnow()
    report.last_viewed_by_branch = report.branch_replied_at
    report.updated_at = report.branch_replied_at
    append_thread_entry(
        report,
        "branch_admin",
        actor_label,
        reply_notes,
        report.branch_replied_at,
        report.status,
    )
    apply_discrepancy_report_security(report)

    log_action(
        db,
        "Discrepancy Reply Submitted",
        current_staff.username,
        f"Branch {current_staff.branch_id} replied to discrepancy #{report.id}",
        "discrepancy",
    )
    db.commit()
    db.refresh(report)
    return serialize_discrepancy(report)


@router.put("/admin/{report_id}/mark-viewed")
async def mark_admin_discrepancy_viewed(
    report_id: int,
    current_user=Depends(require_main_admin()),
    db: Session = Depends(get_db),
):
    report = db.query(DiscrepancyReport).filter(DiscrepancyReport.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Discrepancy report not found")

    report.last_viewed_by_admin = datetime.utcnow()
    db.commit()
    return {"message": "Marked as viewed"}


@router.delete("/admin/{report_id}")
async def delete_admin_discrepancy(
    report_id: int,
    current_user=Depends(require_main_admin()),
    db: Session = Depends(get_db),
):
    report = db.query(DiscrepancyReport).filter(DiscrepancyReport.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Discrepancy report not found")

    log_action(
        db,
        "Discrepancy Deleted",
        current_user.username,
        f"Admin deleted discrepancy #{report.id} from branch {report.branch_id}",
        "discrepancy",
    )
    if report.attachment_path:
        attachment_path = Path(discrepancy_value(report, "attachment_path"))
        if attachment_path.exists():
            attachment_path.unlink()
    db.delete(report)
    db.commit()
    return {"message": "Discrepancy report deleted successfully"}


@router.put("/{report_id}/verify")
async def verify_discrepancy(
    report_id: int,
    payload: DiscrepancyVerify,
    current_user=Depends(require_main_admin()),
    db: Session = Depends(get_db),
):
    report = db.query(DiscrepancyReport).filter(DiscrepancyReport.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Discrepancy report not found")

    if (report.status or "").strip() in CLOSED_DISCREPANCY_STATUSES:
        raise HTTPException(status_code=400, detail="This discrepancy report is already closed and can no longer be updated.")

    next_status = payload.status.strip() or report.status
    next_notes = (payload.verification_notes or "").strip() or None
    previous_status = report.status
    previous_notes = discrepancy_value(report, "verification_notes")

    if not parse_conversation_thread(discrepancy_value(report, "conversation_thread")):
        save_conversation_thread(report, build_fallback_thread(report))

    report.status = next_status
    report.verification_notes = next_notes
    report.verified_by = current_user.username
    report.verified_at = datetime.utcnow()
    report.updated_at = datetime.utcnow()
    report.last_viewed_by_admin = report.updated_at
    if previous_status != report.status or previous_notes != report.verification_notes:
        append_thread_entry(
            report,
            "main_admin",
            current_user.username,
            report.verification_notes or "",
            report.updated_at,
            report.status,
        )
    apply_discrepancy_report_security(report)

    log_action(
        db,
        "Discrepancy Verified",
        current_user.username,
        f"Updated discrepancy #{report.id} to {report.status}",
        "discrepancy",
    )
    db.commit()
    db.refresh(report)
    return serialize_discrepancy(report)
