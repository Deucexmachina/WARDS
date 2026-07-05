"""Request helpers used by auth and route modules."""

from fastapi import Request


def get_client_ip(request: Request | None) -> str:
    """Extract real client IP, respecting reverse-proxy / CDN headers."""
    if request is None:
        return "unknown"
    # Cloudflare
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip:
        return cf_ip.strip()
    # Cloudflare Enterprise / Akamai
    true_client = request.headers.get("true-client-ip")
    if true_client:
        return true_client.strip()
    # Standard proxies (nginx, AWS ALB, Heroku, etc.)
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    # RFC 7239 Forwarded
    forwarded_rfc = request.headers.get("forwarded")
    if forwarded_rfc:
        match = forwarded_rfc.split("for=")
        if len(match) > 1:
            ip_candidate = match[1].split(";")[0].split(",")[0].strip().strip('"')
            if ip_candidate:
                return ip_candidate
    # Direct connection
    if request.client and request.client.host:
        return request.client.host
    return "unknown"
