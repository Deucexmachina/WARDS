from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta, timezone
from typing import Optional

from database.models import (
    get_db, Branch, Queue, QueueActivity, Payment, Admin,
    Alert, AlertView, ActivityLog, Announcement, QueueHistory
)
from auth import get_current_admin_user
from utils.rbac import require_permission
from utils.field_crypto import get_decrypted_or_raw, hash_aware_match, queue_value, hash_optional_value
from utils.security_client import sync_security_alerts

CONFIRMED_PAYMENT_STATUSES = {
    "Verified", "PAYMENT_VERIFIED", "OR_GENERATED", "COMPLETED"
}
PENDING_PAYMENT_STATUSES = {
    "Pending", "Pending Transaction", "PAYMENT_SUBMITTED",
    "PENDING_TREASURY_VALIDATION", "CLARIFICATION_REQUESTED",
    "PROPERTY_SEARCHED", "PROPERTY_FOUND", "ADDED_TO_CART",
    "PAYMENT_INITIATED", "VALIDATED", "DOCUMENTS_UPLOADED",
}
FAILED_PAYMENT_STATUSES = {
    "Failed", "PAYMENT_REJECTED", "RETURNED_FOR_CORRECTION",
}

router = APIRouter()

@router.get("/statistics")
async def get_dashboard_statistics(
    branch_id: Optional[int] = Query(None),
    service_type: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    current_user: Admin = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """Get real-time operational statistics from all or specific branches"""
    
    # Build base query
    queue_query = db.query(Queue)
    payment_query = db.query(Payment)
    
    # Get the branch name for filtering payments (Payment.branch stores branch name as string)
    branch_name_filter = None
    if branch_id:
        branch_obj = db.query(Branch).filter(Branch.id == branch_id).first()
        if branch_obj:
            branch_name_filter = get_decrypted_or_raw(branch_obj, "name") or branch_obj.name
        queue_query = queue_query.filter(Queue.branch_id == branch_id)
    elif current_user.role in ["branch_admin", "branch_staff"] and current_user.branch_id:
        # Branch users can only see their own branch
        branch_obj = db.query(Branch).filter(Branch.id == current_user.branch_id).first()
        if branch_obj:
            branch_name_filter = get_decrypted_or_raw(branch_obj, "name") or branch_obj.name
        queue_query = queue_query.filter(Queue.branch_id == current_user.branch_id)
    
    # Apply branch filter to payments if we have a branch name
    if branch_name_filter:
        payment_query = payment_query.filter((Payment.branch == branch_name_filter) | (Payment.branch_hash == hash_optional_value(branch_name_filter)))
    
    # Filter by service type
    if service_type:
        queue_query = queue_query.filter(hash_aware_match(Queue, "service_type", service_type))
    
    # Filter by date range
    if date_from and date_to:
        start_date = datetime.fromisoformat(date_from)
        end_date = datetime.fromisoformat(date_to)
        queue_query = queue_query.filter(Queue.created_at.between(start_date, end_date))
        payment_query = payment_query.filter(Payment.created_at.between(start_date, end_date))
    
    # Get queues
    queues = queue_query.order_by(Queue.created_at.desc()).all()

    # Aggregate statistics from Queue table
    total_waiting = len([q for q in queues if queue_value(q, "status") == "Waiting"])
    total_being_served = len([q for q in queues if queue_value(q, "status") == "Serving"])

    # Build mirrored history query for completed queues (archived to QueueHistory)
    history_query = db.query(QueueHistory).filter(QueueHistory.final_status == "Completed")
    if branch_id:
        history_query = history_query.filter(QueueHistory.branch_id == branch_id)
    elif current_user.role in ["branch_admin", "branch_staff"] and current_user.branch_id:
        history_query = history_query.filter(QueueHistory.branch_id == current_user.branch_id)
    if service_type:
        history_query = history_query.filter(QueueHistory.service_type == service_type)
    if date_from and date_to:
        start_date = datetime.fromisoformat(date_from)
        end_date = datetime.fromisoformat(date_to)
        history_query = history_query.filter(QueueHistory.created_at.between(start_date, end_date))
    total_completed = history_query.count()

    # Get payment statistics
    total_payments = payment_query.count()
    total_amount = payment_query.filter(
        Payment.status.in_(CONFIRMED_PAYMENT_STATUSES)
    ).with_entities(func.sum(Payment.amount)).scalar() or 0

    # Get branch-specific data
    branches = db.query(Branch).all()
    if current_user.role in ["branch_admin", "branch_staff"] and current_user.branch_id:
        branches = [b for b in branches if b.id == current_user.branch_id]

    branch_stats = []
    for branch in branches:
        branch_queues = [q for q in queues if q.branch_id == branch.id]

        waiting_count = len([q for q in branch_queues if queue_value(q, "status") == "Waiting"])
        serving_count = len([q for q in branch_queues if queue_value(q, "status") == "Serving"])
        completed_count = db.query(QueueHistory).filter(
            QueueHistory.branch_id == branch.id,
            QueueHistory.final_status == "Completed"
        ).count()

        branch_stats.append({
            "branch_id": branch.id,
            "branch_name": get_decrypted_or_raw(branch, "name") or branch.name,
            "location": get_decrypted_or_raw(branch, "location") or branch.location,
            "status": branch.status,
            "counters": branch.counters,
            "clients_waiting": waiting_count,
            "clients_being_served": serving_count,
            "clients_completed": completed_count,
            "last_updated": branch_queues[0].created_at.isoformat() if branch_queues else None
        })

    # Get served totals for dashboard period cards (using UTC+8 for Philippine time)
    ph_tz = timezone(timedelta(hours=8))
    now_ph = datetime.now(ph_tz)
    today_start = now_ph.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).replace(tzinfo=None)
    week_start_ph = now_ph - timedelta(days=now_ph.weekday())
    week_start = week_start_ph.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).replace(tzinfo=None)
    month_start = now_ph.replace(day=1, hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).replace(tzinfo=None)
    daily_served = db.query(QueueHistory).filter(
        QueueHistory.final_status == "Completed",
        QueueHistory.completed_at >= today_start
    )
    weekly_served = db.query(QueueHistory).filter(
        QueueHistory.final_status == "Completed",
        QueueHistory.completed_at >= week_start
    )
    monthly_served = db.query(QueueHistory).filter(
        QueueHistory.final_status == "Completed",
        QueueHistory.completed_at >= month_start
    )
    if branch_id:
        daily_served = daily_served.filter(QueueHistory.branch_id == branch_id)
        weekly_served = weekly_served.filter(QueueHistory.branch_id == branch_id)
        monthly_served = monthly_served.filter(QueueHistory.branch_id == branch_id)
    elif current_user.role in ["branch_admin", "branch_staff"] and current_user.branch_id:
        daily_served = daily_served.filter(QueueHistory.branch_id == current_user.branch_id)
        weekly_served = weekly_served.filter(QueueHistory.branch_id == current_user.branch_id)
        monthly_served = monthly_served.filter(QueueHistory.branch_id == current_user.branch_id)
    daily_served = daily_served.count()
    weekly_served = weekly_served.count()
    monthly_served = monthly_served.count()

    # Get payment statistics for today
    today_payments = payment_query.filter(Payment.created_at >= today_start)

    pending_payments = today_payments.filter(Payment.status.in_(PENDING_PAYMENT_STATUSES)).count()
    confirmed_payments = today_payments.filter(Payment.status.in_(CONFIRMED_PAYMENT_STATUSES)).count()
    failed_payments = today_payments.filter(Payment.status.in_(FAILED_PAYMENT_STATUSES)).count()

    today_total = today_payments.filter(
        Payment.status.in_(CONFIRMED_PAYMENT_STATUSES)
    ).with_entities(func.sum(Payment.amount)).scalar() or 0
    
    # Get recent payments
    recent_payments = payment_query.order_by(Payment.created_at.desc()).limit(10).all()
    
    # Get earliest record date across key tables
    try:
        earliest_queue = db.query(func.min(QueueHistory.created_at)).scalar()
    except Exception:
        earliest_queue = None
    try:
        earliest_payment = db.query(func.min(Payment.created_at)).scalar()
    except Exception:
        earliest_payment = None
    try:
        earliest_activity = db.query(func.min(ActivityLog.created_at)).scalar()
    except Exception:
        earliest_activity = None
    earliest_dates = [d for d in [earliest_queue, earliest_payment, earliest_activity] if d]
    earliest_record_date = min(earliest_dates).date().isoformat() if earliest_dates else None

    # Get recent stored alerts with per-admin read state.
    alerts = db.query(Alert).order_by(Alert.created_at.desc()).all()
    viewed_alert_ids = {
        row.alert_id
        for row in db.query(AlertView).filter(
            AlertView.viewer_username == current_user.username,
            AlertView.viewer_type == "admin",
        ).all()
    }
    # Sync security system alerts from VM2 into the main DB so the main dashboard stays current
    try:
        sync_security_alerts(db, limit=50)
    except Exception:
        pass
    alerts = db.query(Alert).order_by(Alert.created_at.desc()).all()
    
    return {
        "summary": {
            "total_clients_waiting": total_waiting,
            "total_clients_being_served": total_being_served,
            "total_clients_completed": total_completed,
            "total_payments": total_payments,
            "total_amount": float(total_amount),
            "active_branches": len([b for b in branches if b.status == "Active"])
        },
        "branches": branch_stats,
        "payments": {
            "total_amount": float(today_total),
            "pending_count": pending_payments,
            "confirmed_count": confirmed_payments,
            "failed_count": failed_payments,
            "recent_payments": [
                {
                    "id": p.id,
                    "transaction_id": get_decrypted_or_raw(p, "txn_id") or p.txn_id,
                    "taxpayer_name": get_decrypted_or_raw(p, "taxpayer_name") or p.taxpayer_name,
                    "branch_name": (
                        (get_decrypted_or_raw(p.branch_record, "name") or p.branch_record.name)
                        if getattr(p, "branch_record", None) and getattr(p.branch_record, "name", None)
                        else (get_decrypted_or_raw(p, "branch") or p.branch)
                        or "Unassigned"
                    ),
                    "amount": float(p.amount),
                    "status": p.status.lower(),
                    "created_at": p.created_at.isoformat()
                }
                for p in recent_payments
            ]
        },
        "recent_alerts": [
            {
                "id": alert.id,
                "type": alert.type,
                "title": alert.title,
                "message": alert.message,
                "severity": alert.severity,
                "read": alert.id in viewed_alert_ids,
                "created_at": alert.created_at.isoformat()
            }
            for alert in alerts
        ],
        "served_totals": {
            "daily": daily_served,
            "weekly": weekly_served,
            "monthly": monthly_served
        },
        "monitoring": {
            "abnormal_queue_branches": [
                branch for branch in branch_stats
                if branch["clients_waiting"] > max((branch["counters"] or 1) * 10, 20)
            ],
            "service_disruptions": [
                branch for branch in branch_stats
                if branch["status"] in ["Inactive", "Unavailable"]
            ]
        },
        "earliest_record_date": earliest_record_date,
        "timestamp": datetime.utcnow().isoformat()
    }

