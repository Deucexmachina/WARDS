"""
Migration script to add contact_number column to branch_staff table.
Run this script once to update the existing database schema.
"""

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text
from database.models import engine, SQLALCHEMY_DATABASE_URL


def add_contact_number():
    """Add contact_number field to branch_staff table."""
    migrations = [
        "ALTER TABLE branch_staff ADD COLUMN contact_number VARCHAR(20)",
    ]

    with engine.connect() as conn:
        for migration in migrations:
            try:
                conn.execute(text(migration))
                conn.commit()
                print(f"✓ Executed: {migration}")
            except Exception as e:
                error_msg = str(e).lower()
                if "duplicate column" in error_msg or "already exists" in error_msg:
                    print(f"⊘ Skipped (already exists): {migration}")
                else:
                    print(f"✗ Error: {migration}")
                    print(f"  {str(e)}")

    print("\n✓ Migration completed successfully!")
    print("contact_number column added to branch_staff table.")


if __name__ == "__main__":
    print("=" * 60)
    print("Branch Staff Contact Number Migration")
    print("=" * 60)
    print(f"Database: {SQLALCHEMY_DATABASE_URL}")
    print()

    response = input("Do you want to proceed with the migration? (yes/no): ")
    if response.lower() in ["yes", "y"]:
        add_contact_number()
    else:
        print("Migration cancelled.")
