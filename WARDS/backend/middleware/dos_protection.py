"""
DoS Protection Middleware
- Request size limits
- Request timeout enforcement
- IP-based connection tracking
- Endpoint-specific abuse detection and escalating temporary blocking
- Manual blocklist (database-backed)
- IP reputation checking
"""
from fastapi import Request, HTTPException, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp
import time
import asyncio
from collections import defaultdict
from datetime import datetime
from typing import Dict, Optional
import os
import ipaddress
import json
from pathlib import Path
from auth import ADMIN_SECRET_KEY, BRANCH_SECRET_KEY, USER_SECRET_KEY, decode_token
from utils.redis_client import get_redis_client

MAX_REQUEST_SIZE = int(os.getenv("MAX_REQUEST_SIZE_BYTES", 50 * 1024 * 1024))  # 50MB
MAX_FILES_PER_REQUEST = int(os.getenv("MAX_FILES_PER_REQUEST", 5))
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT_SECONDS", 120))
REQUEST_TIMEOUT_EXEMPT_PATHS = tuple(
    item.strip()
    for item in os.getenv(
        "REQUEST_TIMEOUT_EXEMPT_PATHS",
        "/api/security/backup,/api/security/recover,/api/security/scan,/security/backup,/security/recover,/security/scan",
    ).split(",")
    if item.strip()
)
MAX_CONCURRENT_REQUESTS_PER_IP = int(os.getenv("MAX_CONCURRENT_REQUESTS_PER_IP", 50))
ABUSE_THRESHOLD = int(os.getenv("ABUSE_THRESHOLD_REQUESTS", 300))
ABUSE_WINDOW = int(os.getenv("ABUSE_WINDOW_SECONDS", 60))
ADMIN_ABUSE_THRESHOLD = int(os.getenv("ADMIN_ABUSE_THRESHOLD_REQUESTS", 600))
SEARCH_ABUSE_THRESHOLD = int(os.getenv("SEARCH_ABUSE_THRESHOLD_REQUESTS", 120))
SEARCH_ABUSE_WINDOW = int(os.getenv("SEARCH_ABUSE_WINDOW_SECONDS", 60))
AUTH_ABUSE_THRESHOLD = int(os.getenv("AUTH_ABUSE_THRESHOLD_REQUESTS", 10))
AUTH_ABUSE_WINDOW = int(os.getenv("AUTH_ABUSE_WINDOW_SECONDS", 15 * 60))
REGISTRATION_ABUSE_THRESHOLD = int(os.getenv("REGISTRATION_ABUSE_THRESHOLD_REQUESTS", 5))
REGISTRATION_ABUSE_WINDOW = int(os.getenv("REGISTRATION_ABUSE_WINDOW_SECONDS", 60 * 60))
PASSWORD_RESET_ABUSE_THRESHOLD = int(os.getenv("PASSWORD_RESET_ABUSE_THRESHOLD_REQUESTS", 5))
PASSWORD_RESET_ABUSE_WINDOW = int(os.getenv("PASSWORD_RESET_ABUSE_WINDOW_SECONDS", 60 * 60))
STRIKE_WINDOW = int(os.getenv("ABUSE_STRIKE_WINDOW_SECONDS", 7 * 24 * 60 * 60))
CAPTCHA_AFTER_STRIKES = int(os.getenv("ABUSE_CAPTCHA_AFTER_STRIKES", 2))
REPUTATION_BLOCK_THRESHOLD = int(os.getenv("REPUTATION_BLOCK_THRESHOLD", 50))
ENABLE_IP_REPUTATION = os.getenv("ENABLE_IP_REPUTATION", "true").lower() == "true"
AUTO_BLOCK_MALICIOUS = os.getenv("AUTO_BLOCK_MALICIOUS", "false").lower() == "true"
EXEMPT_PRIVATE_IPS = os.getenv("ABUSE_EXEMPT_PRIVATE_IPS", "false").lower() == "true"
EXEMPT_IPS = {
    item.strip()
    for item in os.getenv("ABUSE_EXEMPT_IPS", "127.0.0.1,::1,localhost").split(",")
    if item.strip()
}

# Track active requests per IP
active_requests: Dict[str, int] = defaultdict(int)

