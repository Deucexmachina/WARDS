import os

from fastapi import HTTPException, status, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from jose import JWTError, jwt

from database.models import ActivityLog, Alert, Admin, BranchStaff, CitizenUser, get_db, SessionLocal
from auth.token_revocation import is_token_revoked
from utils.field_crypto import find_citizen_by_email
from utils.redis_client import get_redis_client
from utils.request_helpers import get_client_ip
from auth.jwt_utils import (
    ALGORITHM,
    ADMIN_SECRET_KEY,
    BRANCH_SECRET_KEY,
    USER_SECRET_KEY,
    PORTAL_CONFIG,
    decode_token,
)

BINDING_STRICT_MODE = os.getenv("TOKEN_BINDING_STRICT", "true").lower() == "true"
BINDING_CHECK_UA = os.getenv("TOKEN_BINDING_UA", "false").lower() == "true"


def _get_request_ip(request: Request) -> str:
    return get_client_ip(request)


def _log_spoofing_attempt(user: str, details: str, request: Request, title: str = "Spoofing Attempt") -> None:
    _log_blocked_security_attempt(title, user, details, request, severity="high")


def _log_blocked_security_attempt(
    title: str,
    user: str,
    details: str,
    request: Request,
    *,
    severity: str = "high",
) -> None:
    try:
        request.state.security_alert_logged = True
    except Exception:
        pass
    db = SessionLocal()
    try:
        host = request.headers.get("host") or "unknown"
        full_details = (
            f"{details}; method: {request.method}; path: {request.url.path}; "
            f"host: {host}; ip: {_get_request_ip(request)}; "
            f"ua: {request.headers.get('user-agent') or 'unknown'}"
        )
        try:
            db.add(ActivityLog(action=title, user=user, details=full_details, type="malicious", severity=severity))
            db.commit()
        except Exception:
            db.rollback()
        try:
            db.add(
                Alert(
                    type="malicious",
                    title=title,
                    message=full_details,
                    severity=severity,
                    read=False,
                )
            )
            db.commit()
        except Exception:
            db.rollback()
    except Exception:
        pass
    finally:
        db.close()


def log_blocked_security_attempt(
    title: str,
    user: str,
    details: str,
    request: Request,
    *,
    severity: str = "high",
) -> None:
    _log_blocked_security_attempt(title, user, details, request, severity=severity)


def _jwt_claims_without_verification(token: str) -> dict:
    try:
        return jwt.get_unverified_claims(token)
    except Exception:
        return {}


def _token_identity_from_claims(claims: dict) -> str:
    return str(claims.get("email") or claims.get("sub") or claims.get("username") or "unknown")


def _portal_payload_for_token(token: str, request: Request | None = None) -> tuple[str, dict] | tuple[None, None]:
    for portal, config in PORTAL_CONFIG.items():
        if portal == "unknown":
            continue
        try:
            payload = decode_token(token, config["secret_key"], options={"verify_exp": False})
        except JWTError:
            continue
        if request is not None:
            try:
                _validate_token_binding(request, payload)
            except HTTPException:
                pass
        return portal, payload
    return None, None


def _extract_any_auth_token_from_request(request: Request) -> str | None:
    for portal in ("admin", "branch", "public"):
        token = request.cookies.get(_get_cookie_name(portal))
        if token:
            return token
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header.split(" ", 1)[1]
    return None


def _describe_token_payload(payload: dict | None) -> str:
    payload = payload or {}
    return (
        f"token_portal: {payload.get('type') or payload.get('portal') or 'unknown'}; "
        f"role: {payload.get('internal_role') or payload.get('role') or 'unknown'}; "
        f"subject: {payload.get('email') or payload.get('sub') or 'unknown'}"
    )


