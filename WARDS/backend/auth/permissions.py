from fastapi import HTTPException, status

ROLE_SUPERADMIN = "superadmin"
ROLE_MAIN_ADMIN = "main_admin"
ROLE_BRANCH_ADMIN = "branch_admin"
ROLE_BRANCH_STAFF = "branch_staff"
ROLE_PUBLIC = "public"

ADMIN_ROLES = {ROLE_SUPERADMIN, ROLE_MAIN_ADMIN, ROLE_BRANCH_ADMIN}
BRANCH_ROLES = {ROLE_BRANCH_ADMIN, ROLE_BRANCH_STAFF}
ALL_ADMIN_ROLES = {ROLE_SUPERADMIN, ROLE_MAIN_ADMIN, ROLE_BRANCH_ADMIN, ROLE_BRANCH_STAFF}

ROLE_HIERARCHY = {
    ROLE_SUPERADMIN: 4,
    ROLE_MAIN_ADMIN: 3,
    ROLE_BRANCH_ADMIN: 2,
    ROLE_BRANCH_STAFF: 1,
    ROLE_PUBLIC: 0,
}


def require_role(*allowed_roles: str):
    """Decorator / marker for required roles.
    FastAPI dependencies should use the factory functions below."""
    def decorator(func):
        func._required_roles = allowed_roles
        return func
    return decorator


def has_permission(user_role: str, required_role: str) -> bool:
    user_level = ROLE_HIERARCHY.get(user_role, 0)
    required_level = ROLE_HIERARCHY.get(required_role, 0)
    return user_level >= required_level


def is_admin_role(role: str) -> bool:
    return role in ADMIN_ROLES


def is_branch_role(role: str) -> bool:
    return role in BRANCH_ROLES


def is_any_admin_role(role: str) -> bool:
    return role in ALL_ADMIN_ROLES


def assert_role(current_user, *allowed_roles: str):
    if current_user.role not in allowed_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied. Required roles: {', '.join(allowed_roles)}",
        )
