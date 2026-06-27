import os
import sys
import uuid
from pathlib import Path
from datetime import datetime, timedelta

from dotenv import load_dotenv
from sqlalchemy import create_engine, Column, Integer, String as SQLString, Float, DateTime, Boolean, Text, ForeignKey, event, text, LargeBinary
from sqlalchemy.dialects.mysql import LONGTEXT, LONGBLOB
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import Session as SASession, sessionmaker, relationship

BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")


class String(SQLString):
    def __init__(self, length=255, **kwargs):
        kwargs.setdefault("collation", "utf8mb4_bin")
        super().__init__(length=length, **kwargs)


def _is_pytest() -> bool:
    if os.getenv("PYTEST_CURRENT_TEST"):
        return True
    if "pytest" in sys.modules:
        return True
    return any("pytest" in arg for arg in sys.argv)


def build_database_url() -> str:
    database_url = os.getenv("DATABASE_URL", "").strip()

    if _is_pytest():
        return "sqlite:///:memory:"

    if not database_url:
        raise RuntimeError(
            "DATABASE_URL environment variable is required but not set. "
            "Please configure a persistent database (e.g., MySQL, PostgreSQL)."
        )

    if database_url.startswith("mysql://"):
        return database_url.replace("mysql://", "mysql+pymysql://", 1)

    return database_url


SQLALCHEMY_DATABASE_URL = build_database_url()

engine = create_engine(SQLALCHEMY_DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


@event.listens_for(SASession, "after_begin")
def apply_database_authorization_token(session, transaction, connection):
    if not SQLALCHEMY_DATABASE_URL.startswith("mysql"):
        return
    token = session.info.get("wards_db_auth_token")
    if not token:
        connection.execute(text("SET @wards_db_auth_token = NULL"))
        connection.execute(text("SET @wards_db_auth_actor = NULL"))
        connection.execute(text("SET @wards_db_auth_context = NULL"))
        return
    connection.execute(text("SET @wards_db_auth_token = :token"), {"token": token})
    connection.execute(text("SET @wards_db_auth_actor = :actor"), {"actor": session.info.get("wards_db_auth_actor", "backend")})
    connection.execute(text("SET @wards_db_auth_context = :context"), {"context": session.info.get("wards_db_auth_context", "wards_backend_request")})


def authorize_database_session(db, context: str = "wards_backend_request", actor: str = "backend") -> str | None:
    if not SQLALCHEMY_DATABASE_URL.startswith("mysql"):
        return None
    token = f"AUTH-{uuid.uuid4().hex}"
    issued_at = datetime.now() - timedelta(seconds=60)
    expires_at = issued_at + timedelta(minutes=int(os.getenv("DB_AUTH_TOKEN_TTL_MINUTES", "30")))
    try:
        db.execute(text(
            """
            CREATE TABLE IF NOT EXISTS wards_security_authorized_operations (
                token VARCHAR(80) PRIMARY KEY,
                actor VARCHAR(255) NULL,
                context VARCHAR(255) NULL,
                issued_at DATETIME NOT NULL,
                expires_at DATETIME NOT NULL,
                INDEX idx_wards_security_auth_expires (expires_at)
            ) ENGINE=InnoDB
            """
        ))
        db.execute(text(
            """
            INSERT INTO wards_security_authorized_operations (token, actor, context, issued_at, expires_at)
            VALUES (:token, :actor, :context, :issued_at, :expires_at)
            ON DUPLICATE KEY UPDATE
                actor = VALUES(actor),
                context = VALUES(context),
                issued_at = VALUES(issued_at),
                expires_at = VALUES(expires_at)
            """
        ), {
            "token": token,
            "actor": actor,
            "context": context,
            "issued_at": issued_at,
            "expires_at": expires_at,
        })
        db.commit()
        db.info["wards_db_auth_token"] = token
        db.info["wards_db_auth_actor"] = actor
        db.info["wards_db_auth_context"] = context
        return token
    except Exception:
        db.rollback()
        return None


def get_db():
    db = SessionLocal()
    authorize_database_session(db)
    try:
        yield db
    finally:
        db.close()

class Admin(Base):
    __tablename__ = "admins"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True)
    full_name = Column(String, nullable=True)
    hashed_password = Column(String)
    role = Column(String, default="main_admin")
    is_verified = Column(Boolean, default=False)
    status = Column(String, default="Active")
    last_login = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class BranchStaff(Base):
    __tablename__ = "branch_staff"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True)
    full_name = Column(String)
    hashed_password = Column(String)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True)
    role = Column(String, default="branch_staff")  # branch_admin or branch_staff
    account_scope = Column(String, default="full_branch")
    service_window = Column(String, nullable=True)
    service_window_label = Column(String, nullable=True)
    assigned_window_number = Column(Integer, nullable=True)
    contact_number = Column(String, nullable=True)
    is_verified = Column(Boolean, default=False)
    status = Column(String, default="Active")
    last_login = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    branch = relationship("Branch", backref="branch_staff")

class CitizenUser(Base):
    __tablename__ = "citizen_users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    email_hash = Column(String, nullable=True)
    email_enc = Column(Text, nullable=True)
    full_name = Column(String)
    full_name_hash = Column(String, nullable=True)
    full_name_enc = Column(Text, nullable=True)
    tin = Column(String, unique=True, index=True, nullable=True)
    tin_hash = Column(String, nullable=True)
    tin_enc = Column(Text, nullable=True)
    contact_number = Column(String)
    contact_number_hash = Column(String, nullable=True)
    contact_number_enc = Column(Text, nullable=True)
    address = Column(String, nullable=True)
    address_hash = Column(String, nullable=True)
    address_enc = Column(Text, nullable=True)
    taxpayer_type = Column(String, default="Individual")
    hashed_password = Column(String)
    role = Column(String, default="public")
    is_verified = Column(Boolean, default=False)
    status = Column(String, default="Active")
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login = Column(DateTime, nullable=True)


class EmailVerificationToken(Base):
    __tablename__ = "email_verification_tokens"

    id = Column(Integer, primary_key=True, index=True)
    citizen_user_id = Column(Integer, ForeignKey("citizen_users.id", ondelete="CASCADE"), nullable=False, index=True)
    email = Column(String, nullable=False, index=True)
    email_hash = Column(String, nullable=True)
    email_enc = Column(Text, nullable=True)
    token = Column(String, unique=True, index=True, nullable=False)
    token_hash = Column(String, nullable=True, index=True)
    token_enc = Column(Text, nullable=True)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class EmailOTP(Base):
    __tablename__ = "email_otps"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, nullable=False, index=True)
    email_hash = Column(String, nullable=True)
    email_enc = Column(Text, nullable=True)
    role = Column(String, nullable=False, index=True)
    role_hash = Column(String, nullable=True)
    role_enc = Column(Text, nullable=True)
    code_hash = Column(String, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    attempts = Column(Integer, default=0)
    resend_count = Column(Integer, default=0)
    last_sent_at = Column(DateTime, nullable=True)
    consumed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class MFASecret(Base):
    __tablename__ = "mfa_secrets"

    id = Column(Integer, primary_key=True, index=True)
    portal = Column(String, index=True)  # admin, branch, user
    portal_hash = Column(String, nullable=True, index=True)
    portal_enc = Column(Text, nullable=True)
    username = Column(String, index=True)
    username_hash = Column(String, nullable=True, index=True)
    username_enc = Column(Text, nullable=True)
    secret = Column(String, nullable=False)
    secret_hash = Column(String, nullable=True)
    secret_enc = Column(Text, nullable=True)
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Invite(Base):
    __tablename__ = "invites"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, index=True, nullable=False)
    email_hash = Column(String, nullable=True)
    email_enc = Column(Text, nullable=True)
    role = Column(String, nullable=False)  # branch or admin
    role_hash = Column(String, nullable=True)
    role_enc = Column(Text, nullable=True)
    token = Column(String, unique=True, index=True, nullable=False)
    token_hash = Column(String, nullable=True, index=True)
    token_enc = Column(Text, nullable=True)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

