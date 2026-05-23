from sqlalchemy import inspect, text

from core.security_crypto import decrypt_optional_value, encrypt_optional_value
from core.security_hash import hash_optional_value, hash_record_parts
from core.security_phase2 import (
    build_redacted_amount,
    build_redacted_email,
    build_redacted_text,
    phase2_redaction_enabled,
)
from database.models import Receipt, Taxpayer


RECEIPT_HASH_COLUMNS = {
    "taxpayer_name_enc": "TEXT NULL",
    "taxpayer_name_hash": "VARCHAR(64) NULL",
    "transaction_date_enc": "TEXT NULL",
    "transaction_date_hash": "VARCHAR(64) NULL",
    "tax_declaration_no_enc": "TEXT NULL",
    "tax_declaration_no_hash": "VARCHAR(64) NULL",
    "nature_of_collection_enc": "TEXT NULL",
    "nature_of_collection_hash": "VARCHAR(64) NULL",
    "amount_paid_enc": "TEXT NULL",
    "amount_paid_hash": "VARCHAR(64) NULL",
}

ANNOUNCEMENT_HASH_COLUMNS = {
    "title_enc": "TEXT NULL",
    "title_hash": "VARCHAR(64) NULL",
    "content_enc": "LONGTEXT NULL",
    "content_hash": "VARCHAR(64) NULL",
    "created_by_enc": "TEXT NULL",
    "created_by_hash": "VARCHAR(64) NULL",
    "integrity_hash": "VARCHAR(64) NULL",
}

BRANCH_OFFICE_HASH_COLUMNS = {
    "code_enc": "TEXT NULL",
    "code_hash": "VARCHAR(64) NULL",
    "name_enc": "TEXT NULL",
    "name_hash": "VARCHAR(64) NULL",
    "integrity_hash": "VARCHAR(64) NULL",
}

BRANCH_STAFF_HASH_COLUMNS = {
    "username_enc": "TEXT NULL",
    "username_hash": "VARCHAR(64) NULL",
    "email_enc": "TEXT NULL",
    "email_hash": "VARCHAR(64) NULL",
    "full_name_enc": "TEXT NULL",
    "full_name_hash": "VARCHAR(64) NULL",
    "integrity_hash": "VARCHAR(64) NULL",
}

BRANCH_STAFF_ACCOUNT_HASH_COLUMNS = {
    "username_enc": "TEXT NULL",
    "username_hash": "VARCHAR(64) NULL",
    "email_enc": "TEXT NULL",
    "email_hash": "VARCHAR(64) NULL",
    "window_label_enc": "TEXT NULL",
    "window_label_hash": "VARCHAR(64) NULL",
    "mfa_secret_enc": "TEXT NULL",
    "integrity_hash": "VARCHAR(64) NULL",
}

TAXPAYER_SECURITY_COLUMNS = {
    "full_name_enc": "TEXT NULL",
    "email_enc": "TEXT NULL",
    "email_hash": "VARCHAR(64) NULL",
}

TAXPAYER_OTP_SECURITY_COLUMNS = {
    "email_enc": "TEXT NULL",
    "email_hash": "VARCHAR(64) NULL",
}

BRANCH_APPOINTMENT_SCHEDULE_AUDIT_HASH_COLUMNS = {
    "integrity_hash": "VARCHAR(64) NULL",
}

RPT_PROPERTY_RECORD_SECURITY_COLUMNS = {
    "taxpayer_name_enc": "TEXT NULL",
    "taxpayer_name_hash": "VARCHAR(64) NULL",
    "property_address_enc": "TEXT NULL",
    "property_address_hash": "VARCHAR(64) NULL",
}

RPT_PAYMENT_ITEM_SECURITY_COLUMNS = {
    "taxpayer_name_enc": "TEXT NULL",
    "taxpayer_name_hash": "VARCHAR(64) NULL",
    "property_address_enc": "TEXT NULL",
    "property_address_hash": "VARCHAR(64) NULL",
}

RPT_PAYMENT_TRANSACTION_SECURITY_COLUMNS = {
    "paymongo_reference_id_enc": "TEXT NULL",
    "paymongo_reference_id_hash": "VARCHAR(64) NULL",
    "paymongo_checkout_url_enc": "LONGTEXT NULL",
    "paymongo_checkout_url_hash": "VARCHAR(64) NULL",
    "proof_reference_enc": "TEXT NULL",
    "proof_reference_hash": "VARCHAR(64) NULL",
    "treasury_remarks_enc": "LONGTEXT NULL",
    "treasury_remarks_hash": "VARCHAR(64) NULL",
    "clarification_message_enc": "LONGTEXT NULL",
    "clarification_message_hash": "VARCHAR(64) NULL",
    "release_email_enc": "TEXT NULL",
    "release_email_hash": "VARCHAR(64) NULL",
    "courier_name_enc": "TEXT NULL",
    "courier_name_hash": "VARCHAR(64) NULL",
    "courier_tracking_number_enc": "TEXT NULL",
    "courier_tracking_number_hash": "VARCHAR(64) NULL",
    "courier_rider_details_enc": "LONGTEXT NULL",
    "courier_rider_details_hash": "VARCHAR(64) NULL",
    "official_receipt_pdf_path_enc": "TEXT NULL",
    "official_receipt_pdf_path_hash": "VARCHAR(64) NULL",
}

RPT_SEARCH_LOG_SECURITY_COLUMNS = {
    "searched_tdn_enc": "TEXT NULL",
    "searched_tdn_hash": "VARCHAR(64) NULL",
}

RPT_PAYMENT_PROOF_SECURITY_COLUMNS = {
    "file_path_enc": "TEXT NULL",
    "file_path_hash": "VARCHAR(64) NULL",
    "original_filename_enc": "TEXT NULL",
    "original_filename_hash": "VARCHAR(64) NULL",
}

RPT_PAYMENT_LOG_SECURITY_COLUMNS = {
    "message_enc": "LONGTEXT NULL",
    "message_hash": "VARCHAR(64) NULL",
    "actor_enc": "TEXT NULL",
    "actor_hash": "VARCHAR(64) NULL",
}


