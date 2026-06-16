import os

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import RedirectResponse


def https_only_enabled() -> bool:
    default = "true" if os.getenv("APP_ENV", os.getenv("ENV", "development")).lower() in {"prod", "production"} else "false"
    return os.getenv("HTTPS_ONLY", default).strip().lower() in {"true", "1", "yes"}


class HttpsEnforcementMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not https_only_enabled():
            return await call_next(request)

        if request.url.hostname in {"localhost", "127.0.0.1", "::1"} and os.getenv("APP_ENV", "development").lower() not in {"prod", "production"}:
            return await call_next(request)

        proto = (request.headers.get("x-forwarded-proto") or request.url.scheme or "").lower()
        if proto != "https":
            redirect_url = request.url.replace(scheme="https", port=None)
            return RedirectResponse(str(redirect_url), status_code=308)

        return await call_next(request)