def _log_auth_boundary_failure(expected_portal: str, token: str, request: Request, *, title: str | None = None) -> None:
    if not token:
        return
    portal, payload = _portal_payload_for_token(token)
    claims = payload or _jwt_claims_without_verification(token)
    user = _token_identity_from_claims(claims)
    host = request.headers.get("host") or ""
    direct_backend = host.endswith(":8000") or request.url.port == 8000
    expected_matches = (
        portal == expected_portal
        or (expected_portal == "admin_or_branch" and portal in {"admin", "branch"})
    )
    if portal and not expected_matches:
        _log_blocked_security_attempt(
            title or "Privilege Escalation Attempt",
            user,
            (
                f"Reason: cross-portal token used against protected {expected_portal} endpoint; "
                f"expected_portal: {expected_portal}; actual_portal: {portal}; "
                f"{_describe_token_payload(payload)}"
                + ("; direct_backend_ip_bypass: true" if direct_backend else "")
            ),
            request,
        )
        return
    if claims:
        _log_blocked_security_attempt(
            title or "JWT Tampering Attempt",
            user,
            (
                f"Reason: JWT rejected by protected {expected_portal} endpoint; "
                f"possible tampered, expired, replayed, or wrong-signature token; "
                f"{_describe_token_payload(claims)}"
                + ("; direct_backend_ip_bypass: true" if direct_backend else "")
            ),
            request,
        )
        return
    if direct_backend:
        _log_blocked_security_attempt(
            "Direct Backend Bypass Attempt",
            "unknown",
            f"Reason: direct backend request to protected {expected_portal} endpoint with invalid bearer token",
            request,
        )


def _validate_token_binding(request: Request, payload: dict) -> None:
    """Raise 401 if token ip or ua claims do not match the current request."""
    if not BINDING_STRICT_MODE:
        return
    # Super Admin manages branches from a variety of networks/devices; do not
    # flag them as spoofing for routine branch management.
    if payload.get("internal_role") == ROLE_SUPERADMIN:
        return
    client_ip = get_client_ip(request)
    user_agent = request.headers.get("user-agent") or ""
    token_ip = payload.get("ip")
    token_ua = payload.get("ua")
    user = payload.get("email") or payload.get("sub") or "unknown"
    if token_ip and token_ip != client_ip:
        _log_spoofing_attempt(
            user,
            f"Reason: Session binding mismatch (IP); expected_ip: {token_ip}; actual_ip: {client_ip}",
            request,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session binding mismatch (IP). Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if BINDING_CHECK_UA and token_ua and token_ua != user_agent:
        _log_spoofing_attempt(
            user,
            f"Reason: Session binding mismatch (device); expected_ua: {token_ua}; actual_ua: {user_agent}",
            request,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session binding mismatch (device). Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )


def _validate_active_session(portal: str, user_id: int | None, payload: dict, request: Request | None = None) -> None:
    """Raise 401 if the token session ID no longer matches the stored active session."""
    if not user_id:
        return
    # Super Admin manages branches from a variety of networks/devices; do not
    # flag them as spoofing for routine branch management.
    if payload.get("internal_role") == ROLE_SUPERADMIN:
        return
    r = get_redis_client()
    if not r:
        return
    stored_sid = r.get(f"wards:session:{portal}:{user_id}")
    token_sid = payload.get("sid")
    if stored_sid and token_sid and stored_sid != token_sid:
        if request is not None:
            _log_spoofing_attempt(
                payload.get("email") or payload.get("sub") or "unknown",
                (
                    "Reason: Session expired: logged in from another device; "
                    f"portal: {portal}; expected_sid: {stored_sid}; actual_sid: {token_sid}"
                ),
                request,
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired: logged in from another device.",
            headers={"WWW-Authenticate": "Bearer"},
        )
from auth.permissions import (
    ROLE_SUPERADMIN,
    ROLE_MAIN_ADMIN,
    ROLE_BRANCH_ADMIN,
    ROLE_BRANCH_STAFF,
)

security = HTTPBearer(auto_error=False)
optional_user_security = HTTPBearer(auto_error=False)

# Cookie names for each portal
def _get_cookie_name(portal: str) -> str:
    return f"wards_{portal}_access_token"


def _get_refresh_cookie_name(portal: str) -> str:
    return f"wards_{portal}_refresh_token"


COOKIE_PORTALS = ("admin", "branch", "public")


def _extract_token_from_request(request: Request, cookie_name: str) -> str | None:
    """Extract JWT from HttpOnly cookie first, then Authorization header."""
    token = request.cookies.get(cookie_name)
    if token:
        return token
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header.split(" ", 1)[1]
    return None


def set_auth_cookie(response, portal: str, token: str, max_age: int = 1800):
    """Set HttpOnly, Secure, SameSite=Lax auth cookie on a response."""
    response.set_cookie(
        key=_get_cookie_name(portal),
        value=token,
        httponly=True,
        secure=True,
        samesite="Lax",
        max_age=max_age,
        path="/",
    )


def set_refresh_cookie(response, portal: str, token: str, max_age: int = 604800):
    """Set HttpOnly, Secure, SameSite=Lax refresh cookie on a response."""
    response.set_cookie(
        key=_get_refresh_cookie_name(portal),
        value=token,
        httponly=True,
        secure=True,
        samesite="Lax",
        max_age=max_age,
        path="/",
    )


def clear_auth_cookies(response):
    """Clear all auth and refresh cookies."""
    for portal in COOKIE_PORTALS:
        response.delete_cookie(key=_get_cookie_name(portal), path="/")
        response.delete_cookie(key=_get_refresh_cookie_name(portal), path="/")


async def get_current_admin_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> Admin | BranchStaff:
    token = _extract_token_from_request(request, _get_cookie_name("admin")) or (credentials.credentials if credentials else None)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
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
        _validate_active_session("admin", payload.get("user_id"), payload, request)
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

    _log_auth_boundary_failure("admin", token or _extract_any_auth_token_from_request(request), request)
    raise credentials_exception


def require_admin_role(*allowed_roles: str):
    async def role_checker(
        current_user: Admin = Depends(get_current_admin_user),
        request: Request = None,
    ) -> Admin:
        if current_user.role not in allowed_roles:
            if request is not None:
                _log_blocked_security_attempt(
                    "Privilege Escalation Attempt",
                    getattr(current_user, "email", None) or getattr(current_user, "username", "unknown"),
                    (
                        "Reason: authenticated admin role is not allowed for protected endpoint; "
                        f"current_role: {current_user.role}; required_roles: {', '.join(allowed_roles)}"
                    ),
                    request,
                )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required roles: {', '.join(allowed_roles)}"
            )
        return current_user
    return role_checker