def ensure_security_columns(engine) -> None:
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())

    if "receipts" in tables:
        _ensure_columns(engine, "receipts", RECEIPT_HASH_COLUMNS)
    if "announcements" in tables:
        _ensure_columns(engine, "announcements", ANNOUNCEMENT_HASH_COLUMNS)
    if "branch_offices" in tables:
        _ensure_columns(engine, "branch_offices", BRANCH_OFFICE_HASH_COLUMNS)
        _remove_branch_offices_write_lock(engine)
    if "branch_staff" in tables:
        _ensure_columns(engine, "branch_staff", BRANCH_STAFF_HASH_COLUMNS)
    if "branch_staff_accounts" in tables:
        _ensure_columns(engine, "branch_staff_accounts", BRANCH_STAFF_ACCOUNT_HASH_COLUMNS)
    if "taxpayers" in tables:
        _ensure_columns(engine, "taxpayers", TAXPAYER_SECURITY_COLUMNS)
    if "taxpayer_otps" in tables:
        _ensure_columns(engine, "taxpayer_otps", TAXPAYER_OTP_SECURITY_COLUMNS)
    if "rpt_property_records" in tables:
        _ensure_columns(engine, "rpt_property_records", RPT_PROPERTY_RECORD_SECURITY_COLUMNS)
    if "rpt_payment_items" in tables:
        _ensure_columns(engine, "rpt_payment_items", RPT_PAYMENT_ITEM_SECURITY_COLUMNS)
    if "rpt_payment_transactions" in tables:
        _ensure_columns(engine, "rpt_payment_transactions", RPT_PAYMENT_TRANSACTION_SECURITY_COLUMNS)
    if "rpt_search_logs" in tables:
        _ensure_columns(engine, "rpt_search_logs", RPT_SEARCH_LOG_SECURITY_COLUMNS)
    if "rpt_payment_proofs" in tables:
        _ensure_columns(engine, "rpt_payment_proofs", RPT_PAYMENT_PROOF_SECURITY_COLUMNS)
    if "rpt_payment_logs" in tables:
        _ensure_columns(engine, "rpt_payment_logs", RPT_PAYMENT_LOG_SECURITY_COLUMNS)
    if "branch_appointment_schedule_audit" in tables:
        _ensure_columns(
            engine,
            "branch_appointment_schedule_audit",
            BRANCH_APPOINTMENT_SCHEDULE_AUDIT_HASH_COLUMNS,
        )


def backfill_security_hashes(db) -> None:
    receipts = db.query(Receipt).all()
    has_updates = False

    for receipt in receipts:
        taxpayer_name = _resolve_secure_source(receipt.taxpayer_name_enc, receipt.taxpayer_name)
        transaction_date = _resolve_secure_source(receipt.transaction_date_enc, receipt.transaction_date)
        tax_declaration_no = _resolve_secure_source(receipt.tax_declaration_no_enc, receipt.tax_declaration_no)
        nature_of_collection = _resolve_secure_source(receipt.nature_of_collection_enc, receipt.nature_of_collection)
        amount_paid = _resolve_secure_source(receipt.amount_paid_enc, receipt.amount_paid)

        expected_taxpayer_name_enc = encrypt_optional_value(taxpayer_name)
        expected_taxpayer_name_hash = hash_optional_value(taxpayer_name)
        expected_transaction_date_enc = encrypt_optional_value(transaction_date)
        expected_transaction_date_hash = hash_optional_value(transaction_date)
        expected_tax_declaration_no_enc = encrypt_optional_value(tax_declaration_no)
        expected_tax_declaration_no_hash = hash_optional_value(tax_declaration_no)
        expected_nature_of_collection_enc = encrypt_optional_value(nature_of_collection)
        expected_nature_of_collection_hash = hash_optional_value(nature_of_collection)
        expected_amount_paid_enc = encrypt_optional_value(amount_paid)
        expected_amount_paid_hash = hash_optional_value(amount_paid)

        if receipt.taxpayer_name_enc != expected_taxpayer_name_enc:
            receipt.taxpayer_name_enc = expected_taxpayer_name_enc
            has_updates = True
        if receipt.taxpayer_name_hash != expected_taxpayer_name_hash:
            receipt.taxpayer_name_hash = expected_taxpayer_name_hash
            has_updates = True
        if receipt.transaction_date_enc != expected_transaction_date_enc:
            receipt.transaction_date_enc = expected_transaction_date_enc
            has_updates = True
        if receipt.transaction_date_hash != expected_transaction_date_hash:
            receipt.transaction_date_hash = expected_transaction_date_hash
            has_updates = True
        if receipt.tax_declaration_no_enc != expected_tax_declaration_no_enc:
            receipt.tax_declaration_no_enc = expected_tax_declaration_no_enc
            has_updates = True
        if receipt.tax_declaration_no_hash != expected_tax_declaration_no_hash:
            receipt.tax_declaration_no_hash = expected_tax_declaration_no_hash
            has_updates = True
        if receipt.nature_of_collection_enc != expected_nature_of_collection_enc:
            receipt.nature_of_collection_enc = expected_nature_of_collection_enc
            has_updates = True
        if receipt.nature_of_collection_hash != expected_nature_of_collection_hash:
            receipt.nature_of_collection_hash = expected_nature_of_collection_hash
            has_updates = True
        if receipt.amount_paid_enc != expected_amount_paid_enc:
            receipt.amount_paid_enc = expected_amount_paid_enc
            has_updates = True
        if receipt.amount_paid_hash != expected_amount_paid_hash:
            receipt.amount_paid_hash = expected_amount_paid_hash
            has_updates = True

    if has_updates:
        db.commit()

    _backfill_taxpayer_security(db)
    _backfill_taxpayer_otp_security(db)
    _backfill_announcement_hashes(db)
    _backfill_branch_office_hashes(db)
    _backfill_branch_staff_hashes(db)
    _backfill_branch_staff_account_hashes(db)
    _backfill_rpt_property_record_security(db)
    _backfill_rpt_payment_item_security(db)
    _backfill_rpt_payment_transaction_security(db)
    _backfill_rpt_search_log_security(db)
    _backfill_rpt_payment_proof_security(db)
    _backfill_rpt_payment_log_security(db)
    _backfill_generic_integrity_hash(
        db,
        table_name="branch_appointment_schedule_audit",
        key_column="id",
    )


def _backfill_taxpayer_security(db) -> None:
    taxpayers = db.query(Taxpayer).all()
    has_updates = False

    for taxpayer in taxpayers:
        full_name = _resolve_secure_source(taxpayer.full_name_enc, taxpayer.full_name)
        email = _resolve_secure_source(taxpayer.email_enc, taxpayer.email)

        expected_full_name_enc = encrypt_optional_value(full_name)
        expected_email_enc = encrypt_optional_value(email)
        expected_email_hash = hash_optional_value(email)

        if taxpayer.full_name_enc != expected_full_name_enc:
            taxpayer.full_name_enc = expected_full_name_enc
            has_updates = True
        if taxpayer.email_enc != expected_email_enc:
            taxpayer.email_enc = expected_email_enc
            has_updates = True
        if taxpayer.email_hash != expected_email_hash:
            taxpayer.email_hash = expected_email_hash
            has_updates = True

    if has_updates:
        db.commit()