# Legacy alias for backward compatibility
PublicUser = CitizenUser

class Branch(Base):
    __tablename__ = "branches"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    name_hash = Column(String, nullable=True)
    name_enc = Column(Text, nullable=True)
    location = Column(String)
    location_hash = Column(String, nullable=True)
    location_enc = Column(Text, nullable=True)
    contact = Column(String)
    contact_hash = Column(String, nullable=True)
    contact_enc = Column(Text, nullable=True)
    dashboard_url = Column(String, nullable=True)
    dashboard_url_hash = Column(String, nullable=True)
    dashboard_url_enc = Column(Text, nullable=True)
    counters = Column(Integer)
    status = Column(String, default="Active")
    kiosk_pin = Column(String(10), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class Payment(Base):
    __tablename__ = "payments"
    
    id = Column(Integer, primary_key=True, index=True)
    ref_number = Column(String, unique=True, index=True)
    ref_number_hash = Column(String, nullable=True, index=True)
    ref_number_enc = Column(Text, nullable=True)
    txn_id = Column(String, unique=True)
    txn_id_hash = Column(String, nullable=True, index=True)
    txn_id_enc = Column(Text, nullable=True)
    taxpayer_name = Column(String)
    taxpayer_name_hash = Column(String, nullable=True)
    taxpayer_name_enc = Column(Text, nullable=True)
    tin = Column(String)
    tin_hash = Column(String, nullable=True)
    tin_enc = Column(Text, nullable=True)
    property_ref_number = Column(String, nullable=True)
    property_ref_number_hash = Column(String, nullable=True)
    property_ref_number_enc = Column(Text, nullable=True)
    tax_type = Column(String)
    tax_type_hash = Column(String, nullable=True)
    tax_type_enc = Column(Text, nullable=True)
    amount = Column(Float)
    payment_method = Column(String)
    payment_method_hash = Column(String, nullable=True)
    payment_method_enc = Column(Text, nullable=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True)
    branch = Column(String)
    branch_hash = Column(String, nullable=True)
    branch_enc = Column(Text, nullable=True)
    status = Column(String, default="Pending")
    email = Column(String, nullable=True)
    email_hash = Column(String, nullable=True)
    email_enc = Column(Text, nullable=True)
    contact_number = Column(String, nullable=True)
    contact_number_hash = Column(String, nullable=True)
    contact_number_enc = Column(Text, nullable=True)
    source_module = Column(String, default="tax_payment")
    related_request_id = Column(String, nullable=True)
    paymongo_checkout_session_id = Column(String, nullable=True, index=True)
    paymongo_checkout_session_id_hash = Column(String, nullable=True, index=True)
    paymongo_checkout_session_id_enc = Column(Text, nullable=True)
    paymongo_payment_intent_id = Column(String, nullable=True, index=True)
    paymongo_payment_intent_id_hash = Column(String, nullable=True, index=True)
    paymongo_payment_intent_id_enc = Column(Text, nullable=True)
    paymongo_source_id = Column(String, nullable=True, index=True)
    paymongo_source_id_hash = Column(String, nullable=True, index=True)
    paymongo_source_id_enc = Column(Text, nullable=True)
    paymongo_payment_id = Column(String, nullable=True, index=True)
    paymongo_payment_id_hash = Column(String, nullable=True, index=True)
    paymongo_payment_id_enc = Column(Text, nullable=True)
    paymongo_checkout_url = Column(String, nullable=True)
    paymongo_checkout_url_hash = Column(String, nullable=True)
    paymongo_checkout_url_enc = Column(Text, nullable=True)
    paymongo_status = Column(String, nullable=True)
    paymongo_status_hash = Column(String, nullable=True)
    paymongo_status_enc = Column(Text, nullable=True)
    metadata_json = Column(Text, nullable=True)
    proof_file_path = Column(String, nullable=True)
    proof_file_path_hash = Column(String, nullable=True)
    proof_file_path_enc = Column(Text, nullable=True)
    proof_file_name = Column(String, nullable=True)
    proof_file_name_hash = Column(String, nullable=True)
    proof_file_name_enc = Column(Text, nullable=True)
    proof_uploaded_at = Column(DateTime, nullable=True)
    treasury_remarks = Column(Text, nullable=True)
    treasury_remarks_hash = Column(String, nullable=True)
    treasury_remarks_enc = Column(Text, nullable=True)
    treasury_updated_at = Column(DateTime, nullable=True)
    official_receipt_number = Column(String, nullable=True)
    official_receipt_number_hash = Column(String, nullable=True)
    official_receipt_number_enc = Column(Text, nullable=True)
    official_receipt_path = Column(String, nullable=True)
    official_receipt_path_hash = Column(String, nullable=True)
    official_receipt_path_enc = Column(Text, nullable=True)
    official_receipt_generated_at = Column(DateTime, nullable=True)
    release_method = Column(String, nullable=True)
    release_method_hash = Column(String, nullable=True)
    release_method_enc = Column(Text, nullable=True)
    release_details_json = Column(Text, nullable=True)
    payment_expiry = Column(DateTime, nullable=True)
    receipt_sent_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    verified_at = Column(DateTime, nullable=True)
    public_access_token = Column(String, nullable=True, index=True)

    branch_record = relationship("Branch", backref="payments")


class CollectionAccount(Base):
    __tablename__ = "collection_accounts"

    id = Column(Integer, primary_key=True, index=True)
    owner_type = Column(String, nullable=False, index=True)  # main, branch
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True, index=True)
    account_name = Column(String, nullable=False)
    account_name_hash = Column(String, nullable=True)
    account_name_enc = Column(Text, nullable=True)
    current_balance = Column(Float, default=0.0)
    current_balance_hash = Column(String, nullable=True)
    current_balance_enc = Column(Text, nullable=True)
    total_collected = Column(Float, default=0.0)
    total_collected_hash = Column(String, nullable=True)
    total_collected_enc = Column(Text, nullable=True)
    total_remitted = Column(Float, default=0.0)
    total_remitted_hash = Column(String, nullable=True)
    total_remitted_enc = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    branch = relationship("Branch", backref="collection_accounts")


class Remittance(Base):
    __tablename__ = "remittances"

    id = Column(Integer, primary_key=True, index=True)
    remittance_number = Column(String, unique=True, index=True, nullable=False)
    remittance_number_hash = Column(String, nullable=True, index=True)
    remittance_number_enc = Column(Text, nullable=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=False, index=True)
    total_amount = Column(Float, default=0.0)
    total_amount_hash = Column(String, nullable=True)
    total_amount_enc = Column(Text, nullable=True)
    payment_count = Column(Integer, default=0)
    status = Column(String, default="Submitted", index=True)  # Submitted, Accepted, Rejected
    remarks = Column(Text, nullable=True)
    remarks_hash = Column(String, nullable=True)
    remarks_enc = Column(Text, nullable=True)
    report_file_path = Column(String, nullable=True)
    report_file_path_hash = Column(String, nullable=True)
    report_file_path_enc = Column(Text, nullable=True)
    report_file_name = Column(String, nullable=True)
    report_file_name_hash = Column(String, nullable=True)
    report_file_name_enc = Column(Text, nullable=True)
    report_file_mime = Column(String, nullable=True)
    submitted_by = Column(String, nullable=True)
    submitted_by_hash = Column(String, nullable=True)
    submitted_by_enc = Column(Text, nullable=True)
    reviewed_by = Column(String, nullable=True)
    reviewed_by_hash = Column(String, nullable=True)
    reviewed_by_enc = Column(Text, nullable=True)
    submitted_at = Column(DateTime, default=datetime.utcnow)
    reviewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    branch = relationship("Branch", backref="remittances")


