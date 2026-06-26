"""
Migration script to add public_access_token column to payments table
and generate tokens for existing payments.
Run this script once to update the existing database schema.
"""

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

import secrets
from sqlalchemy import text
from database.models import engine, SQLALCHEMY_DATABASE_URL, SessionLocal, Payment


def add_public_access_token():
    """Add public_access_token field to payments table and populate existing records."""
    is_mysql = engine.dialect.name.startswith("mysql")
    varchar_type = "VARCHAR(255)" if is_mysql else "VARCHAR"

    migrations = [
        f"ALTER TABLE payments ADD COLUMN public_access_token {varchar_type} NULL",
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

        # Generate tokens for existing payments using raw SQL to avoid ORM column mismatch
        try:
            result = conn.execute(text("SELECT COUNT(*) FROM payments WHERE public_access_token IS NULL OR public_access_token = ''"))
            count = result.scalar()
            if count:
                print(f"\n  Generating tokens for {count} existing payment(s)...")
                conn.execute(text(
                    f"UPDATE payments SET public_access_token = {('LEFT(UUID(), 43)' if is_mysql else 'LOWER(HEX(RANDOMBLOB(16)))')} "
                    f"WHERE public_access_token IS NULL OR public_access_token = ''"
                ))
                conn.commit()
                print(f"  Generated tokens for {count} payment(s).")
            else:
                print("\n  All existing payments already have a public_access_token.")
        except Exception as e:
            conn.rollback()
            print(f"\n  Error generating tokens: {str(e)}")

    print("\nMigration completed successfully!")


if __name__ == "__main__":
    print("=" * 60)
    print("Payment Public Access Token Migration")
    print("=" * 60)
    print(f"Database: {SQLALCHEMY_DATABASE_URL}")
    print()

    response = input("Do you want to proceed with the migration? (yes/no): ")
    if response.lower() in ["yes", "y"]:
        add_public_access_token()
    else:
        print("Migration cancelled.")
