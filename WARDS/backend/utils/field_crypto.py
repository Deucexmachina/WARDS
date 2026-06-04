import base64
import hashlib
import hmac
import os
import re
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import or_


def _get_env_secret(name: str, fallback: str) -> str:
    value = (os.getenv(name) or "").strip()
    return value or fallback


def _build_fernet() -> Fernet:
    secret = _get_env_secret("DATA_ENCRYPTION_SECRET", "change-this-data-encryption-secret")
    key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest())
    return Fernet(key)


_FERNET = _build_fernet()
REDACTED_VALUE_PATTERN = re.compile(r"^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_[0-9a-fA-F]{6,64}$")
REDACTED_EMAIL_PATTERN = re.compile(r"^[a-z0-9_.+-]+_[0-9a-fA-F]{6,64}@redacted\.local$")
REDACTED_PREFIX_ONLY_PATTERN = re.compile(
    r"^(?:ANNOUNCEMENT|BRANCH|BT|BUSINESS|CITIZEN|DISC|FAQ|GUIDE|INVITE|MAYOR|MEMO|MFA|OTP|PAY|QUEUE|RECEIPT|REGISTRATION|RPT|SERVICE|SUBMISSION|TAX|VERIFY|WINDOW)(?:_[A-Z0-9]+)+$"
)