class RemittanceItem(Base):
    __tablename__ = "remittance_items"

    id = Column(Integer, primary_key=True, index=True)
    remittance_id = Column(Integer, ForeignKey("remittances.id"), nullable=False, index=True)
    payment_id = Column(Integer, ForeignKey("payments.id"), nullable=False, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=False, index=True)
    amount = Column(Float, default=0.0)
    amount_hash = Column(String, nullable=True)
    amount_enc = Column(Text, nullable=True)
    status = Column(String, default="Submitted", index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    remittance = relationship("Remittance", backref="items")
    payment = relationship("Payment", backref="remittance_items")
    branch = relationship("Branch", backref="remittance_items")


class BusinessRegistry(Base):
    __tablename__ = "business_registry"

    id = Column(Integer, primary_key=True, index=True)
    business_name = Column(String, nullable=False, index=True)
    business_name_hash = Column(String, nullable=True)
    business_name_enc = Column(Text, nullable=True)
    owner_name = Column(String, nullable=False, index=True)
    owner_name_hash = Column(String, nullable=True)
    owner_name_enc = Column(Text, nullable=True)
    mayor_permit_number = Column(String, nullable=False, unique=True, index=True)
    mayor_permit_number_hash = Column(String, nullable=True)
    mayor_permit_number_enc = Column(Text, nullable=True)
    sec_dti_cda_number = Column(String, nullable=False, unique=True, index=True)
    sec_dti_cda_number_hash = Column(String, nullable=True)
    sec_dti_cda_number_enc = Column(Text, nullable=True)
    business_type = Column(String, nullable=True)
    business_type_hash = Column(String, nullable=True)
    business_type_enc = Column(Text, nullable=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True)
    branch_assigned = Column(String, nullable=True)
    branch_assigned_hash = Column(String, nullable=True)
    branch_assigned_enc = Column(Text, nullable=True)
    tin = Column(String, nullable=True)
    tin_hash = Column(String, nullable=True)
    tin_enc = Column(Text, nullable=True)
    annual_gross_sales = Column(Float, default=0.0)
    assessed_tax_due = Column(Float, default=0.0)
    business_status = Column(String, default="ACTIVE", index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    branch = relationship("Branch", backref="registered_businesses")


class BusinessTaxApplication(Base):
    __tablename__ = "business_tax_applications"

    id = Column(Integer, primary_key=True, index=True)
    tracking_number = Column(String, nullable=False, unique=True, index=True)
    citizen_user_id = Column(Integer, ForeignKey("citizen_users.id"), nullable=True, index=True)
    taxpayer_name = Column(String, nullable=False, index=True)
    taxpayer_name_hash = Column(String, nullable=True)
    taxpayer_name_enc = Column(Text, nullable=True)
    taxpayer_email = Column(String, nullable=False, index=True)
    taxpayer_email_hash = Column(String, nullable=True)
    taxpayer_email_enc = Column(Text, nullable=True)
    tin = Column(String, nullable=True, index=True)
    tin_hash = Column(String, nullable=True)
    tin_enc = Column(Text, nullable=True)
    business_registry_id = Column(Integer, ForeignKey("business_registry.id"), nullable=False, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True, index=True)
    branch_name = Column(String, nullable=True)
    branch_name_hash = Column(String, nullable=True)
    branch_name_enc = Column(Text, nullable=True)
    mayor_permit_number = Column(String, nullable=False, index=True)
    mayor_permit_number_hash = Column(String, nullable=True)
    mayor_permit_number_enc = Column(Text, nullable=True)
    sec_dti_cda_number = Column(String, nullable=False, index=True)
    sec_dti_cda_number_hash = Column(String, nullable=True)
    sec_dti_cda_number_enc = Column(Text, nullable=True)
    business_name = Column(String, nullable=False, index=True)
    business_name_hash = Column(String, nullable=True)
    business_name_enc = Column(Text, nullable=True)
    owner_name = Column(String, nullable=False, index=True)
    owner_name_hash = Column(String, nullable=True)
    owner_name_enc = Column(Text, nullable=True)
    business_type = Column(String, nullable=True)
    business_type_hash = Column(String, nullable=True)
    business_type_enc = Column(Text, nullable=True)
    business_status = Column(String, default="ACTIVE")
    application_status = Column(String, default="VALIDATED", index=True)
    amount_due = Column(Float, default=0.0)
    payment_status = Column(String, default="Pending", index=True)
    payment_ref_number = Column(String, nullable=True, index=True)
    payment_ref_number_hash = Column(String, nullable=True)
    payment_ref_number_enc = Column(Text, nullable=True)
    sales_declaration_path = Column(String, nullable=True)
    sales_declaration_name = Column(String, nullable=True)
    financial_statements_path = Column(String, nullable=True)
    financial_statements_name = Column(String, nullable=True)
    supporting_documents_path = Column(String, nullable=True)
    supporting_documents_name = Column(String, nullable=True)
    proof_of_payment_path = Column(String, nullable=True)
    proof_of_payment_name = Column(String, nullable=True)
    uploaded_at = Column(DateTime, nullable=True)
    verified_at = Column(DateTime, nullable=True)
    verified_by = Column(String, nullable=True)
    returned_at = Column(DateTime, nullable=True)
    verifier_remarks = Column(Text, nullable=True)
    verifier_remarks_hash = Column(String, nullable=True)
    verifier_remarks_enc = Column(Text, nullable=True)
    official_receipt_number = Column(String, nullable=True, index=True)
    official_receipt_number_hash = Column(String, nullable=True)
    official_receipt_number_enc = Column(Text, nullable=True)
    official_receipt_path = Column(String, nullable=True)
    official_receipt_generated_at = Column(DateTime, nullable=True)
    metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    citizen_user = relationship("CitizenUser", backref="business_tax_applications")
    business_registry = relationship("BusinessRegistry", backref="applications")
    branch = relationship("Branch", backref="business_tax_applications")


class TaxpayerIdentifierSubmission(Base):
    __tablename__ = "taxpayer_identifier_submissions"

    id = Column(Integer, primary_key=True, index=True)
    citizen_user_id = Column(Integer, ForeignKey("citizen_users.id"), nullable=False, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True, index=True)
    submission_type = Column(String, nullable=False, index=True)  # RPT, BT
    submission_type_hash = Column(String, nullable=True, index=True)
    submission_type_enc = Column(Text, nullable=True)
    taxpayer_type = Column(String, nullable=False, default="Individual")
    taxpayer_type_hash = Column(String, nullable=True)
    taxpayer_type_enc = Column(Text, nullable=True)
    full_name = Column(String, nullable=False)
    full_name_hash = Column(String, nullable=True, index=True)
    full_name_enc = Column(Text, nullable=True)
    email = Column(String, nullable=False, index=True)
    email_hash = Column(String, nullable=True, index=True)
    email_enc = Column(Text, nullable=True)
    mobile_number = Column(String, nullable=False)
    mobile_number_hash = Column(String, nullable=True)
    mobile_number_enc = Column(Text, nullable=True)
    address = Column(String, nullable=True)
    address_hash = Column(String, nullable=True)
    address_enc = Column(Text, nullable=True)
    tdn = Column(String, nullable=True, index=True)
    tdn_hash = Column(String, nullable=True, index=True)
    tdn_enc = Column(Text, nullable=True)
    mayor_permit_number = Column(String, nullable=True, index=True)
    mayor_permit_number_hash = Column(String, nullable=True, index=True)
    mayor_permit_number_enc = Column(Text, nullable=True)
    sec_dti_cda_number = Column(String, nullable=True, index=True)
    sec_dti_cda_number_hash = Column(String, nullable=True, index=True)
    sec_dti_cda_number_enc = Column(Text, nullable=True)
    supporting_file_path = Column(String, nullable=True)
    supporting_file_path_hash = Column(String, nullable=True)
    supporting_file_path_enc = Column(Text, nullable=True)
    supporting_file_name = Column(String, nullable=True)
    supporting_file_name_hash = Column(String, nullable=True)
    supporting_file_name_enc = Column(Text, nullable=True)
    supporting_file_mime = Column(String, nullable=True)
    supporting_file_mime_hash = Column(String, nullable=True)
    supporting_file_mime_enc = Column(Text, nullable=True)
    status = Column(String, nullable=False, default="Pending Verification", index=True)
    status_hash = Column(String, nullable=True, index=True)
    status_enc = Column(Text, nullable=True)
    remarks = Column(Text, nullable=True)
    remarks_hash = Column(String, nullable=True)
    remarks_enc = Column(Text, nullable=True)
    reviewed_by = Column(String, nullable=True)
    reviewed_by_hash = Column(String, nullable=True)
    reviewed_by_enc = Column(Text, nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    citizen_user = relationship("CitizenUser", backref="taxpayer_identifier_submissions")
    branch = relationship("Branch", backref="taxpayer_identifier_submissions")


class TaxAssessmentRecord(Base):
    __tablename__ = "tax_assessment_records"

    id = Column(Integer, primary_key=True, index=True)
    citizen_user_id = Column(Integer, ForeignKey("citizen_users.id"), nullable=True, index=True)
    submission_id = Column(Integer, ForeignKey("taxpayer_identifier_submissions.id"), nullable=True, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True, index=True)
    tax_type = Column(String, nullable=False, index=True)  # RPT, BT
    tax_type_hash = Column(String, nullable=True, index=True)
    tax_type_enc = Column(Text, nullable=True)
    assessment_status = Column(String, nullable=False, default="Active", index=True)
    assessment_status_hash = Column(String, nullable=True, index=True)
    assessment_status_enc = Column(Text, nullable=True)
    verification_status = Column(String, nullable=False, default="Pending Verification", index=True)
    verification_status_hash = Column(String, nullable=True, index=True)
    verification_status_enc = Column(Text, nullable=True)
    taxpayer_name = Column(String, nullable=False, index=True)
    taxpayer_name_hash = Column(String, nullable=True, index=True)
    taxpayer_name_enc = Column(Text, nullable=True)
    taxpayer_email = Column(String, nullable=True, index=True)
    taxpayer_email_hash = Column(String, nullable=True, index=True)
    taxpayer_email_enc = Column(Text, nullable=True)
    taxpayer_type = Column(String, nullable=False, default="Individual")
    taxpayer_type_hash = Column(String, nullable=True)
    taxpayer_type_enc = Column(Text, nullable=True)
    mobile_number = Column(String, nullable=True)
    mobile_number_hash = Column(String, nullable=True)
    mobile_number_enc = Column(Text, nullable=True)
    address = Column(String, nullable=True)
    address_hash = Column(String, nullable=True)
    address_enc = Column(Text, nullable=True)
    tax_year = Column(String, nullable=True)
    tax_year_hash = Column(String, nullable=True)
    tax_year_enc = Column(Text, nullable=True)
    tdn = Column(String, nullable=True, index=True)
    tdn_hash = Column(String, nullable=True, index=True)
    tdn_enc = Column(Text, nullable=True)
    property_type = Column(String, nullable=True)
    property_type_hash = Column(String, nullable=True)
    property_type_enc = Column(Text, nullable=True)
    property_address = Column(String, nullable=True)
    property_address_hash = Column(String, nullable=True)
    property_address_enc = Column(Text, nullable=True)
    fair_market_value = Column(Float, default=0.0)
    assessment_level = Column(Float, default=0.0)
    months_late = Column(Integer, default=0)
    discount_rate = Column(Float, default=0.0)
    assessed_value = Column(Float, default=0.0)
    basic_tax_due = Column(Float, default=0.0)
    sef_tax = Column(Float, default=0.0)
    penalties = Column(Float, default=0.0)
    discounts = Column(Float, default=0.0)
    final_total_amount_due = Column(Float, default=0.0)
    mayor_permit_number = Column(String, nullable=True, index=True)
    mayor_permit_number_hash = Column(String, nullable=True, index=True)
    mayor_permit_number_enc = Column(Text, nullable=True)
    sec_dti_cda_number = Column(String, nullable=True, index=True)
    sec_dti_cda_number_hash = Column(String, nullable=True)
    sec_dti_cda_number_enc = Column(Text, nullable=True)
    business_name = Column(String, nullable=True, index=True)
    business_name_hash = Column(String, nullable=True, index=True)
    business_name_enc = Column(Text, nullable=True)
    business_type = Column(String, nullable=True)
    business_type_hash = Column(String, nullable=True)
    business_type_enc = Column(Text, nullable=True)
    annual_gross_sales = Column(Float, default=0.0)
    business_tax_rate = Column(Float, default=0.0)
    amount_due = Column(Float, default=0.0)
    remarks = Column(Text, nullable=True)
    remarks_hash = Column(String, nullable=True)
    remarks_enc = Column(Text, nullable=True)
    rejection_reason = Column(Text, nullable=True)
    rejection_reason_hash = Column(String, nullable=True)
    rejection_reason_enc = Column(Text, nullable=True)
    visible_to_taxpayer = Column(Boolean, default=True)
    created_by = Column(String, nullable=True)
    created_by_hash = Column(String, nullable=True)
    created_by_enc = Column(Text, nullable=True)
    updated_by = Column(String, nullable=True)
    updated_by_hash = Column(String, nullable=True)
    updated_by_enc = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    citizen_user = relationship("CitizenUser", backref="tax_assessment_records")
    submission = relationship("TaxpayerIdentifierSubmission", backref="assessment_records")
    branch = relationship("Branch", backref="tax_assessment_records")


class RPTPropertyRecord(Base):
    __tablename__ = "rpt_property_records"

    id = Column(Integer, primary_key=True, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True, index=True)
    tdn = Column(String(30), nullable=True, index=True)
    tdn_hash = Column(String, nullable=True, index=True)
    tdn_enc = Column(Text, nullable=True)
    taxpayer_name = Column(String(150), nullable=True)
    taxpayer_name_hash = Column(String, nullable=True)
    taxpayer_name_enc = Column(Text, nullable=True)
    property_address = Column(String, nullable=True)
    property_address_hash = Column(String, nullable=True)
    property_address_enc = Column(Text, nullable=True)
    fair_market_value = Column(Float, default=0.0)
    assessment_level = Column(Float, default=0.0)
    tax_year = Column(Integer, nullable=True)
    due_months = Column(Integer, default=0)
    discount_rate = Column(Float, default=0.0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    branch = relationship("Branch", backref="rpt_property_records")


class ReceiptRequest(Base):
    __tablename__ = "receipt_requests"
    
    id = Column(Integer, primary_key=True, index=True)
    citizen_user_id = Column(Integer, ForeignKey("citizen_users.id"), nullable=True, index=True)
    request_id = Column(String, unique=True, index=True)
    request_id_hash = Column(String, nullable=True, index=True)
    request_id_enc = Column(Text, nullable=True)
    taxpayer_name = Column(String)
    taxpayer_name_hash = Column(String, nullable=True)
    taxpayer_name_enc = Column(Text, nullable=True)
    tax_type = Column(String, nullable=True)
    tax_type_hash = Column(String, nullable=True)
    tax_type_enc = Column(Text, nullable=True)
    request_reason = Column(String, nullable=True)
    request_reason_hash = Column(String, nullable=True)
    request_reason_enc = Column(Text, nullable=True)
    request_reason_other = Column(Text, nullable=True)
    request_reason_other_hash = Column(String, nullable=True)
    request_reason_other_enc = Column(Text, nullable=True)
    request_type = Column(String, nullable=True)
    request_type_hash = Column(String, nullable=True)
    request_type_enc = Column(Text, nullable=True)
    transaction_date = Column(String)
    transaction_date_hash = Column(String, nullable=True)
    transaction_date_enc = Column(Text, nullable=True)
    ref_number = Column(String)
    ref_number_hash = Column(String, nullable=True)
    ref_number_enc = Column(Text, nullable=True)
    email = Column(String)
    email_hash = Column(String, nullable=True, index=True)
    email_enc = Column(Text, nullable=True)
    status = Column(String, default="Payment Required")
    status_hash = Column(String, nullable=True)
    status_enc = Column(Text, nullable=True)
    fee_paid = Column(Boolean, default=False)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True)
    matched_receipt_id = Column(Integer, ForeignKey("receipt_records.id"), nullable=True)
    linked_queue_number = Column(String, nullable=True, index=True)
    linked_queue_number_hash = Column(String, nullable=True, index=True)
    linked_queue_number_enc = Column(Text, nullable=True)
    appointment_time = Column(DateTime, nullable=True)
    payment_ref_number = Column(String, nullable=True)
    payment_ref_number_hash = Column(String, nullable=True)
    payment_ref_number_enc = Column(Text, nullable=True)
    release_copy_path = Column(String, nullable=True)
    release_copy_path_hash = Column(String, nullable=True)
    release_copy_path_enc = Column(Text, nullable=True)
    release_copy_filename = Column(String, nullable=True)
    release_copy_filename_hash = Column(String, nullable=True)
    release_copy_filename_enc = Column(Text, nullable=True)
    processed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class ReceiptRequestHistory(Base):
    __tablename__ = "receipt_request_history"

    id = Column(Integer, primary_key=True, index=True)
    citizen_user_id = Column(Integer, ForeignKey("citizen_users.id"), nullable=True, index=True)
    request_id = Column(String, unique=True, index=True)
    request_id_hash = Column(String, nullable=True, index=True)
    request_id_enc = Column(Text, nullable=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True, index=True)
    taxpayer_name = Column(String, nullable=True)
    taxpayer_name_hash = Column(String, nullable=True)
    taxpayer_name_enc = Column(Text, nullable=True)
    tax_type = Column(String, nullable=True)
    tax_type_hash = Column(String, nullable=True)
    tax_type_enc = Column(Text, nullable=True)
    request_reason = Column(String, nullable=True)
    request_reason_hash = Column(String, nullable=True)
    request_reason_enc = Column(Text, nullable=True)
    request_reason_other = Column(Text, nullable=True)
    request_reason_other_hash = Column(String, nullable=True)
    request_reason_other_enc = Column(Text, nullable=True)
    request_type = Column(String, nullable=True)
    request_type_hash = Column(String, nullable=True)
    request_type_enc = Column(Text, nullable=True)
    transaction_date = Column(String, nullable=True)
    transaction_date_hash = Column(String, nullable=True)
    transaction_date_enc = Column(Text, nullable=True)
    ref_number = Column(String, nullable=True)
    ref_number_hash = Column(String, nullable=True)
    ref_number_enc = Column(Text, nullable=True)
    email = Column(String, nullable=True)
    email_hash = Column(String, nullable=True, index=True)
    email_enc = Column(Text, nullable=True)
    final_status = Column(String, nullable=True)
    final_status_hash = Column(String, nullable=True)
    final_status_enc = Column(Text, nullable=True)
    fee_paid = Column(Boolean, default=False)
    matched_receipt_id = Column(Integer, ForeignKey("receipt_records.id"), nullable=True)
    linked_queue_number = Column(String, nullable=True, index=True)
    linked_queue_number_hash = Column(String, nullable=True, index=True)
    linked_queue_number_enc = Column(Text, nullable=True)
    appointment_time = Column(DateTime, nullable=True)
    payment_ref_number = Column(String, nullable=True)
    payment_ref_number_hash = Column(String, nullable=True)
    payment_ref_number_enc = Column(Text, nullable=True)
    release_copy_filename = Column(String, nullable=True)
    release_copy_filename_hash = Column(String, nullable=True)
    release_copy_filename_enc = Column(Text, nullable=True)
    processed_at = Column(DateTime, nullable=True)
    completed_by = Column(String, nullable=True)
    created_at = Column(DateTime, nullable=True)
    archived_at = Column(DateTime, default=datetime.utcnow)

class ReceiptRecord(Base):
    __tablename__ = "receipt_records"

    id = Column(Integer, primary_key=True, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True)
    receipt_number = Column(String, index=True, nullable=True)
    receipt_number_hash = Column(String, nullable=True, index=True)
    receipt_number_enc = Column(Text, nullable=True)
    ref_number = Column(String, index=True, nullable=True)
    ref_number_hash = Column(String, nullable=True, index=True)
    ref_number_enc = Column(Text, nullable=True)
    txn_id = Column(String, nullable=True)
    txn_id_hash = Column(String, nullable=True)
    txn_id_enc = Column(Text, nullable=True)
    taxpayer_name = Column(String, nullable=True)
    taxpayer_name_hash = Column(String, nullable=True)
    taxpayer_name_enc = Column(Text, nullable=True)
    transaction_date = Column(String, nullable=True)
    transaction_date_hash = Column(String, nullable=True)
    transaction_date_enc = Column(Text, nullable=True)
    amount = Column(Float, nullable=True)
    tax_type = Column(String, nullable=True)
    tax_type_hash = Column(String, nullable=True)
    tax_type_enc = Column(Text, nullable=True)
    payment_method = Column(String, nullable=True)
    payment_method_hash = Column(String, nullable=True)
    payment_method_enc = Column(Text, nullable=True)
    source_image_sha256 = Column(String, index=True, nullable=True)
    source_image_ahash = Column(String, index=True, nullable=True)
    selected_category = Column(String, nullable=True)
    detected_category = Column(String, nullable=True)
    source_image_path = Column(String, nullable=True)
    source_image_path_hash = Column(String, nullable=True)
    source_image_path_enc = Column(Text, nullable=True)
    raw_ocr_text = Column(Text, nullable=True)
    raw_ocr_text_hash = Column(String, nullable=True)
    raw_ocr_text_enc = Column(Text, nullable=True)
    verification_status = Column(String, default="Verified")
    verification_status_hash = Column(String, nullable=True)
    verification_status_enc = Column(Text, nullable=True)
    confidence = Column(Float, default=0.0)
    uploaded_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Announcement(Base):
    __tablename__ = "announcements"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    icon_type = Column(String, default="megaphone")  # megaphone, check, clock, info
    icon_color = Column(String, default="blue")  # blue, green, yellow, red
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True)
    publish_date = Column(DateTime, default=datetime.utcnow)
    is_active = Column(Boolean, default=True)
    created_by = Column(String)
    title_hash = Column(String, nullable=True)
    content_hash = Column(String, nullable=True)
    created_by_hash = Column(String, nullable=True)
    integrity_hash = Column(String, nullable=True)
    title_enc = Column(Text, nullable=True)
    content_enc = Column(Text, nullable=True)
    created_by_enc = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    branch = relationship("Branch", backref="announcements")
    attachments = relationship(
        "AnnouncementAttachment",
        backref="announcement",
        cascade="all, delete-orphan",
        order_by="AnnouncementAttachment.created_at",
    )


class AnnouncementAttachment(Base):
    __tablename__ = "announcement_attachments"

    id = Column(Integer, primary_key=True, index=True)
    announcement_id = Column(
        Integer,
        ForeignKey("announcements.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    file_path = Column(String(500), nullable=False)
    original_filename = Column(String(255), nullable=False)
    stored_filename = Column(String(255), nullable=False)
    mime_type = Column(String(150), nullable=True)
    file_size = Column(Integer, default=0)
    file_content = Column(LONGBLOB, nullable=True)
    uploaded_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class AnnouncementView(Base):
    __tablename__ = "announcement_views"

    id = Column(Integer, primary_key=True, index=True)
    announcement_id = Column(Integer, ForeignKey("announcements.id"), nullable=False, index=True)
    viewer_username = Column(String, nullable=False, index=True)
    viewer_username_hash = Column(String, nullable=True, index=True)
    viewer_username_enc = Column(Text, nullable=True)
    viewer_type = Column(String, default="admin")
    viewer_type_hash = Column(String, nullable=True, index=True)
    viewer_type_enc = Column(Text, nullable=True)
    viewed_at = Column(DateTime, default=datetime.utcnow)

    announcement = relationship("Announcement", backref="views")


class Memo(Base):
    __tablename__ = "memos"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String)
    title_hash = Column(String, nullable=True)
    title_enc = Column(Text, nullable=True)
    content = Column(Text)
    content_hash = Column(String, nullable=True)
    content_enc = Column(Text, nullable=True)
    recipients = Column(String)  # Comma-separated branch IDs or "all"
    recipients_hash = Column(String, nullable=True)
    recipients_enc = Column(Text, nullable=True)
    recipient_type = Column(String, default="all")  # all, specific_branches, specific_users
    recipient_type_hash = Column(String, nullable=True)
    recipient_type_enc = Column(Text, nullable=True)
    author = Column(String)
    author_hash = Column(String, nullable=True)
    author_enc = Column(Text, nullable=True)
    author_type = Column(String, default="admin")
    author_type_hash = Column(String, nullable=True)
    author_type_enc = Column(Text, nullable=True)
    priority = Column(String, default="normal")  # low, normal, high
    priority_hash = Column(String, nullable=True)
    priority_enc = Column(Text, nullable=True)
    attachment_path = Column(String, nullable=True)
    attachment_path_hash = Column(String, nullable=True)
    attachment_path_enc = Column(Text, nullable=True)
    attachment_filename = Column(String, nullable=True)
    attachment_filename_hash = Column(String, nullable=True)
    attachment_filename_enc = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class MemoView(Base):
    __tablename__ = "memo_views"
    
    id = Column(Integer, primary_key=True, index=True)
    memo_id = Column(Integer, ForeignKey("memos.id"), nullable=False)
    viewer_username = Column(String, nullable=False)
    viewer_username_hash = Column(String, nullable=True)
    viewer_username_enc = Column(Text, nullable=True)
    viewer_type = Column(String, default="admin")  # admin, branch_staff
    viewer_type_hash = Column(String, nullable=True)
    viewer_type_enc = Column(Text, nullable=True)
    viewed_at = Column(DateTime, default=datetime.utcnow)
    
    memo = relationship("Memo", backref="views")

class DiscrepancyReport(Base):
    __tablename__ = "discrepancy_reports"

    id = Column(Integer, primary_key=True, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=False)
    title = Column(String, nullable=False)
    title_hash = Column(String, nullable=True)
    title_enc = Column(Text, nullable=True)
    report_date = Column(String, nullable=False)
    report_date_hash = Column(String, nullable=True)
    report_date_enc = Column(Text, nullable=True)
    discrepancy_type = Column(String, nullable=False)
    discrepancy_type_hash = Column(String, nullable=True)
    discrepancy_type_enc = Column(Text, nullable=True)
    system_amount = Column(Float, nullable=True)
    actual_amount = Column(Float, nullable=True)
    description = Column(Text, nullable=False)
    description_hash = Column(String, nullable=True)
    description_enc = Column(Text, nullable=True)
    supporting_documents = Column(Text, nullable=True)
    supporting_documents_hash = Column(String, nullable=True)
    supporting_documents_enc = Column(Text, nullable=True)
    attachment_path = Column(String, nullable=True)
    attachment_path_hash = Column(String, nullable=True)
    attachment_path_enc = Column(Text, nullable=True)
    attachment_filename = Column(String, nullable=True)
    attachment_filename_hash = Column(String, nullable=True)
    attachment_filename_enc = Column(Text, nullable=True)
    submitted_offline = Column(Boolean, default=False)
    status = Column(String, default="Pending Review")
    verification_notes = Column(Text, nullable=True)
    verification_notes_hash = Column(String, nullable=True)
    verification_notes_enc = Column(Text, nullable=True)
    branch_reply_notes = Column(Text, nullable=True)
    branch_reply_notes_hash = Column(String, nullable=True)
    branch_reply_notes_enc = Column(Text, nullable=True)
    conversation_thread = Column(Text, nullable=True)
    conversation_thread_hash = Column(String, nullable=True)
    conversation_thread_enc = Column(Text, nullable=True)
    reported_by = Column(String, nullable=False)
    reported_by_hash = Column(String, nullable=True)
    reported_by_enc = Column(Text, nullable=True)
    verified_by = Column(String, nullable=True)
    verified_by_hash = Column(String, nullable=True)
    verified_by_enc = Column(Text, nullable=True)
    branch_replied_by = Column(String, nullable=True)
    branch_replied_by_hash = Column(String, nullable=True)
    branch_replied_by_enc = Column(Text, nullable=True)
    verified_at = Column(DateTime, nullable=True)
    branch_replied_at = Column(DateTime, nullable=True)
    last_viewed_by_branch = Column(DateTime, nullable=True)
    last_viewed_by_admin = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    branch = relationship("Branch", backref="discrepancy_reports")

class Alert(Base):
    __tablename__ = "alerts"
    
    id = Column(Integer, primary_key=True, index=True)
    type = Column(String)
    title = Column(String)
    message = Column(Text)
    severity = Column(String)
    read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class AlertView(Base):
    __tablename__ = "alert_views"

    id = Column(Integer, primary_key=True, index=True)
    alert_id = Column(Integer, ForeignKey("alerts.id"), nullable=False, index=True)
    viewer_username = Column(String, nullable=False, index=True)
    viewer_type = Column(String, default="admin", index=True)
    viewed_at = Column(DateTime, default=datetime.utcnow)

    alert = relationship("Alert", backref="views")

class ActivityLog(Base):
    __tablename__ = "activity_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    action = Column(String)
    user = Column(String)
    details = Column(Text)
    type = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    previous_integrity_hash = Column(String(128), nullable=True)
    integrity_hash = Column(String(128), nullable=True, index=True)

class Backup(Base):
    __tablename__ = "backups"
    
    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String)
    size = Column(String)
    type = Column(String)
    status = Column(String, default="Completed")
    checksum = Column(String(128), nullable=True)
    db_type = Column(String(40), nullable=True)
    retention_days = Column(Integer, default=30)
    created_at = Column(DateTime, default=datetime.utcnow)

class RevokedToken(Base):
    __tablename__ = "revoked_tokens"

    id = Column(Integer, primary_key=True, index=True)
    token_hash = Column(String(128), unique=True, nullable=False, index=True)
    token_type = Column(String(40), nullable=True, index=True)
    subject = Column(String(255), nullable=True, index=True)
    expires_at = Column(DateTime, nullable=True, index=True)
    revoked_at = Column(DateTime, default=datetime.utcnow, index=True)

class SecurityLogView(Base):
    __tablename__ = "security_log_views"

    id = Column(Integer, primary_key=True, index=True)
    log_type = Column(String(40), nullable=False, index=True)
    log_id = Column(Integer, nullable=False, index=True)
    viewer_username = Column(String(255), nullable=False, index=True)
    viewed_at = Column(DateTime, default=datetime.utcnow)

class Policy(Base):
    __tablename__ = "policies"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String)
    category = Column(String)
    content = Column(Text)
    author = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PolicyView(Base):
    __tablename__ = "policy_views"

    id = Column(Integer, primary_key=True, index=True)
    policy_id = Column(Integer, ForeignKey("policies.id"), nullable=False, index=True)
    viewer_username = Column(String, nullable=False, index=True)
    viewer_type = Column(String, default="admin")
    viewed_at = Column(DateTime, default=datetime.utcnow)

    policy = relationship("Policy", backref="views")


class PrivacyConsent(Base):
    __tablename__ = "privacy_consents"

    id = Column(Integer, primary_key=True, index=True)
    citizen_user_id = Column(Integer, ForeignKey("citizen_users.id", ondelete="CASCADE"), nullable=False, index=True)
    agreement_title = Column(String, nullable=False)
    agreement_version = Column(String, nullable=False, index=True)
    agreement_effective_date = Column(String, nullable=False)
    source_module = Column(String, nullable=False, default="citizen_registration")
    consented_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    ip_address = Column(String(45), nullable=True)
    ip_address_hash = Column(String, nullable=True, index=True)
    ip_address_enc = Column(Text, nullable=True)

    citizen_user = relationship("CitizenUser", backref="privacy_consents")


class SystemSetting(Base):
    __tablename__ = "system_settings"

    id = Column(Integer, nullable=True, index=True)
    key = Column(String, primary_key=True, index=True)
    key_hash = Column(String, nullable=True, index=True)
    key_enc = Column(Text, nullable=True)
    label = Column(String, nullable=False)
    label_hash = Column(String, nullable=True)
    label_enc = Column(Text, nullable=True)
    category = Column(String, nullable=False)
    category_hash = Column(String, nullable=True)
    category_enc = Column(Text, nullable=True)
    value_json = Column(Text, nullable=True)
    value_json_hash = Column(String, nullable=True)
    value_json_enc = Column(Text, nullable=True)
    value = Column(Text, nullable=False)
    value_hash = Column(String, nullable=True)
    value_enc = Column(Text, nullable=True)
    value_type = Column(String, nullable=False, default="string")
    value_type_hash = Column(String, nullable=True)
    value_type_enc = Column(Text, nullable=True)
    description = Column(Text, nullable=True)
    description_hash = Column(String, nullable=True)
    description_enc = Column(Text, nullable=True)
    updated_by = Column(String, nullable=True)
    updated_by_hash = Column(String, nullable=True)
    updated_by_enc = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ServiceWindowConfig(Base):
    __tablename__ = "service_window_config"

    id = Column(Integer, primary_key=True, index=True)
    window_count = Column(String, nullable=True)
    window_count_hash = Column(String, nullable=True)
    window_count_enc = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SystemSettingAudit(Base):
    __tablename__ = "system_setting_audit"

    id = Column(Integer, primary_key=True, index=True)
    setting_key = Column(String, ForeignKey("system_settings.key"), nullable=False, index=True)
    setting_label = Column(String, nullable=False)
    category = Column(String, nullable=False)
    previous_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=False)
    changed_by = Column(String, nullable=False)
    reason = Column(Text, nullable=True)
    changed_at = Column(DateTime, default=datetime.utcnow, index=True)

    setting = relationship("SystemSetting", backref="audit_entries")


