import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from core.pipeline import run_pipeline
from core.security_crypto import decrypt_optional_value, encrypt_optional_value
from core.security_hash import hash_optional_value
from core.security_phase2 import build_redacted_amount, build_redacted_text, phase2_redaction_enabled
from database.config import get_db
from database.models import Receipt, ReceiptCategory

router = APIRouter(prefix="/api/receipts", tags=["receipts"])

ALLOWED_TYPES = ["image/jpeg", "image/png"]
MAX_SIZE = 10 * 1024 * 1024  # 10MB


@router.post("/process")
async def process_receipt(
    category: str = Form(...),
    file: UploadFile = File(...),
):
    category = category.upper().strip()

    if category not in ["RPT", "MISC", "BUSINESS"]:
        raise HTTPException(400, "Unsupported category")

    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, "Invalid file type")

    contents = await file.read()
    if len(contents) > MAX_SIZE:
        raise HTTPException(400, "File too large")

    os.makedirs("input", exist_ok=True)
    filename = os.path.basename(file.filename)
    image_path = os.path.join("input", filename)

    with open(image_path, "wb") as f:
        f.write(contents)

    result = run_pipeline(filename, category)

    return {
        "status": "success",
        "category": category,
        "image_path": result["image_path"],
        "raw_ocr": result["raw_ocr"],
        "extracted_fields": result["extracted_fields"],
    }


@router.post("/save")
def save_receipt(
    category: str = Form(None),
    taxpayer_name: str = Form(None),
    transaction_date: str = Form(None),
    tax_declaration_no: str = Form(None),
    nature_of_collection: str = Form(None),
    amount_paid: str = Form(None),
    image_path: str = Form(None),
    db: Session = Depends(get_db),
):
    try:
        print("SAVE RECEIPT PAYLOAD:")
        print(
            {
                "category": category,
                "taxpayer_name": taxpayer_name,
                "transaction_date": transaction_date,
                "tax_declaration_no": tax_declaration_no,
                "nature_of_collection": nature_of_collection,
                "amount_paid": amount_paid,
                "image_path": image_path,
            }
        )

        if not category or not taxpayer_name or not amount_paid or not image_path:
            raise HTTPException(400, "Missing required fields")

        category = category.strip().upper()

        if category not in ["RPT", "MISC", "BUSINESS"]:
            raise HTTPException(400, f"Invalid category: {category}")

        normalized_amount_paid = amount_paid.replace(",", "").strip()
        stored_taxpayer_name = taxpayer_name.strip()
        stored_transaction_date = transaction_date
        stored_tax_declaration_no = tax_declaration_no
        stored_nature_of_collection = nature_of_collection
        stored_amount_paid = normalized_amount_paid

        if phase2_redaction_enabled():
            stored_taxpayer_name = build_redacted_text("RECEIPTNAME", taxpayer_name, 150)
            stored_transaction_date = build_redacted_text("RECEIPTDATE", transaction_date, 50) if transaction_date else transaction_date
            stored_tax_declaration_no = build_redacted_text("RECEIPTTDN", tax_declaration_no, 100) if tax_declaration_no else tax_declaration_no
            stored_nature_of_collection = build_redacted_text("RECEIPTNATURE", nature_of_collection, 150) if nature_of_collection else nature_of_collection
            stored_amount_paid = build_redacted_amount()

        receipt = Receipt(
            category=ReceiptCategory[category],
            taxpayer_name=stored_taxpayer_name,
            taxpayer_name_enc=encrypt_optional_value(taxpayer_name),
            taxpayer_name_hash=hash_optional_value(taxpayer_name),
            transaction_date=stored_transaction_date,
            transaction_date_enc=encrypt_optional_value(transaction_date),
            transaction_date_hash=hash_optional_value(transaction_date),
            tax_declaration_no=stored_tax_declaration_no,
            tax_declaration_no_enc=encrypt_optional_value(tax_declaration_no),
            tax_declaration_no_hash=hash_optional_value(tax_declaration_no),
            nature_of_collection=stored_nature_of_collection,
            nature_of_collection_enc=encrypt_optional_value(nature_of_collection),
            nature_of_collection_hash=hash_optional_value(nature_of_collection),
            amount_paid=stored_amount_paid,
            amount_paid_enc=encrypt_optional_value(normalized_amount_paid),
            amount_paid_hash=hash_optional_value(normalized_amount_paid),
            image_path=image_path.strip(),
        )

        db.add(receipt)
        db.commit()
        db.refresh(receipt)

        return {"status": "success", "receipt_id": receipt.id}

    except Exception as e:
        db.rollback()
        print("SAVE RECEIPT ERROR:", repr(e))
        raise HTTPException(500, str(e))


@router.get("/")
def list_receipts(db: Session = Depends(get_db)):
    receipts = db.query(Receipt).order_by(Receipt.id.desc()).all()

    result = []
    for r in receipts:
        taxpayer_name = decrypt_optional_value(r.taxpayer_name_enc) or r.taxpayer_name
        transaction_date = decrypt_optional_value(r.transaction_date_enc) or r.transaction_date
        tax_declaration_no = decrypt_optional_value(r.tax_declaration_no_enc) or r.tax_declaration_no
        nature_of_collection = decrypt_optional_value(r.nature_of_collection_enc) or r.nature_of_collection
        amount_paid = decrypt_optional_value(r.amount_paid_enc) or r.amount_paid

        result.append(
            {
                "id": r.id,
                "category": r.category.value,
                "taxpayer_name": taxpayer_name,
                "transaction_date": transaction_date,
                "tax_declaration_no": tax_declaration_no,
                "nature_of_collection": nature_of_collection,
                "amount_paid": float(amount_paid),
                "image_path": r.image_path,
            }
        )

    return result


@router.delete("/{receipt_id}")
def delete_receipt(
    receipt_id: int,
    db: Session = Depends(get_db),
):
    receipt = db.query(Receipt).filter(Receipt.id == receipt_id).first()

    if not receipt:
        raise HTTPException(404, "Receipt not found")

    db.delete(receipt)
    db.commit()

    return {"status": "deleted"}
