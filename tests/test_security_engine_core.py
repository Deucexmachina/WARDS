"""Tests for core SECURITY engine functions: scanning, backup, detection, AI, folder management."""

import json
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from SECURITY.security_engine import (
    classify,
    content_flags,
    ai_predict,
    AIPrediction,
    add_monitored_folder,
    remove_monitored_folder,
    create_manual_backup,
    scan_single_file,
    record_detection,
    get_pending_vm1_restore_commands,
    _create_vm1_restore_command,
    _has_pending_vm1_restore_for_file,
)
from SECURITY.security_models import (
    SecurityMonitoredFile,
    SecurityDetectionEvent,
    SecurityRecoveryEvent,
    SecuritySetting,
    SecurityIncident,
)


class FakeSettingQuery:
    def __init__(self, rows=None):
        self.rows = rows or []

    def filter(self, *args, **kwargs):
        key = kwargs.get("key")
        if key:
            self.rows = [r for r in self.rows if getattr(r, "key", None) == key]
        return self

    def first(self):
        return self.rows[0] if self.rows else None


class MonitoredFolderDB:
    def __init__(self):
        self.settings = []
        self.files = []
        self.recoveries = []
        self.committed = False

    def query(self, model):
        if model is SecuritySetting:
            return FakeSettingQuery(self.settings)
        if model is SecurityMonitoredFile:
            class Q:
                def filter(q, *a, **kw):
                    return q
                def order_by(q, *a, **kw):
                    return q
                def all(q):
                    return []
            return Q()
        if model is SecurityRecoveryEvent:
            class Q:
                def filter(q, *a, **kw):
                    return q
                def order_by(q, *a, **kw):
                    return q
                def all(q):
                    return []
                def first(q):
                    return None
            return Q()
        if model is SecurityIncident:
            class Q:
                def filter(q, *a, **kw):
                    return q
                def order_by(q, *a, **kw):
                    return q
                def all(q):
                    return []
                def first(q):
                    return None
            return Q()
        return FakeSettingQuery()

    def add(self, obj):
        if isinstance(obj, SecuritySetting):
            self.settings.append(obj)
        if isinstance(obj, SecurityRecoveryEvent):
            obj.id = obj.id or len(self.recoveries) + 1
            self.recoveries.append(obj)
        if isinstance(obj, SecurityMonitoredFile):
            obj.id = obj.id or len(self.files) + 1
            self.files.append(obj)

    def commit(self):
        self.committed = True

    def refresh(self, obj):
        pass


# ---------------------------------------------------------------------------
# AI / Classification / Content Flags
# ---------------------------------------------------------------------------

def test_content_flags_detects_external_resource():
    flags = content_flags("<script src='http://example.com/test.js'></script>", {})
    # The exact flag name varies by rule; just verify something is flagged
    assert len(flags) > 0


def test_content_flags_ignores_safe_text():
    flags = content_flags("Hello world, this is normal text.", {})
    assert "external_resource" not in flags


def test_ai_predict_returns_structured_result():
    result = ai_predict(
        Path("test.py"),
        old_content="print('hello')",
        new_content="import os; os.system('ls')",
        context={},
    )
    assert result.prediction in {"normal", "suspicious", "malicious"}
    assert 0.0 <= result.score <= 1.0
    assert 0.0 <= result.confidence <= 1.0
    assert result.basis


def test_classify_returns_severity_and_cvss():
    pred = AIPrediction(prediction="suspicious", score=0.7, confidence=0.8, basis="test")
    result = classify("content_modified", pred, ["external_resource"], {})
    assert "severity_level" in result
    assert "cvss_score" in result
    assert result["severity_level"] in {"low", "medium", "high", "critical", "info"}


# ---------------------------------------------------------------------------
# Monitored Folder Management
# ---------------------------------------------------------------------------

def test_add_monitored_folder_rejects_relative_path():
    db = MonitoredFolderDB()
    with pytest.raises(ValueError):
        add_monitored_folder(db, "relative/path")


def test_add_monitored_folder_accepts_absolute_path():
    with tempfile.TemporaryDirectory() as tmp:
        db = MonitoredFolderDB()
        with patch("SECURITY.security_engine.create_manual_backup", return_value=SimpleNamespace(status="success")):
            result = add_monitored_folder(db, tmp, vm_target="vm1")
        assert result["folder_scope"] == "vm1"
        assert db.committed is True


def test_remove_monitored_folder_rejects_relative_path():
    db = MonitoredFolderDB()
    with pytest.raises(ValueError):
        remove_monitored_folder(db, "relative/path")


def test_remove_monitored_folder_accepts_absolute_path():
    with tempfile.TemporaryDirectory() as tmp:
        db = MonitoredFolderDB()
        # First add the folder so removal succeeds
        with patch("SECURITY.security_engine.create_manual_backup", return_value=SimpleNamespace(status="success")):
            add_monitored_folder(db, tmp, vm_target="vm1")
        db.committed = False
        with patch("SECURITY.security_engine.create_manual_backup", return_value=SimpleNamespace(status="success")):
            result = remove_monitored_folder(db, tmp, vm_target="vm1")
        assert result["folder_scope"] == "vm1"
        assert db.committed is True


