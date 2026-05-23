import base64
import hashlib
import hmac
import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from io import BytesIO
from pathlib import Path
from typing import Iterable
import mimetypes
import smtplib
import ssl
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from email.message import EmailMessage

from PIL import Image, ImageDraw
from sqlalchemy.orm import Session

from core.security_crypto import decrypt_optional_value, encrypt_optional_value
from core.security_hash import hash_optional_value
from core.security_phase2 import build_redacted_email, build_redacted_text, phase2_redaction_enabled
from database.models import (
    BranchOffice,
    RPTPaymentItem,
    RPTPaymentTransaction,
    RPTPaymentLog,
    RPTPaymentProof,
    RPTPaymentStatus,
    RPTPropertyRecord,
    RPTReleaseMethod,
    RPTSearchLog,
    Taxpayer,
)


SEARCH_LIMIT_PER_DAY = 50
PAYMONGO_API_URL = os.getenv("PAYMONGO_API_URL", "https://api.paymongo.com/v1")
PAYMONGO_SECRET_KEY = os.getenv("PAYMONGO_SECRET_KEY", "").strip()
PAYMONGO_WEBHOOK_SECRET = os.getenv("PAYMONGO_WEBHOOK_SECRET", "").strip()
RECAPTCHA_SECRET_KEY = os.getenv("RECAPTCHA_SECRET_KEY", "").strip()
ALLOW_RECAPTCHA_BYPASS = os.getenv("WARDS_RECAPTCHA_TEST_BYPASS", "true").lower() == "true"

PROOF_UPLOAD_DIR = Path(__file__).resolve().parents[1] / "output" / "payment_proofs"
OR_OUTPUT_DIR = Path(__file__).resolve().parents[1] / "output" / "official_receipts"

PROPERTY_SEEDS = [
    {
        "branch_code": "GALAS",
        "tdn": "G-006-00157",
        "taxpayer_name": "Justin Paolo M. Cortez",
        "property_address": "12 Maria Clara St., Galas, Quezon City",
        "fair_market_value": "1850000.00",
        "assessment_level": "20.00",
        "tax_year": 2026,
        "due_months": 1,
        "discount_rate": "0.0200",
    },
    {
        "branch_code": "GALAS",
        "tdn": "G-006-00158",
        "taxpayer_name": "Justin Paolo M. Cortez",
        "property_address": "14 Maria Clara St., Galas, Quezon City",
        "fair_market_value": "920000.00",
        "assessment_level": "20.00",
        "tax_year": 2026,
        "due_months": 0,
        "discount_rate": "0.0100",
    },
    {
        "branch_code": "D1",
        "tdn": "D-101-00421",
        "taxpayer_name": "Carla D. Fernandez",
        "property_address": "88 Banawe Ave., District 1, Quezon City",
        "fair_market_value": "2450000.00",
        "assessment_level": "20.00",
        "tax_year": 2026,
        "due_months": 2,
        "discount_rate": "0.0000",
    },
    {
        "branch_code": "NOVA",
        "tdn": "N-205-00984",
        "taxpayer_name": "Miguel R. Santos",
        "property_address": "Blk 9 Lot 7, Novaliches, Quezon City",
        "fair_market_value": "1325000.00",
        "assessment_level": "25.00",
        "tax_year": 2026,
        "due_months": 3,
        "discount_rate": "0.0000",
    },
]

BRANCH_SEEDS = [
    {"code": "GALAS", "name": "Galas Branch"},
    {"code": "D1", "name": "District 1 Branch"},
    {"code": "NOVA", "name": "Novaliches Branch"},
]

PAYMONGO_METHOD_MAP = {
    "GCASH": "gcash",
    "MAYA": "paymaya",
    "CARD": "card",
    "ONLINE_BANKING": "dob",
}


@dataclass
class ComputedRPTBreakdown:
    assessed_value: Decimal
    basic_tax_due: Decimal
    sef_tax: Decimal
    penalties: Decimal
    discounts: Decimal
    total_amount_due: Decimal


def quantize_money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def get_branch_code(branch: BranchOffice) -> str:
    return decrypt_optional_value(branch.code_enc) or branch.code


def get_branch_name(branch: BranchOffice) -> str:
    return decrypt_optional_value(branch.name_enc) or branch.name


def get_taxpayer_full_name(taxpayer: Taxpayer) -> str:
    return decrypt_optional_value(taxpayer.full_name_enc) or taxpayer.full_name


