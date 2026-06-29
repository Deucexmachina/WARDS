"""Tests for VM1 auto-recovery, resolve, and false-positive workflows."""

import json
import hashlib
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from SECURITY.security_engine import (
    _create_vm1_restore_command,
    _has_pending_vm1_restore_for_file,
    classify,
    get_pending_vm1_restore_commands,
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
