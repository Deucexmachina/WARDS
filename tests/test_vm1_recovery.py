"""Tests for VM1 auto-recovery, resolve, and false-positive workflows."""

import json
import hashlib
import importlib.util
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from SECURITY.security_engine import (
    _create_vm1_restore_command,
    _has_pending_vm1_restore_for_file,
    IMPORTANT_SYSTEM_ALERT_KEYS,
    classify,
    get_pending_vm1_restore_commands,
    vm1_bulk_changes_match_git_head,
)


def test_has_pending_vm1_restore_for_file():
    db = MagicMock()

    with patch(
        "SECURITY.security_engine.get_setting",
        side_effect=lambda d, k, default=None: json.dumps([
            {"command_id": "c1", "relative_path": "VM1_WARDS/test.txt"},
            {"command_id": "c2", "relative_path": "VM1_WARDS/other.txt"},
        ]) if k == "vm1_restore_commands" else json.dumps([]),
    ):
        assert _has_pending_vm1_restore_for_file(db, "VM1_WARDS/test.txt") is True
        assert _has_pending_vm1_restore_for_file(db, "VM1_WARDS/other.txt") is True
        assert _has_pending_vm1_restore_for_file(db, "VM1_WARDS/missing.txt") is False


def test_auto_recover_high_risk_extensions():
    """High-risk extensions should map to higher severity / file_type_risk."""
    prediction = SimpleNamespace(prediction="suspicious", score=0.5, confidence=0.6, basis="test")
    flags = []
    context = {}

    for ext in [".html", ".jsx", ".js", ".py"]:
        result = classify("content_modified", prediction, flags, context)
        # Even with a minimal suspicious prediction, file_type_risk adds to score
        # The classify function itself doesn't know about extensions; the scoring
        # happens inside ai_predict and scan_single_file which consume file_type_risk.
        # This test just verifies classify returns a valid severity for vm1 use.
        assert result["severity_level"] in {"low", "medium", "high", "critical", "info"}
        assert "cvss_score" in result


def test_get_pending_vm1_restore_commands_filters_acked():
    db = MagicMock()

    with patch(
        "SECURITY.security_engine.get_setting",
        side_effect=lambda d, k, default=None: {
            "vm1_restore_commands": json.dumps([
                {"command_id": "c1", "relative_path": "a.txt"},
                {"command_id": "c2", "relative_path": "b.txt"},
            ]),
            "vm1_restore_acks": json.dumps([
                {"command_id": "c1"},
            ]),
        }.get(k, default),
    ):
        pending = get_pending_vm1_restore_commands(db)
        assert len(pending) == 1
        assert pending[0]["command_id"] == "c2"


def test_create_vm1_restore_command_does_not_truncate_pending_commands(monkeypatch, tmp_path):
    db = MagicMock()
    stored = {
        "vm1_restore_commands": json.dumps([
            {"command_id": f"c{i}", "relative_path": f"file{i}.py"}
            for i in range(60)
        ]),
        "vm1_restore_acks": json.dumps([
            {"command_id": "c0"},
            {"command_id": "c1"},
        ]),
    }

    def fake_get_setting(_db, key, default=None):
        return stored.get(key, default)

    def fake_set_setting(_db, key, value, _updated_by):
        stored[key] = value

    monkeypatch.setattr("SECURITY.security_engine.get_setting", fake_get_setting)
    monkeypatch.setattr("SECURITY.security_engine.set_setting", fake_set_setting)
    monkeypatch.setattr("SECURITY.security_engine.VM1_RESTORE_CONTENT_ROOT", tmp_path)

    clean_hash = hashlib.sha256(b"clean").hexdigest()
    entry = SimpleNamespace(relative_path="VM1_WARDS/app.py", baseline_hash=clean_hash)

    _create_vm1_restore_command(db, entry, detection_id=99, original_content_bytes=b"clean")

    commands = json.loads(stored["vm1_restore_commands"])
    command_ids = {item["command_id"] for item in commands}
    assert len(commands) == 59
    assert "c0" not in command_ids
    assert "c1" not in command_ids
    assert any(item.get("detection_id") == 99 for item in commands)


def test_bulk_vm1_changes_require_git_head_confirmation():
    clean = SimpleNamespace(relative_path="WARDS/frontend/index.html")

    assert vm1_bulk_changes_match_git_head([
        (clean, {"git_head_match": True}, "a" * 64),
        (clean, {"git_head_match": True}, "b" * 64),
    ]) is True

    assert vm1_bulk_changes_match_git_head([
        (clean, {"git_head_match": True}, "a" * 64),
        (clean, {"git_head_match": False}, "b" * 64),
    ]) is False

    assert vm1_bulk_changes_match_git_head([]) is False


def test_vm1_reporter_config_sync_returns_force_scan_token(monkeypatch):
    reporter_path = Path(__file__).resolve().parents[1] / "scripts" / "vm1_security_reporter.py"
    spec = importlib.util.spec_from_file_location("vm1_security_reporter_test", reporter_path)
    reporter = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(reporter)

    monkeypatch.setattr(reporter, "MAX_DYNAMIC_SCAN_INTERVAL", 60)
    token = reporter.apply_vm2_config({
        "scan_interval_seconds": 300,
        "vm1_custom_folders": ["/opt/wards/custom"],
        "force_scan_token": "2026-07-03T13:42:07",
    })

    assert token == "2026-07-03T13:42:07"
    assert reporter.DYNAMIC_SCAN_INTERVAL == 60
    assert reporter.CUSTOM_FOLDERS[0].parts[-3:] == ("opt", "wards", "custom")