def get_taxpayer_email(taxpayer: Taxpayer) -> str:
    return decrypt_optional_value(taxpayer.email_enc) or taxpayer.email


def get_property_taxpayer_name(record: RPTPropertyRecord) -> str:
    return decrypt_optional_value(getattr(record, "taxpayer_name_enc", None)) or record.taxpayer_name


def get_property_address(record: RPTPropertyRecord) -> str:
    return decrypt_optional_value(getattr(record, "property_address_enc", None)) or record.property_address


def get_payment_item_taxpayer_name(item: RPTPaymentItem) -> str:
    return decrypt_optional_value(getattr(item, "taxpayer_name_enc", None)) or item.taxpayer_name


def get_payment_item_property_address(item: RPTPaymentItem) -> str:
    return decrypt_optional_value(getattr(item, "property_address_enc", None)) or item.property_address


def get_transaction_field(transaction: RPTPaymentTransaction, field_name: str):
    encrypted_value = getattr(transaction, f"{field_name}_enc", None)
    return decrypt_optional_value(encrypted_value) or getattr(transaction, field_name)


def get_payment_proof_field(proof: RPTPaymentProof, field_name: str):
    encrypted_value = getattr(proof, f"{field_name}_enc", None)
    return decrypt_optional_value(encrypted_value) or getattr(proof, field_name)


def get_payment_log_field(log: RPTPaymentLog, field_name: str):
    encrypted_value = getattr(log, f"{field_name}_enc", None)
    return decrypt_optional_value(encrypted_value) or getattr(log, field_name)


def initialize_rpt_demo_data(db: Session) -> None:
    if db.query(BranchOffice).count() == 0:
        for branch in BRANCH_SEEDS:
            db.add(
                BranchOffice(
                    code=branch["code"],
                    code_enc=encrypt_optional_value(branch["code"]),
                    name=branch["name"],
                    name_enc=encrypt_optional_value(branch["name"]),
                )
            )
        db.commit()

    existing_tdns = {tdn for (tdn,) in db.query(RPTPropertyRecord.tdn).all()}
    branches = {get_branch_code(branch): branch for branch in db.query(BranchOffice).all()}

    created = False
    for item in PROPERTY_SEEDS:
        if item["tdn"] in existing_tdns:
            continue
        branch = branches[item["branch_code"]]
        db.add(
            RPTPropertyRecord(
                branch_id=branch.id,
                tdn=item["tdn"],
                taxpayer_name=item["taxpayer_name"],
                taxpayer_name_enc=encrypt_optional_value(item["taxpayer_name"]),
                property_address=item["property_address"],
                property_address_enc=encrypt_optional_value(item["property_address"]),
                fair_market_value=Decimal(item["fair_market_value"]),
                assessment_level=Decimal(item["assessment_level"]),
                tax_year=item["tax_year"],
                due_months=item["due_months"],
                discount_rate=Decimal(item["discount_rate"]),
            )
        )
        created = True

    if created:
        db.commit()


def compute_rpt_breakdown(record: RPTPropertyRecord) -> ComputedRPTBreakdown:
    fair_market_value = Decimal(record.fair_market_value)
    assessment_level = Decimal(record.assessment_level) / Decimal("100")
    assessed_value = quantize_money(fair_market_value * assessment_level)
    basic_tax_due = quantize_money(assessed_value * Decimal("0.02"))
    sef_tax = quantize_money(assessed_value * Decimal("0.01"))
    subtotal = basic_tax_due + sef_tax
    penalties = quantize_money(subtotal * Decimal("0.02") * Decimal(record.due_months))
    discounts = quantize_money(subtotal * Decimal(record.discount_rate))
    total_amount_due = quantize_money(subtotal + penalties - discounts)
    return ComputedRPTBreakdown(
        assessed_value=assessed_value,
        basic_tax_due=basic_tax_due,
        sef_tax=sef_tax,
        penalties=penalties,
        discounts=discounts,
        total_amount_due=total_amount_due,
    )


def list_active_branches(db: Session) -> list[BranchOffice]:
    branches = db.query(BranchOffice).filter(BranchOffice.is_active == True).all()
    return sorted(branches, key=get_branch_name)


def normalize_tdn(tdn: str) -> str:
    return tdn.strip().upper()


def is_valid_tdn_format(tdn: str) -> bool:
    normalized = normalize_tdn(tdn)
    parts = normalized.split("-")
    return len(parts) == 3 and len(parts[0]) == 1 and parts[0].isalpha() and parts[1].isdigit() and len(parts[1]) == 3 and parts[2].isdigit() and len(parts[2]) == 5


