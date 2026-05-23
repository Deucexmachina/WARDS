from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from database.models import ActivityLog, User, get_db
from middleware.admin_auth import get_current_admin_user
from utils.field_crypto import (
    build_redacted_text,
    decrypt_optional_value,
    encrypt_optional_value,
    hash_optional_value,
)
from utils.rbac import require_permission

router = APIRouter()


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
    return [_serialize_announcement(announcement) for announcement in announcements]


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
    return [_serialize_announcement(announcement) for announcement in announcements]


@router.get("/{announcement_id}")
async def get_announcement(
    announcement_id: int,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    require_permission("manage_announcements")(current_user)
    announcement = get_main_admin_announcement_or_404(db, announcement_id)
    return _serialize_announcement(announcement)


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
    return _serialize_announcement(created)


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
    return _serialize_announcement(updated)


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
    db.execute(
        text("DELETE FROM announcements WHERE id = :announcement_id"),
        {"announcement_id": announcement_id},
    )
    db.commit()

    return {"message": "Announcement deleted successfully"}
