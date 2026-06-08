"""
File Delivery Security Utilities

Centralized helpers for serving files with consistent security headers.
Distinguishes between preview-safe assets and download-only attachments
to prevent accidental widening of preview behavior in future features.
"""

from fastapi.responses import FileResponse, Response
from pathlib import Path
from typing import Optional


# MIME types that may be rendered inline by the browser.
# All other types are forced to download.
PREVIEW_SAFE_MIME_TYPES = frozenset([
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
])


def _security_headers(disposition: str, mime_type: str) -> dict[str, str]:
    """Build the minimal set of security headers for file responses."""
    headers: dict[str, str] = {
        "X-Content-Type-Options": "nosniff",
    }
    if disposition == "attachment":
        headers["Content-Disposition"] = f'attachment; filename="{mime_type}"'
    return headers


def is_preview_safe(mime_type: Optional[str]) -> bool:
    """Return True if the MIME type is on the preview-safe allowlist."""
    return (mime_type or "") in PREVIEW_SAFE_MIME_TYPES


def deliver_file_response(
    file_path: str | Path,
    *,
    mime_type: Optional[str] = None,
    filename: Optional[str] = None,
    allow_inline_preview: bool = False,
) -> FileResponse:
    """
    Serve a file with mandatory security headers.

    If allow_inline_preview is False (the default), the file is always
    served with Content-Disposition: attachment regardless of MIME type.
    Only set allow_inline_preview=True for files that have passed backend
    signature verification and are in PREVIEW_SAFE_MIME_TYPES.
    """
    resolved_mime = mime_type or "application/octet-stream"
    disposition = "inline" if (allow_inline_preview and is_preview_safe(resolved_mime)) else "attachment"

    headers = {
        "X-Content-Type-Options": "nosniff",
    }
    if disposition == "attachment" and filename:
        headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    elif disposition == "inline" and filename:
        headers["Content-Disposition"] = f'inline; filename="{filename}"'

    return FileResponse(
        path=str(file_path),
        media_type=resolved_mime,
        filename=filename or Path(file_path).name,
        headers=headers,
    )


def deliver_bytes_response(
    content: bytes,
    *,
    mime_type: Optional[str] = None,
    filename: Optional[str] = None,
    allow_inline_preview: bool = False,
) -> Response:
    """
    Serve byte content with mandatory security headers.

    Same rules as deliver_file_response: download-only by default,
    inline only when explicitly allowed and MIME type is safe.
    """
    resolved_mime = mime_type or "application/octet-stream"
    disposition = "inline" if (allow_inline_preview and is_preview_safe(resolved_mime)) else "attachment"

    headers: dict[str, str] = {
        "X-Content-Type-Options": "nosniff",
    }
    if filename:
        headers["Content-Disposition"] = f'{disposition}; filename="{filename}"'

    return Response(content=content, media_type=resolved_mime, headers=headers)