def _backfill_taxpayer_otp_security(db) -> None:
    rows = db.execute(
        text(
            """
            SELECT id, email, email_enc, email_hash
            FROM taxpayer_otps
            """
        )
    ).mappings().all()

    has_updates = False

    for row in rows:
        email = _resolve_secure_source(row.get("email_enc"), row.get("email"))
        email_enc = encrypt_optional_value(email)
        email_hash = hash_optional_value(email)

        if row.get("email_enc") == email_enc and row.get("email_hash") == email_hash:
            continue

        db.execute(
            text(
                """
                UPDATE taxpayer_otps
                SET email_enc = :email_enc, email_hash = :email_hash
                WHERE id = :id
                """
            ),
            {
                "id": row["id"],
                "email_enc": email_enc,
                "email_hash": email_hash,
            },
        )
        has_updates = True

    if has_updates:
        db.commit()


def _backfill_announcement_hashes(db) -> None:
    rows = db.execute(
        text(
            """
            SELECT
                id,
                title,
                content,
                icon_type,
                icon_color,
                publish_date,
                is_active,
                created_by,
                branch_id,
                title_enc,
                title_hash,
                content_enc,
                content_hash,
                created_by_enc,
                created_by_hash,
                integrity_hash
            FROM announcements
            """
        )
    ).mappings().all()

    has_updates = False

    for row in rows:
        title = _resolve_secure_source(row.get("title_enc"), row.get("title"))
        content = _resolve_secure_source(row.get("content_enc"), row.get("content"))
        created_by = _resolve_secure_source(row.get("created_by_enc"), row.get("created_by"))

        title_enc = encrypt_optional_value(title)
        title_hash = hash_optional_value(title)
        content_enc = encrypt_optional_value(content)
        content_hash = hash_optional_value(content)
        created_by_enc = encrypt_optional_value(created_by)
        created_by_hash = hash_optional_value(created_by)
        integrity_hash = hash_record_parts(
            title,
            content,
            row.get("icon_type"),
            row.get("icon_color"),
            row.get("publish_date"),
            row.get("is_active"),
            created_by,
            row.get("branch_id"),
        )

        if (
            row.get("title_enc") == title_enc
            and row.get("content_enc") == content_enc
            and row.get("created_by_enc") == created_by_enc
            and row.get("title_hash") == title_hash
            and row.get("content_hash") == content_hash
            and row.get("created_by_hash") == created_by_hash
            and row.get("integrity_hash") == integrity_hash
        ):
            continue

        db.execute(
            text(
                """
                UPDATE announcements
                SET
                    title_enc = :title_enc,
                    title_hash = :title_hash,
                    content_enc = :content_enc,
                    content_hash = :content_hash,
                    created_by_enc = :created_by_enc,
                    created_by_hash = :created_by_hash,
                    integrity_hash = :integrity_hash
                WHERE id = :id
                """
            ),
            {
                "id": row["id"],
                "title_enc": title_enc,
                "title_hash": title_hash,
                "content_enc": content_enc,
                "content_hash": content_hash,
                "created_by_enc": created_by_enc,
                "created_by_hash": created_by_hash,
                "integrity_hash": integrity_hash,
            },
        )
        has_updates = True

    if has_updates:
        db.commit()


def _backfill_branch_office_hashes(db) -> None:
    rows = db.execute(
        text(
            """
            SELECT
                id,
                code,
                name,
                is_active,
                created_at,
                code_enc,
                code_hash,
                name_enc,
                name_hash,
                integrity_hash
            FROM branch_offices
            """
        )
    ).mappings().all()

    has_updates = False

    for row in rows:
        code = _resolve_secure_source(row.get("code_enc"), row.get("code"))
        name = _resolve_secure_source(row.get("name_enc"), row.get("name"))

        code_enc = encrypt_optional_value(code)
        code_hash = hash_optional_value(code)
        name_enc = encrypt_optional_value(name)
        name_hash = hash_optional_value(name)
        integrity_hash = hash_record_parts(
            code,
            name,
            row.get("is_active"),
            row.get("created_at"),
        )

        if (
            row.get("code_enc") == code_enc
            and row.get("name_enc") == name_enc
            and row.get("code_hash") == code_hash
            and row.get("name_hash") == name_hash
            and row.get("integrity_hash") == integrity_hash
        ):
            continue

        db.execute(
            text(
                """
                UPDATE branch_offices
                SET
                    code_enc = :code_enc,
                    code_hash = :code_hash,
                    name_enc = :name_enc,
                    name_hash = :name_hash,
                    integrity_hash = :integrity_hash
                WHERE id = :id
                """
            ),
            {
                "id": row["id"],
                "code_enc": code_enc,
                "code_hash": code_hash,
                "name_enc": name_enc,
                "name_hash": name_hash,
                "integrity_hash": integrity_hash,
            },
        )
        has_updates = True

    if has_updates:
        db.commit()


def _backfill_branch_staff_hashes(db) -> None:
    rows = db.execute(
        text(
            """
            SELECT
                id,
                username,
                email,
                full_name,
                branch_id,
                role,
                is_verified,
                status,
                account_scope,
                service_window,
                username_enc,
                username_hash,
                email_enc,
                email_hash,
                full_name_enc,
                full_name_hash,
                integrity_hash
            FROM branch_staff
            """
        )
    ).mappings().all()

    has_updates = False

    for row in rows:
        username = _resolve_secure_source(row.get("username_enc"), row.get("username"))
        email = _resolve_secure_source(row.get("email_enc"), row.get("email"))
        full_name = _resolve_secure_source(row.get("full_name_enc"), row.get("full_name"))

        username_enc = encrypt_optional_value(username)
        username_hash = hash_optional_value(username)
        email_enc = encrypt_optional_value(email)
        email_hash = hash_optional_value(email)
        full_name_enc = encrypt_optional_value(full_name)
        full_name_hash = hash_optional_value(full_name)
        integrity_hash = hash_record_parts(
            username,
            email,
            full_name,
            row.get("branch_id"),
            row.get("role"),
            row.get("is_verified"),
            row.get("status"),
            row.get("account_scope"),
            row.get("service_window"),
        )

        if (
            row.get("username_enc") == username_enc
            and row.get("email_enc") == email_enc
            and row.get("full_name_enc") == full_name_enc
            and row.get("username_hash") == username_hash
            and row.get("email_hash") == email_hash
            and row.get("full_name_hash") == full_name_hash
            and row.get("integrity_hash") == integrity_hash
        ):
            continue

        db.execute(
            text(
                """
                UPDATE branch_staff
                SET
                    username_enc = :username_enc,
                    username_hash = :username_hash,
                    email_enc = :email_enc,
                    email_hash = :email_hash,
                    full_name_enc = :full_name_enc,
                    full_name_hash = :full_name_hash,
                    integrity_hash = :integrity_hash
                WHERE id = :id
                """
            ),
            {
                "id": row["id"],
                "username_enc": username_enc,
                "username_hash": username_hash,
                "email_enc": email_enc,
                "email_hash": email_hash,
                "full_name_enc": full_name_enc,
                "full_name_hash": full_name_hash,
                "integrity_hash": integrity_hash,
            },
        )
        has_updates = True

    if has_updates:
        db.commit()


