import hashlib
from datetime import datetime

from jose import jwt
from sqlalchemy.orm import Session

from database.models import RevokedToken


def token_hash(token: str) -> str:
    return hashlib.sha256((token or "").encode("utf-8")).hexdigest()


def is_token_revoked(db: Session, token: str) -> bool:
    digest = token_hash(token)
    row = db.query(RevokedToken).filter(RevokedToken.token_hash == digest).first()
    if not row:
        return False
    return row.expires_at is None or row.expires_at >= datetime.utcnow()


def revoke_token(db: Session, token: str, secret_key: str, algorithm: str, token_type: str | None = None) -> None:
    if not token:
        return
    digest = token_hash(token)
    if db.query(RevokedToken).filter(RevokedToken.token_hash == digest).first():
        return
    subject = None
    expires_at = None
    try:
        payload = jwt.decode(token, secret_key, algorithms=[algorithm], options={"verify_exp": False})
        subject = payload.get("sub")
        exp = payload.get("exp")
        if exp:
            expires_at = datetime.utcfromtimestamp(exp)
        token_type = token_type or payload.get("type")
    except Exception:
        pass
    db.add(RevokedToken(token_hash=digest, token_type=token_type, subject=subject, expires_at=expires_at))