def searches_used_today(db: Session, taxpayer_id: int) -> int:
    start_of_day = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_day = start_of_day + timedelta(days=1)
    return (
        db.query(RPTSearchLog)
        .filter(
            RPTSearchLog.taxpayer_id == taxpayer_id,
            RPTSearchLog.created_at >= start_of_day,
            RPTSearchLog.created_at < end_of_day,
        )
        .count()
    )


def searches_remaining_today(db: Session, taxpayer_id: int) -> int:
    return max(0, SEARCH_LIMIT_PER_DAY - searches_used_today(db, taxpayer_id))


def record_search(db: Session, taxpayer_id: int, branch_id: int, searched_tdn: str, was_found: bool) -> None:
    stored_tdn = (
        build_redacted_text("SEARCHTDN", searched_tdn, 30)
        if phase2_redaction_enabled() else searched_tdn
    )
    db.add(
        RPTSearchLog(
            taxpayer_id=taxpayer_id,
            branch_id=branch_id,
            searched_tdn=stored_tdn,
            searched_tdn_enc=encrypt_optional_value(searched_tdn),
            searched_tdn_hash=hash_optional_value(searched_tdn),
            was_found=was_found,
        )
    )
    db.commit()


def serialize_property(branch: BranchOffice, record: RPTPropertyRecord) -> dict:
    breakdown = compute_rpt_breakdown(record)
    return {
        "property_id": record.id,
        "branch_id": branch.id,
        "branch_name": get_branch_name(branch),
        "tdn": record.tdn,
        "taxpayer_name": get_property_taxpayer_name(record),
        "property_address": get_property_address(record),
        "fair_market_value": float(quantize_money(Decimal(record.fair_market_value))),
        "assessment_level": float(Decimal(record.assessment_level)),
        "assessed_value": float(breakdown.assessed_value),
        "basic_tax_due": float(breakdown.basic_tax_due),
        "sef_tax": float(breakdown.sef_tax),
        "penalties": float(breakdown.penalties),
        "discounts": float(breakdown.discounts),
        "final_total_amount_due": float(breakdown.total_amount_due),
        "amount_to_pay": float(breakdown.total_amount_due),
        "tax_year": record.tax_year,
    }


def append_payment_log(db: Session, transaction_id: int, status: RPTPaymentStatus, message: str, actor: str) -> None:
    stored_message = build_redacted_text("PAYLOG", message, 65535) if phase2_redaction_enabled() else message
    stored_actor = build_redacted_text("ACTOR", actor, 120) if phase2_redaction_enabled() else actor
    db.add(
        RPTPaymentLog(
            transaction_id=transaction_id,
            status=status,
            message=stored_message,
            message_enc=encrypt_optional_value(message),
            message_hash=hash_optional_value(message),
            actor=stored_actor,
            actor_enc=encrypt_optional_value(actor),
            actor_hash=hash_optional_value(actor),
        )
    )
    db.commit()


def send_official_receipt_email(
    recipient_email: str,
    official_receipt_number: str,
    taxpayer_name: str,
    pdf_relative_path: str,
) -> None:
    smtp_host = os.getenv("BREVO_SMTP_HOST", "smtp-relay.brevo.com").strip()
    smtp_port = int(os.getenv("BREVO_SMTP_PORT", "587"))
    smtp_username = os.getenv("BREVO_SMTP_USERNAME", "").strip()
    smtp_password = os.getenv("BREVO_SMTP_PASSWORD", "").strip()
    sender_email = os.getenv("BREVO_SENDER_EMAIL", "team.nano25@gmail.com").strip()
    sender_name = os.getenv("BREVO_SENDER_NAME", "WARDS Treasury Services").strip()

    if not all([smtp_username, smtp_password, sender_email]):
        raise RuntimeError("Brevo SMTP settings are incomplete.")

    attachment_path = Path(__file__).resolve().parents[1] / pdf_relative_path
    if not attachment_path.exists():
        raise RuntimeError("Official Receipt PDF file was not found.")

    message = EmailMessage()
    message["Subject"] = f"Your WARDS Official Receipt {official_receipt_number}"
    message["From"] = f"{sender_name} <{sender_email}>"
    message["To"] = recipient_email
    message.set_content(
        "\n".join(
            [
                "WARDS Treasury Services",
                "",
                f"Hello {taxpayer_name or 'Taxpayer'},",
                "",
                f"Attached is your Computerized Official Receipt ({official_receipt_number}).",
                "Please keep this copy for your records.",
            ]
        )
    )

    mime_type, _ = mimetypes.guess_type(attachment_path.name)
    maintype, subtype = (mime_type or "application/pdf").split("/", 1)
    message.add_attachment(
        attachment_path.read_bytes(),
        maintype=maintype,
        subtype=subtype,
        filename=attachment_path.name,
    )

    context = ssl.create_default_context()
    with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
        server.ehlo()
        server.starttls(context=context)
        server.ehlo()
        server.login(smtp_username, smtp_password)
        server.send_message(message)


