from fastapi import HTTPException, status, Depends
from sqlalchemy.orm import Session
from typing import Optional
from database.models import User, get_db

# Role definitions
ROLE_MAIN_ADMIN = "main_admin"
ROLE_BRANCH_ADMIN = "branch_admin"
ROLE_BRANCH_STAFF = "branch_staff"

# Permission mappings
PERMISSIONS = {
    ROLE_MAIN_ADMIN: [
        "view_all_branches",
        "manage_branches",
        "view_system_stats",
        "manage_announcements",
        "manage_memos",
        "manage_discrepancies",
        "view_alerts",
        "view_activity_logs",
        "manage_settings",
        "manage_users",
        "manage_backup",
        "manage_policies"
    ],
    ROLE_BRANCH_ADMIN: [
        "view_branch_dashboard",
        "view_branch_queue",
        "manage_branch_data",
        "view_memos",
        "report_discrepancies",
        "view_announcements",
        "generate_branch_reports",
        "view_branch_alerts"
    ],
    ROLE_BRANCH_STAFF: [
        "view_branch_operations",
        "view_queue_status",
        "view_memos",
        "report_discrepancies",
        "view_announcements",
        "process_transactions"
    ]
}

def check_permission(user: User, permission: str) -> bool:
    """Check if user has a specific permission"""
    if not user or not user.role:
        return False
    
    user_permissions = PERMISSIONS.get(user.role, [])
    return permission in user_permissions

def require_permission(permission: str):
    """Decorator to require a specific permission"""
    def permission_checker(user: User):
        if not check_permission(user, permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: {permission} required"
            )
        return user
    return permission_checker

def require_role(*allowed_roles: str):
    """Decorator to require specific roles"""
    def role_checker(user: User):
        if not user or user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required roles: {', '.join(allowed_roles)}"
            )
        return user
    return role_checker

def check_branch_access(user: User, branch_id: int) -> bool:
    """Check if user has access to a specific branch"""
    if user.role == ROLE_MAIN_ADMIN:
        return True
    
    if user.role in [ROLE_BRANCH_ADMIN, ROLE_BRANCH_STAFF]:
        return user.branch_id == branch_id
    
    return False

def require_branch_access(branch_id: int):
    """Decorator to require access to a specific branch"""
    def branch_checker(user: User):
        if not check_branch_access(user, branch_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied to this branch"
            )
        return user
    return branch_checker

def filter_by_branch(user: User, query, model):
    """Filter query results by user's branch access"""
    if user.role == ROLE_MAIN_ADMIN:
        return query
    
    if user.role in [ROLE_BRANCH_ADMIN, ROLE_BRANCH_STAFF]:
        if hasattr(model, 'branch_id'):
            return query.filter(model.branch_id == user.branch_id)
    
    return query

def get_accessible_branches(user: User, db: Session):
    """Get list of branches accessible to user"""
    from database.models import Branch
    
    if user.role == ROLE_MAIN_ADMIN:
        return db.query(Branch).all()
    
    if user.role in [ROLE_BRANCH_ADMIN, ROLE_BRANCH_STAFF] and user.branch_id:
        return db.query(Branch).filter(Branch.id == user.branch_id).all()
    
    return []

def get_sidebar_modules(role: str) -> list:
    """Get sidebar modules based on user role"""
    if role == ROLE_MAIN_ADMIN:
        return [
            {"name": "Dashboard", "path": "/admin", "icon": "dashboard"},
            {"name": "Manage Branches", "path": "/admin/branches", "icon": "branches"},
            {"name": "Tax Assessment", "path": "/admin/tax-assessment", "icon": "assessment"},
            {"name": "Branch Reports", "path": "/admin/reports", "icon": "reports"},
            {"name": "Announcements", "path": "/admin/announcements", "icon": "announcements"},
            {"name": "Internal Memos", "path": "/admin/memos", "icon": "memos"},
            {"name": "Discrepancy Reports", "path": "/admin/discrepancies", "icon": "discrepancies"},
            {"name": "System Alerts", "path": "/admin/alerts", "icon": "alerts"},
            {"name": "Activity Logs", "path": "/admin/activity-logs", "icon": "logs"},
            {"name": "Backup & Recovery", "path": "/admin/backup", "icon": "backup"},
            {"name": "Policies & SOPs", "path": "/admin/policies", "icon": "policies"},
            {"name": "System Settings", "path": "/admin/settings", "icon": "settings"},
            {"name": "Account Management", "path": "/admin/accounts", "icon": "accounts"}
        ]
    
    elif role == ROLE_BRANCH_ADMIN:
        return [
            {"name": "Branch Dashboard", "path": "/branch", "icon": "dashboard"},
            {"name": "Queue Management", "path": "/branch/queue", "icon": "queue"},
            {"name": "Receipt Management", "path": "/branch/receipts", "icon": "receipts"},
            {"name": "Payment Management", "path": "/branch/payments", "icon": "payments"},
            {"name": "Branch Reports", "path": "/branch/reports", "icon": "reports"},
            {"name": "Internal Memos", "path": "/branch/memos", "icon": "memos"},
            {"name": "Announcements", "path": "/branch/announcements", "icon": "announcements"},
            {"name": "Discrepancy Reports", "path": "/branch/discrepancies", "icon": "discrepancies"},
            {"name": "Policies & SOPs", "path": "/branch/policies", "icon": "policies"}
        ]
    
    elif role == ROLE_BRANCH_STAFF:
        return [
            {"name": "Branch Operations", "path": "/branch", "icon": "operations"},
            {"name": "Branch Reports", "path": "/branch/reports", "icon": "reports"},
            {"name": "Internal Memos", "path": "/branch/memos", "icon": "memos"},
            {"name": "Discrepancy Reports", "path": "/branch/discrepancies", "icon": "discrepancies"},
            {"name": "Policies & SOPs", "path": "/branch/policies", "icon": "policies"},
            {"name": "Announcements", "path": "/branch/announcements", "icon": "announcements"}
        ]
    
    return []
