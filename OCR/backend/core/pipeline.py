import os
import json
import re
from PIL import Image
from dotenv import load_dotenv

# =========================
# ENV + PATHS
# =========================
load_dotenv()

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INPUT_DIR = os.path.join(BASE_DIR, "input")
OUTPUT_DIR = os.path.join(BASE_DIR, "output")

os.makedirs(INPUT_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

API_KEY = os.getenv("LLMWHISPERER_API_KEY")


def _build_llmwhisperer_client():
    if not API_KEY:
        raise RuntimeError("LLMWHISPERER_API_KEY not found")

    try:
        from unstract.llmwhisperer import LLMWhispererClientV2
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "LLMWhisperer dependency is missing. Install unstract-llmwhisperer in the backend environment."
        ) from exc

    return LLMWhispererClientV2(
        base_url="https://llmwhisperer-api.us-central.unstract.com/api/v2",
        api_key=API_KEY
    )

# =========================
# IMAGE → PDF
# =========================
def image_to_pdf(image_path: str) -> str:
    base = os.path.splitext(os.path.basename(image_path))[0]
    pdf_path = os.path.join(OUTPUT_DIR, f"{base}.pdf")

    with Image.open(image_path) as img:
        if img.mode != "RGB":
            img = img.convert("RGB")
        img.save(pdf_path, "PDF", resolution=300)

    return pdf_path

# =========================
# OCR
# =========================
def parse_with_llmwhisperer(pdf_path: str) -> dict:
    client = _build_llmwhisperer_client()

    try:
        return client.whisper(
            file_path=pdf_path,
            wait_for_completion=True,
            wait_timeout=200
        )
    except Exception as e:
        raise RuntimeError(str(e))

# =====================================================
# ✅ ADDED: TAXPAYER NAME CLEANER (SAFE, ISOLATED)
# =====================================================
def clean_taxpayer_name(name: str) -> str:
    if not name:
        return ""

    STOP_WORDS = [
        "NATURE OF COLLECTION",
        "FUND",
        "ACCOUNT",
        "AMOUNT",
        "CODE",
        "TOTAL",
        "DATE"
    ]

    upper = name.upper()
    for word in STOP_WORDS:
        idx = upper.find(word)
        if idx != -1:
            name = name[:idx]
            break

    # normalize spaces
    name = re.sub(r"\s{2,}", " ", name)
    return name.strip()

# =====================================================
# RPT EXTRACTION (PRINTED – FINAL / STABLE)
# =====================================================
def extract_rpt_fields(text: str) -> dict:
    text = re.sub(r"[ \t]+", " ", text)
    lines = [l.strip() for l in text.splitlines() if l.strip()]

    taxpayer = ""
    for i, l in enumerate(lines):
        if re.search(r"\bpayor\b", l, re.I):
            taxpayer = re.sub(r"(?i)payor", "", l).strip()

            j = i + 1
            while j < len(lines) and not re.search(r"\d", lines[j]):
                taxpayer += " " + lines[j]
                j += 1
            break

    # ✅ APPLY CLEANUP (ADDED)
    taxpayer = clean_taxpayer_name(taxpayer)

    date_match = re.search(r"\b(\d{1,2}/\d{1,2}/\d{4})\b", text)
    tax_code_match = re.search(r"\b([A-Z]-\d{3}-\d{5})\b", text)

    amount_match = re.search(
        r"(TOTAL|Grand\s*Total)\s*([\d,]+\.\d{2})",
        text,
        re.I
    )

    return {
        "taxpayer_name": taxpayer,
        "transaction_date": date_match.group(1) if date_match else "",
        "tax_declaration": tax_code_match.group(1) if tax_code_match else "",
        "amount": amount_match.group(2) if amount_match else ""
    }

# =====================================================
# MISC EXTRACTION (HANDWRITTEN – FINAL FIX)
# =====================================================
def extract_misc_fields(text: str) -> dict:
    lines = [l.rstrip() for l in text.splitlines() if l.strip()]

    taxpayer = ""
    nature = ""
    amount = ""

    # -------------------------
    # TAXPAYER NAME (PAYGR)
    # -------------------------
    for i, line in enumerate(lines):
        if re.search(r"\bPAYGR\b", line, re.I):
            if i + 1 < len(lines):
                taxpayer = re.sub(r"[^A-Za-z\s]", "", lines[i + 1]).strip()
            break

    # ✅ APPLY CLEANUP (ADDED)
    taxpayer = clean_taxpayer_name(taxpayer)

    # -------------------------
    # NATURE + AMOUNT (TABLE ROW)
    # -------------------------
    for i, line in enumerate(lines):
        if re.search(r"NATURE OF COLLECTION", line, re.I):
            for j in range(i + 1, len(lines)):
                row = lines[j]

                if re.search(r"ACCOUNT|CODE", row, re.I):
                    continue

                m = re.search(r"([A-Za-z ]+)\s+([\d,]+\.\d{2})", row)
                if m:
                    nature = m.group(1).strip()
                    amount = m.group(2)
                    break
            break

    date_match = re.search(
        r"\b(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b",
        text
    )

    return {
        "taxpayer_name": taxpayer,
        "transaction_date": date_match.group(1) if date_match else "",
        "tax_declaration": nature,
        "amount": amount
    }

# =====================================================
# BUSINESS TAX EXTRACTION 
# =====================================================
def extract_business_fields(text: str) -> dict:
    lines = [l.strip() for l in text.splitlines() if l.strip()]

    taxpayer = ""
    mayors_permit_no = ""

    # -------------------------
    # COMPANY NAME (PAYOR)
    # -------------------------
    for i, line in enumerate(lines):
        if re.search(r"\bPAYOR\b", line, re.I):
            taxpayer = re.sub(r"(?i)payor", "", line).strip()
            if i + 1 < len(lines):
                taxpayer += " " + lines[i + 1]
            break

    taxpayer = clean_taxpayer_name(taxpayer)

    # -------------------------
    # MAYOR'S PERMIT NO.
    # Example: 05-012126
    # -------------------------
    permit_match = re.search(
        r"\b\d{2}-\d{6}\b",
        text
    )
    if permit_match:
        mayors_permit_no = permit_match.group(0)

    # -------------------------
    # DATE (same style as RPT)
    # -------------------------
    date_match = re.search(
        r"\b(\d{1,2}/\d{1,2}/\d{4})\b",
        text
    )

    return {
        "taxpayer_name": taxpayer,
        "transaction_date": date_match.group(1) if date_match else "",
        "mayors_permit_no": mayors_permit_no,
        "amount": ""  # user fills this
    }

# =====================================================
# PIPELINE ROUTER
# =====================================================
def run_pipeline(image_filename: str, category: str) -> dict:
    category = category.upper()

    image_path = os.path.join(INPUT_DIR, image_filename)
    if not os.path.exists(image_path):
        raise RuntimeError("Uploaded image not found")

    pdf_path = image_to_pdf(image_path)
    whisper = parse_with_llmwhisperer(pdf_path)
    raw_text = whisper.get("extraction", {}).get("result_text", "")

    with open(os.path.join(OUTPUT_DIR, "whisperer.json"), "w", encoding="utf-8") as f:
        json.dump(whisper, f, indent=2)

    if category == "RPT":
        fields = extract_rpt_fields(raw_text)
    elif category == "MISC":
        fields = extract_misc_fields(raw_text)
    elif category == "BUSINESS":
        fields = extract_business_fields(raw_text)
    else:
        raise RuntimeError("Unsupported category")

    return {
        "image_path": f"input/{image_filename}",
        "raw_ocr": raw_text,
        "extracted_fields": fields
    }
