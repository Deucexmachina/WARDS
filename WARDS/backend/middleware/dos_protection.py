"""
DoS Protection Middleware
- Request size limits
- Request timeout enforcement
- IP-based connection tracking
- Abuse detection and blocking
- Permanent blocklist (database-backed)
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

MAX_REQUEST_SIZE = int(os.getenv("MAX_REQUEST_SIZE_BYTES", 10 * 1024 * 1024))  # 10MB
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT_SECONDS", 30))
MAX_CONCURRENT_REQUESTS_PER_IP = int(os.getenv("MAX_CONCURRENT_REQUESTS_PER_IP", 50))
ABUSE_THRESHOLD = int(os.getenv("ABUSE_THRESHOLD_REQUESTS", 100))
ABUSE_WINDOW = int(os.getenv("ABUSE_WINDOW_SECONDS", 60))
BLOCK_DURATION = int(os.getenv("ABUSE_BLOCK_DURATION_SECONDS", 300))
ENABLE_IP_REPUTATION = os.getenv("ENABLE_IP_REPUTATION", "true").lower() == "true"
AUTO_BLOCK_MALICIOUS = os.getenv("AUTO_BLOCK_MALICIOUS", "false").lower() == "true"

# Track active requests per IP
active_requests: Dict[str, int] = defaultdict(int)
# Track request counts for abuse detection
request_history: Dict[str, list] = defaultdict(list)
# Track blocked IPs (temporary, in-memory)
blocked_ips: Dict[str, float] = {}  # IP -> unblock time

# Cache for permanent blocks (in-memory cache to reduce DB calls)
_permanent_blocks_cache: Dict[str, bool] = {}
_permanent_blocks_cache_time: float = 0
PERMANENT_BLOCKS_CACHE_TTL = 60  # Cache for 60 seconds


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
        current_time = time.time()
        
        # Check IP reputation if enabled (only for first request from each IP to reduce load)
        if ENABLE_IP_REPUTATION and client_ip not in request_history:
            try:
                from database.models import SessionLocal
                from services.ip_reputation import check_ip_reputation, auto_block_if_malicious
                db = SessionLocal()
                try:
                    reputation = check_ip_reputation(client_ip, db)
                    
                    # Auto-block if malicious and enabled
                    if AUTO_BLOCK_MALICIOUS and reputation["is_malicious"]:
                        auto_block_if_malicious(client_ip, db)
                        # Invalidate permanent blocks cache
                        _permanent_blocks_cache.clear()
                        _permanent_blocks_cache_time = 0
                        return JSONResponse(
                            status_code=status.HTTP_403_FORBIDDEN,
                            content={
                                "detail": "IP blocked due to malicious reputation.",
                                "confidence": reputation["confidence_score"]
                            }
                        )
                finally:
                    db.close()
            except Exception:
                pass  # If reputation check fails, continue normally
        
        # Clean old request history
        request_history[client_ip] = [
            ts for ts in request_history[client_ip]
            if current_time - ts < ABUSE_WINDOW
        ]
        
        # Check abuse threshold
        if len(request_history[client_ip]) >= ABUSE_THRESHOLD:
            blocked_ips[client_ip] = current_time + BLOCK_DURATION
            
            # Add to permanent blocklist if this is a repeat offender
            try:
                from database.models import SessionLocal
                from services.ip_reputation import add_permanent_block
                db = SessionLocal()
                try:
                    add_permanent_block(
                        ip=client_ip,
                        reason=f"Auto-blocked after {ABUSE_THRESHOLD} requests in {ABUSE_WINDOW} seconds",
                        blocked_by="system",
                        db=db
                    )
                    # Invalidate permanent blocks cache
                    _permanent_blocks_cache.clear()
                    _permanent_blocks_cache_time = 0
                finally:
                    db.close()
            except Exception:
                pass
            
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


def block_ip(ip: str, duration: int = BLOCK_DURATION) -> None:
    """Manually block an IP (temporary)"""
    blocked_ips[ip] = time.time() + duration