_DOS_STATE_PATH = Path(os.getenv("DOS_STATE_PATH", "./dos_state.json"))
_DOS_STATE_SAVE_INTERVAL = float(os.getenv("DOS_STATE_SAVE_INTERVAL", "5"))  # seconds
_last_dos_state_save = 0.0


def _load_dos_state() -> dict:
    r = get_redis_client()
    if r:
        result = {}
        for field, key in [
            ("request_history", "wards:dos:request_history"),
            ("endpoint_request_history", "wards:dos:endpoint_request_history"),
            ("failed_auth_history", "wards:dos:failed_auth_history"),
            ("block_strikes", "wards:dos:block_strikes"),
            ("reputation_strikes", "wards:dos:reputation_strikes"),
            ("blocked_ips", "wards:dos:blocked_ips"),
            ("manual_review_incidents", "wards:dos:manual_review_incidents"),
            ("account_rate_limit_state", "wards:dos:account_rate_limit_state"),
        ]:
            data = r.hgetall(key)
            if data:
                if field in ("blocked_ips", "manual_review_incidents"):
                    result[field] = {k: float(v) for k, v in data.items()}
                elif field == "account_rate_limit_state":
                    result[field] = {k: json.loads(v) for k, v in data.items()}
                else:
                    result[field] = {k: json.loads(v) for k, v in data.items()}
        # Prune expired blocked_ips
        current_time = time.time()
        expired = [ip for ip, unblock_time in result.get("blocked_ips", {}).items() if unblock_time < current_time]
        for ip in expired:
            r.hdel("wards:dos:blocked_ips", ip)
            del result["blocked_ips"][ip]
        return result
    # Fallback to file
    if not _DOS_STATE_PATH.exists():
        return {}
    try:
        with _DOS_STATE_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
        current_time = time.time()
        for key in list(data.get("blocked_ips", {}).keys()):
            if data["blocked_ips"][key] < current_time:
                del data["blocked_ips"][key]
        return data
    except (json.JSONDecodeError, OSError):
        return {}


def _save_dos_state() -> None:
    global _last_dos_state_save
    current_time = time.time()
    if current_time - _last_dos_state_save < _DOS_STATE_SAVE_INTERVAL:
        return
    _last_dos_state_save = current_time

    r = get_redis_client()
    if r:
        try:
            pipe = r.pipeline()
            pipe.hset("wards:dos:request_history", mapping={k: json.dumps(v) for k, v in request_history.items()})
            pipe.hset("wards:dos:endpoint_request_history", mapping={k: json.dumps(v) for k, v in endpoint_request_history.items()})
            pipe.hset("wards:dos:failed_auth_history", mapping={k: json.dumps(v) for k, v in failed_auth_history.items()})
            pipe.hset("wards:dos:block_strikes", mapping={k: json.dumps(v) for k, v in block_strikes.items()})
            pipe.hset("wards:dos:reputation_strikes", mapping={k: json.dumps(v) for k, v in reputation_strikes.items()})
            pipe.hset("wards:dos:blocked_ips", mapping={k: str(v) for k, v in blocked_ips.items()})
            pipe.hset("wards:dos:manual_review_incidents", mapping={k: str(v) for k, v in manual_review_incidents.items()})
            pipe.hset("wards:dos:account_rate_limit_state", mapping={k: json.dumps(v) for k, v in account_rate_limit_state.items()})
            pipe.execute()
        except Exception:
            pass
        return

    # Fallback to file
    try:
        with _DOS_STATE_PATH.open("w", encoding="utf-8") as f:
            json.dump(
                {
                    "request_history": dict(request_history),
                    "endpoint_request_history": dict(endpoint_request_history),
                    "failed_auth_history": dict(failed_auth_history),
                    "block_strikes": dict(block_strikes),
                    "reputation_strikes": dict(reputation_strikes),
                    "blocked_ips": blocked_ips,
                    "manual_review_incidents": manual_review_incidents,
                    "account_rate_limit_state": dict(account_rate_limit_state),
                },
                f,
            )
    except OSError:
        pass


# Load persisted state if available
_dos_data = _load_dos_state()

