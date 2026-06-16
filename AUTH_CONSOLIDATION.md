# Authentication System Consolidation Guide

## Status: COMPLETE

All phases of the authentication consolidation have been executed. The system now operates under a single canonical auth package (`auth/`) and a single auth route (`unified_auth.py`).

## Final Architecture

```
WARDS/backend/
├── auth/                          # Canonical auth package
│   ├── __init__.py               # Re-exports common utilities
│   ├── jwt_utils.py              # JWT creation, validation, secret management
│   ├── password_utils.py         # Password hashing, verification, strength rules
│   ├── mfa.py                    # TOTP/MFA secrets, QR codes, recovery OTPs
│   ├── permissions.py            # Role constants and hierarchy
│   └── decorators.py             # FastAPI dependency injectors
├── routes/
│   └── unified_auth.py           # Sole auth route (all portals)
├── middleware/
│   └── dos_protection.py         # DoS protection (uses auth.jwt_utils)
```

## auth/ Package

### `auth/jwt_utils.py`

Loads secrets **exclusively** from environment variables with no hardcoded fallbacks. Missing secrets raise `RuntimeError` at import time.

| Variable | Purpose |
|----------|---------|
| `SECRET_KEY` | Legacy/generic JWT secret |
| `ADMIN_SECRET_KEY` | Admin portal tokens |
| `USER_SECRET_KEY` | Public/citizen user tokens |
| `AUTH_SECRET_KEY` | Unified auth tokens (legacy compat) |
| `BRANCH_SECRET_KEY` | Branch staff tokens |
| `PASSWORD_RESET_SECRET_KEY` | Password reset token signing |

Key functions:
- `create_access_token(data, expires_delta, secret_key)` — Encode a JWT
- `decode_token(token, secret_key)` — Decode and validate a JWT
- `get_portal_config(portal)` — Return portal-specific config dict

### `auth/password_utils.py`

- `pwd_context` — `passlib` bcrypt `CryptContext`
- `verify_password(plain, hashed)` — Check password
- `hash_password(plain)` — Hash password
- `validate_password_strength(password)` — Enforce strength rules

### `auth/mfa.py`

- `get_mfa_secret(db, portal, username)` — Retrieve active MFA secret
- `get_mfa_secret_raw(db, portal, username)` — Retrieve raw MFA record
- `save_mfa_secret(db, portal, username, secret, enabled)` — Persist secret
- `generate_mfa_payload(portal, username, secret)` — Build QR provisioning URI
- `issue_mfa_recovery_otp(db, portal, username)` — Generate recovery code
- `check_mfa_recovery_rate_limit(...)` / `check_mfa_recovery_confirm_rate_limit(...)`

### `auth/permissions.py`

Role constants:
- `ROLE_SUPERADMIN`
- `ROLE_MAIN_ADMIN`
- `ROLE_BRANCH_ADMIN`
- `ROLE_BRANCH_STAFF`

Hierarchy helpers and permission-checking functions.

### `auth/decorators.py`

FastAPI `Depends()` injectors:

| Injector | Returns | Validates |
|----------|---------|-----------|
| `get_current_admin_user` | `Admin \| BranchStaff` | Auth/admin/branch secret, token type `admin`/`branch`, active status |
| `get_current_user` | `CitizenUser` | Auth/user secret, token type `user`/`public`, active status |
| `get_current_branch_staff` | `BranchStaff` | Auth/branch secret, token type `branch`, active status |
| `get_current_admin_from_token(request, db)` | `Admin` | Admin secret only |
| `require_main_admin()` | `Admin` | Role must be `main_admin` or `superadmin` |
| `require_branch_admin()` | `BranchStaff` | Role must be `branch_admin` |
| `require_any_branch_staff()` | `BranchStaff` | Role must be `branch_admin` or `branch_staff` |
| `require_any_admin()` | `Admin \| BranchStaff` | Any admin or branch role |
| `decode_active_account_from_bearer_token(token, db, allowed_portals)` | `(portal, account, payload)` | Multi-portal token decode |

## unified_auth.py — The Sole Auth Route

Handles **all** authentication flows for every portal:

