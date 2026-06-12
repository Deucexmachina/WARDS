import json
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.models import ActivityLog, FAQ, PublicPageContent, TaxpayerGuide, get_db
from middleware.admin_auth import get_current_admin_user
from utils.field_crypto import apply_faq_security, apply_taxpayer_guide_security, get_decrypted_or_raw, hash_optional_value, taxpayer_guide_value
from utils.rbac import require_permission

router = APIRouter()

PAGE_TAXPAYER_GUIDE = "taxpayer_guide"
PAGE_CONTACT = "contact"
PAGE_ABOUT_US = "about_us"
PAGE_FAQS = "faqs"


class PublicContentPayload(BaseModel):
    content: dict[str, Any]


def _serialize_guide_rows(db: Session, language: str) -> list[dict[str, Any]]:
    normalized_language = (language or "en").strip().lower()
    language_hash = hash_optional_value(normalized_language)
    guides = (
        db.query(TaxpayerGuide)
        .filter(TaxpayerGuide.language_hash == language_hash, TaxpayerGuide.is_active.is_(True))
        .order_by(TaxpayerGuide.order.asc(), TaxpayerGuide.id.asc())
        .all()
    )
    return [
        {
            "title": taxpayer_guide_value(guide, "title"),
            "content": taxpayer_guide_value(guide, "content"),
            "category": taxpayer_guide_value(guide, "category"),
            "order": guide.order or 0,
        }
        for guide in guides
    ]


def _serialize_faq_rows(db: Session, language: str) -> list[dict[str, Any]]:
    normalized_language = (language or "en").strip().lower()
    language_hash = hash_optional_value(normalized_language)
    faqs = (
        db.query(FAQ)
        .filter(FAQ.language_hash == language_hash, FAQ.is_active.is_(True))
        .order_by(FAQ.order.asc(), FAQ.id.asc())
        .all()
    )
    return [
        {
            "question": get_decrypted_or_raw(faq, "question") or faq.question,
            "answer": get_decrypted_or_raw(faq, "answer") or faq.answer,
            "category": get_decrypted_or_raw(faq, "category") or faq.category,
            "order": faq.order or 0,
        }
        for faq in faqs
    ]


def _default_taxpayer_guide_page_settings() -> dict[str, Any]:
    return {
        "page_title_en": "Taxpayer's Guide",
        "page_title_tl": "Gabay ng Nagbabayad ng Buwis",
        "page_subtitle_en": "Comprehensive guides and procedures for all tax-related services",
        "page_subtitle_tl": "Komprehensibong gabay at pamamaraan para sa lahat ng serbisyong may kaugnayan sa buwis",
        "help_title_en": "Need More Help?",
        "help_title_tl": "Kailangan ng Karagdagang Tulong?",
        "help_description_en": "If you can't find the answer you're looking for, please contact us directly.",
        "help_description_tl": "Kung hindi mo mahanap ang sagot na iyong hinahanap, mangyaring makipag-ugnayan sa amin nang direkta.",
        "help_contacts": [
            {"label_en": "Phone", "label_tl": "Telepono", "value": "(02) 1234-5678"},
            {"label_en": "Email", "label_tl": "Email", "value": "treasurer@city.gov.ph"},
        ],
    }


def _default_contact_content() -> dict[str, Any]:
    return {
        "page_title_en": "Contact Us",
        "page_title_tl": "Makipag-ugnayan sa Amin",
        "page_subtitle_en": "Get in touch with our branch offices",
        "page_subtitle_tl": "Makipag-ugnayan sa aming mga sangay na tanggapan",
        "main_office_title_en": "Main Office",
        "main_office_title_tl": "Pangunahing Tanggapan",
        "office_name": "Quezon City Treasurer's Office",
        "address_lines": ["City Hall Complex, Main Street", "City Center, Metro Manila"],
        "contact_numbers": ["(02) 1234-5678", "(02) 8765-4321"],
        "email_addresses": ["treasurer@city.gov.ph", "info@citytreasurer.gov.ph"],
        "office_hours": [
            "Monday - Friday: 8:00 AM - 5:00 PM",
            "Weekend schedules may vary based on the branch's published operating hours.",
        ],
        "branch_section_title_en": "Branch Offices",
        "branch_section_title_tl": "Mga Sangay na Tanggapan",
        "form_title_en": "Send us a Message",
        "form_title_tl": "Magpadala ng Mensahe",
    }