def _backfill_branch_staff_account_hashes(db) -> None:
    rows = db.execute(
        text(
            """
            SELECT
                id,
                window_code,
                window_label,
                service_id,
                email,
                username,
                mfa_secret,
                mfa_enabled,
                is_active,
                username_enc,
                username_hash,
                email_enc,
                email_hash,
                window_label_enc,
                window_label_hash,
                mfa_secret_enc,
                integrity_hash
            FROM branch_staff_accounts
            """
        )
    ).mappings().all()

    has_updates = False

    for row in rows:
        username = _resolve_secure_source(row.get("username_enc"), row.get("username"))
        email = _resolve_secure_source(row.get("email_enc"), row.get("email"))
        window_label = _resolve_secure_source(row.get("window_label_enc"), row.get("window_label"))
        mfa_secret = _resolve_secure_source(row.get("mfa_secret_enc"), row.get("mfa_secret"))

        username_enc = encrypt_optional_value(username)
        username_hash = hash_optional_value(username)
        email_enc = encrypt_optional_value(email)
        email_hash = hash_optional_value(email)
        window_label_enc = encrypt_optional_value(window_label)
        window_label_hash = hash_optional_value(window_label)
        mfa_secret_enc = encrypt_optional_value(mfa_secret)
        integrity_hash = hash_record_parts(
            row.get("window_code"),
            window_label,
            row.get("service_id"),
            email,
            username,
            row.get("mfa_enabled"),
            row.get("is_active"),
        )

        if (
            row.get("username_enc") == username_enc
            and row.get("email_enc") == email_enc
            and row.get("window_label_enc") == window_label_enc
            and row.get("mfa_secret_enc") == mfa_secret_enc
            and row.get("username_hash") == username_hash
            and row.get("email_hash") == email_hash
            and row.get("window_label_hash") == window_label_hash
            and row.get("integrity_hash") == integrity_hash
        ):
            continue

        db.execute(
            text(
                """
                UPDATE branch_staff_accounts
                SET
                    username_enc = :username_enc,
                    username_hash = :username_hash,
                    email_enc = :email_enc,
                    email_hash = :email_hash,
                    window_label_enc = :window_label_enc,
                    window_label_hash = :window_label_hash,
                    mfa_secret_enc = :mfa_secret_enc,
                    integrity_hash = :integrity_hash
                WHERE id = :id
                """
            ),
            {
                "id": row["id"],
                "username_enc": username_enc,
                "username_hash": username_hash,
                "email_enc": email_enc,
                "email_hash": email_hash,
                "window_label_enc": window_label_enc,
                "window_label_hash": window_label_hash,
                "mfa_secret_enc": mfa_secret_enc,
                "integrity_hash": integrity_hash,
            },
        )
        has_updates = True

    if has_updates:
        db.commit()


def _backfill_rpt_property_record_security(db) -> None:
    rows = db.execute(
        text(
            """
            SELECT
                id,
                taxpayer_name,
                taxpayer_name_enc,
                taxpayer_name_hash,
                property_address,
                property_address_enc,
                property_address_hash
            FROM rpt_property_records
            """
        )
    ).mappings().all()

    has_updates = False

    for row in rows:
        taxpayer_name = _resolve_secure_source(row.get("taxpayer_name_enc"), row.get("taxpayer_name"))
        property_address = _resolve_secure_source(row.get("property_address_enc"), row.get("property_address"))

        taxpayer_name_enc = encrypt_optional_value(taxpayer_name)
        taxpayer_name_hash = hash_optional_value(taxpayer_name)
        property_address_enc = encrypt_optional_value(property_address)
        property_address_hash = hash_optional_value(property_address)

        if (
            row.get("taxpayer_name_enc") == taxpayer_name_enc
            and row.get("taxpayer_name_hash") == taxpayer_name_hash
            and row.get("property_address_enc") == property_address_enc
            and row.get("property_address_hash") == property_address_hash
        ):
            continue

        db.execute(
            text(
                """
                UPDATE rpt_property_records
                SET
                    taxpayer_name_enc = :taxpayer_name_enc,
                    taxpayer_name_hash = :taxpayer_name_hash,
                    property_address_enc = :property_address_enc,
                    property_address_hash = :property_address_hash
                WHERE id = :id
                """
            ),
            {
                "id": row["id"],
                "taxpayer_name_enc": taxpayer_name_enc,
                "taxpayer_name_hash": taxpayer_name_hash,
                "property_address_enc": property_address_enc,
                "property_address_hash": property_address_hash,
            },
        )
        has_updates = True

    if has_updates:
        db.commit()


def _backfill_rpt_payment_item_security(db) -> None:
    rows = db.execute(
        text(
            """
            SELECT
                id,
                taxpayer_name,
                taxpayer_name_enc,
                taxpayer_name_hash,
                property_address,
                property_address_enc,
                property_address_hash
            FROM rpt_payment_items
            """
        )
    ).mappings().all()

    has_updates = False

    for row in rows:
        taxpayer_name = _resolve_secure_source(row.get("taxpayer_name_enc"), row.get("taxpayer_name"))
        property_address = _resolve_secure_source(row.get("property_address_enc"), row.get("property_address"))

        taxpayer_name_enc = encrypt_optional_value(taxpayer_name)
        taxpayer_name_hash = hash_optional_value(taxpayer_name)
        property_address_enc = encrypt_optional_value(property_address)
        property_address_hash = hash_optional_value(property_address)

        if (
            row.get("taxpayer_name_enc") == taxpayer_name_enc
            and row.get("taxpayer_name_hash") == taxpayer_name_hash
            and row.get("property_address_enc") == property_address_enc
            and row.get("property_address_hash") == property_address_hash
        ):
            continue

        db.execute(
            text(
                """
                UPDATE rpt_payment_items
                SET
                    taxpayer_name_enc = :taxpayer_name_enc,
                    taxpayer_name_hash = :taxpayer_name_hash,
                    property_address_enc = :property_address_enc,
                    property_address_hash = :property_address_hash
                WHERE id = :id
                """
            ),
            {
                "id": row["id"],
                "taxpayer_name_enc": taxpayer_name_enc,
                "taxpayer_name_hash": taxpayer_name_hash,
                "property_address_enc": property_address_enc,
                "property_address_hash": property_address_hash,
            },
        )
        has_updates = True

    if has_updates:
        db.commit()


