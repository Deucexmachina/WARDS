import os
from database.models import Base, engine, SQLALCHEMY_DATABASE_URL

if SQLALCHEMY_DATABASE_URL.startswith("sqlite:///"):
    db_path = SQLALCHEMY_DATABASE_URL.removeprefix("sqlite:///")
    if os.path.exists(db_path):
        os.remove(db_path)
        print(f"Removed old database: {db_path}")
else:
    print("Skipping file removal because DATABASE_URL is not using SQLite.")

# Create new database with updated schema
Base.metadata.create_all(bind=engine)
print("Created new database with updated schema")
print("\nNow run: python seed_data.py")