# ---------------------------------------------------------------------------
# Backup Creation (smoke tests with mocks)
# ---------------------------------------------------------------------------

def test_create_manual_backup_runs_without_crash():
    with tempfile.TemporaryDirectory() as tmp:
        db = MonitoredFolderDB()
        with patch("utils.backup_engine.backup_dir", return_value=Path(tmp)):
            with patch("SECURITY.security_engine.writable_backup_location", return_value=Path(tmp)):
                with patch("SECURITY.security_engine.reconcile_trusted_file_removals", return_value={}):
                    event = create_manual_backup(db, initiated_by=None, label="test")
                    assert isinstance(event, SecurityRecoveryEvent)


# ---------------------------------------------------------------------------
# Scanning (smoke tests)
# ---------------------------------------------------------------------------

def test_scan_single_file_detects_change():
    with tempfile.TemporaryDirectory() as tmp:
        test_file = Path(tmp) / "test.py"
        test_file.write_text("print('hello')")

        entry = SecurityMonitoredFile(
            file_path=str(test_file),
            relative_path="test.py",
            folder_root="CUSTOM_TMP",
            baseline_hash="old_hash",
            current_hash="old_hash",
            status="clean",
            file_type="py",
            size_bytes=test_file.stat().st_size,
        )
        entry.id = 1

        db = MonitoredFolderDB()
        # Mock the incident query join chain so detection recording doesn't crash
        join_mock = MagicMock()
        join_mock.filter.return_value = MagicMock(first=lambda: None)
        db.query = lambda model: MagicMock(join=lambda *a, **k: join_mock)
        detection = scan_single_file(db, entry, context={"manual_scan": True}, commit_clean=False)
        # Since baseline != current, it should record a detection
        assert detection is not None


# ---------------------------------------------------------------------------
# Detection / Incident
# ---------------------------------------------------------------------------

def test_record_detection_creates_event():
    db = MonitoredFolderDB()
    entry = SecurityMonitoredFile(
        file_path="/tmp/test.py",
        relative_path="test.py",
        folder_root="CUSTOM_TMP",
        baseline_hash="old",
        current_hash="new",
        status="modified",
        file_type="py",
        size_bytes=100,
    )
    entry.id = 1

    join_mock = MagicMock()
    join_mock.filter.return_value = MagicMock(first=lambda: None)
    db.query = lambda model: MagicMock(join=lambda *a, **k: join_mock)
    detection = record_detection(
        db, entry, "content_modified", "old", "new", "old content", "new content", context={}
    )
    assert isinstance(detection, SecurityDetectionEvent)
    assert detection.change_type == "content_modified"


# ---------------------------------------------------------------------------
# VM1 Restore Commands
# ---------------------------------------------------------------------------

def test_create_vm1_restore_command_uses_external_file():
    db = MonitoredFolderDB()
    entry = SecurityMonitoredFile(
        file_path="vm1://test.txt",
        relative_path="test.txt",
        folder_root="VM1_WARDS",
        baseline_hash="b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
        current_hash="b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
        status="clean",
        file_type="txt",
        size_bytes=12,
    )
    entry.id = 1

    with tempfile.TemporaryDirectory() as tmp:
        with patch("SECURITY.security_engine.VM1_RESTORE_CONTENT_ROOT", Path(tmp)):
            with patch("SECURITY.security_engine.VM1_SNAPSHOT_ROOT", Path(tmp)):
                cmd = _create_vm1_restore_command(db, entry, detection_id=42, original_content_bytes=b"hello world")
                assert cmd["command_id"].startswith("rest_42_")
                assert cmd["restore_content_file"] is not None
                assert Path(cmd["restore_content_file"]).exists()


def test_get_pending_vm1_restore_commands_hydrates_content():
    db = MonitoredFolderDB()
    with tempfile.TemporaryDirectory() as tmp:
        content_file = Path(tmp) / "rest_1_1234567890.b64"
        content_file.write_bytes(b"aGVsbG8=")  # file already stores base64-encoded text
        commands_json = json.dumps([{
            "command_id": "rest_1_1234567890",
            "relative_path": "test.txt",
            "expected_hash": "abc",
            "restore_content_file": str(content_file),
            "created_at": "2024-01-01T00:00:00",
        }])
        with patch(
            "SECURITY.security_engine.get_setting",
            side_effect=lambda d, k, default=None: commands_json if k == "vm1_restore_commands" else json.dumps([]),
        ):
            pending = get_pending_vm1_restore_commands(db)
            assert len(pending) == 1
            assert pending[0]["restore_content_b64"] == "aGVsbG8="


def test_has_pending_vm1_restore_for_file():
    db = MagicMock()
    with patch(
        "SECURITY.security_engine.get_setting",
        side_effect=lambda d, k, default=None: json.dumps([
            {"command_id": "c1", "relative_path": "a.txt"},
        ]) if k == "vm1_restore_commands" else json.dumps([]),
    ):
        assert _has_pending_vm1_restore_for_file(db, "a.txt") is True
        assert _has_pending_vm1_restore_for_file(db, "b.txt") is False
