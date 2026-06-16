import os

from fastapi import HTTPException, status, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from jose import JWTError, jwt

from database.models import Admin, BranchStaff, CitizenUser, get_db
from auth.token_revocation import is_token_revoked
from utils.field_crypto import find_citizen_by_email
from auth.jwt_utils import (
    ALGORITHM,
    ADMIN_SECRET_KEY,
    BRANCH_SECRET_KEY,
    USER_SECRET_KEY,
    PORTAL_CONFIG,
    decode_token,
)

BINDING_STRICT_MODE = os.getenv("TOKEN_BINDING_STRICT", "true").lower() == "true"


def _validate_token_binding(request: Request, payload: dict) -> None:
    """Raise 401 if token ip or ua claims do not match the current request."""
    if not BINDING_STRICT_MODE:
        return
    client_ip = request.client.host if request.client else "unknown"
    user_agent = request.headers.get("user-agent") or ""
    token_ip = payload.get("ip")
    token_ua = payload.get("ua")
    if token_ip and token_ip != client_ip:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session binding mismatch (IP). Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if token_ua and token_ua != user_agent:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session binding mismatch (device). Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
from auth.permissions import (
    ROLE_SUPERADMIN,
    ROLE_MAIN_ADMIN,
    ROLE_BRANCH_ADMIN,
    ROLE_BRANCH_STAFF,
)

security = HTTPBearer()
optional_user_security = HTTPBearer(auto_error=False)


async def get_current_admin_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> Admin | BranchStaff:
    token = credentials.credentials
    if is_token_revoked(db, token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session has been logged out")

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = decode_token(token, ADMIN_SECRET_KEY)
        _validate_token_binding(request, payload)
        email = payload.get("email") or payload.get("sub")
        username = payload.get("sub")
        token_type = payload.get("type")

        if token_type == "admin":
            user = None
            if email:
                user = db.query(Admin).filter(Admin.email == email).first()
            if user is None and username:
                user = db.query(Admin).filter(Admin.username == username).first()
            if user and user.status == "Active":
                return user
    except JWTError:
        pass

    raise credentials_exception


def require_admin_role(*allowed_roles: str):
    async def role_checker(
        current_user: Admin = Depends(get_current_admin_user),
    ) -> Admin:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required roles: {', '.join(allowed_roles)}"
            )
        return current_user
    return role_checker


def require_main_admin():
    return require_admin_role(ROLE_MAIN_ADMIN, ROLE_SUPERADMIN)


def require_branch_admin_or_higher():
    # Branch admin must use branch-specific auth; this helper is kept for API compat
    return require_admin_role(ROLE_MAIN_ADMIN, ROLE_SUPERADMIN)


def require_any_admin():
    # Branch staff must use branch-specific auth; this helper is kept for API compat
    return require_admin_role(ROLE_MAIN_ADMIN, ROLE_SUPERADMIN)


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> CitizenUser:
    token = credentials.credentials
    if is_token_revoked(db, token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session has been logged out")

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = decode_token(token, USER_SECRET_KEY)
        _validate_token_binding(request, payload)
        email = payload.get("email") or payload.get("sub")
        token_type = payload.get("type")

        if email and token_type in ("user", "public"):
            user = find_citizen_by_email(db, CitizenUser, email)
            if user and user.status == "Active":
                return user
    except JWTError:
        pass

    raise credentials_exception


async def get_optional_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(optional_user_security),
    db: Session = Depends(get_db),
) -> CitizenUser | None:
    if credentials is None:
        return None

    token = credentials.credentials
    if is_token_revoked(db, token):
        return None

    try:
        payload = decode_token(token, USER_SECRET_KEY)
        _validate_token_binding(request, payload)
        email = payload.get("email") or payload.get("sub")
        token_type = payload.get("type")
        if email and token_type in ("user", "public"):
            user = find_citizen_by_email(db, CitizenUser, email)
            if user and user.status == "Active":
                return user
    except JWTError:
        pass

    return None


async def get_current_branch_staff(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> BranchStaff:
    token = credentials.credentials
    if is_token_revoked(db, token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session has been logged out")

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = decode_token(token, BRANCH_SECRET_KEY)
        _validate_token_binding(request, payload)
        email = payload.get("email") or payload.get("sub")
        username = payload.get("sub")
        token_type = payload.get("type")

        if token_type == "branch":
            staff = None
            if email:
                staff = db.query(BranchStaff).filter(BranchStaff.email == email).first()
            if staff is None and username:
                staff = db.query(BranchStaff).filter(BranchStaff.username == username).first()
            if staff and staff.status == "Active":
                return staff
    except JWTError:
        pass

    raise credentials_exception


def require_branch_role(*allowed_roles: str):
    async def role_checker(
        current_staff: BranchStaff = Depends(get_current_branch_staff),
    ) -> BranchStaff:
        if current_staff.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required roles: {', '.join(allowed_roles)}"
            )
        return current_staff
    return role_checker


def require_branch_admin():
    return require_branch_role(ROLE_BRANCH_ADMIN)


def require_any_branch_staff():
    return require_branch_role(ROLE_BRANCH_ADMIN, ROLE_BRANCH_STAFF)


def require_window_staff(staff: BranchStaff) -> BranchStaff:
    if staff.account_scope != "queue_window":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint is only available to window staff accounts.",
        )
    return staff


async def verify_branch_access(
    branch_id: int,
    current_user: Admin = Depends(get_current_admin_user),
) -> Admin:
    if current_user.role in {ROLE_MAIN_ADMIN, ROLE_SUPERADMIN}:
        return current_user

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Access denied to this branch"
    )


async def get_current_admin_from_token(request: Request, db: Session) -> Admin:
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authorization header"
        )

    token = auth_header.split(" ")[1]
    if is_token_revoked(db, token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session has been logged out")

    try:
        payload = decode_token(token, ADMIN_SECRET_KEY)
        _validate_token_binding(request, payload)
        email = payload.get("email") or payload.get("sub")
        username = payload.get("sub")

        admin = None
        if email:
            admin = db.query(Admin).filter(Admin.email == email).first()
        if admin is None and username:
            admin = db.query(Admin).filter(Admin.username == username).first()

        if admin and admin.status == "Active":
            return admin
    except JWTError:
        pass

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token"
    )


def decode_active_account_from_bearer_token(
    token: str,
    db: Session,
    allowed_portals: tuple[str, ...] = ("public", "admin", "branch"),
):
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    for portal, config in PORTAL_CONFIG.items():
        if portal not in allowed_portals:
            continue
        try:
            payload = jwt.decode(token, config["secret_key"], algorithms=[ALGORITHM])
        except JWTError:
            continue

        token_type = payload.get("type")
        if token_type != config["token_type"]:
            continue

        if portal == "public":
            account = find_citizen_by_email(db, CitizenUser, payload.get("sub"))
        elif portal == "admin":
            identifier = payload.get("email") or payload.get("sub")
            account = db.query(Admin).filter(
                (Admin.email == identifier) | (Admin.username == payload.get("sub"))
            ).first()
        else:
            identifier = payload.get("email") or payload.get("sub")
            account = db.query(BranchStaff).filter(
                (BranchStaff.email == identifier) | (BranchStaff.username == payload.get("sub"))
            ).first()

        if not account or getattr(account, "status", "Active") != "Active":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

        return portal, account, payload

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
