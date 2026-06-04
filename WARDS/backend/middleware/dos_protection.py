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
from typing import Dict, Optional
import os
import ipaddress

MAX_REQUEST_SIZE = int(os.getenv("MAX_REQUEST_SIZE_BYTES", 10 * 1024 * 1024))  # 10MB
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT_SECONDS", 30))
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
EXEMPT_PRIVATE_IPS = os.getenv("ABUSE_EXEMPT_PRIVATE_IPS", "true").lower() == "true"
EXEMPT_IPS = {
    item.strip()
    for item in os.getenv("ABUSE_EXEMPT_IPS", "127.0.0.1,::1,localhost").split(",")
    if item.strip()
}

# Track active requests per IP
active_requests: Dict[str, int] = defaultdict(int)
# Track request counts for abuse detection
request_history: Dict[str, list] = defaultdict(list)
endpoint_request_history: Dict[str, list] = defaultdict(list)
failed_auth_history: Dict[str, list] = defaultdict(list)
block_strikes: Dict[str, list] = defaultdict(list)
reputation_strikes: Dict[str, list] = defaultdict(list)
# Track blocked IPs (temporary, in-memory)
blocked_ips: Dict[str, float] = {}  # IP -> unblock time

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
    return len(block_strikes[ip])


def temporary_block_duration(strikes: int) -> int:
    if strikes <= 1:
        return 15 * 60
    if strikes == 2:
        return 60 * 60
    if strikes == 3:
        return 24 * 60 * 60
    return 7 * 24 * 60 * 60


def register_reputation_strike(ip: str, current_time: float) -> int:
    reputation_strikes[ip] = prune_timestamps(reputation_strikes[ip], current_time, STRIKE_WINDOW)
    reputation_strikes[ip].append(current_time)
    return len(reputation_strikes[ip])


def block_response(ip: str, duration: int, scope: str, strikes: int, reason: str) -> JSONResponse:
    blocked_ips[ip] = time.time() + duration
    manual_review = strikes >= 4
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
    """Limit request body size to prevent memory exhaustion"""
    
    async def dispatch(self, request: Request, call_next):
        content_length = request.headers.get("content-length")
        if content_length:
            if int(content_length) > MAX_REQUEST_SIZE:
                return JSONResponse(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    content={"detail": f"Request too large. Maximum size: {MAX_REQUEST_SIZE // (1024*1024)}MB"}
                )
        
        response = await call_next(request)
        return response


class RequestTimeoutMiddleware(BaseHTTPMiddleware):
    """Enforce timeout on all requests to prevent slowloris attacks"""
    
    async def dispatch(self, request: Request, call_next):
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
                content={"detail": "IP address is permanently blocked."}
            )
        
        # Check if IP is temporarily blocked (in-memory)
        if client_ip in blocked_ips:
            if time.time() < blocked_ips[client_ip]:
                remaining = int(blocked_ips[client_ip] - time.time())
                return JSONResponse(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    content={
                        "detail": "Too many requests. IP temporarily blocked.",
                        "retry_after": remaining
                    },
                    headers={"Retry-After": str(remaining)}
                )
            else:
                # Unblock expired
                del blocked_ips[client_ip]
        
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
        history_key = f"{client_ip}:{scope}"
        endpoint_request_history[history_key] = prune_timestamps(endpoint_request_history[history_key], current_time, window)
        if len(endpoint_request_history[history_key]) >= threshold:
            strikes = register_block_strike(client_ip, current_time)
            duration = temporary_block_duration(strikes)
            return block_response(
                client_ip,
                duration,
                scope,
                strikes,
                f"Rate limit exceeded: {threshold} {scope} request(s) in {window} seconds"
            )
        endpoint_request_history[history_key].append(current_time)
        request_history[client_ip] = prune_timestamps(request_history[client_ip], current_time, ABUSE_WINDOW)
        request_history[client_ip].append(current_time)

        failed_auth_history[client_ip] = prune_timestamps(failed_auth_history[client_ip], current_time, AUTH_ABUSE_WINDOW)
        if is_login_path(path) and len(failed_auth_history[client_ip]) >= AUTH_ABUSE_THRESHOLD:
            strikes = register_block_strike(client_ip, current_time)
            duration = temporary_block_duration(strikes)
            return block_response(
                client_ip,
                duration,
                "authentication_failed",
                strikes,
                f"Failed-login limit exceeded: {AUTH_ABUSE_THRESHOLD} failed attempt(s) in {AUTH_ABUSE_WINDOW} seconds"
            )
        
        response = await call_next(request)
        if is_login_path(path) and response.status_code in {400, 401, 403, 422}:
            failed_auth_history[client_ip].append(current_time)
            if len(failed_auth_history[client_ip]) >= AUTH_ABUSE_THRESHOLD:
                strikes = register_block_strike(client_ip, current_time)
                duration = temporary_block_duration(strikes)
                return block_response(
                    client_ip,
                    duration,
                    "authentication_failed",
                    strikes,
                    f"Failed-login limit exceeded: {AUTH_ABUSE_THRESHOLD} failed attempt(s) in {AUTH_ABUSE_WINDOW} seconds"
                )
        return response


def get_blocked_ips() -> Dict[str, float]:
    """Get currently blocked IPs (for admin interface) - includes both temporary and permanent"""
    current_time = time.time()
    # Clean expired blocks
    expired = [ip for ip, unblock_time in blocked_ips.items() if unblock_time < current_time]
    for ip in expired:
        del blocked_ips[ip]
    
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
