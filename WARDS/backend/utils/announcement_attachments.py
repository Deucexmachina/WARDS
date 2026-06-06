"""Shared helpers for managing announcement attachments.

Used by both the main admin announcements route and the branch announcements
route to keep validation, storage, and serialization consistent.
"""

from __future__ import annotations

import mimetypes
import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Iterable, List, Optional

from fastapi import HTTPException, UploadFile

from database.models import AnnouncementAttachment

# Legacy disk storage root. New attachments are stored in the database, but this
# remains for old records created before DB-backed storage existed.
ATTACHMENT_ROOT = Path("uploads/announcements")

# 25 MB per file is plenty for documents/images/short videos.
MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024
MAX_FILES_PER_ANNOUNCEMENT = 10

# Allowed extensions and their associated mime prefixes.
ALLOWED_EXTENSIONS = {
    # Images
    ".jpg", ".jpeg", ".png", ".gif", ".webp",
    # Documents
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".csv",
    # Optional video
    ".mp4", ".mov", ".webm",
    # Optional archives
    ".zip",
}

PREVIEW_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".pdf"}


def _safe_stem(filename: str) -> str:
    stem = Path(filename).stem or "file"
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._-") or "file"
    return cleaned[:60]


def _validate_upload(upload: UploadFile, file_bytes: bytes) -> str:
    """Validate the upload and return the lower-cased extension."""
    filename = upload.filename or ""
    if not filename:
        raise HTTPException(status_code=400, detail="Attachment is missing a filename")

    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(ext.lstrip(".") for ext in ALLOWED_EXTENSIONS))
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{extension or filename}'. Allowed: {allowed}",
        )

    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail=f"'{filename}' is empty")

    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"'{filename}' exceeds the {MAX_FILE_SIZE_BYTES // (1024 * 1024)} MB size limit",
        )

    return extension


def store_announcement_attachment(
    announcement_id: int,
    upload: UploadFile,
    file_bytes: bytes,
    uploaded_by: Optional[str] = None,
) -> AnnouncementAttachment:
    """Persist a single attachment in the database and return a model instance.

    Caller is responsible for adding the returned instance to the DB session
    and committing the transaction.
    """
    extension = _validate_upload(upload, file_bytes)

    unique_id = uuid.uuid4().hex[:10]
    timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    safe_stem = _safe_stem(upload.filename or "file")
    stored_name = f"{timestamp}_{unique_id}_{safe_stem}{extension}"

    mime = upload.content_type or mimetypes.guess_type(upload.filename or "")[0]

    return AnnouncementAttachment(
        announcement_id=announcement_id,
        file_path=f"db://announcements/{announcement_id}/{stored_name}",
        original_filename=upload.filename or stored_name,
        stored_filename=stored_name,
        mime_type=mime,
        file_size=len(file_bytes),
        file_content=file_bytes,
        uploaded_by=(uploaded_by or "")[:255] or None,
    )


def attachment_bytes(attachment: AnnouncementAttachment) -> bytes | None:
    content = getattr(attachment, "file_content", None)
    if content:
        if isinstance(content, bytes):
            if not str(attachment.file_path or "").startswith("db://"):
                try:
                    import base64
                    decoded = base64.b64decode(content, validate=True)
                    if not attachment.file_size or len(decoded) == attachment.file_size:
                        return decoded
                except Exception:
                    pass
            return content
        if isinstance(content, memoryview):
            content_bytes = content.tobytes()
            if not str(attachment.file_path or "").startswith("db://"):
                try:
                    import base64
                    decoded = base64.b64decode(content_bytes, validate=True)
                    if not attachment.file_size or len(decoded) == attachment.file_size:
                        return decoded
                except Exception:
                    pass
            return content_bytes
        if isinstance(content, str):
            try:
                import base64
                return base64.b64decode(content.encode("ascii"))
            except Exception:
                return content.encode("utf-8")
    if attachment.file_path and os.path.exists(attachment.file_path):
        try:
            return Path(attachment.file_path).read_bytes()
        except OSError:
            return None
    return None


def enforce_attachment_limit(existing_count: int, additional: int) -> None:
    if existing_count + additional > MAX_FILES_PER_ANNOUNCEMENT:
        raise HTTPException(
            status_code=400,
            detail=(
                f"An announcement can have at most {MAX_FILES_PER_ANNOUNCEMENT} "
                f"attachments (currently {existing_count})."
            ),
        )


def remove_attachment_file(attachment: AnnouncementAttachment) -> None:
    path = attachment.file_path
    if not path or str(path).startswith("db://"):
        return
    try:
        if os.path.exists(path):
            os.remove(path)
    except OSError:
        # Don't break the request flow if cleanup fails; log if logging exists.
        pass


def remove_announcement_directory(announcement_id: int) -> None:
    folder = ATTACHMENT_ROOT / str(announcement_id)
    if folder.exists():
        import shutil
        shutil.rmtree(folder, ignore_errors=True)


def is_previewable(attachment: AnnouncementAttachment) -> bool:
    extension = Path(attachment.original_filename or attachment.stored_filename or "").suffix.lower()
    return extension in PREVIEW_EXTENSIONS


def serialize_attachment(
    attachment: AnnouncementAttachment,
    *,
    download_url: str,
    preview_url: Optional[str] = None,
) -> dict:
    return {
        "id": attachment.id,
        "filename": attachment.original_filename,
        "stored_filename": attachment.stored_filename,
        "mime_type": attachment.mime_type,
        "size": attachment.file_size or 0,
        "uploaded_by": attachment.uploaded_by,
        "uploaded_at": attachment.created_at.isoformat() if attachment.created_at else None,
        "download_url": download_url,
        "preview_url": preview_url if is_previewable(attachment) else None,
        "is_previewable": is_previewable(attachment),
    }


def serialize_attachments(
    attachments: Iterable[AnnouncementAttachment],
    *,
    base_path: str,
) -> List[dict]:
    """Serialize a sequence of attachments using a base path like
    ``/api/announcements/{id}/attachments`` (no trailing slash).
    """
    base = base_path.rstrip("/")
    return [
        serialize_attachment(
            attachment,
            download_url=f"{base}/{attachment.id}/download",
            preview_url=f"{base}/{attachment.id}/preview",
        )
        for attachment in attachments
    ]
