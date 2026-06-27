"""Tests for incident resolution and false-positive workflows."""

import json
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from SECURITY.security_engine import (
    resolve_incident,
    mark_false_positive,
    _record_vm1_detection,
)
from SECURITY.security_models import (
    SecurityIncident,
    SecurityDetectionEvent,
    SecurityMonitoredFile,
    SecurityRecoveryEvent,
)


class MockQuery:
    """Simple query builder that supports filter/first/all/join chaining."""

    def __init__(self, results=None, single=None):
        self._results = results or []
        self._single = single

    def filter(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def first(self):
        return self._single

    def all(self):
        return list(self._results)

    def join(self, *args, **kwargs):
        return self


class MockDb:
    """DB mock that tracks adds/commits and supports model-based queries."""

    def __init__(self, *, incidents=None, detections=None, files=None, recoveries=None):
        self._incidents = {i.id: i for i in (incidents or [])}
        self._detections = {d.id: d for d in (detections or [])}
        self._files = {f.id: f for f in (files or [])}
        self._recoveries = {r.id: r for r in (recoveries or [])}
        self.added = []
        self.committed = False

    def query(self, *models):
        model = models[0] if models else None
        if model is SecurityIncident:
            return MockQuery(results=self._incidents.values())
        if model is SecurityDetectionEvent:
            return MockQuery(results=self._detections.values())
        if model is SecurityMonitoredFile:
            return MockQuery(results=self._files.values())
        if model is SecurityRecoveryEvent:
            return MockQuery(results=self._recoveries.values())
        return MockQuery()

    def add(self, obj):
        self.added.append(type(obj).__name__)
        if hasattr(obj, "id") and obj.id is not None:
            if isinstance(obj, SecurityIncident):
                self._incidents[obj.id] = obj
            elif isinstance(obj, SecurityRecoveryEvent):
                self._recoveries[obj.id] = obj

    def commit(self):
        self.committed = True

    def refresh(self, obj):
        pass


def _make_incident(status="open", response_action="vm1_restore_pending", quarantine_paths=None):
    inc = SecurityIncident(
        detection_event_id=1,
        status=status,
        response_action=response_action,
        quarantine_paths_json=json.dumps(quarantine_paths or []),
        severity_level="high",
    )
    inc.id = 1
    return inc


def _make_detection(file_id=10):
    det = SecurityDetectionEvent(
        file_id=file_id,
        target_type="vm1_file",
        target_name="WARDS/frontend/index.html",
        actor="vm1_reporter",
        change_type="vm1_content_modified",
        old_hash="abc",
        new_hash="def",
        severity_level="high",
    )
    det.id = 1
    return det


def _make_file_entry(relative_path="WARDS/frontend/index.html"):
    entry = SecurityMonitoredFile(
        file_path=f"vm1://{relative_path}",
        relative_path=relative_path,
        folder_root="VM1_WARDS",
        baseline_hash="abc",
        current_hash="def",
        status="modified",
        file_type="html",
        size_bytes=100,
    )
    entry.id = 10
    return entry


# ---------------------------------------------------------------------------
# resolve_incident
# ---------------------------------------------------------------------------

def test_resolve_incident_sets_resolved_status(monkeypatch):
    """resolve_incident should mark the incident as resolved and commit."""
    incident = _make_incident(status="open", response_action="vm1_restore_pending")
    detection = _make_detection()
    file_entry = _make_file_entry()

    db = MockDb(incidents=[incident], detections=[detection], files=[file_entry])

    monkeypatch.setattr("SECURITY.security_engine.is_vm1_file", lambda entry: True)
    monkeypatch.setattr("SECURITY.security_engine.is_database_entry", lambda entry: False)
    monkeypatch.setattr("SECURITY.security_engine.portable_monitored_path", lambda entry: Path("/tmp/test.html"))
    monkeypatch.setattr("SECURITY.security_engine.ensure_missing_file_confirmation", lambda *a, **kw: None)
    monkeypatch.setattr("SECURITY.security_engine.cleanup_quarantine_paths", lambda paths: None)
    monkeypatch.setattr("SECURITY.security_engine.safe_quarantine_path", lambda p: Path(p) if p else None)
    monkeypatch.setattr("SECURITY.security_engine._valid_admin_id", lambda db, aid: aid)
    monkeypatch.setattr("SECURITY.security_engine.now_utc", lambda: __import__("datetime").datetime.utcnow())

    # Patch the query chain for incident.id == 1
    def _query(model):
        if model is SecurityIncident:
            return MockQuery(single=incident)
        if model is SecurityDetectionEvent:
            return MockQuery(single=detection)
        if model is SecurityMonitoredFile:
            return MockQuery(single=file_entry)
        return MockQuery()

    db.query = _query

    resolved = resolve_incident(db, incident_id=1, admin_id=99, create_event=False)

    assert resolved.status == "resolved"
    assert resolved.resolved_by == 99
    assert db.committed is True


def test_resolve_vm1_auto_recovered_pending_review_cleans_quarantine(monkeypatch, tmp_path):
    """For auto_recovered_pending_review, resolve should clean quarantine and confirm recovery."""
    quarantine_file = tmp_path / "quarantine" / "test.html"
    quarantine_file.parent.mkdir(parents=True, exist_ok=True)
    quarantine_file.write_text("original content")

    incident = _make_incident(
        status="open",
        response_action="auto_recovered_pending_review",
        quarantine_paths=[str(quarantine_file)],
    )
    detection = _make_detection()
    file_entry = _make_file_entry()

    db = MockDb(incidents=[incident], detections=[detection], files=[file_entry])

    snapshot_root = tmp_path / "snapshots"
    snapshot_root.mkdir()

    monkeypatch.setattr("SECURITY.security_engine.is_vm1_file", lambda entry: True)
    monkeypatch.setattr("SECURITY.security_engine.is_database_entry", lambda entry: False)
    monkeypatch.setattr("SECURITY.security_engine.portable_monitored_path", lambda entry: Path("/tmp/test.html"))
    monkeypatch.setattr("SECURITY.security_engine.ensure_missing_file_confirmation", lambda *a, **kw: None)
    monkeypatch.setattr("SECURITY.security_engine.cleanup_quarantine_paths", lambda paths: None)
    monkeypatch.setattr("SECURITY.security_engine.safe_quarantine_path", lambda p: Path(p) if p else None)
    monkeypatch.setattr("SECURITY.security_engine._valid_admin_id", lambda db, aid: aid)
    monkeypatch.setattr("SECURITY.security_engine.now_utc", lambda: __import__("datetime").datetime.utcnow())
    monkeypatch.setattr("SECURITY.security_engine.VM1_SNAPSHOT_ROOT", snapshot_root)
    monkeypatch.setattr(
        "SECURITY.security_engine.create_manual_backup",
        lambda db, initiated_by, label: SimpleNamespace(status="success"),
    )

    def _query(model):
        if model is SecurityIncident:
            return MockQuery(single=incident)
        if model is SecurityDetectionEvent:
            return MockQuery(single=detection)
        if model is SecurityMonitoredFile:
            return MockQuery(single=file_entry)
        if model is SecurityRecoveryEvent:
            return MockQuery()
        return MockQuery()

    db.query = _query

    resolved = resolve_incident(db, incident_id=1, admin_id=99)

    assert resolved.status == "resolved"
    # A recovery event should have been added
    assert "SecurityRecoveryEvent" in db.added
    assert file_entry.status == "clean"


# ---------------------------------------------------------------------------
# mark_false_positive
# ---------------------------------------------------------------------------

def test_mark_false_positive_sets_false_positive_status(monkeypatch, tmp_path):
    """mark_false_positive should set status to false_positive and commit."""
    quarantine_file = tmp_path / "quarantine" / "test.html"
    quarantine_file.parent.mkdir(parents=True, exist_ok=True)
    quarantine_file.write_text("original content")

    incident = _make_incident(
        status="open",
        response_action="vm1_restore_pending",
        quarantine_paths=[str(quarantine_file)],
    )
    detection = _make_detection()
    file_entry = _make_file_entry()

    db = MockDb(incidents=[incident], detections=[detection], files=[file_entry])

    monkeypatch.setattr("SECURITY.security_engine.is_vm1_file", lambda entry: False)
    monkeypatch.setattr("SECURITY.security_engine.is_database_entry", lambda entry: False)
    monkeypatch.setattr("SECURITY.security_engine.portable_monitored_path", lambda entry: Path("/tmp/test.html"))
    monkeypatch.setattr("SECURITY.security_engine.ensure_missing_file_confirmation", lambda *a, **kw: None)
    monkeypatch.setattr("SECURITY.security_engine.cleanup_quarantine_paths", lambda paths: None)
    monkeypatch.setattr("SECURITY.security_engine.safe_quarantine_path", lambda p: Path(p) if p else None)
    monkeypatch.setattr("SECURITY.security_engine._valid_admin_id", lambda db, aid: aid)
    monkeypatch.setattr("SECURITY.security_engine.now_utc", lambda: __import__("datetime").datetime.utcnow())
    monkeypatch.setattr("SECURITY.security_engine.latest_backup_root", lambda db: None)
    monkeypatch.setattr("SECURITY.security_engine.backup_file_path", lambda root, rel: None)
    monkeypatch.setattr("SECURITY.security_engine.restore_quarantined_copy_to_original", lambda *a, **kw: None)
    monkeypatch.setattr(
        "SECURITY.security_engine.create_manual_backup",
        lambda db, initiated_by, label: SimpleNamespace(status="success"),
    )

    def _query(model):
        if model is SecurityIncident:
            return MockQuery(single=incident)
        if model is SecurityDetectionEvent:
            return MockQuery(single=detection)
        if model is SecurityMonitoredFile:
            return MockQuery(single=file_entry)
        if model is SecurityRecoveryEvent:
            return MockQuery()
        return MockQuery()

    db.query = _query

    result = mark_false_positive(db, incident_id=1, admin_id=99)

    assert result.status == "false_positive"
    assert result.resolved_by == 99
    assert db.committed is True


def test_mark_false_positive_vm1_auto_recovered_pending_review_reverts(monkeypatch, tmp_path):
    """For VM1 auto_recovered_pending_review, false+ should push defaced snapshot back."""
    quarantine_file = tmp_path / "quarantine" / "test.html"
    quarantine_file.parent.mkdir(parents=True, exist_ok=True)
    quarantine_file.write_text("original content")

    incident = _make_incident(
        status="open",
        response_action="auto_recovered_pending_review",
        quarantine_paths=[str(quarantine_file)],
    )
    detection = _make_detection()
    file_entry = _make_file_entry()

    db = MockDb(incidents=[incident], detections=[detection], files=[file_entry])

    defaced_root = tmp_path / "defaced"
    defaced_root.mkdir()
    defaced_snapshot = defaced_root / file_entry.relative_path
    defaced_snapshot.parent.mkdir(parents=True, exist_ok=True)
    defaced_snapshot.write_text("defaced content")

    snapshot_root = tmp_path / "snapshots"
    snapshot_root.mkdir()

    restore_cmds = []

    monkeypatch.setattr("SECURITY.security_engine.is_vm1_file", lambda entry: True)
    monkeypatch.setattr("SECURITY.security_engine.is_database_entry", lambda entry: False)
    monkeypatch.setattr("SECURITY.security_engine.ensure_missing_file_confirmation", lambda *a, **kw: None)
    monkeypatch.setattr("SECURITY.security_engine.cleanup_quarantine_paths", lambda paths: None)
    monkeypatch.setattr("SECURITY.security_engine.safe_quarantine_path", lambda p: Path(p) if p else None)
    monkeypatch.setattr("SECURITY.security_engine._valid_admin_id", lambda db, aid: aid)
    monkeypatch.setattr("SECURITY.security_engine.now_utc", lambda: __import__("datetime").datetime.utcnow())
    monkeypatch.setattr("SECURITY.security_engine.VM1_DEFACED_SNAPSHOT_ROOT", defaced_root)
    monkeypatch.setattr("SECURITY.security_engine.VM1_SNAPSHOT_ROOT", snapshot_root)
    monkeypatch.setattr(
        "SECURITY.security_engine._create_vm1_restore_command",
        lambda db, entry, det_id, **kw: restore_cmds.append((entry.relative_path, det_id)) or {},
    )
    monkeypatch.setattr(
        "SECURITY.security_engine.create_manual_backup",
        lambda db, initiated_by, label: SimpleNamespace(status="success"),
    )

    def _query(model):
        if model is SecurityIncident:
            return MockQuery(single=incident)
        if model is SecurityDetectionEvent:
            return MockQuery(single=detection)
        if model is SecurityMonitoredFile:
            return MockQuery(single=file_entry)
        if model is SecurityRecoveryEvent:
            return MockQuery()
        return MockQuery()

    db.query = _query

    result = mark_false_positive(db, incident_id=1, admin_id=99)

    assert result.status == "false_positive"
    # Should have queued a restore command to push defaced content back
    assert len(restore_cmds) == 1
    assert restore_cmds[0][0] == file_entry.relative_path


# ---------------------------------------------------------------------------
# _record_vm1_detection
# ---------------------------------------------------------------------------

def test_record_vm1_detection_web_file_auto_recover_keeps_incident_open(monkeypatch, tmp_path):
    """Web/code file changes should queue auto-recovery but keep the incident open."""
    entry = _make_file_entry(relative_path="WARDS/frontend/index.html")
    entry.baseline_hash = "oldhash"
    entry.current_hash = "newhash"

    db = MockDb(files=[entry])

    # Track what gets created
    incidents_created = []
    alerts_created = []
    restore_commands = []

    monkeypatch.setattr("SECURITY.security_engine.ai_predict", lambda *a, **kw: SimpleNamespace(prediction="suspicious", score=0.9, confidence=0.9, basis="test"))
    monkeypatch.setattr("SECURITY.security_engine.content_flags", lambda *a, **kw: ["external_resource"])
    monkeypatch.setattr(
        "SECURITY.security_engine.classify",
        lambda *a, **kw: {"severity_level": "high", "cvss_score": 9.0, "nist_category": "C1", "enisa_threat_type": "malware"},
    )
    monkeypatch.setattr("SECURITY.security_engine.diff_lines", lambda *a, **kw: {"added": ["bad"], "removed": []})
    monkeypatch.setattr("SECURITY.security_engine.build_trigger_summary", lambda *a, **kw: "test trigger")
    monkeypatch.setattr("SECURITY.security_engine._quarantine_vm1_snapshot", lambda entry, det_id: None)
    monkeypatch.setattr(
        "SECURITY.security_engine.create_incident",
        lambda db, det, cls, flags, changed, qpath: incidents_created.append(det) or _make_incident(response_action="monitoring"),
    )
    monkeypatch.setattr(
        "SECURITY.security_engine.create_system_alert",
        lambda db, kind, msg, sev, **kw: alerts_created.append((kind, msg)),
    )
    monkeypatch.setattr(
        "SECURITY.security_engine._create_vm1_restore_command",
        lambda db, entry, det_id, **kw: restore_commands.append((entry.relative_path, det_id)) or {},
    )
    monkeypatch.setattr("SECURITY.security_engine.json_dumps", json.dumps)

    detection = _record_vm1_detection(db, entry, "vm1_content_modified", "newhash", old_content="old", new_content="new")

    assert detection is not None
    assert detection.change_type == "vm1_content_modified"
    assert len(restore_commands) == 1  # Auto-recovery queued
    assert len(incidents_created) == 1  # Incident created
    assert any(kind == "incident_auto_recovery" for kind, _ in alerts_created)


def test_record_vm1_detection_non_web_file_no_auto_recover(monkeypatch, tmp_path):
    """Non-web file changes should create an incident but NOT queue auto-recovery."""
    entry = _make_file_entry(relative_path="WARDS/backend/README.md")
    entry.baseline_hash = "oldhash"
    entry.current_hash = "newhash"

    db = MockDb(files=[entry])

    incidents_created = []
    restore_commands = []

    monkeypatch.setattr("SECURITY.security_engine.ai_predict", lambda *a, **kw: SimpleNamespace(prediction="normal", score=0.2, confidence=0.8, basis="test"))
    monkeypatch.setattr("SECURITY.security_engine.content_flags", lambda *a, **kw: [])
    monkeypatch.setattr(
        "SECURITY.security_engine.classify",
        lambda *a, **kw: {"severity_level": "medium", "cvss_score": 4.0, "nist_category": "C3", "enisa_threat_type": "low"},
    )
    monkeypatch.setattr("SECURITY.security_engine.diff_lines", lambda *a, **kw: {"added": ["ok"], "removed": []})
    monkeypatch.setattr("SECURITY.security_engine.build_trigger_summary", lambda *a, **kw: "test trigger")
    monkeypatch.setattr("SECURITY.security_engine._quarantine_vm1_snapshot", lambda entry, det_id: None)
    monkeypatch.setattr(
        "SECURITY.security_engine.create_incident",
        lambda db, det, cls, flags, changed, qpath: incidents_created.append(det) or _make_incident(response_action="vm1_restore_pending"),
    )
    monkeypatch.setattr(
        "SECURITY.security_engine._create_vm1_restore_command",
        lambda db, entry, det_id, **kw: restore_commands.append((entry.relative_path, det_id)) or {},
    )
    monkeypatch.setattr("SECURITY.security_engine.create_incident_system_alert", lambda *a, **kw: None)
    monkeypatch.setattr("SECURITY.security_engine.json_dumps", json.dumps)

    detection = _record_vm1_detection(db, entry, "vm1_content_modified", "newhash", old_content="old", new_content="new")

    assert detection is not None
    assert len(incidents_created) == 1
    assert len(restore_commands) == 0  # No auto-recovery for .md files


def test_record_vm1_detection_dedup_skips_duplicate_incident(monkeypatch, tmp_path):
    """If an open incident already exists for the same file + change_type, skip creating another."""
    entry = _make_file_entry(relative_path="WARDS/frontend/index.html")
    entry.baseline_hash = "oldhash"
    entry.current_hash = "newhash"

    existing_incident = _make_incident(status="open", response_action="vm1_restore_pending")
    existing_detection = _make_detection(file_id=entry.id)

    # Link existing incident to existing detection via file_id
    db = MockDb(files=[entry])

    incidents_created = []

    monkeypatch.setattr("SECURITY.security_engine.ai_predict", lambda *a, **kw: SimpleNamespace(prediction="suspicious", score=0.9, confidence=0.9, basis="test"))
    monkeypatch.setattr("SECURITY.security_engine.content_flags", lambda *a, **kw: ["external_resource"])
    monkeypatch.setattr(
        "SECURITY.security_engine.classify",
        lambda *a, **kw: {"severity_level": "high", "cvss_score": 9.0, "nist_category": "C1", "enisa_threat_type": "malware"},
    )
    monkeypatch.setattr("SECURITY.security_engine.diff_lines", lambda *a, **kw: {"added": ["bad"], "removed": []})
    monkeypatch.setattr("SECURITY.security_engine.build_trigger_summary", lambda *a, **kw: "test trigger")
    monkeypatch.setattr("SECURITY.security_engine._quarantine_vm1_snapshot", lambda entry, det_id: None)
    monkeypatch.setattr(
        "SECURITY.security_engine.create_incident",
        lambda db, det, cls, flags, changed, qpath: incidents_created.append(det) or _make_incident(response_action="monitoring"),
    )
    monkeypatch.setattr(
        "SECURITY.security_engine._create_vm1_restore_command",
        lambda db, entry, det_id, **kw: {},
    )
    monkeypatch.setattr("SECURITY.security_engine.json_dumps", json.dumps)

    # Mock the dedup query to return an existing incident
    join_mock = MagicMock()
    join_mock.filter.return_value = MagicMock(first=lambda: existing_incident)

    def _query(model):
        if model is SecurityIncident:
            class Q:
                def filter(q, *a, **kw):
                    return q
                def join(q, *a, **kw):
                    return join_mock
            return Q()
        if model is SecurityDetectionEvent:
            return MockQuery(single=existing_detection)
        if model is SecurityMonitoredFile:
            return MockQuery(single=entry)
        return MockQuery()

    db.query = _query

    detection = _record_vm1_detection(db, entry, "vm1_content_modified", "newhash", old_content="old", new_content="new")

    assert detection is not None
    assert len(incidents_created) == 0  # Deduplication prevented new incident
