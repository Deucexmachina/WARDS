from datetime import datetime
from typing import List, Optional
from models.announcement import Announcement, AnnouncementCreate, AnnouncementUpdate

class AnnouncementService:
    def __init__(self):
        self.announcements: List[dict] = [
            {
                "id": 1,
                "title": "Welcome to WARDS",
                "content": "Our office is now using a digital queue management system for your convenience.",
                "priority": "high",
                "created_at": datetime.now(),
                "updated_at": datetime.now()
            },
            {
                "id": 2,
                "title": "Office Hours",
                "content": "We are open Monday to Friday, 8:00 AM - 5:00 PM. Closed on weekends and holidays.",
                "priority": "normal",
                "created_at": datetime.now(),
                "updated_at": datetime.now()
            }
        ]
        self.next_id = 3

    def get_all(self) -> List[Announcement]:
        return [Announcement(**ann) for ann in self.announcements]

    def get_by_id(self, announcement_id: int) -> Optional[Announcement]:
        for ann in self.announcements:
            if ann["id"] == announcement_id:
                return Announcement(**ann)
        return None

    def create(self, announcement: AnnouncementCreate) -> Announcement:
        new_announcement = {
            "id": self.next_id,
            "title": announcement.title,
            "content": announcement.content,
            "priority": announcement.priority,
            "created_at": datetime.now(),
            "updated_at": datetime.now()
        }
        self.announcements.append(new_announcement)
        self.next_id += 1
        return Announcement(**new_announcement)

    def update(self, announcement_id: int, announcement: AnnouncementUpdate) -> Optional[Announcement]:
        for ann in self.announcements:
            if ann["id"] == announcement_id:
                if announcement.title is not None:
                    ann["title"] = announcement.title
                if announcement.content is not None:
                    ann["content"] = announcement.content
                if announcement.priority is not None:
                    ann["priority"] = announcement.priority
                ann["updated_at"] = datetime.now()
                return Announcement(**ann)
        return None

    def delete(self, announcement_id: int) -> bool:
        for i, ann in enumerate(self.announcements):
            if ann["id"] == announcement_id:
                self.announcements.pop(i)
                return True
        return False

announcement_service = AnnouncementService()
