"""
Migration script to fix memo_views foreign key constraint
Adds CASCADE DELETE so memos can be deleted even if they have view records
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from database.models import engine

def run_migration():
    """Fix the foreign key constraint to allow cascade delete"""
    print("Fixing memo_views foreign key constraint...")
    
    with engine.connect() as conn:
        # For MySQL/MariaDB
        try:
            # Drop the existing foreign key constraint
            print("Dropping old foreign key constraint...")
            conn.execute(text("""
                ALTER TABLE memo_views 
                DROP FOREIGN KEY memo_views_ibfk_1
            """))
            conn.commit()
            
            # Add new foreign key with CASCADE DELETE
            print("Adding new foreign key with CASCADE DELETE...")
            conn.execute(text("""
                ALTER TABLE memo_views 
                ADD CONSTRAINT memo_views_ibfk_1 
                FOREIGN KEY (memo_id) REFERENCES memos(id) 
                ON DELETE CASCADE
            """))
            conn.commit()
            
            print("Migration completed successfully!")
            print("Memos can now be deleted even if they have view records.")
            
        except Exception as e:
            # For SQLite (doesn't support dropping constraints easily)
            if "sqlite" in str(engine.url).lower():
                print("SQLite detected - recreating table with proper constraint...")
                
                # SQLite requires recreating the table
                conn.execute(text("DROP TABLE IF EXISTS memo_views_new"))
                conn.execute(text("""
                    CREATE TABLE memo_views_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        memo_id INTEGER NOT NULL,
                        viewer_username VARCHAR(255) NOT NULL,
                        viewer_type VARCHAR(255) DEFAULT 'admin',
                        viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (memo_id) REFERENCES memos(id) ON DELETE CASCADE
                    )
                """))
                
                # Copy data from old table
                conn.execute(text("""
                    INSERT INTO memo_views_new (id, memo_id, viewer_username, viewer_type, viewed_at)
                    SELECT id, memo_id, viewer_username, viewer_type, viewed_at
                    FROM memo_views
                """))
                
                # Drop old table and rename new one
                conn.execute(text("DROP TABLE memo_views"))
                conn.execute(text("ALTER TABLE memo_views_new RENAME TO memo_views"))
                
                conn.commit()
                print("Migration completed successfully!")
            else:
                print(f"Error: {e}")
                raise

if __name__ == "__main__":
    run_migration()
