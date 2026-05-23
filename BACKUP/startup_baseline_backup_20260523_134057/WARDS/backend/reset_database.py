import os
import sys
from database.models import Base, engine, SessionLocal, SQLALCHEMY_DATABASE_URL
from seed_data import seed_database

def reset_database():
    """Complete database reset and reseed"""
    
    # Close any existing connections
    print("Closing existing database connections...")
    
    # Remove old database only when using SQLite
    if SQLALCHEMY_DATABASE_URL.startswith("sqlite:///"):
        db_path = SQLALCHEMY_DATABASE_URL.removeprefix("sqlite:///")
        if os.path.exists(db_path):
            try:
                os.remove(db_path)
                print(f"Removed old database: {db_path}")
            except PermissionError:
                print("ERROR: Database is locked. Please stop the backend server first.")
                print("Run: taskkill /F /IM python.exe")
                sys.exit(1)
    else:
        print("Skipping SQLite file deletion because DATABASE_URL is not using SQLite.")
    
    # Create new database with updated schema
    print("Creating new database with updated schema...")
    Base.metadata.create_all(bind=engine)
    print("Database schema created successfully!")
    
    # Seed the database
    print("\nSeeding database with initial data...")
    seed_database()
    
    print("\n" + "="*60)
    print("DATABASE RESET COMPLETE!")
    print("="*60)
    print("\nYou can now start the backend server:")
    print("  python main.py")

if __name__ == "__main__":
    reset_database()