# Track request counts for abuse detection
request_history: Dict[str, list] = defaultdict(list, _dos_data.get("request_history", {}))
endpoint_request_history: Dict[str, list] = defaultdict(list, _dos_data.get("endpoint_request_history", {}))
failed_auth_history: Dict[str, list] = defaultdict(list, _dos_data.get("failed_auth_history", {}))
block_strikes: Dict[str, list] = defaultdict(list, _dos_data.get("block_strikes", {}))
reputation_strikes: Dict[str, list] = defaultdict(list, _dos_data.get("reputation_strikes", {}))
# Track blocked IPs (temporary, in-memory; reserved for explicit infrastructure protection only)
blocked_ips: Dict[str, float] = _dos_data.get("blocked_ips", {})  # IP -> unblock time
manual_review_incidents: Dict[str, float] = _dos_data.get("manual_review_incidents", {})
account_rate_limit_state: Dict[str, dict] = defaultdict(
    lambda: {
        "violation_count": 0,
        "strike_count": 0,
        "last_violation_timestamp": None,
        "last_strike_timestamp": None,
        "restricted_until_by_scope": {},
    },
    _dos_data.get("account_rate_limit_state", {}),
)

# Cache for permanent blocks (in-memory cache to reduce DB calls)
_permanent_blocks_cache: Dict[str, bool] = {}
_permanent_blocks_cache_time: float = 0
PERMANENT_BLOCKS_CACHE_TTL = 60  # Cache for 60 seconds

AUTH_PATH_MARKERS = (
    "/auth",
    "/login",
    "/mfa",
    "/otp",
    "/verify-email",
    "/forgot-password",
    "/reset-password",
)

REGISTRATION_PATH_MARKERS = (
    "/register",
    "/queue/register",
)

PASSWORD_RESET_PATH_MARKERS = (
    "/request-password-reset",
    "/forgot-password",
)

SEARCH_PATH_MARKERS = (
    "/search",
)

ADMIN_PATH_MARKERS = (
    "/admin",
    "/dashboard",
    "/security-dashboard",
)


def is_auth_sensitive_path(path: str) -> bool:
    normalized = (path or "").lower()
    return any(marker in normalized for marker in AUTH_PATH_MARKERS)


def path_has_marker(path: str, markers: tuple) -> bool:
    normalized = (path or "").lower()
    return any(marker in normalized for marker in markers)


def is_login_path(path: str) -> bool:
    normalized = (path or "").lower().rstrip("/")
    return normalized.endswith("/login") or "/login/" in normalized


def is_registration_path(path: str) -> bool:
    return path_has_marker(path, REGISTRATION_PATH_MARKERS)


def is_password_reset_request_path(path: str) -> bool:
    normalized = (path or "").lower()
    return any(marker in normalized for marker in PASSWORD_RESET_PATH_MARKERS)


def is_search_path(path: str) -> bool:
    return path_has_marker(path, SEARCH_PATH_MARKERS)


def is_admin_path(path: str) -> bool:
    return path_has_marker(path, ADMIN_PATH_MARKERS)


def prune_timestamps(values: list, current_time: float, window: int) -> list:
    return [ts for ts in values if current_time - ts < window]


def is_exempt_ip(ip: str) -> bool:
    if ip in EXEMPT_IPS:
        return True
    try:
        parsed = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return EXEMPT_PRIVATE_IPS and (parsed.is_loopback or parsed.is_private)


def register_block_strike(ip: str, current_time: float) -> int:
    block_strikes[ip] = prune_timestamps(block_strikes[ip], current_time, STRIKE_WINDOW)
    block_strikes[ip].append(current_time)
    _save_dos_state()
    return len(block_strikes[ip])


def temporary_block_duration(strikes: int) -> int:
    if strikes <= 1:
        return 15 * 60
    if strikes == 2:
        return 60 * 60
    if strikes == 3:
        return 24 * 60 * 60
    return 7 * 24 * 60 * 60


