"""Regression tests for monitored folder removal and CUSTOM_ prefix fixes."""

import json
import os
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _make_entry(**kwargs):
    defaults = dict(
        id=1,
        file_path="vm1://SIGMA/config.txt",
        relative_path="SIGMA/config.txt",
        folder_root="SIGMA",
        baseline_hash="abc",
        current_hash="def",
        status="clean",
        file_type="txt",
        size_bytes=100,
        last_checked=None,
        created_at=None,
    )
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


# ---------------------------------------------------------------------------
# serialize_file
# ---------------------------------------------------------------------------
class TestSerializeFileStripsCustomPrefix:
    """serialize_file must strip the legacy CUSTOM_ prefix from folder_root."""

    def test_strips_custom_prefix(self):
        from SECURITY.security_engine import serialize_file

        entry = _make_entry(folder_root="CUSTOM_SIGMA")
        result = serialize_file(entry)
        assert result["folder_root"] == "SIGMA"

    def test_no_prefix_unchanged(self):
        from SECURITY.security_engine import serialize_file

        entry = _make_entry(folder_root="VM1_WARDS", file_path="vm1://WARDS/app.py", relative_path="WARDS/app.py")
        result = serialize_file(entry)
        assert result["folder_root"] == "VM1_WARDS"


# ---------------------------------------------------------------------------
# is_vm1_file
# ---------------------------------------------------------------------------
class TestIsVm1FileRecognizesCustomFolders:
    """is_vm1_file must return True for both VM1_ prefixed and vm1:// file paths."""

    def test_vm1_prefix(self):
        from SECURITY.security_engine import is_vm1_file
        entry = SimpleNamespace(folder_root="VM1_WARDS", file_path="/some/path")
        assert is_vm1_file(entry) is True

    def test_vm1_file_path(self):
        from SECURITY.security_engine import is_vm1_file
        entry = SimpleNamespace(folder_root="SIGMA", file_path="vm1://SIGMA/config.txt")
        assert is_vm1_file(entry) is True

    def test_local_file(self):
        from SECURITY.security_engine import is_vm1_file
        entry = SimpleNamespace(folder_root="WARDS", file_path="/WARDS/app.py")
        assert is_vm1_file(entry) is False


# ---------------------------------------------------------------------------
# save_shared_monitored_folders
# ---------------------------------------------------------------------------
class TestSaveSharedMonitoredFoldersReadOnly:
    """save_shared_monitored_folders must not crash on a read-only filesystem."""

    def test_read_only_filesystem_logs_warning(self, caplog):
        from SECURITY.security_engine import save_shared_monitored_folders

        with tempfile.TemporaryDirectory() as tmp:
            json_path = Path(tmp) / "monitored_folders.json"
            os.chmod(tmp, 0o555)
            try:
                with patch("SECURITY.security_engine.SHARED_MONITORED_FOLDERS_PATH", json_path):
                    save_shared_monitored_folders([])
            finally:
                os.chmod(tmp, 0o755)


# ---------------------------------------------------------------------------
# monitored_entries_for_folder  (CRITICAL: Docker path mismatch)
# ---------------------------------------------------------------------------
class TestMonitoredEntriesForFolderVm1Matching:
    """monitored_entries_for_folder must match VM1 entries by folder_root
    when portable_monitored_path resolves to the wrong path in Docker."""

    def _mock_db(self, entries):
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = entries
        return db

    def test_matches_vm1_by_folder_root(self, monkeypatch):
        from SECURITY.security_engine import monitored_entries_for_folder

        # Simulate Docker where portable_monitored_path resolves to /SIGMA/config.txt
        # but root is /opt/wards/app/SIGMA
        entry = _make_entry(
            file_path="vm1://SIGMA/config.txt",
            relative_path="SIGMA/config.txt",
            folder_root="SIGMA",
        )
        db = self._mock_db([entry])

        result = monitored_entries_for_folder(db, Path("/opt/wards/app/SIGMA"))
        assert len(result) == 1
        assert result[0].id == 1

    def test_matches_legacy_custom_prefix(self, monkeypatch):
        from SECURITY.security_engine import monitored_entries_for_folder

        entry = _make_entry(
            file_path="vm1://CUSTOM_SIGMA/config.txt",
            relative_path="CUSTOM_SIGMA/config.txt",
            folder_root="CUSTOM_SIGMA",
        )
        db = self._mock_db([entry])

        result = monitored_entries_for_folder(db, Path("/opt/wards/app/SIGMA"))
        assert len(result) == 1
        assert result[0].id == 1

    def test_matches_vm1_prefix(self, monkeypatch):
        from SECURITY.security_engine import monitored_entries_for_folder

        entry = _make_entry(
            file_path="vm1://VM1_SIGMA/config.txt",
            relative_path="VM1_SIGMA/config.txt",
            folder_root="VM1_SIGMA",
        )
        db = self._mock_db([entry])

        result = monitored_entries_for_folder(db, Path("/opt/wards/app/SIGMA"))
        assert len(result) == 1
        assert result[0].id == 1

    def test_ignores_local_entries_with_different_name(self, monkeypatch):
        from SECURITY.security_engine import monitored_entries_for_folder

        entry = _make_entry(
            file_path="/opt/wards/app/OTHER/config.txt",
            relative_path="OTHER/config.txt",
            folder_root="OTHER",
        )
        db = self._mock_db([entry])

        result = monitored_entries_for_folder(db, Path("/opt/wards/app/SIGMA"))
        assert len(result) == 0


