"""
Verification script to check if admin and branch staff users exist in database
"""
from passlib.context import CryptContext
from database.models import Admin, BranchStaff, Branch, SessionLocal
from tabulate import tabulate

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def verify_auth_users():
    """Verify admin and branch staff users in database"""
    
    db = SessionLocal()
    
    try:
        print("\n" + "="*70)
        print("AUTHENTICATION USERS VERIFICATION")
        print("="*70 + "\n")
        
        # Check Admins
        print("📋 ADMIN USERS:")
        print("-" * 70)
        admins = db.query(Admin).all()
        
        if admins:
            admin_data = []
            for admin in admins:
                # Test password
                password_test = "admin123" if admin.username == "admin" else "N/A"
                is_valid = pwd_context.verify(password_test, admin.hashed_password) if password_test != "N/A" else False
                
                admin_data.append([
                    admin.id,
                    admin.username,
                    admin.email,
                    admin.role,
                    admin.status,
                    "✓" if is_valid else "✗",
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
                # Test password
                if staff.username == "branch1":
                    password_test = "branch123"
                elif staff.username == "branchadmin":
                    password_test = "branchadmin123"
                else:
                    password_test = "N/A"
                    
                is_valid = pwd_context.verify(password_test, staff.hashed_password) if password_test != "N/A" else False
                
                staff_data.append([
                    staff.id,
                    staff.username,
                    staff.email,
                    staff.full_name,
                    staff.role,
                    staff.branch_id,
                    staff.status,
                    "✓" if is_valid else "✗"
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
        
        print("\n" + "="*70)
        print("VERIFICATION SUMMARY")
        print("="*70)
        
        # Summary
        admin_count = len(admins) if admins else 0
        staff_count = len(staff_list) if staff_list else 0
        branch_count = len(branches) if branches else 0
        
        print(f"\n✓ Admins: {admin_count}")
        print(f"✓ Branch Staff: {staff_count}")
        print(f"✓ Branches: {branch_count}")
        
        if admin_count > 0 and staff_count > 0 and branch_count > 0:
            print("\n✅ All authentication users are present!")
            print("\nDefault Login Credentials:")
            print("-" * 70)
            print("ADMIN:")
            print("  URL: http://localhost:3000/admin/login")
            print("  Username: admin")
            print("  Password: admin123")
            print("\nBRANCH STAFF:")
            print("  URL: http://localhost:3000/branch/login")
            print("  Username: branch1")
            print("  Password: branch123")
            print("\nBRANCH ADMIN:")
            print("  URL: http://localhost:3000/branch/login")
            print("  Username: branchadmin")
            print("  Password: branchadmin123")
            print("-" * 70)
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
