from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from datetime import datetime, timedelta
from typing import Optional
import uvicorn
import os
import threading
import time

from dotenv import load_dotenv
from passlib.context import CryptContext
from sqlalchemy import text, inspect, or_

from routes import auth, branches, reports, announcements, memos, alerts, logs, backup, users, payments, receipts, settings, policies, rbac_routes, dashboard, public, public_auth, admin_auth_v2, user_auth_v2, branch_auth_v2, invites, admin_users, branch_portal, branch_settings, unified_auth, discrepancies, tax_assessment, security_dashboard
from services import ocr_routes
from database.models import Base, engine, SessionLocal, Admin, Branch, BusinessRegistry, BusinessTaxApplication, DiscrepancyReport, EmailOTP, EmailVerificationToken, FAQ, Invite, Memo, MemoView, MFASecret, Payment, Queue, QueueActivity, ReceiptRecord, ReceiptRequest, ReceiptRequestHistory, RPTPropertyRecord, Service, ServiceWindowConfig, TaxpayerGuide
from utils.field_crypto import apply_citizen_user_security, apply_discrepancy_report_security, apply_email_otp_security, apply_email_verification_token_security, apply_faq_security, apply_invite_security, apply_memo_security, apply_memo_view_security, apply_mfa_secret_security, apply_payment_security, apply_queue_activity_security, apply_queue_security, apply_receipt_record_security, apply_receipt_request_history_security, apply_receipt_request_security, apply_rpt_property_record_security, apply_service_security, apply_service_window_config_security, apply_system_setting_security, apply_tax_assessment_record_security, apply_taxpayer_guide_security, apply_taxpayer_identifier_submission_security, build_redacted_text, get_decrypted_or_raw, hash_optional_value, set_encrypted_hash_companions
from utils.system_settings import seed_system_settings

load_dotenv(Path(__file__).resolve().with_name(".env"))

app = FastAPI(title="WARDS API", version="1.0.0")


def build_allowed_origins() -> list[str]:
    origins: list[str] = []

    raw_cors_origins = os.getenv("CORS_ORIGINS", "")
    for origin in raw_cors_origins.split(","):
        cleaned = origin.strip().rstrip("/")
        if cleaned:
            origins.append(cleaned)

    for env_name in ("FRONTEND_BASE_URL", "FRONTEND_URL"):
        frontend_url = (os.getenv(env_name) or "").strip()
        if not frontend_url:
            continue
        parsed = urlparse(frontend_url)
        if parsed.scheme and parsed.netloc:
            origins.append(f"{parsed.scheme}://{parsed.netloc}")

    origins.extend([
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:5173",
    ])

    deduped_origins: list[str] = []
    seen: set[str] = set()
    for origin in origins:
        if origin not in seen:
            seen.add(origin)
            deduped_origins.append(origin)

    return deduped_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=build_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Requires-Captcha", "X-Requires-MFA-Setup", "X-Auth-Portal", "X-Requires-Email-Verification"],
)

Base.metadata.create_all(bind=engine)

