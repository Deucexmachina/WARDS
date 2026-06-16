import hashlib
import hmac
import os
import time

from fastapi import HTTPException, Request, status


def _enabled() -> bool:
    return os.getenv("REQUIRE_INTERNAL_HMAC", "false").strip().lower() in {"true", "1", "yes"}


def _secret() -> bytes:
    value = os.getenv("INTERNAL_API_SECRET", "").strip()
    if not value:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal API signing is not configured")
    return value.encode("utf-8")


def sign_request(body: bytes, timestamp: str) -> str:
    signed = f"{timestamp}.".encode("utf-8") + body
    return hmac.new(_secret(), signed, hashlib.sha256).hexdigest()


async def require_internal_signature(request: Request) -> bool:
    if not _enabled():
        return True

    timestamp = request.headers.get("x-request-timestamp", "")
    signature = request.headers.get("x-request-signature", "")
    if not timestamp or not signature:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing request signature")

    try:
        age = abs(time.time() - float(timestamp))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid request timestamp") from exc
    if age > int(os.getenv("INTERNAL_HMAC_MAX_AGE_SECONDS", "300")):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Request signature expired")

    expected = sign_request(await request.body(), timestamp)
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid request signature")
    return True
