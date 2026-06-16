from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from slowapi import Limiter
from slowapi.util import get_remote_address
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database.models import Service, Admin, get_db
from auth import get_current_admin_user
from utils.field_crypto import service_value
from utils.rbac import require_permission
from utils.system_settings import (
    SETTINGS_METADATA,
    delete_settings_audit_entry,
    get_settings_audit_history,
    get_settings_payload,
    update_system_settings,
)

def get_rate_limit_key(request: Request) -> str:
    """Get rate limit key - user-based if authenticated, otherwise IP-based"""
    if hasattr(request.state, 'user') and request.state.user:
        return f"user:{request.state.user.id}"
    return get_remote_address(request)


limiter = Limiter(key_func=get_rate_limit_key)

router = APIRouter()


def ensure_settings_access(current_user: Admin):
    if current_user.role not in {"main_admin", "superadmin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="System Settings access is restricted to Main Admin and Super Admin.",
        )
    require_permission("manage_settings")(current_user)
    return current_user


class SettingsUpdateRequest(BaseModel):
    queueEnabled: bool
    maxQueuePerBranch: int = Field(ge=1)
    maxQueuePerWindow: int = Field(ge=1)
    queueTimeSlot: int = Field(ge=1)
    enabledServices: list[str]
    paymentGatewayEnabled: bool
    receiptRequestEnabled: bool
    maintenanceMode: bool
    sessionTimeout: int = Field(ge=5)
    maxLoginAttempts: int = Field(ge=1)
    reason: str | None = None


@router.get("/")
async def get_settings(
    current_user: Admin = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    ensure_settings_access(current_user)
    payload = get_settings_payload(db)
    payload["metadata"] = SETTINGS_METADATA
    payload["serviceOptions"] = sorted(
        [
            service_value(service, "name")
            for service in db.query(Service).filter(Service.is_active.is_(True)).all()
            if service_value(service, "name")
        ]
    )
    return payload


@router.get("/access")
async def get_settings_access(
    current_user: Admin = Depends(get_current_admin_user),
):
    ensure_settings_access(current_user)
    return {
        "allowed": True,
        "role": current_user.role,
    }


@router.get("/history")
async def get_settings_history(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=50),
    search: str | None = Query(default=None),
    category: str | None = Query(default=None),
    current_user: Admin = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    ensure_settings_access(current_user)
    return get_settings_audit_history(
        db,
        page=page,
        page_size=page_size,
        search=search,
        category=category,
    )


@router.delete("/history/{audit_id}")
async def delete_settings_history_entry(
    audit_id: int,
    current_user: Admin = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    ensure_settings_access(current_user)
    return delete_settings_audit_entry(db, audit_id=audit_id, deleted_by=current_user.username)


@router.put("/")
@limiter.limit("10/minute")
async def update_settings(
    request: Request,
    payload: SettingsUpdateRequest,
    current_user: Admin = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    ensure_settings_access(current_user)
    return update_system_settings(
        db=db,
        payload=payload.model_dump(exclude={"reason"}),
        changed_by=current_user.username,
        reason=payload.reason,
    )
