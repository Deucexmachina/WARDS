"""
FastAPI middleware for rate limiting.
Extracts client IP safely and enforces rate limits.
"""
from fastapi import Request, HTTPException, status
from fastapi.responses import JSONResponse
from typing import Callable, Optional
import logging

from utils.rate_limiter import check_rate_limit, get_rate_limit_config

logger = logging.getLogger(__name__)


def get_client_ip(request: Request) -> str:
    """
    Extract real client IP from request headers.
    Handles proxy headers safely.
    
    Priority order:
    1. X-Forwarded-For (first IP in chain)
    2. X-Real-IP
    3. request.client.host (direct connection)
    
    Args:
        request: FastAPI Request object
    
    Returns:
        Client IP address as string
    """
    # Check X-Forwarded-For header (proxy/load balancer)
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        # Take first IP in chain (original client)
        ip = forwarded_for.split(",")[0].strip()
        if ip:
            return ip
    
    # Check X-Real-IP header (nginx proxy)
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()
    
    # Fallback to direct connection IP
    if request.client and request.client.host:
        return request.client.host
    
    # Ultimate fallback
    return "unknown"


def rate_limit_dependency(endpoint: str):
    """
    Create a FastAPI dependency for rate limiting.
    
    Usage:
        @router.post("/queue/register")
        async def register_queue(
            request: Request,
            _: None = Depends(rate_limit_dependency("queue_register"))
        ):
            # Your logic
    
    Args:
        endpoint: Endpoint identifier matching RATE_LIMITS config
    
    Returns:
        FastAPI dependency function
    """
    async def check_limit(request: Request) -> None:
        # Get client IP
        client_ip = get_client_ip(request)
        
        # Get rate limit config for this endpoint
        config = get_rate_limit_config(endpoint)
        max_requests = config["max_requests"]
        window = config["window"]
        
        # Check rate limit
        is_allowed, retry_after = check_rate_limit(
            ip=client_ip,
            endpoint=endpoint,
            max_requests=max_requests,
            window=window
        )
        
        if not is_allowed:
            # Log blocked request
            logger.warning(
                f"Rate limit blocked - "
                f"IP: {client_ip}, "
                f"Endpoint: {endpoint}, "
                f"Path: {request.url.path}, "
                f"Method: {request.method}, "
                f"Retry-After: {retry_after}s"
            )
            
            # Return 429 with Retry-After header
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "error": "Too many requests",
                    "message": f"Rate limit exceeded. Please try again in {retry_after} seconds.",
                    "retry_after": retry_after,
                },
                headers={"Retry-After": str(retry_after)}
            )
    
    return check_limit


# Pre-configured dependencies for common endpoints
queue_register_limiter = rate_limit_dependency("queue_register")
payment_initiate_limiter = rate_limit_dependency("payment_initiate")


class RateLimitMiddleware:
    """
    Optional: Global rate limit middleware.
    Can be used to apply rate limiting to all requests.
    
    Note: Using dependency-based limiting (above) is recommended
    for more granular control per endpoint.
    """
    
    def __init__(self, app, default_limit: int = 100, default_window: int = 60):
        self.app = app
        self.default_limit = default_limit
        self.default_window = default_window
    
    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        
        # Extract IP from scope
        headers = dict(scope.get("headers", []))
        
        # Get X-Forwarded-For
        forwarded_for = headers.get(b"x-forwarded-for", b"").decode()
        if forwarded_for:
            client_ip = forwarded_for.split(",")[0].strip()
        else:
            # Get X-Real-IP
            real_ip = headers.get(b"x-real-ip", b"").decode()
            if real_ip:
                client_ip = real_ip.strip()
            else:
                # Fallback to client
                client = scope.get("client")
                client_ip = client[0] if client else "unknown"
        
        # Check global rate limit
        is_allowed, retry_after = check_rate_limit(
            ip=client_ip,
            endpoint="global",
            max_requests=self.default_limit,
            window=self.default_window
        )
        
        if not is_allowed:
            # Return 429 response
            response = JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={
                    "error": "Too many requests",
                    "message": f"Global rate limit exceeded. Please try again in {retry_after} seconds.",
                    "retry_after": retry_after,
                },
                headers={"Retry-After": str(retry_after)}
            )
            await response(scope, receive, send)
            return
        
        await self.app(scope, receive, send)
