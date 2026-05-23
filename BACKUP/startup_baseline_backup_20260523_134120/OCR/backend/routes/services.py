from fastapi import APIRouter, HTTPException
from typing import List
from models.service import Service, ServiceCreate
from services.service_service import service_service
from services.queue_service import queue_service

router = APIRouter()

@router.get("/")
def get_services():
    """Get all services with dynamic estimated wait time"""
    return service_service.get_all_with_wait_time(queue_service)

@router.get("/{service_id}")
def get_service(service_id: int):
    """Get a single service with dynamic estimated wait time"""
    service = service_service.get_by_id(service_id)
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    
    # Get dynamic wait time
    services_with_wait = service_service.get_all_with_wait_time(queue_service)
    for svc in services_with_wait:
        if svc["id"] == service_id:
            return svc
    
    return service

@router.post("/", response_model=Service)
def create_service(service: ServiceCreate):
    return service_service.create(service)
