from fastapi import APIRouter, HTTPException
from typing import Dict, List
from models.queue import QueueRequest, QueueTicket, QueueStatus
from services.queue_service import queue_service

router = APIRouter()

@router.post("/take-number", response_model=QueueTicket)
def take_queue_number(request: QueueRequest):
    ticket = queue_service.take_number(request)
    if not ticket:
        raise HTTPException(status_code=404, detail="Service not found")
    return ticket

@router.get("/status/{queue_number}", response_model=QueueStatus)
def get_queue_status(queue_number: str):
    status = queue_service.get_status(queue_number)
    if not status:
        raise HTTPException(status_code=404, detail="Queue number not found")
    return status

@router.get("/all")
def get_all_queues():
    return queue_service.get_all_queues()

@router.post("/call-next/{service_id}")
def call_next_client(service_id: int):
    result = queue_service.call_next(service_id)
    if not result:
        raise HTTPException(status_code=404, detail="No waiting clients in queue")
    return result

@router.post("/complete/{service_id}")
def complete_current_client(service_id: int):
    result = queue_service.complete_current(service_id)
    if not result:
        raise HTTPException(status_code=404, detail="No client currently being served")
    return {"message": "Client completed successfully"}

@router.post("/reset/{service_id}")
def reset_service_queue(service_id: int):
    result = queue_service.reset_queue(service_id)
    if not result:
        raise HTTPException(status_code=404, detail="Service not found")
    return {"message": "Queue reset successfully"}

@router.get("/display")
def get_queue_display():
    return queue_service.get_display_data()
