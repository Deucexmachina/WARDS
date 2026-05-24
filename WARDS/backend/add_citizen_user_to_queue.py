#!/usr/bin/env python3
"""
Migration script to add citizen_user_id column to queues table
"""

import os
import sys
from sqlalchemy import create_engine, text, inspect
from dotenv import load_dotenv
from pathlib import Path

def add_citizen_user_id_column():
    """Add citizen_user_id column to queues table if it doesn't exist"""
    
    # Load environment variables
    load_dotenv(Path(__file__).resolve().with_name(".env"))
    
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL not found in environment variables")
        return False
    
    try:
        # Create engine
        engine = create_engine(database_url)
        
        with engine.connect() as conn:
            # Check if column already exists
            inspector = inspect(engine)
            columns = [column['name'] for column in inspector.get_columns('queues')]
            
            if 'citizen_user_id' in columns:
                print("Column citizen_user_id already exists in queues table")
                return True
            
            # Add the column
            print("Adding citizen_user_id column to queues table...")
            conn.execute(text("""
                ALTER TABLE queues 
                ADD COLUMN citizen_user_id INTEGER
            """))
            
            # Create index for better performance
            conn.execute(text("""
                CREATE INDEX ix_queues_citizen_user_id 
                ON queues(citizen_user_id)
            """))
            
            conn.commit()
            print("Successfully added citizen_user_id column to queues table")
            return True
            
    except Exception as e:
        print(f"Database error: {e}")
        return False

if __name__ == "__main__":
    success = add_citizen_user_id_column()
    sys.exit(0 if success else 1)
