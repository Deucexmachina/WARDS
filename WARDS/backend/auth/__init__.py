"""
WARDS Authentication Framework

Centralized authentication utilities with separated responsibilities.
"""

from auth.jwt_utils import (
    ALGORITHM,
    ADMIN_SECRET_KEY,
    BRANCH_SECRET_KEY,
    PASSWORD_RESET_SECRET_KEY,
    USER_SECRET_KEY,
    create_access_token,
    create_refresh_token,
    decode_token,
    get_portal_config,
    PORTAL_CONFIG,
)
from auth.password_utils import (
    hash_password,
    pwd_context,
    validate_password_strength,
    verify_password,
    verify_account_password,
)
from auth.decorators import (
    decode_active_account_from_bearer_token,
    get_current_admin_from_token,
    get_current_admin_or_branch_staff,
    get_current_admin_user,
    get_current_branch_staff,
    get_current_user,
    get_optional_current_user,
    require_admin_or_branch_role,
    require_admin_role,
    require_any_admin,
    require_any_branch_staff,
    require_branch_admin,
    require_branch_admin_or_higher,
    require_branch_role,
    require_main_admin,
    require_window_staff,
    verify_branch_access,
)
from auth.helpers import (
    get_branch_assigned_window_number,
    get_branch_dashboard_url,
    get_branch_window_label,
    get_session_timeout_minutes,
    slugify_branch_name,
)
from auth.mfa import (
    check_mfa_recovery_confirm_rate_limit,
    check_mfa_recovery_rate_limit,
    delete_mfa_secret,
    find_active_mfa_recovery_otp,
    generate_mfa_payload,
    get_mfa_secret,
    get_mfa_secret_raw,
    hash_mfa_recovery_code,
    issue_mfa_recovery_otp,
    save_mfa_secret,
)
from auth.permissions import (
    ROLE_BRANCH_ADMIN,
    ROLE_BRANCH_STAFF,
    ROLE_MAIN_ADMIN,
    ROLE_PUBLIC,
    ROLE_SUPERADMIN,
    has_permission,
    is_admin_role,
    is_branch_role,
    require_role,
)
from auth.token_revocation import revoke_token

__all__ = [
    # jwt_utils
    "ALGORITHM",
    "ADMIN_SECRET_KEY",
    "BRANCH_SECRET_KEY",
    "PASSWORD_RESET_SECRET_KEY",
    "USER_SECRET_KEY",
    "create_access_token",
    "create_refresh_token",
    "decode_token",
    "get_portal_config",
    "PORTAL_CONFIG",
    # password_utils
    "hash_password",
    "pwd_context",
    "validate_password_strength",
    "verify_password",
    "verify_account_password",
    # decorators
    "decode_active_account_from_bearer_token",
    "get_current_admin_from_token",
    "get_current_admin_or_branch_staff",
    "get_current_admin_user",
    "get_current_branch_staff",
    "get_current_user",
    "get_optional_current_user",
    "require_admin_or_branch_role",
    "require_admin_role",
    "require_any_admin",
    "require_any_branch_staff",
    "require_branch_admin",
    "require_branch_admin_or_higher",
    "require_branch_role",
    "require_main_admin",
    "require_window_staff",
    "verify_branch_access",
    # permissions
    "ROLE_BRANCH_ADMIN",
    "ROLE_BRANCH_STAFF",
    "ROLE_MAIN_ADMIN",
    "ROLE_PUBLIC",
    "ROLE_SUPERADMIN",
    "has_permission",
    "is_admin_role",
    "is_branch_role",
    "require_role",
    # helpers
    "get_branch_assigned_window_number",
    "get_branch_dashboard_url",
    "get_branch_window_label",
    "get_session_timeout_minutes",
    "slugify_branch_name",
    # mfa
    "check_mfa_recovery_confirm_rate_limit",
    "check_mfa_recovery_rate_limit",
    "delete_mfa_secret",
    "find_active_mfa_recovery_otp",
    "generate_mfa_payload",
    "get_mfa_secret",
    "get_mfa_secret_raw",
    "hash_mfa_recovery_code",
    "issue_mfa_recovery_otp",
    "save_mfa_secret",
    # token_revocation
    "revoke_token",
]
