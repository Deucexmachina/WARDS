from sqlalchemy import Column, Integer, String, Boolean, Text, Enum, ForeignKey, TIMESTAMP, Numeric
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database.config import Base
import enum

class UserRole(str, enum.Enum):
    admin = "admin"
    staff = "staff"

class QueueStatus(str, enum.Enum):
    waiting = "waiting"
    serving = "serving"
    completed = "completed"
    no_show = "no_show"
    skipped = "skipped"

class PriorityTag(str, enum.Enum):
    PWD = "PWD"
    Senior = "Senior"
    Pregnant = "Pregnant"

class AnnouncementPriority(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(100), nullable=False)
    role = Column(Enum(UserRole), default=UserRole.staff)
    is_active = Column(Boolean, default=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    last_login = Column(TIMESTAMP, nullable=True)
    
    # Relationships
    queue_entries = relationship("QueueEntry", back_populates="served_by_user")
    announcements = relationship("Announcement", back_populates="creator")
    activity_logs = relationship("ActivityLog", back_populates="user")

class Service(Base):
    __tablename__ = "services"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    counter = Column(Integer, nullable=False, index=True)
    description = Column(Text)
    is_active = Column(Boolean, default=True, index=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    
    # Relationships
    queue_entries = relationship("QueueEntry", back_populates="service")

class QueueEntry(Base):
    __tablename__ = "queue_entries"
    
    id = Column(Integer, primary_key=True, index=True)
    queue_number = Column(String(20), unique=True, nullable=False, index=True)
    service_id = Column(Integer, ForeignKey("services.id"), nullable=False)
    client_name = Column(String(100), nullable=False)
    priority_tag = Column(Enum(PriorityTag), nullable=True)
    status = Column(Enum(QueueStatus), default=QueueStatus.waiting, index=True)
    position = Column(Integer)
    created_at = Column(TIMESTAMP, server_default=func.now(), index=True)
    called_at = Column(TIMESTAMP, nullable=True)
    completed_at = Column(TIMESTAMP, nullable=True)
    served_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    notes = Column(Text, nullable=True)
    
    # Relationships
    service = relationship("Service", back_populates="queue_entries")
    served_by_user = relationship("User", back_populates="queue_entries")

class Announcement(Base):
    __tablename__ = "announcements"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    content = Column(Text, nullable=False)
    priority = Column(Enum(AnnouncementPriority), default=AnnouncementPriority.medium)
    is_active = Column(Boolean, default=True, index=True)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())
    
    # Relationships
    creator = relationship("User", back_populates="announcements")

class ActivityLog(Base):
    __tablename__ = "activity_log"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    action = Column(String(50), nullable=False)
    entity_type = Column(String(50))
    entity_id = Column(Integer)
    description = Column(Text)
    ip_address = Column(String(45))
    created_at = Column(TIMESTAMP, server_default=func.now(), index=True)
    
    # Relationships
    user = relationship("User", back_populates="activity_logs")

class ReceiptCategory(str, enum.Enum):
    RPT = "RPT"
    BUSINESS = "BUSINESS"
    MISC = "MISC"


class Receipt(Base):
    __tablename__ = "receipts"

    id = Column(Integer, primary_key=True, index=True)

    category = Column(Enum(ReceiptCategory), nullable=False)

    taxpayer_name = Column(String(150), nullable=False)
    taxpayer_name_enc = Column(Text, nullable=True)
    taxpayer_name_hash = Column(String(64), nullable=True, index=True)

    transaction_date = Column(String(50), nullable=True)
    transaction_date_enc = Column(Text, nullable=True)
    transaction_date_hash = Column(String(64), nullable=True)

    tax_declaration_no = Column(String(100), nullable=True)
    tax_declaration_no_enc = Column(Text, nullable=True)
    tax_declaration_no_hash = Column(String(64), nullable=True, index=True)
    nature_of_collection = Column(String(150), nullable=True)
    nature_of_collection_enc = Column(Text, nullable=True)
    nature_of_collection_hash = Column(String(64), nullable=True)

    amount_paid = Column(String(50), nullable=False)
    amount_paid_enc = Column(Text, nullable=True)
    amount_paid_hash = Column(String(64), nullable=True)

    image_path = Column(String(255), nullable=False)

    created_at = Column(TIMESTAMP, server_default=func.now())


class Taxpayer(Base):
    __tablename__ = "taxpayers"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String(150), nullable=False)
    full_name_enc = Column(Text, nullable=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    email_enc = Column(Text, nullable=True)
    email_hash = Column(String(64), nullable=True, index=True)
    password_hash = Column(String(255), nullable=False)
    email_verified = Column(Boolean, default=False, nullable=False)
    email_verified_at = Column(TIMESTAMP, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())


class TaxpayerOTP(Base):
    __tablename__ = "taxpayer_otps"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), nullable=False, index=True)
    email_enc = Column(Text, nullable=True)
    email_hash = Column(String(64), nullable=True, index=True)
    otp_hash = Column(String(255), nullable=False)
    expires_at = Column(TIMESTAMP, nullable=False, index=True)
    used_at = Column(TIMESTAMP, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now(), index=True)