def ensure_auth_extensions():
    inspector = inspect(engine)

    with engine.begin() as conn:
        report_columns = {column["name"] for column in inspector.get_columns("reports")}
        if "branch_id" not in report_columns:
            conn.execute(text("ALTER TABLE reports ADD COLUMN branch_id INTEGER"))
        if "service_type" not in report_columns:
            conn.execute(text("ALTER TABLE reports ADD COLUMN service_type VARCHAR(255)"))
        if "transaction_category" not in report_columns:
            conn.execute(text("ALTER TABLE reports ADD COLUMN transaction_category VARCHAR(255)"))
        if "generated_by" not in report_columns:
            conn.execute(text("ALTER TABLE reports ADD COLUMN generated_by VARCHAR(255)"))
        if "submitted_by" not in report_columns:
            conn.execute(text("ALTER TABLE reports ADD COLUMN submitted_by VARCHAR(255)"))
        if "submitted_at" not in report_columns:
            conn.execute(text("ALTER TABLE reports ADD COLUMN submitted_at DATETIME"))

        memo_columns = {column["name"] for column in inspector.get_columns("memos")}
        if "attachment_path" not in memo_columns:
            conn.execute(text("ALTER TABLE memos ADD COLUMN attachment_path VARCHAR(255)"))
        if "attachment_filename" not in memo_columns:
            conn.execute(text("ALTER TABLE memos ADD COLUMN attachment_filename VARCHAR(255)"))
        for column_name, column_type in (
            ("title_hash", "VARCHAR(255)"),
            ("title_enc", "TEXT"),
            ("content_hash", "VARCHAR(255)"),
            ("content_enc", "TEXT"),
            ("recipients_hash", "VARCHAR(255)"),
            ("recipients_enc", "TEXT"),
            ("recipient_type_hash", "VARCHAR(255)"),
            ("recipient_type_enc", "TEXT"),
            ("author_hash", "VARCHAR(255)"),
            ("author_enc", "TEXT"),
            ("priority_hash", "VARCHAR(255)"),
            ("priority_enc", "TEXT"),
            ("attachment_path_hash", "VARCHAR(255)"),
            ("attachment_path_enc", "TEXT"),
            ("attachment_filename_hash", "VARCHAR(255)"),
            ("attachment_filename_enc", "TEXT"),
        ):
            if column_name not in memo_columns:
                conn.execute(text(f"ALTER TABLE memos ADD COLUMN {column_name} {column_type}"))

        announcement_columns = {column["name"] for column in inspector.get_columns("announcements")}
        if "branch_id" not in announcement_columns:
            conn.execute(text("ALTER TABLE announcements ADD COLUMN branch_id INTEGER"))

        payment_columns = {column["name"] for column in inspector.get_columns("payments")}
        if "paymongo_checkout_session_id" not in payment_columns:
            conn.execute(text("ALTER TABLE payments ADD COLUMN paymongo_checkout_session_id VARCHAR(255)"))
        if "branch_id" not in payment_columns:
            conn.execute(text("ALTER TABLE payments ADD COLUMN branch_id INTEGER"))
        if "property_ref_number" not in payment_columns:
            conn.execute(text("ALTER TABLE payments ADD COLUMN property_ref_number VARCHAR(255)"))
        if "email" not in payment_columns:
            conn.execute(text("ALTER TABLE payments ADD COLUMN email VARCHAR(255)"))
        if "contact_number" not in payment_columns:
            conn.execute(text("ALTER TABLE payments ADD COLUMN contact_number VARCHAR(255)"))
        if "source_module" not in payment_columns:
            conn.execute(text("ALTER TABLE payments ADD COLUMN source_module VARCHAR(255) DEFAULT 'tax_payment'"))
        if "related_request_id" not in payment_columns:
            conn.execute(text("ALTER TABLE payments ADD COLUMN related_request_id VARCHAR(255)"))
        if "receipt_sent_at" not in payment_columns:
            conn.execute(text("ALTER TABLE payments ADD COLUMN receipt_sent_at DATETIME"))
        if "paymongo_payment_intent_id" not in payment_columns:
            conn.execute(text("ALTER TABLE payments ADD COLUMN paymongo_payment_intent_id VARCHAR(255)"))
        if "paymongo_source_id" not in payment_columns:
            conn.execute(text("ALTER TABLE payments ADD COLUMN paymongo_source_id VARCHAR(255)"))
        if "paymongo_payment_id" not in payment_columns:
            conn.execute(text("ALTER TABLE payments ADD COLUMN paymongo_payment_id VARCHAR(255)"))
        if "paymongo_checkout_url" not in payment_columns:
            conn.execute(text("ALTER TABLE payments ADD COLUMN paymongo_checkout_url VARCHAR(255)"))
        if "paymongo_status" not in payment_columns:
            conn.execute(text("ALTER TABLE payments ADD COLUMN paymongo_status VARCHAR(255)"))
        if "metadata_json" not in payment_columns:
            conn.execute(text("ALTER TABLE payments ADD COLUMN metadata_json TEXT"))
        if "proof_file_path" not in payment_columns:
            conn.execute(text("ALTER TABLE payments ADD COLUMN proof_file_path VARCHAR(255)"))
        if "proof_file_name" not in payment_columns:
            conn.execute(text("ALTER TABLE payments ADD COLUMN proof_file_name VARCHAR(255)"))
        if "proof_uploaded_at" not in payment_columns:
            conn.execute(text("ALTER TABLE payments ADD COLUMN proof_uploaded_at DATETIME"))
        if "treasury_remarks" not in payment_columns:
            conn.execute(text("ALTER TABLE payments ADD COLUMN treasury_remarks TEXT"))
        if "treasury_updated_at" not in payment_columns:
            conn.execute(text("ALTER TABLE payments ADD COLUMN treasury_updated_at DATETIME"))
        if "official_receipt_number" not in payment_columns:
            conn.execute(text("ALTER TABLE payments ADD COLUMN official_receipt_number VARCHAR(255)"))
        if "official_receipt_path" not in payment_columns:
            conn.execute(text("ALTER TABLE payments ADD COLUMN official_receipt_path VARCHAR(255)"))
        if "official_receipt_generated_at" not in payment_columns:
            conn.execute(text("ALTER TABLE payments ADD COLUMN official_receipt_generated_at DATETIME"))
        if "release_method" not in payment_columns:
            conn.execute(text("ALTER TABLE payments ADD COLUMN release_method VARCHAR(255)"))
        if "release_details_json" not in payment_columns:
            conn.execute(text("ALTER TABLE payments ADD COLUMN release_details_json TEXT"))
        if "payment_expiry" not in payment_columns:
            conn.execute(text("ALTER TABLE payments ADD COLUMN payment_expiry DATETIME"))
        if "contact_number" not in payment_columns:
            conn.execute(text("ALTER TABLE payments ADD COLUMN contact_number VARCHAR(255)"))
        for column_name, column_type in (
            ("ref_number_hash", "VARCHAR(255)"),
            ("ref_number_enc", "TEXT"),
            ("txn_id_hash", "VARCHAR(255)"),
            ("txn_id_enc", "TEXT"),
            ("taxpayer_name_hash", "VARCHAR(255)"),
            ("taxpayer_name_enc", "TEXT"),
            ("tin_hash", "VARCHAR(255)"),
            ("tin_enc", "TEXT"),
            ("property_ref_number_hash", "VARCHAR(255)"),
            ("property_ref_number_enc", "TEXT"),
            ("tax_type_hash", "VARCHAR(255)"),
            ("tax_type_enc", "TEXT"),
            ("payment_method_hash", "VARCHAR(255)"),
            ("payment_method_enc", "TEXT"),
            ("branch_hash", "VARCHAR(255)"),
            ("branch_enc", "TEXT"),
            ("email_hash", "VARCHAR(255)"),
            ("email_enc", "TEXT"),
            ("contact_number_hash", "VARCHAR(255)"),
            ("contact_number_enc", "TEXT"),
            ("paymongo_checkout_session_id_hash", "VARCHAR(255)"),
            ("paymongo_checkout_session_id_enc", "TEXT"),
            ("paymongo_payment_intent_id_hash", "VARCHAR(255)"),
            ("paymongo_payment_intent_id_enc", "TEXT"),
            ("paymongo_source_id_hash", "VARCHAR(255)"),
            ("paymongo_source_id_enc", "TEXT"),
            ("paymongo_payment_id_hash", "VARCHAR(255)"),
            ("paymongo_payment_id_enc", "TEXT"),
            ("paymongo_checkout_url_hash", "VARCHAR(255)"),
            ("paymongo_checkout_url_enc", "TEXT"),
            ("paymongo_status_hash", "VARCHAR(255)"),
            ("paymongo_status_enc", "TEXT"),
            ("proof_file_path_hash", "VARCHAR(255)"),
            ("proof_file_path_enc", "TEXT"),
            ("proof_file_name_hash", "VARCHAR(255)"),
            ("proof_file_name_enc", "TEXT"),
            ("treasury_remarks_hash", "VARCHAR(255)"),
            ("treasury_remarks_enc", "TEXT"),
            ("official_receipt_number_hash", "VARCHAR(255)"),
            ("official_receipt_number_enc", "TEXT"),
            ("official_receipt_path_hash", "VARCHAR(255)"),
            ("official_receipt_path_enc", "TEXT"),
            ("release_method_hash", "VARCHAR(255)"),
            ("release_method_enc", "TEXT"),
        ):
            if column_name not in payment_columns:
                conn.execute(text(f"ALTER TABLE payments ADD COLUMN {column_name} {column_type}"))

        if engine.dialect.name == "sqlite":
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_payments_ref_number_unique ON payments (ref_number)"))
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_payments_txn_id_unique ON payments (txn_id)"))
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_payments_checkout_session_unique ON payments (paymongo_checkout_session_id) WHERE paymongo_checkout_session_id IS NOT NULL"))
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_payments_payment_intent_unique ON payments (paymongo_payment_intent_id) WHERE paymongo_payment_intent_id IS NOT NULL"))
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_payments_source_unique ON payments (paymongo_source_id) WHERE paymongo_source_id IS NOT NULL"))
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_payments_payment_id_unique ON payments (paymongo_payment_id) WHERE paymongo_payment_id IS NOT NULL"))
        
        if engine.dialect.name == "sqlite":
            columns = {row[1] for row in conn.execute(text("PRAGMA table_info(citizen_users)")).fetchall()}
            if "role" not in columns:
                conn.execute(text("ALTER TABLE citizen_users ADD COLUMN role VARCHAR DEFAULT 'public'"))
            if "tin" not in columns:
                conn.execute(text("ALTER TABLE citizen_users ADD COLUMN tin VARCHAR"))
            if "taxpayer_type" not in columns:
                conn.execute(text("ALTER TABLE citizen_users ADD COLUMN taxpayer_type VARCHAR DEFAULT 'Individual'"))
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_citizen_users_tin ON citizen_users (tin)"))
            for table_name in ("admins", "branch_staff"):
                table_columns = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table_name})")).fetchall()}
                if "is_verified" not in table_columns:
                    conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN is_verified BOOLEAN DEFAULT 0"))
            branch_staff_columns = {row[1] for row in conn.execute(text("PRAGMA table_info(branch_staff)")).fetchall()}
            if "account_scope" not in branch_staff_columns:
                conn.execute(text("ALTER TABLE branch_staff ADD COLUMN account_scope VARCHAR DEFAULT 'full_branch'"))
            if "service_window" not in branch_staff_columns:
                conn.execute(text("ALTER TABLE branch_staff ADD COLUMN service_window VARCHAR"))
        else:
            citizen_columns = {column["name"] for column in inspector.get_columns("citizen_users")}
            if "tin" not in citizen_columns:
                conn.execute(text("ALTER TABLE citizen_users ADD COLUMN tin VARCHAR(255)"))
            if "taxpayer_type" not in citizen_columns:
                conn.execute(text("ALTER TABLE citizen_users ADD COLUMN taxpayer_type VARCHAR(255) DEFAULT 'Individual'"))
            for column_name, column_type in (
                ("email_hash", "VARCHAR(255)"),
                ("email_enc", "TEXT"),
                ("full_name_hash", "VARCHAR(255)"),
                ("full_name_enc", "TEXT"),
                ("tin_hash", "VARCHAR(255)"),
                ("tin_enc", "TEXT"),
                ("contact_number_hash", "VARCHAR(255)"),
                ("contact_number_enc", "TEXT"),
                ("address_hash", "VARCHAR(255)"),
                ("address_enc", "TEXT"),
            ):
                if column_name not in citizen_columns:
                    conn.execute(text(f"ALTER TABLE citizen_users ADD COLUMN {column_name} {column_type}"))
            citizen_indexes = {index["name"] for index in inspect(conn).get_indexes("citizen_users")}
            if "ix_citizen_users_tin" not in citizen_indexes:
                conn.execute(text("CREATE UNIQUE INDEX ix_citizen_users_tin ON citizen_users (tin)"))
        if engine.dialect.name == "sqlite":
            citizen_columns = {row[1] for row in conn.execute(text("PRAGMA table_info(citizen_users)")).fetchall()}
            for column_name, column_type in (
                ("email_hash", "VARCHAR"),
                ("email_enc", "TEXT"),
                ("full_name_hash", "VARCHAR"),
                ("full_name_enc", "TEXT"),
                ("tin_hash", "VARCHAR"),
                ("tin_enc", "TEXT"),
                ("contact_number_hash", "VARCHAR"),
                ("contact_number_enc", "TEXT"),
                ("address_hash", "VARCHAR"),
                ("address_enc", "TEXT"),
            ):
                if column_name not in citizen_columns:
                    conn.execute(text(f"ALTER TABLE citizen_users ADD COLUMN {column_name} {column_type}"))
            branch_staff_columns = {column["name"] for column in inspector.get_columns("branch_staff")}
            if "account_scope" not in branch_staff_columns:
                conn.execute(text("ALTER TABLE branch_staff ADD COLUMN account_scope VARCHAR(255) DEFAULT 'full_branch'"))
            if "service_window" not in branch_staff_columns:
                conn.execute(text("ALTER TABLE branch_staff ADD COLUMN service_window VARCHAR(255)"))

        email_otp_columns = {column["name"] for column in inspector.get_columns("email_otps")}
        for column_name, column_type in (
            ("email_hash", "VARCHAR(255)"),
            ("email_enc", "TEXT"),
            ("role_hash", "VARCHAR(255)"),
            ("role_enc", "TEXT"),
        ):
            if column_name not in email_otp_columns:
                conn.execute(text(f"ALTER TABLE email_otps ADD COLUMN {column_name} {column_type}"))

        if "mfa_secrets" in inspector.get_table_names():
            mfa_secret_columns = {column["name"] for column in inspector.get_columns("mfa_secrets")}
            for column_name, column_type in (
                ("portal_hash", "VARCHAR(255)"),
                ("portal_enc", "TEXT"),
                ("username_hash", "VARCHAR(255)"),
                ("username_enc", "TEXT"),
                ("secret_hash", "VARCHAR(255)"),
                ("secret_enc", "TEXT"),
            ):
                if column_name not in mfa_secret_columns:
                    conn.execute(text(f"ALTER TABLE mfa_secrets ADD COLUMN {column_name} {column_type}"))

        if "email_verification_tokens" in inspector.get_table_names():
            verification_columns = {column["name"] for column in inspector.get_columns("email_verification_tokens")}
            for column_name, column_type in (
                ("email_hash", "VARCHAR(255)"),
                ("email_enc", "TEXT"),
                ("token_hash", "VARCHAR(255)"),
                ("token_enc", "TEXT"),
            ):
                if column_name not in verification_columns:
                    conn.execute(text(f"ALTER TABLE email_verification_tokens ADD COLUMN {column_name} {column_type}"))

        receipt_request_columns = {column["name"] for column in inspector.get_columns("receipt_requests")}
        if "branch_id" not in receipt_request_columns:
            conn.execute(text("ALTER TABLE receipt_requests ADD COLUMN branch_id INTEGER"))
        if "matched_receipt_id" not in receipt_request_columns:
            conn.execute(text("ALTER TABLE receipt_requests ADD COLUMN matched_receipt_id INTEGER"))
        if "payment_ref_number" not in receipt_request_columns:
            conn.execute(text("ALTER TABLE receipt_requests ADD COLUMN payment_ref_number VARCHAR(255)"))
        if "tax_type" not in receipt_request_columns:
            conn.execute(text("ALTER TABLE receipt_requests ADD COLUMN tax_type VARCHAR(255)"))
        if "request_type" not in receipt_request_columns:
            conn.execute(text("ALTER TABLE receipt_requests ADD COLUMN request_type VARCHAR(255)"))
        if "appointment_time" not in receipt_request_columns:
            conn.execute(text("ALTER TABLE receipt_requests ADD COLUMN appointment_time DATETIME"))
        if "release_copy_path" not in receipt_request_columns:
            conn.execute(text("ALTER TABLE receipt_requests ADD COLUMN release_copy_path VARCHAR(255)"))
        if "release_copy_filename" not in receipt_request_columns:
            conn.execute(text("ALTER TABLE receipt_requests ADD COLUMN release_copy_filename VARCHAR(255)"))
        if "processed_at" not in receipt_request_columns:
            conn.execute(text("ALTER TABLE receipt_requests ADD COLUMN processed_at DATETIME"))
        for column_name, column_type in (
            ("request_id_hash", "VARCHAR(255)"),
            ("request_id_enc", "TEXT"),
            ("taxpayer_name_hash", "VARCHAR(255)"),
            ("taxpayer_name_enc", "TEXT"),
            ("tax_type_hash", "VARCHAR(255)"),
            ("tax_type_enc", "TEXT"),
            ("request_type_hash", "VARCHAR(255)"),
            ("request_type_enc", "TEXT"),
            ("transaction_date_hash", "VARCHAR(255)"),
            ("transaction_date_enc", "TEXT"),
            ("ref_number_hash", "VARCHAR(255)"),
            ("ref_number_enc", "TEXT"),
            ("email_hash", "VARCHAR(255)"),
            ("email_enc", "TEXT"),
            ("status_hash", "VARCHAR(255)"),
            ("status_enc", "TEXT"),
            ("payment_ref_number_hash", "VARCHAR(255)"),
            ("payment_ref_number_enc", "TEXT"),
            ("release_copy_path_hash", "VARCHAR(255)"),
            ("release_copy_path_enc", "TEXT"),
            ("release_copy_filename_hash", "VARCHAR(255)"),
            ("release_copy_filename_enc", "TEXT"),
        ):
            if column_name not in receipt_request_columns:
                conn.execute(text(f"ALTER TABLE receipt_requests ADD COLUMN {column_name} {column_type}"))

        receipt_request_history_columns = {column["name"] for column in inspector.get_columns("receipt_request_history")}
        for column_name, column_type in (
            ("request_id_hash", "VARCHAR(255)"),
            ("request_id_enc", "TEXT"),
            ("taxpayer_name_hash", "VARCHAR(255)"),
            ("taxpayer_name_enc", "TEXT"),
            ("tax_type_hash", "VARCHAR(255)"),
            ("tax_type_enc", "TEXT"),
            ("request_type_hash", "VARCHAR(255)"),
            ("request_type_enc", "TEXT"),
            ("transaction_date_hash", "VARCHAR(255)"),
            ("transaction_date_enc", "TEXT"),
            ("ref_number_hash", "VARCHAR(255)"),
            ("ref_number_enc", "TEXT"),
            ("email_hash", "VARCHAR(255)"),
            ("email_enc", "TEXT"),
            ("final_status_hash", "VARCHAR(255)"),
            ("final_status_enc", "TEXT"),
            ("payment_ref_number_hash", "VARCHAR(255)"),
            ("payment_ref_number_enc", "TEXT"),
            ("release_copy_filename_hash", "VARCHAR(255)"),
            ("release_copy_filename_enc", "TEXT"),
        ):
            if column_name not in receipt_request_history_columns:
                conn.execute(text(f"ALTER TABLE receipt_request_history ADD COLUMN {column_name} {column_type}"))

        receipt_record_columns = {column["name"] for column in inspector.get_columns("receipt_records")}
        if "source_image_sha256" not in receipt_record_columns:
            conn.execute(text("ALTER TABLE receipt_records ADD COLUMN source_image_sha256 VARCHAR(255)"))
        if "source_image_ahash" not in receipt_record_columns:
            conn.execute(text("ALTER TABLE receipt_records ADD COLUMN source_image_ahash VARCHAR(255)"))
        if "selected_category" not in receipt_record_columns:
            conn.execute(text("ALTER TABLE receipt_records ADD COLUMN selected_category VARCHAR(255)"))
        if "detected_category" not in receipt_record_columns:
            conn.execute(text("ALTER TABLE receipt_records ADD COLUMN detected_category VARCHAR(255)"))
        for column_name, column_type in (
            ("receipt_number_hash", "VARCHAR(255)"),
            ("receipt_number_enc", "TEXT"),
            ("ref_number_hash", "VARCHAR(255)"),
            ("ref_number_enc", "TEXT"),
            ("txn_id_hash", "VARCHAR(255)"),
            ("txn_id_enc", "TEXT"),
            ("taxpayer_name_hash", "VARCHAR(255)"),
            ("taxpayer_name_enc", "TEXT"),
            ("transaction_date_hash", "VARCHAR(255)"),
            ("transaction_date_enc", "TEXT"),
            ("tax_type_hash", "VARCHAR(255)"),
            ("tax_type_enc", "TEXT"),
            ("payment_method_hash", "VARCHAR(255)"),
            ("payment_method_enc", "TEXT"),
            ("source_image_path_hash", "VARCHAR(255)"),
            ("source_image_path_enc", "TEXT"),
            ("raw_ocr_text_hash", "VARCHAR(255)"),
            ("raw_ocr_text_enc", "TEXT"),
            ("verification_status_hash", "VARCHAR(255)"),
            ("verification_status_enc", "TEXT"),
        ):
            if column_name not in receipt_record_columns:
                conn.execute(text(f"ALTER TABLE receipt_records ADD COLUMN {column_name} {column_type}"))

        branch_columns = {column["name"] for column in inspector.get_columns("branches")}
        if "dashboard_url" not in branch_columns:
            conn.execute(text("ALTER TABLE branches ADD COLUMN dashboard_url VARCHAR(255)"))
        for column_name, column_type in (
            ("name_hash", "VARCHAR(255)"),
            ("name_enc", "TEXT"),
            ("location_hash", "VARCHAR(255)"),
            ("location_enc", "TEXT"),
            ("contact_hash", "VARCHAR(255)"),
            ("contact_enc", "TEXT"),
            ("dashboard_url_hash", "VARCHAR(255)"),
            ("dashboard_url_enc", "TEXT"),
        ):
            if column_name not in branch_columns:
                conn.execute(text(f"ALTER TABLE branches ADD COLUMN {column_name} {column_type}"))

        queue_activity_columns = {column["name"] for column in inspector.get_columns("queue_activity")}
        for column_name, column_type in (
            ("service_type_hash", "VARCHAR(255)"),
            ("service_type_enc", "TEXT"),
        ):
            if column_name not in queue_activity_columns:
                conn.execute(text(f"ALTER TABLE queue_activity ADD COLUMN {column_name} {column_type}"))

        if "rpt_property_records" in inspector.get_table_names():
            rpt_property_columns = {column["name"] for column in inspector.get_columns("rpt_property_records")}
            for column_name, column_type in (
                ("tdn_hash", "VARCHAR(255)"),
                ("tdn_enc", "TEXT"),
            ):
                if column_name not in rpt_property_columns:
                    conn.execute(text(f"ALTER TABLE rpt_property_records ADD COLUMN {column_name} {column_type}"))

        tax_assessment_columns = {column["name"] for column in inspector.get_columns("tax_assessment_records")}
        for column_name, column_type in (
            ("tax_type_hash", "VARCHAR(255)"),
            ("tax_type_enc", "TEXT"),
            ("assessment_status_hash", "VARCHAR(255)"),
            ("assessment_status_enc", "TEXT"),
            ("verification_status_hash", "VARCHAR(255)"),
            ("verification_status_enc", "TEXT"),
            ("taxpayer_name_hash", "VARCHAR(255)"),
            ("taxpayer_name_enc", "TEXT"),
            ("taxpayer_email_hash", "VARCHAR(255)"),
            ("taxpayer_email_enc", "TEXT"),
            ("taxpayer_type_hash", "VARCHAR(255)"),
            ("taxpayer_type_enc", "TEXT"),
            ("mobile_number_hash", "VARCHAR(255)"),
            ("mobile_number_enc", "TEXT"),
            ("address_hash", "VARCHAR(255)"),
            ("address_enc", "TEXT"),
            ("tax_year_hash", "VARCHAR(255)"),
            ("tax_year_enc", "TEXT"),
            ("tdn_hash", "VARCHAR(255)"),
            ("tdn_enc", "TEXT"),
            ("property_type_hash", "VARCHAR(255)"),
            ("property_type_enc", "TEXT"),
            ("property_address_hash", "VARCHAR(255)"),
            ("property_address_enc", "TEXT"),
            ("remarks_hash", "VARCHAR(255)"),
            ("remarks_enc", "TEXT"),
            ("rejection_reason_hash", "VARCHAR(255)"),
            ("rejection_reason_enc", "TEXT"),
            ("created_by_hash", "VARCHAR(255)"),
            ("created_by_enc", "TEXT"),
            ("updated_by_hash", "VARCHAR(255)"),
            ("updated_by_enc", "TEXT"),
            ("mayor_permit_number_hash", "VARCHAR(255)"),
            ("mayor_permit_number_enc", "TEXT"),
            ("sec_dti_cda_number_hash", "VARCHAR(255)"),
            ("sec_dti_cda_number_enc", "TEXT"),
            ("business_name_hash", "VARCHAR(255)"),
            ("business_name_enc", "TEXT"),
            ("business_type_hash", "VARCHAR(255)"),
            ("business_type_enc", "TEXT"),
        ):
            if column_name not in tax_assessment_columns:
                conn.execute(text(f"ALTER TABLE tax_assessment_records ADD COLUMN {column_name} {column_type}"))

        taxpayer_submission_columns = {column["name"] for column in inspector.get_columns("taxpayer_identifier_submissions")}
        for column_name, column_type in (
            ("submission_type_hash", "VARCHAR(255)"),
            ("submission_type_enc", "TEXT"),
            ("taxpayer_type_hash", "VARCHAR(255)"),
            ("taxpayer_type_enc", "TEXT"),
            ("full_name_hash", "VARCHAR(255)"),
            ("full_name_enc", "TEXT"),
            ("email_hash", "VARCHAR(255)"),
            ("email_enc", "TEXT"),
            ("mobile_number_hash", "VARCHAR(255)"),
            ("mobile_number_enc", "TEXT"),
            ("address_hash", "VARCHAR(255)"),
            ("address_enc", "TEXT"),
            ("tdn_hash", "VARCHAR(255)"),
            ("tdn_enc", "TEXT"),
            ("mayor_permit_number_hash", "VARCHAR(255)"),
            ("mayor_permit_number_enc", "TEXT"),
            ("sec_dti_cda_number_hash", "VARCHAR(255)"),
            ("sec_dti_cda_number_enc", "TEXT"),
            ("supporting_file_path_hash", "VARCHAR(255)"),
            ("supporting_file_path_enc", "TEXT"),
            ("supporting_file_name_hash", "VARCHAR(255)"),
            ("supporting_file_name_enc", "TEXT"),
            ("supporting_file_mime_hash", "VARCHAR(255)"),
            ("supporting_file_mime_enc", "TEXT"),
            ("status_hash", "VARCHAR(255)"),
            ("status_enc", "TEXT"),
            ("remarks_hash", "VARCHAR(255)"),
            ("remarks_enc", "TEXT"),
            ("reviewed_by_hash", "VARCHAR(255)"),
            ("reviewed_by_enc", "TEXT"),
        ):
            if column_name not in taxpayer_submission_columns:
                conn.execute(text(f"ALTER TABLE taxpayer_identifier_submissions ADD COLUMN {column_name} {column_type}"))

        if "service_window_config" in inspector.get_table_names():
            service_window_columns = {column["name"] for column in inspector.get_columns("service_window_config")}
            if engine.dialect.name == "mysql":
                conn.execute(text("ALTER TABLE service_window_config MODIFY COLUMN window_count VARCHAR(255) NULL"))
            for column_name, column_type in (
                ("window_count_hash", "VARCHAR(255)"),
                ("window_count_enc", "TEXT"),
            ):
                if column_name not in service_window_columns:
                    conn.execute(text(f"ALTER TABLE service_window_config ADD COLUMN {column_name} {column_type}"))

        service_columns = {column["name"] for column in inspector.get_columns("services")}
        for column_name, column_type in (
            ("name_hash", "VARCHAR(255)"),
            ("name_enc", "TEXT"),
            ("description_hash", "VARCHAR(255)"),
            ("description_enc", "TEXT"),
            ("category_hash", "VARCHAR(255)"),
            ("category_enc", "TEXT"),
        ):
            if column_name not in service_columns:
                conn.execute(text(f"ALTER TABLE services ADD COLUMN {column_name} {column_type}"))

        queue_columns = {column["name"] for column in inspector.get_columns("queues")}
        for column_name, column_type in (
            ("queue_number_hash", "VARCHAR(255)"),
            ("queue_number_enc", "TEXT"),
            ("service_type_hash", "VARCHAR(255)"),
            ("service_type_enc", "TEXT"),
            ("taxpayer_name_hash", "VARCHAR(255)"),
            ("taxpayer_name_enc", "TEXT"),
            ("contact_number_hash", "VARCHAR(255)"),
            ("contact_number_enc", "TEXT"),
            ("email_hash", "VARCHAR(255)"),
            ("email_enc", "TEXT"),
            ("status_hash", "VARCHAR(255)"),
            ("status_enc", "TEXT"),
            ("queue_type_hash", "VARCHAR(255)"),
            ("queue_type_enc", "TEXT"),
        ):
            if column_name not in queue_columns:
                conn.execute(text(f"ALTER TABLE queues ADD COLUMN {column_name} {column_type}"))

        business_registry_columns = {column["name"] for column in inspector.get_columns("business_registry")}
        for column_name, column_type in (
            ("business_name_hash", "VARCHAR(255)"),
            ("business_name_enc", "TEXT"),
            ("owner_name_hash", "VARCHAR(255)"),
            ("owner_name_enc", "TEXT"),
            ("mayor_permit_number_hash", "VARCHAR(255)"),
            ("mayor_permit_number_enc", "TEXT"),
            ("sec_dti_cda_number_hash", "VARCHAR(255)"),
            ("sec_dti_cda_number_enc", "TEXT"),
            ("business_type_hash", "VARCHAR(255)"),
            ("business_type_enc", "TEXT"),
            ("branch_assigned_hash", "VARCHAR(255)"),
            ("branch_assigned_enc", "TEXT"),
            ("tin_hash", "VARCHAR(255)"),
            ("tin_enc", "TEXT"),
        ):
            if column_name not in business_registry_columns:
                conn.execute(text(f"ALTER TABLE business_registry ADD COLUMN {column_name} {column_type}"))

        business_tax_application_columns = {column["name"] for column in inspector.get_columns("business_tax_applications")}
        for column_name, column_type in (
            ("taxpayer_name_hash", "VARCHAR(255)"),
            ("taxpayer_name_enc", "TEXT"),
            ("taxpayer_email_hash", "VARCHAR(255)"),
            ("taxpayer_email_enc", "TEXT"),
            ("tin_hash", "VARCHAR(255)"),
            ("tin_enc", "TEXT"),
            ("branch_name_hash", "VARCHAR(255)"),
            ("branch_name_enc", "TEXT"),
            ("mayor_permit_number_hash", "VARCHAR(255)"),
            ("mayor_permit_number_enc", "TEXT"),
            ("sec_dti_cda_number_hash", "VARCHAR(255)"),
            ("sec_dti_cda_number_enc", "TEXT"),
            ("business_name_hash", "VARCHAR(255)"),
            ("business_name_enc", "TEXT"),
            ("owner_name_hash", "VARCHAR(255)"),
            ("owner_name_enc", "TEXT"),
            ("business_type_hash", "VARCHAR(255)"),
            ("business_type_enc", "TEXT"),
            ("payment_ref_number_hash", "VARCHAR(255)"),
            ("payment_ref_number_enc", "TEXT"),
            ("verifier_remarks_hash", "VARCHAR(255)"),
            ("verifier_remarks_enc", "TEXT"),
            ("official_receipt_number_hash", "VARCHAR(255)"),
            ("official_receipt_number_enc", "TEXT"),
        ):
            if column_name not in business_tax_application_columns:
                conn.execute(text(f"ALTER TABLE business_tax_applications ADD COLUMN {column_name} {column_type}"))

        faq_columns = {column["name"] for column in inspector.get_columns("faqs")}
        for column_name, column_type in (
            ("question_hash", "VARCHAR(255)"),
            ("question_enc", "TEXT"),
            ("answer_hash", "VARCHAR(255)"),
            ("answer_enc", "TEXT"),
            ("category_hash", "VARCHAR(255)"),
            ("category_enc", "TEXT"),
            ("language_hash", "VARCHAR(255)"),
            ("language_enc", "TEXT"),
        ):
            if column_name not in faq_columns:
                conn.execute(text(f"ALTER TABLE faqs ADD COLUMN {column_name} {column_type}"))

        taxpayer_guide_columns = {column["name"] for column in inspector.get_columns("taxpayer_guides")}
        for column_name, column_type in (
            ("title_hash", "VARCHAR(255)"),
            ("title_enc", "TEXT"),
            ("content_hash", "VARCHAR(255)"),
            ("content_enc", "TEXT"),
            ("category_hash", "VARCHAR(255)"),
            ("category_enc", "TEXT"),
            ("language_hash", "VARCHAR(255)"),
            ("language_enc", "TEXT"),
        ):
            if column_name not in taxpayer_guide_columns:
                conn.execute(text(f"ALTER TABLE taxpayer_guides ADD COLUMN {column_name} {column_type}"))

        invite_columns = {column["name"] for column in inspector.get_columns("invites")}
        for column_name, column_type in (
            ("email_hash", "VARCHAR(255)"),
            ("email_enc", "TEXT"),
            ("role_hash", "VARCHAR(255)"),
            ("role_enc", "TEXT"),
            ("token_hash", "VARCHAR(255)"),
            ("token_enc", "TEXT"),
        ):
            if column_name not in invite_columns:
                conn.execute(text(f"ALTER TABLE invites ADD COLUMN {column_name} {column_type}"))

        memo_view_columns = {column["name"] for column in inspector.get_columns("memo_views")}
        for column_name, column_type in (
            ("viewer_username_hash", "VARCHAR(255)"),
            ("viewer_username_enc", "TEXT"),
            ("viewer_type_hash", "VARCHAR(255)"),
            ("viewer_type_enc", "TEXT"),
        ):
            if column_name not in memo_view_columns:
                conn.execute(text(f"ALTER TABLE memo_views ADD COLUMN {column_name} {column_type}"))

        if "email_verification_tokens" in inspector.get_table_names():
            verification_columns = {column["name"] for column in inspector.get_columns("email_verification_tokens")}
            for column_name, column_type in (
                ("email_hash", "VARCHAR(255)"),
                ("email_enc", "TEXT"),
                ("token_hash", "VARCHAR(255)"),
                ("token_enc", "TEXT"),
            ):
                if column_name not in verification_columns:
                    conn.execute(text(f"ALTER TABLE email_verification_tokens ADD COLUMN {column_name} {column_type}"))
            if engine.dialect.name == "mysql":
                verification_fk = conn.execute(text("""
                    SELECT rc.CONSTRAINT_NAME
                    FROM information_schema.REFERENTIAL_CONSTRAINTS rc
                    JOIN information_schema.KEY_COLUMN_USAGE kcu
                      ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
                     AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
                    WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
                      AND rc.TABLE_NAME = 'email_verification_tokens'
                      AND kcu.COLUMN_NAME = 'citizen_user_id'
                    LIMIT 1
                """)).scalar()
                delete_rule = conn.execute(text("""
                    SELECT DELETE_RULE
                    FROM information_schema.REFERENTIAL_CONSTRAINTS rc
                    JOIN information_schema.KEY_COLUMN_USAGE kcu
                      ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
                     AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
                    WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
                      AND rc.TABLE_NAME = 'email_verification_tokens'
                      AND kcu.COLUMN_NAME = 'citizen_user_id'
                    LIMIT 1
                """)).scalar()

                if verification_fk and delete_rule != "CASCADE":
                    conn.execute(text(f"ALTER TABLE email_verification_tokens DROP FOREIGN KEY {verification_fk}"))
                    conn.execute(text("""
                        ALTER TABLE email_verification_tokens
                        ADD CONSTRAINT email_verification_tokens_citizen_user_id_fk
                        FOREIGN KEY (citizen_user_id) REFERENCES citizen_users(id)
                        ON DELETE CASCADE
                    """))

        if engine.dialect.name == "sqlite":
            discrepancy_tables = {
                row[0] for row in conn.execute(
                    text("SELECT name FROM sqlite_master WHERE type='table'")
                ).fetchall()
            }
            if "discrepancy_reports" not in discrepancy_tables:
                conn.execute(text("""
                    CREATE TABLE discrepancy_reports (
                        id INTEGER PRIMARY KEY,
                        branch_id INTEGER NOT NULL,
                        title VARCHAR NOT NULL DEFAULT 'Untitled Report',
                        report_date VARCHAR NOT NULL,
                        discrepancy_type VARCHAR NOT NULL,
                        system_amount FLOAT,
                        actual_amount FLOAT,
                        description TEXT NOT NULL,
                        supporting_documents TEXT,
                        attachment_path VARCHAR,
                        attachment_filename VARCHAR,
                        submitted_offline BOOLEAN DEFAULT 0,
                        status VARCHAR DEFAULT 'Pending Review',
                        verification_notes TEXT,
                        branch_reply_notes TEXT,
                        conversation_thread TEXT,
                        reported_by VARCHAR NOT NULL,
                        verified_by VARCHAR,
                        branch_replied_by VARCHAR,
                        verified_at DATETIME,
                        branch_replied_at DATETIME,
                        last_viewed_by_branch DATETIME,
                        last_viewed_by_admin DATETIME,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(branch_id) REFERENCES branches(id)
                    )
                """))

        if "discrepancy_reports" in set(inspector.get_table_names()):
            discrepancy_columns = {column["name"] for column in inspector.get_columns("discrepancy_reports")}
            if "title" not in discrepancy_columns:
                conn.execute(text("ALTER TABLE discrepancy_reports ADD COLUMN title VARCHAR(255) DEFAULT 'Untitled Report'"))
                conn.execute(text("UPDATE discrepancy_reports SET title = COALESCE(NULLIF(title, ''), discrepancy_type || ' - Report #' || id)"))
            if "last_viewed_by_branch" not in discrepancy_columns:
                conn.execute(text("ALTER TABLE discrepancy_reports ADD COLUMN last_viewed_by_branch DATETIME"))
            if "last_viewed_by_admin" not in discrepancy_columns:
                conn.execute(text("ALTER TABLE discrepancy_reports ADD COLUMN last_viewed_by_admin DATETIME"))
            if "branch_reply_notes" not in discrepancy_columns:
                conn.execute(text("ALTER TABLE discrepancy_reports ADD COLUMN branch_reply_notes TEXT"))
            if "conversation_thread" not in discrepancy_columns:
                conn.execute(text("ALTER TABLE discrepancy_reports ADD COLUMN conversation_thread TEXT"))
            if "branch_replied_by" not in discrepancy_columns:
                conn.execute(text("ALTER TABLE discrepancy_reports ADD COLUMN branch_replied_by VARCHAR(255)"))
            if "branch_replied_at" not in discrepancy_columns:
                conn.execute(text("ALTER TABLE discrepancy_reports ADD COLUMN branch_replied_at DATETIME"))
            if "attachment_path" not in discrepancy_columns:
                conn.execute(text("ALTER TABLE discrepancy_reports ADD COLUMN attachment_path VARCHAR(255)"))
            if "attachment_filename" not in discrepancy_columns:
                conn.execute(text("ALTER TABLE discrepancy_reports ADD COLUMN attachment_filename VARCHAR(255)"))
            for column_name, column_type in (
                ("title_hash", "VARCHAR(255)"),
                ("title_enc", "TEXT"),
                ("report_date_hash", "VARCHAR(255)"),
                ("report_date_enc", "TEXT"),
                ("discrepancy_type_hash", "VARCHAR(255)"),
                ("discrepancy_type_enc", "TEXT"),
                ("description_hash", "VARCHAR(255)"),
                ("description_enc", "TEXT"),
                ("supporting_documents_hash", "VARCHAR(255)"),
                ("supporting_documents_enc", "TEXT"),
                ("attachment_path_hash", "VARCHAR(255)"),
                ("attachment_path_enc", "TEXT"),
                ("attachment_filename_hash", "VARCHAR(255)"),
                ("attachment_filename_enc", "TEXT"),
                ("verification_notes_hash", "VARCHAR(255)"),
                ("verification_notes_enc", "TEXT"),
                ("branch_reply_notes_hash", "VARCHAR(255)"),
                ("branch_reply_notes_enc", "TEXT"),
                ("conversation_thread_hash", "VARCHAR(255)"),
                ("conversation_thread_enc", "TEXT"),
                ("reported_by_hash", "VARCHAR(255)"),
                ("reported_by_enc", "TEXT"),
                ("verified_by_hash", "VARCHAR(255)"),
                ("verified_by_enc", "TEXT"),
                ("branch_replied_by_hash", "VARCHAR(255)"),
                ("branch_replied_by_enc", "TEXT"),
            ):
                if column_name not in discrepancy_columns:
                    conn.execute(text(f"ALTER TABLE discrepancy_reports ADD COLUMN {column_name} {column_type}"))

        table_names = set(inspector.get_table_names())

        if "system_settings" not in table_names:
            conn.execute(text("""
                CREATE TABLE system_settings (
                    `key` VARCHAR(255) PRIMARY KEY,
                    label VARCHAR(255) NOT NULL,
                    category VARCHAR(255) NOT NULL,
                    value_json TEXT NULL,
                    value TEXT NOT NULL,
                    value_type VARCHAR(255) NOT NULL DEFAULT 'string',
                    description TEXT NULL,
                    updated_by VARCHAR(255) NULL,
                    updated_at DATETIME NULL
                )
            """))
        else:
            system_setting_columns = {column["name"] for column in inspector.get_columns("system_settings")}
            if "label" not in system_setting_columns:
                conn.execute(text("ALTER TABLE system_settings ADD COLUMN label VARCHAR(255)"))
            if "category" not in system_setting_columns:
                conn.execute(text("ALTER TABLE system_settings ADD COLUMN category VARCHAR(255)"))
            if "value_json" not in system_setting_columns:
                conn.execute(text("ALTER TABLE system_settings ADD COLUMN value_json TEXT"))
            if "value" not in system_setting_columns:
                conn.execute(text("ALTER TABLE system_settings ADD COLUMN value TEXT"))
            if "value_type" not in system_setting_columns:
                conn.execute(text("ALTER TABLE system_settings ADD COLUMN value_type VARCHAR(255) DEFAULT 'string'"))
            if "description" not in system_setting_columns:
                conn.execute(text("ALTER TABLE system_settings ADD COLUMN description TEXT"))
            if "updated_by" not in system_setting_columns:
                conn.execute(text("ALTER TABLE system_settings ADD COLUMN updated_by VARCHAR(255)"))
            if "updated_at" not in system_setting_columns:
                conn.execute(text("ALTER TABLE system_settings ADD COLUMN updated_at DATETIME"))
            for column_name, column_type in (
                ("key_hash", "VARCHAR(255)"),
                ("key_enc", "TEXT"),
                ("label_hash", "VARCHAR(255)"),
                ("label_enc", "TEXT"),
                ("category_hash", "VARCHAR(255)"),
                ("category_enc", "TEXT"),
                ("value_json_hash", "VARCHAR(255)"),
                ("value_json_enc", "TEXT"),
                ("value_hash", "VARCHAR(255)"),
                ("value_enc", "TEXT"),
                ("value_type_hash", "VARCHAR(255)"),
                ("value_type_enc", "TEXT"),
                ("description_hash", "VARCHAR(255)"),
                ("description_enc", "TEXT"),
                ("updated_by_hash", "VARCHAR(255)"),
                ("updated_by_enc", "TEXT"),
            ):
                if column_name not in system_setting_columns:
                    conn.execute(text(f"ALTER TABLE system_settings ADD COLUMN {column_name} {column_type}"))

        if "system_setting_audit" not in table_names:
            conn.execute(text("""
                CREATE TABLE system_setting_audit (
                    id INTEGER PRIMARY KEY AUTO_INCREMENT,
                    setting_key VARCHAR(255) NOT NULL,
                    setting_label VARCHAR(255) NOT NULL,
                    category VARCHAR(255) NOT NULL,
                    previous_value TEXT NULL,
                    new_value TEXT NOT NULL,
                    changed_by VARCHAR(255) NOT NULL,
                    reason TEXT NULL,
                    changed_at DATETIME NULL,
                    FOREIGN KEY (setting_key) REFERENCES system_settings(`key`)
                )
            """) if engine.dialect.name != "sqlite" else text("""
                CREATE TABLE system_setting_audit (
                    id INTEGER PRIMARY KEY,
                    setting_key VARCHAR(255) NOT NULL,
                    setting_label VARCHAR(255) NOT NULL,
                    category VARCHAR(255) NOT NULL,
                    previous_value TEXT NULL,
                    new_value TEXT NOT NULL,
                    changed_by VARCHAR(255) NOT NULL,
                    reason TEXT NULL,
                    changed_at DATETIME NULL,
                    FOREIGN KEY (setting_key) REFERENCES system_settings(`key`)
                )
            """))

        if "branch_appointment_schedules" not in table_names:
            conn.execute(text("""
                CREATE TABLE branch_appointment_schedules (
                    id INTEGER PRIMARY KEY AUTO_INCREMENT,
                    branch_id INTEGER NOT NULL,
                    draft_config TEXT NOT NULL,
                    published_config TEXT NOT NULL,
                    effective_date VARCHAR(255) NOT NULL,
                    updated_by VARCHAR(255) NULL,
                    published_by VARCHAR(255) NULL,
                    updated_at DATETIME NULL,
                    published_at DATETIME NULL,
                    FOREIGN KEY (branch_id) REFERENCES branches(id)
                )
            """) if engine.dialect.name != "sqlite" else text("""
                CREATE TABLE branch_appointment_schedules (
                    id INTEGER PRIMARY KEY,
                    branch_id INTEGER NOT NULL,
                    draft_config TEXT NOT NULL,
                    published_config TEXT NOT NULL,
                    effective_date VARCHAR NOT NULL,
                    updated_by VARCHAR NULL,
                    published_by VARCHAR NULL,
                    updated_at DATETIME NULL,
                    published_at DATETIME NULL,
                    FOREIGN KEY (branch_id) REFERENCES branches(id)
                )
            """))

        if "branch_appointment_schedule_audit" not in table_names:
            conn.execute(text("""
                CREATE TABLE branch_appointment_schedule_audit (
                    id INTEGER PRIMARY KEY AUTO_INCREMENT,
                    branch_id INTEGER NOT NULL,
                    action VARCHAR(255) NOT NULL,
                    change_summary TEXT NULL,
                    previous_config TEXT NULL,
                    new_config TEXT NOT NULL,
                    effective_date VARCHAR(255) NOT NULL,
                    changed_by VARCHAR(255) NOT NULL,
                    reason TEXT NULL,
                    changed_at DATETIME NULL,
                    FOREIGN KEY (branch_id) REFERENCES branches(id)
                )
            """) if engine.dialect.name != "sqlite" else text("""
                CREATE TABLE branch_appointment_schedule_audit (
                    id INTEGER PRIMARY KEY,
                    branch_id INTEGER NOT NULL,
                    action VARCHAR NOT NULL,
                    change_summary TEXT NULL,
                    previous_config TEXT NULL,
                    new_config TEXT NOT NULL,
                    effective_date VARCHAR NOT NULL,
                    changed_by VARCHAR NOT NULL,
                    reason TEXT NULL,
                    changed_at DATETIME NULL,
                    FOREIGN KEY (branch_id) REFERENCES branches(id)
                )
            """))

    db = SessionLocal()
    try:
        seed_system_settings(db)
    finally:
        db.close()

