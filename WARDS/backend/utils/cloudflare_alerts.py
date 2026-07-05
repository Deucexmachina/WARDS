import hashlib
import os
from datetime import datetime, timedelta, timezone

import requests
from sqlalchemy.orm import Session

from database.models import Alert


CLOUDFLARE_GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql"
CLOUDFLARE_ALERT_ACTIONS = {"block", "challenge", "jschallenge", "managed_challenge"}


AUTH_PATHS = (
    "/api/auth/unified/login",
    "/api/auth/unified/verify",
    "/api/auth/unified/setup-mfa",
    "/api/auth/unified/verify-mfa",
    "/api/auth/unified/mfa",
    "/api/auth/password",
    "/api/auth/reset",
)
OWNERSHIP_PATHS = (
    "/api/payments",
    "/api/receipts",
    "/api/public/queue",
    "/api/tax-assessment",
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_cf_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _event_key(event: dict) -> str:
    raw = "|".join(
        str(event.get(name) or "")
        for name in (
            "datetime",
            "action",
            "source",
            "clientIP",
            "clientRequestPath",
            "clientRequestQuery",
            "userAgent",
        )
    )
    return hashlib.sha256(raw.encode("utf-8", errors="ignore")).hexdigest()[:24]


def _classify_cloudflare_event(event: dict) -> tuple[str, str]:
    path = str(event.get("clientRequestPath") or "").lower()
    query = str(event.get("clientRequestQuery") or "").lower()
    combined = f"{path}?{query}"
    prefix = "Cloudflare Edge"

    if any(token in combined for token in ("x-forwarded-for", "true-client-ip", "cf-connecting-ip")):
        return "Source IP Header Spoofing Attempt", prefix
    if "/api/accounts" in path and any(token in combined for token in ("role=", "role", "superadmin", "main_admin", "branch_admin")):
        return "Privilege Escalation Attempt", prefix
    if "/api/accounts" in path:
        return "Staff Account Authorization Attempt", prefix
    if any(path.startswith(auth_path) for auth_path in AUTH_PATHS):
        if any(token in combined for token in ("totp", "mfa", "otp", "code")):
            return "MFA/TOTP Bypass Attempt", prefix
        if any(token in combined for token in ("recaptcha", "captcha")):
            return "reCAPTCHA Bypass Attempt", prefix
        if any(token in combined for token in ("reset", "token")):
            return "Password Reset Token Tampering Attempt", prefix
        return "Authentication Abuse Attempt", prefix
    if any(token in combined for token in ("role=", "role", "superadmin", "main_admin", "branch_admin")):
        return "Privilege Escalation Attempt", prefix
    if any(token in combined for token in ("session", "jwt", "bearer", "token", "cookie")):
        return "Session Token Reuse/Tampering Attempt", prefix
    if any(token in combined for token in ("select", "union", "drop table", "'--", " or ", "<script", "system(", "phpinfo")):
        return "Injection Attempt Blocked", prefix
    if any(prefix_path in path for prefix_path in OWNERSHIP_PATHS):
        if any(token in combined for token in ("payment_reference", "paid", "amount", "status", "reference")):
            return "Payment Reference Spoofing Attempt", prefix
        if any(token in combined for token in ("receipt", "request_id", "receipt_id")):
            return "Receipt Ownership Spoofing Attempt", prefix
        if any(token in combined for token in ("queue", "ticket", "queue_number")):
            return "Queue Ownership Spoofing Attempt", prefix
        return "Ownership Spoofing Attempt", prefix
    if "/api/branch" in path or "branch_id" in combined:
        return "Branch Spoofing Attempt", prefix
    return "Cloudflare Security Challenge", prefix


def _cloudflare_query() -> str:
    # Keep fields to the documented Firewall Events example so the sync works
    # across Cloudflare plan/schema variations.
    return """
    query ListFirewallEvents($zoneTag: string, $filter: FirewallEventsAdaptiveFilter_InputObject) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          firewallEventsAdaptive(filter: $filter, limit: 50, orderBy: [datetime_DESC]) {
            action
            clientAsn
            clientCountryName
            clientIP
            clientRequestPath
            clientRequestQuery
            datetime
            source
            userAgent
          }
        }
      }
    }
    """


def fetch_cloudflare_firewall_events(minutes: int = 30) -> list[dict]:
    token = (os.getenv("CLOUDFLARE_API_TOKEN") or "").strip()
    zone_id = (os.getenv("CLOUDFLARE_ZONE_ID") or os.getenv("CLOUDFLARE_ZONE_TAG") or "").strip()
    if not token or not zone_id:
        return []

    end = _utc_now()
    start = end - timedelta(minutes=max(1, min(minutes, 180)))
    payload = {
        "query": _cloudflare_query(),
        "variables": {
            "zoneTag": zone_id,
            "filter": {
                "datetime_geq": start.isoformat().replace("+00:00", "Z"),
                "datetime_leq": end.isoformat().replace("+00:00", "Z"),
            },
        },
    }
    response = requests.post(
        CLOUDFLARE_GRAPHQL_URL,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=8,
    )
    response.raise_for_status()
    data = response.json()
    if data.get("errors"):
        return []
    zones = (((data.get("data") or {}).get("viewer") or {}).get("zones") or [])
    if not zones:
        return []
    events = zones[0].get("firewallEventsAdaptive") or []
    return [event for event in events if str(event.get("action") or "").lower() in CLOUDFLARE_ALERT_ACTIONS]


def sync_cloudflare_security_alerts(db: Session, *, minutes: int = 30) -> int:
    try:
        events = fetch_cloudflare_firewall_events(minutes=minutes)
    except Exception:
        return 0

    created = 0
    for event in events:
        key = _event_key(event)
        marker = f"cf_event={key}"
        exists = db.query(Alert.id).filter(Alert.message.contains(marker)).first()
        if exists:
            continue
        title, source_label = _classify_cloudflare_event(event)
        created_at = _parse_cf_datetime(event.get("datetime")) or datetime.utcnow()
        message = (
            f"{source_label} {event.get('action') or 'challenge'} | "
            f"path: {event.get('clientRequestPath') or '/'} | "
            f"query: {event.get('clientRequestQuery') or ''} | "
            f"source: {event.get('source') or 'unknown'} | "
            f"ip: {event.get('clientIP') or 'unknown'} | "
            f"country: {event.get('clientCountryName') or 'unknown'} | "
            f"ua: {event.get('userAgent') or 'unknown'} | {marker}"
        )
        db.add(Alert(type="malicious", title=title, message=message, severity="high", read=False, created_at=created_at))
        created += 1
    if created:
        db.commit()
    return created