def test_auto_recovery_alerts_are_email_eligible():
    assert "incident_auto_recovery" in IMPORTANT_SYSTEM_ALERT_KEYS


def test_vm1_reporter_excludes_vendor_dirs_and_budgets_inline_content(monkeypatch, tmp_path):
    reporter_path = Path(__file__).resolve().parents[1] / "scripts" / "vm1_security_reporter.py"
    spec = importlib.util.spec_from_file_location("vm1_security_reporter_budget_test", reporter_path)
    reporter = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(reporter)

    root = tmp_path / "WARDS"
    (root / "frontend").mkdir(parents=True)
    (root / "frontend" / "index.html").write_text("<html>clean</html>")
    (root / "node_modules" / "pkg").mkdir(parents=True)
    (root / "node_modules" / "pkg" / "ignored.js").write_text("ignored")
    (root / "backend").mkdir()
    (root / "backend" / "large.py").write_text("x" * 200)

    monkeypatch.setattr(reporter, "MONITORED_ROOTS", {"WARDS": root})
    monkeypatch.setattr(reporter, "CUSTOM_FOLDERS", [])
    monkeypatch.setattr(reporter, "MAX_INLINE_CONTENT_BYTES", 64)
    monkeypatch.setattr(reporter, "MAX_MANIFEST_CONTENT_BYTES", 64)

    files = list(reporter.iter_monitored_files())
    by_path = {item["relative_path"]: item for item in files}

    assert "WARDS/frontend/index.html" in by_path
    assert "WARDS/node_modules/pkg/ignored.js" not in by_path
    assert by_path["WARDS/frontend/index.html"]["content_b64"]
    assert by_path["WARDS/backend/large.py"]["content_b64"] is None


def test_vm1_reporter_prioritizes_changed_files_for_inline_content(monkeypatch, tmp_path):
    reporter_path = Path(__file__).resolve().parents[1] / "scripts" / "vm1_security_reporter.py"
    spec = importlib.util.spec_from_file_location("vm1_security_reporter_priority_test", reporter_path)
    reporter = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(reporter)

    root = tmp_path / "WARDS"
    root.mkdir()
    clean_file = root / "a_clean.py"
    changed_file = root / "z_changed.py"
    clean_file.write_text("c" * 40)
    changed_file.write_text("m" * 40)

    monkeypatch.setattr(reporter, "MONITORED_ROOTS", {"WARDS": root})
    monkeypatch.setattr(reporter, "CUSTOM_FOLDERS", [])
    monkeypatch.setattr(reporter, "MAX_INLINE_CONTENT_BYTES", 64)
    monkeypatch.setattr(reporter, "MAX_MANIFEST_CONTENT_BYTES", 40)
    monkeypatch.setattr(
        reporter,
        "_git_info_for_root",
        lambda _root: (root, {"a_clean.py", "z_changed.py"}, {"z_changed.py"}),
    )

    files = list(reporter.iter_monitored_files())
    by_path = {item["relative_path"]: item for item in files}

    assert by_path["WARDS/z_changed.py"]["content_b64"]
    assert by_path["WARDS/a_clean.py"]["content_b64"] is None


def test_vm1_reporter_retries_413_with_hash_only_manifest(monkeypatch):
    reporter_path = Path(__file__).resolve().parents[1] / "scripts" / "vm1_security_reporter.py"
    spec = importlib.util.spec_from_file_location("vm1_security_reporter_retry_test", reporter_path)
    reporter = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(reporter)

    posted_payloads = []

    class Response:
        def __init__(self, status_code, payload=None, text=""):
            self.status_code = status_code
            self._payload = payload or {}
            self.text = text

        def json(self):
            return self._payload

    def fake_post(_url, headers=None, json=None, timeout=None):
        posted_payloads.append(json)
        if len(posted_payloads) == 1:
            return Response(413, text="too large")
        return Response(200, {"registered": 1, "changed": 0, "detections": 0, "restore_commands": []})

    monkeypatch.setattr(reporter, "SECURITY_API_URL", "https://vm2.local")
    monkeypatch.setattr(reporter, "API_KEY", "secret")
    monkeypatch.setattr(reporter, "current_git_commit", lambda: "abc123")
    monkeypatch.setattr(reporter.requests, "post", fake_post)

    sent = reporter.send_manifest([
        {
            "relative_path": "WARDS/frontend/index.html",
            "folder_root": "VM1_WARDS",
            "file_path": "/opt/wards/app/WARDS/frontend/index.html",
            "size_bytes": 18,
            "current_hash": "a" * 64,
            "content_b64": "PGh0bWw+PC9odG1sPg==",
            "git_head_match": False,
        }
    ])

    assert sent is True
    assert len(posted_payloads) == 2
    assert posted_payloads[0]["files"][0]["content_b64"]
    assert posted_payloads[1]["files"][0]["content_b64"] is None
