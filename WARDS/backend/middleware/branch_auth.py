from fastapi import HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from jose import JWTError, jwt
import os

from database.models import BranchStaff, get_db
from utils.token_revocation import is_token_revoked

SECRET_KEY = os.getenv("BRANCH_SECRET_KEY", "your-branch-secret-key-change-in-production")
UNIFIED_SECRET_KEY = os.getenv("AUTH_SECRET_KEY", "your-unified-auth-secret-change-in-production")
ALGORITHM = "HS256"

security = HTTPBearer()

async def get_current_branch_staff(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> BranchStaff:
    token = credentials.credentials
    if is_token_revoked(db, token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session has been logged out")
    
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    staff = None
    try:
        payload = jwt.decode(token, UNIFIED_SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("email") or payload.get("sub")
        role: str = payload.get("role")
        token_type: str = payload.get("type")

        if email is None or token_type != "role_auth" or role != "branch":
            raise credentials_exception

        staff = db.query(BranchStaff).filter(BranchStaff.email == email).first()
    except JWTError:
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            username: str = payload.get("sub")
            token_type: str = payload.get("type")

            if username is None or token_type != "branch":
                raise credentials_exception

            staff = db.query(BranchStaff).filter(BranchStaff.username == username).first()
        except JWTError:
            raise credentials_exception

    if staff is None:
        raise credentials_exception
    
    if staff.status != "Active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is not active"
        )
    
    return staff

def require_branch_role(*allowed_roles: str):
    async def role_checker(
        current_staff: BranchStaff = Depends(get_current_branch_staff)
    ) -> BranchStaff:
        if current_staff.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required roles: {', '.join(allowed_roles)}"
            )
        return current_staff
    return role_checker

def require_branch_admin():
    return require_branch_role("branch_admin")

def require_any_branch_staff():
    return require_branch_role("branch_admin", "branch_staff")

async def verify_branch_access(
    branch_id: int,
    current_staff: BranchStaff = Depends(get_current_branch_staff)
) -> BranchStaff:
    if current_staff.branch_id != branch_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this branch"
        )
    return current_staff