def bootstrap_admin():
    admin_email = os.getenv("ADMIN_EMAIL")
    admin_password = os.getenv("ADMIN_PASSWORD")
    if not admin_email or not admin_password:
        return

    db = SessionLocal()
    try:
        admin_exists = db.query(Admin).filter(Admin.role.in_(["main_admin", "admin"])).first()
        if admin_exists:
            return

        pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
        username = admin_email.split("@", 1)[0]
        db.add(Admin(
            username=username,
            email=admin_email.lower(),
            hashed_password=pwd_context.hash(admin_password),
            role="main_admin",
            status="Active",
            is_verified=True,
        ))
        db.commit()
    finally:
        db.close()


def seed_business_registry():
    db = SessionLocal()
    try:
        if db.query(BusinessRegistry.id).first():
            return
        branch_lookup = {
            (get_decrypted_or_raw(branch, "name") or branch.name): branch
            for branch in db.query(Branch).all()
        }
        seed_rows = [
            {
                "business_name": "Cortez Trading Solutions",
                "owner_name": "Justin Paolo M. Cortez",
                "mayor_permit_number": "BP-2026-000145",
                "sec_dti_cda_number": "DTI-2026-483921",
                "business_type": "Single Proprietorship",
                "branch_assigned": "Galas Branch",
                "tin": "123123123123",
                "annual_gross_sales": 1850000.00,
                "assessed_tax_due": 12500.00,
                "business_status": "ACTIVE",
            },
            {
                "business_name": "Northline Consumer Goods OPC",
                "owner_name": "Maria Lourdes Santos",
                "mayor_permit_number": "BP-2026-000287",
                "sec_dti_cda_number": "SEC-2026-771204",
                "business_type": "OPC",
                "branch_assigned": "District 1 Branch",
                "tin": "231231231231",
                "annual_gross_sales": 2640000.00,
                "assessed_tax_due": 18450.00,
                "business_status": "ACTIVE",
            },
            {
                "business_name": "Novaliches Food Hub Cooperative",
                "owner_name": "Ramon Dela Cruz",
                "mayor_permit_number": "BP-2026-000388",
                "sec_dti_cda_number": "CDA-2026-115903",
                "business_type": "Cooperative",
                "branch_assigned": "Novaliches Branch",
                "tin": "312312312312",
                "annual_gross_sales": 3210000.00,
                "assessed_tax_due": 22780.00,
                "business_status": "ACTIVE",
            },
            {
                "business_name": "Sunrise Printing Services",
                "owner_name": "Elaine Rosario",
                "mayor_permit_number": "BP-2026-000512",
                "sec_dti_cda_number": "DTI-2026-551102",
                "business_type": "Single Proprietorship",
                "branch_assigned": "Galas Branch",
                "tin": "445566778899",
                "annual_gross_sales": 910000.00,
                "assessed_tax_due": 6400.00,
                "business_status": "SUSPENDED",
            },
            {
                "business_name": "Blue Harbor Retail Corp.",
                "owner_name": "Patrick Ong",
                "mayor_permit_number": "BP-2025-000214",
                "sec_dti_cda_number": "SEC-2025-332801",
                "business_type": "Corporation",
                "branch_assigned": "District 1 Branch",
                "tin": "998877665544",
                "annual_gross_sales": 4100000.00,
                "assessed_tax_due": 28600.00,
                "business_status": "EXPIRED",
            },
        ]

        for row in seed_rows:
            permit_hash = hash_optional_value(row["mayor_permit_number"])
            existing = db.query(BusinessRegistry).filter(
                or_(
                    BusinessRegistry.mayor_permit_number == row["mayor_permit_number"],
                    BusinessRegistry.mayor_permit_number_hash == permit_hash,
                )
            ).first()
            if existing:
                continue

            branch = branch_lookup.get(row["branch_assigned"])
            registry = BusinessRegistry(
                business_name=row["business_name"],
                owner_name=row["owner_name"],
                mayor_permit_number=row["mayor_permit_number"],
                sec_dti_cda_number=row["sec_dti_cda_number"],
                business_type=row["business_type"],
                branch_id=branch.id if branch else None,
                branch_assigned=row["branch_assigned"],
                tin=row["tin"],
                annual_gross_sales=row["annual_gross_sales"],
                assessed_tax_due=row["assessed_tax_due"],
                business_status=row["business_status"],
            )
            apply_business_registry_security(registry)
            db.add(registry)

        db.commit()
    finally:
        db.close()