@router.get("/stats")
async def get_dashboard_stats(
    branch_id: Optional[int] = Query(None),
    service_type: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    current_user: Admin = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """Alias for the admin dashboard statistics endpoint."""
    return await get_dashboard_statistics(
        branch_id=branch_id,
        service_type=service_type,
        date_from=date_from,
        date_to=date_to,
        current_user=current_user,
        db=db,
    )

@router.get("/queue-activity")
async def get_queue_activity(
    branch_id: Optional[int] = Query(None),
    hours: int = Query(24),
    current_user: Admin = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """Get queue activity history for charts"""
    
    time_threshold = datetime.utcnow() - timedelta(hours=hours)
    query = db.query(QueueActivity).filter(QueueActivity.timestamp >= time_threshold)
    
    if branch_id:
        query = query.filter(QueueActivity.branch_id == branch_id)
    elif current_user.role in ["branch_admin", "branch_staff"] and current_user.branch_id:
        query = query.filter(QueueActivity.branch_id == current_user.branch_id)
    
    activities = query.order_by(QueueActivity.timestamp.asc()).all()
    
    return {
        "data": [
            {
                "timestamp": activity.timestamp.isoformat(),
                "branch_id": activity.branch_id,
                "waiting": activity.clients_waiting,
                "serving": activity.clients_being_served,
                "completed": activity.clients_completed
            }
            for activity in activities
        ]
    }

@router.get("/performance-metrics")
async def get_performance_metrics(
    period: str = Query("daily"),  # daily, weekly, monthly
    current_user: Admin = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """Get branch performance metrics"""
    
    # Calculate date range based on period
    now = datetime.utcnow()
    if period == "daily":
        start_date = now - timedelta(days=1)
    elif period == "weekly":
        start_date = now - timedelta(weeks=1)
    else:  # monthly
        start_date = now - timedelta(days=30)
    
    branches = db.query(Branch).all()
    if current_user.role in ["branch_admin", "branch_staff"] and current_user.branch_id:
        branches = [b for b in branches if b.id == current_user.branch_id]
    
    metrics = []
    for branch in branches:
        queue_data = db.query(QueueActivity).filter(
            QueueActivity.branch_id == branch.id,
            QueueActivity.timestamp >= start_date
        ).all()
        
        total_served = sum(q.clients_completed for q in queue_data)
        avg_waiting = sum(q.clients_waiting for q in queue_data) / len(queue_data) if queue_data else 0
        
        metrics.append({
            "branch_id": branch.id,
            "branch_name": get_decrypted_or_raw(branch, "name") or branch.name,
            "total_clients_served": total_served,
            "average_waiting": round(avg_waiting, 2),
            "service_efficiency": round((total_served / branch.counters) if branch.counters > 0 else 0, 2)
        })
    
    return {
        "period": period,
        "metrics": metrics
    }