def _backfill_rpt_payment_transaction_security(db) -> None:
    rows = db.execute(
        text(
            """
            SELECT
                id,
                paymongo_reference_id,
                paymongo_reference_id_enc,
                paymongo_reference_id_hash,
                paymongo_checkout_url,
                paymongo_checkout_url_enc,
                paymongo_checkout_url_hash,
                proof_reference,
                proof_reference_enc,
                proof_reference_hash,
                treasury_remarks,
                treasury_remarks_enc,
                treasury_remarks_hash,
                clarification_message,
                clarification_message_enc,
                clarification_message_hash,
                release_email,
                release_email_enc,
                release_email_hash,
                courier_name,
                courier_name_enc,
                courier_name_hash,
                courier_tracking_number,
                courier_tracking_number_enc,
                courier_tracking_number_hash,
                courier_rider_details,
                courier_rider_details_enc,
                courier_rider_details_hash,
                official_receipt_pdf_path,
                official_receipt_pdf_path_enc,
                official_receipt_pdf_path_hash
            FROM rpt_payment_transactions
            """
        )
    ).mappings().all()

    has_updates = False

    for row in rows:
        field_map = {
            "paymongo_reference_id": _resolve_secure_source(row.get("paymongo_reference_id_enc"), row.get("paymongo_reference_id")),
            "paymongo_checkout_url": _resolve_secure_source(row.get("paymongo_checkout_url_enc"), row.get("paymongo_checkout_url")),
            "proof_reference": _resolve_secure_source(row.get("proof_reference_enc"), row.get("proof_reference")),
            "treasury_remarks": _resolve_secure_source(row.get("treasury_remarks_enc"), row.get("treasury_remarks")),
            "clarification_message": _resolve_secure_source(row.get("clarification_message_enc"), row.get("clarification_message")),
            "release_email": _resolve_secure_source(row.get("release_email_enc"), row.get("release_email")),
            "courier_name": _resolve_secure_source(row.get("courier_name_enc"), row.get("courier_name")),
            "courier_tracking_number": _resolve_secure_source(row.get("courier_tracking_number_enc"), row.get("courier_tracking_number")),
            "courier_rider_details": _resolve_secure_source(row.get("courier_rider_details_enc"), row.get("courier_rider_details")),
            "official_receipt_pdf_path": _resolve_secure_source(row.get("official_receipt_pdf_path_enc"), row.get("official_receipt_pdf_path")),
        }

        expected = {}
        unchanged = True
        for field_name, source_value in field_map.items():
            enc_key = f"{field_name}_enc"
            hash_key = f"{field_name}_hash"
            expected[enc_key] = encrypt_optional_value(source_value)
            expected[hash_key] = hash_optional_value(source_value)
            if row.get(enc_key) != expected[enc_key] or row.get(hash_key) != expected[hash_key]:
                unchanged = False

        if unchanged:
            continue

        db.execute(
            text(
                """
                UPDATE rpt_payment_transactions
                SET
                    paymongo_reference_id_enc = :paymongo_reference_id_enc,
                    paymongo_reference_id_hash = :paymongo_reference_id_hash,
                    paymongo_checkout_url_enc = :paymongo_checkout_url_enc,
                    paymongo_checkout_url_hash = :paymongo_checkout_url_hash,
                    proof_reference_enc = :proof_reference_enc,
                    proof_reference_hash = :proof_reference_hash,
                    treasury_remarks_enc = :treasury_remarks_enc,
                    treasury_remarks_hash = :treasury_remarks_hash,
                    clarification_message_enc = :clarification_message_enc,
                    clarification_message_hash = :clarification_message_hash,
                    release_email_enc = :release_email_enc,
                    release_email_hash = :release_email_hash,
                    courier_name_enc = :courier_name_enc,
                    courier_name_hash = :courier_name_hash,
                    courier_tracking_number_enc = :courier_tracking_number_enc,
                    courier_tracking_number_hash = :courier_tracking_number_hash,
                    courier_rider_details_enc = :courier_rider_details_enc,
                    courier_rider_details_hash = :courier_rider_details_hash,
                    official_receipt_pdf_path_enc = :official_receipt_pdf_path_enc,
                    official_receipt_pdf_path_hash = :official_receipt_pdf_path_hash
                WHERE id = :id
                """
            ),
            {"id": row["id"], **expected},
        )
        has_updates = True

    if has_updates:
        db.commit()


def _backfill_rpt_search_log_security(db) -> None:
    rows = db.execute(
        text(
            """
            SELECT id, searched_tdn, searched_tdn_enc, searched_tdn_hash
            FROM rpt_search_logs
            """
        )
    ).mappings().all()

    has_updates = False

    for row in rows:
        searched_tdn = _resolve_secure_source(row.get("searched_tdn_enc"), row.get("searched_tdn"))
        searched_tdn_enc = encrypt_optional_value(searched_tdn)
        searched_tdn_hash = hash_optional_value(searched_tdn)

        if row.get("searched_tdn_enc") == searched_tdn_enc and row.get("searched_tdn_hash") == searched_tdn_hash:
            continue

        db.execute(
            text(
                """
                UPDATE rpt_search_logs
                SET searched_tdn_enc = :searched_tdn_enc, searched_tdn_hash = :searched_tdn_hash
                WHERE id = :id
                """
            ),
            {
                "id": row["id"],
                "searched_tdn_enc": searched_tdn_enc,
                "searched_tdn_hash": searched_tdn_hash,
            },
        )
        has_updates = True

    if has_updates:
        db.commit()


def _backfill_rpt_payment_proof_security(db) -> None:
    rows = db.execute(
        text(
            """
            SELECT id, file_path, file_path_enc, file_path_hash, original_filename, original_filename_enc, original_filename_hash
            FROM rpt_payment_proofs
            """
        )
    ).mappings().all()

    has_updates = False

    for row in rows:
        file_path = _resolve_secure_source(row.get("file_path_enc"), row.get("file_path"))
        original_filename = _resolve_secure_source(row.get("original_filename_enc"), row.get("original_filename"))
        file_path_enc = encrypt_optional_value(file_path)
        file_path_hash = hash_optional_value(file_path)
        original_filename_enc = encrypt_optional_value(original_filename)
        original_filename_hash = hash_optional_value(original_filename)

        if (
            row.get("file_path_enc") == file_path_enc
            and row.get("file_path_hash") == file_path_hash
            and row.get("original_filename_enc") == original_filename_enc
            and row.get("original_filename_hash") == original_filename_hash
        ):
            continue

        db.execute(
            text(
                """
                UPDATE rpt_payment_proofs
                SET
                    file_path_enc = :file_path_enc,
                    file_path_hash = :file_path_hash,
                    original_filename_enc = :original_filename_enc,
                    original_filename_hash = :original_filename_hash
                WHERE id = :id
                """
            ),
            {
                "id": row["id"],
                "file_path_enc": file_path_enc,
                "file_path_hash": file_path_hash,
                "original_filename_enc": original_filename_enc,
                "original_filename_hash": original_filename_hash,
            },
        )
        has_updates = True

    if has_updates:
        db.commit()


