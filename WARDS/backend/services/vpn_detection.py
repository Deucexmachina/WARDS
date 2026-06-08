"""
VPN/proxy detection helper for security risk scoring.

The detector combines local IP classification, AbuseIPDB metadata when an API key
is configured, and a best-effort public geolocation/proxy lookup. Every network
call is optional and short-lived so security scans never depend on a third-party
service being available.
"""
from __future__ import annotations

import ipaddress
import os
from datetime import datetime, timedelta
from typing import Any

import requests


_CACHE: dict[str, dict[str, Any]] = {}
_CACHE_TTL = timedelta(hours=6)


DATACENTER_KEYWORDS = (
    "vpn",
    "proxy",
    "hosting",
    "datacenter",
    "data center",
    "colo",
    "cloud",
    "aws",
    "amazon",
    "azure",
    "google cloud",
    "digitalocean",
    "linode",
    "ovh",
    "hetzner",
    "m247",
    "leaseweb",
)


def _blank(ip: str, reason: str = "") -> dict[str, Any]:
    return {
        "ip": ip,
        "is_vpn": False,
        "is_proxy": False,
        "is_hosting": False,
        "provider": None,
        "country": None,
        "city": None,
        "risk_score": 0,
        "signals": [],
        "source": "local",
        "checked_at": datetime.utcnow().isoformat(),
        "error": reason or None,
    }


def _is_public_ip(ip: str) -> bool:
    try:
        parsed = ipaddress.ip_address(ip)
        return not (
            parsed.is_private
            or parsed.is_loopback
            or parsed.is_link_local
            or parsed.is_reserved
            or parsed.is_multicast
            or parsed.is_unspecified
        )
    except ValueError:
        return False


def _keyword_risk(*values: Any) -> tuple[int, list[str]]:
    text = " ".join(str(value or "").lower() for value in values)
    hits = [keyword for keyword in DATACENTER_KEYWORDS if keyword in text]
    if not hits:
        return 0, []
    if any(keyword in hits for keyword in ("vpn", "proxy")):
        return 35, [f"provider_keyword:{keyword}" for keyword in hits[:4]]
    return 20, [f"hosting_keyword:{keyword}" for keyword in hits[:4]]


def _abuseipdb_lookup(ip: str) -> dict[str, Any]:
    api_key = os.getenv("ABUSEIPDB_API_KEY", "").strip()
    if not api_key:
        return {}
    response = requests.get(
        "https://api.abuseipdb.com/api/v2/check",
        params={"ipAddress": ip, "maxAgeInDays": 90, "verbose": ""},
        headers={"Key": api_key, "Accept": "application/json"},
        timeout=4,
    )
    response.raise_for_status()
    data = response.json().get("data", {}) or {}
    return {
        "abuse_confidence": data.get("abuseConfidenceScore") or 0,
        "usage_type": data.get("usageType"),
        "isp": data.get("isp"),
        "domain": data.get("domain"),
        "country": data.get("countryCode"),
        "source": "abuseipdb",
    }


def _ip_api_lookup(ip: str) -> dict[str, Any]:
    response = requests.get(
        f"http://ip-api.com/json/{ip}",
        params={"fields": "status,message,country,city,isp,org,as,proxy,hosting,mobile"},
        timeout=4,
    )
    response.raise_for_status()
    data = response.json() or {}
    if data.get("status") != "success":
        return {"error": data.get("message") or "ip-api lookup failed"}
    return {
        "is_proxy": bool(data.get("proxy")),
        "is_hosting": bool(data.get("hosting")),
        "provider": data.get("org") or data.get("isp") or data.get("as"),
        "country": data.get("country"),
        "city": data.get("city"),
        "source": "ip-api",
    }


def detect_vpn(ip: str | None) -> dict[str, Any]:
    ip = str(ip or "").strip()
    if not ip or ip.lower() == "unknown":
        return _blank("unknown", "No source IP was provided.")
    if not _is_public_ip(ip):
        result = _blank(ip)
        result["signals"].append("local_or_private_ip")
        return result

    cached = _CACHE.get(ip)
    if cached:
        checked = cached.get("_cached_at")
        if isinstance(checked, datetime) and datetime.utcnow() - checked < _CACHE_TTL:
            return {key: value for key, value in cached.items() if key != "_cached_at"}

    result = _blank(ip)
    errors: list[str] = []

    try:
        abuse = _abuseipdb_lookup(ip)
        if abuse:
            result["source"] = abuse.get("source") or result["source"]
            result["country"] = abuse.get("country") or result["country"]
            result["provider"] = abuse.get("isp") or abuse.get("domain") or result["provider"]
            abuse_score = int(abuse.get("abuse_confidence") or 0)
            if abuse_score >= 50:
                result["risk_score"] += min(40, abuse_score // 2)
                result["signals"].append(f"abuseipdb_score:{abuse_score}")
            keyword_score, keyword_signals = _keyword_risk(abuse.get("usage_type"), abuse.get("isp"), abuse.get("domain"))
            result["risk_score"] += keyword_score
            result["signals"].extend(keyword_signals)
    except Exception as exc:
        errors.append(f"abuseipdb:{exc}")

    try:
        geo = _ip_api_lookup(ip)
        if geo and not geo.get("error"):
            result.update({
                "is_proxy": bool(geo.get("is_proxy")) or result["is_proxy"],
                "is_hosting": bool(geo.get("is_hosting")) or result["is_hosting"],
                "provider": geo.get("provider") or result["provider"],
                "country": geo.get("country") or result["country"],
                "city": geo.get("city") or result["city"],
                "source": "vpn_detector",
            })
            if geo.get("is_proxy"):
                result["risk_score"] += 45
                result["signals"].append("geo_proxy:true")
            if geo.get("is_hosting"):
                result["risk_score"] += 25
                result["signals"].append("geo_hosting:true")
            keyword_score, keyword_signals = _keyword_risk(geo.get("provider"))
            result["risk_score"] += keyword_score
            result["signals"].extend(keyword_signals)
        elif geo.get("error"):
            errors.append(f"ip-api:{geo.get('error')}")
    except Exception as exc:
        errors.append(f"ip-api:{exc}")

    result["risk_score"] = max(0, min(100, int(result["risk_score"])))
    result["is_vpn"] = bool(result["is_proxy"] or result["risk_score"] >= 45 or any("vpn" in signal for signal in result["signals"]))
    result["signals"] = sorted(set(result["signals"]))
    result["error"] = "; ".join(errors) if errors else None
    cached_result = {**result, "_cached_at": datetime.utcnow()}
    _CACHE[ip] = cached_result
    return result