def account_from_request(request: Request, client_ip: str) -> tuple[str, str, str]:
    auth_header = request.headers.get("Authorization") or ""
    token = auth_header.split(" ", 1)[1] if auth_header.startswith("Bearer ") else ""
    if not token:
        return f"anonymous:{client_ip}", "anonymous", "anonymous"

    # Map token type to its canonical secret to prevent cross-portal acceptance
    type_to_secret = {
        "user": USER_SECRET_KEY,
        "admin": ADMIN_SECRET_KEY,
        "branch": BRANCH_SECRET_KEY,
    }

    # Try decoding with each secret but only accept tokens whose declared type matches the secret
    for declared_type, secret in type_to_secret.items():
        try:
            payload = decode_token(token, secret)
            token_type = str(payload.get("type") or "")
            if token_type != declared_type:
                continue
            account_id = str(payload.get("user_id") or payload.get("sub") or "")
            role = str(payload.get("role") or token_type)
            if account_id:
                return f"{token_type}:{account_id}", token_type, role
        except Exception:
            continue
    return f"anonymous:{client_ip}", "anonymous", "anonymous"


def detection_type_for_scope(scope: str) -> str:
    if scope == "search":
        return "Excessive Portal Requests"
    if scope == "registration":
        return "Excessive Queue Requests"
    if scope == "admin_general":
        return "Repeated Administrative Abuse"
    if scope == "authentication_failed":
        return "Repeated Authentication Abuse"
    return "Repeated Rate Limit Abuse"


def record_rate_limit_detection(account_key: str, account_type: str, role: str, scope: str, strikes: int, reason: str, duration: int) -> None:
    try:
        from database.models import SessionLocal, ActivityLog, authorize_database_session
        from SECURITY.security_models import SecurityDetectionEvent

        db = SessionLocal()
        try:
            authorize_database_session(db, context="account_rate_limit_detection", actor="dos_protection")
            context = {
                "account_id": account_key,
                "account_type": account_type,
                "role": role,
                "detection_type": detection_type_for_scope(scope),
                "strike_level": strikes,
                "restriction_seconds": duration,
                "scope": scope,
                "reason": reason,
            }
            detection = SecurityDetectionEvent(
                file_id=None,
                target_type="account",
                target_name=account_key,
                actor=account_key,
                change_type="account_rate_limit_restriction",
                old_hash=None,
                new_hash=None,
                is_legitimate=False,
                admin_id=None,
                ai_score=None,
                ai_prediction="suspicious",
                confidence=1.0,
                severity_level="medium" if strikes < 4 else "high",
                cvss_score=5.0 if strikes < 4 else 6.5,
                nist_category="CAT 6 - Investigation",
                enisa_threat_type="Abuse of Information Systems",
                trigger_summary=f"{detection_type_for_scope(scope)} for {account_key}; strike {strikes}; restricted {duration}s.",
                accuracy_basis="Three rate-limit violations generated one account-based strike.",
                behavior_flags_json=json.dumps(["Rate-limit abuse", "Account restriction"]),
                changed_lines_json=json.dumps({}),
                context_json=json.dumps(context),
            )
            db.add(detection)
            db.add(ActivityLog(
                action="Account Rate Limit Strike",
                user=account_key,
                details=json.dumps(context),
                type="security",
            ))
            if account_type in {"admin", "branch"} and strikes >= 2:
                db.add(ActivityLog(
                    action="Privileged Account Rate Limit Safeguard",
                    user=account_key,
                    details=f"Privileged account reached strike {strikes} for {scope}.",
                    type="security",
                ))
            db.commit()
        finally:
            db.close()
    except Exception:
        pass


def account_restriction_response(account_key: str, account_type: str, role: str, duration: int, scope: str, strikes: int, reason: str) -> JSONResponse:
    state = account_rate_limit_state[account_key]
    state["restricted_until_by_scope"][scope] = time.time() + duration
    state["last_strike_timestamp"] = time.time()
    _save_dos_state()
    record_rate_limit_detection(account_key, account_type, role, scope, strikes, reason, duration)
    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={
            "detail": f"{reason}. Account functionality temporarily restricted for {duration} seconds.",
            "scope": scope,
            "account_id": account_key,
            "account_type": account_type,
            "strike_count": strikes,
            "retry_after": duration,
            "next_action": "retry_after_restriction_expires",
        },
        headers={"Retry-After": str(duration)}
    )


