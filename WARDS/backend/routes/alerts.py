from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database.models import Alert, AlertView, User, get_db
from middleware.admin_auth import get_current_admin_user
from utils.rbac import require_permission

router = APIRouter()

@router.get("/")
async def get_all_alerts(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    require_permission("view_alerts")(current_user)
    query = db.query(Alert).order_by(Alert.created_at.desc())
    total = query.count()
    total_pages = max(1, (total + page_size - 1) // page_size)
    page = min(max(1, page), total_pages)
    alerts = query.offset((page - 1) * page_size).limit(page_size).all()
    viewed_ids = {
        row.alert_id
        for row in db.query(AlertView).filter(
            AlertView.viewer_username == current_user.username,
            AlertView.viewer_type == "admin",
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
    require_permission("view_alerts")(current_user)
    viewed_ids = {
        row.alert_id
        for row in db.query(AlertView).filter(
            AlertView.viewer_username == current_user.username,
            AlertView.viewer_type == "admin",
        ).all()
    }
    all_ids = [row.id for row in db.query(Alert.id).all()]
    return {"unread_count": len([alert_id for alert_id in all_ids if alert_id not in viewed_ids])}

@router.put("/{alert_id}/read")
async def mark_alert_as_read(
    alert_id: int,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
):
    require_permission("view_alerts")(current_user)
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    existing = db.query(AlertView).filter(
        AlertView.alert_id == alert_id,
        AlertView.viewer_username == current_user.username,
        AlertView.viewer_type == "admin",
    ).first()
    if not existing:
        db.add(AlertView(alert_id=alert_id, viewer_username=current_user.username, viewer_type="admin"))
    db.commit()
    
    return {"message": "Alert marked as read"}