def apply_branch_security(branch: Branch):
    name_value = get_decrypted_or_raw(branch, "name") or branch.name
    location_value = get_decrypted_or_raw(branch, "location") or branch.location
    contact_value = get_decrypted_or_raw(branch, "contact") or branch.contact
    dashboard_value = get_decrypted_or_raw(branch, "dashboard_url") or branch.dashboard_url
    set_encrypted_hash_companions(branch, "name", name_value)
    set_encrypted_hash_companions(branch, "location", location_value)
    set_encrypted_hash_companions(branch, "contact", contact_value)
    set_encrypted_hash_companions(branch, "dashboard_url", dashboard_value)
    branch.name = build_redacted_text("BRANCH_NAME", name_value, 255)
    branch.location = build_redacted_text("BRANCH_LOCATION", location_value, 255)
    branch.contact = build_redacted_text("BRANCH_CONTACT", contact_value, 255)
    branch.dashboard_url = build_redacted_text("BRANCH_URL", dashboard_value, 255)


def apply_business_registry_security(record: BusinessRegistry):
    business_name = get_decrypted_or_raw(record, "business_name") or record.business_name
    owner_name = get_decrypted_or_raw(record, "owner_name") or record.owner_name
    permit_number = get_decrypted_or_raw(record, "mayor_permit_number") or record.mayor_permit_number
    registration_number = get_decrypted_or_raw(record, "sec_dti_cda_number") or record.sec_dti_cda_number
    business_type = get_decrypted_or_raw(record, "business_type") or record.business_type
    branch_assigned = get_decrypted_or_raw(record, "branch_assigned") or record.branch_assigned
    tin_value = get_decrypted_or_raw(record, "tin") or record.tin
    set_encrypted_hash_companions(record, "business_name", business_name)
    set_encrypted_hash_companions(record, "owner_name", owner_name)
    set_encrypted_hash_companions(record, "mayor_permit_number", permit_number)
    set_encrypted_hash_companions(record, "sec_dti_cda_number", registration_number)
    set_encrypted_hash_companions(record, "business_type", business_type)
    set_encrypted_hash_companions(record, "branch_assigned", branch_assigned)
    set_encrypted_hash_companions(record, "tin", tin_value)
    record.business_name = build_redacted_text("BUSINESS_NAME", business_name, 255)
    record.owner_name = build_redacted_text("BUSINESS_OWNER", owner_name, 255)
    record.mayor_permit_number = build_redacted_text("MAYOR_PERMIT", permit_number, 255)
    record.sec_dti_cda_number = build_redacted_text("REGISTRATION", registration_number, 255)
    record.business_type = build_redacted_text("BUSINESS_TYPE", business_type, 255)
    record.branch_assigned = build_redacted_text("BRANCH_ASSIGNMENT", branch_assigned, 255)
    record.tin = build_redacted_text("BUSINESS_TIN", tin_value, 255)


