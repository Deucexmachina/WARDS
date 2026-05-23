from typing import List, Optional
from models.service import Service, ServiceCreate
from database.config import SessionLocal
from services.branch_staff_service import get_active_window_count

class ServiceService:
    def __init__(self):
        self.services: List[dict] = [
            {
                "id": 1,
                "name": "Real Property Tax",
                "counter": 1,
                "description": "Payment of real property taxes",
                "estimated_time": "10-15 minutes",
                "is_active": True
            },
            {
                "id": 2,
                "name": "Business Tax",
                "counter": 2,
                "description": "Payment of business taxes",
                "estimated_time": "10-15 minutes",
                "is_active": True
            },
            {
                "id": 3,
                "name": "Miscellaneous Tax",
                "counter": 3,
                "description": "Other miscellaneous payments",
                "estimated_time": "10-15 minutes",
                "is_active": True
            },
            {
                "id": 4,
                "name": "Queue Window 4",
                "counter": 4,
                "description": "Additional branch queue services",
                "estimated_time": "10-15 minutes",
                "is_active": True
            },
            {
                "id": 5,
                "name": "Queue Window 5",
                "counter": 5,
                "description": "Additional branch queue services",
                "estimated_time": "10-15 minutes",
                "is_active": True
            }
        ]
        self.next_id = 6

    def _get_window_count(self) -> int:
        db = SessionLocal()
        try:
            return get_active_window_count(db)
        except Exception:
            return 3
        finally:
            db.close()

    def _get_active_services(self) -> List[dict]:
        active_window_count = self._get_window_count()
        return [
            svc
            for svc in self.services
            if svc["is_active"] and svc["counter"] <= active_window_count
        ]

    def get_all(self) -> List[Service]:
        return [Service(**svc) for svc in self._get_active_services()]
    
    def get_all_with_wait_time(self, queue_service) -> List[dict]:
        """Get all services with dynamic estimated wait time based on queue length"""
        services_with_wait = []
        for svc in self._get_active_services():
            
            # Calculate dynamic wait time based on queue length
            waiting_count = 0
            if svc["id"] in queue_service.queues:
                queue_list = queue_service.queues[svc["id"]]
                waiting_count = sum(1 for e in queue_list if e["status"] == "waiting")
            
            # Estimate: 10 minutes per person in queue
            minutes_per_person = 10
            estimated_minutes = waiting_count * minutes_per_person
            
            if estimated_minutes == 0:
                estimated_time = "No wait - Available now"
            elif estimated_minutes <= 10:
                estimated_time = f"{estimated_minutes} minutes"
            elif estimated_minutes <= 60:
                estimated_time = f"{estimated_minutes} minutes"
            else:
                hours = estimated_minutes // 60
                mins = estimated_minutes % 60
                if mins == 0:
                    estimated_time = f"{hours} hour{'s' if hours > 1 else ''}"
                else:
                    estimated_time = f"{hours} hour{'s' if hours > 1 else ''} {mins} minutes"
            
            service_data = svc.copy()
            service_data["estimated_time"] = estimated_time
            service_data["waiting_count"] = waiting_count
            services_with_wait.append(service_data)
        
        return services_with_wait

    def get_by_id(self, service_id: int) -> Optional[Service]:
        for svc in self._get_active_services():
            if svc["id"] == service_id:
                return Service(**svc)
        return None

    def create(self, service: ServiceCreate) -> Service:
        new_service = {
            "id": self.next_id,
            "name": service.name,
            "counter": service.counter,
            "description": service.description,
            "estimated_time": service.estimated_time,
            "is_active": True
        }
        self.services.append(new_service)
        self.next_id += 1
        return Service(**new_service)

service_service = ServiceService()
