import os
import asyncio
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile

from auth import get_current_admin_user
from services.ocr_runtime import run_ocr_in_executor
from services.ocr_service import OCRProcessingError, ocr_service
from utils.file_validation import validate_upload_file

router = APIRouter()

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads", "receipts")


@router.post("/process")
async def process_receipt_ocr(
    request: Request,
    file: UploadFile = File(...),
    category: str = Form("RPT"),
    current_user=Depends(get_current_admin_user),
):
    image_data = await file.read()
    validate_upload_file(
        file,
        image_data,
        allowed_extensions={".jpg", ".jpeg", ".png"},
    )
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    original_name = os.path.basename(file.filename or "receipt.jpg")
    safe_name = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{original_name}"
    file_path = os.path.join(UPLOAD_DIR, safe_name)

    with open(file_path, "wb") as output_file:
        output_file.write(image_data)

    try:
        result = await run_ocr_in_executor(
            ocr_service.process_receipt,
            image_path=file_path,
            filename=original_name,
            category=category,
        )
    except asyncio.TimeoutError as exc:
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except OSError:
                pass
        raise HTTPException(
            status_code=504,
            detail="Receipt OCR timed out. Please try again with a clearer or smaller image.",
        ) from exc
    except OCRProcessingError as exc:
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except OSError:
                pass
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except RuntimeError as exc:
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except OSError:
                pass
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    result["source_image_path"] = file_path
    result["category"] = category.upper().strip()
    return result
