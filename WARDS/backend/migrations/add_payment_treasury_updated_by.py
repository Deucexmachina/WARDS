#!/usr/bin/env python3
"""Migration: Add treasury_updated_by column to payments table."""

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text
from database.models import engine, SQLALCHEMY_DATABASE_URL


def add_treasury_updated_by():
    with engine.connect() as connection:
        result = connection.execute(text(
            "SELECT COUNT(*) FROM information_schema.columns "
            "WHERE table_schema = DATABASE() AND table_name = 'payments' AND column_name = 'treasury_updated_by'"
        ))
        if result.scalar():
            print("Column treasury_updated_by already exists in payments table.")
            return

        connection.execute(text(
            "ALTER TABLE payments ADD COLUMN treasury_updated_by VARCHAR(255) NULL AFTER treasury_updated_at"
        ))
        connection.commit()
        print("Column treasury_updated_by added successfully to payments table.")


if __name__ == "__main__":
    print("=" * 60)
    print("Payment Treasury Updated By Migration")
    print("=" * 60)
    print(f"Database: {SQLALCHEMY_DATABASE_URL}")
    print()

    response = input("Do you want to proceed with the migration? (yes/no): ")
    if response.strip().lower() != "yes":
        print("Migration cancelled.")
        sys.exit(0)

    add_treasury_updated_by()
    print("Migration complete.")