def _merge_taxpayer_guide_page_content(db: Session, page_settings: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        **_default_taxpayer_guide_page_settings(),
        **(page_settings or {}),
        "guides_en": _serialize_guide_rows(db, "en"),
        "guides_tl": _serialize_guide_rows(db, "tl"),
    }


def _get_page_record(db: Session, page_key: str) -> PublicPageContent | None:
    return db.query(PublicPageContent).filter(PublicPageContent.page_key == page_key).first()


def _read_json_blob(raw_value: str | None, fallback: dict[str, Any]) -> dict[str, Any]:
    if not raw_value:
        return dict(fallback)
    try:
        parsed = json.loads(raw_value)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    return dict(fallback)


def _resolve_editor_content(db: Session, page_key: str) -> dict[str, Any]:
    if page_key == PAGE_TAXPAYER_GUIDE:
        record = _get_page_record(db, page_key)
        default_settings = _default_taxpayer_guide_page_settings()
        # Strip any stale guide rows that may exist in legacy blobs before merging
        raw_published = _read_json_blob(record.published_content_json if record else None, default_settings)
        base_settings = {k: v for k, v in raw_published.items() if k not in ("guides_en", "guides_tl")}
        raw_draft = _read_json_blob(record.draft_content_json if record else None, base_settings)
        editor_content = {k: v for k, v in raw_draft.items() if k not in ("guides_en", "guides_tl")}
        return _merge_taxpayer_guide_page_content(db, editor_content)

    record = _get_page_record(db, page_key)
    default_content = _default_contact_content()
    published = _read_json_blob(record.published_content_json if record else None, default_content)
    return _read_json_blob(record.draft_content_json if record else None, published)


def _resolve_public_content(db: Session, page_key: str) -> dict[str, Any]:
    record = _get_page_record(db, page_key)
    if page_key == PAGE_TAXPAYER_GUIDE:
        page_settings = _read_json_blob(record.published_content_json if record else None, _default_taxpayer_guide_page_settings())
        return _merge_taxpayer_guide_page_content(db, page_settings)

    return _read_json_blob(record.published_content_json if record else None, _default_contact_content())