def register_account_violation(account_key: str, current_time: float) -> tuple[int, int]:
    state = account_rate_limit_state[account_key]
    state["violation_count"] = int(state.get("violation_count") or 0) + 1
    state["last_violation_timestamp"] = current_time
    if state["violation_count"] >= 3:
        state["strike_count"] = int(state.get("strike_count") or 0) + 1
        state["violation_count"] = 0
    _save_dos_state()
    return int(state["violation_count"]), int(state["strike_count"])


def record_ip_manual_review_incident(ip: str, scope: str, strikes: int, reason: str, duration: int) -> None:
    current_time = time.time()
    incident_key = f"{ip}:{scope}"
    if current_time - manual_review_incidents.get(incident_key, 0) < 60 * 60:
        return
    manual_review_incidents[incident_key] = current_time
    _save_dos_state()
    try:
        from database.models import SessionLocal, authorize_database_session
        from SECURITY.security_models import SecurityDetectionEvent, SecurityIncident

        db = SessionLocal()
        try:
            authorize_database_session(db, context="ip_abuse_manual_review", actor="dos_protection")
            context = {
                "source_ip": ip,
                "scope": scope,
                "strike_count": strikes,
                "temporary_block_seconds": duration,
                "manual_review_recommended": True,
                "reason": reason,
            }
            detection = SecurityDetectionEvent(
                file_id=None,
                target_type="ip",
                target_name=ip,
                actor=ip,
                change_type="auto_ip_block_escalation",
                old_hash=None,
                new_hash=None,
                is_legitimate=False,
                admin_id=None,
                ai_score=None,
                ai_prediction="suspicious",
                confidence=1.0,
                severity_level="high",
                cvss_score=7.0,
                nist_category="CAT 1 - Unauthorized Access",
                enisa_threat_type="Abuse of Information Leakage",
                trigger_summary=f"Source IP: {ip} | {reason} | strike {strikes}; temporary block {duration}s.",
                accuracy_basis="Rate-limit strike escalation reached manual-review threshold.",
                behavior_flags_json=json.dumps(["Rate-limit abuse", "Manual review required"]),
                changed_lines_json=json.dumps({}),
                context_json=json.dumps(context),
            )
            db.add(detection)
            db.commit()
            db.refresh(detection)
            incident = SecurityIncident(
                detection_event_id=detection.id,
                incident_type="ip_abuse",
                severity_level="high",
                cvss_score=7.0,
                cvss_vector="AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:L",
                nist_category="CAT 1 - Unauthorized Access",
                enisa_threat_type="Abuse of Information Leakage",
                description=f"Automated IP block escalated to manual review. Source IP: {ip}. Strike count: {strikes}. Reason: {reason}.",
                behaviors_json=json.dumps(["Rate-limit abuse", "Manual review required"]),
                affected_files_json=json.dumps([ip]),
                changed_lines_json=json.dumps({}),
                quarantine_paths_json=json.dumps([]),
                response_action="temporary_block_manual_review",
                status="open",
                created_at=datetime.utcnow(),
            )
            db.add(incident)
            db.commit()
        finally:
            db.close()
    except Exception:
        pass


def register_reputation_strike(ip: str, current_time: float) -> int:
    reputation_strikes[ip] = prune_timestamps(reputation_strikes[ip], current_time, STRIKE_WINDOW)
    reputation_strikes[ip].append(current_time)
    _save_dos_state()
    return len(reputation_strikes[ip])


def block_response(ip: str, duration: int, scope: str, strikes: int, reason: str) -> JSONResponse:
    blocked_ips[ip] = time.time() + duration
    _save_dos_state()
    manual_review = strikes >= 4
    if manual_review:
        record_ip_manual_review_incident(ip, scope, strikes, reason, duration)
    content = {
        "detail": f"{reason}. IP temporarily blocked for {duration} seconds.",
        "scope": scope,
        "strike_count": strikes,
        "retry_after": duration,
        "captcha_required": strikes >= CAPTCHA_AFTER_STRIKES,
        "manual_review_recommended": manual_review,
        "next_action": "manual_review" if manual_review else "retry_after_block_expires",
    }
    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content=content,
        headers={"Retry-After": str(duration)}
    )


