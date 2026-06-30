from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, Depends, HTTPException, status, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.responses import JSONResponse
from datetime import datetime, timedelta
from typing import Optional
import uvicorn
import os
import threading
import time
import hmac
import hashlib
import logging

from dotenv import load_dotenv
from sqlalchemy import text, inspect, or_, event
from sqlalchemy.orm import Session as OrmSession
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

load_dotenv(Path(__file__).resolve().with_name(".env"), override=True)

# Keep uploaded files in RAM up to 50 MB instead of spooling to slow Docker
# overlay filesystem at the default 1 MB threshold.
from starlette.datastructures import UploadFile
UploadFile.spool_max_size = 50 * 1024 * 1024

# Startup diagnostics for reCAPTCHA
_recaptcha_key = os.getenv("RECAPTCHA_SECRET_KEY")
if _recaptcha_key:
    logging.getLogger("main").info("RECAPTCHA_SECRET_KEY loaded (length=%d, prefix=%s)", len(_recaptcha_key), _recaptcha_key[:6])
else:
    logging.getLogger("main").warning("RECAPTCHA_SECRET_KEY is NOT set in environment — reCAPTCHA verification will always fail.")

from routes import branches, reports, announcements, memos, alerts, logs, backup, users, payments, receipts, settings, policies, privacy, rbac_routes, dashboard, public, admin_users, branch_portal, branch_settings, unified_auth, discrepancies, tax_assessment, security_dashboard, public_content, window_staff_account, kiosk
from services import ocr_routes
from database.models import Base, engine, SessionLocal, Admin, Announcement, AnnouncementAttachment, Branch, BusinessRegistry, BusinessTaxApplication, CollectionAccount, DiscrepancyReport, EmailOTP, EmailVerificationToken, FAQ, Invite, Memo, MemoView, MFASecret, Payment, Queue, QueueActivity, ReceiptRecord, ReceiptRequest, ReceiptRequestHistory, Remittance, RemittanceItem, RPTPropertyRecord, Service, ServiceWindowConfig, TaxpayerGuide
from utils.field_crypto import apply_citizen_user_security, apply_collection_account_security, apply_discrepancy_report_security, apply_email_otp_security, apply_email_verification_token_security, apply_faq_security, apply_invite_security, apply_memo_security, apply_memo_view_security, apply_mfa_secret_security, apply_payment_security, apply_queue_activity_security, apply_queue_security, apply_receipt_record_security, apply_receipt_request_history_security, apply_receipt_request_security, apply_remittance_item_security, apply_remittance_security, apply_rpt_property_record_security, apply_service_security, apply_service_window_config_security, apply_system_setting_security, apply_tax_assessment_record_security, apply_taxpayer_guide_security, apply_taxpayer_identifier_submission_security, build_redacted_text, get_decrypted_or_raw, hash_optional_value, set_encrypted_hash_companions
from utils import log_integrity  # noqa: F401 - registers tamper-evident log signing hooks
from utils.log_sanitization import install_uvicorn_reload_path_filter
from utils.redis_client import require_redis
from utils.system_settings import seed_system_settings
from utils.branch_system_settings import cleanup_duplicate_branch_system_settings
from middleware.dos_protection import RequestSizeMiddleware, RequestTimeoutMiddleware, ConnectionLimitMiddleware, AbuseDetectionMiddleware, account_from_request
from middleware.https import HttpsEnforcementMiddleware

install_uvicorn_reload_path_filter()


def is_production() -> bool:
    return os.getenv("APP_ENV", os.getenv("ENV", "development")).strip().lower() in {"prod", "production"}


DEBUG = os.getenv("DEBUG", "false").strip().lower() in {"true", "1", "yes"}
if is_production() and DEBUG:
    raise RuntimeError("DEBUG cannot be True when APP_ENV=production")
require_redis()


