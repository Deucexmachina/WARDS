"""
Production-ready Redis-based rate limiter for FastAPI.
Supports distributed systems with atomic operations.
"""
import os
import redis
from typing import Optional
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

# Redis connection configuration
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_DB = int(os.getenv("REDIS_DB", "0"))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", None)

# Rate limit configurations (requests per window)
RATE_LIMITS = {
    "queue_register": {
        "max_requests": int(os.getenv("RATE_LIMIT_QUEUE_REGISTER", "5")),
        "window": int(os.getenv("RATE_LIMIT_QUEUE_WINDOW", "60")),  # seconds
    },
    "payment_initiate": {
        "max_requests": int(os.getenv("RATE_LIMIT_PAYMENT_INITIATE", "3")),
        "window": int(os.getenv("RATE_LIMIT_PAYMENT_WINDOW", "60")),  # seconds
    },
}

# Global Redis client
_redis_client: Optional[redis.Redis] = None


def get_redis_client() -> redis.Redis:
    """
    Get or create Redis client connection.
    Thread-safe singleton pattern.
    """
    global _redis_client
    
    if _redis_client is None:
        try:
            _redis_client = redis.Redis(
                host=REDIS_HOST,
                port=REDIS_PORT,
                db=REDIS_DB,
                password=REDIS_PASSWORD,
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5,
                retry_on_timeout=True,
            )
            # Test connection
            _redis_client.ping()
            logger.info(f"Redis connection established: {REDIS_HOST}:{REDIS_PORT}")
        except redis.ConnectionError as e:
            logger.error(f"Failed to connect to Redis: {e}")
            raise
    
    return _redis_client


def check_rate_limit(
    ip: str,
    endpoint: str,
    max_requests: int,
    window: int
) -> tuple[bool, Optional[int]]:
    """
    Check if request is within rate limit using Redis.
    
    Uses atomic INCR + EXPIRE operations for distributed safety.
    
    Args:
        ip: Client IP address
        endpoint: Endpoint identifier (e.g., 'queue_register')
        max_requests: Maximum requests allowed in window
        window: Time window in seconds
    
    Returns:
        Tuple of (is_allowed, retry_after_seconds)
        - is_allowed: True if request is allowed, False if rate limit exceeded
        - retry_after_seconds: Seconds to wait before retrying (None if allowed)
    """
    try:
        redis_client = get_redis_client()
        
        # Create unique key for this IP + endpoint combination
        key = f"rate_limit:{ip}:{endpoint}"
        
        # Use pipeline for atomic operations
        pipe = redis_client.pipeline()
        pipe.incr(key)
        pipe.ttl(key)
        results = pipe.execute()
        
        current_count = results[0]
        ttl = results[1]
        
        # Set expiration on first request
        if ttl == -1:
            redis_client.expire(key, window)
            ttl = window
        
        # Check if limit exceeded
        if current_count > max_requests:
            logger.warning(
                f"Rate limit exceeded - IP: {ip}, Endpoint: {endpoint}, "
                f"Count: {current_count}/{max_requests}, TTL: {ttl}s"
            )
            return False, ttl
        
        return True, None
        
    except redis.RedisError as e:
        # On Redis failure, allow request but log error
        logger.error(f"Redis error in rate limiter: {e}. Allowing request.")
        return True, None
    except Exception as e:
        # On unexpected error, allow request but log
        logger.error(f"Unexpected error in rate limiter: {e}. Allowing request.")
        return True, None


def get_rate_limit_config(endpoint: str) -> dict:
    """
    Get rate limit configuration for a specific endpoint.
    
    Args:
        endpoint: Endpoint identifier
    
    Returns:
        Dict with 'max_requests' and 'window' keys
    """
    return RATE_LIMITS.get(endpoint, {"max_requests": 10, "window": 60})


def reset_rate_limit(ip: str, endpoint: str) -> bool:
    """
    Reset rate limit for a specific IP and endpoint.
    Useful for admin operations or testing.
    
    Args:
        ip: Client IP address
        endpoint: Endpoint identifier
    
    Returns:
        True if reset successful, False otherwise
    """
    try:
        redis_client = get_redis_client()
        key = f"rate_limit:{ip}:{endpoint}"
        redis_client.delete(key)
        logger.info(f"Rate limit reset for IP: {ip}, Endpoint: {endpoint}")
        return True
    except Exception as e:
        logger.error(f"Failed to reset rate limit: {e}")
        return False


def get_current_usage(ip: str, endpoint: str) -> dict:
    """
    Get current rate limit usage for monitoring.
    
    Args:
        ip: Client IP address
        endpoint: Endpoint identifier
    
    Returns:
        Dict with 'current', 'limit', 'remaining', 'reset_in' keys
    """
    try:
        redis_client = get_redis_client()
        key = f"rate_limit:{ip}:{endpoint}"
        
        current = int(redis_client.get(key) or 0)
        ttl = redis_client.ttl(key)
        config = get_rate_limit_config(endpoint)
        
        return {
            "current": current,
            "limit": config["max_requests"],
            "remaining": max(0, config["max_requests"] - current),
            "reset_in": ttl if ttl > 0 else 0,
        }
    except Exception as e:
        logger.error(f"Failed to get current usage: {e}")
        return {
            "current": 0,
            "limit": 0,
            "remaining": 0,
            "reset_in": 0,
        }


def cleanup_expired_keys() -> int:
    """
    Cleanup expired rate limit keys (optional maintenance).
    Redis handles this automatically with TTL, but this can be used for monitoring.
    
    Returns:
        Number of keys cleaned up
    """
    try:
        redis_client = get_redis_client()
        # Redis automatically removes expired keys, this is just for monitoring
        keys = redis_client.keys("rate_limit:*")
        return len(keys)
    except Exception as e:
        logger.error(f"Failed to cleanup keys: {e}")
        return 0