class BranchSystemSetting(Base):
    __tablename__ = "branch_system_settings"

    id = Column(Integer, primary_key=True, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=False, index=True)
    key = Column(String, nullable=False, index=True)
    label = Column(String, nullable=False)
    category = Column(String, nullable=False)
    value_json = Column(Text, nullable=True)
    value = Column(Text, nullable=False)
    value_type = Column(String, nullable=False, default="string")
    description = Column(Text, nullable=True)
    updated_by = Column(String, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    branch = relationship("Branch", backref="branch_system_settings")

class Report(Base):
    __tablename__ = "reports"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True)
    branch = Column(String)
    report_type = Column(String)
    service_type = Column(String, nullable=True)
    transaction_category = Column(String, nullable=True)
    date_from = Column(String, nullable=True)
    date_to = Column(String, nullable=True)
    generated_by = Column(String, nullable=True)
    submitted_by = Column(String, nullable=True)
    submitted_at = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)

    branch_record = relationship("Branch", backref="reports")


class ReportHistory(Base):
    __tablename__ = "report_history"
    
    id = Column(Integer, primary_key=True, index=True)
    original_report_id = Column(Integer, nullable=True, index=True)
    title = Column(String)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True)
    branch = Column(String)
    report_type = Column(String)
    service_type = Column(String, nullable=True)
    transaction_category = Column(String, nullable=True)
    date_from = Column(String, nullable=True)
    date_to = Column(String, nullable=True)
    generated_by = Column(String, nullable=True)
    submitted_by = Column(String, nullable=True)
    submitted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=True)
    deleted_at = Column(DateTime, default=datetime.utcnow)
    deleted_by = Column(String, nullable=True)
    status = Column(String, default="Archived")

    branch_record = relationship("Branch", backref="report_history")

