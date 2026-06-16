from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database.models import Admin, get_db
from auth import get_current_admin_user
from utils.rbac import get_sidebar_modules, get_accessible_branches
from utils.field_crypto import get_decrypted_or_raw

router = APIRouter()

@router.get("/sidebar-modules")
async def get_user_sidebar_modules(current_user: Admin = Depends(get_current_admin_user)):
    """Get sidebar modules based on user role"""
    modules = get_sidebar_modules(current_user.role)
    return {"modules": modules, "role": current_user.role}

@router.get("/accessible-branches")
async def get_user_accessible_branches(
    current_user: Admin = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """Get branches accessible to current user"""
    branches = get_accessible_branches(current_user, db)
    return {
        "branches": [
            {
                "id": branch.id,
                "name": get_decrypted_or_raw(branch, "name") or branch.name,
                "location": get_decrypted_or_raw(branch, "location") or branch.location,
                "status": branch.status
            }
            for branch in branches
        ]
    }

@router.get("/permissions")
async def get_user_permissions(current_user: Admin = Depends(get_current_admin_user)):
    """Get user permissions"""
    from utils.rbac import PERMISSIONS
    
    user_permissions = PERMISSIONS.get(current_user.role, [])
    return {
        "role": current_user.role,
        "permissions": user_permissions,
        "branch_id": getattr(current_user, "branch_id", None)
    }
