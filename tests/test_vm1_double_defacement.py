"""Test for VM1 double-defacement auto-recovery bug."""

import base64
import hashlib
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

# Ensure pytest mode so build_database_url returns sqlite
os.environ["PYTEST_CURRENT_TEST"] = "1"

from database.models import Base
from SECURITY.security_models import (
    SecurityMonitoredFile,
    SecurityDetectionEvent,
    SecurityIncident,
    SecurityRecoveryEvent,
    SecuritySetting,
)
from SECURITY.security_engine import (
    process_vm1_file_manifest,
    acknowledge_vm1_restore_command,
    resolve_incident,
    get_pending_vm1_restore_commands,
    DEFAULT_AI_RULES,
)


def _b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def make_db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def register_sqlite_collations(dbapi_connection, _connection_record):
        dbapi_connection.create_collation(
            "utf8mb4_bin", lambda left, right: (left > right) - (left < right)
        )

    # Create only the tables we need
    Base.metadata.create_all(
        engine,
        tables=[
            SecurityMonitoredFile.__table__,
            SecurityDetectionEvent.__table__,
            SecurityIncident.__table__,
            SecurityRecoveryEvent.__table__,
            SecuritySetting.__table__,
        ],
    )
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    return Session()


def test_double_defacement_triggers_auto_recovery_twice(monkeypatch, tmp_path):
    """
    Reproduce: after first defacement + resolve, second defacement
    should also create a restore command and trigger auto-recovery.
    """
    db = make_db()

    # Patch snapshot/content roots to temp paths
    monkeypatch.setattr(
        "SECURITY.security_engine.VM1_SNAPSHOT_ROOT", tmp_path / "vm1_snapshots"
    )
    monkeypatch.setattr(
        "SECURITY.security_engine.VM1_RESTORE_CONTENT_ROOT", tmp_path / ".restore_content"
    )
    monkeypatch.setattr(
        "SECURITY.security_engine.VM1_DEFACED_SNAPSHOT_ROOT",
        tmp_path / "vm1_snapshots" / ".defaced",
    )

    # Monkeypatch get_ai_rules to return default rules
    monkeypatch.setattr(
        "SECURITY.security_engine.get_ai_rules", lambda _db: DEFAULT_AI_RULES
    )

    clean_text = "<html><body>Welcome to WARDS</body></html>"
    clean_bytes = clean_text.encode("utf-8")
    clean_hash = hashlib.sha256(clean_bytes).hexdigest()

    defaced_text = '<html><body style="background:#000">HACKED BY NANO</body></html>'
    defaced_bytes = defaced_text.encode("utf-8")
    defaced_hash = hashlib.sha256(defaced_bytes).hexdigest()

    # 1. Register the clean file
    # folder_root must match _clean_folder_root("VM1_WARDS") == "WARDS"
    entry = SecurityMonitoredFile(
        file_path="vm1://WARDS/frontend/index.html",
        relative_path="WARDS/frontend/index.html",
        folder_root="WARDS",
        baseline_hash=clean_hash,
        current_hash=clean_hash,
        status="clean",
        file_type="html",
        size_bytes=len(clean_bytes),
        last_checked=datetime.now(timezone.utc),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)

    # Store clean snapshot on VM2 using the monkeypatched path
    snapshot_root = tmp_path / "vm1_snapshots"
    snapshot = snapshot_root / "WARDS/frontend/index.html"
    snapshot.parent.mkdir(parents=True, exist_ok=True)
    snapshot.write_bytes(clean_bytes)

    # 2. First defacement manifest (with content)
    manifest1 = [
        {
            "relative_path": "WARDS/frontend/index.html",
            "folder_root": "VM1_WARDS",
            "file_path": "/opt/wards/app/WARDS/frontend/index.html",
            "size_bytes": len(defaced_bytes),
            "current_hash": defaced_hash,
            "content_b64": _b64(defaced_text),
            "git_head_match": False,
        }
    ]

    result1 = process_vm1_file_manifest(db, manifest1)
    assert result1["detections"] == 1, f"Expected 1 detection on first defacement, got {result1}"
    assert result1["changed"] == 1

    # Verify restore command was created
    pending1 = get_pending_vm1_restore_commands(db)
    assert len(pending1) == 1, f"Expected 1 restore command after first defacement, got {len(pending1)}"
    cmd1 = pending1[0]
    assert cmd1["relative_path"] == "WARDS/frontend/index.html"
    assert cmd1.get("restore_content_b64") is not None, "First restore command should have content"

    # 3. Simulate VM1 applying the restore and acking
    ack_ok = acknowledge_vm1_restore_command(db, cmd1["command_id"], success=True)
    assert ack_ok is True

    pending_after_ack = get_pending_vm1_restore_commands(db)
    assert len(pending_after_ack) == 0, "Pending commands should be empty after ack"

    # 4. Admin resolves the incident
    detection1 = db.query(SecurityDetectionEvent).order_by(SecurityDetectionEvent.id.desc()).first()
    incident1 = (
        db.query(SecurityIncident)
        .filter(SecurityIncident.detection_event_id == detection1.id)
        .first()
    )
    assert incident1 is not None

    resolved = resolve_incident(db, incident1.id, admin_id=1)
    assert resolved.status == "resolved"

    # Verify baseline is clean after resolve
    db.refresh(entry)
    assert entry.baseline_hash == clean_hash, f"Baseline should be clean after resolve, got {entry.baseline_hash}"
    assert entry.current_hash == clean_hash, f"Current hash should be clean after resolve, got {entry.current_hash}"

    # 5. Second defacement (same content, same hash)
    manifest2 = [
        {
            "relative_path": "WARDS/frontend/index.html",
            "folder_root": "VM1_WARDS",
            "file_path": "/opt/wards/app/WARDS/frontend/index.html",
            "size_bytes": len(defaced_bytes),
            "current_hash": defaced_hash,
            "content_b64": _b64(defaced_text),
            "git_head_match": False,
        }
    ]

    result2 = process_vm1_file_manifest(db, manifest2)
    assert result2["detections"] == 1, f"Expected 1 detection on second defacement, got {result2}"
    assert result2["changed"] == 1

    # THE KEY ASSERTION: a new restore command should exist
    pending2 = get_pending_vm1_restore_commands(db)
    assert len(pending2) == 1, f"Expected 1 restore command after second defacement, got {len(pending2)}"
    cmd2 = pending2[0]
    assert cmd2["relative_path"] == "WARDS/frontend/index.html"
    assert cmd2.get("restore_content_b64") is not None, "Second restore command should have content"

    db.close()


