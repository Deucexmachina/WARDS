from database.models import SessionLocal, User, Branch, Alert, Announcement, QueueActivity
from passlib.context import CryptContext
from datetime import datetime, timedelta
import random

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def seed_database():
    db = SessionLocal()
    
    try:
        # Create branches first
        if db.query(Branch).count() == 0:
            branches = [
                Branch(name="Main Office", location="City Hall Complex", contact="(02) 1234-5678", counters=8, status="Active"),
                Branch(name="Galas Branch", location="Galas District", contact="(02) 2345-6789", counters=5, status="Active"),
                Branch(name="District 3 Office", location="District 3", contact="(02) 3456-7890", counters=6, status="Active"),
            ]
            db.add_all(branches)
            db.commit()
            print("Created default branches")
        
        # Get branch IDs
        main_office = db.query(Branch).filter(Branch.name == "Main Office").first()
        galas_branch = db.query(Branch).filter(Branch.name == "Galas Branch").first()
        district_branch = db.query(Branch).filter(Branch.name == "District 3 Office").first()
        
        if db.query(User).count() == 0:
            # Main Office Administrator (full system access)
            admin_user = User(
                username="admin",
                email="admin@treasury.gov",
                hashed_password=pwd_context.hash("admin123"),
                role="main_admin",
                branch_id=None,  # Main admin has access to all branches
                status="Active"
            )
            
            # Galas Branch Administrator
            galas_admin = User(
                username="galas_admin",
                email="galas.admin@treasury.gov",
                hashed_password=pwd_context.hash("galas123"),
                role="branch_admin",
                branch_id=galas_branch.id if galas_branch else None,
                status="Active"
            )
            
            # District 3 Branch Administrator
            district_admin = User(
                username="district_admin",
                email="district.admin@treasury.gov",
                hashed_password=pwd_context.hash("district123"),
                role="branch_admin",
                branch_id=district_branch.id if district_branch else None,
                status="Active"
            )
            
            # Galas Branch Staff
            galas_staff = User(
                username="galas_staff",
                email="galas.staff@treasury.gov",
                hashed_password=pwd_context.hash("staff123"),
                role="branch_staff",
                branch_id=galas_branch.id if galas_branch else None,
                status="Active"
            )
            
            # District 3 Branch Staff
            district_staff = User(
                username="district_staff",
                email="district.staff@treasury.gov",
                hashed_password=pwd_context.hash("staff123"),
                role="branch_staff",
                branch_id=district_branch.id if district_branch else None,
                status="Active"
            )
            
            db.add_all([admin_user, galas_admin, district_admin, galas_staff, district_staff])
            print("Created default user accounts with RBAC roles")
        
        if db.query(Alert).count() == 0:
            alerts = [
                Alert(
                    type="security",
                    title="System Initialized",
                    message="WARDS system has been successfully initialized",
                    severity="low",
                    read=False
                )
            ]
            db.add_all(alerts)
            print("Created initial system alert")
        
        if db.query(Announcement).count() == 0:
            announcements = [
                Announcement(
                    title="Extended Payment Deadline",
                    content="The deadline for Real Property Tax payment has been extended to April 30, 2026. Take advantage of the discount for early payment before March 31, 2026.",
                    icon_type="megaphone",
                    icon_color="blue",
                    created_by="admin",
                    is_active=True
                ),
                Announcement(
                    title="New Online Services Available",
                    content="You can now request certified true copies of official receipts online! No need to visit our office. Simply submit your request through our portal and receive your documents via email.",
                    icon_type="check",
                    icon_color="green",
                    created_by="admin",
                    is_active=True
                ),
                Announcement(
                    title="Branch Office Hours Update",
                    content="All branch offices will now operate from 8:00 AM to 5:00 PM, Monday to Friday. The Galas Branch will also be open on Saturdays from 9:00 AM to 1:00 PM for your convenience.",
                    icon_type="clock",
                    icon_color="yellow",
                    created_by="admin",
                    is_active=True
                )
            ]
            db.add_all(announcements)
            print("Created sample announcements")
        
        # Create queue activity data
        if db.query(QueueActivity).count() == 0:
            branches = db.query(Branch).all()
            now = datetime.utcnow()
            
            queue_activities = []
            for branch in branches:
                # Create activity for last 24 hours
                for i in range(24):
                    timestamp = now - timedelta(hours=i)
                    queue_activities.append(QueueActivity(
                        branch_id=branch.id,
                        clients_waiting=random.randint(0, 15),
                        clients_being_served=random.randint(0, branch.counters),
                        clients_completed=random.randint(10, 50),
                        timestamp=timestamp
                    ))
            
            db.add_all(queue_activities)
            print("Created queue activity data")
        
        db.commit()
        print("\nDatabase seeded successfully!")
        print("\nDefault Login Credentials:")
        print("\n  Main Office Administrator:")
        print("    Username: admin")
        print("    Password: admin123")
        print("    Role: main_admin (Full system access)")
        print("\n  Galas Branch Administrator:")
        print("    Username: galas_admin")
        print("    Password: galas123")
        print("    Role: branch_admin (Galas Branch only)")
        print("\n  District 3 Branch Administrator:")
        print("    Username: district_admin")
        print("    Password: district123")
        print("    Role: branch_admin (District 3 only)")
        print("\n  Galas Branch Staff:")
        print("    Username: galas_staff")
        print("    Password: staff123")
        print("    Role: branch_staff (Galas Branch operations)")
        print("\n  District 3 Branch Staff:")
        print("    Username: district_staff")
        print("    Password: staff123")
        print("    Role: branch_staff (District 3 operations)")
        
    except Exception as e:
        print(f"Error seeding database: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    seed_database()
