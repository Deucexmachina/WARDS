"""
Verification script to check if admin and branch staff users exist in database
"""
import os
from passlib.context import CryptContext
from database.models import Admin, BranchStaff, Branch, SessionLocal
from tabulate import tabulate

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Map env var names to expected usernames for optional password verification
_ADMIN_PASSWORD_ENVS = {
    "admin": "SEED_ADMIN_PASSWORD",
    "branch1": "SEED_BRANCH_STAFF_PASSWORD",
    "branchadmin": "SEED_BRANCH_ADMIN_PASSWORD",
}


def _verify_password(username: str, hashed: str) -> str:
    env_var = _ADMIN_PASSWORD_ENVS.get(username)
    if not env_var:
        return "N/A"
    password = os.getenv(env_var)
    if not password:
        return "N/A (env missing)"
    return "✓" if pwd_context.verify(password, hashed) else "✗"


def verify_auth_users():
    """Verify admin and branch staff users in database"""

    db = SessionLocal()

    try:
        print("\n" + "=" * 70)
        print("AUTHENTICATION USERS VERIFICATION")
        print("=" * 70 + "\n")

        # Check Admins
        print("📋 ADMIN USERS:")
        print("-" * 70)
        admins = db.query(Admin).all()

        if admins:
            admin_data = []
            for admin in admins:
                pw_test = _verify_password(admin.username, admin.hashed_password)
                admin_data.append([
                    admin.id,
                    admin.username,
                    admin.email,
                    admin.role,
                    admin.status,
                    pw_test,
                    admin.hashed_password[:20] + "..."
                ])

            print(tabulate(admin_data,
                          headers=["ID", "Username", "Email", "Role", "Status", "PW Test", "Hash Preview"],
                          tablefmt="grid"))
            print(f"\nTotal Admins: {len(admins)}")
        else:
            print("❌ No admin users found in database!")
            print("   Run: python seed_auth_users.py")

        print("\n" + "-" * 70 + "\n")

        # Check Branch Staff
        print("📋 BRANCH STAFF USERS:")
        print("-" * 70)
        staff_list = db.query(BranchStaff).all()

        if staff_list:
            staff_data = []
            for staff in staff_list:
                pw_test = _verify_password(staff.username, staff.hashed_password)
                staff_data.append([
                    staff.id,
                    staff.username,
                    staff.email,
                    staff.full_name,
                    staff.role,
                    staff.branch_id,
                    staff.status,
                    pw_test
                ])

            print(tabulate(staff_data,
                          headers=["ID", "Username", "Email", "Full Name", "Role", "Branch", "Status", "PW Test"],
                          tablefmt="grid"))
            print(f"\nTotal Branch Staff: {len(staff_list)}")
        else:
            print("❌ No branch staff users found in database!")
            print("   Run: python seed_auth_users.py")

        print("\n" + "-" * 70 + "\n")

        # Check Branches
        print("📋 BRANCHES:")
        print("-" * 70)
        branches = db.query(Branch).all()

        if branches:
            branch_data = []
            for branch in branches:
                branch_data.append([
                    branch.id,
                    branch.name,
                    branch.location,
                    branch.contact,
                    branch.counters,
                    branch.status
                ])

            print(tabulate(branch_data,
                          headers=["ID", "Name", "Location", "Contact", "Counters", "Status"],
                          tablefmt="grid"))
            print(f"\nTotal Branches: {len(branches)}")
        else:
            print("❌ No branches found in database!")
            print("   Run: python seed_auth_users.py")

        print("\n" + "=" * 70)
        print("VERIFICATION SUMMARY")
        print("=" * 70)

        admin_count = len(admins) if admins else 0
        staff_count = len(staff_list) if staff_list else 0
        branch_count = len(branches) if branches else 0

        print(f"\n✓ Admins: {admin_count}")
        print(f"✓ Branch Staff: {staff_count}")
        print(f"✓ Branches: {branch_count}")

        if admin_count > 0 and staff_count > 0 and branch_count > 0:
            print("\n✅ All authentication users are present!")
        else:
            print("\n⚠️  Missing authentication users!")
            print("   Run: python seed_auth_users.py")

        print("\n")

    except Exception as e:
        print(f"\n❌ Error verifying users: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


if __name__ == "__main__":
    verify_auth_users()
