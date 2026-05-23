from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class QueueRequest(BaseModel):
    service_id: int
    client_name: str
    priority_tag: Optional[str] = None

class QueueTicket(BaseModel):
    queue_number: str
    service_id: int
    service_name: str
    position: int
    status: str
    priority_tag: Optional[str] = None
    created_at: datetime

class QueueStatus(BaseModel):
    queue_number: str
    service_name: str
    position: int
    status: str
    priority_tag: Optional[str] = None
    current_serving: Optional[str]
    estimated_wait: str
