from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import os
import shutil
from pathlib import Path

from database.models import Memo, MemoView, get_db, ActivityLog, User, Branch
from middleware.admin_auth import get_current_admin_user, require_main_admin
from utils.field_crypto import apply_memo_security, apply_memo_view_security, get_decrypted_or_raw, get_memo_viewed_ids, find_memo_view
from utils.rbac import require_permission

router = APIRouter()

class MemoCreate(BaseModel):
    title: str
    content: str
    recipients: str  # Comma-separated branch IDs or "all"
    recipient_type: str = "all"  # all, specific_branches
    priority: str = "normal"

class MemoUpdate(BaseModel):
    title: str
    content: str
    recipients: str
    recipient_type: str = "all"
    priority: str = "normal"


def serialize_memo(memo: Memo, branch_lookup: dict[int, str], current_username: str = None, db: Session = None) -> dict:
    recipients_value = get_decrypted_or_raw(memo, "recipients") or memo.recipients or ""
    recipient_type_value = get_decrypted_or_raw(memo, "recipient_type") or memo.recipient_type
    recipient_ids = [
        int(item.strip()) for item in recipients_value.split(",")
        if item.strip().isdigit()
    ]

    if recipient_type_value == "all":
        recipient_label = "All Branches"
    elif recipient_type_value == "specific_branches":
        labels = [branch_lookup.get(branch_id, f"Branch {branch_id}") for branch_id in recipient_ids]
        recipient_label = ", ".join(labels) if labels else "Selected Branches"
    else:
        recipient_label = recipients_value or "Custom Recipients"

    is_viewed = False
    if current_username and db:
        view_record = find_memo_view(db, MemoView, memo.id, current_username, "admin")
        is_viewed = view_record is not None

    return {
        "id": memo.id,
        "title": get_decrypted_or_raw(memo, "title") or memo.title,
        "content": get_decrypted_or_raw(memo, "content") or memo.content,
        "recipients": recipients_value,
        "recipient_type": recipient_type_value,
        "recipient_branch_ids": recipient_ids,
        "recipient_label": recipient_label,
        "author": get_decrypted_or_raw(memo, "author") or memo.author,
        "author_type": get_decrypted_or_raw(memo, "author_type") or getattr(memo, "author_type", "admin"),
        "is_mine": current_username == (get_decrypted_or_raw(memo, "author") or memo.author),
        "priority": get_decrypted_or_raw(memo, "priority") or memo.priority,
        "attachment_path": get_decrypted_or_raw(memo, "attachment_path") or memo.attachment_path,
        "attachment_filename": get_decrypted_or_raw(memo, "attachment_filename") or memo.attachment_filename,
        "is_viewed": is_viewed,
        "created_at": memo.created_at.isoformat() if memo.created_at else None,
        "updated_at": memo.updated_at.isoformat() if memo.updated_at else None,
    }


def validate_recipients(memo_data: MemoCreate | MemoUpdate):
    if not memo_data.title.strip():
        raise HTTPException(status_code=400, detail="Memo title is required")
    if not memo_data.content.strip():
        raise HTTPException(status_code=400, detail="Memo content is required")

    if memo_data.recipient_type == "specific_branches":
        branch_ids = [item.strip() for item in memo_data.recipients.split(",") if item.strip()]
        if not branch_ids:
            raise HTTPException(status_code=400, detail="Select at least one branch recipient")
        if not all(branch_id.isdigit() for branch_id in branch_ids):
            raise HTTPException(status_code=400, detail="Invalid branch recipients")

    if memo_data.recipient_type == "all":
        memo_data.recipients = "all"

@router.get("/")
async def get_all_memos(
    current_user: User = Depends(require_main_admin()),
    db: Session = Depends(get_db)
):
    """Get full memo archive for the main admin office"""
    memos = db.query(Memo).order_by(Memo.created_at.desc()).all()
    branch_lookup = {branch.id: branch.name for branch in db.query(Branch).all()}
    return [serialize_memo(memo, branch_lookup, current_user.username, db) for memo in memos]

