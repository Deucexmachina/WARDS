from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from database.models import ActivityLog, Announcement, AnnouncementAttachment, User, get_db
from middleware.admin_auth import get_current_admin_user
from utils.announcement_attachments import (
    enforce_attachment_limit,
    remove_announcement_directory,
    remove_attachment_file,
    serialize_attachments,
    store_announcement_attachment,
)
from utils.field_crypto import (
    build_redacted_text,
    decrypt_optional_value,
    encrypt_optional_value,
    hash_optional_value,
)
from utils.rbac import require_permission

router = APIRouter()

ADMIN_ATTACHMENT_BASE = "/api/announcements"


def _list_attachment_dicts(db: Session, announcement_id: int) -> list[dict]:
    attachments = (
        db.query(AnnouncementAttachment)
        .filter(AnnouncementAttachment.announcement_id == announcement_id)
        .order_by(AnnouncementAttachment.created_at.asc(), AnnouncementAttachment.id.asc())
        .all()
    )
    return serialize_attachments(
        attachments,
        base_path=f"{ADMIN_ATTACHMENT_BASE}/{announcement_id}/attachments",
    )


class AnnouncementCreate(BaseModel):
    title: str
    content: str
    icon_type: Optional[str] = "megaphone"
    icon_color: Optional[str] = "blue"
    is_active: Optional[bool] = True


class AnnouncementUpdate(BaseModel):
    title: str
    content: str
    icon_type: Optional[str] = "megaphone"
    icon_color: Optional[str] = "blue"
    is_active: Optional[bool] = True


def _bool_to_db(value: Optional[bool], default: bool = True) -> int:
    if value is None:
        return 1 if default else 0
    return 1 if bool(value) else 0


def _serialize_announcement(row) -> dict:
    branch_name = row.get("branch_name")
    title = decrypt_optional_value(row.get("title_enc")) or row.get("title")
    content = decrypt_optional_value(row.get("content_enc")) or row.get("content")
    created_by = decrypt_optional_value(row.get("created_by_enc")) or row.get("created_by")
    publish_date = row.get("publish_date")
    created_at = row.get("created_at")
    updated_at = row.get("updated_at")

    return {
        "id": row["id"],
        "title": title,
        "content": content,
        "icon_type": row.get("icon_type"),
        "icon_color": row.get("icon_color"),
        "branch_id": row.get("branch_id"),
        "branch_name": branch_name,
        "source_label": branch_name if branch_name else "Main Admin",
        "is_branch_announcement": bool(row.get("branch_id")),
        "publish_date": publish_date.isoformat() if publish_date else None,
        "is_active": bool(row.get("is_active")),
        "created_by": created_by,
        "created_at": created_at.isoformat() if created_at else None,
        "updated_at": updated_at.isoformat() if updated_at else None,
        "attachments": row.get("attachments") or [],
    }


def _fetch_announcement_row(db: Session, announcement_id: int, main_admin_only: bool = False):
    query = """
        SELECT
            a.id,
            a.title,
            a.title_enc,
            a.content,
            a.content_enc,
            a.icon_type,
            a.icon_color,
            a.branch_id,
            b.name AS branch_name,
            a.publish_date,
            a.is_active,
            a.created_by,
            a.created_by_enc,
            a.created_at,
            a.updated_at
        FROM announcements a
        LEFT JOIN branches b ON b.id = a.branch_id
        WHERE a.id = :announcement_id
    """
    params = {"announcement_id": announcement_id}
    if main_admin_only:
        query += " AND a.branch_id IS NULL"
    return db.execute(text(query), params).mappings().first()