class ServiceWindowConfig(Base):
    __tablename__ = "service_window_config"

    id = Column(Integer, primary_key=True, index=True)
    window_count = Column(Integer, nullable=False, default=3)
    updated_at = Column(
        TIMESTAMP,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class BranchStaffAccount(Base):
    __tablename__ = "branch_staff_accounts"

    id = Column(Integer, primary_key=True, index=True)
    window_code = Column(String(30), unique=True, nullable=False, index=True)
    window_label = Column(String(100), nullable=False)
    window_label_enc = Column(Text, nullable=True)
    window_label_hash = Column(String(64), nullable=True)
    service_id = Column(Integer, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    email_enc = Column(Text, nullable=True)
    email_hash = Column(String(64), nullable=True, index=True)
    username = Column(String(80), unique=True, nullable=False, index=True)
    username_enc = Column(Text, nullable=True)
    username_hash = Column(String(64), nullable=True, index=True)
    password_hash = Column(String(255), nullable=False)
    mfa_secret = Column(String(64), nullable=False)
    mfa_secret_enc = Column(Text, nullable=True)
    mfa_enabled = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False, index=True)
    temp_password_sent_at = Column(TIMESTAMP, nullable=True)
    last_login = Column(TIMESTAMP, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now(), nullable=False)


class RPTPaymentStatus(str, enum.Enum):
    PROPERTY_SEARCHED = "PROPERTY_SEARCHED"
    PROPERTY_FOUND = "PROPERTY_FOUND"
    ADDED_TO_CART = "ADDED_TO_CART"
    PAYMENT_INITIATED = "PAYMENT_INITIATED"
    PAYMENT_SUBMITTED = "PAYMENT_SUBMITTED"
    PENDING_TREASURY_VALIDATION = "PENDING_TREASURY_VALIDATION"
    PAYMENT_VERIFIED = "PAYMENT_VERIFIED"
    PAYMENT_REJECTED = "PAYMENT_REJECTED"
    CLARIFICATION_REQUESTED = "CLARIFICATION_REQUESTED"
    OR_GENERATED = "OR_GENERATED"
    COMPLETED = "COMPLETED"


class RPTReleaseMethod(str, enum.Enum):
    DOWNLOAD = "DOWNLOAD"
    EMAIL = "EMAIL"
    BRANCH_PICKUP = "BRANCH_PICKUP"
    COURIER = "COURIER"


class BranchOffice(Base):
    __tablename__ = "branch_offices"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(30), unique=True, nullable=False, index=True)
    code_enc = Column(Text, nullable=True)
    name = Column(String(120), unique=True, nullable=False)
    name_enc = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False, index=True)
    created_at = Column(TIMESTAMP, server_default=func.now(), nullable=False)


class RPTPropertyRecord(Base):
    __tablename__ = "rpt_property_records"

    id = Column(Integer, primary_key=True, index=True)
    branch_id = Column(Integer, ForeignKey("branch_offices.id"), nullable=False, index=True)
    tdn = Column(String(30), unique=True, nullable=False, index=True)
    taxpayer_name = Column(String(150), nullable=False)
    taxpayer_name_enc = Column(Text, nullable=True)
    taxpayer_name_hash = Column(String(64), nullable=True, index=True)
    property_address = Column(String(255), nullable=False)
    property_address_enc = Column(Text, nullable=True)
    property_address_hash = Column(String(64), nullable=True)
    fair_market_value = Column(Numeric(12, 2), nullable=False)
    assessment_level = Column(Numeric(5, 2), nullable=False)
    tax_year = Column(Integer, nullable=False, default=2026)
    due_months = Column(Integer, nullable=False, default=0)
    discount_rate = Column(Numeric(5, 4), nullable=False, default=0)
    is_active = Column(Boolean, default=True, nullable=False, index=True)
    created_at = Column(TIMESTAMP, server_default=func.now(), nullable=False)


class RPTSearchLog(Base):
    __tablename__ = "rpt_search_logs"

    id = Column(Integer, primary_key=True, index=True)
    taxpayer_id = Column(Integer, ForeignKey("taxpayers.id"), nullable=False, index=True)
    branch_id = Column(Integer, ForeignKey("branch_offices.id"), nullable=False, index=True)
    searched_tdn = Column(String(30), nullable=False)
    searched_tdn_enc = Column(Text, nullable=True)
    searched_tdn_hash = Column(String(64), nullable=True, index=True)
    was_found = Column(Boolean, default=False, nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now(), nullable=False, index=True)