def rate_limit_for_path(path: str) -> tuple[str, int, int]:
    if is_search_path(path):
        return "search", SEARCH_ABUSE_THRESHOLD, SEARCH_ABUSE_WINDOW
    if is_registration_path(path):
        return "registration", REGISTRATION_ABUSE_THRESHOLD, REGISTRATION_ABUSE_WINDOW
    if is_password_reset_request_path(path):
        return "password_reset", PASSWORD_RESET_ABUSE_THRESHOLD, PASSWORD_RESET_ABUSE_WINDOW
    if is_admin_path(path):
        return "admin_general", ADMIN_ABUSE_THRESHOLD, ABUSE_WINDOW
    return "general", ABUSE_THRESHOLD, ABUSE_WINDOW


class RequestSizeMiddleware(BaseHTTPMiddleware):
    """Limit request body size and file count to prevent memory exhaustion"""

    async def dispatch(self, request: Request, call_next):
        content_length = request.headers.get("content-length")
        if content_length:
            size = int(content_length)
            if size > MAX_REQUEST_SIZE:
                return JSONResponse(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    content={"detail": f"Request too large. Maximum size: {MAX_REQUEST_SIZE // (1024*1024)}MB"}
                )
            # If we already know the total size is within limits, skip the
            # expensive full-body read just to count files. Per-file limits and
            # magic-byte validation are enforced in the endpoint handlers.
            return await call_next(request)

        # No content-length header: read body to enforce size + file limits
        content_type = request.headers.get("content-type", "")
        if content_type.startswith("multipart/form-data"):
            body = await request.body()
            if len(body) > MAX_REQUEST_SIZE:
                return JSONResponse(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    content={"detail": f"Request too large. Maximum size: {MAX_REQUEST_SIZE // (1024*1024)}MB"}
                )
            file_count = body.count(b'filename="') + body.count(b"filename='") + body.count(b'filename=')
            estimated_files = max(1, file_count // 2)
            if estimated_files > MAX_FILES_PER_REQUEST:
                return JSONResponse(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    content={"detail": f"Too many files. Maximum {MAX_FILES_PER_REQUEST} files per request."}
                )

        response = await call_next(request)
        return response


class RequestTimeoutMiddleware(BaseHTTPMiddleware):
    """Enforce timeout on all requests to prevent slowloris attacks"""
    
    async def dispatch(self, request: Request, call_next):
        path = request.url.path or ""
        if any(path.startswith(prefix) for prefix in REQUEST_TIMEOUT_EXEMPT_PATHS):
            return await call_next(request)
        try:
            return await asyncio.wait_for(call_next(request), timeout=REQUEST_TIMEOUT)
        except asyncio.TimeoutError:
            return JSONResponse(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                content={"detail": "Request timeout"}
            )


class ConnectionLimitMiddleware(BaseHTTPMiddleware):
    """Limit concurrent connections per IP and check permanent blocklist"""
    
    async def dispatch(self, request: Request, call_next):
        global _permanent_blocks_cache_time
        client_ip = request.client.host if request.client else "unknown"
        if is_exempt_ip(client_ip):
            return await call_next(request)

        # Refresh distributed state from Redis before checks
        _refresh_dos_state()

        # Check permanent blocklist using cache (only hit DB every 60 seconds)
        current_time = time.time()
        if current_time - _permanent_blocks_cache_time > PERMANENT_BLOCKS_CACHE_TTL:
            # Refresh cache from database
            try:
                from database.models import SessionLocal, PermanentIpBlock
                db = SessionLocal()
                try:
                    blocks = db.query(PermanentIpBlock).filter(PermanentIpBlock.is_active == True).all()
                    _permanent_blocks_cache.clear()
                    for block in blocks:
                        _permanent_blocks_cache[block.ip_address] = True
                    _permanent_blocks_cache_time = current_time
                finally:
                    db.close()
            except Exception:
                pass  # If DB fails, use stale cache or empty cache
        
        # Check if IP is permanently blocked
        if client_ip in _permanent_blocks_cache:
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={
                    "detail": "Access denied. Your IP address has been permanently blocked due to suspicious activity. If you believe this is an error, contact support.",
                    "block_type": "permanent",
                }
            )
        
        # Check if IP is temporarily blocked (in-memory)
        if client_ip in blocked_ips:
            if time.time() < blocked_ips[client_ip]:
                remaining = int(blocked_ips[client_ip] - time.time())
                return JSONResponse(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    content={
                        "detail": "Access denied. Your IP address has been temporarily blocked due to suspicious activity. If you believe this is an error, contact support.",
                        "retry_after": remaining,
                        "block_type": "temporary",
                    },
                    headers={"Retry-After": str(remaining)}
                )
            else:
                # Unblock expired
                del blocked_ips[client_ip]
                _save_dos_state()
        
        # Check concurrent request limit
        if active_requests[client_ip] >= MAX_CONCURRENT_REQUESTS_PER_IP:
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={"detail": "Too many concurrent connections"}
            )
        
        active_requests[client_ip] += 1
        try:
            response = await call_next(request)
            return response
        finally:
            active_requests[client_ip] -= 1
            if active_requests[client_ip] <= 0:
                del active_requests[client_ip]