def require_main_admin():
    return require_admin_role(ROLE_MAIN_ADMIN, ROLE_SUPERADMIN)


def require_admin_or_branch_role(*allowed_roles: str):
    async def role_checker(
        current_user=Depends(get_current_admin_or_branch_staff),
        request: Request = None,
    ):
        if current_user.role not in allowed_roles:
            if request is not None:
                _log_blocked_security_attempt(
                    "Privilege Escalation Attempt",
                    getattr(current_user, "email", None) or getattr(current_user, "username", "unknown"),
                    (
                        "Reason: authenticated account role is not allowed for protected endpoint; "
                        f"current_role: {current_user.role}; required_roles: {', '.join(allowed_roles)}"
                    ),
                    request,
                )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required roles: {', '.join(allowed_roles)}"
            )
        return current_user
    return role_checker


def require_branch_admin_or_higher():
    return require_admin_or_branch_role(ROLE_BRANCH_ADMIN, ROLE_MAIN_ADMIN, ROLE_SUPERADMIN)


def require_any_admin():
    return require_admin_or_branch_role(ROLE_BRANCH_STAFF, ROLE_BRANCH_ADMIN, ROLE_MAIN_ADMIN, ROLE_SUPERADMIN)


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> CitizenUser:
    token = _extract_token_from_request(request, _get_cookie_name("public")) or (credentials.credentials if credentials else None)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
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
        _validate_active_session("public", payload.get("user_id"), payload, request)
        email = payload.get("email") or payload.get("sub")
        token_type = payload.get("type")

        if email and token_type in ("user", "public"):
            user = find_citizen_by_email(db, CitizenUser, email)
            if user and user.status == "Active":
                return user
    except JWTError:
        pass

    _log_auth_boundary_failure("public", token or _extract_any_auth_token_from_request(request), request)
    raise credentials_exception


