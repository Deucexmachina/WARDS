from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from auth.simple_auth import verify_session
from database.config import get_db
from services.queue_service import queue_service
from services.service_service import service_service
from services.branch_staff_service import (
    MAX_WINDOWS,
    get_active_window_count,
    get_window_catalog,
    serialize_branch_account,
    sync_branch_staff_accounts,
)
from database.models import BranchStaffAccount
from sqlalchemy.orm import Session

router = APIRouter()

class QueueActionRequest(BaseModel):
    queue_number: str
    notes: str = None


class BranchStaffAssignment(BaseModel):
    window_code: str
    email: str


class BranchStaffSyncRequest(BaseModel):
    window_count: int
    assignments: list[BranchStaffAssignment]

def get_current_user(authorization: Optional[str] = Header(None)):
    """Get current authenticated user"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    token = authorization.replace("Bearer ", "")
    user = verify_session(token)
    
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    return user


def ensure_admin_user(user: dict):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access is required")


def get_user_service_scope(user: dict) -> Optional[int]:
    if user.get("role") == "branch_staff":
        return user.get("service_id")
    return None

@router.get("/dashboard/stats")
async def get_dashboard_stats(authorization: Optional[str] = Header(None)):
    """Get dashboard statistics"""
    user = get_current_user(authorization)
    
    total_waiting = 0
    total_serving = 0
    total_completed_today = 0
    total_no_show_today = 0
    scoped_service_id = get_user_service_scope(user)
    
    today = datetime.now().date()
    
    for service_id, queue_list in queue_service.queues.items():
        if scoped_service_id and service_id != scoped_service_id:
            continue
        for entry in queue_list:
            if entry["status"] == "waiting":
                total_waiting += 1
            elif entry["status"] == "serving":
                total_serving += 1
            elif entry["status"] == "completed":
                # Check if completed today
                completed_at = entry.get("completed_at")
                if completed_at and completed_at.date() == today:
                    total_completed_today += 1
            elif entry["status"] == "no_show":
                # Check if marked no-show today
                completed_at = entry.get("completed_at")
                if completed_at and completed_at.date() == today:
                    total_no_show_today += 1
    
    return {
        "waiting": total_waiting,
        "serving": total_serving,
        "completed_today": total_completed_today,
        "no_show_today": total_no_show_today
    }

@router.get("/queue/all")
async def get_all_queues(authorization: Optional[str] = Header(None)):
    """Get all queue entries grouped by service"""
    user = get_current_user(authorization)
    
    services = service_service.get_all()
    scoped_service_id = get_user_service_scope(user)
    result = []
    
    for service in services:
        if scoped_service_id and service.id != scoped_service_id:
            continue
        queue_list = queue_service.queues.get(service.id, [])
        
        serving = None
        waiting = []
        
        for entry in queue_list:
            if entry["status"] == "serving":
                serving = {
                    "id": entry["queue_number"],
                    "queue_number": entry["queue_number"],
                    "client_name": entry["client_name"],
                    "priority_tag": entry.get("priority_tag"),
                    "called_at": entry.get("created_at")
                }
            elif entry["status"] == "waiting":
                waiting.append({
                    "id": entry["queue_number"],
                    "queue_number": entry["queue_number"],
                    "client_name": entry["client_name"],
                    "priority_tag": entry.get("priority_tag"),
                    "created_at": entry.get("created_at")
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
async def call_next_client(service_id: int, authorization: Optional[str] = Header(None)):
    """Call next client in queue"""
    user = get_current_user(authorization)
    scoped_service_id = get_user_service_scope(user)
    if scoped_service_id and scoped_service_id != service_id:
        raise HTTPException(status_code=403, detail="This account can only manage its assigned queue window")
    
    queue_list = queue_service.queues.get(service_id, [])
    
    # Complete any currently serving
    for entry in queue_list:
        if entry["status"] == "serving":
            entry["status"] = "completed"
            entry["completed_at"] = datetime.now()
    
    # Find next waiting client
    next_client = None
    for entry in queue_list:
        if entry["status"] == "waiting":
            next_client = entry
            break
    
    if not next_client:
        return {"message": "No clients waiting", "queue_number": None}
    
    # Update to serving
    next_client["status"] = "serving"
    next_client["called_at"] = datetime.now()
    queue_service.current_serving[service_id] = next_client["queue_number"]
    
    return {
        "message": "Client called",
        "queue_number": next_client["queue_number"],
        "client_name": next_client["client_name"]
    }

@router.post("/queue/complete")
async def complete_client(request: QueueActionRequest, authorization: Optional[str] = Header(None)):
    """Mark current client as completed"""
    user = get_current_user(authorization)
    scoped_service_id = get_user_service_scope(user)
    
    for service_id, queue_list in queue_service.queues.items():
        if scoped_service_id and service_id != scoped_service_id:
            continue
        for entry in queue_list:
            if entry["queue_number"] == request.queue_number:
                entry["status"] = "completed"
                entry["completed_at"] = datetime.now()
                if request.notes:
                    entry["notes"] = request.notes
                
                # Clear current serving if this was it
                if queue_service.current_serving.get(service_id) == request.queue_number:
                    queue_service.current_serving[service_id] = None
                
                return {"message": "Client marked as completed"}
    
    raise HTTPException(status_code=404, detail="Queue entry not found")

@router.post("/queue/no-show")
async def mark_no_show(request: QueueActionRequest, authorization: Optional[str] = Header(None)):
    """Mark client as no-show"""
    user = get_current_user(authorization)
    scoped_service_id = get_user_service_scope(user)
    
    for service_id, queue_list in queue_service.queues.items():
        if scoped_service_id and service_id != scoped_service_id:
            continue
        for entry in queue_list:
            if entry["queue_number"] == request.queue_number:
                entry["status"] = "no_show"
                entry["completed_at"] = datetime.now()
                if request.notes:
                    entry["notes"] = request.notes
                
                # Clear current serving if this was it
                if queue_service.current_serving.get(service_id) == request.queue_number:
                    queue_service.current_serving[service_id] = None
                
                return {"message": "Client marked as no-show"}
    
    raise HTTPException(status_code=404, detail="Queue entry not found")

@router.post("/queue/skip")
async def skip_client(request: QueueActionRequest, authorization: Optional[str] = Header(None)):
    """Skip client (move to end of queue)"""
    user = get_current_user(authorization)
    scoped_service_id = get_user_service_scope(user)
    
    for service_id, queue_list in queue_service.queues.items():
        if scoped_service_id and service_id != scoped_service_id:
            continue
        for entry in queue_list:
            if entry["queue_number"] == request.queue_number:
                if entry["status"] == "serving":
                    entry["status"] = "waiting"
                    entry["called_at"] = None
                    # Move to end by updating created_at
                    entry["created_at"] = datetime.now()
                    
                    # Clear current serving
                    if queue_service.current_serving.get(service_id) == request.queue_number:
                        queue_service.current_serving[service_id] = None
                
                if request.notes:
                    entry["notes"] = request.notes
                
                return {"message": "Client skipped and moved to end of queue"}
    
    raise HTTPException(status_code=404, detail="Queue entry not found")

@router.post("/queue/reset/{service_id}")
async def reset_queue(service_id: int, authorization: Optional[str] = Header(None)):
    """Reset queue for a specific service counter"""
    user = get_current_user(authorization)
    ensure_admin_user(user)
    
    if service_id not in queue_service.queues:
        raise HTTPException(status_code=404, detail="Service not found")
    
    # Clear all queue entries for this service
    queue_service.queues[service_id] = []
    queue_service.current_serving[service_id] = None
    queue_service.queue_counters[service_id] = 0
    
    return {
        "message": f"Queue reset successfully for service {service_id}",
        "service_id": service_id
    }

@router.get("/activity-log")
async def get_activity_log(authorization: Optional[str] = Header(None)):
    """Get recent activity log (placeholder)"""
    user = get_current_user(authorization)
    ensure_admin_user(user)
    
    # Return empty log for now since we don't track activity in memory
    return []


@router.get("/account-management")
async def get_account_management(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    user = get_current_user(authorization)
    ensure_admin_user(user)

    active_accounts = (
        db.query(BranchStaffAccount)
        .filter(BranchStaffAccount.is_active == True)
        .order_by(BranchStaffAccount.service_id.asc())
        .all()
    )

    return {
        "window_count": get_active_window_count(db),
        "max_windows": MAX_WINDOWS,
        "available_windows": get_window_catalog(),
        "accounts": [serialize_branch_account(account) for account in active_accounts],
    }


@router.post("/account-management/sync")
async def sync_account_management(
    request: BranchStaffSyncRequest,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    user = get_current_user(authorization)
    ensure_admin_user(user)

    try:
        return sync_branch_staff_accounts(
            db=db,
            window_count=request.window_count,
            assignments=[item.model_dump() for item in request.assignments],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
