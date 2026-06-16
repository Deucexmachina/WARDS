from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from database.models import PrivacyConsent, Admin, get_db
from auth import get_current_admin_user
from utils.field_crypto import get_decrypted_or_raw
from utils.privacy_agreement import get_public_privacy_agreement
from utils.rbac import require_permission

router = APIRouter()


def _to_iso_utc(value):
    if value is None:
        return None
    return f"{value.isoformat()}Z"


@router.get("/data-privacy-agreement")
async def get_data_privacy_agreement():
    return get_public_privacy_agreement()


@router.get("/consents")
async def get_privacy_consents(
    current_user: Admin = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
    user_id: int | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
):
    require_permission("manage_users")(current_user)

    query = db.query(PrivacyConsent).order_by(PrivacyConsent.consented_at.desc(), PrivacyConsent.id.desc())
    if user_id is not None:
        query = query.filter(PrivacyConsent.citizen_user_id == user_id)

    records = query.limit(limit).all()

    return [
        {
            "id": record.id,
            "citizen_user_id": record.citizen_user_id,
            "agreement_title": record.agreement_title,
            "agreement_version": record.agreement_version,
            "agreement_effective_date": record.agreement_effective_date,
            "source_module": record.source_module,
            "consented_at": _to_iso_utc(record.consented_at),
            "accepted_date": record.consented_at.strftime("%Y-%m-%d") if record.consented_at else None,
            "accepted_time": record.consented_at.strftime("%H:%M:%S") if record.consented_at else None,
            "ip_address": get_decrypted_or_raw(record, "ip_address"),
        }
        for record in records
    ]