async def get_optional_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(optional_user_security),
    db: Session = Depends(get_db),
) -> CitizenUser | None:
    token = _extract_token_from_request(request, _get_cookie_name("public")) or (credentials.credentials if credentials else None)
    if not token:
        return None

    if is_token_revoked(db, token):
        return None

    try:
        payload = decode_token(token, USER_SECRET_KEY)
        _validate_token_binding(request, payload)
        _validate_active_session("public", payload.get("user_id"), payload, request)
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
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> BranchStaff:
    token = _extract_token_from_request(request, _get_cookie_name("branch")) or (credentials.credentials if credentials else None)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
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
        _validate_active_session("branch", payload.get("user_id"), payload, request)
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

    _log_auth_boundary_failure("branch", token or _extract_any_auth_token_from_request(request), request)
    raise credentials_exception


async def get_current_admin_or_branch_staff(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
):
    # Try admin cookie first, then branch cookie, then Authorization header
    admin_token = _extract_token_from_request(request, _get_cookie_name("admin"))
    branch_token = _extract_token_from_request(request, _get_cookie_name("branch"))
    header_token = credentials.credentials if credentials else None
    token = admin_token or branch_token or header_token

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if is_token_revoked(db, token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session has been logged out")

    # Try admin auth first
    try:
        payload = decode_token(token, ADMIN_SECRET_KEY)
        _validate_token_binding(request, payload)
        _validate_active_session("admin", payload.get("user_id"), payload, request)
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
    except (JWTError, HTTPException):
        pass

    # Fall back to branch auth
    try:
        payload = decode_token(token, BRANCH_SECRET_KEY)
        _validate_token_binding(request, payload)
        _validate_active_session("branch", payload.get("user_id"), payload, request)
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
    except (JWTError, HTTPException):
        pass

    _log_auth_boundary_failure("admin_or_branch", token or _extract_any_auth_token_from_request(request), request)
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


def require_branch_role(*allowed_roles: str):
    async def role_checker(
        current_staff: BranchStaff = Depends(get_current_branch_staff),
        request: Request = None,
    ) -> BranchStaff:
        if current_staff.role not in allowed_roles:
            if request is not None:
                _log_blocked_security_attempt(
                    "Privilege Escalation Attempt",
                    getattr(current_staff, "email", None) or getattr(current_staff, "username", "unknown"),
                    (
                        "Reason: branch account role is not allowed for protected endpoint; "
                        f"current_role: {current_staff.role}; required_roles: {', '.join(allowed_roles)}"
                    ),
                    request,
                )
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
    request: Request,
    current_user: Admin = Depends(get_current_admin_user),
) -> Admin:
    if current_user.role in {ROLE_MAIN_ADMIN, ROLE_SUPERADMIN}:
        return current_user

    _log_blocked_security_attempt(
        "Privilege Escalation Attempt",
        getattr(current_user, "email", None) or getattr(current_user, "username", "unknown"),
        (
            "Reason: admin account attempted branch access without required role; "
            f"current_role: {current_user.role}; target_branch_id: {branch_id}"
        ),
        request,
    )
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Access denied to this branch"
    )


async def get_current_admin_from_token(request: Request, db: Session) -> Admin:
    token = _extract_token_from_request(request, _get_cookie_name("admin"))
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ", 1)[1]

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authorization"
        )

    if is_token_revoked(db, token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session has been logged out")

    try:
        payload = decode_token(token, ADMIN_SECRET_KEY)
        _validate_token_binding(request, payload)
        _validate_active_session("admin", payload.get("user_id"), payload, request)
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

    _log_auth_boundary_failure("admin", token or _extract_any_auth_token_from_request(request), request)
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token"
    )


def decode_active_account_from_bearer_token(
    token: str,
    db: Session,
    allowed_portals: tuple[str, ...] = ("public", "admin", "branch"),
    request: Request | None = None,
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

        if request is not None:
            _validate_token_binding(request, payload)
        _validate_active_session(portal, payload.get("user_id"), payload, request)
        return portal, account, payload

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
