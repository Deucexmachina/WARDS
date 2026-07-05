import json
import re
from typing import Any

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


_HTML_TAG_RE = re.compile(r"[<>]")
_HTML_ENTITY_RE = re.compile(r"&lt;|&gt;|&amp;|&#\d+;|&#x[0-9a-f]+;")
_XSS_RE = re.compile(
    r"(?:javascript|data|vbscript):|"
    r"<\s*\w+.*?\bon\w+\s*=|"
    r"alert\s*\(|prompt\s*\(|confirm\s*\(|"
    r"eval\s*\(|expression\s*\(|"
    r"document\.(?:cookie|location|write)|"
    r"window\.(?:location|open)"
)
_SCRIPT_FRAG_RE = re.compile(
    r"script.*(?:alert|prompt|confirm|eval|document\.|window\.)|"
    r"(?:alert|prompt|confirm|eval).*script"
)
_SQL_INJ_RE = re.compile(
    r"(?:--|/\*|;)\s*(?:drop|delete|update|insert|union|select|exec|execute)|"
    r"(?:union|select|insert|update|delete|drop|create|alter)\s+.*?\s+(?:from|into|table|database)|"
    r"or\s+1\s*=\s*1|and\s+1\s*=\s*1|"
    r"'\s*or\s*'|\"\s*or\s*\"|"
    r"waitfor\s+delay|benchmark\s*\(|sleep\s*\(|"
    r";%20|char\s*\(|concat\s*\(|group_concat"
)
_PATH_TRAVERSAL_RE = re.compile(r"\.\./|\.\.\\")
_SHELL_INJ_RE = re.compile(r"[|&;`$]|\$\(.*?\)|`.*?(?:`|$)")


def _is_suspicious(value: Any) -> bool:
    """Return True if *value* contains an injection payload."""
    if not value:
        return False
    text = str(value).lower()

    if _HTML_TAG_RE.search(text):
        return True
    if _HTML_ENTITY_RE.search(text):
        return True
    if _XSS_RE.search(text):
        return True
    if _SCRIPT_FRAG_RE.search(text):
        return True
    if _SQL_INJ_RE.search(text):
        return True
    if _PATH_TRAVERSAL_RE.search(text):
        return True
    if _SHELL_INJ_RE.search(text):
        return True
    if "\x00" in text:
        return True
    return False


def _scan_dict(data: Any) -> tuple[str, str] | None:
    """
    Recursively scan a dict/list structure for suspicious strings.
    Returns (key, bad_value) on first hit, else None.
    """
    if isinstance(data, str):
        return None

    if isinstance(data, dict):
        for k, v in data.items():
            if isinstance(v, str) and _is_suspicious(v):
                return str(k), v
            result = _scan_dict(v)
            if result:
                return str(k), result[1]
        return None

    if isinstance(data, list):
        for item in data:
            result = _scan_dict(item)
            if result:
                return result
        return None

    return None



class InjectionBlockingMiddleware(BaseHTTPMiddleware):
    """
    Intercept and block injection payloads globally.
    """

    async def dispatch(self, request: Request, call_next):
        for key, val in request.query_params.items():
            if _is_suspicious(val):
                return _blocked_response(key, val, request)

        if _is_suspicious(request.url.path):
            return _blocked_response("path", request.url.path, request)

        if request.method in ("POST", "PUT", "PATCH"):
            content_type = request.headers.get("content-type", "")
            if "application/json" in content_type:
                body = await request.body()
                if body:
                    try:
                        payload = json.loads(body)
                    except (json.JSONDecodeError, ValueError):
                        payload = None

                    if isinstance(payload, dict):
                        hit = _scan_dict(payload)
                        if hit:
                            return _blocked_response(hit[0], hit[1], request)

                    async def _receive():
                        return {"type": "http.request", "body": body}

                    request._receive = _receive  

        return await call_next(request)


def _blocked_response(field: str, bad_value: str, request: Request) -> JSONResponse:
    """Build the 400 response and fire a non-blocking log if possible."""
    detail = (
        "One or more fields contain an invalid value. "
        "Please check your input and try again."
    )

    try:
        from starlette.concurrency import run_in_threadpool
        from routes.unified_auth import log_activity
        from database.models import SessionLocal

        def _do_log():
            db = SessionLocal()
            try:
                client_ip = _get_client_ip(request)
                log_activity(
                    db,
                    action="Injection Attempt Blocked",
                    user="unknown",
                    details=(
                        f"blocked {request.method} {request.url.path} | "
                        f"field={field} | ip={client_ip}"
                    ),
                    log_type="security",
                    request=request,
                    severity="high",
                )
                db.commit()
            finally:
                db.close()

        import asyncio
        asyncio.create_task(run_in_threadpool(_do_log))
    except Exception:
        pass

    return JSONResponse(
        status_code=400,
        content={"detail": detail},
    )


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",", 1)[0].strip() or "unknown"
    return (
        request.client.host
        if request.client and request.client.host
        else "unknown"
    )
