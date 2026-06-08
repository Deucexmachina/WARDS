"""
IP Reputation Service
- Checks IP reputation using AbuseIPDB API
- Caches results in database to avoid rate limits
- Supports automatic blocking of malicious IPs
"""
import os
import time
import json
import requests
from datetime import datetime, timedelta
from typing import Optional, Dict, List
from sqlalchemy.orm import Session

from database.models import IpReputationCache, PermanentIpBlock, get_db

ABUSEIPDB_API_KEY = os.getenv("ABUSEIPDB_API_KEY", "")
ABUSEIPDB_API_URL = "https://api.abuseipdb.com/api/v2/check"
CACHE_DURATION_HOURS = 24  # Cache reputation for 24 hours
MALICIOUS_THRESHOLD = 50  # Confidence score above this is considered malicious


def check_ip_reputation(ip: str, db: Session) -> Dict:
    """
    Check IP reputation using AbuseIPDB API with local caching.
    Returns dict with: is_malicious, confidence_score, report_count, threat_types
    """
    # Check cache first
    cached = db.query(IpReputationCache).filter(IpReputationCache.ip_address == ip).first()
    
    if cached:
        # Check if cache is still valid
        cache_age = datetime.utcnow() - cached.last_checked
        if cache_age < timedelta(hours=CACHE_DURATION_HOURS):
            return {
                "is_malicious": cached.is_malicious,
                "confidence_score": cached.confidence_score,
                "report_count": cached.report_count,
                "threat_types": json.loads(cached.threat_types) if cached.threat_types else [],
                "cached": True
            }
    
    # No valid cache, fetch from API
    if not ABUSEIPDB_API_KEY:
        # No API key configured, return safe default
        return {
            "is_malicious": False,
            "confidence_score": 0,
            "report_count": 0,
            "threat_types": [],
            "cached": False,
            "error": "API key not configured"
        }
    
    try:
        response = requests.get(
            ABUSEIPDB_API_URL,
            params={
                "ipAddress": ip,
                "maxAgeInDays": 90,
                "verbose": ""
            },
            headers={
                "Key": ABUSEIPDB_API_KEY,
                "Accept": "application/json"
            },
            timeout=5
        )
        response.raise_for_status()
        data = response.json()
        
        abuse_confidence = data.get("data", {}).get("abuseConfidenceScore", 0)
        total_reports = data.get("data", {}).get("totalReports", 0)
        is_malicious = abuse_confidence >= MALICIOUS_THRESHOLD
        
        # Extract threat types
        reports = data.get("data", {}).get("reports", [])
        threat_types = sorted({
            str(category)
            for report in reports[:10]
            for category in (report.get("categories") or [])
            if category
        })
        
        # Update or create cache entry
        if cached:
            cached.is_malicious = is_malicious
            cached.confidence_score = abuse_confidence
            cached.report_count = total_reports
            cached.threat_types = json.dumps(threat_types)
            cached.last_checked = datetime.utcnow()
        else:
            cached = IpReputationCache(
                ip_address=ip,
                is_malicious=is_malicious,
                confidence_score=abuse_confidence,
                report_count=total_reports,
                threat_types=json.dumps(threat_types),
                last_checked=datetime.utcnow()
            )
            db.add(cached)
        
        db.commit()
        
        return {
            "is_malicious": is_malicious,
            "confidence_score": abuse_confidence,
            "report_count": total_reports,
            "threat_types": threat_types,
            "cached": False
        }
        
    except requests.RequestException as e:
        # API error, return safe default
        return {
            "is_malicious": False,
            "confidence_score": 0,
            "report_count": 0,
            "threat_types": [],
            "cached": False,
            "error": str(e)
        }


def is_permanently_blocked(ip: str, db: Session) -> bool:
    """Check if IP is in permanent blocklist"""
    block = db.query(PermanentIpBlock).filter(
        PermanentIpBlock.ip_address == ip,
        PermanentIpBlock.is_active == True
    ).first()
    return block is not None


def add_permanent_block(ip: str, reason: str, blocked_by: str, db: Session) -> PermanentIpBlock:
    """Add IP to permanent blocklist"""
    existing = db.query(PermanentIpBlock).filter(PermanentIpBlock.ip_address == ip).first()
    
    if existing:
        existing.is_active = True
        existing.reason = reason
        existing.blocked_by = blocked_by
        existing.blocked_at = datetime.utcnow()
        existing.abuse_count += 1
    else:
        existing = PermanentIpBlock(
            ip_address=ip,
            reason=reason,
            blocked_by=blocked_by,
            blocked_at=datetime.utcnow(),
            is_active=True,
            abuse_count=1
        )
        db.add(existing)
    
    db.commit()
    db.refresh(existing)
    return existing


def remove_permanent_block(ip: str, db: Session) -> bool:
    """Remove IP from permanent blocklist (soft delete)"""
    block = db.query(PermanentIpBlock).filter(PermanentIpBlock.ip_address == ip).first()
    if block:
        block.is_active = False
        db.commit()
        return True
    return False


def get_permanent_blocks(db: Session, active_only: bool = True) -> List[PermanentIpBlock]:
    """Get all permanent blocks"""
    query = db.query(PermanentIpBlock)
    if active_only:
        query = query.filter(PermanentIpBlock.is_active == True)
    return query.order_by(PermanentIpBlock.blocked_at.desc()).all()


def auto_block_if_malicious(ip: str, db: Session, threshold: int = MALICIOUS_THRESHOLD) -> bool:
    """
    Check IP reputation and report whether the IP meets the malicious threshold.
    Permanent blocks are reserved for explicit admin actions in the Security Dashboard.
    Returns True if temporary blocking should be applied by the caller.
    """
    reputation = check_ip_reputation(ip, db)
    return bool(reputation["is_malicious"] and reputation["confidence_score"] >= threshold)
