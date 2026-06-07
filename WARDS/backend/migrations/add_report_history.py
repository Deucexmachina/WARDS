"""
Migration to add ReportHistory table for storing archived/deleted branch reports.
This migration creates the report_history table to preserve deleted reports for historical reference.
"""

from sqlalchemy import create_engine, MetaData, Table, Column, Integer, String, DateTime, ForeignKey
from datetime import datetime
import sys
import os

# Add parent directory to path to import database models
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.models import Base, get_db
from sqlalchemy.orm import sessionmaker


def upgrade():
    """Create the report_history table."""
    from database.models import Base, ReportHistory
    from sqlalchemy import create_engine
    import os
    
    # Get database URL from environment or use default
    database_url = os.getenv('DATABASE_URL', 'sqlite:///./wards.db')
    engine = create_engine(database_url)
    
    # Create the report_history table
    ReportHistory.__table__.create(engine, checkfirst=True)
    print("ReportHistory table created successfully.")


def downgrade():
    """Drop the report_history table."""
    from database.models import ReportHistory
    from sqlalchemy import create_engine
    import os
    
    database_url = os.getenv('DATABASE_URL', 'sqlite:///./wards.db')
    engine = create_engine(database_url)
    
    # Drop the report_history table
    ReportHistory.__table__.drop(engine, checkfirst=True)
    print("ReportHistory table dropped successfully.")


if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='Migration for ReportHistory table')
    parser.add_argument('--downgrade', action='store_true', help='Rollback the migration')
    args = parser.parse_args()
    
    if args.downgrade:
        downgrade()
    else:
        upgrade()