@router.post("/")
async def create_memo(
    title: str = Form(...),
    content: str = Form(...),
    recipients: str = Form(...),
    recipient_type: str = Form("all"),
    priority: str = Form("normal"),
    attachment: Optional[UploadFile] = File(None),
    current_user: User = Depends(require_main_admin()),
    db: Session = Depends(get_db)
):
    """Create internal memo (main admin only)"""
    require_permission("manage_memos")(current_user)
    
    memo_data = MemoCreate(
        title=title,
        content=content,
        recipients=recipients,
        recipient_type=recipient_type,
        priority=priority
    )
    validate_recipients(memo_data)
    
    attachment_path = None
    attachment_filename = None
    
    if attachment and attachment.filename:
        upload_dir = Path("uploads/memos")
        upload_dir.mkdir(parents=True, exist_ok=True)
        
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        safe_filename = f"{timestamp}_{attachment.filename}"
        file_path = upload_dir / safe_filename
        
        with file_path.open("wb") as buffer:
            shutil.copyfileobj(attachment.file, buffer)
        
        attachment_path = str(file_path)
        attachment_filename = attachment.filename
    
    new_memo = Memo(
        title=memo_data.title.strip(),
        content=memo_data.content.strip(),
        recipients=memo_data.recipients,
        recipient_type=memo_data.recipient_type,
        priority=memo_data.priority,
        author=current_user.username,
        author_type="admin",
        attachment_path=attachment_path,
        attachment_filename=attachment_filename
    )
    db.add(new_memo)
    db.flush()
    apply_memo_security(new_memo)
    
    log = ActivityLog(
        action="Memo Created",
        user=current_user.username,
        details=f"Created memo: {memo_data.title} for {memo_data.recipient_type}",
        type="admin"
    )
    db.add(log)
    db.commit()
    db.refresh(new_memo)

    branch_lookup = {branch.id: branch.name for branch in db.query(Branch).all()}
    return serialize_memo(new_memo, branch_lookup, current_user.username, db)

@router.put("/{memo_id}")
async def update_memo(
    memo_id: int,
    title: str = Form(...),
    content: str = Form(...),
    recipients: str = Form(...),
    recipient_type: str = Form("all"),
    priority: str = Form("normal"),
    attachment: Optional[UploadFile] = File(None),
    current_user: User = Depends(require_main_admin()),
    db: Session = Depends(get_db)
):
    """Update memo (main admin only)"""
    require_permission("manage_memos")(current_user)
    
    memo_data = MemoUpdate(
        title=title,
        content=content,
        recipients=recipients,
        recipient_type=recipient_type,
        priority=priority
    )
    validate_recipients(memo_data)
    
    db_memo = db.query(Memo).filter(Memo.id == memo_id).first()
    if not db_memo:
        raise HTTPException(status_code=404, detail="Memo not found")
    if (get_decrypted_or_raw(db_memo, "author") or db_memo.author) != current_user.username:
        raise HTTPException(status_code=403, detail="You can only edit memos you created")
    
    if attachment and attachment.filename:
        existing_attachment_path = get_decrypted_or_raw(db_memo, "attachment_path") or db_memo.attachment_path
        if existing_attachment_path and os.path.exists(existing_attachment_path):
            try:
                os.remove(existing_attachment_path)
            except Exception as e:
                print(f"Failed to delete old attachment: {e}")
        
        upload_dir = Path("uploads/memos")
        upload_dir.mkdir(parents=True, exist_ok=True)
        
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        safe_filename = f"{timestamp}_{attachment.filename}"
        file_path = upload_dir / safe_filename
        
        with file_path.open("wb") as buffer:
            shutil.copyfileobj(attachment.file, buffer)
        
        db_memo.attachment_path = str(file_path)
        db_memo.attachment_filename = attachment.filename
    
    db_memo.title = memo_data.title.strip()
    db_memo.content = memo_data.content.strip()
    db_memo.recipients = memo_data.recipients
    db_memo.recipient_type = memo_data.recipient_type
    db_memo.priority = memo_data.priority
    db_memo.updated_at = datetime.utcnow()
    apply_memo_security(db_memo)
    
    log = ActivityLog(
        action="Memo Updated",
        user=current_user.username,
        details=f"Updated memo: {memo_data.title}",
        type="admin"
    )
    db.add(log)
    db.commit()

    db.refresh(db_memo)
    branch_lookup = {branch.id: branch.name for branch in db.query(Branch).all()}
    return serialize_memo(db_memo, branch_lookup, current_user.username, db)