| Endpoint | Portal | Purpose |
|----------|--------|---------|
| `POST /login` | all | Login with identifier + password |
| `POST /verify` | all | Verify bearer token validity |
| `POST /logout` | all | Revoke token and logout |
| `POST /me` | all | Return current user profile |
| `POST /setup-mfa` | all | Initiate MFA setup (generate secret + QR) |
| `POST /verify-mfa-setup` | all | Confirm MFA setup with TOTP code |
| `POST /disable-mfa` | all | Disable MFA for account |
| `POST /mfa-recovery` | all | Request MFA recovery OTP |
| `POST /confirm-mfa-recovery` | all | Confirm recovery and disable MFA |
| `POST /request-password-reset` | all | Send password reset email |
| `POST /reset-password` | all | Reset password with token |

## Migration Guide for Route Developers

### Importing Dependency Injectors

**Before (legacy):**
```python
from middleware.admin_auth import get_current_admin_user
from middleware.branch_auth import get_current_branch_staff, require_branch_admin
from middleware.user_auth import get_current_user
```

**After (consolidated):**
```python
from auth.decorators import get_current_admin_user
from auth.decorators import get_current_branch_staff, require_branch_admin
from auth.decorators import get_current_user
```

### Creating Tokens

**Before:**
```python
from jose import jwt
SECRET_KEY = "hardcoded-fallback"
encoded = jwt.encode(data, SECRET_KEY, algorithm="HS256")
```

**After:**
```python
from auth.jwt_utils import create_access_token, BRANCH_SECRET_KEY
token = create_access_token(data, expires_delta=timedelta(minutes=30), secret_key=BRANCH_SECRET_KEY)
```

### Password Hashing

**Before:**
```python
from passlib.context import CryptContext
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
pwd_context.verify(plain, hashed)
```

**After:**
```python
from auth.password_utils import verify_password, hash_password
verify_password(plain, hashed)
hash_password(plain)
```

## Environment Variables

All required variables are listed in `WARDS/backend/.env.example`:

```
SECRET_KEY=replace-with-a-long-random-secret
ADMIN_SECRET_KEY=replace-with-a-different-long-random-admin-secret
USER_SECRET_KEY=replace-with-a-long-random-user-secret
AUTH_SECRET_KEY=replace-with-a-long-random-unified-auth-secret
BRANCH_SECRET_KEY=replace-with-a-long-random-branch-secret
PASSWORD_RESET_SECRET_KEY=replace-with-a-long-random-password-reset-secret
RECAPTCHA_SECRET_KEY=your-recaptcha-secret-key
```

The application will **fail to start** with a descriptive `RuntimeError` if any required secret is missing.

## Deleted Files (No Longer in Active Tree)

| File | Reason |
|------|--------|
| `routes/auth.py` | Deprecated shim; unified_auth handles all auth |
| `routes/admin_auth_v2.py` | Deprecated shim |
| `routes/user_auth_v2.py` | 1,230-line duplicate auth logic |
| `routes/branch_auth_v2.py` | 764-line duplicate auth logic |
| `routes/public_auth.py` | 353-line duplicate auth logic |
| `routes/user_auth.py` | 445-line dead code (not mounted) |
| `routes/branch_auth.py` | 328-line dead code (not mounted) |
| `routes/admin_auth.py` | 410 GONE stub (not mounted) |
| `middleware/admin_auth.py` | Logic moved to `auth.decorators` |
| `middleware/user_auth.py` | Logic moved to `auth.decorators` |
| `middleware/branch_auth.py` | Logic moved to `auth.decorators` |

## Registration in main.py

```python
# Only unified auth router is registered
app.include_router(unified_auth.router, prefix="/api/auth/unified", tags=["Unified Authentication"])
app.include_router(unified_auth.router, prefix="/api/public/auth", tags=["Public Authentication"])
```

## Safety Guarantees

1. **No hardcoded secrets** anywhere in routes or middleware.
2. **Fail-fast** on missing environment variables.
3. **Single source of truth** for JWT, password, MFA, and permission logic.
4. **Token revocation** checked in every dependency injector.