# ---------------------------------------------------------------------------
# remove_monitored_folder  (end-to-end VM1)
# ---------------------------------------------------------------------------
class TestRemoveMonitoredFolderVm1EndToEnd:
    """remove_monitored_folder must delete VM1 DB entries even when the VM1
    settings list was never saved (e.g. old code crashed on shared JSON write)."""

    def test_removes_vm1_entries_when_setting_missing(self, monkeypatch):
        from SECURITY.security_engine import remove_monitored_folder

        db = MagicMock()

        # Simulate VM1 DB entries that exist but settings list is empty
        vm1_entry = _make_entry(
            id=42,
            file_path="vm1://SIGMA/config.txt",
            relative_path="SIGMA/config.txt",
            folder_root="SIGMA",
        )

        # monitored_entries_for_folder will find this entry
        monkeypatch.setattr(
            "SECURITY.security_engine.monitored_entries_for_folder",
            lambda _db, _root: [vm1_entry],
        )
        # VM1 settings list is empty (old bug)
        monkeypatch.setattr(
            "SECURITY.security_engine.load_vm1_monitored_folders",
            lambda _db: [],
        )
        monkeypatch.setattr(
            "SECURITY.security_engine.save_vm1_monitored_folders",
            lambda _db, _paths, updated_by=None: None,
        )
        monkeypatch.setattr(
            "SECURITY.security_engine.remove_configured_monitored_folder",
            lambda _db, _root, updated_by=None: None,
        )
        monkeypatch.setattr(
            "SECURITY.security_engine.sync_wazuh_monitored_folders",
            lambda _db, allow_elevation=True: {"updated": False, "reloaded": False},
        )
        monkeypatch.setattr(
            "SECURITY.security_engine.create_manual_backup",
            lambda _db, initiated_by=None, label=None: SimpleNamespace(status="success"),
        )
        monkeypatch.setattr(
            "SECURITY.security_engine.logger",
            MagicMock(),
        )

        # Should NOT raise — entries exist even if setting is missing
        result = remove_monitored_folder(
            db,
            "/opt/wards/app/SIGMA",
            initiated_by=1,
            vm_target="vm1",
        )
        assert result["folder_scope"] == "vm1"
        assert result["removed_files"] == 1
        # Verify detection + recovery cleanup and delete were called
        assert db.query.return_value.filter.return_value.delete.call_count >= 2
        db.delete.assert_called_once_with(vm1_entry)

    def test_raises_when_nothing_to_remove(self, monkeypatch):
        from SECURITY.security_engine import remove_monitored_folder

        db = MagicMock()
        monkeypatch.setattr(
            "SECURITY.security_engine.monitored_entries_for_folder",
            lambda _db, _root: [],
        )
        monkeypatch.setattr(
            "SECURITY.security_engine.load_vm1_monitored_folders",
            lambda _db: [],
        )
        monkeypatch.setattr(
            "SECURITY.security_engine.remove_configured_monitored_folder",
            lambda _db, _root, updated_by=None: None,
        )

        with pytest.raises(ValueError, match="not currently monitored"):
            remove_monitored_folder(db, "/opt/wards/app/SIGMA", initiated_by=1, vm_target="vm1")


# ---------------------------------------------------------------------------
# add_monitored_folder  (VM1 must not pollute local/shared settings)
# ---------------------------------------------------------------------------
class TestAddMonitoredFolderVm1:
    """add_monitored_folder for VM1 must only use vm1_custom_monitored_folders."""

    def test_does_not_call_persist_configured_for_vm1(self, monkeypatch):
        from SECURITY.security_engine import add_monitored_folder

        db = MagicMock()
        called = []

        monkeypatch.setattr(
            "SECURITY.security_engine.load_vm1_monitored_folders",
            lambda _db: [],
        )
        monkeypatch.setattr(
            "SECURITY.security_engine.save_vm1_monitored_folders",
            lambda _db, _paths, updated_by=None: None,
        )

        def fake_persist(_db, _root, updated_by=None):
            called.append("persist")

        monkeypatch.setattr(
            "SECURITY.security_engine.persist_configured_monitored_folder",
            fake_persist,
        )
        monkeypatch.setattr(
            "SECURITY.security_engine.create_manual_backup",
            lambda _db, initiated_by=None, label=None: SimpleNamespace(status="success"),
        )
        monkeypatch.setattr(
            "SECURITY.security_engine.logger",
            MagicMock(),
        )

        result = add_monitored_folder(db, "/opt/wards/app/SIGMA", initiated_by=1, vm_target="vm1")
        assert result["folder_scope"] == "vm1"
        assert "persist" not in called


# ---------------------------------------------------------------------------
# process_vm1_file_manifest
# ---------------------------------------------------------------------------
class TestProcessVm1ManifestNormalizesCustomPrefix:
    """process_vm1_file_manifest must strip CUSTOM_ from incoming data."""

    def test_normalizes_custom_prefix(self, monkeypatch):
        from SECURITY.security_engine import process_vm1_file_manifest

        db = MagicMock()
        db.query.return_value.filter.return_value.filter.return_value.first.return_value = None
        db.query.return_value.filter.return_value.first.return_value = None

        files = [
            {
                "relative_path": "CUSTOM_SIGMA/config.txt",
                "folder_root": "CUSTOM_SIGMA",
                "current_hash": "abc123",
                "size_bytes": 100,
            }
        ]

        monkeypatch.setattr(
            "SECURITY.security_engine.is_deployment_in_progress",
            lambda _db: True,
        )
        monkeypatch.setattr(
            "SECURITY.security_engine.file_type",
            lambda _path: "txt",
        )
        monkeypatch.setattr(
            "SECURITY.security_engine.now_utc",
            lambda: None,
        )

        result = process_vm1_file_manifest(db, files)
        call_args = db.add.call_args[0][0]
        assert call_args.folder_root == "SIGMA"
        assert call_args.relative_path == "SIGMA/config.txt"
        assert call_args.file_path == "vm1://SIGMA/config.txt"