def build_wards_transaction_number(transaction_id: int) -> str:
    return f"WARDS-RPT-{datetime.utcnow():%Y%m%d}-{transaction_id:06d}"


def build_receipt_number(transaction_id: int) -> str:
    return f"OR-{datetime.utcnow():%Y%m%d}-{transaction_id:06d}"


def build_verification_code(transaction_number: str) -> str:
    return hashlib.sha256(transaction_number.encode("utf-8")).hexdigest()[:16].upper()


def create_paymongo_checkout_session(
    taxpayer: Taxpayer,
    wards_transaction_no: str,
    payment_method: str,
    items: Iterable[dict],
    total_amount: Decimal,
    success_url: str,
    cancel_url: str,
) -> dict:
    if not PAYMONGO_SECRET_KEY:
        raise RuntimeError("PAYMONGO_SECRET_KEY is not configured.")

    taxpayer_name = get_taxpayer_full_name(taxpayer)
    taxpayer_email = get_taxpayer_email(taxpayer)
    paymongo_payment_method = PAYMONGO_METHOD_MAP[payment_method]
    payload = {
        "data": {
            "attributes": {
                "billing": {
                    "name": taxpayer_name,
                    "email": taxpayer_email,
                },
                "description": f"RPT online payment for {taxpayer_name}",
                "line_items": [
                    {
                        "currency": "PHP",
                        "amount": int(quantize_money(Decimal(item["total_amount"])) * 100),
                        "name": f"Real Property Tax - {item['tdn']}",
                        "description": item["property_address"],
                        "quantity": 1,
                    }
                    for item in items
                ],
                "payment_method_types": [paymongo_payment_method],
                "reference_number": wards_transaction_no,
                "send_email_receipt": True,
                "show_description": True,
                "show_line_items": True,
                "success_url": success_url,
                "cancel_url": cancel_url,
                "metadata": {
                    "wards_transaction_no": wards_transaction_no,
                    "taxpayer_email": taxpayer_email,
                    "taxpayer_name": taxpayer_name,
                    "payment_method": payment_method,
                    "total_amount": f"{quantize_money(total_amount):.2f}",
                },
            }
        }
    }

    encoded_key = base64.b64encode(f"{PAYMONGO_SECRET_KEY}:".encode("utf-8")).decode("utf-8")
    request = Request(
        url=f"{PAYMONGO_API_URL}/checkout_sessions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "accept": "application/json",
            "content-type": "application/json",
            "authorization": f"Basic {encoded_key}",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=20) as response:
            response_body = response.read().decode("utf-8")
            return json.loads(response_body)
    except HTTPError as exc:
        response_body = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"PayMongo checkout creation failed: {response_body or exc.reason}") from exc
    except URLError as exc:
        raise RuntimeError(f"PayMongo checkout creation failed: {exc.reason}") from exc