def _build_announcement_values(
    title: str,
    content: str,
    icon_type: Optional[str],
    icon_color: Optional[str],
    created_by: str,
):
    clean_title = title.strip()
    clean_content = content.strip()
    clean_author = created_by.strip() or "admin"

    return {
        "title": build_redacted_text("ANNOUNCEMENT", clean_title, 255),
        "title_enc": encrypt_optional_value(clean_title),
        "title_hash": hash_optional_value(clean_title),
        "content": build_redacted_text("ANNOUNCEMENT_CONTENT", clean_content, 65535),
        "content_enc": encrypt_optional_value(clean_content),
        "content_hash": hash_optional_value(clean_content),
        "icon_type": (icon_type or "megaphone").strip() or "megaphone",
        "icon_color": (icon_color or "blue").strip() or "blue",
        "created_by": build_redacted_text("ANNOUNCEMENT_AUTHOR", clean_author, 255),
        "created_by_enc": encrypt_optional_value(clean_author),
        "created_by_hash": hash_optional_value(clean_author),
    }


def get_main_admin_announcement_or_404(db: Session, announcement_id: int):
    announcement = _fetch_announcement_row(db, announcement_id, main_admin_only=True)
    if not announcement:
        raise HTTPException(status_code=404, detail="Announcement not found")
    return announcement


@router.get("/")
async def get_all_announcements(db: Session = Depends(get_db)):
    announcements = db.execute(
        text(
            """
            SELECT
                a.id,
                a.title,
                a.title_enc,
                a.content,
                a.content_enc,
                a.icon_type,
                a.icon_color,
                a.branch_id,
                b.name AS branch_name,
                a.publish_date,
                a.is_active,
                a.created_by,
                a.created_by_enc,
                a.created_at,
                a.updated_at
            FROM announcements a
            LEFT JOIN branches b ON b.id = a.branch_id
            WHERE COALESCE(a.is_active, 1) = 1
            ORDER BY a.publish_date DESC, a.created_at DESC, a.id DESC
            """
        )
    ).mappings().all()
    serialized = []
    for announcement in announcements:
        data = dict(announcement)
        data["attachments"] = _list_attachment_dicts(db, announcement["id"])
        serialized.append(_serialize_announcement(data))
    return serialized