def apply_business_tax_application_security(application: BusinessTaxApplication):
    taxpayer_name = get_decrypted_or_raw(application, "taxpayer_name") or application.taxpayer_name
    taxpayer_email = get_decrypted_or_raw(application, "taxpayer_email") or application.taxpayer_email
    tin_value = get_decrypted_or_raw(application, "tin") or application.tin
    branch_name = get_decrypted_or_raw(application, "branch_name") or application.branch_name
    permit_number = get_decrypted_or_raw(application, "mayor_permit_number") or application.mayor_permit_number
    registration_number = get_decrypted_or_raw(application, "sec_dti_cda_number") or application.sec_dti_cda_number
    business_name = get_decrypted_or_raw(application, "business_name") or application.business_name
    owner_name = get_decrypted_or_raw(application, "owner_name") or application.owner_name
    business_type = get_decrypted_or_raw(application, "business_type") or application.business_type
    payment_ref_number = get_decrypted_or_raw(application, "payment_ref_number") or application.payment_ref_number
    verifier_remarks = get_decrypted_or_raw(application, "verifier_remarks") or application.verifier_remarks
    official_receipt_number = get_decrypted_or_raw(application, "official_receipt_number") or application.official_receipt_number
    set_encrypted_hash_companions(application, "taxpayer_name", taxpayer_name)
    set_encrypted_hash_companions(application, "taxpayer_email", taxpayer_email)
    set_encrypted_hash_companions(application, "tin", tin_value)
    set_encrypted_hash_companions(application, "branch_name", branch_name)
    set_encrypted_hash_companions(application, "mayor_permit_number", permit_number)
    set_encrypted_hash_companions(application, "sec_dti_cda_number", registration_number)
    set_encrypted_hash_companions(application, "business_name", business_name)
    set_encrypted_hash_companions(application, "owner_name", owner_name)
    set_encrypted_hash_companions(application, "business_type", business_type)
    set_encrypted_hash_companions(application, "payment_ref_number", payment_ref_number)
    set_encrypted_hash_companions(application, "verifier_remarks", verifier_remarks)
    set_encrypted_hash_companions(application, "official_receipt_number", official_receipt_number)
    application.taxpayer_name = build_redacted_text("BT_TAXPAYER", taxpayer_name, 255)
    application.taxpayer_email = build_redacted_text("BT_EMAIL", taxpayer_email, 255)
    application.tin = build_redacted_text("BT_TIN", tin_value, 255)
    application.branch_name = build_redacted_text("BT_BRANCH", branch_name, 255)
    application.mayor_permit_number = build_redacted_text("BT_PERMIT", permit_number, 255)
    application.sec_dti_cda_number = build_redacted_text("BT_REGISTRATION", registration_number, 255)
    application.business_name = build_redacted_text("BT_BUSINESS", business_name, 255)
    application.owner_name = build_redacted_text("BT_OWNER", owner_name, 255)
    application.business_type = build_redacted_text("BT_TYPE", business_type, 255)
    application.payment_ref_number = build_redacted_text("BT_PAYMENT_REF", payment_ref_number, 255)
    application.verifier_remarks = build_redacted_text("BT_REMARKS", verifier_remarks, 255)
    application.official_receipt_number = build_redacted_text("BT_OR", official_receipt_number, 255)


