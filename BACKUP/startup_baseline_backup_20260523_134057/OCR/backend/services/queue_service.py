from datetime import datetime
from typing import List, Optional, Dict
from models.queue import QueueRequest, QueueTicket, QueueStatus
from services.service_service import service_service

class QueueService:
    def __init__(self):
        self.queues: Dict[int, List[dict]] = {}
        self.current_serving: Dict[int, Optional[str]] = {}
        self.queue_counters: Dict[int, int] = {}
        self._initialize_sample_data()

    def take_number(self, request: QueueRequest) -> Optional[QueueTicket]:
        service = service_service.get_by_id(request.service_id)
        if not service:
            return None

        if request.service_id not in self.queues:
            self.queues[request.service_id] = []
            self.current_serving[request.service_id] = None
            self.queue_counters[request.service_id] = 0

        self.queue_counters[request.service_id] += 1
        
        prefix_map = {
            1: "RPT",
            2: "BUS", 
            3: "MIS",
            4: "QW4",
            5: "QW5",
        }
        prefix = prefix_map.get(request.service_id, service.name[:3].upper())
        queue_number = f"{prefix}-{self.queue_counters[request.service_id]:03d}"

        queue_entry = {
            "queue_number": queue_number,
            "service_id": request.service_id,
            "service_name": service.name,
            "counter": service.counter,
            "client_name": request.client_name,
            "priority_tag": request.priority_tag,
            "status": "waiting",
            "created_at": datetime.now()
        }

        # If priority tag is set (PWD, Senior, Pregnant), insert at front of waiting queue
        if request.priority_tag in ["PWD", "Senior", "Pregnant"]:
            # Find the first waiting position (after any currently serving)
            insert_position = 0
            for idx, entry in enumerate(self.queues[request.service_id]):
                if entry["status"] == "serving":
                    insert_position = idx + 1
                else:
                    break
            
            self.queues[request.service_id].insert(insert_position, queue_entry)
            position = insert_position + 1
        else:
            # Regular queue - append to end
            self.queues[request.service_id].append(queue_entry)
            position = len(self.queues[request.service_id])

        return QueueTicket(
            queue_number=queue_number,
            service_id=request.service_id,
            service_name=service.name,
            position=position,
            status="waiting",
            priority_tag=request.priority_tag,
            created_at=queue_entry["created_at"]
        )

    def get_status(self, queue_number: str) -> Optional[QueueStatus]:
        for service_id, queue_list in self.queues.items():
            for idx, entry in enumerate(queue_list):
                if entry["queue_number"] == queue_number:
                    service = service_service.get_by_id(service_id)
                    position = idx + 1
                    
                    waiting_count = sum(1 for e in queue_list if e["status"] == "waiting")
                    estimated_wait = f"{waiting_count * 10} minutes" if waiting_count > 0 else "Ready soon"

                    return QueueStatus(
                        queue_number=queue_number,
                        service_name=service.name if service else "Unknown",
                        position=position,
                        status=entry["status"],
                        priority_tag=entry.get("priority_tag"),
                        current_serving=self.current_serving.get(service_id),
                        estimated_wait=estimated_wait
                    )
        return None

    def get_all_queues(self) -> Dict[int, List[dict]]:
        result = {}
        for service_id, queue_list in self.queues.items():
            service = service_service.get_by_id(service_id)
            result[service_id] = {
                "service_name": service.name if service else "Unknown",
                "current_serving": self.current_serving.get(service_id),
                "waiting": [e for e in queue_list if e["status"] == "waiting"],
                "total_count": len(queue_list)
            }
        return result

    def call_next(self, service_id: int) -> Optional[dict]:
        if service_id not in self.queues or not self.queues[service_id]:
            return None

        for entry in self.queues[service_id]:
            if entry["status"] == "waiting":
                entry["status"] = "serving"
                self.current_serving[service_id] = entry["queue_number"]
                return entry

        return None

    def complete_current(self, service_id: int) -> bool:
        if service_id not in self.queues:
            return False

        for entry in self.queues[service_id]:
            if entry["status"] == "serving":
                entry["status"] = "completed"
                self.current_serving[service_id] = None
                return True

        return False

    def reset_queue(self, service_id: int) -> bool:
        if service_id in self.queues:
            self.queues[service_id] = []
            self.current_serving[service_id] = None
            self.queue_counters[service_id] = 0
            return True
        return False

    def _initialize_sample_data(self):
        now = datetime.now()
        
        self.queues[1] = [
            {"queue_number": "RPT-001", "service_id": 1, "service_name": "Real Property Tax", 
             "counter": 1, "client_name": "Juan Dela Cruz", "priority_tag": None, "status": "serving", "created_at": now},
            {"queue_number": "RPT-002", "service_id": 1, "service_name": "Real Property Tax", 
             "counter": 1, "client_name": "Maria Santos", "priority_tag": "Senior", "status": "waiting", "created_at": now},
            {"queue_number": "RPT-003", "service_id": 1, "service_name": "Real Property Tax", 
             "counter": 1, "client_name": "Pedro Garcia", "priority_tag": None, "status": "waiting", "created_at": now},
            # Completed entries for stats
            {"queue_number": "RPT-004", "service_id": 1, "service_name": "Real Property Tax", 
             "counter": 1, "client_name": "Anna Cruz", "priority_tag": None, "status": "completed", "created_at": now, "completed_at": now},
            {"queue_number": "RPT-005", "service_id": 1, "service_name": "Real Property Tax", 
             "counter": 1, "client_name": "Luis Reyes", "priority_tag": None, "status": "completed", "created_at": now, "completed_at": now},
        ]
        self.current_serving[1] = "RPT-001"
        self.queue_counters[1] = 5
        
        self.queues[2] = [
            {"queue_number": "BUS-001", "service_id": 2, "service_name": "Business Tax", 
             "counter": 2, "client_name": "Ana Reyes", "priority_tag": "PWD", "status": "serving", "created_at": now},
            {"queue_number": "BUS-002", "service_id": 2, "service_name": "Business Tax", 
             "counter": 2, "client_name": "Jose Cruz", "priority_tag": None, "status": "waiting", "created_at": now},
            # Completed entry
            {"queue_number": "BUS-003", "service_id": 2, "service_name": "Business Tax", 
             "counter": 2, "client_name": "Rita Santos", "priority_tag": None, "status": "completed", "created_at": now, "completed_at": now},
            # No-show entry
            {"queue_number": "BUS-004", "service_id": 2, "service_name": "Business Tax", 
             "counter": 2, "client_name": "Mark Diaz", "priority_tag": None, "status": "no_show", "created_at": now, "completed_at": now},
        ]
        self.current_serving[2] = "BUS-001"
        self.queue_counters[2] = 4
        
        self.queues[3] = [
            {"queue_number": "MIS-001", "service_id": 3, "service_name": "Miscellaneous Tax", 
             "counter": 3, "client_name": "Rosa Martinez", "priority_tag": "Pregnant", "status": "serving", "created_at": now},
            {"queue_number": "MIS-002", "service_id": 3, "service_name": "Miscellaneous Tax", 
             "counter": 3, "client_name": "Carlos Lopez", "priority_tag": None, "status": "waiting", "created_at": now},
            {"queue_number": "MIS-003", "service_id": 3, "service_name": "Miscellaneous Tax", 
             "counter": 3, "client_name": "Linda Ramos", "priority_tag": "Senior", "status": "waiting", "created_at": now},
            # Completed entry
            {"queue_number": "MIS-004", "service_id": 3, "service_name": "Miscellaneous Tax", 
             "counter": 3, "client_name": "Sofia Mendoza", "priority_tag": None, "status": "completed", "created_at": now, "completed_at": now},
        ]
        self.current_serving[3] = "MIS-001"
        self.queue_counters[3] = 4

    def get_display_data(self) -> List[dict]:
        display_data = []
        
        for service_id in sorted(self.queues.keys()):
            queue_list = self.queues[service_id]
            service = service_service.get_by_id(service_id)
            if not service:
                continue
            
            current_serving = self.current_serving.get(service_id)
            current_serving_priority = None
            next_number = None
            next_number_priority = None
            waiting_count = 0
            
            # Find current serving priority tag
            for entry in queue_list:
                if entry["status"] == "serving" and entry["queue_number"] == current_serving:
                    current_serving_priority = entry.get("priority_tag")
                    break
            
            # Find next number and its priority tag
            for entry in queue_list:
                if entry["status"] == "waiting":
                    if next_number is None:
                        next_number = entry["queue_number"]
                        next_number_priority = entry.get("priority_tag")
                    waiting_count += 1
            
            display_data.append({
                "counter": service.counter,
                "counter_name": f"Counter {service.counter}",
                "service": service.name,
                "current_serving": current_serving,
                "current_serving_priority": current_serving_priority,
                "next_number": next_number,
                "next_number_priority": next_number_priority,
                "waiting_count": waiting_count
            })
        
        return display_data

queue_service = QueueService()
