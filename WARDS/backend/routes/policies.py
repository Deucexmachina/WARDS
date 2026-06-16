from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.models import ActivityLog, Policy, PolicyView, User, get_db
from auth import get_current_admin_user
from utils.rbac import require_permission

router = APIRouter()


def to_iso_utc(value):
    if value is None:
        return None
    return f"{value.isoformat()}Z"


def serialize_policy(policy: Policy, current_username: str | None = None, viewer_type: str = "admin", db: Session | None = None):
    is_viewed = False
    if current_username and db:
        is_viewed = db.query(PolicyView).filter(
            PolicyView.policy_id == policy.id,
            PolicyView.viewer_username == current_username,
            PolicyView.viewer_type == viewer_type,
        ).first() is not None
    return {
        "id": policy.id,
        "title": policy.title,
        "category": policy.category,
        "content": policy.content,
        "author": policy.author,
        "is_viewed": is_viewed,
        "created_at": to_iso_utc(policy.created_at),
        "updated_at": to_iso_utc(policy.updated_at),
    }


class PolicyPayload(BaseModel):
    title: str
    category: str
    content: str

@router.get("/")
async def get_all_policies(
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    require_permission("manage_policies")(current_user)
    policies = db.query(Policy).order_by(Policy.updated_at.desc(), Policy.id.desc()).all()
    return [serialize_policy(policy, current_user.username, "admin", db) for policy in policies]


@router.post("/{policy_id}/mark-viewed")
async def mark_policy_viewed(
    policy_id: int,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    require_permission("manage_policies")(current_user)
    policy = db.query(Policy).filter(Policy.id == policy_id).first()
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")

    existing_view = db.query(PolicyView).filter(
        PolicyView.policy_id == policy_id,
        PolicyView.viewer_username == current_user.username,
        PolicyView.viewer_type == "admin",
    ).first()
    if not existing_view:
        db.add(PolicyView(
            policy_id=policy_id,
            viewer_username=current_user.username,
            viewer_type="admin",
        ))
        db.commit()
    return {"message": "Policy marked as viewed"}


@router.get("/unread-count")
async def get_policy_unread_count(
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    require_permission("manage_policies")(current_user)
    all_policy_ids = [policy.id for policy in db.query(Policy).all()]
    viewed_policy_ids = [
        view.policy_id for view in db.query(PolicyView).filter(
            PolicyView.viewer_username == current_user.username,
            PolicyView.viewer_type == "admin",
        ).all()
    ]
    unread_count = len([policy_id for policy_id in all_policy_ids if policy_id not in viewed_policy_ids])
    return {"unread_count": unread_count}


@router.put("/{policy_id}")
async def update_policy(
    policy_id: int,
    payload: PolicyPayload,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    require_permission("manage_policies")(current_user)
    policy = db.query(Policy).filter(Policy.id == policy_id).first()
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")

    policy.title = payload.title.strip()
    policy.category = payload.category.strip()
    policy.content = payload.content.strip()
    policy.author = current_user.username
    db.add(ActivityLog(
        action="Policy Updated",
        user=current_user.username,
        details=f"Updated policy: {policy.title}",
        type="admin",
    ))
    db.commit()
    db.refresh(policy)
    return serialize_policy(policy, current_user.username, "admin", db)


@router.delete("/{policy_id}")
async def delete_policy(
    policy_id: int,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    require_permission("manage_policies")(current_user)
    policy = db.query(Policy).filter(Policy.id == policy_id).first()
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")

    title = policy.title
    db.query(PolicyView).filter(PolicyView.policy_id == policy_id).delete()
    db.delete(policy)
    db.add(ActivityLog(
        action="Policy Deleted",
        user=current_user.username,
        details=f"Deleted policy: {title}",
        type="admin",
    ))
    db.commit()
    return {"deleted_id": policy_id, "title": title}