class SecuritySettings:
    """
    Configuration-driven security header settings.
    All values can be overridden via environment variables.
    """
    
    def __init__(self):
        # Environment detection
        self.is_production = os.getenv("APP_ENV", os.getenv("ENV", "development")).lower() in {"prod", "production"}
        self.is_development = not self.is_production
        
        # CSP Mode: production | development
        self.csp_mode = os.getenv("CSP_MODE", "production" if self.is_production else "development")
        
        # HSTS Configuration
        self.enable_hsts = os.getenv("ENABLE_HSTS", "true" if self.is_production else "false").lower() in {"true", "1", "yes"}
        self.hsts_max_age = int(os.getenv("HSTS_MAX_AGE", "31536000"))  # 1 year default
        self.hsts_include_subdomains = os.getenv("HSTS_INCLUDE_SUBDOMAINS", "true").lower() in {"true", "1", "yes"}
        
        # X-Frame-Options: DENY | SAMEORIGIN
        self.frame_options = os.getenv("X_FRAME_OPTIONS", "DENY")
        
        # Referrer-Policy
        self.referrer_policy = os.getenv("REFERRER_POLICY", "strict-origin-when-cross-origin")
        
        # Permissions-Policy (comma-separated features to disable)
        self.disabled_permissions = os.getenv("DISABLED_PERMISSIONS", "camera, microphone, geolocation")
        
        # Trusted proxy for HSTS detection (behind nginx, etc.)
        self.trusted_proxy = os.getenv("TRUSTED_PROXY", "false").lower() in {"true", "1", "yes"}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Production-grade security headers middleware with context-aware header application.
    
    Features:
    - Content-Type aware: CSP only applied to HTML responses
    - Environment-aware CSP profiles (strict production, relaxed development)
    - Header existence checking: won't override intentionally set headers
    - Secure HSTS: only enabled on HTTPS requests
    - React-compatible CSP with proper directives
    - Configuration-driven: all values configurable via environment
    
    OWASP ASVS / CSP Best Practices Compliance:
    - V5.5.1: Content Security Policy is implemented
    - V5.5.2: CSP does not allow unsafe-inline in production
    - V5.5.3: CSP does not allow unsafe-eval in production
    - V5.5.4: CSP restricts frame-ancestors
    """
    
    def __init__(self, app):
        super().__init__(app)
        self.config = SecuritySettings()
    
    def _is_html_response(self, response: Request) -> bool:
        """Check if response is HTML content."""
        content_type = response.headers.get("content-type", "")
        return "text/html" in content_type.lower()
    
    def _is_secure_request(self, request: Request) -> bool:
        """
        Determine if the request is secure (HTTPS).
        Handles reverse proxy scenarios via X-Forwarded-Proto.
        """
        # Check if request URL is HTTPS
        if request.url.scheme == "https":
            return True
        
        # Check X-Forwarded-Proto header (reverse proxy)
        forwarded_proto = request.headers.get("x-forwarded-proto", "").lower()
        if forwarded_proto == "https":
            return True
        
        return False
    
    def _build_csp_policy(self) -> str:
        """
        Build CSP policy based on environment mode.
        
        Production: Strict CSP without unsafe-inline/unsafe-eval
        Development: Relaxed CSP for hot reload and dev tooling
        """
        if self.config.csp_mode == "development":
            # Development CSP: Allows hot reload and dev tooling
            return (
                "default-src 'self'; "
                "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:* http://127.0.0.1:*; "
                "style-src 'self' 'unsafe-inline' http://localhost:* http://127.0.0.1:*; "
                "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*; "
                "img-src 'self' data: http://localhost:* http://127.0.0.1:*; "
                "object-src 'none'; "
                "base-uri 'self'; "
                "frame-ancestors 'none';"
            )
        else:
            # Production CSP: Strict, no unsafe directives
            return (
                "default-src 'self'; "
                "script-src 'self'; "
                "style-src 'self' 'unsafe-inline'; "  # Required for React style prop; XSS risk is minimal for CSS vs JS
                "connect-src 'self'; "
                "img-src 'self' data:; "
                "object-src 'none'; "
                "frame-src 'self'; "  # Only same-origin frames (srcdoc, sandboxed iframes); no external frames
                "form-action 'self'; "  # Prevent form submission to external origins
                "base-uri 'self'; "
                "frame-ancestors 'none'; "
                "upgrade-insecure-requests;"
            )
    
    def _set_header_if_missing(self, response: Request, header_name: str, header_value: str):
        """Set header only if it doesn't already exist."""
        if header_name not in response.headers:
            response.headers[header_name] = header_value
    
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        
        # Content-Security-Policy: Only apply to HTML responses
        if self._is_html_response(response):
            csp_policy = self._build_csp_policy()
            self._set_header_if_missing(response, "Content-Security-Policy", csp_policy)
        
        # X-Content-Type-Options: nosniff (applies to all responses)
        self._set_header_if_missing(response, "X-Content-Type-Options", "nosniff")
        
        # X-Frame-Options: Prevent clickjacking (applies to all responses)
        self._set_header_if_missing(response, "X-Frame-Options", self.config.frame_options)
        
        # Referrer-Policy: Control referrer leakage (applies to all responses)
        self._set_header_if_missing(response, "Referrer-Policy", self.config.referrer_policy)
        
        # Permissions-Policy: Restrict browser features (applies to all responses)
        permissions = "; ".join(f"{feature}=()" for feature in self.config.disabled_permissions.split(",") if feature.strip())
        self._set_header_if_missing(response, "Permissions-Policy", permissions)
        
        # Strict-Transport-Security: Only if enabled AND request is secure
        if self.config.enable_hsts and self._is_secure_request(request):
            hsts_value = f"max-age={self.config.hsts_max_age}"
            if self.config.hsts_include_subdomains:
                hsts_value += "; includeSubDomains"
            self._set_header_if_missing(response, "Strict-Transport-Security", hsts_value)
        
        return response