def _sanitize_line_items(items: Any, key_names: list[str]) -> list[dict[str, str]]:
    if not isinstance(items, list):
        return []
    sanitized_items: list[dict[str, str]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        cleaned = {key: str(item.get(key, "")).strip() for key in key_names}
        if any(cleaned.values()):
            sanitized_items.append(cleaned)
    return sanitized_items


def _sanitize_text_list(items: Any) -> list[str]:
    if not isinstance(items, list):
        return []
    return [str(item).strip() for item in items if str(item).strip()]


def _normalize_taxpayer_guide_content(content: dict[str, Any]) -> dict[str, Any]:
    normalized = {
        "page_title_en": str(content.get("page_title_en", "")).strip(),
        "page_title_tl": str(content.get("page_title_tl", "")).strip(),
        "page_subtitle_en": str(content.get("page_subtitle_en", "")).strip(),
        "page_subtitle_tl": str(content.get("page_subtitle_tl", "")).strip(),
        "help_title_en": str(content.get("help_title_en", "")).strip(),
        "help_title_tl": str(content.get("help_title_tl", "")).strip(),
        "help_description_en": str(content.get("help_description_en", "")).strip(),
        "help_description_tl": str(content.get("help_description_tl", "")).strip(),
        "help_contacts": _sanitize_line_items(content.get("help_contacts"), ["label_en", "label_tl", "value"]),
        "guides_en": _sanitize_line_items(content.get("guides_en"), ["title", "content", "category"]),
        "guides_tl": _sanitize_line_items(content.get("guides_tl"), ["title", "content", "category"]),
    }

    if not normalized["page_title_en"] or not normalized["page_title_tl"]:
        raise HTTPException(status_code=400, detail="Taxpayer Guide page titles are required.")
    if not normalized["guides_en"] or not normalized["guides_tl"]:
        raise HTTPException(status_code=400, detail="At least one guide is required for both English and Tagalog.")

    return normalized


def _normalize_contact_content(content: dict[str, Any]) -> dict[str, Any]:
    normalized = {
        "page_title_en": str(content.get("page_title_en", "")).strip(),
        "page_title_tl": str(content.get("page_title_tl", "")).strip(),
        "page_subtitle_en": str(content.get("page_subtitle_en", "")).strip(),
        "page_subtitle_tl": str(content.get("page_subtitle_tl", "")).strip(),
        "main_office_title_en": str(content.get("main_office_title_en", "")).strip(),
        "main_office_title_tl": str(content.get("main_office_title_tl", "")).strip(),
        "office_name": str(content.get("office_name", "")).strip(),
        "address_lines": _sanitize_text_list(content.get("address_lines")),
        "contact_numbers": _sanitize_text_list(content.get("contact_numbers")),
        "email_addresses": _sanitize_text_list(content.get("email_addresses")),
        "office_hours": _sanitize_text_list(content.get("office_hours")),
        "branch_section_title_en": str(content.get("branch_section_title_en", "")).strip(),
        "branch_section_title_tl": str(content.get("branch_section_title_tl", "")).strip(),
        "form_title_en": str(content.get("form_title_en", "")).strip(),
        "form_title_tl": str(content.get("form_title_tl", "")).strip(),
    }

    required_fields = [
        "page_title_en",
        "page_title_tl",
        "main_office_title_en",
        "main_office_title_tl",
        "office_name",
    ]
    if any(not normalized[field] for field in required_fields):
        raise HTTPException(status_code=400, detail="Contact page titles and office name are required.")
    if not normalized["contact_numbers"] and not normalized["email_addresses"]:
        raise HTTPException(status_code=400, detail="Provide at least one contact number or email address.")

    return normalized


def _save_record(
    db: Session,
    *,
    record: PublicPageContent | None,
    page_key: str,
    draft_content: dict[str, Any] | None = None,
    published_content: dict[str, Any] | None = None,
    actor: str,
) -> PublicPageContent:
    next_record = record or PublicPageContent(page_key=page_key)
    if draft_content is not None:
        next_record.draft_content_json = json.dumps(draft_content)
        next_record.last_saved_at = datetime.utcnow()
        next_record.last_saved_by = actor
    if published_content is not None:
        next_record.published_content_json = json.dumps(published_content)
        next_record.published_at = datetime.utcnow()
        next_record.published_by = actor
    db.add(next_record)
    return next_record


def _write_taxpayer_guides(db: Session, guides: list[dict[str, str]], language: str) -> None:
    language_hash = hash_optional_value(language.strip().lower())
    db.query(TaxpayerGuide).filter(TaxpayerGuide.language_hash == language_hash).delete(synchronize_session=False)
    for index, guide in enumerate(guides, start=1):
        guide_record = TaxpayerGuide(
            title=guide["title"],
            content=guide["content"],
            category=guide["category"],
            language=language,
            order=index,
            is_active=True,
        )
        apply_taxpayer_guide_security(guide_record)
        db.add(guide_record)


def _write_faqs(db: Session, faqs: list[dict[str, str]], language: str) -> None:
    language_hash = hash_optional_value(language.strip().lower())
    db.query(FAQ).filter(FAQ.language_hash == language_hash).delete(synchronize_session=False)
    for index, faq in enumerate(faqs, start=1):
        faq_record = FAQ(
            question=faq["question"],
            answer=faq["answer"],
            category=faq["category"],
            language=language,
            order=index,
            is_active=True,
        )
        apply_faq_security(faq_record)
        db.add(faq_record)


def _log_public_content_activity(
    db: Session,
    *,
    request: Request,
    current_user,
    page_label: str,
    action_type: str,
) -> None:
    branch_name = getattr(current_user, "branch_id", None)
    details = (
        f"role: {current_user.role} | "
        f"page: {page_label} | "
        f"action_type: {action_type} | "
        f"branch: {branch_name if branch_name is not None else 'System-wide'} | "
        f"ip: {request.client.host if request.client else 'unknown'}"
    )
    db.add(
        ActivityLog(
            action=f"{action_type} Public Content",
            user=current_user.username,
            details=details,
            type="public_content",
        )
    )


def _authorize_content_manager(current_user):
    require_permission("manage_public_content")(current_user)
    if current_user.role not in {"superadmin", "main_admin"}:
        raise HTTPException(status_code=403, detail="Only Super Admin and Main Admin can manage public-facing content.")
    return current_user


def _default_about_us_content() -> dict[str, Any]:
    return {
        "page_title_en": "About Us",
        "page_title_tl": "Tungkol sa Amin",
        "page_subtitle_en": "Learn about the Quezon City Treasurer's Office — our mission, vision, and unwavering commitment to serving every taxpayer.",
        "page_subtitle_tl": "Alamin ang tungkol sa Tanggapan ng Ingat-Yaman ng Lungsod ng Quezon — ang aming misyon, bisyon, at walang pagbabagong pangako sa pagsisilbi sa bawat nagbabayad ng buwis.",
        "who_we_are_en": "The City Treasurer's Office (CTO) is the main revenue generating arm of the City, collecting various taxes and fees to support worthwhile City projects. CTO is responsible for managing the financial resources of the City Government while ensuring its fiscal growth and stability through improved collection methods and strategies in accordance with the revenue laws and ordinances.",
        "who_we_are_tl": "Ang Tanggapan ng Ingat-Yaman ng Lungsod (CTO) ang pangunahing sangay ng Lungsod na nagkukuha ng kita, nangungulekta ng iba't ibang buwis at bayarin para suportahan ang mahahalagang proyekto ng Lungsod.",
        "mission_items": [
            {"letter": "A", "text": "Advance the cause of the Quezon City Government to serve the people.", "text_tl": "Isulong ang layunin ng Pamahalaan ng Lungsod ng Quezon upang maglingkod sa mamamayan."},
            {"letter": "D", "text": "Develop organizational capacity to improve performance.", "text_tl": "Paunlarin ang kakayahan ng organisasyon upang mapabuti ang pagganap."},
            {"letter": "V", "text": "Venture into innovative strategies in financial management.", "text_tl": "Magsagawa ng mga makabagong estratehiya sa pamamahala ng pananalapi."},
            {"letter": "O", "text": "Organize further the Treasury to promote professionalism and specialization.", "text_tl": "Higit pang ayusin ang Ingat-Yaman upang maitaguyod ang propesyonalismo at espesyalisasyon."},
            {"letter": "C", "text": "Complement the efforts of the local government to provide infrastructure and basic services.", "text_tl": "Dagdagan ang mga pagsisikap ng lokal na pamahalaan na magbigay ng imprastraktura at pangunahing serbisyo."},
            {"letter": "A", "text": "Assist other Local Government Units through technical assistance.", "text_tl": "Tulungan ang ibang mga Lokal na Yunit ng Pamahalaan sa pamamagitan ng teknikal na tulong."},
            {"letter": "T", "text": "Translate the City's plans and programs for economic growth and self-reliance.", "text_tl": "Isalin ang mga plano at programa ng Lungsod para sa pag-unlad ng ekonomiya at pagsasarili."},
            {"letter": "E", "text": "Empower the Local Treasury through sound fiscal policy and effective financial management.", "text_tl": "Bigyang-lakas ang Lokal na Ingat-Yaman sa pamamagitan ng maingat na patakaran sa piskal at epektibong pamamahala ng pananalapi."},
        ],
        "vision_en": "To effectively meet the target collection yearly through innovative strategies and methods in financial management and continually improve the Quality Management System to ensure taxpayer satisfaction.",
        "vision_tl": "Epektibong matugunan ang target na koleksyon taun-taon sa pamamagitan ng mga makabagong estratehiya at pamamaraan sa pamamahala ng pananalapi.",
        "legal_basis_en": "The existence of the City Treasurer's Office in a local government unit is based on the provisions of Book II, Section 470 of Republic Act No. 7160 — Otherwise Known As The Local Government Code Of 1991.",
        "legal_basis_tl": "Ang pagkakaroon ng Tanggapan ng Ingat-Yaman ng Lungsod sa isang lokal na yunit ng pamahalaan ay batay sa mga probisyon ng Aklat II, Seksyon 470 ng Republika Blg. 7160.",
        "service_pledges": [
            {"number": "01", "text": "Perform our duties and responsibilities with utmost integrity, competence, and dedication in order to serve and to meet taxpayer satisfaction.", "text_tl": "Gampanan ang aming mga tungkulin at responsibilidad nang may buong integridad, kakayahan, at dedikasyon upang maglingkod at matugunan ang kasiyahan ng nagbabayad ng buwis."},
            {"number": "02", "text": "Pursue our goals objectively to attain office efficiency and meet the target collection to better serve our constituents.", "text_tl": "Ituloy ang aming mga layunin nang may obhetibidad upang makamit ang kahusayan ng tanggapan at matugunan ang target na koleksyon para mas mapagsilbihan ang aming mga nasasakupan."},
            {"number": "03", "text": "Attend to all taxpayers or requesting parties who are within the premises of the Office prior to the end of official working hours and during lunch break.", "text_tl": "Asikasuhin ang lahat ng nagbabayad ng buwis o mga humihiling na partido na nasa loob ng Tanggapan bago matapos ang opisyal na oras ng trabaho at sa oras ng tanghalian."},
        ],
        "city_hall_image": "",
        "office_image_1": "",
        "office_image_2": "",
        "office_image_3": "",
    }


def _default_faqs_page_settings() -> dict[str, Any]:
    return {
        "page_title_en": "Frequently Asked Questions",
        "page_title_tl": "Mga Madalas Itanong",
        "page_subtitle_en": "Find answers to common questions about our services.",
        "page_subtitle_tl": "Hanapin ang mga sagot sa mga karaniwang tanong tungkol sa aming mga serbisyo.",
    }


def _normalize_about_us_content(content: dict[str, Any]) -> dict[str, Any]:
    normalized = {
        "page_title_en": str(content.get("page_title_en", "")).strip(),
        "page_title_tl": str(content.get("page_title_tl", "")).strip(),
        "page_subtitle_en": str(content.get("page_subtitle_en", "")).strip(),
        "page_subtitle_tl": str(content.get("page_subtitle_tl", "")).strip(),
        "who_we_are_en": str(content.get("who_we_are_en", "")).strip(),
        "who_we_are_tl": str(content.get("who_we_are_tl", "")).strip(),
        "mission_items": _sanitize_line_items(content.get("mission_items"), ["letter", "text", "text_tl"]),
        "vision_en": str(content.get("vision_en", "")).strip(),
        "vision_tl": str(content.get("vision_tl", "")).strip(),
        "legal_basis_en": str(content.get("legal_basis_en", "")).strip(),
        "legal_basis_tl": str(content.get("legal_basis_tl", "")).strip(),
        "service_pledges": _sanitize_line_items(content.get("service_pledges"), ["number", "text", "text_tl"]),
        "city_hall_image": str(content.get("city_hall_image", "")).strip(),
        "office_image_1": str(content.get("office_image_1", "")).strip(),
        "office_image_2": str(content.get("office_image_2", "")).strip(),
        "office_image_3": str(content.get("office_image_3", "")).strip(),
    }
    if not normalized["page_title_en"] or not normalized["page_title_tl"]:
        raise HTTPException(status_code=400, detail="About Us page titles are required.")
    return normalized


def _normalize_faqs_content(content: dict[str, Any]) -> dict[str, Any]:
    normalized = {
        "page_title_en": str(content.get("page_title_en", "")).strip(),
        "page_title_tl": str(content.get("page_title_tl", "")).strip(),
        "page_subtitle_en": str(content.get("page_subtitle_en", "")).strip(),
        "page_subtitle_tl": str(content.get("page_subtitle_tl", "")).strip(),
        "faqs_en": _sanitize_line_items(content.get("faqs_en"), ["question", "answer", "category"]),
        "faqs_tl": _sanitize_line_items(content.get("faqs_tl"), ["question", "answer", "category"]),
    }
    if not normalized["page_title_en"] or not normalized["page_title_tl"]:
        raise HTTPException(status_code=400, detail="FAQs page titles are required.")
    if not normalized["faqs_en"] or not normalized["faqs_tl"]:
        raise HTTPException(status_code=400, detail="At least one FAQ is required for both English and Tagalog.")
    return normalized


@router.get("/public/taxpayer-guide")
async def get_public_taxpayer_guide_content(db: Session = Depends(get_db)):
    return _resolve_public_content(db, PAGE_TAXPAYER_GUIDE)


@router.get("/public/contact")
async def get_public_contact_content(db: Session = Depends(get_db)):
    return _resolve_public_content(db, PAGE_CONTACT)


@router.get("/taxpayer-guide")
async def get_taxpayer_guide_editor_content(
    current_user=Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    _authorize_content_manager(current_user)
    return _resolve_editor_content(db, PAGE_TAXPAYER_GUIDE)


def _strip_guide_rows(normalized: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of the normalized dict without the guide row lists.

    Guides are stored in the TaxpayerGuide table, not in the JSON blob.
    Keeping them in the blob causes duplication when the editor GET merges
    both sources on the next load.
    """
    return {k: v for k, v in normalized.items() if k not in ("guides_en", "guides_tl")}


@router.put("/taxpayer-guide/draft")
async def save_taxpayer_guide_draft(
    payload: PublicContentPayload,
    request: Request,
    current_user=Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    _authorize_content_manager(current_user)
    normalized = _normalize_taxpayer_guide_content(payload.content or {})
    # Write the guide rows to the DB so they survive as-of-draft
    _write_taxpayer_guides(db, normalized["guides_en"], "en")
    _write_taxpayer_guides(db, normalized["guides_tl"], "tl")
    # Store only page-level settings in the JSON blob — never the row lists
    blob = _strip_guide_rows(normalized)
    record = _get_page_record(db, PAGE_TAXPAYER_GUIDE)
    _save_record(db, record=record, page_key=PAGE_TAXPAYER_GUIDE, draft_content=blob, actor=current_user.username)
    _log_public_content_activity(db, request=request, current_user=current_user, page_label="Tax Payer Guide", action_type="Update Draft")
    db.commit()
    return {"message": "Taxpayer Guide draft saved successfully."}


@router.post("/taxpayer-guide/publish")
async def publish_taxpayer_guide(
    payload: PublicContentPayload,
    request: Request,
    current_user=Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    _authorize_content_manager(current_user)
    normalized = _normalize_taxpayer_guide_content(payload.content or {})
    _write_taxpayer_guides(db, normalized["guides_en"], "en")
    _write_taxpayer_guides(db, normalized["guides_tl"], "tl")
    blob = _strip_guide_rows(normalized)
    record = _get_page_record(db, PAGE_TAXPAYER_GUIDE)
    _save_record(
        db,
        record=record,
        page_key=PAGE_TAXPAYER_GUIDE,
        draft_content=blob,
        published_content=blob,
        actor=current_user.username,
    )
    _log_public_content_activity(db, request=request, current_user=current_user, page_label="Tax Payer Guide", action_type="Publish")
    db.commit()
    return {"message": "Taxpayer Guide published successfully."}


@router.get("/contact")
async def get_contact_editor_content(
    current_user=Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    _authorize_content_manager(current_user)
    return _resolve_editor_content(db, PAGE_CONTACT)


@router.put("/contact/draft")
async def save_contact_draft(
    payload: PublicContentPayload,
    request: Request,
    current_user=Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    _authorize_content_manager(current_user)
    normalized = _normalize_contact_content(payload.content or {})
    record = _get_page_record(db, PAGE_CONTACT)
    _save_record(db, record=record, page_key=PAGE_CONTACT, draft_content=normalized, actor=current_user.username)
    _log_public_content_activity(db, request=request, current_user=current_user, page_label="Contact", action_type="Update Draft")
    db.commit()
    return {"message": "Contact page draft saved successfully."}


@router.post("/contact/publish")
async def publish_contact(
    payload: PublicContentPayload,
    request: Request,
    current_user=Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    _authorize_content_manager(current_user)
    normalized = _normalize_contact_content(payload.content or {})
    record = _get_page_record(db, PAGE_CONTACT)
    _save_record(
        db,
        record=record,
        page_key=PAGE_CONTACT,
        draft_content=normalized,
        published_content=normalized,
        actor=current_user.username,
    )
    _log_public_content_activity(db, request=request, current_user=current_user, page_label="Contact", action_type="Publish")
    db.commit()
    return {"message": "Contact page published successfully."}


@router.get("/public/about-us")
async def get_public_about_us_content(db: Session = Depends(get_db)):
    record = _get_page_record(db, PAGE_ABOUT_US)
    return _read_json_blob(record.published_content_json if record else None, _default_about_us_content())


@router.get("/about-us")
async def get_about_us_editor_content(
    current_user=Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    _authorize_content_manager(current_user)
    record = _get_page_record(db, PAGE_ABOUT_US)
    default_content = _default_about_us_content()
    published = _read_json_blob(record.published_content_json if record else None, default_content)
    return _read_json_blob(record.draft_content_json if record else None, published)


@router.put("/about-us/draft")
async def save_about_us_draft(
    payload: PublicContentPayload,
    request: Request,
    current_user=Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    _authorize_content_manager(current_user)
    normalized = _normalize_about_us_content(payload.content or {})
    record = _get_page_record(db, PAGE_ABOUT_US)
    _save_record(db, record=record, page_key=PAGE_ABOUT_US, draft_content=normalized, actor=current_user.username)
    _log_public_content_activity(db, request=request, current_user=current_user, page_label="About Us", action_type="Update Draft")
    db.commit()
    return {"message": "About Us draft saved successfully."}


@router.post("/about-us/publish")
async def publish_about_us(
    payload: PublicContentPayload,
    request: Request,
    current_user=Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    _authorize_content_manager(current_user)
    normalized = _normalize_about_us_content(payload.content or {})
    record = _get_page_record(db, PAGE_ABOUT_US)
    _save_record(
        db,
        record=record,
        page_key=PAGE_ABOUT_US,
        draft_content=normalized,
        published_content=normalized,
        actor=current_user.username,
    )
    _log_public_content_activity(db, request=request, current_user=current_user, page_label="About Us", action_type="Publish")
    db.commit()
    return {"message": "About Us page published successfully."}


@router.get("/public/faqs")
async def get_public_faqs_content(db: Session = Depends(get_db)):
    record = _get_page_record(db, PAGE_FAQS)
    raw = _read_json_blob(record.published_content_json if record else None, _default_faqs_page_settings())
    page_settings = {k: v for k, v in raw.items() if k not in ("faqs_en", "faqs_tl")}
    return {
        **page_settings,
        "faqs_en": _serialize_faq_rows(db, "en"),
        "faqs_tl": _serialize_faq_rows(db, "tl"),
    }


@router.get("/faqs")
async def get_faqs_editor_content(
    current_user=Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    _authorize_content_manager(current_user)
    record = _get_page_record(db, PAGE_FAQS)
    default_settings = _default_faqs_page_settings()
    raw_published = _read_json_blob(record.published_content_json if record else None, default_settings)
    published = {k: v for k, v in raw_published.items() if k not in ("faqs_en", "faqs_tl")}
    raw_draft = _read_json_blob(record.draft_content_json if record else None, published)
    draft = {k: v for k, v in raw_draft.items() if k not in ("faqs_en", "faqs_tl")}
    return {
        **draft,
        "faqs_en": _serialize_faq_rows(db, "en"),
        "faqs_tl": _serialize_faq_rows(db, "tl"),
    }


def _strip_faq_rows(normalized: dict[str, Any]) -> dict[str, Any]:
    """Return a copy without the faq row lists.

    FAQs are stored in the FAQ table, not in the JSON blob. Keeping them in
    the blob causes duplication when the editor GET merges both sources.
    """
    return {k: v for k, v in normalized.items() if k not in ("faqs_en", "faqs_tl")}


@router.put("/faqs/draft")
async def save_faqs_draft(
    payload: PublicContentPayload,
    request: Request,
    current_user=Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    _authorize_content_manager(current_user)
    normalized = _normalize_faqs_content(payload.content or {})
    # Write FAQ rows to DB so the draft reflects the current editor state
    _write_faqs(db, normalized["faqs_en"], "en")
    _write_faqs(db, normalized["faqs_tl"], "tl")
    blob = _strip_faq_rows(normalized)
    record = _get_page_record(db, PAGE_FAQS)
    _save_record(db, record=record, page_key=PAGE_FAQS, draft_content=blob, actor=current_user.username)
    _log_public_content_activity(db, request=request, current_user=current_user, page_label="FAQs", action_type="Update Draft")
    db.commit()
    return {"message": "FAQs page draft saved successfully."}


@router.post("/faqs/publish")
async def publish_faqs(
    payload: PublicContentPayload,
    request: Request,
    current_user=Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    _authorize_content_manager(current_user)
    normalized = _normalize_faqs_content(payload.content or {})
    _write_faqs(db, normalized["faqs_en"], "en")
    _write_faqs(db, normalized["faqs_tl"], "tl")
    blob = _strip_faq_rows(normalized)
    record = _get_page_record(db, PAGE_FAQS)
    _save_record(
        db,
        record=record,
        page_key=PAGE_FAQS,
        draft_content=blob,
        published_content=blob,
        actor=current_user.username,
    )
    _log_public_content_activity(db, request=request, current_user=current_user, page_label="FAQs", action_type="Publish")
    db.commit()
    return {"message": "FAQs page published successfully."}


# ── Home Page ──────────────────────────────────────────────────────────────────

PAGE_HOME = "home"


def _default_home_content() -> dict[str, Any]:
    return {
        "hero_bg_image": "",
        "hero_title_en": "Welcome to Online Tax Services",
        "hero_title_tl": "Maligayang Pagdating sa Online Tax Services",
        "hero_subtitle_en": "Pay your taxes online and request official receipts through our secure government portal.",
        "hero_subtitle_tl": "Magbayad ng iyong buwis online at humingi ng opisyal na resibo sa pamamagitan ng aming ligtas at maaasahang government portal.",
        "btn_get_queue_en": "Get Queue Number",
        "btn_get_queue_tl": "Kumuha ng Queue Number",
        "btn_view_ticket_en": "View My Ticket",
        "btn_view_ticket_tl": "Tingnan ang Aking Ticket",
        "btn_pay_taxes_en": "Pay Taxes Online",
        "btn_pay_taxes_tl": "Magbayad ng Buwis Online",
        "btn_request_receipt_en": "Request Receipt",
        "btn_request_receipt_tl": "Humiling ng Resibo",
        "announcements_title_en": "Latest Announcements",
        "announcements_title_tl": "Mga Pinakabagong Anunsyo",
        "announcements_subtitle_en": "Stay updated with important notices from the City Treasurer's Office.",
        "announcements_subtitle_tl": "Manatiling updated sa mahahalagang anunsyo at abiso mula sa City Treasurer's Office.",
    }


def _normalize_home_content(content: dict[str, Any]) -> dict[str, Any]:
    defaults = _default_home_content()
    normalized: dict[str, Any] = {"hero_bg_image": str(content.get("hero_bg_image", "")).strip()}
    text_keys = [k for k in defaults if k != "hero_bg_image"]
    for key in text_keys:
        value = str(content.get(key, "")).strip()
        normalized[key] = value if value else defaults[key]
    return normalized


@router.get("/public/home")
async def get_public_home_content(db: Session = Depends(get_db)):
    record = _get_page_record(db, PAGE_HOME)
    return _read_json_blob(record.published_content_json if record else None, _default_home_content())


@router.get("/home")
async def get_home_editor_content(
    current_user=Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    _authorize_content_manager(current_user)
    record = _get_page_record(db, PAGE_HOME)
    default_content = _default_home_content()
    published = _read_json_blob(record.published_content_json if record else None, default_content)
    return _read_json_blob(record.draft_content_json if record else None, published)


@router.put("/home/draft")
async def save_home_draft(
    payload: PublicContentPayload,
    request: Request,
    current_user=Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    _authorize_content_manager(current_user)
    normalized = _normalize_home_content(payload.content or {})
    record = _get_page_record(db, PAGE_HOME)
    _save_record(db, record=record, page_key=PAGE_HOME, draft_content=normalized, actor=current_user.username)
    _log_public_content_activity(db, request=request, current_user=current_user, page_label="Home", action_type="Update Draft")
    db.commit()
    return {"message": "Home page draft saved successfully."}


@router.post("/home/publish")
async def publish_home(
    payload: PublicContentPayload,
    request: Request,
    current_user=Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    _authorize_content_manager(current_user)
    normalized = _normalize_home_content(payload.content or {})
    record = _get_page_record(db, PAGE_HOME)
    _save_record(
        db,
        record=record,
        page_key=PAGE_HOME,
        draft_content=normalized,
        published_content=normalized,
        actor=current_user.username,
    )
    _log_public_content_activity(db, request=request, current_user=current_user, page_label="Home", action_type="Publish")
    db.commit()
    return {"message": "Home page published successfully."}
