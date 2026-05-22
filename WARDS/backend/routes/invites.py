from datetime import datetime, timedelta
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from database.models import ActivityLog, Invite, get_db
from middleware.admin_auth import get_current_admin_user
from utils.field_crypto import apply_invite_security, get_decrypted_or_raw

router = APIRouter()


class InviteCreateRequest(BaseModel):
    email: EmailStr
    role: str


@router.post("/invite")
async def create_invite(
    request: Request,
    invite_data: InviteCreateRequest,
    current_admin=Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    if current_admin.role not in {"main_admin", "admin", "superadmin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

    if invite_data.role not in {"branch", "admin"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invite role must be either branch or admin",
        )

    token = secrets.token_urlsafe(32)
    invite = Invite(
        email=invite_data.email.lower(),
        role=invite_data.role,
        token=token,
        expires_at=datetime.utcnow() + timedelta(hours=24),
        used=False,
    )
    db.add(invite)
    db.flush()
    apply_invite_security(invite)
    db.add(ActivityLog(
        action="Invite Created",
        user=current_admin.username,
        details=f"Invite for {get_decrypted_or_raw(invite, 'email') or invite_data.email.lower()} as {get_decrypted_or_raw(invite, 'role') or invite_data.role} from IP: {request.client.host}",
        type="admin_invite",
    ))
    db.commit()
    db.refresh(invite)

    print(f"[INVITE] {get_decrypted_or_raw(invite, 'role') or invite.role} invite for {get_decrypted_or_raw(invite, 'email') or invite.email}: {get_decrypted_or_raw(invite, 'token') or invite.token}")

    return {
        "id": invite.id,
        "email": get_decrypted_or_raw(invite, "email") or invite.email,
        "role": get_decrypted_or_raw(invite, "role") or invite.role,
        "token": get_decrypted_or_raw(invite, "token") or token,
        "expires_at": invite.expires_at.isoformat(),
        "message": "Invite created successfully",
    }
