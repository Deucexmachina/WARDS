import os
from datetime import datetime

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from services.ocr_service import ocr_service

router = APIRouter()

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads", "receipts")


@router.post("/process")
async def process_receipt_ocr(
    file: UploadFile = File(...),
    category: str = Form("RPT"),
):
    image_data = await file.read()
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    original_name = os.path.basename(file.filename or "receipt.jpg")
    safe_name = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{original_name}"
    file_path = os.path.join(UPLOAD_DIR, safe_name)

    with open(file_path, "wb") as output_file:
        output_file.write(image_data)

    try:
        result = ocr_service.process_receipt(
            image_path=file_path,
            filename=original_name,
            category=category,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    result["source_image_path"] = file_path
    result["category"] = category.upper().strip()
    return result