def _backfill_rpt_payment_log_security(db) -> None:
    rows = db.execute(
        text(
            """
            SELECT id, message, message_enc, message_hash, actor, actor_enc, actor_hash
            FROM rpt_payment_logs
            """
        )
    ).mappings().all()

    has_updates = False

    for row in rows:
        message = _resolve_secure_source(row.get("message_enc"), row.get("message"))
        actor = _resolve_secure_source(row.get("actor_enc"), row.get("actor"))
        message_enc = encrypt_optional_value(message)
        message_hash = hash_optional_value(message)
        actor_enc = encrypt_optional_value(actor)
        actor_hash = hash_optional_value(actor)

        if (
            row.get("message_enc") == message_enc
            and row.get("message_hash") == message_hash
            and row.get("actor_enc") == actor_enc
            and row.get("actor_hash") == actor_hash
        ):
            continue

        db.execute(
            text(
                """
                UPDATE rpt_payment_logs
                SET
                    message_enc = :message_enc,
                    message_hash = :message_hash,
                    actor_enc = :actor_enc,
                    actor_hash = :actor_hash
                WHERE id = :id
                """
            ),
            {
                "id": row["id"],
                "message_enc": message_enc,
                "message_hash": message_hash,
                "actor_enc": actor_enc,
                "actor_hash": actor_hash,
            },
        )
        has_updates = True

    if has_updates:
        db.commit()


def _backfill_generic_integrity_hash(db, table_name: str, key_column: str) -> None:
    inspector = inspect(db.bind)
    tables = set(inspector.get_table_names())
    if table_name not in tables:
        return

    columns = [column["name"] for column in inspector.get_columns(table_name)]
    if key_column not in columns or "integrity_hash" not in columns:
        return

    selected_columns = [column for column in columns if column != "integrity_hash"]
    if not selected_columns:
        return

    select_sql = ", ".join(selected_columns + ["integrity_hash"])
    rows = db.execute(text(f"SELECT {select_sql} FROM {table_name}")).mappings().all()

    has_updates = False

    for row in rows:
        integrity_parts = [row.get(column) for column in selected_columns if column != key_column]
        integrity_hash = hash_record_parts(*integrity_parts)

        if row.get("integrity_hash") == integrity_hash:
            continue

        db.execute(
            text(
                f"""
                UPDATE {table_name}
                SET integrity_hash = :integrity_hash
                WHERE {key_column} = :row_id
                """
            ),
            {
                "row_id": row[key_column],
                "integrity_hash": integrity_hash,
            },
        )
        has_updates = True

    if has_updates:
        db.commit()


def _ensure_columns(engine, table_name: str, columns: dict[str, str]) -> None:
    inspector = inspect(engine)
    existing_columns = {
        column["name"]
        for column in inspector.get_columns(table_name)
    }

    missing_columns = {
        name: definition
        for name, definition in columns.items()
        if name not in existing_columns
    }

    if not missing_columns:
        return

    with engine.begin() as connection:
        for column_name, definition in missing_columns.items():
            connection.execute(
                text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")
            )


def _remove_branch_offices_write_lock(engine) -> None:
    update_trigger_name = "branch_offices_block_update"
    delete_trigger_name = "branch_offices_block_delete"

    with engine.begin() as connection:
        connection.exec_driver_sql(f"DROP TRIGGER IF EXISTS {update_trigger_name}")
        connection.exec_driver_sql(f"DROP TRIGGER IF EXISTS {delete_trigger_name}")


def apply_phase2_plaintext_redaction(db) -> None:
    if not phase2_redaction_enabled():
        return

    _redact_receipt_plaintext(db)
    _redact_announcement_plaintext(db)
    _redact_branch_office_plaintext(db)
    _redact_branch_staff_plaintext(db)
    _redact_branch_staff_account_plaintext(db)
    _redact_taxpayer_plaintext(db)
    _redact_rpt_property_record_plaintext(db)
    _redact_rpt_payment_item_plaintext(db)
    _redact_rpt_payment_transaction_plaintext(db)
    _redact_taxpayer_otp_plaintext(db)
    _redact_rpt_search_log_plaintext(db)
    _redact_rpt_payment_proof_plaintext(db)
    _redact_rpt_payment_log_plaintext(db)


def _resolve_secure_source(encrypted_value, plaintext_value):
    return decrypt_optional_value(encrypted_value) or plaintext_value


def _redact_receipt_plaintext(db) -> None:
    for receipt in db.query(Receipt).all():
        taxpayer_name = _resolve_secure_source(receipt.taxpayer_name_enc, receipt.taxpayer_name)
        transaction_date = _resolve_secure_source(receipt.transaction_date_enc, receipt.transaction_date)
        tax_declaration_no = _resolve_secure_source(receipt.tax_declaration_no_enc, receipt.tax_declaration_no)
        nature_of_collection = _resolve_secure_source(receipt.nature_of_collection_enc, receipt.nature_of_collection)
        amount_paid = _resolve_secure_source(receipt.amount_paid_enc, receipt.amount_paid)

        if receipt.taxpayer_name_enc and taxpayer_name:
            receipt.taxpayer_name = build_redacted_text("RECEIPTNAME", taxpayer_name, 150)
        if receipt.transaction_date_enc and transaction_date:
            receipt.transaction_date = build_redacted_text("RECEIPTDATE", transaction_date, 50)
        if receipt.tax_declaration_no_enc and tax_declaration_no:
            receipt.tax_declaration_no = build_redacted_text("RECEIPTTDN", tax_declaration_no, 100)
        if receipt.nature_of_collection_enc and nature_of_collection:
            receipt.nature_of_collection = build_redacted_text("RECEIPTNATURE", nature_of_collection, 150)
        if receipt.amount_paid_enc and amount_paid:
            receipt.amount_paid = build_redacted_amount()

    db.commit()


