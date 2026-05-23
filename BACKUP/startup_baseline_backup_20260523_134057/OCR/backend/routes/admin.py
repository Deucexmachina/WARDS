from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from typing import List
from datetime import datetime
from pydantic import BaseModel

from database.config import get_db
from database.models import QueueEntry, Service, User, ActivityLog, QueueStatus
from auth.utils import get_current_user, get_current_admin_user

router = APIRouter()

class QueueActionRequest(BaseModel):
    queue_number: str
    notes: str = None

class QueueEntryResponse(BaseModel):
    id: int
    queue_number: str
    service_id: int
    service_name: str
    counter: int
    client_name: str
    priority_tag: str = None
    status: str
    position: int = None
    created_at: datetime
    called_at: datetime = None
    completed_at: datetime = None

    class Config:
        from_attributes = True

@router.get("/dashboard/stats")
async def get_dashboard_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get dashboard statistics"""
    total_waiting = db.query(QueueEntry).filter(QueueEntry.status == QueueStatus.waiting).count()
    total_serving = db.query(QueueEntry).filter(QueueEntry.status == QueueStatus.serving).count()
    total_completed_today = db.query(QueueEntry).filter(
        and_(
            QueueEntry.status == QueueStatus.completed,
            func.date(QueueEntry.completed_at) == func.current_date()
        )
    ).count()
    total_no_show_today = db.query(QueueEntry).filter(
        and_(
            QueueEntry.status == QueueStatus.no_show,
            func.date(QueueEntry.created_at) == func.current_date()
        )
    ).count()
    
    return {
        "waiting": total_waiting,
        "serving": total_serving,
        "completed_today": total_completed_today,
        "no_show_today": total_no_show_today
    }

@router.get("/queue/all")
async def get_all_queues(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all queue entries grouped by service"""
    services = db.query(Service).filter(Service.is_active == True).all()
    
    result = []
    for service in services:
        queues = db.query(QueueEntry).filter(
            and_(
                QueueEntry.service_id == service.id,
                QueueEntry.status.in_([QueueStatus.waiting, QueueStatus.serving])
            )
        ).order_by(QueueEntry.created_at).all()
        
        serving = None
        waiting = []
        
        for queue in queues:
            if queue.status == QueueStatus.serving:
                serving = {
                    "id": queue.id,
                    "queue_number": queue.queue_number,
                    "client_name": queue.client_name,
                    "priority_tag": queue.priority_tag,
                    "called_at": queue.called_at
                }
            else:
                waiting.append({
                    "id": queue.id,
                    "queue_number": queue.queue_number,
                    "client_name": queue.client_name,
                    "priority_tag": queue.priority_tag,
                    "created_at": queue.created_at
                })
        
        result.append({
            "service_id": service.id,
            "service_name": service.name,
            "counter": service.counter,
            "current_serving": serving,
            "waiting": waiting,
            "waiting_count": len(waiting)
        })
    
    return result

@router.post("/queue/call-next/{service_id}")
async def call_next_client(
    service_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Call next client in queue"""
    # Complete any currently serving for this service
    current_serving = db.query(QueueEntry).filter(
        and_(
            QueueEntry.service_id == service_id,
            QueueEntry.status == QueueStatus.serving
        )
    ).first()
    
    if current_serving:
        current_serving.status = QueueStatus.completed
        current_serving.completed_at = datetime.utcnow()
    
    # Get next waiting client
    next_client = db.query(QueueEntry).filter(
        and_(
            QueueEntry.service_id == service_id,
            QueueEntry.status == QueueStatus.waiting
        )
    ).order_by(QueueEntry.created_at).first()
    
    if not next_client:
        db.commit()
        return {"message": "No clients waiting", "queue_number": None}
    
    # Update to serving
    next_client.status = QueueStatus.serving
    next_client.called_at = datetime.utcnow()
    next_client.served_by = current_user.id
    
    # Log activity
    activity = ActivityLog(
        user_id=current_user.id,
        action="call_next",
        entity_type="queue",
        entity_id=next_client.id,
        description=f"Called {next_client.queue_number} for service {service_id}"
    )
    db.add(activity)
    db.commit()
    
    return {
        "message": "Client called",
        "queue_number": next_client.queue_number,
        "client_name": next_client.client_name
    }

@router.post("/queue/complete")
async def complete_client(
    request: QueueActionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Mark current client as completed"""
    queue_entry = db.query(QueueEntry).filter(
        QueueEntry.queue_number == request.queue_number
    ).first()
    
    if not queue_entry:
        raise HTTPException(status_code=404, detail="Queue entry not found")
    
    queue_entry.status = QueueStatus.completed
    queue_entry.completed_at = datetime.utcnow()
    if request.notes:
        queue_entry.notes = request.notes
    
    # Log activity
    activity = ActivityLog(
        user_id=current_user.id,
        action="complete",
        entity_type="queue",
        entity_id=queue_entry.id,
        description=f"Completed {queue_entry.queue_number}"
    )
    db.add(activity)
    db.commit()
    
    return {"message": "Client marked as completed"}

@router.post("/queue/no-show")
async def mark_no_show(
    request: QueueActionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Mark client as no-show"""
    queue_entry = db.query(QueueEntry).filter(
        QueueEntry.queue_number == request.queue_number
    ).first()
    
    if not queue_entry:
        raise HTTPException(status_code=404, detail="Queue entry not found")
    
    queue_entry.status = QueueStatus.no_show
    queue_entry.completed_at = datetime.utcnow()
    if request.notes:
        queue_entry.notes = request.notes
    
    # Log activity
    activity = ActivityLog(
        user_id=current_user.id,
        action="no_show",
        entity_type="queue",
        entity_id=queue_entry.id,
        description=f"Marked {queue_entry.queue_number} as no-show"
    )
    db.add(activity)
    db.commit()
    
    return {"message": "Client marked as no-show"}

@router.post("/queue/skip")
async def skip_client(
    request: QueueActionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Skip client (move to end of queue)"""
    queue_entry = db.query(QueueEntry).filter(
        QueueEntry.queue_number == request.queue_number
    ).first()
    
    if not queue_entry:
        raise HTTPException(status_code=404, detail="Queue entry not found")
    
    # If currently serving, move back to waiting
    if queue_entry.status == QueueStatus.serving:
        queue_entry.status = QueueStatus.waiting
        queue_entry.called_at = None
        # Update created_at to move to end
        queue_entry.created_at = datetime.utcnow()
    
    if request.notes:
        queue_entry.notes = request.notes
    
    # Log activity
    activity = ActivityLog(
        user_id=current_user.id,
        action="skip",
        entity_type="queue",
        entity_id=queue_entry.id,
        description=f"Skipped {queue_entry.queue_number}"
    )
    db.add(activity)
    db.commit()
    
    return {"message": "Client skipped and moved to end of queue"}

@router.get("/activity-log")
async def get_activity_log(
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    """Get recent activity log (admin only)"""
    logs = db.query(ActivityLog).order_by(ActivityLog.created_at.desc()).limit(limit).all()
    
    result = []
    for log in logs:
        user = db.query(User).filter(User.id == log.user_id).first()
        result.append({
            "id": log.id,
            "user": user.full_name if user else "System",
            "action": log.action,
            "description": log.description,
            "created_at": log.created_at
        })
    
    return result
