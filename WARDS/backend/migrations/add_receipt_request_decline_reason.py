#!/usr/bin/env python3
"""Migration: Add decline_reason column to receipt request tables."""

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text
from database.models import engine, SQLALCHEMY_DATABASE_URL


def add_decline_reason_columns():
    with engine.connect() as connection:
        # Add to receipt_requests table
        result = connection.execute(text(
            "SELECT COUNT(*) FROM information_schema.columns "
            "WHERE table_schema = DATABASE() AND table_name = 'receipt_requests' AND column_name = 'decline_reason'"
        ))
        if result.scalar():
            print("Column decline_reason already exists in receipt_requests table.")
        else:
            connection.execute(text(
                "ALTER TABLE receipt_requests ADD COLUMN decline_reason TEXT NULL AFTER release_copy_filename_enc"
            ))
            connection.execute(text(
                "ALTER TABLE receipt_requests ADD COLUMN decline_reason_hash VARCHAR(255) NULL AFTER decline_reason"
            ))
            connection.execute(text(
                "ALTER TABLE receipt_requests ADD COLUMN decline_reason_enc TEXT NULL AFTER decline_reason_hash"
            ))
            connection.commit()
            print("Columns decline_reason, decline_reason_hash, decline_reason_enc added to receipt_requests table.")

        # Add to receipt_request_history table
        result = connection.execute(text(
            "SELECT COUNT(*) FROM information_schema.columns "
            "WHERE table_schema = DATABASE() AND table_name = 'receipt_request_history' AND column_name = 'decline_reason'"
        ))
        if result.scalar():
            print("Column decline_reason already exists in receipt_request_history table.")
        else:
            connection.execute(text(
                "ALTER TABLE receipt_request_history ADD COLUMN decline_reason TEXT NULL AFTER release_copy_filename_enc"
            ))
            connection.execute(text(
                "ALTER TABLE receipt_request_history ADD COLUMN decline_reason_hash VARCHAR(255) NULL AFTER decline_reason"
            ))
            connection.execute(text(
                "ALTER TABLE receipt_request_history ADD COLUMN decline_reason_enc TEXT NULL AFTER decline_reason_hash"
            ))
            connection.commit()
            print("Columns decline_reason, decline_reason_hash, decline_reason_enc added to receipt_request_history table.")


if __name__ == "__main__":
    print("=" * 60)
    print("Receipt Request Decline Reason Migration")
    print("=" * 60)
    print(f"Database: {SQLALCHEMY_DATABASE_URL}")
    print()

    response = input("Do you want to proceed with the migration? (yes/no): ")
    if response.strip().lower() != "yes":
        print("Migration cancelled.")
        sys.exit(0)

    add_decline_reason_columns()
    print("Migration complete.")
