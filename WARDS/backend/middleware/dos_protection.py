"""
DoS Protection Middleware
- Request size limits
- Request timeout enforcement
- IP-based connection tracking
- Abuse detection and blocking
"""
from fastapi import Request, HTTPException, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp
import time
import asyncio
from collections import defaultdict
from typing import Dict
import os

MAX_REQUEST_SIZE = int(os.getenv("MAX_REQUEST_SIZE_BYTES", 10 * 1024 * 1024))  # 10MB
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT_SECONDS", 30))
MAX_CONCURRENT_REQUESTS_PER_IP = int(os.getenv("MAX_CONCURRENT_REQUESTS_PER_IP", 50))
ABUSE_THRESHOLD = int(os.getenv("ABUSE_THRESHOLD_REQUESTS", 100))
ABUSE_WINDOW = int(os.getenv("ABUSE_WINDOW_SECONDS", 60))
BLOCK_DURATION = int(os.getenv("ABUSE_BLOCK_DURATION_SECONDS", 300))

# Track active requests per IP
active_requests: Dict[str, int] = defaultdict(int)
# Track request counts for abuse detection
request_history: Dict[str, list] = defaultdict(list)
# Track blocked IPs
blocked_ips: Dict[str, float] = {}  # IP -> unblock time


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
    """Limit concurrent connections per IP"""
    
    async def dispatch(self, request: Request, call_next):
        client_ip = request.client.host if request.client else "unknown"
        
        # Check if IP is blocked
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
    """Detect and block abusive request patterns"""
    
    async def dispatch(self, request: Request, call_next):
        client_ip = request.client.host if request.client else "unknown"
        current_time = time.time()
        
        # Clean old request history
        request_history[client_ip] = [
            ts for ts in request_history[client_ip]
            if current_time - ts < ABUSE_WINDOW
        ]
        
        # Check abuse threshold
        if len(request_history[client_ip]) >= ABUSE_THRESHOLD:
            blocked_ips[client_ip] = current_time + BLOCK_DURATION
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={
                    "detail": f"Abuse detected. IP blocked for {BLOCK_DURATION} seconds."
                },
                headers={"Retry-After": str(BLOCK_DURATION)}
            )
        
        # Record this request
        request_history[client_ip].append(current_time)
        
        response = await call_next(request)
        return response


def get_blocked_ips() -> Dict[str, float]:
    """Get currently blocked IPs (for admin interface)"""
    current_time = time.time()
    # Clean expired blocks
    expired = [ip for ip, unblock_time in blocked_ips.items() if unblock_time < current_time]
    for ip in expired:
        del blocked_ips[ip]
    return blocked_ips.copy()


def unblock_ip(ip: str) -> bool:
    """Manually unblock an IP"""
    if ip in blocked_ips:
        del blocked_ips[ip]
        return True
    return False


def block_ip(ip: str, duration: int = BLOCK_DURATION) -> None:
    """Manually block an IP"""
    blocked_ips[ip] = time.time() + duration