def _is_assessment_placeholder(value: str | None) -> bool:
    return bool(value and isinstance(value, str) and value.startswith("ASSESS_"))


def _reset_assessment_companions(assessment, field_name: str):
    setattr(assessment, f"{field_name}_enc", None)
    setattr(assessment, f"{field_name}_hash", None)


def restore_tax_assessment_source_values(db, assessment):
    assessment_tax_type = get_decrypted_or_raw(assessment, "tax_type") or assessment.tax_type
    if assessment_tax_type == "BT" or (isinstance(assessment.tax_type, str) and assessment.tax_type.startswith("ASSESS_TAXTYPE_")):
        submission = assessment.submission
        if submission:
            if _is_assessment_placeholder(assessment.mayor_permit_number) or not assessment.mayor_permit_number:
                assessment.mayor_permit_number = submission.mayor_permit_number
                _reset_assessment_companions(assessment, "mayor_permit_number")
            if _is_assessment_placeholder(assessment.sec_dti_cda_number) or not assessment.sec_dti_cda_number:
                assessment.sec_dti_cda_number = submission.sec_dti_cda_number
                _reset_assessment_companions(assessment, "sec_dti_cda_number")

        permit_value = get_decrypted_or_raw(assessment, "mayor_permit_number") or assessment.mayor_permit_number
        registry = None
        if permit_value:
            registry = db.query(BusinessRegistry).filter(
                or_(
                    BusinessRegistry.mayor_permit_number == permit_value,
                    BusinessRegistry.mayor_permit_number_hash == hash_optional_value(permit_value),
                )
            ).first()
        if registry:
            if _is_assessment_placeholder(assessment.business_name) or not assessment.business_name:
                assessment.business_name = get_decrypted_or_raw(registry, "business_name") or registry.business_name
                _reset_assessment_companions(assessment, "business_name")
            if _is_assessment_placeholder(assessment.business_type) or not assessment.business_type:
                assessment.business_type = get_decrypted_or_raw(registry, "business_type") or registry.business_type
                _reset_assessment_companions(assessment, "business_type")


