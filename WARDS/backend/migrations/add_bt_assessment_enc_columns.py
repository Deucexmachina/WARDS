"""
Migration script to add encryption/hash companion columns for BT assessment fields.
Run this script once to update the existing database schema.
"""

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text
from database.models import engine, SQLALCHEMY_DATABASE_URL


def add_columns():
    """Add _enc and _hash columns for BT fields in tax_assessment_records."""
    is_mysql = engine.dialect.name.startswith("mysql")
    varchar_type = "VARCHAR(255)" if is_mysql else "VARCHAR"
    text_type = "LONGTEXT" if is_mysql else "TEXT"

    migrations = [
        f"ALTER TABLE tax_assessment_records ADD COLUMN mayor_permit_number_hash {varchar_type}",
        f"ALTER TABLE tax_assessment_records ADD COLUMN mayor_permit_number_enc {text_type}",
        f"ALTER TABLE tax_assessment_records ADD COLUMN sec_dti_cda_number_hash {varchar_type}",
        f"ALTER TABLE tax_assessment_records ADD COLUMN sec_dti_cda_number_enc {text_type}",
        f"ALTER TABLE tax_assessment_records ADD COLUMN business_name_hash {varchar_type}",
        f"ALTER TABLE tax_assessment_records ADD COLUMN business_name_enc {text_type}",
        f"ALTER TABLE tax_assessment_records ADD COLUMN business_type_hash {varchar_type}",
        f"ALTER TABLE tax_assessment_records ADD COLUMN business_type_enc {text_type}",
        "CREATE INDEX IF NOT EXISTS ix_tax_assessment_records_mayor_permit_number_hash ON tax_assessment_records(mayor_permit_number_hash)",
        "CREATE INDEX IF NOT EXISTS ix_tax_assessment_records_business_name_hash ON tax_assessment_records(business_name_hash)",
    ]

    with engine.connect() as conn:
        for migration in migrations:
            try:
                conn.execute(text(migration))
                conn.commit()
                print(f"  Executed: {migration}")
            except Exception as e:
                error_msg = str(e).lower()
                if "duplicate column" in error_msg or "already exists" in error_msg or "duplicate key" in error_msg:
                    print(f"  Skipped (already exists): {migration}")
                else:
                    print(f"  Error: {migration}")
                    print(f"    {str(e)}")

    print("\nMigration completed successfully!")
    print("BT assessment encryption/hash columns added to tax_assessment_records.")


if __name__ == "__main__":
    print("=" * 60)
    print("BT Assessment Encryption Columns Migration")
    print("=" * 60)
    print(f"Database: {SQLALCHEMY_DATABASE_URL}")
    print()

    response = input("Do you want to proceed with the migration? (yes/no): ")
    if response.lower() in ["yes", "y"]:
        add_columns()
    else:
        print("Migration cancelled.")