class RPTPaymentTransaction(Base):
    __tablename__ = "rpt_payment_transactions"

    id = Column(Integer, primary_key=True, index=True)
    wards_transaction_no = Column(String(60), unique=True, nullable=False, index=True)
    taxpayer_id = Column(Integer, ForeignKey("taxpayers.id"), nullable=False, index=True)
    branch_id = Column(Integer, ForeignKey("branch_offices.id"), nullable=False, index=True)
    status = Column(Enum(RPTPaymentStatus), nullable=False, default=RPTPaymentStatus.PAYMENT_INITIATED, index=True)
    payment_method = Column(String(40), nullable=False)
    total_amount = Column(Numeric(12, 2), nullable=False)
    currency = Column(String(10), nullable=False, default="PHP")
    paymongo_checkout_session_id = Column(String(120), nullable=True, index=True)
    paymongo_payment_intent_id = Column(String(120), nullable=True, index=True)
    paymongo_payment_id = Column(String(120), nullable=True, index=True)
    paymongo_reference_id = Column(String(120), nullable=True, index=True)
    paymongo_reference_id_enc = Column(Text, nullable=True)
    paymongo_reference_id_hash = Column(String(64), nullable=True, index=True)
    paymongo_checkout_url = Column(Text, nullable=True)
    paymongo_checkout_url_enc = Column(Text, nullable=True)
    paymongo_checkout_url_hash = Column(String(64), nullable=True)
    payment_timestamp = Column(TIMESTAMP, nullable=True)
    proof_reference = Column(String(150), nullable=True)
    proof_reference_enc = Column(Text, nullable=True)
    proof_reference_hash = Column(String(64), nullable=True)
    treasury_remarks = Column(Text, nullable=True)
    treasury_remarks_enc = Column(Text, nullable=True)
    treasury_remarks_hash = Column(String(64), nullable=True)
    clarification_message = Column(Text, nullable=True)
    clarification_message_enc = Column(Text, nullable=True)
    clarification_message_hash = Column(String(64), nullable=True)
    official_receipt_number = Column(String(80), nullable=True, unique=True, index=True)
    official_receipt_pdf_path = Column(String(255), nullable=True)
    official_receipt_pdf_path_enc = Column(Text, nullable=True)
    official_receipt_pdf_path_hash = Column(String(64), nullable=True)
    official_receipt_qr_code = Column(String(120), nullable=True)
    release_method = Column(Enum(RPTReleaseMethod), nullable=True)
    release_email = Column(String(255), nullable=True)
    release_email_enc = Column(Text, nullable=True)
    release_email_hash = Column(String(64), nullable=True, index=True)
    courier_name = Column(String(120), nullable=True)
    courier_name_enc = Column(Text, nullable=True)
    courier_name_hash = Column(String(64), nullable=True)
    courier_tracking_number = Column(String(120), nullable=True)
    courier_tracking_number_enc = Column(Text, nullable=True)
    courier_tracking_number_hash = Column(String(64), nullable=True)
    courier_rider_details = Column(Text, nullable=True)
    courier_rider_details_enc = Column(Text, nullable=True)
    courier_rider_details_hash = Column(String(64), nullable=True)
    completed_at = Column(TIMESTAMP, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now(), nullable=False)


class RPTPaymentItem(Base):
    __tablename__ = "rpt_payment_items"

    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(Integer, ForeignKey("rpt_payment_transactions.id"), nullable=False, index=True)
    property_record_id = Column(Integer, ForeignKey("rpt_property_records.id"), nullable=False, index=True)
    tdn = Column(String(30), nullable=False, index=True)
    taxpayer_name = Column(String(150), nullable=False)
    taxpayer_name_enc = Column(Text, nullable=True)
    taxpayer_name_hash = Column(String(64), nullable=True, index=True)
    property_address = Column(String(255), nullable=False)
    property_address_enc = Column(Text, nullable=True)
    property_address_hash = Column(String(64), nullable=True)
    fair_market_value = Column(Numeric(12, 2), nullable=False)
    assessment_level = Column(Numeric(5, 2), nullable=False)
    assessed_value = Column(Numeric(12, 2), nullable=False)
    basic_tax_due = Column(Numeric(12, 2), nullable=False)
    sef_tax = Column(Numeric(12, 2), nullable=False)
    penalties = Column(Numeric(12, 2), nullable=False)
    discounts = Column(Numeric(12, 2), nullable=False)
    total_amount = Column(Numeric(12, 2), nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now(), nullable=False)


class RPTPaymentProof(Base):
    __tablename__ = "rpt_payment_proofs"

    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(Integer, ForeignKey("rpt_payment_transactions.id"), nullable=False, index=True)
    file_path = Column(String(255), nullable=False)
    file_path_enc = Column(Text, nullable=True)
    file_path_hash = Column(String(64), nullable=True)
    original_filename = Column(String(255), nullable=False)
    original_filename_enc = Column(Text, nullable=True)
    original_filename_hash = Column(String(64), nullable=True)
    uploaded_at = Column(TIMESTAMP, server_default=func.now(), nullable=False)


class RPTPaymentLog(Base):
    __tablename__ = "rpt_payment_logs"

    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(Integer, ForeignKey("rpt_payment_transactions.id"), nullable=False, index=True)
    status = Column(Enum(RPTPaymentStatus), nullable=False, index=True)
    message = Column(Text, nullable=False)
    message_enc = Column(Text, nullable=True)
    message_hash = Column(String(64), nullable=True)
    actor = Column(String(120), nullable=False)
    actor_enc = Column(Text, nullable=True)
    actor_hash = Column(String(64), nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now(), nullable=False, index=True)