@router.get("/admin/all")
async def get_all_announcements_admin(
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    require_permission("manage_announcements")(current_user)
    announcements = db.execute(
        text(
            """
            SELECT
                a.id,
                a.title,
                a.title_enc,
                a.content,
                a.content_enc,
                a.icon_type,
                a.icon_color,
                a.branch_id,
                b.name AS branch_name,
                a.publish_date,
                a.is_active,
                a.created_by,
                a.created_by_enc,
                a.created_at,
                a.updated_at
            FROM announcements a
            LEFT JOIN branches b ON b.id = a.branch_id
            WHERE a.branch_id IS NULL
            ORDER BY a.created_at DESC, a.id DESC
            """
        )
    ).mappings().all()
    serialized = []
    for announcement in announcements:
        data = dict(announcement)
        data["attachments"] = _list_attachment_dicts(db, announcement["id"])
        serialized.append(_serialize_announcement(data))
    return serialized


@router.get("/{announcement_id}")
async def get_announcement(
    announcement_id: int,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    require_permission("manage_announcements")(current_user)
    announcement = get_main_admin_announcement_or_404(db, announcement_id)
    data = dict(announcement)
    data["attachments"] = _list_attachment_dicts(db, announcement_id)
    return _serialize_announcement(data)


@router.post("/")
async def create_announcement(
    announcement: AnnouncementCreate,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    require_permission("manage_announcements")(current_user)

    values = _build_announcement_values(
        announcement.title,
        announcement.content,
        announcement.icon_type,
        announcement.icon_color,
        current_user.username,
    )
    is_active = _bool_to_db(announcement.is_active, default=True)
    publish_date = datetime.utcnow() if is_active else None

    result = db.execute(
        text(
            """
            INSERT INTO announcements (
                title,
                content,
                icon_type,
                icon_color,
                publish_date,
                is_active,
                created_by,
                created_at,
                updated_at,
                title_hash,
                content_hash,
                created_by_hash,
                title_enc,
                content_enc,
                created_by_enc
            ) VALUES (
                :title,
                :content,
                :icon_type,
                :icon_color,
                :publish_date,
                :is_active,
                :created_by,
                :created_at,
                :updated_at,
                :title_hash,
                :content_hash,
                :created_by_hash,
                :title_enc,
                :content_enc,
                :created_by_enc
            )
            """
        ),
        {
            **values,
            "publish_date": publish_date,
            "is_active": is_active,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        },
    )

    db.add(ActivityLog(
        action="Announcement Created",
        user=current_user.username,
        details=f"Created announcement: {announcement.title}",
        type="admin"
    ))
    db.commit()

    announcement_id = result.lastrowid
    created = _fetch_announcement_row(db, announcement_id)
    data = dict(created)
    data["attachments"] = _list_attachment_dicts(db, announcement_id)
    return _serialize_announcement(data)


@router.put("/{announcement_id}")
async def update_announcement(
    announcement_id: int,
    announcement: AnnouncementUpdate,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    require_permission("manage_announcements")(current_user)

    existing = get_main_admin_announcement_or_404(db, announcement_id)
    values = _build_announcement_values(
        announcement.title,
        announcement.content,
        announcement.icon_type,
        announcement.icon_color,
        decrypt_optional_value(existing.get("created_by_enc")) or existing.get("created_by") or current_user.username,
    )
    is_active = _bool_to_db(announcement.is_active, default=bool(existing.get("is_active")))
    publish_date = existing.get("publish_date")
    if is_active and not publish_date:
        publish_date = datetime.utcnow()

    db.execute(
        text(
            """
            UPDATE announcements
            SET
                title = :title,
                content = :content,
                icon_type = :icon_type,
                icon_color = :icon_color,
                publish_date = :publish_date,
                is_active = :is_active,
                updated_at = :updated_at,
                title_hash = :title_hash,
                content_hash = :content_hash,
                created_by_hash = :created_by_hash,
                title_enc = :title_enc,
                content_enc = :content_enc,
                created_by = :created_by,
                created_by_enc = :created_by_enc
            WHERE id = :announcement_id
            """
        ),
        {
            **values,
            "publish_date": publish_date,
            "is_active": is_active,
            "updated_at": datetime.utcnow(),
            "announcement_id": announcement_id,
        },
    )

    db.add(ActivityLog(
        action="Announcement Updated",
        user=current_user.username,
        details=f"Updated announcement: {announcement.title}",
        type="admin"
    ))
    db.commit()

    updated = _fetch_announcement_row(db, announcement_id)
    data = dict(updated)
    data["attachments"] = _list_attachment_dicts(db, announcement_id)
    return _serialize_announcement(data)


@router.delete("/{announcement_id}")
async def delete_announcement(
    announcement_id: int,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    require_permission("manage_announcements")(current_user)

    announcement = get_main_admin_announcement_or_404(db, announcement_id)
    title = decrypt_optional_value(announcement.get("title_enc")) or announcement.get("title") or "announcement"
    branch_name = announcement.get("branch_name")

    details = f"Deleted announcement: {title}"
    if branch_name:
        details = f"{details} ({branch_name})"

    db.add(ActivityLog(
        action="Announcement Deleted",
        user=current_user.username,
        details=details,
        type="admin"
    ))
    # Remove any uploaded files associated with the announcement
    attachments = (
        db.query(AnnouncementAttachment)
        .filter(AnnouncementAttachment.announcement_id == announcement_id)
        .all()
    )
    for attachment in attachments:
        remove_attachment_file(attachment)
    remove_announcement_directory(announcement_id)

    db.execute(
        text("DELETE FROM announcements WHERE id = :announcement_id"),
        {"announcement_id": announcement_id},
    )
    db.commit()

    return {"message": "Announcement deleted successfully"}


# ---------------------------------------------------------------------------
# Attachment endpoints (main admin announcements)
# ---------------------------------------------------------------------------


@router.get("/{announcement_id}/attachments")
async def list_announcement_attachments(
    announcement_id: int,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    require_permission("manage_announcements")(current_user)
    get_main_admin_announcement_or_404(db, announcement_id)
    return _list_attachment_dicts(db, announcement_id)


@router.post("/{announcement_id}/attachments")
async def upload_announcement_attachments(
    announcement_id: int,
    files: List[UploadFile] = File(...),
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    require_permission("manage_announcements")(current_user)
    get_main_admin_announcement_or_404(db, announcement_id)

    if not files:
        raise HTTPException(status_code=400, detail="No files were provided")

    existing_count = (
        db.query(AnnouncementAttachment)
        .filter(AnnouncementAttachment.announcement_id == announcement_id)
        .count()
    )
    enforce_attachment_limit(existing_count, len(files))

    saved: list[AnnouncementAttachment] = []
    try:
        for upload in files:
            file_bytes = await upload.read()
            attachment = store_announcement_attachment(
                announcement_id,
                upload,
                file_bytes,
                uploaded_by=current_user.username,
            )
            db.add(attachment)
            saved.append(attachment)
        db.flush()
        db.add(
            ActivityLog(
                action="Announcement Attachment Uploaded",
                user=current_user.username,
                details=(
                    f"Uploaded {len(saved)} attachment(s) to announcement #{announcement_id}: "
                    + ", ".join(att.original_filename for att in saved)
                ),
                type="admin",
            )
        )
        db.commit()
    except HTTPException:
        db.rollback()
        for attachment in saved:
            remove_attachment_file(attachment)
        raise
    except Exception:
        db.rollback()
        for attachment in saved:
            remove_attachment_file(attachment)
        raise HTTPException(status_code=500, detail="Failed to save attachments")

    return _list_attachment_dicts(db, announcement_id)


def _resolve_admin_attachment(
    db: Session, announcement_id: int, attachment_id: int
) -> AnnouncementAttachment:
    get_main_admin_announcement_or_404(db, announcement_id)
    attachment = (
        db.query(AnnouncementAttachment)
        .filter(
            AnnouncementAttachment.id == attachment_id,
            AnnouncementAttachment.announcement_id == announcement_id,
        )
        .first()
    )
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    return attachment


@router.get("/{announcement_id}/attachments/{attachment_id}/download")
async def download_announcement_attachment(
    announcement_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
):
    """Public download endpoint - announcements are public information."""
    attachment = (
        db.query(AnnouncementAttachment)
        .filter(
            AnnouncementAttachment.id == attachment_id,
            AnnouncementAttachment.announcement_id == announcement_id,
        )
        .first()
    )
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    import os as _os
    if not _os.path.exists(attachment.file_path):
        raise HTTPException(status_code=404, detail="Attachment file is missing")
    return FileResponse(
        attachment.file_path,
        media_type=attachment.mime_type or "application/octet-stream",
        filename=attachment.original_filename,
    )


@router.get("/{announcement_id}/attachments/{attachment_id}/preview")
async def preview_announcement_attachment(
    announcement_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
):
    """Inline preview for browser-renderable types (images, PDFs)."""
    attachment = (
        db.query(AnnouncementAttachment)
        .filter(
            AnnouncementAttachment.id == attachment_id,
            AnnouncementAttachment.announcement_id == announcement_id,
        )
        .first()
    )
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    import os as _os
    if not _os.path.exists(attachment.file_path):
        raise HTTPException(status_code=404, detail="Attachment file is missing")
    return FileResponse(
        attachment.file_path,
        media_type=attachment.mime_type or "application/octet-stream",
    )


@router.delete("/{announcement_id}/attachments/{attachment_id}")
async def delete_announcement_attachment(
    announcement_id: int,
    attachment_id: int,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    require_permission("manage_announcements")(current_user)
    attachment = _resolve_admin_attachment(db, announcement_id, attachment_id)
    filename = attachment.original_filename
    remove_attachment_file(attachment)
    db.delete(attachment)
    db.add(
        ActivityLog(
            action="Announcement Attachment Removed",
            user=current_user.username,
            details=f"Removed attachment '{filename}' from announcement #{announcement_id}",
            type="admin",
        )
    )
    db.commit()
    return {"message": "Attachment removed successfully"}