def _redact_announcement_plaintext(db) -> None:
    rows = db.execute(
        text(
            """
            SELECT id, title, title_enc, content, content_enc, created_by, created_by_enc
            FROM announcements
            """
        )
    ).mappings().all()

    for row in rows:
        title = _resolve_secure_source(row.get("title_enc"), row.get("title"))
        content = _resolve_secure_source(row.get("content_enc"), row.get("content"))
        created_by = _resolve_secure_source(row.get("created_by_enc"), row.get("created_by"))

        db.execute(
            text(
                """
                UPDATE announcements
                SET
                    title = :title,
                    content = :content,
                    created_by = :created_by
                WHERE id = :id
                """
            ),
            {
                "id": row["id"],
                "title": build_redacted_text("ANNOUNCEMENT", title, 200) if title else row.get("title"),
                "content": build_redacted_text("ANNOUNCEMENT_CONTENT", content, 65535) if content else row.get("content"),
                "created_by": build_redacted_text("ANNOUNCEMENT_AUTHOR", created_by, 255) if created_by else row.get("created_by"),
            },
        )

    db.commit()


def _redact_branch_office_plaintext(db) -> None:
    rows = db.execute(
        text(
            """
            SELECT id, code, code_enc, name, name_enc
            FROM branch_offices
            """
        )
    ).mappings().all()

    for row in rows:
        code = _resolve_secure_source(row.get("code_enc"), row.get("code"))
        name = _resolve_secure_source(row.get("name_enc"), row.get("name"))

        db.execute(
            text(
                """
                UPDATE branch_offices
                SET
                    code = :code,
                    name = :name
                WHERE id = :id
                """
            ),
            {
                "id": row["id"],
                "code": build_redacted_text("BRANCHCODE", code, 30),
                "name": build_redacted_text("BRANCHNAME", name, 120),
            },
        )

    db.commit()


def _redact_branch_staff_plaintext(db) -> None:
    rows = db.execute(
        text(
            """
            SELECT id, username, username_enc, email, email_enc, full_name, full_name_enc
            FROM branch_staff
            """
        )
    ).mappings().all()

    for row in rows:
        username = _resolve_secure_source(row.get("username_enc"), row.get("username"))
        email = _resolve_secure_source(row.get("email_enc"), row.get("email"))
        full_name = _resolve_secure_source(row.get("full_name_enc"), row.get("full_name"))

        db.execute(
            text(
                """
                UPDATE branch_staff
                SET
                    username = :username,
                    email = :email,
                    full_name = :full_name
                WHERE id = :id
                """
            ),
            {
                "id": row["id"],
                "username": build_redacted_text("STAFFUSER", username, 255),
                "email": build_redacted_email("staff", email, 255),
                "full_name": build_redacted_text("STAFFNAME", full_name, 255),
            },
        )

    db.commit()


def _redact_branch_staff_account_plaintext(db) -> None:
    rows = db.execute(
        text(
            """
            SELECT id, username, username_enc, email, email_enc, window_label, window_label_enc, mfa_secret, mfa_secret_enc
            FROM branch_staff_accounts
            """
        )
    ).mappings().all()

    for row in rows:
        username = _resolve_secure_source(row.get("username_enc"), row.get("username"))
        email = _resolve_secure_source(row.get("email_enc"), row.get("email"))
        window_label = _resolve_secure_source(row.get("window_label_enc"), row.get("window_label"))
        mfa_secret = _resolve_secure_source(row.get("mfa_secret_enc"), row.get("mfa_secret"))

        db.execute(
            text(
                """
                UPDATE branch_staff_accounts
                SET
                    username = :username,
                    email = :email,
                    window_label = :window_label,
                    mfa_secret = :mfa_secret
                WHERE id = :id
                """
            ),
            {
                "id": row["id"],
                "username": build_redacted_text("STAFFACCOUNT", username, 80),
                "email": build_redacted_email("branchstaff", email, 255),
                "window_label": build_redacted_text("WINDOWLABEL", window_label, 100),
                "mfa_secret": build_redacted_text("MFASECRET", mfa_secret, 64),
            },
        )

    db.commit()


def _redact_taxpayer_plaintext(db) -> None:
    for taxpayer in db.query(Taxpayer).all():
        full_name = _resolve_secure_source(taxpayer.full_name_enc, taxpayer.full_name)
        email = _resolve_secure_source(taxpayer.email_enc, taxpayer.email)

        if taxpayer.full_name_enc and full_name:
            taxpayer.full_name = build_redacted_text("TAXPAYER", full_name, 150)
        if taxpayer.email_enc and email:
            taxpayer.email = build_redacted_email("taxpayer", email, 255)

    db.commit()


def _redact_rpt_property_record_plaintext(db) -> None:
    rows = db.execute(
        text(
            """
            SELECT id, taxpayer_name, taxpayer_name_enc, property_address, property_address_enc
            FROM rpt_property_records
            """
        )
    ).mappings().all()

    for row in rows:
        taxpayer_name = _resolve_secure_source(row.get("taxpayer_name_enc"), row.get("taxpayer_name"))
        property_address = _resolve_secure_source(row.get("property_address_enc"), row.get("property_address"))
        db.execute(
            text(
                """
                UPDATE rpt_property_records
                SET
                    taxpayer_name = :taxpayer_name,
                    property_address = :property_address
                WHERE id = :id
                """
            ),
            {
                "id": row["id"],
                "taxpayer_name": build_redacted_text("RPTOWNER", taxpayer_name, 150) if taxpayer_name else row.get("taxpayer_name"),
                "property_address": build_redacted_text("RPTADDRESS", property_address, 255) if property_address else row.get("property_address"),
            },
        )

    db.commit()


def _redact_rpt_payment_item_plaintext(db) -> None:
    rows = db.execute(
        text(
            """
            SELECT id, taxpayer_name, taxpayer_name_enc, property_address, property_address_enc
            FROM rpt_payment_items
            """
        )
    ).mappings().all()

    for row in rows:
        taxpayer_name = _resolve_secure_source(row.get("taxpayer_name_enc"), row.get("taxpayer_name"))
        property_address = _resolve_secure_source(row.get("property_address_enc"), row.get("property_address"))
        db.execute(
            text(
                """
                UPDATE rpt_payment_items
                SET
                    taxpayer_name = :taxpayer_name,
                    property_address = :property_address
                WHERE id = :id
                """
            ),
            {
                "id": row["id"],
                "taxpayer_name": build_redacted_text("RPTITEMOWNER", taxpayer_name, 150) if taxpayer_name else row.get("taxpayer_name"),
                "property_address": build_redacted_text("RPTITEMADDR", property_address, 255) if property_address else row.get("property_address"),
            },
        )

    db.commit()


