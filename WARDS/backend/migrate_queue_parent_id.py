"""
Migration script to add parent_queue_id column to queues table
and remove unique constraint from queue_number column
"""

from database.models import get_db
from sqlalchemy import text
import sys

def run_migration():
    """Run the migration to add parent_queue_id column and remove unique constraint from queue_number"""
    print("Starting queue migration...")
    
    try:
        # Get database session
        db_gen = get_db()
        db = next(db_gen)
        
        # Check current table structure
        try:
            result = db.execute(text("DESCRIBE queues"))
            columns = [row[0] for row in result.fetchall()]
            
            # Add parent_queue_id column if it doesn't exist
            if 'parent_queue_id' in columns:
                print("✓ 'parent_queue_id' column already exists")
            else:
                print("Adding 'parent_queue_id' column...")
                db.execute(text("""
                    ALTER TABLE queues 
                    ADD COLUMN parent_queue_id INT NULL,
                    ADD INDEX idx_parent_queue_id (parent_queue_id),
                    ADD CONSTRAINT fk_parent_queue 
                    FOREIGN KEY (parent_queue_id) REFERENCES queues(id) ON DELETE CASCADE
                """))
                db.commit()
                print("✓ 'parent_queue_id' column added successfully")
            
            # Remove unique constraint from queue_number if it exists
            print("Checking queue_number unique constraint...")
            result = db.execute(text("""
                SELECT INDEX_NAME 
                FROM information_schema.STATISTICS 
                WHERE TABLE_SCHEMA = DATABASE() 
                AND TABLE_NAME = 'queues' 
                AND COLUMN_NAME = 'queue_number' 
                AND NON_UNIQUE = 0
            """))
            unique_indexes = [row[0] for row in result.fetchall()]
            
            if unique_indexes:
                print(f"Found unique constraint(s) on queue_number: {unique_indexes}")
                for index_name in unique_indexes:
                    print(f"Dropping unique index '{index_name}'...")
                    db.execute(text(f"ALTER TABLE queues DROP INDEX {index_name}"))
                    db.commit()
                print("✓ Unique constraint(s) removed from queue_number")
            else:
                print("✓ No unique constraint on queue_number (already removed)")
            
            # Ensure queue_number has an index (non-unique)
            result = db.execute(text("""
                SELECT INDEX_NAME 
                FROM information_schema.STATISTICS 
                WHERE TABLE_SCHEMA = DATABASE() 
                AND TABLE_NAME = 'queues' 
                AND COLUMN_NAME = 'queue_number'
            """))
            indexes = [row[0] for row in result.fetchall()]
            
            if not indexes:
                print("Adding non-unique index on queue_number...")
                db.execute(text("ALTER TABLE queues ADD INDEX idx_queue_number (queue_number)"))
                db.commit()
                print("✓ Non-unique index added to queue_number")
            else:
                print("✓ Index on queue_number already exists")
            
            print("\n✅ Migration completed successfully!")
            
            # Verify the changes
            print("\nVerifying changes...")
            result = db.execute(text("DESCRIBE queues"))
            columns = [row[0] for row in result.fetchall()]
            print(f"\nCurrent columns in queues table:")
            for col in columns:
                print(f"  - {col}")
            
            if 'parent_queue_id' in columns:
                print("\n✓ parent_queue_id column verified")
            else:
                print("\n✗ parent_queue_id column missing!")
                sys.exit(1)
                
        except Exception as e:
            print(f"Error during migration: {e}")
            db.rollback()
            sys.exit(1)
            
    except Exception as e:
        print(f"Error connecting to database: {e}")
        sys.exit(1)
    finally:
        try:
            db.close()
        except:
            pass

if __name__ == "__main__":
    run_migration()