@router.delete("/{memo_id}")
async def delete_memo(
    memo_id: int,
    current_user: User = Depends(require_main_admin()),
    db: Session = Depends(get_db)
):
    """Delete memo (main admin only)"""
    require_permission("manage_memos")(current_user)
    
    memo = db.query(Memo).filter(Memo.id == memo_id).first()
    if not memo:
        raise HTTPException(status_code=404, detail="Memo not found")
    if (get_decrypted_or_raw(memo, "author") or memo.author) != current_user.username:
        raise HTTPException(status_code=403, detail="You can only delete memos you created")

    attachment_path = get_decrypted_or_raw(memo, "attachment_path") or memo.attachment_path
    if attachment_path and os.path.exists(attachment_path):
        try:
            os.remove(attachment_path)
        except Exception as e:
            print(f"Failed to delete attachment: {e}")

    # Remove dependent view records first so memo deletion works
    # even when the database foreign key is not set to cascade.
    db.query(MemoView).filter(MemoView.memo_id == memo_id).delete()
    
    log = ActivityLog(
        action="Memo Deleted",
        user=current_user.username,
        details=f"Deleted memo: {get_decrypted_or_raw(memo, 'title') or memo.title}",
        type="admin"
    )
    db.add(log)
    db.delete(memo)
    db.commit()
    
    return {"message": "Memo deleted successfully"}

@router.get("/branches")
async def get_available_branches(
    current_user: User = Depends(require_main_admin()),
    db: Session = Depends(get_db)
):
    """Get list of branches for recipient selection"""
    branches = db.query(Branch).filter(Branch.status == "Active").all()
    return [
        {"id": b.id, "name": get_decrypted_or_raw(b, "name") or b.name, "location": get_decrypted_or_raw(b, "location") or b.location}
        for b in branches
    ]

@router.post("/{memo_id}/mark-viewed")
async def mark_memo_viewed(
    memo_id: int,
    current_user: User = Depends(require_main_admin()),
    db: Session = Depends(get_db)
):
    """Mark a memo as viewed by the current admin"""
    memo = db.query(Memo).filter(Memo.id == memo_id).first()
    if not memo:
        raise HTTPException(status_code=404, detail="Memo not found")
    
    existing_view = find_memo_view(db, MemoView, memo_id, current_user.username, "admin")
    
    if not existing_view:
        new_view = MemoView(
            memo_id=memo_id,
            viewer_username=current_user.username,
            viewer_type="admin"
        )
        db.add(new_view)
        db.flush()
        apply_memo_view_security(new_view)
        db.commit()
    
    return {"message": "Memo marked as viewed"}

@router.get("/{memo_id}/download-attachment")
async def download_attachment(
    memo_id: int,
    current_user: User = Depends(require_main_admin()),
    db: Session = Depends(get_db)
):
    """Download memo attachment"""
    memo = db.query(Memo).filter(Memo.id == memo_id).first()
    if not memo:
        raise HTTPException(status_code=404, detail="Memo not found")
    
    attachment_path = get_decrypted_or_raw(memo, "attachment_path") or memo.attachment_path
    attachment_filename = get_decrypted_or_raw(memo, "attachment_filename") or memo.attachment_filename
    if not attachment_path or not os.path.exists(attachment_path):
        raise HTTPException(status_code=404, detail="Attachment not found")
    
    return FileResponse(
        path=attachment_path,
        filename=attachment_filename or "attachment",
        media_type="application/octet-stream",
        headers={"X-Content-Type-Options": "nosniff"},
    )

@router.get("/unread-count")
async def get_unread_count(
    current_user: User = Depends(require_main_admin()),
    db: Session = Depends(get_db)
):
    """Get count of unread memos for the current admin"""
    all_memo_ids = [memo.id for memo in db.query(Memo).all()]
    viewed_memo_ids = get_memo_viewed_ids(db, MemoView, current_user.username, "admin")
    unread_count = len([mid for mid in all_memo_ids if mid not in viewed_memo_ids])
    return {"unread_count": unread_count}
