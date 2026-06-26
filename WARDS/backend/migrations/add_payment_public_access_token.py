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
    migrations = [
        "ALTER TABLE payments ADD COLUMN public_access_token VARCHAR",
        "CREATE INDEX IF NOT EXISTS ix_payments_public_access_token ON payments(public_access_token)",
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

    db = SessionLocal()
    try:
        payments_without_token = db.query(Payment).filter(
            (Payment.public_access_token == None) | (Payment.public_access_token == "")
        ).all()

        if payments_without_token:
            print(f"\n  Generating tokens for {len(payments_without_token)} existing payment(s)...")
            for payment in payments_without_token:
                payment.public_access_token = secrets.token_urlsafe(32)
            db.commit()
            print(f"  Generated tokens for {len(payments_without_token)} payment(s).")
        else:
            print("\n  All existing payments already have a public_access_token.")
    except Exception as e:
        db.rollback()
        print(f"\n  Error generating tokens: {str(e)}")
    finally:
        db.close()

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