def encrypt_optional_value(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return _FERNET.encrypt(text.encode("utf-8")).decode("utf-8")


def decrypt_optional_value(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return _FERNET.decrypt(text.encode("utf-8")).decode("utf-8")
    except (InvalidToken, ValueError, TypeError):
        return None


def hash_optional_value(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    secret = _get_env_secret("DATA_HASH_SECRET", "change-this-data-hash-secret")
    return hmac.new(secret.encode("utf-8"), text.encode("utf-8"), hashlib.sha256).hexdigest()


def build_redacted_text(prefix: str, value: Optional[str], max_length: int = 255) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    digest = hash_optional_value(text)
    if not digest:
        return None
    redacted = f"{prefix}_{digest[:16]}"
    return redacted[:max_length]


def is_redacted_placeholder(value: Optional[str]) -> bool:
    if value is None:
        return False
    text = str(value).strip()
    return bool(
        REDACTED_VALUE_PATTERN.fullmatch(text)
        or REDACTED_EMAIL_PATTERN.fullmatch(text)
        or REDACTED_PREFIX_ONLY_PATTERN.fullmatch(text)
    )


def get_decrypted_or_raw(entity, field_name: str) -> Optional[str]:
    encrypted_value = getattr(entity, f"{field_name}_enc", None)
    decrypted = decrypt_optional_value(encrypted_value)
    if decrypted:
        return decrypted
    raw_value = getattr(entity, field_name, None)
    if is_redacted_placeholder(raw_value):
        return None
    return raw_value


def get_preferred_write_value(entity, field_name: str) -> Optional[str]:
    raw_value = getattr(entity, field_name, None)
    decrypted = decrypt_optional_value(getattr(entity, f"{field_name}_enc", None))

    if raw_value is not None:
        raw_text = str(raw_value).strip()
        if raw_text and (decrypted is None or raw_text != decrypted) and not is_redacted_placeholder(raw_text):
            return raw_value

    if decrypted:
        return decrypted
    return None if is_redacted_placeholder(raw_value) else raw_value


def set_encrypted_hash_companions(entity, field_name: str, value: Optional[str] = None):
    source_value = value if value is not None else getattr(entity, field_name, None)
    setattr(entity, f"{field_name}_enc", encrypt_optional_value(source_value))
    setattr(entity, f"{field_name}_hash", hash_optional_value(source_value))


def apply_citizen_user_security(user):
    email_value = get_preferred_write_value(user, "email")
    full_name_value = get_preferred_write_value(user, "full_name")
    tin_value = get_preferred_write_value(user, "tin")
    contact_value = get_preferred_write_value(user, "contact_number")
    address_value = get_preferred_write_value(user, "address")
    set_encrypted_hash_companions(user, "email", email_value)
    set_encrypted_hash_companions(user, "full_name", full_name_value)
    set_encrypted_hash_companions(user, "tin", tin_value)
    set_encrypted_hash_companions(user, "contact_number", contact_value)
    set_encrypted_hash_companions(user, "address", address_value)
    user.email = build_redacted_text("CITIZEN_EMAIL", email_value, 255)
    user.full_name = build_redacted_text("CITIZEN_NAME", full_name_value, 255)
    user.tin = build_redacted_text("CITIZEN_TIN", tin_value, 255)
    user.contact_number = build_redacted_text("CITIZEN_CONTACT", contact_value, 255)
    user.address = build_redacted_text("CITIZEN_ADDRESS", address_value, 255)
    return user


def apply_discrepancy_report_security(report):
    title_value = get_preferred_write_value(report, "title")
    report_date_value = get_preferred_write_value(report, "report_date")
    discrepancy_type_value = get_preferred_write_value(report, "discrepancy_type")
    description_value = get_preferred_write_value(report, "description")
    supporting_documents_value = get_preferred_write_value(report, "supporting_documents")
    attachment_path_value = get_preferred_write_value(report, "attachment_path")
    attachment_filename_value = get_preferred_write_value(report, "attachment_filename")
    verification_notes_value = get_preferred_write_value(report, "verification_notes")
    branch_reply_notes_value = get_preferred_write_value(report, "branch_reply_notes")
    conversation_thread_value = get_preferred_write_value(report, "conversation_thread")
    reported_by_value = get_preferred_write_value(report, "reported_by")
    verified_by_value = get_preferred_write_value(report, "verified_by")
    branch_replied_by_value = get_preferred_write_value(report, "branch_replied_by")

    for field_name, value in (
        ("title", title_value),
        ("report_date", report_date_value),
        ("discrepancy_type", discrepancy_type_value),
        ("description", description_value),
        ("supporting_documents", supporting_documents_value),
        ("attachment_path", attachment_path_value),
        ("attachment_filename", attachment_filename_value),
        ("verification_notes", verification_notes_value),
        ("branch_reply_notes", branch_reply_notes_value),
        ("conversation_thread", conversation_thread_value),
        ("reported_by", reported_by_value),
        ("verified_by", verified_by_value),
        ("branch_replied_by", branch_replied_by_value),
    ):
        set_encrypted_hash_companions(report, field_name, value)

    report.title = build_redacted_text("DISC_TITLE", title_value, 255)
    report.report_date = build_redacted_text("DISC_DATE", report_date_value, 255)
    report.discrepancy_type = build_redacted_text("DISC_TYPE", discrepancy_type_value, 255)
    report.description = build_redacted_text("DISC_DESC", description_value, 255)
    report.supporting_documents = build_redacted_text("DISC_SUPPORT", supporting_documents_value, 255)
    report.attachment_path = build_redacted_text("DISC_ATTACH_PATH", attachment_path_value, 255)
    report.attachment_filename = build_redacted_text("DISC_ATTACH_NAME", attachment_filename_value, 255)
    report.verification_notes = build_redacted_text("DISC_VERIFY", verification_notes_value, 255)
    report.branch_reply_notes = build_redacted_text("DISC_REPLY", branch_reply_notes_value, 255)
    report.conversation_thread = build_redacted_text("DISC_THREAD", conversation_thread_value, 255)
    report.reported_by = build_redacted_text("DISC_REPORTED_BY", reported_by_value, 255)
    report.verified_by = build_redacted_text("DISC_VERIFIED_BY", verified_by_value, 255)
    report.branch_replied_by = build_redacted_text("DISC_BRANCH_REPLY_BY", branch_replied_by_value, 255)
    return report


def apply_email_otp_security(otp_record):
    email_value = get_preferred_write_value(otp_record, "email")
    role_value = get_preferred_write_value(otp_record, "role")
    set_encrypted_hash_companions(otp_record, "email", email_value)
    set_encrypted_hash_companions(otp_record, "role", role_value)
    otp_record.email = build_redacted_text("OTP_EMAIL", email_value, 255)
    otp_record.role = build_redacted_text("OTP_ROLE", role_value, 255)
    return otp_record


def apply_email_verification_token_security(token_record):
    email_value = get_preferred_write_value(token_record, "email")
    token_value = get_preferred_write_value(token_record, "token")
    set_encrypted_hash_companions(token_record, "email", email_value)
    set_encrypted_hash_companions(token_record, "token", token_value)
    token_record.email = build_redacted_text("VERIFY_EMAIL", email_value, 255)
    token_record.token = build_redacted_text("VERIFY_TOKEN", token_value, 255)
    return token_record


def apply_mfa_secret_security(mfa_record):
    portal_value = get_preferred_write_value(mfa_record, "portal")
    username_value = get_preferred_write_value(mfa_record, "username")
    secret_value = get_preferred_write_value(mfa_record, "secret")
    set_encrypted_hash_companions(mfa_record, "portal", portal_value)
    set_encrypted_hash_companions(mfa_record, "username", username_value)
    set_encrypted_hash_companions(mfa_record, "secret", secret_value)
    mfa_record.portal = build_redacted_text("MFA_PORTAL", portal_value, 255)
    mfa_record.username = build_redacted_text("MFA_USER", username_value, 255)
    mfa_record.secret = build_redacted_text("MFA_SECRET", secret_value, 255)
    return mfa_record


def apply_privacy_consent_security(consent_record):
    ip_value = get_preferred_write_value(consent_record, "ip_address")
    set_encrypted_hash_companions(consent_record, "ip_address", ip_value)
    consent_record.ip_address = build_redacted_text("CONSENT_IP", ip_value, 45)
    return consent_record


def apply_payment_security(payment):
    for field_name, prefix, length in (
        ("ref_number", "PAY_REF", 255),
        ("txn_id", "PAY_TXN", 255),
        ("taxpayer_name", "PAY_TAXPAYER", 255),
        ("tin", "PAY_TIN", 255),
        ("property_ref_number", "PAY_PROP_REF", 255),
        ("tax_type", "PAY_TAX_TYPE", 255),
        ("payment_method", "PAY_METHOD", 255),
        ("branch", "PAY_BRANCH", 255),
        ("email", "PAY_EMAIL", 255),
        ("contact_number", "PAY_CONTACT", 255),
        ("paymongo_checkout_session_id", "PAY_CHECKOUT", 255),
        ("paymongo_payment_intent_id", "PAY_INTENT", 255),
        ("paymongo_source_id", "PAY_SOURCE", 255),
        ("paymongo_payment_id", "PAY_PG_ID", 255),
        ("paymongo_checkout_url", "PAY_URL", 255),
        ("paymongo_status", "PAY_PG_STATUS", 255),
        ("proof_file_path", "PAY_PROOF_PATH", 255),
        ("proof_file_name", "PAY_PROOF_NAME", 255),
        ("treasury_remarks", "PAY_TREASURY", 255),
        ("official_receipt_number", "PAY_OR", 255),
        ("official_receipt_path", "PAY_OR_PATH", 255),
        ("release_method", "PAY_RELEASE", 255),
    ):
        value = get_preferred_write_value(payment, field_name)
        set_encrypted_hash_companions(payment, field_name, value)
        setattr(payment, field_name, build_redacted_text(prefix, value, length))
    return payment


def apply_rpt_property_record_security(record):
    tdn_value = get_preferred_write_value(record, "tdn")
    raw_tdn = getattr(record, "tdn", None)
    has_decryptable_tdn = bool(decrypt_optional_value(getattr(record, "tdn_enc", None)))

    if (
        isinstance(raw_tdn, str)
        and REDACTED_VALUE_PATTERN.fullmatch(raw_tdn)
        and not has_decryptable_tdn
    ):
        return record

    set_encrypted_hash_companions(record, "tdn", tdn_value)
    redaction_source = tdn_value
    if tdn_value:
        record_id = getattr(record, "id", None)
        if record_id is not None:
            redaction_source = f"{tdn_value}|{record_id}"
    record.tdn = build_redacted_text("RPT_TDN", redaction_source, 30)
    return record


def apply_queue_activity_security(activity):
    service_type_value = get_preferred_write_value(activity, "service_type")
    set_encrypted_hash_companions(activity, "service_type", service_type_value)
    activity.service_type = build_redacted_text("QUEUE_SERVICE", service_type_value, 255)
    return activity


def apply_queue_security(queue):
    for field_name, prefix, length in (
        ("queue_number", "QUEUE_NO", 255),
        ("service_type", "QUEUE_SERVICE", 255),
        ("taxpayer_name", "QUEUE_NAME", 255),
        ("contact_number", "QUEUE_CONTACT", 255),
        ("email", "QUEUE_EMAIL", 255),
        ("status", "QUEUE_STATUS", 255),
        ("queue_type", "QUEUE_TYPE", 255),
    ):
        value = get_preferred_write_value(queue, field_name)
        set_encrypted_hash_companions(queue, field_name, value)
        setattr(queue, field_name, build_redacted_text(prefix, value, length))
    return queue


def apply_receipt_record_security(record):
    for field_name, prefix, length in (
        ("receipt_number", "RECEIPT_NO", 255),
        ("ref_number", "RECEIPT_REF", 255),
        ("txn_id", "RECEIPT_TXN", 255),
        ("taxpayer_name", "RECEIPT_TAXPAYER", 255),
        ("transaction_date", "RECEIPT_DATE", 255),
        ("tax_type", "RECEIPT_TAXTYPE", 255),
        ("payment_method", "RECEIPT_METHOD", 255),
        ("source_image_path", "RECEIPT_IMAGE", 255),
        ("raw_ocr_text", "RECEIPT_OCR", 255),
        ("verification_status", "RECEIPT_VERIFY", 255),
    ):
        value = get_preferred_write_value(record, field_name)
        set_encrypted_hash_companions(record, field_name, value)
        setattr(record, field_name, build_redacted_text(prefix, value, length))
    return record


def receipt_record_value(record, field_name: str) -> Optional[str]:
    return get_decrypted_or_raw(record, field_name)


def apply_service_security(service):
    for field_name, prefix, length in (
        ("name", "SERVICE_NAME", 255),
        ("description", "SERVICE_DESC", 255),
        ("category", "SERVICE_CAT", 255),
    ):
        value = get_preferred_write_value(service, field_name)
        set_encrypted_hash_companions(service, field_name, value)
        setattr(service, field_name, build_redacted_text(prefix, value, length))
    return service


def service_value(service, field_name: str) -> Optional[str]:
    return get_decrypted_or_raw(service, field_name)


def apply_system_setting_security(setting):
    key_value = get_preferred_write_value(setting, "key")
    set_encrypted_hash_companions(setting, "key", key_value)

    for field_name, prefix, length in (
        ("label", "SETTING_LABEL", 255),
        ("category", "SETTING_CATEGORY", 255),
        ("value_json", "SETTING_JSON", 255),
        ("value", "SETTING_VALUE", 255),
        ("value_type", "SETTING_TYPE", 255),
        ("description", "SETTING_DESC", 255),
        ("updated_by", "SETTING_UPDATED_BY", 255),
    ):
        value = get_preferred_write_value(setting, field_name)
        set_encrypted_hash_companions(setting, field_name, value)
        setattr(setting, field_name, build_redacted_text(prefix, value, length))
    return setting


def system_setting_value(setting, field_name: str) -> Optional[str]:
    return get_decrypted_or_raw(setting, field_name)


def apply_tax_assessment_record_security(record):
    for field_name, prefix, length in (
        ("tax_type", "ASSESS_TAXTYPE", 255),
        ("assessment_status", "ASSESS_STATUS", 255),
        ("verification_status", "ASSESS_VERIFY", 255),
        ("taxpayer_name", "ASSESS_TAXPAYER", 255),
        ("taxpayer_email", "ASSESS_EMAIL", 255),
        ("taxpayer_type", "ASSESS_TYPE", 255),
        ("mobile_number", "ASSESS_MOBILE", 255),
        ("address", "ASSESS_ADDRESS", 255),
        ("tax_year", "ASSESS_YEAR", 255),
        ("tdn", "ASSESS_TDN", 255),
        ("property_type", "ASSESS_PROPERTY", 255),
        ("property_address", "ASSESS_LOCATION", 255),
        ("remarks", "ASSESS_REMARKS", 255),
        ("rejection_reason", "ASSESS_REJECT", 255),
        ("created_by", "ASSESS_CREATED_BY", 255),
        ("updated_by", "ASSESS_UPDATED_BY", 255),
    ):
        value = get_preferred_write_value(record, field_name)
        set_encrypted_hash_companions(record, field_name, value)
        setattr(record, field_name, build_redacted_text(prefix, value, length))

    for field_name, prefix, length in (
        ("mayor_permit_number", "ASSESS_PERMIT", 255),
        ("sec_dti_cda_number", "ASSESS_REG", 255),
        ("business_name", "ASSESS_BUSINESS", 255),
        ("business_type", "ASSESS_BUSINESS_TYPE", 255),
    ):
        value = get_preferred_write_value(record, field_name)
        set_encrypted_hash_companions(record, field_name, value)
        setattr(record, field_name, build_redacted_text(prefix, value, length))
    return record


def tax_assessment_value(record, field_name: str) -> Optional[str]:
    return get_decrypted_or_raw(record, field_name)


def apply_taxpayer_guide_security(guide):
    for field_name, prefix, length in (
        ("title", "GUIDE_TITLE", 255),
        ("content", "GUIDE_CONTENT", 255),
        ("category", "GUIDE_CATEGORY", 255),
        ("language", "GUIDE_LANG", 255),
    ):
        value = get_preferred_write_value(guide, field_name)
        set_encrypted_hash_companions(guide, field_name, value)
        setattr(guide, field_name, build_redacted_text(prefix, value, length))
    return guide


def taxpayer_guide_value(guide, field_name: str) -> Optional[str]:
    return get_decrypted_or_raw(guide, field_name)


def apply_taxpayer_identifier_submission_security(submission):
    for field_name, prefix, length in (
        ("submission_type", "SUBMISSION_TYPE", 255),
        ("taxpayer_type", "SUBMISSION_TAXPAYER_TYPE", 255),
        ("full_name", "SUBMISSION_NAME", 255),
        ("email", "SUBMISSION_EMAIL", 255),
        ("mobile_number", "SUBMISSION_MOBILE", 255),
        ("address", "SUBMISSION_ADDRESS", 255),
        ("tdn", "SUBMISSION_TDN", 255),
        ("mayor_permit_number", "SUBMISSION_PERMIT", 255),
        ("sec_dti_cda_number", "SUBMISSION_REG", 255),
        ("supporting_file_path", "SUBMISSION_FILE_PATH", 255),
        ("supporting_file_name", "SUBMISSION_FILE_NAME", 255),
        ("supporting_file_mime", "SUBMISSION_FILE_MIME", 255),
        ("status", "SUBMISSION_STATUS", 255),
        ("remarks", "SUBMISSION_REMARKS", 255),
        ("reviewed_by", "SUBMISSION_REVIEWED_BY", 255),
    ):
        value = get_preferred_write_value(submission, field_name)
        set_encrypted_hash_companions(submission, field_name, value)
        setattr(submission, field_name, build_redacted_text(prefix, value, length))
    return submission


def taxpayer_submission_value(submission, field_name: str) -> Optional[str]:
    return get_decrypted_or_raw(submission, field_name)


def apply_receipt_request_security(request):
    for field_name, prefix, length in (
        ("request_id", "REQ_ID", 255),
        ("taxpayer_name", "REQ_TAXPAYER", 255),
        ("tax_type", "REQ_TAXTYPE", 255),
        ("request_reason", "REQ_REASON", 255),
        ("request_reason_other", "REQ_REASON_OTHER", 255),
        ("request_type", "REQ_TYPE", 255),
        ("transaction_date", "REQ_DATE", 255),
        ("ref_number", "REQ_REF", 255),
        ("email", "REQ_EMAIL", 255),
        ("status", "REQ_STATUS", 255),
        ("linked_queue_number", "REQ_QUEUE", 255),
        ("payment_ref_number", "REQ_PAYREF", 255),
        ("release_copy_path", "REQ_RELEASE_PATH", 255),
        ("release_copy_filename", "REQ_RELEASE_NAME", 255),
    ):
        value = get_preferred_write_value(request, field_name)
        set_encrypted_hash_companions(request, field_name, value)
        setattr(request, field_name, build_redacted_text(prefix, value, length))
    return request


def apply_receipt_request_history_security(history):
    for field_name, prefix, length in (
        ("request_id", "REQH_ID", 255),
        ("taxpayer_name", "REQH_TAXPAYER", 255),
        ("tax_type", "REQH_TAXTYPE", 255),
        ("request_reason", "REQH_REASON", 255),
        ("request_reason_other", "REQH_REASON_OTHER", 255),
        ("request_type", "REQH_TYPE", 255),
        ("transaction_date", "REQH_DATE", 255),
        ("ref_number", "REQH_REF", 255),
        ("email", "REQH_EMAIL", 255),
        ("final_status", "REQH_STATUS", 255),
        ("linked_queue_number", "REQH_QUEUE", 255),
        ("payment_ref_number", "REQH_PAYREF", 255),
        ("release_copy_filename", "REQH_RELEASE_NAME", 255),
    ):
        value = get_preferred_write_value(history, field_name)
        set_encrypted_hash_companions(history, field_name, value)
        setattr(history, field_name, build_redacted_text(prefix, value, length))
    return history


def receipt_request_value(request, field_name: str) -> Optional[str]:
    return get_decrypted_or_raw(request, field_name)


def receipt_request_history_value(history, field_name: str) -> Optional[str]:
    return get_decrypted_or_raw(history, field_name)


def apply_service_window_config_security(config):
    window_count_value = get_preferred_write_value(config, "window_count")
    set_encrypted_hash_companions(config, "window_count", window_count_value)
    config.window_count = build_redacted_text("WINDOW_COUNT", window_count_value, 255)
    return config


def hash_aware_match(Model, field_name: str, value: Optional[str]):
    normalized = (value or "").strip()
    column = getattr(Model, field_name)
    hash_column = getattr(Model, f"{field_name}_hash", None)
    if not normalized:
        return column.is_(None)
    if hash_column is None:
        return column == normalized
    return or_(column == normalized, hash_column == hash_optional_value(normalized))


def hash_aware_any(Model, field_name: str, values: list[str] | tuple[str, ...]):
    normalized_values = [str(value).strip() for value in values if str(value).strip()]
    if not normalized_values:
        return getattr(Model, field_name).in_([])
    clauses = [hash_aware_match(Model, field_name, value) for value in normalized_values]
    return or_(*clauses)


def queue_value(queue, field_name: str) -> Optional[str]:
    return get_decrypted_or_raw(queue, field_name)


def find_queue_by_queue_number(db, Queue, queue_number: Optional[str]):
    normalized = (queue_number or "").strip()
    if not normalized:
        return None
    return db.query(Queue).filter(hash_aware_match(Queue, "queue_number", normalized)).first()


def find_mfa_secret_record(db, MFASecret, portal: Optional[str], username: Optional[str], enabled_only: bool = False):
    normalized_portal = (portal or "").strip().lower()
    normalized_username = (username or "").strip()
    if not normalized_portal or not normalized_username:
        return None

    query = db.query(MFASecret).filter(
        or_(
            MFASecret.portal == normalized_portal,
            MFASecret.portal_hash == hash_optional_value(normalized_portal),
        ),
        or_(
            MFASecret.username == normalized_username,
            MFASecret.username_hash == hash_optional_value(normalized_username),
        ),
    )
    if enabled_only:
        query = query.filter(MFASecret.enabled.is_(True))
    return query.first()


def find_payment_by_ref_number(db, Payment, ref_number: Optional[str]):
    normalized = (ref_number or "").strip()
    if not normalized:
        return None
    return (
        db.query(Payment)
        .filter(
            or_(
                Payment.ref_number == normalized,
                Payment.ref_number_hash == hash_optional_value(normalized),
            )
        )
        .first()
    )


def find_payment_by_field(db, Payment, field_name: str, value: Optional[str]):
    normalized = (value or "").strip()
    if not normalized:
        return None
    column = getattr(Payment, field_name)
    hash_column = getattr(Payment, f"{field_name}_hash", None)
    if hash_column is None:
        return db.query(Payment).filter(column == normalized).first()
    return (
        db.query(Payment)
        .filter(
            or_(
                column == normalized,
                hash_column == hash_optional_value(normalized),
            )
        )
        .first()
    )


def apply_faq_security(faq):
    question_value = get_preferred_write_value(faq, "question")
    answer_value = get_preferred_write_value(faq, "answer")
    category_value = get_preferred_write_value(faq, "category")
    language_value = get_preferred_write_value(faq, "language")
    set_encrypted_hash_companions(faq, "question", question_value)
    set_encrypted_hash_companions(faq, "answer", answer_value)
    set_encrypted_hash_companions(faq, "category", category_value)
    set_encrypted_hash_companions(faq, "language", language_value)
    faq.question = build_redacted_text("FAQ_Q", question_value, 255)
    faq.answer = build_redacted_text("FAQ_A", answer_value, 255)
    faq.category = build_redacted_text("FAQ_CAT", category_value, 255)
    faq.language = build_redacted_text("FAQ_LANG", language_value, 255)
    return faq


def apply_invite_security(invite):
    email_value = get_preferred_write_value(invite, "email")
    role_value = get_preferred_write_value(invite, "role")
    token_value = get_preferred_write_value(invite, "token")
    set_encrypted_hash_companions(invite, "email", email_value)
    set_encrypted_hash_companions(invite, "role", role_value)
    set_encrypted_hash_companions(invite, "token", token_value)
    invite.email = build_redacted_text("INVITE_EMAIL", email_value, 255)
    invite.role = build_redacted_text("INVITE_ROLE", role_value, 255)
    invite.token = build_redacted_text("INVITE_TOKEN", token_value, 255)
    return invite


def find_invite_by_token(db, Invite, token: Optional[str]):
    normalized = (token or "").strip()
    if not normalized:
        return None
    return db.query(Invite).filter(Invite.token_hash == hash_optional_value(normalized)).first()


def find_active_invite_by_email_role(db, Invite, email: Optional[str], role: Optional[str]):
    normalized_email = (email or "").strip().lower()
    normalized_role = (role or "").strip().lower()
    if not normalized_email or not normalized_role:
        return None
    return (
        db.query(Invite)
        .filter(
            Invite.email_hash == hash_optional_value(normalized_email),
            Invite.role_hash == hash_optional_value(normalized_role),
            Invite.used.is_(False),
        )
        .order_by(Invite.created_at.desc(), Invite.id.desc())
        .first()
    )


def apply_memo_view_security(memo_view):
    username_value = get_preferred_write_value(memo_view, "viewer_username")
    viewer_type_value = get_preferred_write_value(memo_view, "viewer_type")
    set_encrypted_hash_companions(memo_view, "viewer_username", username_value)
    set_encrypted_hash_companions(memo_view, "viewer_type", viewer_type_value)
    memo_view.viewer_username = build_redacted_text("MEMO_VIEWER", username_value, 255)
    memo_view.viewer_type = build_redacted_text("MEMO_VIEW_TYPE", viewer_type_value, 255)
    return memo_view


def apply_announcement_view_security(announcement_view):
    username_value = get_preferred_write_value(announcement_view, "viewer_username")
    viewer_type_value = get_preferred_write_value(announcement_view, "viewer_type")
    set_encrypted_hash_companions(announcement_view, "viewer_username", username_value)
    set_encrypted_hash_companions(announcement_view, "viewer_type", viewer_type_value)
    announcement_view.viewer_username = build_redacted_text("ANNOUNCEMENT_VIEWER", username_value, 255)
    announcement_view.viewer_type = build_redacted_text("ANNOUNCEMENT_VIEW_TYPE", viewer_type_value, 255)
    return announcement_view


def find_announcement_view(db, AnnouncementView, announcement_id: int, viewer_username: Optional[str], viewer_type: Optional[str]):
    normalized_username = (viewer_username or "").strip()
    normalized_type = (viewer_type or "").strip()
    if not normalized_username or not normalized_type:
        return None
    return (
        db.query(AnnouncementView)
        .filter(
            AnnouncementView.announcement_id == announcement_id,
            AnnouncementView.viewer_username_hash == hash_optional_value(normalized_username),
            AnnouncementView.viewer_type_hash == hash_optional_value(normalized_type),
        )
        .first()
    )


def get_announcement_viewed_ids(db, AnnouncementView, viewer_username: Optional[str], viewer_type: Optional[str]):
    normalized_username = (viewer_username or "").strip()
    normalized_type = (viewer_type or "").strip()
    if not normalized_username or not normalized_type:
        return []
    return [
        view.announcement_id
        for view in db.query(AnnouncementView).filter(
            AnnouncementView.viewer_username_hash == hash_optional_value(normalized_username),
            AnnouncementView.viewer_type_hash == hash_optional_value(normalized_type),
        ).all()
    ]


def find_memo_view(db, MemoView, memo_id: int, viewer_username: Optional[str], viewer_type: Optional[str]):
    normalized_username = (viewer_username or "").strip()
    normalized_type = (viewer_type or "").strip()
    if not normalized_username or not normalized_type:
        return None
    return (
        db.query(MemoView)
        .filter(
            MemoView.memo_id == memo_id,
            MemoView.viewer_username_hash == hash_optional_value(normalized_username),
            MemoView.viewer_type_hash == hash_optional_value(normalized_type),
        )
        .first()
    )


def get_memo_viewed_ids(db, MemoView, viewer_username: Optional[str], viewer_type: Optional[str]):
    normalized_username = (viewer_username or "").strip()
    normalized_type = (viewer_type or "").strip()
    if not normalized_username or not normalized_type:
        return []
    return [
        view.memo_id
        for view in db.query(MemoView).filter(
            MemoView.viewer_username_hash == hash_optional_value(normalized_username),
            MemoView.viewer_type_hash == hash_optional_value(normalized_type),
        ).all()
    ]


def apply_memo_security(memo):
    title_value = get_preferred_write_value(memo, "title")
    content_value = get_preferred_write_value(memo, "content")
    recipients_value = get_preferred_write_value(memo, "recipients")
    recipient_type_value = get_preferred_write_value(memo, "recipient_type")
    author_value = get_preferred_write_value(memo, "author")
    priority_value = get_preferred_write_value(memo, "priority")
    attachment_path_value = get_preferred_write_value(memo, "attachment_path")
    attachment_filename_value = get_preferred_write_value(memo, "attachment_filename")

    for field_name, value in (
        ("title", title_value),
        ("content", content_value),
        ("recipients", recipients_value),
        ("recipient_type", recipient_type_value),
        ("author", author_value),
        ("priority", priority_value),
        ("attachment_path", attachment_path_value),
        ("attachment_filename", attachment_filename_value),
    ):
        set_encrypted_hash_companions(memo, field_name, value)

    memo.title = build_redacted_text("MEMO_TITLE", title_value, 255)
    memo.content = build_redacted_text("MEMO_CONTENT", content_value, 255)
    memo.recipients = build_redacted_text("MEMO_RECIPIENTS", recipients_value, 255)
    memo.recipient_type = build_redacted_text("MEMO_RECIPIENT_TYPE", recipient_type_value, 255)
    memo.author = build_redacted_text("MEMO_AUTHOR", author_value, 255)
    memo.priority = build_redacted_text("MEMO_PRIORITY", priority_value, 255)
    memo.attachment_path = build_redacted_text("MEMO_ATTACH_PATH", attachment_path_value, 255)
    memo.attachment_filename = build_redacted_text("MEMO_ATTACH_NAME", attachment_filename_value, 255)
    return memo


def serialize_citizen_user(user) -> dict:
    return {
        "id": user.id,
        "email": get_decrypted_or_raw(user, "email"),
        "full_name": get_decrypted_or_raw(user, "full_name"),
        "tin": get_decrypted_or_raw(user, "tin"),
        "contact_number": get_decrypted_or_raw(user, "contact_number"),
        "address": get_decrypted_or_raw(user, "address"),
    }


def find_citizen_by_email(db, CitizenUser, email: Optional[str]):
    normalized = (email or "").strip().lower()
    if not normalized:
        return None
    email_hash = hash_optional_value(normalized)
    return (
        db.query(CitizenUser)
        .filter(
            or_(
                CitizenUser.email == normalized,
                CitizenUser.email_hash == email_hash,
            )
        )
        .first()
    )


def find_citizen_by_tin(db, CitizenUser, tin: Optional[str]):
    normalized = (tin or "").strip()
    if not normalized:
        return None
    tin_hash = hash_optional_value(normalized)
    return (
        db.query(CitizenUser)
        .filter(
            or_(
                CitizenUser.tin == normalized,
                CitizenUser.tin_hash == tin_hash,
            )
        )
        .first()
    )
