from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from core.security_crypto import decrypt_optional_value, encrypt_optional_value
from core.security_hash import hash_optional_value, hash_record_parts
from core.security_phase2 import build_redacted_text, phase2_redaction_enabled
from database.config import get_db
from models.announcement import Announcement, AnnouncementCreate, AnnouncementUpdate
from services.announcement_service import announcement_service

router = APIRouter()


def _db_announcements_available(db: Session) -> bool:
    try:
        db.execute(text("SELECT 1 FROM announcements LIMIT 1"))
        return True
    except Exception:
        db.rollback()
        return False


def _to_priority(icon_color, icon_type) -> str:
    color = (icon_color or "").strip().lower()
    icon = (icon_type or "").strip().lower()
    if color in {"red", "orange"} or icon in {"warning", "alert"}:
        return "high"
    return "normal"


def _deserialize_announcement(row) -> Announcement:
    title = decrypt_optional_value(row.get("title_enc")) or row.get("title") or ""
    content = decrypt_optional_value(row.get("content_enc")) or row.get("content") or ""
    created_at = row.get("publish_date") or row.get("created_at") or datetime.utcnow()
    updated_at = row.get("updated_at") or created_at
    priority = _to_priority(row.get("icon_color"), row.get("icon_type"))

    return Announcement(
        id=row["id"],
        title=title,
        content=content,
        priority=priority,
        created_at=created_at,
        updated_at=updated_at,
    )


def _build_db_announcement_values(title: str, content: str, priority: str, existing_created_by=None):
    title = title.strip()
    content = content.strip()
    priority = (priority or "normal").strip().lower()
    icon_color = "red" if priority == "high" else "blue"
    icon_type = "warning" if priority == "high" else "info"
    stored_title = build_redacted_text("ANNOUNCEMENT", title, 200) if phase2_redaction_enabled() else title
    stored_content = build_redacted_text("ANNOUNCEMENT_CONTENT", content, 65535) if phase2_redaction_enabled() else content
    created_by_value = existing_created_by or "api"
    stored_created_by = (
        build_redacted_text("ANNOUNCEMENT_AUTHOR", created_by_value, 255)
        if phase2_redaction_enabled() else created_by_value
    )

    return {
        "title": stored_title,
        "title_enc": encrypt_optional_value(title),
        "title_hash": hash_optional_value(title),
        "content": stored_content,
        "content_enc": encrypt_optional_value(content),
        "content_hash": hash_optional_value(content),
        "icon_type": icon_type,
        "icon_color": icon_color,
        "created_by": stored_created_by,
        "created_by_enc": encrypt_optional_value(created_by_value),
        "created_by_hash": hash_optional_value(created_by_value),
    }


@router.get("/", response_model=List[Announcement])
def get_announcements(db: Session = Depends(get_db)):
    if not _db_announcements_available(db):
        return announcement_service.get_all()

    rows = db.execute(
        text(
            """
            SELECT
                id,
                title,
                title_enc,
                content,
                content_enc,
                icon_type,
                icon_color,
                publish_date,
                created_at,
                updated_at,
                is_active
            FROM announcements
            WHERE COALESCE(is_active, 1) = 1
            ORDER BY COALESCE(publish_date, created_at, updated_at) DESC, id DESC
            """
        )
    ).mappings().all()
    return [_deserialize_announcement(row) for row in rows]