SENSITIVE_PATH_PREFIXES = (
    "/api/payments/",
    "/api/remittances/",
    "/api/users/",
    "/api/security/",
    "/api/admin/",
    "/api/branch/",
)


class RequestIntegrityMiddleware(BaseHTTPMiddleware):
    """Verify HMAC-SHA256 request signatures for sensitive state-changing endpoints."""

    def __init__(self, app, secret: str | None = None):
        super().__init__(app)
        self.secret = secret

    def _is_sensitive(self, path: str, method: str) -> bool:
        if method in {"GET", "HEAD", "OPTIONS"}:
            return False
        return any(path.startswith(prefix) for prefix in SENSITIVE_PATH_PREFIXES)

    async def dispatch(self, request: Request, call_next):
        if self.secret and self._is_sensitive(request.url.path, request.method):
            expected = request.headers.get("x-request-signature")
            if not expected:
                return JSONResponse(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    content={"detail": "Missing request integrity signature."},
                )
            body = await request.body()
            computed = hmac.new(self.secret.encode(), body, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(expected, computed):
                return JSONResponse(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    content={"detail": "Invalid request integrity signature."},
                )
        return await call_next(request)


app = FastAPI(title="WARDS API", version="1.0.0")


@app.exception_handler(Exception)
async def production_exception_handler(request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"detail": "An internal server error occurred."})

def hybrid_rate_limit_key(request: Request) -> str:
    """Return account-based key for authenticated users, IP for anonymous."""
    client_ip = request.client.host if request.client else "unknown"
    account_key, _, _ = account_from_request(request, client_ip)
    return account_key


# Rate limiting configuration
limiter = Limiter(key_func=hybrid_rate_limit_key, headers_enabled=True)
app.state.limiter = limiter


def _parse_retry_after(detail: str) -> int:
    """Extract a Retry-After value (seconds) from the SlowAPI limit description."""
    detail_lower = (detail or "").lower()
    if "day" in detail_lower:
        return 86400
    if "hour" in detail_lower:
        return 3600
    # Default to 60 seconds (per-minute limits)
    return 60


# Custom rate limit exceeded handler
@app.exception_handler(RateLimitExceeded)
async def custom_rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded):
    retry_after = _parse_retry_after(str(exc.detail))
    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={
            "detail": "Too many requests. Please try again later.",
            "error": "rate_limit_exceeded"
        },
        headers={
            "Retry-After": str(retry_after),
            "X-RateLimit-Limit": str(exc.detail),
        },
    )


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

    if not is_production():
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
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With", "Accept", "Origin"],
    expose_headers=["Content-Disposition", "x-requires-email-verification"],
)

app.add_middleware(HttpsEnforcementMiddleware)

# Security Headers Middleware
# Adds security headers to all responses (CSP, X-Frame-Options, etc.)
app.add_middleware(SecurityHeadersMiddleware)

# Request Integrity Middleware (optional; only enforced when REQUEST_INTEGRITY_SECRET is set)
app.add_middleware(RequestIntegrityMiddleware, secret=os.getenv("REQUEST_INTEGRITY_SECRET"))

# DoS Protection Middleware (order matters - size first, then timeout, then connection/abuse)
app.add_middleware(RequestSizeMiddleware)
app.add_middleware(RequestTimeoutMiddleware)
app.add_middleware(ConnectionLimitMiddleware)
app.add_middleware(AbuseDetectionMiddleware)

Base.metadata.create_all(bind=engine)