def backfill_branch_and_business_registry_security():
    db = SessionLocal()
    try:
        for branch in db.query(Branch).all():
            apply_branch_security(branch)

        for record in db.query(BusinessRegistry).all():
            apply_business_registry_security(record)

        from database.models import CitizenUser
        for user in db.query(CitizenUser).all():
            apply_citizen_user_security(user)

        for application in db.query(BusinessTaxApplication).all():
            apply_business_tax_application_security(application)

        for report in db.query(DiscrepancyReport).all():
            apply_discrepancy_report_security(report)

        for otp_record in db.query(EmailOTP).all():
            apply_email_otp_security(otp_record)

        for verification_token in db.query(EmailVerificationToken).all():
            apply_email_verification_token_security(verification_token)

        for faq in db.query(FAQ).all():
            apply_faq_security(faq)

        for guide in db.query(TaxpayerGuide).all():
            apply_taxpayer_guide_security(guide)

        from database.models import TaxpayerIdentifierSubmission
        for submission in db.query(TaxpayerIdentifierSubmission).all():
            apply_taxpayer_identifier_submission_security(submission)

        for invite in db.query(Invite).all():
            apply_invite_security(invite)

        for memo in db.query(Memo).all():
            apply_memo_security(memo)

        for memo_view in db.query(MemoView).all():
            apply_memo_view_security(memo_view)

        for mfa_secret in db.query(MFASecret).all():
            apply_mfa_secret_security(mfa_secret)

        for payment in db.query(Payment).all():
            apply_payment_security(payment)

        for config in db.query(ServiceWindowConfig).all():
            apply_service_window_config_security(config)

        for service in db.query(Service).all():
            apply_service_security(service)

        from database.models import SystemSetting
        for setting in db.query(SystemSetting).all():
            apply_system_setting_security(setting)

        from database.models import TaxAssessmentRecord
        for assessment in db.query(TaxAssessmentRecord).all():
            restore_tax_assessment_source_values(db, assessment)
            apply_tax_assessment_record_security(assessment)

        for activity in db.query(QueueActivity).all():
            apply_queue_activity_security(activity)

        for property_record in db.query(RPTPropertyRecord).all():
            apply_rpt_property_record_security(property_record)

        for queue in db.query(Queue).all():
            apply_queue_security(queue)

        for receipt_record in db.query(ReceiptRecord).all():
            apply_receipt_record_security(receipt_record)

        for receipt_request in db.query(ReceiptRequest).all():
            apply_receipt_request_security(receipt_request)

        for receipt_request_history in db.query(ReceiptRequestHistory).all():
            apply_receipt_request_history_security(receipt_request_history)

        db.commit()
    finally:
        db.close()