class QueueActivity(Base):
    __tablename__ = "queue_activity"
    
    id = Column(Integer, primary_key=True, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"))
    clients_waiting = Column(Integer, default=0)
    clients_being_served = Column(Integer, default=0)
    clients_completed = Column(Integer, default=0)
    service_type = Column(String, nullable=True)
    service_type_hash = Column(String, nullable=True)
    service_type_enc = Column(Text, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    
    branch = relationship("Branch", backref="queue_activities")

class Queue(Base):
    __tablename__ = "queues"
    
    id = Column(Integer, primary_key=True, index=True)
    queue_number = Column(String, unique=True, index=True)
    queue_number_hash = Column(String, nullable=True, index=True)
    queue_number_enc = Column(Text, nullable=True)
    citizen_user_id = Column(Integer, ForeignKey("citizen_users.id"), nullable=True, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"))
    service_type = Column(String)
    service_type_hash = Column(String, nullable=True)
    service_type_enc = Column(Text, nullable=True)
    taxpayer_name = Column(String, nullable=True)
    taxpayer_name_hash = Column(String, nullable=True)
    taxpayer_name_enc = Column(Text, nullable=True)
    contact_number = Column(String, nullable=True)
    contact_number_hash = Column(String, nullable=True)
    contact_number_enc = Column(Text, nullable=True)
    email = Column(String, nullable=True)
    email_hash = Column(String, nullable=True)
    email_enc = Column(Text, nullable=True)
    status = Column(String, default="Waiting")  # Waiting, Serving, Completed, Cancelled
    status_hash = Column(String, nullable=True)
    status_enc = Column(Text, nullable=True)
    queue_type = Column(String, default="immediate")  # immediate, appointment
    queue_type_hash = Column(String, nullable=True)
    queue_type_enc = Column(Text, nullable=True)
    appointment_time = Column(DateTime, nullable=True)
    appointment_reservation_key = Column(String, nullable=True, unique=True, index=True)
    estimated_wait_time = Column(Integer, nullable=True)  # in minutes
    recommended_arrival = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    served_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    
    branch = relationship("Branch", backref="queues")


class QueueHistory(Base):
    __tablename__ = "queue_history"

    id = Column(Integer, primary_key=True, index=True)
    queue_number = Column(String, index=True)
    citizen_user_id = Column(Integer, ForeignKey("citizen_users.id"), nullable=True, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), index=True)
    service_type = Column(String, nullable=True)
    service_window = Column(String, nullable=True, index=True)
    taxpayer_name = Column(String, nullable=True)
    contact_number = Column(String, nullable=True)
    email = Column(String, nullable=True)
    final_status = Column(String, default="Completed")
    queue_type = Column(String, default="immediate")
    appointment_time = Column(DateTime, nullable=True)
    estimated_wait_time = Column(Integer, nullable=True)
    recommended_arrival = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=True)
    served_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    completed_by = Column(String, nullable=True)
    archived_at = Column(DateTime, default=datetime.utcnow)

    branch = relationship("Branch", backref="queue_history_entries")

class KioskDevice(Base):
    __tablename__ = "kiosk_devices"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    branch_id = Column(Integer, ForeignKey("branches.id"))
    name = Column(String(100), default="Kiosk")
    pairing_code_hash = Column(String(255), nullable=True)
    device_token_hash = Column(String(255), nullable=True)
    status = Column(String(20), default="active")
    paired_at = Column(DateTime, default=datetime.utcnow)
    last_heartbeat = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    branch = relationship("Branch", backref="kiosk_devices")

class Service(Base):
    __tablename__ = "services"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    name_hash = Column(String, nullable=True, index=True)
    name_enc = Column(Text, nullable=True)
    description = Column(Text)
    description_hash = Column(String, nullable=True)
    description_enc = Column(Text, nullable=True)
    category = Column(String)  # Tax Payment, Document Request, Registration, etc.
    category_hash = Column(String, nullable=True)
    category_enc = Column(Text, nullable=True)
    average_processing_time = Column(Integer, default=15)  # in minutes
    requires_appointment = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class BranchService(Base):
    __tablename__ = "branch_services"
    
    id = Column(Integer, primary_key=True, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"))
    service_id = Column(Integer, ForeignKey("services.id"))
    is_available = Column(Boolean, default=True)
    
    branch = relationship("Branch", backref="branch_services")
    service = relationship("Service", backref="branch_services")

class FAQ(Base):
    __tablename__ = "faqs"
    
    id = Column(Integer, primary_key=True, index=True)
    question = Column(Text)
    question_hash = Column(String, nullable=True)
    question_enc = Column(Text, nullable=True)
    answer = Column(Text)
    answer_hash = Column(String, nullable=True)
    answer_enc = Column(Text, nullable=True)
    category = Column(String)
    category_hash = Column(String, nullable=True)
    category_enc = Column(Text, nullable=True)
    language = Column(String, default="en")  # en, tl
    language_hash = Column(String, nullable=True)
    language_enc = Column(Text, nullable=True)
    order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class TaxpayerGuide(Base):
    __tablename__ = "taxpayer_guides"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String)
    title_hash = Column(String, nullable=True)
    title_enc = Column(Text, nullable=True)
    content = Column(Text)
    content_hash = Column(String, nullable=True)
    content_enc = Column(Text, nullable=True)
    category = Column(String)
    category_hash = Column(String, nullable=True)
    category_enc = Column(Text, nullable=True)
    language = Column(String, default="en")  # en, tl
    language_hash = Column(String, nullable=True, index=True)
    language_enc = Column(Text, nullable=True)
    order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PublicPageContent(Base):
    __tablename__ = "public_page_contents"

    id = Column(Integer, primary_key=True, index=True)
    page_key = Column(String, unique=True, nullable=False, index=True)
    draft_content_json = Column(LONGTEXT(), nullable=True)
    published_content_json = Column(LONGTEXT(), nullable=True)
    last_saved_at = Column(DateTime, nullable=True)
    last_saved_by = Column(String, nullable=True)
    published_at = Column(DateTime, nullable=True)
    published_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class BranchOperatingHours(Base):
    __tablename__ = "branch_operating_hours"
    
    id = Column(Integer, primary_key=True, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"))
    day_of_week = Column(String)  # Monday, Tuesday, etc.
    opening_time = Column(String)  # 08:00
    closing_time = Column(String)  # 17:00
    is_open = Column(Boolean, default=True)
    
    branch = relationship("Branch", backref="operating_hours")


class BranchAppointmentSchedule(Base):
    __tablename__ = "branch_appointment_schedules"

    id = Column(Integer, primary_key=True, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=False, index=True)
    draft_config = Column(Text, nullable=False)
    published_config = Column(Text, nullable=False)
    effective_date = Column(String, nullable=False)
    updated_by = Column(String, nullable=True)
    published_by = Column(String, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    published_at = Column(DateTime, nullable=True)

    branch = relationship("Branch", backref="appointment_schedules")


class BranchAppointmentScheduleAudit(Base):
    __tablename__ = "branch_appointment_schedule_audit"

    id = Column(Integer, primary_key=True, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=False, index=True)
    action = Column(String, nullable=False)
    change_summary = Column(Text, nullable=True)
    previous_config = Column(Text, nullable=True)
    new_config = Column(Text, nullable=True)
    effective_date = Column(String, nullable=True)
    changed_by = Column(String, nullable=True)
    reason = Column(Text, nullable=True)
    changed_at = Column(DateTime, default=datetime.utcnow, index=True)


class PermanentIpBlock(Base):
    __tablename__ = "permanent_ip_blocks"
    
    id = Column(Integer, primary_key=True, index=True)
    ip_address = Column(String(45), unique=True, index=True)  # IPv4 or IPv6
    reason = Column(String(500), nullable=True)
    blocked_by = Column(String(255), nullable=True)  # admin username
    blocked_at = Column(DateTime, default=datetime.utcnow)
    is_active = Column(Boolean, default=True)
    abuse_count = Column(Integer, default=0)  # Track how many times this IP was auto-blocked


class IpReputationCache(Base):
    __tablename__ = "ip_reputation_cache"
    
    id = Column(Integer, primary_key=True, index=True)
    ip_address = Column(String(45), unique=True, index=True)
    is_malicious = Column(Boolean, default=False)
    confidence_score = Column(Integer, default=0)  # 0-100
    last_checked = Column(DateTime, default=datetime.utcnow)
    report_count = Column(Integer, default=0)  # Number of abuse reports
    threat_types = Column(String(500), nullable=True)  # JSON array of threat types