def ensure_auth_extensions():
    inspector = inspect(engine)
    is_mysql = engine.dialect.name.startswith("mysql")
    id_column = "INTEGER PRIMARY KEY AUTO_INCREMENT" if is_mysql else "INTEGER PRIMARY KEY AUTOINCREMENT"
    attachment_blob_type = "LONGBLOB" if is_mysql else "BLOB"

    with engine.begin() as conn:
        table_names = set(inspector.get_table_names())

        def ensure_integrity_columns(table_name: str):
            if table_name not in table_names:
                return
            columns = {column["name"] for column in inspector.get_columns(table_name)}
            if "previous_integrity_hash" not in columns:
                conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN previous_integrity_hash VARCHAR(128)"))
            if "integrity_hash" not in columns:
                conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN integrity_hash VARCHAR(128)"))

        for protected_table in (
            "activity_logs",
            "security_detection_events",
            "security_recovery_events",
            "security_incidents",
            "security_admin_file_changes",
        ):
            ensure_integrity_columns(protected_table)

        if "admins" in table_names:
            admin_columns = {column["name"] for column in inspector.get_columns("admins")}
            if "full_name" not in admin_columns:
                conn.execute(text("ALTER TABLE admins ADD COLUMN full_name VARCHAR(255)"))

        if "branches" in table_names:
            branch_columns = {column["name"] for column in inspector.get_columns("branches")}
            if "kiosk_enabled" not in branch_columns:
                conn.execute(text("ALTER TABLE branches ADD COLUMN kiosk_enabled BOOLEAN DEFAULT FALSE"))
            if "kiosk_token" not in branch_columns:
                conn.execute(text("ALTER TABLE branches ADD COLUMN kiosk_token VARCHAR(255)"))

        if "backups" in table_names:
            backup_columns = {column["name"] for column in inspector.get_columns("backups")}
            if "checksum" not in backup_columns:
                conn.execute(text("ALTER TABLE backups ADD COLUMN checksum VARCHAR(128)"))
            if "db_type" not in backup_columns:
                conn.execute(text("ALTER TABLE backups ADD COLUMN db_type VARCHAR(40)"))
            if "retention_days" not in backup_columns:
                conn.execute(text("ALTER TABLE backups ADD COLUMN retention_days INTEGER DEFAULT 30"))

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
            ("author_type", "VARCHAR(255) DEFAULT 'admin'"),
            ("author_type_hash", "VARCHAR(255)"),
            ("author_type_enc", "TEXT"),
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
        if "announcement_attachments" in table_names:
            attachment_columns = {column["name"]: column for column in inspector.get_columns("announcement_attachments")}
            if "file_content" not in attachment_columns:
                conn.execute(text(f"ALTER TABLE announcement_attachments ADD COLUMN file_content {attachment_blob_type}"))
            elif is_mysql:
                current_type = str(attachment_columns["file_content"].get("type", "")).lower()
                if "blob" not in current_type:
                    conn.execute(text("ALTER TABLE announcement_attachments MODIFY COLUMN file_content LONGBLOB"))

        if "public_page_contents" in table_names and is_mysql:
            ppc_columns = {column["name"]: column for column in inspector.get_columns("public_page_contents")}
            for col in ("draft_content_json", "published_content_json"):
                if col in ppc_columns:
                    current_type = str(ppc_columns[col].get("type", "")).lower()
                    if "longtext" not in current_type:
                        conn.execute(text(f"ALTER TABLE public_page_contents MODIFY COLUMN {col} LONGTEXT"))

        if "alert_views" not in table_names:
            conn.execute(text(f"""
                CREATE TABLE alert_views (
                    id {id_column},
                    alert_id INTEGER NOT NULL,
                    viewer_username VARCHAR(255) NOT NULL,
                    viewer_type VARCHAR(255) DEFAULT 'admin',
                    viewed_at DATETIME
                )
            """))
        if "revoked_tokens" not in table_names:
            conn.execute(text(f"""
                CREATE TABLE revoked_tokens (
                    id {id_column},
                    token_hash VARCHAR(128) NOT NULL UNIQUE,
                    token_type VARCHAR(40),
                    subject VARCHAR(255),
                    expires_at DATETIME,
                    revoked_at DATETIME
                )
            """))
        if "security_log_views" not in table_names:
            conn.execute(text(f"""
                CREATE TABLE security_log_views (
                    id {id_column},
                    log_type VARCHAR(40) NOT NULL,
                    log_id INTEGER NOT NULL,
                    viewer_username VARCHAR(255) NOT NULL,
                    viewed_at DATETIME
                )
            """))

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

        if "collection_accounts" in table_names:
            collection_account_columns = {column["name"] for column in inspector.get_columns("collection_accounts")}
            for column_name, column_type in (
                ("account_name_hash", "VARCHAR(255)"),
                ("account_name_enc", "TEXT"),
                ("current_balance_hash", "VARCHAR(255)"),
                ("current_balance_enc", "TEXT"),
                ("total_collected_hash", "VARCHAR(255)"),
                ("total_collected_enc", "TEXT"),
                ("total_remitted_hash", "VARCHAR(255)"),
                ("total_remitted_enc", "TEXT"),
            ):
                if column_name not in collection_account_columns:
                    conn.execute(text(f"ALTER TABLE collection_accounts ADD COLUMN {column_name} {column_type}"))

        if "remittances" in table_names:
            remittance_columns = {column["name"] for column in inspector.get_columns("remittances")}
            for column_name, column_type in (
                ("remittance_number_hash", "VARCHAR(255)"),
                ("remittance_number_enc", "TEXT"),
                ("total_amount_hash", "VARCHAR(255)"),
                ("total_amount_enc", "TEXT"),
                ("remarks_hash", "VARCHAR(255)"),
                ("remarks_enc", "TEXT"),
                ("report_file_path_hash", "VARCHAR(255)"),
                ("report_file_path_enc", "TEXT"),
                ("report_file_name_hash", "VARCHAR(255)"),
                ("report_file_name_enc", "TEXT"),
                ("submitted_by_hash", "VARCHAR(255)"),
                ("submitted_by_enc", "TEXT"),
                ("reviewed_by_hash", "VARCHAR(255)"),
                ("reviewed_by_enc", "TEXT"),
            ):
                if column_name not in remittance_columns:
                    conn.execute(text(f"ALTER TABLE remittances ADD COLUMN {column_name} {column_type}"))

        if "remittance_items" in table_names:
            remittance_item_columns = {column["name"] for column in inspector.get_columns("remittance_items")}
            for column_name, column_type in (
                ("amount_hash", "VARCHAR(255)"),
                ("amount_enc", "TEXT"),
            ):
                if column_name not in remittance_item_columns:
                    conn.execute(text(f"ALTER TABLE remittance_items ADD COLUMN {column_name} {column_type}"))
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
        if "request_reason" not in receipt_request_columns:
            conn.execute(text("ALTER TABLE receipt_requests ADD COLUMN request_reason VARCHAR(255)"))
        if "request_reason_other" not in receipt_request_columns:
            conn.execute(text("ALTER TABLE receipt_requests ADD COLUMN request_reason_other TEXT"))
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
        if "linked_queue_number" not in receipt_request_columns:
            conn.execute(text("ALTER TABLE receipt_requests ADD COLUMN linked_queue_number VARCHAR(255)"))
        for column_name, column_type in (
            ("request_id_hash", "VARCHAR(255)"),
            ("request_id_enc", "TEXT"),
            ("taxpayer_name_hash", "VARCHAR(255)"),
            ("taxpayer_name_enc", "TEXT"),
            ("tax_type_hash", "VARCHAR(255)"),
            ("tax_type_enc", "TEXT"),
            ("request_reason_hash", "VARCHAR(255)"),
            ("request_reason_enc", "TEXT"),
            ("request_reason_other_hash", "VARCHAR(255)"),
            ("request_reason_other_enc", "TEXT"),
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
            ("linked_queue_number_hash", "VARCHAR(255)"),
            ("linked_queue_number_enc", "TEXT"),
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
            ("request_reason", "VARCHAR(255)"),
            ("request_reason_hash", "VARCHAR(255)"),
            ("request_reason_enc", "TEXT"),
            ("request_reason_other", "TEXT"),
            ("request_reason_other_hash", "VARCHAR(255)"),
            ("request_reason_other_enc", "TEXT"),
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
            ("linked_queue_number", "VARCHAR(255)"),
            ("linked_queue_number_hash", "VARCHAR(255)"),
            ("linked_queue_number_enc", "TEXT"),
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
        if "citizen_user_id" not in queue_columns:
            conn.execute(text("ALTER TABLE queues ADD COLUMN citizen_user_id INTEGER NULL"))
            queue_indexes = {index["name"] for index in inspect(conn).get_indexes("queues")}
            if "ix_queues_citizen_user_id" not in queue_indexes:
                conn.execute(text("CREATE INDEX ix_queues_citizen_user_id ON queues (citizen_user_id)"))
            queue_columns.add("citizen_user_id")
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
            ("appointment_reservation_key", "VARCHAR(255)"),
        ):
            if column_name not in queue_columns:
                conn.execute(text(f"ALTER TABLE queues ADD COLUMN {column_name} {column_type}"))

        queue_indexes = {index["name"] for index in inspect(conn).get_indexes("queues")}
        if "ix_queues_appointment_reservation_key_unique" not in queue_indexes:
            conn.execute(text("CREATE UNIQUE INDEX ix_queues_appointment_reservation_key_unique ON queues (appointment_reservation_key)"))

        queue_history_columns = {column["name"] for column in inspector.get_columns("queue_history")}
        if "citizen_user_id" not in queue_history_columns:
            conn.execute(text("ALTER TABLE queue_history ADD COLUMN citizen_user_id INTEGER NULL"))
            queue_history_indexes = {index["name"] for index in inspect(conn).get_indexes("queue_history")}
            if "ix_queue_history_citizen_user_id" not in queue_history_indexes:
                conn.execute(text("CREATE INDEX ix_queue_history_citizen_user_id ON queue_history (citizen_user_id)"))

        receipt_request_columns = {column["name"] for column in inspector.get_columns("receipt_requests")}
        if "citizen_user_id" not in receipt_request_columns:
            conn.execute(text("ALTER TABLE receipt_requests ADD COLUMN citizen_user_id INTEGER NULL"))
            receipt_request_indexes = {index["name"] for index in inspect(conn).get_indexes("receipt_requests")}
            if "ix_receipt_requests_citizen_user_id" not in receipt_request_indexes:
                conn.execute(text("CREATE INDEX ix_receipt_requests_citizen_user_id ON receipt_requests (citizen_user_id)"))

        receipt_request_history_columns = {column["name"] for column in inspector.get_columns("receipt_request_history")}
        if "citizen_user_id" not in receipt_request_history_columns:
            conn.execute(text("ALTER TABLE receipt_request_history ADD COLUMN citizen_user_id INTEGER NULL"))
            receipt_request_history_indexes = {index["name"] for index in inspect(conn).get_indexes("receipt_request_history")}
            if "ix_receipt_request_history_citizen_user_id" not in receipt_request_history_indexes:
                conn.execute(text("CREATE INDEX ix_receipt_request_history_citizen_user_id ON receipt_request_history (citizen_user_id)"))

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

        if "announcement_views" in inspector.get_table_names():
            announcement_view_columns = {column["name"] for column in inspector.get_columns("announcement_views")}
            for column_name, column_type in (
                ("viewer_username_hash", "VARCHAR(255)"),
                ("viewer_username_enc", "TEXT"),
                ("viewer_type_hash", "VARCHAR(255)"),
                ("viewer_type_enc", "TEXT"),
            ):
                if column_name not in announcement_view_columns:
                    conn.execute(text(f"ALTER TABLE announcement_views ADD COLUMN {column_name} {column_type}"))

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
                """)).fetchone()
                if verification_fk:
                    conn.execute(text(f"ALTER TABLE email_verification_tokens DROP FOREIGN KEY {verification_fk[0]}"))

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
            """))

    db = SessionLocal()
    try:
        cleanup_duplicate_branch_system_settings(db)
        seed_system_settings(db)
    finally:
        db.close()

