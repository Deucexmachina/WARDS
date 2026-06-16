"""Redis connection helper with graceful fallback."""

import json
import os

_redis_client = None


def get_redis_client():
    """Return a connected Redis client if REDIS_URL is configured, else None."""
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    try:
        import redis
    except ImportError:
        _redis_client = None
        return None

    redis_url = os.getenv("REDIS_URL", "").strip()
    if not redis_url:
        _redis_client = None
        return None

    try:
        _redis_client = redis.from_url(redis_url, decode_responses=True)
        _redis_client.ping()
    except Exception:
        _redis_client = None
    return _redis_client


def require_redis():
    app_env = os.getenv("APP_ENV", os.getenv("ENV", "development")).strip().lower()
    if app_env not in {"prod", "production"}:
        return get_redis_client()
    if not os.getenv("REDIS_URL", "").strip():
        raise RuntimeError("REDIS_URL is required when APP_ENV=production")
    client = get_redis_client()
    if client is None:
        raise RuntimeError("Redis is required for production rate-limit and lockout state")
    return client