class AbuseDetectionMiddleware(BaseHTTPMiddleware):
    """Detect and block abusive request patterns, check IP reputation"""
    
    async def dispatch(self, request: Request, call_next):
        global _permanent_blocks_cache_time
        client_ip = request.client.host if request.client else "unknown"
        if is_exempt_ip(client_ip):
            return await call_next(request)
        current_time = time.time()
        path = request.url.path
        account_key, account_type, role = account_from_request(request, client_ip)
        _refresh_dos_state()
        _save_dos_state()
        
        # Check IP reputation if enabled (only for first request from each IP to reduce load)
        if ENABLE_IP_REPUTATION and client_ip not in request_history:
            try:
                from database.models import SessionLocal
                from services.ip_reputation import check_ip_reputation
                db = SessionLocal()
                try:
                    reputation = check_ip_reputation(client_ip, db)
                    
                    # Keep reputation strikes separate from request-volume abuse strikes.
                    if AUTO_BLOCK_MALICIOUS and reputation["confidence_score"] >= REPUTATION_BLOCK_THRESHOLD:
                        strikes = register_reputation_strike(client_ip, current_time)
                        duration = temporary_block_duration(strikes)
                        return block_response(
                            client_ip,
                            duration,
                            "ip_reputation",
                            strikes,
                            f"IP reputation score {reputation['confidence_score']} met the block threshold"
                        )
                finally:
                    db.close()
            except Exception:
                pass  # If reputation check fails, continue normally

        scope, threshold, window = rate_limit_for_path(path)
        scopes = account_rate_limit_state[account_key]["restricted_until_by_scope"]
        # Check path-specific scope AND manual (global) scope
        restricted_until = float(scopes.get(scope) or 0)
        manual_restricted_until = float(scopes.get("manual") or 0)
        effective_restricted_until = max(restricted_until, manual_restricted_until)
        if effective_restricted_until > current_time:
            remaining = int(effective_restricted_until - current_time)
            active_scope = "manual" if manual_restricted_until > restricted_until else scope
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={
                    "detail": "Access denied. Your account has been temporarily restricted due to suspicious activity. If you believe this is an error, contact support.",
                    "scope": active_scope,
                    "account_id": account_key,
                    "account_type": account_type,
                    "retry_after": remaining,
                    "block_type": "account_restriction",
                },
                headers={"Retry-After": str(remaining)}
            )
        history_key = f"{account_key}:{scope}"
        endpoint_request_history[history_key] = prune_timestamps(endpoint_request_history[history_key], current_time, window)
        if len(endpoint_request_history[history_key]) >= threshold:
            violations, strikes = register_account_violation(account_key, current_time)
            if strikes and violations == 0:
                duration = temporary_block_duration(strikes)
                return account_restriction_response(
                    account_key,
                    account_type,
                    role,
                    duration,
                    scope,
                    strikes,
                    f"Rate limit exceeded: {threshold} {scope} request(s) in {window} seconds"
                )
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={
                    "detail": "Too many requests for this action. Please wait before trying again.",
                    "scope": scope,
                    "account_id": account_key,
                    "account_type": account_type,
                    "violation_count": violations,
                    "violations_until_strike": max(0, 3 - violations),
                },
            )
        endpoint_request_history[history_key].append(current_time)
        request_history[client_ip] = prune_timestamps(request_history[client_ip], current_time, ABUSE_WINDOW)
        request_history[client_ip].append(current_time)

        failed_auth_history[client_ip] = prune_timestamps(failed_auth_history[client_ip], current_time, AUTH_ABUSE_WINDOW)
        if is_login_path(path) and len(failed_auth_history[client_ip]) >= AUTH_ABUSE_THRESHOLD:
            violations, strikes = register_account_violation(account_key, current_time)
            if strikes and violations == 0:
                duration = temporary_block_duration(strikes)
                return account_restriction_response(account_key, account_type, role, duration, "authentication_failed", strikes, f"Failed-login limit exceeded: {AUTH_ABUSE_THRESHOLD} failed attempt(s) in {AUTH_ABUSE_WINDOW} seconds")
        
        response = await call_next(request)
        if is_login_path(path) and response.status_code in {400, 401, 403, 422}:
            failed_auth_history[client_ip].append(current_time)
            if len(failed_auth_history[client_ip]) >= AUTH_ABUSE_THRESHOLD:
                violations, strikes = register_account_violation(account_key, current_time)
                if strikes and violations == 0:
                    duration = temporary_block_duration(strikes)
                    return account_restriction_response(account_key, account_type, role, duration, "authentication_failed", strikes, f"Failed-login limit exceeded: {AUTH_ABUSE_THRESHOLD} failed attempt(s) in {AUTH_ABUSE_WINDOW} seconds")
        return response


