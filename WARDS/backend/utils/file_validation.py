"""File upload validation utilities.

Provides file signature (magic bytes) inspection to verify that uploaded files
match their claimed type. Rejects files whose content does not match the expected
signature regardless of filename extension or Content-Type header.
"""

from __future__ import annotations

from enum import Enum
from pathlib import Path
from typing import Optional

from fastapi import HTTPException, UploadFile


class SafeFileType(str, Enum):
    """Allowed file types based on verified file signatures."""

    PDF = "application/pdf"
    PNG = "image/png"
    JPEG = "image/jpeg"

    # Image types that share the JPEG signature
    JPG = "image/jpg"

    # Microsoft Office legacy (OLE compound file). Detected only so it can be
    # rejected explicitly; legacy DOC/XLS is not safe for WARDS uploads.
    OLE = "application/x-ole-storage"

    # Microsoft Office Open XML
    DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    @classmethod
    def all_types(cls) -> set[str]:
        return {cls.PDF, cls.PNG, cls.JPEG, cls.JPG, cls.DOCX, cls.XLSX}

    @classmethod
    def is_safe_for_preview(cls, mime_type: str) -> bool:
        """Check if MIME type is safe for browser inline preview."""
        return mime_type in {cls.PDF, cls.PNG, cls.JPEG, cls.JPG}

    @classmethod
    def is_safe_for_upload(cls, mime_type: str) -> bool:
        """Check if MIME type is safe for upload."""
        return mime_type in cls.all_types()


# File signatures (magic bytes) for supported file types
# Each entry: (expected_bytes, mime_type, extensions)
FILE_SIGNATURES = [
    # PDF: %PDF-
    (b"%PDF-", SafeFileType.PDF, {".pdf"}),

    # PNG: \x89PNG\r\n\x1a\n
    (b"\x89PNG\r\n\x1a\n", SafeFileType.PNG, {".png"}),

    # JPEG: starts with \xFF\xD8\xFF
    (b"\xFF\xD8\xFF", SafeFileType.JPEG, {".jpg", ".jpeg"}),

    # OLE Compound File (legacy DOC/XLS)
    (b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1", SafeFileType.OLE, {".doc", ".xls"}),
]


def _inspect_zip_office_type(file_bytes: bytes) -> Optional[str]:
    """Inspect a ZIP-based office document to determine if it is DOCX or XLSX."""
    try:
        import zipfile
        import io
        with zipfile.ZipFile(io.BytesIO(file_bytes), 'r') as zf:
            if '[Content_Types].xml' in zf.namelist():
                content = zf.read('[Content_Types].xml').decode('utf-8', errors='ignore')
                if 'wordprocessingml.document' in content:
                    return SafeFileType.DOCX
                if 'spreadsheetml.sheet' in content:
                    return SafeFileType.XLSX
    except Exception:
        pass
    return None


def inspect_file_signature(file_bytes: bytes) -> Optional[str]:
    """Inspect file signature (magic bytes) to determine actual file type.

    Returns the MIME type if recognized, or None if the signature does not match
    any known safe type.
    """
    if not file_bytes or len(file_bytes) < 4:
        return None

    # Check for ZIP-based office documents first (DOCX / XLSX)
    if len(file_bytes) >= 4 and file_bytes.startswith(b"PK\x03\x04"):
        zip_type = _inspect_zip_office_type(file_bytes)
        if zip_type:
            return zip_type

    for signature, mime_type, _extensions in FILE_SIGNATURES:
        if len(file_bytes) >= len(signature) and file_bytes.startswith(signature):
            return mime_type

    return None


def validate_upload_file(
    upload: UploadFile,
    file_bytes: bytes,
    *,
    allowed_extensions: Optional[set[str]] = None,
    max_size_bytes: int = 10 * 1024 * 1024,
    require_signature_match: bool = True,
) -> tuple[str, str]:
    """Validate uploaded file using file signature inspection.
    
    Args:
        upload: The uploaded file
        file_bytes: The file content bytes
        allowed_extensions: Set of allowed extensions (default: PDF, PNG, JPG, JPEG)
        max_size_bytes: Maximum file size in bytes
        require_signature_match: Whether to require magic bytes match
    
    Returns:
        Tuple of (extension, verified_mime_type)
    
    Raises:
        HTTPException: If validation fails
    """
    if allowed_extensions is None:
        allowed_extensions = {".pdf", ".png", ".jpg", ".jpeg", ".docx", ".xlsx"}
    
    filename = (upload.filename or "").strip()
    if not filename:
        raise HTTPException(status_code=400, detail="File is missing a filename")
    
    extension = Path(filename).suffix.lower()
    
    # Check extension allowlist
    if extension not in allowed_extensions:
        allowed_list = ", ".join(sorted(ext.lstrip(".") for ext in allowed_extensions))
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{extension}'. Allowed: {allowed_list}",
        )
    
    # Check file size
    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail=f"'{filename}' is empty")
    
    if len(file_bytes) > max_size_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"'{filename}' exceeds the {max_size_bytes // (1024 * 1024)} MB size limit",
        )
    
    # Inspect file signature (magic bytes)
    if require_signature_match:
        detected_mime = inspect_file_signature(file_bytes)
        
        if detected_mime is None:
            raise HTTPException(
                status_code=400,
                detail=f"'{filename}' has an unrecognized or unsupported file format. "
                       "Only PDF, PNG, JPEG, Word, and Excel files are allowed.",
            )

        if detected_mime == SafeFileType.OLE:
            raise HTTPException(
                status_code=400,
                detail=f"'{filename}' uses a legacy Office format. Upload .docx or .xlsx instead.",
            )
        
        # Verify extension matches detected type
        expected_extensions = _get_extensions_for_mime(detected_mime)
        if extension not in expected_extensions:
            friendly = _friendly_type_name(detected_mime)
            raise HTTPException(
                status_code=400,
                detail=f"Type mismatch: this file is a {friendly}, not a {extension}. "
                       "Please rename it to the correct extension or re-save it.",
            )
        
        return extension, detected_mime
    
    # Fallback: use detected mime or guessed mime
    detected_mime = inspect_file_signature(file_bytes)
    if detected_mime:
        return extension, detected_mime
    
    import mimetypes
    guessed_mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return extension, guessed_mime


def _friendly_type_name(mime_type: str) -> str:
    """Return a user-friendly name for a detected MIME type."""
    names = {
        SafeFileType.PDF: "PDF",
        SafeFileType.PNG: "PNG",
        SafeFileType.JPEG: "JPEG",
        SafeFileType.JPG: "JPEG",
        SafeFileType.DOCX: "Word document",
        SafeFileType.XLSX: "Excel spreadsheet",
        SafeFileType.OLE: "legacy Office file",
    }
    return names.get(mime_type, "different file type")


def _get_extensions_for_mime(mime_type: str) -> set[str]:
    """Get the expected file extensions for a given MIME type."""
    mime_to_extensions = {
        SafeFileType.PDF: {".pdf"},
        SafeFileType.PNG: {".png"},
        SafeFileType.JPEG: {".jpg", ".jpeg"},
        SafeFileType.JPG: {".jpg", ".jpeg"},
        SafeFileType.OLE: {".doc", ".xls"},
        SafeFileType.DOCX: {".docx"},
        SafeFileType.XLSX: {".xlsx"},
    }
    return mime_to_extensions.get(mime_type, set())
