import hashlib
from datetime import datetime

from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

from auth.jwt_utils import decode_token
from database.models import RevokedToken


def token_hash(token: str) -> str:
    return hashlib.sha256((token or "").encode("utf-8")).hexdigest()


def is_token_revoked(db: Session, token: str) -> bool:
    digest = token_hash(token)
    try:
        row = db.query(RevokedToken).filter(RevokedToken.token_hash == digest).first()
    except ProgrammingError:
        # Table doesn't exist yet — treat token as not revoked
        return False
    if not row:
        return False
    return row.expires_at is None or row.expires_at >= datetime.utcnow()


def revoke_token(db: Session, token: str, secret_key: str, algorithm: str, token_type: str | None = None) -> None:
    if not token:
        return
    digest = token_hash(token)
    try:
        if db.query(RevokedToken).filter(RevokedToken.token_hash == digest).first():
            return
    except ProgrammingError:
        # Table doesn't exist yet — can't revoke, silently skip
        return
    subject = None
    expires_at = None
    try:
        payload = decode_token(token, secret_key, options={"verify_exp": False})
        subject = payload.get("sub")
        exp = payload.get("exp")
        if exp:
            expires_at = datetime.utcfromtimestamp(exp)
        token_type = token_type or payload.get("type")
    except Exception:
        pass
    db.add(RevokedToken(token_hash=digest, token_type=token_type, subject=subject, expires_at=expires_at))