ensure_auth_extensions()
bootstrap_admin()
seed_business_registry()
backfill_branch_and_business_registry_security()


def start_security_monitor_if_enabled():
    enabled = (os.getenv("SECURITY_MONITORING_ENABLED") or "false").strip().lower() == "true"
    deployed = (os.getenv("SECURITY_DEPLOYMENT_MODE") or "development").strip().lower() == "deployed"
    if not enabled or not deployed:
        return

    default_interval = max(5, int(os.getenv("SECURITY_SCAN_INTERVAL_SECONDS", "30")))

    def monitor_loop():
        from SECURITY.security_engine import create_manual_backup, get_setting, scan_all_files

        startup_db = SessionLocal()
        try:
            create_manual_backup(startup_db, initiated_by=None, label="startup_baseline")
            print("[SECURITY MONITOR] startup baseline backup refreshed before scanning")
        except Exception as exc:
            print(f"[SECURITY MONITOR] startup baseline refresh failed: {exc}")
        finally:
            startup_db.close()

        while True:
            db = SessionLocal()
            interval = default_interval
            try:
                scan_all_files(db, context={"background_monitor": True})
                interval = max(5, int(get_setting(db, "scan_interval_seconds", str(default_interval))))
            except Exception as exc:
                print(f"[SECURITY MONITOR] scan failed: {exc}")
            finally:
                db.close()
            time.sleep(interval)

    thread = threading.Thread(target=monitor_loop, daemon=True, name="wards-security-monitor")
    thread.start()
    print(f"[SECURITY MONITOR] enabled; default scan interval is {default_interval} seconds")


start_security_monitor_if_enabled()

app.include_router(user_auth_v2.router, prefix="/api/user/auth", tags=["User Authentication V2"])
app.include_router(branch_auth_v2.router, prefix="/api/branch/auth", tags=["Branch Authentication V2"])
app.include_router(branch_portal.router, prefix="/api/branch", tags=["Branch Portal"])
app.include_router(branch_settings.router, prefix="/api/branch/settings", tags=["Branch Settings"])
app.include_router(reports.branch_router, prefix="/api/branch/reports", tags=["Branch Reports"])
app.include_router(admin_auth_v2.router, prefix="/api/admin/auth", tags=["Admin Authentication V2"])
app.include_router(invites.router, prefix="/api/admin", tags=["Admin Invites"])
app.include_router(admin_users.router, prefix="/api/admin", tags=["Admin Users"])
app.include_router(unified_auth.router, prefix="/api/auth/unified", tags=["Unified Authentication"])
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(branches.router, prefix="/api/branches", tags=["Branches"])
app.include_router(reports.router, prefix="/api/reports", tags=["Reports"])
app.include_router(announcements.router, prefix="/api/announcements", tags=["Announcements"])
app.include_router(memos.router, prefix="/api/memos", tags=["Memos"])
app.include_router(discrepancies.router, prefix="/api/discrepancies", tags=["Discrepancies"])
app.include_router(alerts.router, prefix="/api/alerts", tags=["Alerts"])
app.include_router(logs.router, prefix="/api/activity-logs", tags=["Activity Logs"])
app.include_router(logs.router, prefix="/api/logs", tags=["Audit Logs"])
app.include_router(backup.router, prefix="/api/backup", tags=["Backup"])
app.include_router(security_dashboard.router, prefix="/api/security", tags=["Security Dashboard"])
app.include_router(users.router, prefix="/api/accounts", tags=["Accounts"])
app.include_router(payments.router, prefix="/api/payments", tags=["Payments"])
app.include_router(tax_assessment.router, prefix="/api/tax-assessment", tags=["Tax Assessment"])
app.include_router(receipts.router, prefix="/api/receipts", tags=["Receipts"])
app.include_router(settings.router, prefix="/api/settings", tags=["Settings"])
app.include_router(policies.router, prefix="/api/policies", tags=["Policies"])
app.include_router(ocr_routes.router, prefix="/api/ocr", tags=["OCR"])
app.include_router(rbac_routes.router, prefix="/api/rbac", tags=["RBAC"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["Dashboard"])
app.include_router(public.router, prefix="/api/public", tags=["Public Portal"])
app.include_router(public_auth.router, prefix="/api/public/auth", tags=["Public Authentication"])

@app.get("/")
def read_root():
    return {"message": "WARDS API - City Treasurer's Office", "version": "1.0.0"}

@app.get("/api/health")
def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
