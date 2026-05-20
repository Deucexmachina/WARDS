"""
Migration script to add title and last_viewed_by_branch columns to discrepancy_reports table
This script uses the existing database connection from the application
"""

from database.models import get_db, DiscrepancyReport
from sqlalchemy import text
import sys

def run_migration():
    """Run the migration to add new columns to discrepancy_reports table"""
    print("Starting migration...")
    
    try:
        # Get database session
        db_gen = get_db()
        db = next(db_gen)
        
        # Check if title column already exists
        try:
            result = db.execute(text("DESCRIBE discrepancy_reports"))
            columns = [row[0] for row in result.fetchall()]
            
            if 'title' in columns:
                print("✓ 'title' column already exists")
            else:
                print("Adding 'title' column...")
                db.execute(text("ALTER TABLE discrepancy_reports ADD COLUMN title VARCHAR(255) NOT NULL DEFAULT 'Untitled Report'"))
                db.commit()
                print("✓ 'title' column added successfully")
                
            if 'last_viewed_by_branch' in columns:
                print("✓ 'last_viewed_by_branch' column already exists")
            else:
                print("Adding 'last_viewed_by_branch' column...")
                db.execute(text("ALTER TABLE discrepancy_reports ADD COLUMN last_viewed_by_branch DATETIME NULL"))
                db.commit()
                print("✓ 'last_viewed_by_branch' column added successfully")
                
            # Update existing records to have meaningful titles
            print("Updating existing records with default titles...")
            db.execute(text("""
                UPDATE discrepancy_reports 
                SET title = CONCAT(discrepancy_type, ' - Report #', id)
                WHERE title = 'Untitled Report'
            """))
            db.commit()
            print("✓ Existing records updated")
            
            # Remove default constraint from title (optional, for strict validation)
            print("Removing default constraint from title column...")
            db.execute(text("ALTER TABLE discrepancy_reports MODIFY COLUMN title VARCHAR(255) NOT NULL"))
            db.commit()
            print("✓ Default constraint removed")
            
            print("\n✅ Migration completed successfully!")
            
            # Verify the changes
            print("\nVerifying changes...")
            result = db.execute(text("""
                SELECT id, title, discrepancy_type, last_viewed_by_branch, created_at 
                FROM discrepancy_reports 
                ORDER BY created_at DESC 
                LIMIT 5
            """))
            rows = result.fetchall()
            print(f"\nSample records ({len(rows)} shown):")
            print("-" * 100)
            print(f"{'ID':<5} {'Title':<40} {'Type':<25} {'Created At':<20}")
            print("-" * 100)
            for row in rows:
                print(f"{row[0]:<5} {row[1][:38]:<40} {row[2][:23]:<25} {str(row[4])[:18]:<20}")
            
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
