from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class AnnouncementBase(BaseModel):
    title: str
    content: str
    priority: str = "normal"

class AnnouncementCreate(AnnouncementBase):
    pass

class AnnouncementUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    priority: Optional[str] = None

class Announcement(AnnouncementBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
