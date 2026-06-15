from fastapi import HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from jose import JWTError, jwt
import os

from database.models import CitizenUser, get_db
from utils.field_crypto import find_citizen_by_email
from utils.token_revocation import is_token_revoked

SECRET_KEY = os.getenv("USER_SECRET_KEY", "your-user-secret-key-change-in-production")
UNIFIED_SECRET_KEY = os.getenv("AUTH_SECRET_KEY", "your-unified-auth-secret-change-in-production")
ALGORITHM = "HS256"

security = HTTPBearer()

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> CitizenUser:
    token = credentials.credentials
    if is_token_revoked(db, token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session has been logged out")
    
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    user = None
    try:
        payload = jwt.decode(token, UNIFIED_SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("email") or payload.get("sub")
        role: str = payload.get("role")
        token_type: str = payload.get("type")

        if email is None or token_type != "role_auth" or role != "public":
            raise credentials_exception

        user = find_citizen_by_email(db, CitizenUser, email)
    except JWTError:
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            email: str = payload.get("sub")
            token_type: str = payload.get("type")

            if email is None or token_type not in {"user", "public"}:
                raise credentials_exception

            user = find_citizen_by_email(db, CitizenUser, email)
        except JWTError:
            raise credentials_exception

    if user is None:
        raise credentials_exception
    
    if user.status != "Active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is not active"
        )
    
    return user