def test_double_defacement_hash_only_suppresses_baseline_corruption(monkeypatch, tmp_path):
    """
    If the second defacement manifest does NOT include content,
    the safety-net should NOT corrupt the baseline to the defaced hash.
    A subsequent forced scan with content should still detect and auto-recover.
    """
    db = make_db()

    monkeypatch.setattr(
        "SECURITY.security_engine.VM1_SNAPSHOT_ROOT", tmp_path / "vm1_snapshots"
    )
    monkeypatch.setattr(
        "SECURITY.security_engine.VM1_RESTORE_CONTENT_ROOT", tmp_path / ".restore_content"
    )
    monkeypatch.setattr(
        "SECURITY.security_engine.VM1_DEFACED_SNAPSHOT_ROOT",
        tmp_path / "vm1_snapshots" / ".defaced",
    )
    monkeypatch.setattr(
        "SECURITY.security_engine.get_ai_rules", lambda _db: DEFAULT_AI_RULES
    )

    clean_text = "<html><body>Welcome to WARDS</body></html>"
    clean_bytes = clean_text.encode("utf-8")
    clean_hash = hashlib.sha256(clean_bytes).hexdigest()

    defaced_text = '<html><body style="background:#000">HACKED BY NANO</body></html>'
    defaced_bytes = defaced_text.encode("utf-8")
    defaced_hash = hashlib.sha256(defaced_bytes).hexdigest()

    entry = SecurityMonitoredFile(
        file_path="vm1://WARDS/frontend/index.html",
        relative_path="WARDS/frontend/index.html",
        folder_root="WARDS",
        baseline_hash=clean_hash,
        current_hash=clean_hash,
        status="clean",
        file_type="html",
        size_bytes=len(clean_bytes),
        last_checked=datetime.now(timezone.utc),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)

    snapshot_root = tmp_path / "vm1_snapshots"
    snapshot = snapshot_root / "WARDS/frontend/index.html"
    snapshot.parent.mkdir(parents=True, exist_ok=True)
    snapshot.write_bytes(clean_bytes)

    # First defacement with content
    result1 = process_vm1_file_manifest(db, [
        {
            "relative_path": "WARDS/frontend/index.html",
            "folder_root": "VM1_WARDS",
            "file_path": "/opt/wards/app/WARDS/frontend/index.html",
            "size_bytes": len(defaced_bytes),
            "current_hash": defaced_hash,
            "content_b64": _b64(defaced_text),
            "git_head_match": False,
        }
    ])
    assert result1["detections"] == 1

    # Ack and resolve
    cmd1 = get_pending_vm1_restore_commands(db)[0]
    acknowledge_vm1_restore_command(db, cmd1["command_id"], success=True)
    detection1 = db.query(SecurityDetectionEvent).order_by(SecurityDetectionEvent.id.desc()).first()
    incident1 = db.query(SecurityIncident).filter(SecurityIncident.detection_event_id == detection1.id).first()
    resolve_incident(db, incident1.id, admin_id=1)
    db.refresh(entry)
    assert entry.baseline_hash == clean_hash

    # Second defacement WITHOUT content (hash-only)
    result2 = process_vm1_file_manifest(db, [
        {
            "relative_path": "WARDS/frontend/index.html",
            "folder_root": "VM1_WARDS",
            "file_path": "/opt/wards/app/WARDS/frontend/index.html",
            "size_bytes": len(defaced_bytes),
            "current_hash": defaced_hash,
            "content_b64": None,
            "git_head_match": False,
        }
    ])

    # After the fix, hash-only high-risk manifests should create a detection
    # instead of silently poisoning the baseline.
    db.refresh(entry)
    assert result2["detections"] == 1, f"Expected 1 detection on hash-only manifest, got {result2}"
    assert entry.baseline_hash == clean_hash, f"Baseline was corrupted: {entry.baseline_hash}"

    # Third manifest WITH content (simulating forced scan)
    # Should NOT create a duplicate detection because an open incident already exists.
    result3 = process_vm1_file_manifest(db, [
        {
            "relative_path": "WARDS/frontend/index.html",
            "folder_root": "VM1_WARDS",
            "file_path": "/opt/wards/app/WARDS/frontend/index.html",
            "size_bytes": len(defaced_bytes),
            "current_hash": defaced_hash,
            "content_b64": _b64(defaced_text),
            "git_head_match": False,
        }
    ])

    db.refresh(entry)

    # No duplicate detection should be created.
    assert result3["detections"] == 0, f"Expected 0 duplicate detections, got {result3}"
    assert entry.baseline_hash == clean_hash, f"Baseline was corrupted: {entry.baseline_hash}"

    # Verify auto-recovery command exists (created by the hash-only manifest)
    pending = get_pending_vm1_restore_commands(db)
    assert len(pending) == 1, f"Expected 1 restore command, got {len(pending)}"
    assert pending[0].get("restore_content_b64") is not None

    db.close()