def verify_recaptcha_token(token: str) -> bool:
    if RECAPTCHA_SECRET_KEY and token:
        payload = urlencode({"secret": RECAPTCHA_SECRET_KEY, "response": token}).encode("utf-8")
        request = Request(
            url="https://www.google.com/recaptcha/api/siteverify",
            data=payload,
            headers={"content-type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=10) as response:
                body = json.loads(response.read().decode("utf-8"))
                return bool(body.get("success"))
        except Exception:
            return False
    return ALLOW_RECAPTCHA_BYPASS


def verify_paymongo_signature(raw_body: bytes, signature_header: str) -> bool:
    if not PAYMONGO_WEBHOOK_SECRET or not signature_header:
        return False

    pieces = {}
    for item in signature_header.split(","):
        if "=" not in item:
            continue
        key, value = item.split("=", 1)
        pieces[key.strip()] = value.strip()

    timestamp = pieces.get("t")
    test_signature = pieces.get("te")
    if not timestamp or not test_signature:
        return False

    signed_payload = f"{timestamp}.{raw_body.decode('utf-8')}".encode("utf-8")
    computed = hmac.new(
        PAYMONGO_WEBHOOK_SECRET.encode("utf-8"),
        signed_payload,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(computed, test_signature)


def save_payment_proof(file_bytes: bytes, filename: str, transaction_number: str) -> str:
    PROOF_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = f"{transaction_number}_{Path(filename).name}"
    target = PROOF_UPLOAD_DIR / safe_name
    target.write_bytes(file_bytes)
    return str(target.relative_to(Path(__file__).resolve().parents[1]))


def _draw_qr_pattern(draw: ImageDraw.ImageDraw, seed_text: str, top_left: tuple[int, int], size: int) -> None:
    digest = hashlib.sha256(seed_text.encode("utf-8")).digest()
    bits = "".join(f"{byte:08b}" for byte in digest) * 32
    grid_size = 29
    cell = size // grid_size
    x0, y0 = top_left

    def draw_finder(offset_x: int, offset_y: int) -> None:
        for row in range(7):
            for col in range(7):
                border = row in {0, 6} or col in {0, 6}
                center = 2 <= row <= 4 and 2 <= col <= 4
                if border or center:
                    draw.rectangle(
                        [
                            x0 + (offset_x + col) * cell,
                            y0 + (offset_y + row) * cell,
                            x0 + (offset_x + col + 1) * cell,
                            y0 + (offset_y + row + 1) * cell,
                        ],
                        fill="black",
                    )

    draw_finder(0, 0)
    draw_finder(grid_size - 7, 0)
    draw_finder(0, grid_size - 7)

    bit_index = 0
    for row in range(grid_size):
        for col in range(grid_size):
            in_finder = (
                (row < 7 and col < 7)
                or (row < 7 and col >= grid_size - 7)
                or (row >= grid_size - 7 and col < 7)
            )
            if in_finder:
                continue
            if bits[bit_index] == "1":
                draw.rectangle(
                    [
                        x0 + col * cell,
                        y0 + row * cell,
                        x0 + (col + 1) * cell,
                        y0 + (row + 1) * cell,
                    ],
                    fill="black",
                )
            bit_index += 1


def generate_official_receipt_pdf(transaction: dict, items: list[dict]) -> str:
    OR_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", (1240, 1754), "white")
    draw = ImageDraw.Draw(image)

    draw.text((70, 60), "City Treasurer's Office", fill="black")
    draw.text((70, 100), "Computerized Official Receipt", fill="black")
    draw.text((70, 150), f"OR Number: {transaction['official_receipt_number']}", fill="black")
    draw.text((70, 185), f"WARDS Transaction: {transaction['wards_transaction_no']}", fill="black")
    draw.text((70, 220), f"Taxpayer: {transaction['taxpayer_name']}", fill="black")
    draw.text((70, 255), f"Branch: {transaction['branch_name']}", fill="black")
    draw.text((70, 290), f"Payment Method: {transaction['payment_method']}", fill="black")
    draw.text((70, 325), f"Amount Paid: PHP {transaction['total_amount']:.2f}", fill="black")
    draw.text((70, 360), f"Generated At: {datetime.utcnow():%Y-%m-%d %H:%M UTC}", fill="black")

    y = 440
    draw.text((70, y), "Covered RPT Items", fill="black")
    y += 40
    for item in items:
        draw.text((90, y), f"{item['tdn']} - {item['property_address']}", fill="black")
        y += 28
        draw.text((110, y), f"Basic: PHP {item['basic_tax_due']:.2f} | SEF: PHP {item['sef_tax']:.2f} | Penalties: PHP {item['penalties']:.2f} | Discounts: PHP {item['discounts']:.2f}", fill="black")
        y += 42

    draw.text((70, y + 20), "Verification QR", fill="black")
    _draw_qr_pattern(draw, transaction["official_receipt_qr_code"], (70, y + 60), 320)
    draw.text((430, y + 90), f"Verification Code: {transaction['official_receipt_qr_code']}", fill="black")
    draw.text((430, y + 130), "Present this code to the Branch Treasury Office for validation.", fill="black")

    output_path = OR_OUTPUT_DIR / f"{transaction['official_receipt_number']}.pdf"
    image.save(output_path, "PDF", resolution=300.0)
    return str(output_path.relative_to(Path(__file__).resolve().parents[1]))