def _redact_rpt_payment_transaction_plaintext(db) -> None:
    rows = db.execute(
        text(
            """
            SELECT
                id,
                paymongo_reference_id,
                paymongo_reference_id_enc,
                paymongo_checkout_url,
                paymongo_checkout_url_enc,
                proof_reference,
                proof_reference_enc,
                treasury_remarks,
                treasury_remarks_enc,
                clarification_message,
                clarification_message_enc,
                release_email,
                release_email_enc,
                courier_name,
                courier_name_enc,
                courier_tracking_number,
                courier_tracking_number_enc,
                courier_rider_details,
                courier_rider_details_enc,
                official_receipt_pdf_path,
                official_receipt_pdf_path_enc
            FROM rpt_payment_transactions
            """
        )
    ).mappings().all()

    for row in rows:
        paymongo_reference_id = _resolve_secure_source(row.get("paymongo_reference_id_enc"), row.get("paymongo_reference_id"))
        paymongo_checkout_url = _resolve_secure_source(row.get("paymongo_checkout_url_enc"), row.get("paymongo_checkout_url"))
        proof_reference = _resolve_secure_source(row.get("proof_reference_enc"), row.get("proof_reference"))
        treasury_remarks = _resolve_secure_source(row.get("treasury_remarks_enc"), row.get("treasury_remarks"))
        clarification_message = _resolve_secure_source(row.get("clarification_message_enc"), row.get("clarification_message"))
        release_email = _resolve_secure_source(row.get("release_email_enc"), row.get("release_email"))
        courier_name = _resolve_secure_source(row.get("courier_name_enc"), row.get("courier_name"))
        courier_tracking_number = _resolve_secure_source(row.get("courier_tracking_number_enc"), row.get("courier_tracking_number"))
        courier_rider_details = _resolve_secure_source(row.get("courier_rider_details_enc"), row.get("courier_rider_details"))
        official_receipt_pdf_path = _resolve_secure_source(row.get("official_receipt_pdf_path_enc"), row.get("official_receipt_pdf_path"))

        db.execute(
            text(
                """
                UPDATE rpt_payment_transactions
                SET
                    paymongo_reference_id = :paymongo_reference_id,
                    paymongo_checkout_url = :paymongo_checkout_url,
                    proof_reference = :proof_reference,
                    treasury_remarks = :treasury_remarks,
                    clarification_message = :clarification_message,
                    release_email = :release_email,
                    courier_name = :courier_name,
                    courier_tracking_number = :courier_tracking_number,
                    courier_rider_details = :courier_rider_details,
                    official_receipt_pdf_path = :official_receipt_pdf_path
                WHERE id = :id
                """
            ),
            {
                "id": row["id"],
                "paymongo_reference_id": build_redacted_text("PMREF", paymongo_reference_id, 120) if paymongo_reference_id else row.get("paymongo_reference_id"),
                "paymongo_checkout_url": build_redacted_text("CHECKOUTURL", paymongo_checkout_url, 65535) if paymongo_checkout_url else row.get("paymongo_checkout_url"),
                "proof_reference": build_redacted_text("PROOFREF", proof_reference, 150) if proof_reference else row.get("proof_reference"),
                "treasury_remarks": build_redacted_text("TREASURY", treasury_remarks, 65535) if treasury_remarks else row.get("treasury_remarks"),
                "clarification_message": build_redacted_text("CLARIFY", clarification_message, 65535) if clarification_message else row.get("clarification_message"),
                "release_email": build_redacted_email("release", release_email, 255) if release_email else row.get("release_email"),
                "courier_name": build_redacted_text("COURIER", courier_name, 120) if courier_name else row.get("courier_name"),
                "courier_tracking_number": build_redacted_text("TRACKING", courier_tracking_number, 120) if courier_tracking_number else row.get("courier_tracking_number"),
                "courier_rider_details": build_redacted_text("RIDER", courier_rider_details, 65535) if courier_rider_details else row.get("courier_rider_details"),
                "official_receipt_pdf_path": build_redacted_text("ORPDF", official_receipt_pdf_path, 255) if official_receipt_pdf_path else row.get("official_receipt_pdf_path"),
            },
        )

    db.commit()


def _redact_taxpayer_otp_plaintext(db) -> None:
    rows = db.execute(text("SELECT id, email, email_enc FROM taxpayer_otps")).mappings().all()
    for row in rows:
        email = _resolve_secure_source(row.get("email_enc"), row.get("email"))
        db.execute(
            text("UPDATE taxpayer_otps SET email = :email WHERE id = :id"),
            {
                "id": row["id"],
                "email": build_redacted_email("otp", email, 255) if email else row.get("email"),
            },
        )
    db.commit()


def _redact_rpt_search_log_plaintext(db) -> None:
    rows = db.execute(text("SELECT id, searched_tdn, searched_tdn_enc FROM rpt_search_logs")).mappings().all()
    for row in rows:
        searched_tdn = _resolve_secure_source(row.get("searched_tdn_enc"), row.get("searched_tdn"))
        db.execute(
            text("UPDATE rpt_search_logs SET searched_tdn = :searched_tdn WHERE id = :id"),
            {
                "id": row["id"],
                "searched_tdn": build_redacted_text("SEARCHTDN", searched_tdn, 30) if searched_tdn else row.get("searched_tdn"),
            },
        )
    db.commit()


def _redact_rpt_payment_proof_plaintext(db) -> None:
    rows = db.execute(
        text("SELECT id, file_path, file_path_enc, original_filename, original_filename_enc FROM rpt_payment_proofs")
    ).mappings().all()
    for row in rows:
        file_path = _resolve_secure_source(row.get("file_path_enc"), row.get("file_path"))
        original_filename = _resolve_secure_source(row.get("original_filename_enc"), row.get("original_filename"))
        db.execute(
            text(
                """
                UPDATE rpt_payment_proofs
                SET file_path = :file_path, original_filename = :original_filename
                WHERE id = :id
                """
            ),
            {
                "id": row["id"],
                "file_path": build_redacted_text("PROOFPATH", file_path, 255) if file_path else row.get("file_path"),
                "original_filename": build_redacted_text("PROOFFILE", original_filename, 255) if original_filename else row.get("original_filename"),
            },
        )
    db.commit()


def _redact_rpt_payment_log_plaintext(db) -> None:
    rows = db.execute(text("SELECT id, message, message_enc, actor, actor_enc FROM rpt_payment_logs")).mappings().all()
    for row in rows:
        message = _resolve_secure_source(row.get("message_enc"), row.get("message"))
        actor = _resolve_secure_source(row.get("actor_enc"), row.get("actor"))
        db.execute(
            text("UPDATE rpt_payment_logs SET message = :message, actor = :actor WHERE id = :id"),
            {
                "id": row["id"],
                "message": build_redacted_text("PAYLOG", message, 65535) if message else row.get("message"),
                "actor": build_redacted_text("ACTOR", actor, 120) if actor else row.get("actor"),
            },
        )
    db.commit()
