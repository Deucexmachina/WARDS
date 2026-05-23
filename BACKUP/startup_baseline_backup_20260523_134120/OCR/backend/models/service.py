from pydantic import BaseModel
from typing import Optional

class ServiceBase(BaseModel):
    name: str
    counter: int
    description: str
    estimated_time: str

class ServiceCreate(ServiceBase):
    pass

class Service(ServiceBase):
    id: int
    is_active: bool = True

    class Config:
        from_attributes = True
