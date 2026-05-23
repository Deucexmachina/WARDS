"""
Seed script to create default Admin and BranchStaff users for authentication testing
"""
from passlib.context import CryptContext
from database.models import Admin, BranchStaff, Branch, SessionLocal, Base, engine
from datetime import datetime

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def seed_auth_users():
    """Create default admin and branch staff users"""
    
    # Create tables if they don't exist
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    
    try:
        # Check if admin already exists
        existing_admin = db.query(Admin).filter(Admin.username == "admin").first()
        if existing_admin:
            print("✓ Admin user already exists")
        else:
            # Create default admin user
            admin = Admin(
                username="admin",
                email="admin@wards.local",
                hashed_password=pwd_context.hash("admin123"),
                role="main_admin",
                status="Active",
                created_at=datetime.utcnow()
            )
            db.add(admin)
            db.commit()
            print("✓ Created default admin user")
            print("  Username: admin")
            print("  Password: admin123")
        
        # Ensure at least one branch exists for branch staff
        existing_branch = db.query(Branch).first()
        if not existing_branch:
            branch = Branch(
                name="Main Branch",
                location="City Hall",
                contact="555-0100",
                counters=5,
                status="Active"
            )
            db.add(branch)
            db.commit()
            db.refresh(branch)
            print("✓ Created Main Branch")
        else:
            branch = existing_branch
            print("✓ Branch already exists")
        
        # Check if branch staff already exists
        existing_staff = db.query(BranchStaff).filter(BranchStaff.username == "branch1").first()
        if existing_staff:
            print("✓ Branch staff user already exists")
        else:
            # Create default branch staff user
            staff = BranchStaff(
                username="branch1",
                email="branch1@wards.local",
                full_name="Branch Staff One",
                hashed_password=pwd_context.hash("branch123"),
                branch_id=branch.id,
                role="branch_staff",
                status="Active",
                created_at=datetime.utcnow()
            )
            db.add(staff)
            db.commit()
            print("✓ Created default branch staff user")
            print("  Username: branch1")
            print("  Password: branch123")
            print(f"  Branch ID: {branch.id}")
        
        # Create a branch admin as well
        existing_branch_admin = db.query(BranchStaff).filter(BranchStaff.username == "branchadmin").first()
        if existing_branch_admin:
            print("✓ Branch admin user already exists")
        else:
            branch_admin = BranchStaff(
                username="branchadmin",
                email="branchadmin@wards.local",
                full_name="Branch Administrator",
                hashed_password=pwd_context.hash("branchadmin123"),
                branch_id=branch.id,
                role="branch_admin",
                status="Active",
                created_at=datetime.utcnow()
            )
            db.add(branch_admin)
            db.commit()
            print("✓ Created branch admin user")
            print("  Username: branchadmin")
            print("  Password: branchadmin123")
            print(f"  Branch ID: {branch.id}")
        
        print("\n" + "="*50)
        print("Authentication users seeded successfully!")
        print("="*50)
        print("\nDefault Credentials:")
        print("-" * 50)
        print("ADMIN PORTAL:")
        print("  URL: http://localhost:3000/admin/login")
        print("  Username: admin")
        print("  Password: admin123")
        print("\nBRANCH PORTAL (Staff):")
        print("  URL: http://localhost:3000/branch/login")
        print("  Username: branch1")
        print("  Password: branch123")
        print("\nBRANCH PORTAL (Admin):")
        print("  URL: http://localhost:3000/branch/login")
        print("  Username: branchadmin")
        print("  Password: branchadmin123")
        print("-" * 50)
        
    except Exception as e:
        print(f"✗ Error seeding users: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    seed_auth_users()