@router.get("/{announcement_id}", response_model=Announcement)
def get_announcement(announcement_id: int, db: Session = Depends(get_db)):
    if not _db_announcements_available(db):
        announcement = announcement_service.get_by_id(announcement_id)
        if not announcement:
            raise HTTPException(status_code=404, detail="Announcement not found")
        return announcement

    row = db.execute(
        text(
            """
            SELECT
                id,
                title,
                title_enc,
                content,
                content_enc,
                icon_type,
                icon_color,
                publish_date,
                created_at,
                updated_at,
                is_active
            FROM announcements
            WHERE id = :id
            """
        ),
        {"id": announcement_id},
    ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Announcement not found")
    return _deserialize_announcement(row)


@router.post("/", response_model=Announcement)
def create_announcement(announcement: AnnouncementCreate, db: Session = Depends(get_db)):
    if not _db_announcements_available(db):
        return announcement_service.create(announcement)

    values = _build_db_announcement_values(announcement.title, announcement.content, announcement.priority)
    integrity_hash = hash_record_parts(
        announcement.title,
        announcement.content,
        values["icon_type"],
        values["icon_color"],
        1,
        "api",
        None,
    )

    db.execute(
        text(
            """
            INSERT INTO announcements (
                title,
                title_enc,
                title_hash,
                content,
                content_enc,
                content_hash,
                icon_type,
                icon_color,
                publish_date,
                is_active,
                created_by,
                created_by_enc,
                created_by_hash,
                integrity_hash
            ) VALUES (
                :title,
                :title_enc,
                :title_hash,
                :content,
                :content_enc,
                :content_hash,
                :icon_type,
                :icon_color,
                :publish_date,
                :is_active,
                :created_by,
                :created_by_enc,
                :created_by_hash,
                :integrity_hash
            )
            """
        ),
        {
            **values,
            "publish_date": datetime.utcnow(),
            "is_active": 1,
            "integrity_hash": integrity_hash,
        },
    )
    db.commit()

    new_id = db.execute(text("SELECT MAX(id) AS id FROM announcements")).mappings().first()["id"]
    return get_announcement(new_id, db)


@router.put("/{announcement_id}", response_model=Announcement)
def update_announcement(announcement_id: int, announcement: AnnouncementUpdate, db: Session = Depends(get_db)):
    if not _db_announcements_available(db):
        updated = announcement_service.update(announcement_id, announcement)
        if not updated:
            raise HTTPException(status_code=404, detail="Announcement not found")
        return updated

    existing = db.execute(
        text(
            """
            SELECT
                id,
                title,
                title_enc,
                content,
                content_enc,
                icon_type,
                icon_color,
                created_by,
                created_by_enc,
                branch_id,
                publish_date,
                is_active
            FROM announcements
            WHERE id = :id
            """
        ),
        {"id": announcement_id},
    ).mappings().first()

    if not existing:
        raise HTTPException(status_code=404, detail="Announcement not found")

    title = announcement.title if announcement.title is not None else (decrypt_optional_value(existing.get("title_enc")) or existing.get("title") or "")
    content = announcement.content if announcement.content is not None else (decrypt_optional_value(existing.get("content_enc")) or existing.get("content") or "")
    priority = announcement.priority if announcement.priority is not None else _to_priority(existing.get("icon_color"), existing.get("icon_type"))
    created_by_value = decrypt_optional_value(existing.get("created_by_enc")) or existing.get("created_by") or "api"

    values = _build_db_announcement_values(title, content, priority, created_by_value)
    integrity_hash = hash_record_parts(
        title,
        content,
        values["icon_type"],
        values["icon_color"],
        existing.get("publish_date"),
        existing.get("is_active"),
        created_by_value,
        existing.get("branch_id"),
    )

    db.execute(
        text(
            """
            UPDATE announcements
            SET
                title = :title,
                title_enc = :title_enc,
                title_hash = :title_hash,
                content = :content,
                content_enc = :content_enc,
                content_hash = :content_hash,
                icon_type = :icon_type,
                icon_color = :icon_color,
                created_by = :created_by,
                created_by_enc = :created_by_enc,
                created_by_hash = :created_by_hash,
                integrity_hash = :integrity_hash,
                updated_at = :updated_at
            WHERE id = :id
            """
        ),
        {
            **values,
            "integrity_hash": integrity_hash,
            "updated_at": datetime.utcnow(),
            "id": announcement_id,
        },
    )
    db.commit()
    return get_announcement(announcement_id, db)


@router.delete("/{announcement_id}")
def delete_announcement(announcement_id: int, db: Session = Depends(get_db)):
    if not _db_announcements_available(db):
        deleted = announcement_service.delete(announcement_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Announcement not found")
        return {"message": "Announcement deleted successfully"}

    result = db.execute(text("DELETE FROM announcements WHERE id = :id"), {"id": announcement_id})
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Announcement not found")
    return {"message": "Announcement deleted successfully"}
