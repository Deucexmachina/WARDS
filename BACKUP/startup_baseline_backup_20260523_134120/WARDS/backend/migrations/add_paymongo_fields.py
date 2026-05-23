"""
Migration script to add PayMongo fields to Payment table
Run this script to update existing database schema
"""

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text
from database.models import engine, SQLALCHEMY_DATABASE_URL


def add_paymongo_fields():
    """Add PayMongo-specific fields to payments table"""
    
    is_sqlite = SQLALCHEMY_DATABASE_URL.startswith("sqlite")
    
    migrations = [
        "ALTER TABLE payments ADD COLUMN paymongo_payment_intent_id VARCHAR(255)",
        "ALTER TABLE payments ADD COLUMN paymongo_source_id VARCHAR(255)",
        "ALTER TABLE payments ADD COLUMN paymongo_payment_id VARCHAR(255)",
        "ALTER TABLE payments ADD COLUMN paymongo_checkout_url VARCHAR(500)",
        "ALTER TABLE payments ADD COLUMN paymongo_status VARCHAR(100)",
        "ALTER TABLE payments ADD COLUMN payment_expiry DATETIME",
    ]
    
    if not is_sqlite:
        index_migrations = [
            "CREATE INDEX idx_paymongo_payment_intent ON payments(paymongo_payment_intent_id)",
            "CREATE INDEX idx_paymongo_source ON payments(paymongo_source_id)",
            "CREATE INDEX idx_paymongo_payment ON payments(paymongo_payment_id)",
        ]
        migrations.extend(index_migrations)
    
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
    print("PayMongo fields have been added to the payments table.")


if __name__ == "__main__":
    print("=" * 60)
    print("PayMongo Fields Migration")
    print("=" * 60)
    print(f"Database: {SQLALCHEMY_DATABASE_URL}")
    print()
    
    response = input("Do you want to proceed with the migration? (yes/no): ")
    if response.lower() in ["yes", "y"]:
        add_paymongo_fields()
    else:
        print("Migration cancelled.")
