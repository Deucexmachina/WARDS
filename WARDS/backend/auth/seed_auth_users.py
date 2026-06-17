"""
Seed script to create default Admin and BranchStaff users for authentication testing
"""
import os
import secrets
import string
from datetime import datetime

from auth.password_utils import hash_password
from database.models import Admin, BranchStaff, Branch, SessionLocal, Base, engine


def _generate_secure_password(length: int = 24) -> str:
    """Generate a strong random password meeting complexity requirements."""
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*-_+="
    while True:
        password = "".join(secrets.choice(alphabet) for _ in range(length))
        if (
            any(c.islower() for c in password)
            and any(c.isupper() for c in password)
            and any(c.isdigit() or not c.isalnum() for c in password)
        ):
            return password


def _get_seed_password(env_var: str, default_label: str) -> str:
    """Fetch password from env var or generate a secure one."""
    password = os.getenv(env_var)
    if not password:
        password = _generate_secure_password()
        print(f"  [{default_label}] No {env_var} set; generated secure password.")
    return password


def seed_auth_users():
    """Create default admin and branch staff users"""

    # Skip if admin credentials are managed via .env
    if os.getenv("ADMIN_PASSWORD") or os.getenv("SUPERADMIN_PASSWORD"):
        print("ℹ Admin credentials are managed via environment variables; skipping seed.")
        return

    # Create tables if they don't exist
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    credentials = {}

    try:
        # Check if admin already exists
        existing_admin = db.query(Admin).filter(Admin.username == "admin").first()
        if existing_admin:
            print("✓ Admin user already exists")
        else:
            admin_password = _get_seed_password("SEED_ADMIN_PASSWORD", "admin")
            admin = Admin(
                username="admin",
                email="treasurermain@gmail.com",
                hashed_password=hash_password(admin_password),
                role="main_admin",
                status="Active",
                created_at=datetime.utcnow()
            )
            db.add(admin)
            db.commit()
            print("✓ Created default admin user")
            credentials["admin"] = admin_password

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
            staff_password = _get_seed_password("SEED_BRANCH_STAFF_PASSWORD", "branch1")
            staff = BranchStaff(
                username="branch1",
                email="branch1@treasury.gov",
                full_name="Branch Staff One",
                hashed_password=hash_password(staff_password),
                branch_id=branch.id,
                role="branch_staff",
                status="Active",
                created_at=datetime.utcnow()
            )
            db.add(staff)
            db.commit()
            print("✓ Created default branch staff user")
            credentials["branch1"] = staff_password

        # Create a branch admin as well
        existing_branch_admin = db.query(BranchStaff).filter(BranchStaff.username == "branchadmin").first()
        if existing_branch_admin:
            print("✓ Branch admin user already exists")
        else:
            branch_admin_password = _get_seed_password("SEED_BRANCH_ADMIN_PASSWORD", "branchadmin")
            branch_admin = BranchStaff(
                username="branchadmin",
                email="branchadmin@treasury.gov",
                full_name="Branch Administrator",
                hashed_password=hash_password(branch_admin_password),
                branch_id=branch.id,
                role="branch_admin",
                status="Active",
                created_at=datetime.utcnow()
            )
            db.add(branch_admin)
            db.commit()
            print("✓ Created branch admin user")
            credentials["branchadmin"] = branch_admin_password

        print("\n" + "=" * 50)
        print("Authentication users seeded successfully!")
        print("=" * 50)
        if credentials:
            print("\nDefault Credentials (SAVE THESE SECURELY):")
            print("-" * 50)
            if "admin" in credentials:
                print("ADMIN PORTAL:")
                print("  URL: http://localhost:3000/admin/login")
                print("  Username: admin")
                print(f"  Password: {credentials['admin']}")
            if "branch1" in credentials:
                print("\nBRANCH PORTAL (Staff):")
                print("  URL: http://localhost:3000/branch/login")
                print("  Username: branch1")
                print(f"  Password: {credentials['branch1']}")
            if "branchadmin" in credentials:
                print("\nBRANCH PORTAL (Admin):")
                print("  URL: http://localhost:3000/branch/login")
                print("  Username: branchadmin")
                print(f"  Password: {credentials['branchadmin']}")
            print("-" * 50)

    except Exception as e:
        print(f"✗ Error seeding users: {e}")
        db.rollback()
    finally:
        db.close()


if __name__ == "__main__":
    seed_auth_users()
