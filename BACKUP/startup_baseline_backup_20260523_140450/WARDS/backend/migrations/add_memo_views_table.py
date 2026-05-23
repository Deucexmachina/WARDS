"""
Migration script to add memo_views table for tracking viewed memos
Run this script to update the database schema
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.models import Base, engine

def run_migration():
    """Create the memo_views table"""
    print("Creating memo_views table...")
    Base.metadata.create_all(bind=engine)
    print("Migration completed successfully!")

if __name__ == "__main__":
    run_migration()
