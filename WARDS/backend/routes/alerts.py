from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database.models import Alert, AlertView, User, get_db
from auth import get_current_admin_user
from utils.rbac import check_permission

router = APIRouter()

BRANCH_ALERT_TYPES = {"branch", "branch_operation", "branch_alert", "queue", "receipt", "payment", "operational"}


def can_view_alerts(user: User) -> bool:
    return check_permission(user, "view_alerts") or check_permission(user, "view_branch_alerts")


def viewer_type_for(user: User) -> str:
    return "branch" if getattr(user, "role", "") in {"branch_admin", "branch_staff"} else "admin"


def scoped_alert_query(db: Session, user: User):
    query = db.query(Alert)
    if check_permission(user, "view_alerts"):
        return query
    return query.filter(Alert.type.in_(BRANCH_ALERT_TYPES))

@router.get("/")
async def get_all_alerts(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    if not can_view_alerts(current_user):
        raise HTTPException(status_code=403, detail="Permission denied: alert viewing required")
    viewer_type = viewer_type_for(current_user)
    query = scoped_alert_query(db, current_user).order_by(Alert.created_at.desc())
    total = query.count()
    total_pages = max(1, (total + page_size - 1) // page_size)
    page = min(max(1, page), total_pages)
    alerts = query.offset((page - 1) * page_size).limit(page_size).all()
    viewed_ids = {
        row.alert_id
        for row in db.query(AlertView).filter(
            AlertView.viewer_username == current_user.username,
            AlertView.viewer_type == viewer_type,
        ).all()
    }
    items = [
        {
            "id": alert.id,
            "type": alert.type,
            "title": alert.title,
            "message": alert.message,
            "severity": alert.severity,
            "read": alert.id in viewed_ids,
            "created_at": alert.created_at.isoformat() if alert.created_at else None,
        }
        for alert in alerts
    ]
    return {"items": items, "page": page, "page_size": page_size, "total": total, "total_pages": total_pages}


@router.get("/unread-count")
async def get_unread_alert_count(
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    if not can_view_alerts(current_user):
        raise HTTPException(status_code=403, detail="Permission denied: alert viewing required")
    viewer_type = viewer_type_for(current_user)
    viewed_ids = {
        row.alert_id
        for row in db.query(AlertView).filter(
            AlertView.viewer_username == current_user.username,
            AlertView.viewer_type == viewer_type,
        ).all()
    }
    all_ids = [row.id for row in scoped_alert_query(db, current_user).with_entities(Alert.id).all()]
    return {"unread_count": len([alert_id for alert_id in all_ids if alert_id not in viewed_ids])}


@router.put("/read-all")
async def mark_all_alerts_as_read(
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    if not can_view_alerts(current_user):
        raise HTTPException(status_code=403, detail="Permission denied: alert viewing required")
    viewer_type = viewer_type_for(current_user)
    alert_ids = [row.id for row in scoped_alert_query(db, current_user).with_entities(Alert.id).all()]
    existing_query = db.query(AlertView).filter(
        AlertView.viewer_username == current_user.username,
        AlertView.viewer_type == viewer_type,
    )
    if alert_ids:
        existing_query = existing_query.filter(AlertView.alert_id.in_(alert_ids))
    existing = {row.alert_id for row in existing_query.all()} if alert_ids else set()
    created = 0
    for alert_id in alert_ids:
        if alert_id not in existing:
            db.add(AlertView(alert_id=alert_id, viewer_username=current_user.username, viewer_type=viewer_type))
            created += 1
    if created:
        db.commit()
    return {"message": "Alerts marked as read", "marked": created, "unread_count": 0}


@router.put("/{alert_id}/read")
async def mark_alert_as_read(
    alert_id: int,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    if not can_view_alerts(current_user):
        raise HTTPException(status_code=403, detail="Permission denied: alert viewing required")
    viewer_type = viewer_type_for(current_user)
    alert = scoped_alert_query(db, current_user).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    existing = db.query(AlertView).filter(
        AlertView.alert_id == alert_id,
        AlertView.viewer_username == current_user.username,
        AlertView.viewer_type == viewer_type,
    ).first()
    if not existing:
        db.add(AlertView(alert_id=alert_id, viewer_username=current_user.username, viewer_type=viewer_type))
    db.commit()
    
    return {"message": "Alert marked as read"}