def get_blocked_ips() -> Dict[str, float]:
    """Get currently blocked IPs (for admin interface) - includes both temporary and permanent"""
    current_time = time.time()
    # Clean expired blocks
    expired = [ip for ip, unblock_time in blocked_ips.items() if unblock_time < current_time]
    for ip in expired:
        del blocked_ips[ip]
    if expired:
        _save_dos_state()
    
    # Also get permanent blocks from database
    result = blocked_ips.copy()
    try:
        from database.models import SessionLocal, PermanentIpBlock
        db = SessionLocal()
        try:
            permanent_blocks = db.query(PermanentIpBlock).filter(PermanentIpBlock.is_active == True).all()
            for block in permanent_blocks:
                result[block.ip_address] = float('inf')
        finally:
            db.close()
    except Exception:
        pass
    
    return result


def _refresh_dos_state() -> None:
    """Reload mutable state from Redis so other instances' changes are visible."""
    r = get_redis_client()
    if not r:
        return
    try:
        global blocked_ips, account_rate_limit_state
        raw_blocked = r.hgetall("wards:dos:blocked_ips")
        blocked_ips = {k: float(v) for k, v in raw_blocked.items()}
        raw_accounts = r.hgetall("wards:dos:account_rate_limit_state")
        account_rate_limit_state = defaultdict(
            lambda: {
                "violation_count": 0,
                "strike_count": 0,
                "last_violation_timestamp": None,
                "last_strike_timestamp": None,
                "restricted_until_by_scope": {},
            },
            {k: json.loads(v) for k, v in raw_accounts.items()},
        )
    except Exception:
        pass


def unblock_ip(ip: str) -> bool:
    """Manually unblock an IP (removes from both temporary and permanent blocklist)"""
    global _permanent_blocks_cache_time
    # Remove from temporary blocklist
    if ip in blocked_ips:
        del blocked_ips[ip]
    request_history.pop(ip, None)
    failed_auth_history.pop(ip, None)
    block_strikes.pop(ip, None)
    reputation_strikes.pop(ip, None)
    for key in list(endpoint_request_history.keys()):
        if key.startswith(f"{ip}:"):
            endpoint_request_history.pop(key, None)
    _save_dos_state()
    
    # Remove from permanent blocklist
    try:
        from database.models import SessionLocal, PermanentIpBlock
        db = SessionLocal()
        try:
            block = db.query(PermanentIpBlock).filter(PermanentIpBlock.ip_address == ip).first()
            if block:
                block.is_active = False
                db.commit()
            _permanent_blocks_cache.clear()
            _permanent_blocks_cache_time = 0
        finally:
            db.close()
    except Exception:
        pass
    
    return True


def block_ip(ip: str, duration: int = 15 * 60) -> None:
    """Manually block an IP (temporary)"""
    blocked_ips[ip] = time.time() + duration
    _save_dos_state()
