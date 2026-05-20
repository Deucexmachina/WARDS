from database.models import SessionLocal, User, Branch, Alert

def view_database():
    db = SessionLocal()
    
    print("=" * 60)
    print("WARDS DATABASE VIEW")
    print("=" * 60)
    
    # View Users
    print("\nUSERS:")
    print("-" * 40)
    users = db.query(User).all()
    for user in users:
        branch_name = user.branch.name if user.branch else "All Branches"
        print(f"ID: {user.id}")
        print(f"  Username: {user.username}")
        print(f"  Email: {user.email}")
        print(f"  Role: {user.role}")
        print(f"  Branch: {branch_name}")
        print(f"  Status: {user.status}")
        print(f"  Last Login: {user.last_login}")
        print()
    
    # View Branches
    print("BRANCHES:")
    print("-" * 40)
    branches = db.query(Branch).all()
    for branch in branches:
        print(f"ID: {branch.id}")
        print(f"  Name: {branch.name}")
        print(f"  Location: {branch.location}")
        print(f"  Contact: {branch.contact}")
        print(f"  Counters: {branch.counters}")
        print(f"  Status: {branch.status}")
        print()
    
    # View Alerts
    print("ALERTS:")
    print("-" * 40)
    alerts = db.query(Alert).all()
    for alert in alerts:
        print(f"ID: {alert.id}")
        print(f"  Type: {alert.type}")
        print(f"  Title: {alert.title}")
        print(f"  Message: {alert.message}")
        print(f"  Severity: {alert.severity}")
        print(f"  Read: {alert.read}")
        print()
    
    print("=" * 60)
    print(f"Total Users: {len(users)}")
    print(f"Total Branches: {len(branches)}")
    print(f"Total Alerts: {len(alerts)}")
    print("=" * 60)
    
    db.close()

if __name__ == "__main__":
    view_database()