def bootstrap_admin():
    admin_username = os.getenv("ADMIN_USERNAME", "admin")
    admin_email = os.getenv("ADMIN_EMAIL", "admin@wards.local")
    admin_password = os.getenv("ADMIN_PASSWORD")
    if not admin_email or not admin_password:
        return

    db = SessionLocal()
    try:
        from auth import hash_password
        admin = db.query(Admin).filter(Admin.role.in_(["main_admin", "admin"])).first()
        if admin:
            admin.username = admin_username
            admin.email = admin_email.lower()
            admin.status = "Active"
            admin.is_verified = True
            # Do NOT overwrite hashed_password — preserve manual password changes
        else:
            db.add(Admin(
                username=admin_username,
                email=admin_email.lower(),
                hashed_password=hash_password(admin_password),
                role="main_admin",
                status="Active",
                is_verified=True,
            ))
        db.commit()
    finally:
        db.close()

def bootstrap_superadmin():
    superadmin_username = os.getenv("SUPERADMIN_USERNAME", "superadmin")
    superadmin_email = os.getenv("SUPERADMIN_EMAIL", "superadmin@wards.local")
    superadmin_password = os.getenv("SUPERADMIN_PASSWORD")
    if not superadmin_email or not superadmin_password:
        return

    db = SessionLocal()
    try:
        from auth import hash_password
        admin = db.query(Admin).filter(Admin.role == "superadmin").first()
        if admin:
            admin.username = superadmin_username
            admin.email = superadmin_email.lower()
            admin.status = "Active"
            admin.is_verified = True
            # Do NOT overwrite hashed_password — preserve manual password changes
        else:
            db.add(Admin(
                username=superadmin_username,
                email=superadmin_email.lower(),
                hashed_password=hash_password(superadmin_password),
                role="superadmin",
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


SENSITIVE_FIELD_PROTECTION_REGISTRY = {
    Branch: apply_branch_security,
    BusinessRegistry: apply_business_registry_security,
    CollectionAccount: apply_collection_account_security,
    Remittance: apply_remittance_security,
    RemittanceItem: apply_remittance_item_security,
    BusinessTaxApplication: apply_business_tax_application_security,
    DiscrepancyReport: apply_discrepancy_report_security,
    EmailOTP: apply_email_otp_security,
    EmailVerificationToken: apply_email_verification_token_security,
    FAQ: apply_faq_security,
    TaxpayerGuide: apply_taxpayer_guide_security,
    Invite: apply_invite_security,
    Memo: apply_memo_security,
    MemoView: apply_memo_view_security,
    MFASecret: apply_mfa_secret_security,
    Payment: apply_payment_security,
    ServiceWindowConfig: apply_service_window_config_security,
    Service: apply_service_security,
    QueueActivity: apply_queue_activity_security,
    RPTPropertyRecord: apply_rpt_property_record_security,
    Queue: apply_queue_security,
    ReceiptRecord: apply_receipt_record_security,
    ReceiptRequest: apply_receipt_request_security,
    ReceiptRequestHistory: apply_receipt_request_history_security,
}

SENSITIVE_FIELD_PROTECTION_NAME_REGISTRY = {
    "CitizenUser": apply_citizen_user_security,
    "SystemSetting": apply_system_setting_security,
    "TaxAssessmentRecord": apply_tax_assessment_record_security,
    "TaxpayerIdentifierSubmission": apply_taxpayer_identifier_submission_security,
}


def apply_registered_sensitive_field_protection(obj) -> bool:
    applier = SENSITIVE_FIELD_PROTECTION_REGISTRY.get(type(obj))
    if not applier:
        applier = SENSITIVE_FIELD_PROTECTION_NAME_REGISTRY.get(obj.__class__.__name__)
    if not applier:
        return False
    applier(obj)
    return True


@event.listens_for(OrmSession, "before_flush")
def apply_sensitive_field_protection_before_flush(session, flush_context, instances):
    for obj in set(session.new).union(session.dirty):
        apply_registered_sensitive_field_protection(obj)


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

        for account in db.query(CollectionAccount).all():
            apply_collection_account_security(account)

        for remittance in db.query(Remittance).all():
            apply_remittance_security(remittance)

        for remittance_item in db.query(RemittanceItem).all():
            apply_remittance_item_security(remittance_item)

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

def backfill_existing_log_integrity():
    db = SessionLocal()
    try:
        log_integrity.backfill_log_integrity_hashes(db)
    except Exception as exc:
        print(f"[LOG INTEGRITY] backfill skipped: {exc}")
    finally:
        db.close()


backfill_existing_log_integrity()
bootstrap_admin()
bootstrap_superadmin()
seed_business_registry()
backfill_branch_and_business_registry_security()


def start_security_monitor_if_enabled():
    enabled = (os.getenv("SECURITY_MONITORING_ENABLED") or "false").strip().lower() == "true"
    deployed = (os.getenv("SECURITY_DEPLOYMENT_MODE") or "development").strip().lower() == "deployed"
    security_api_url = os.getenv("SECURITY_API_URL", "").strip()
    if security_api_url:
        print("[SECURITY MONITOR] remote security API configured; local monitor disabled (monitoring runs on VM 2)")
        return
    if not deployed or not enabled:
        print("[SECURITY MONITOR] automatic monitoring disabled; deployed mode and monitoring flag must both be enabled")
        return

    default_interval = max(5, int(os.getenv("SECURITY_SCAN_INTERVAL_SECONDS", "30")))
    adaptive_enabled = (os.getenv("SECURITY_ADAPTIVE_INTERVAL_ENABLED") or "false").strip().lower() == "true"

    def monitor_loop():
        from SECURITY.security_engine import activate_database_runtime_monitoring, create_manual_backup, get_setting, now_utc, scan_all_files, seed_settings, set_setting, set_deployment_mode

        while True:
            retry_delay = False
            startup_db = SessionLocal()
            try:
                seed_settings(startup_db)
                set_setting(startup_db, "startup_baseline_status", "in_progress", "system")
                print("[SECURITY MONITOR] activating database runtime monitoring")
                activate_database_runtime_monitoring(startup_db, reset_baseline=True)
                print("[SECURITY MONITOR] refreshing startup baseline backup after runtime activation")
                event = create_manual_backup(startup_db, initiated_by=None, label="startup_baseline")
                if event.status != "success":
                    raise RuntimeError(event.error_message or "Startup baseline backup failed")
                set_setting(startup_db, "monitoring_enabled", "true", "system_startup")
                set_setting(startup_db, "startup_baseline_status", "complete", "system")
                set_deployment_mode(startup_db, False)
                print("[SECURITY MONITOR] startup baseline backup refreshed")
                break
            except Exception as exc:
                try:
                    set_setting(startup_db, "startup_baseline_status", "failed", "system")
                except Exception:
                    pass
                print(f"[SECURITY MONITOR] startup baseline refresh failed: {exc}")
                retry_delay = True
            finally:
                startup_db.close()
            if retry_delay:
                time.sleep(default_interval)
            else:
                break

        first_scan = True
        consecutive_clean = 0
        while True:
            db = SessionLocal()
            interval = default_interval
            scan_status = "failed"
            try:
                monitoring_enabled = (get_setting(db, "monitoring_enabled", "true") or "true").lower() == "true"
                configured_interval = max(5, int(get_setting(db, "scan_interval_seconds", str(default_interval))))
                if monitoring_enabled:
                    detections = scan_all_files(db, context={"background_monitor": True})
                    scan_status = "success"
                    set_setting(db, "last_scan_at", now_utc().isoformat(), "interval_scanner")
                    set_setting(db, "last_interval_scan_status", "success", "interval_scanner")
                    if first_scan:
                        print(f"[SECURITY MONITOR] first automatic scan complete; {len(detections)} change(s) found")
                    if adaptive_enabled:
                        if detections:
                            consecutive_clean = 0
                            interval = min(30, configured_interval)
                        else:
                            consecutive_clean += 1
                            if consecutive_clean >= 5:
                                interval = min(configured_interval * (2 ** min(consecutive_clean - 4, 4)), 300)
                            else:
                                interval = configured_interval
                    else:
                        interval = configured_interval
                else:
                    interval = configured_interval
                    set_setting(db, "last_interval_scan_status", "monitoring_disabled", "interval_scanner")
                first_scan = False
            except Exception as exc:
                print(f"[SECURITY MONITOR] scan failed: {exc}")
                try:
                    set_setting(db, "last_interval_scan_status", f"failed: {exc}", "interval_scanner")
                except Exception:
                    pass
            finally:
                db.close()
            time.sleep(max(5, int(interval)))

    thread = threading.Thread(target=monitor_loop, daemon=True, name="wards-security-monitor")
    thread.start()
    print(f"[SECURITY MONITOR] ready; default scan interval is {default_interval} seconds")


start_security_monitor_if_enabled()

from utils.scheduled_backup import start_scheduled_backup_runner
start_scheduled_backup_runner()


def start_vm1_database_startup_baseline_if_configured():
    deployed = (os.getenv("SECURITY_DEPLOYMENT_MODE") or "development").strip().lower() == "deployed"
    security_api_url = os.getenv("SECURITY_API_URL", "").strip()
    enabled = (os.getenv("SECURITY_VM1_STARTUP_DB_BACKUP_ENABLED") or "true").strip().lower() == "true"
    if not (deployed and security_api_url and enabled):
        return

    def _run():
        # Give the database container and migrations a moment to settle after
        # docker compose restarts VM1 during deployment.
        time.sleep(max(0, int(os.getenv("SECURITY_VM1_STARTUP_DB_BACKUP_DELAY", "15"))))
        try:
            from database.models import ActivityLog, Backup
            from utils.backup_engine import create_database_backup as create_vm1_database_backup

            db = SessionLocal()
            try:
                recent = (
                    db.query(Backup)
                    .filter(Backup.type == "Startup Baseline VM1")
                    .order_by(Backup.created_at.desc())
                    .first()
                )
                if recent and recent.created_at and (datetime.now() - recent.created_at) < timedelta(minutes=10):
                    return
                result = create_vm1_database_backup()
                db.add(Backup(
                    filename=result.filename,
                    size=str(result.size_bytes),
                    type="Startup Baseline VM1",
                    status="Completed",
                    checksum=result.checksum,
                    db_type=result.db_type,
                    retention_days=30,
                ))
                db.add(ActivityLog(
                    action="Security VM1 Startup Baseline Backup",
                    user="system",
                    details=f"VM1 database startup baseline created: {result.filename}; Checksum: {result.checksum}.",
                    type="security",
                ))
                db.commit()
                print(f"[SCHEDULED BACKUP] VM1 startup baseline DB backup created: {result.filename}")
            finally:
                db.close()
        except Exception as exc:
            print(f"[SCHEDULED BACKUP] VM1 startup baseline DB backup skipped: {exc}")

    threading.Thread(target=_run, daemon=True, name="wards-vm1-startup-db-backup").start()


start_vm1_database_startup_baseline_if_configured()


@app.on_event("shutdown")
def stop_database_runtime_monitoring():
    deployed = (os.getenv("SECURITY_DEPLOYMENT_MODE") or "development").strip().lower() == "deployed"
    enabled = (os.getenv("SECURITY_MONITORING_ENABLED") or "false").strip().lower() == "true"
    security_api_url = os.getenv("SECURITY_API_URL", "").strip()
    if security_api_url:
        return
    if not deployed or not enabled:
        return
    try:
        from SECURITY.security_engine import drop_database_audit_triggers, set_setting

        db = SessionLocal()
        try:
            drop_database_audit_triggers(db)
            set_setting(db, "database_runtime_monitoring", "stopped", "system_shutdown")
            print("[SECURITY MONITOR] database audit triggers stopped")
        finally:
            db.close()
    except Exception as exc:
        print(f"[SECURITY MONITOR] database audit trigger shutdown skipped: {exc}")


app.include_router(branch_portal.router, prefix="/api/branch", tags=["Branch Portal"])
app.include_router(branch_settings.router, prefix="/api/branch/settings", tags=["Branch Settings"])
app.include_router(window_staff_account.router, prefix="/api/branch/account", tags=["Window Staff Account"])
app.include_router(kiosk.router, prefix="/api/kiosk", tags=["Kiosk"])
app.include_router(reports.branch_router, prefix="/api/branch/reports", tags=["Branch Reports"])
app.include_router(admin_users.router, prefix="/api/admin", tags=["Admin Users"])
# Unified auth is intentionally mounted at two prefixes:
# /api/auth/unified  – primary endpoint for all portals (admin, branch, public)
# /api/public/auth   – backward-compatible alias for public portal login flows
app.include_router(unified_auth.router, prefix="/api/auth/unified", tags=["Unified Authentication"])
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
app.include_router(privacy.router, prefix="/api/privacy", tags=["Privacy"])
app.include_router(ocr_routes.router, prefix="/api/ocr", tags=["OCR"])
app.include_router(rbac_routes.router, prefix="/api/rbac", tags=["RBAC"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["Dashboard"])
app.include_router(public.router, prefix="/api/public", tags=["Public Portal"])
app.include_router(unified_auth.router, prefix="/api/public/auth", tags=["Public Authentication"])
app.include_router(public_content.router, prefix="/api/public-content", tags=["Public Content Management"])

@app.get("/")
def read_root():
    return {"message": "WARDS API - City Treasurer's Office", "version": "1.0.0"}

@app.get("/api/health")
def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_dirs=["."],
    )
