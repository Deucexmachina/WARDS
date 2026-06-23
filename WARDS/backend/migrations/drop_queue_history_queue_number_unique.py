"""
Migration: Drop unique constraint from queue_history.queue_number
so multiple completed queue records can share the same queue number.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine, text
from database.database import DATABASE_URL


def run_migration():
    engine = create_engine(DATABASE_URL)
    with engine.connect() as connection:
        # MySQL: find the unique index name on queue_number for queue_history
        result = connection.execute(
            text(
                """
                SELECT INDEX_NAME
                FROM information_schema.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'queue_history'
                  AND COLUMN_NAME = 'queue_number'
                  AND NON_UNIQUE = 0
                LIMIT 1;
                """
            )
        )
        row = result.fetchone()
        if row:
            index_name = row[0]
            print(f"Dropping unique index '{index_name}' on queue_history.queue_number ...")
            connection.execute(
                text(f"ALTER TABLE queue_history DROP INDEX {index_name};")
            )
            connection.commit()
            print("Unique index dropped successfully.")
        else:
            print("No unique index found on queue_history.queue_number — nothing to do.")


if __name__ == "__main__":
    run_migration()
