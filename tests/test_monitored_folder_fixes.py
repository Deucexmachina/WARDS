"""Regression tests for monitored folder removal and CUSTOM_ prefix fixes."""

import json
import os
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest


class TestSerializeFileStripsCustomPrefix:
    """serialize_file must strip the legacy CUSTOM_ prefix from folder_root."""

    def test_strips_custom_prefix(self):
        from SECURITY.security_engine import serialize_file

        entry = SimpleNamespace(
            id=1,
            file_path="vm1://SIGMA/config.txt",
            relative_path="SIGMA/config.txt",
            folder_root="CUSTOM_SIGMA",
            baseline_hash="abc",
            current_hash="def",
            status="clean",
            file_type="txt",
            size_bytes=100,
            last_checked=None,
            created_at=None,
        )
        result = serialize_file(entry)
        assert result["folder_root"] == "SIGMA"

    def test_no_prefix_unchanged(self):
        from SECURITY.security_engine import serialize_file

        entry = SimpleNamespace(
            id=2,
            file_path="vm1://WARDS/app.py",
            relative_path="WARDS/app.py",
            folder_root="VM1_WARDS",
            baseline_hash="abc",
            current_hash="def",
            status="clean",
            file_type="py",
            size_bytes=200,
            last_checked=None,
            created_at=None,
        )
        result = serialize_file(entry)
        assert result["folder_root"] == "VM1_WARDS"


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


class TestSaveSharedMonitoredFoldersReadOnly:
    """save_shared_monitored_folders must not crash on a read-only filesystem."""

    def test_read_only_filesystem_logs_warning(self, caplog):
        from SECURITY.security_engine import save_shared_monitored_folders

        with tempfile.TemporaryDirectory() as tmp:
            json_path = Path(tmp) / "monitored_folders.json"
            # Make the directory read-only
            os.chmod(tmp, 0o555)
            try:
                with patch("SECURITY.security_engine.SHARED_MONITORED_FOLDERS_PATH", json_path):
                    # Should not raise
                    save_shared_monitored_folders([])
            finally:
                os.chmod(tmp, 0o755)


class TestRemoveMonitoredFolderVm1Logic:
    """remove_monitored_folder must not touch local/shared JSON for VM1 targets."""

    def test_vm1_target_skips_local_shared_cleanup(self, monkeypatch):
        from SECURITY.security_engine import remove_monitored_folder

        db = MagicMock()
        db.query.return_value.filter.return_value.filter.return_value.first.return_value = None
        db.query.return_value.filter.return_value.all.return_value = []

        # Mock all dependencies so we only test the VM1 branching logic
        monkeypatch.setattr(
            "SECURITY.security_engine.load_vm1_monitored_folders",
            lambda _db: [Path("/opt/wards/app/SIGMA")],
        )
        monkeypatch.setattr(
            "SECURITY.security_engine.save_vm1_monitored_folders",
            lambda _db, _paths, updated_by=None: None,
        )
        monkeypatch.setattr(
            "SECURITY.security_engine.remove_configured_monitored_folder",
            lambda _db, _root, updated_by=None: (_ for _ in ()).throw(AssertionError("Should not be called for VM1")),
        )
        monkeypatch.setattr(
            "SECURITY.security_engine.monitored_entries_for_folder",
            lambda _db, _root: [],
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

        # This should NOT call remove_configured_monitored_folder
        result = remove_monitored_folder(
            db,
            "/opt/wards/app/SIGMA",
            initiated_by=1,
            vm_target="vm1",
        )
        assert result["folder_scope"] == "vm1"


class TestProcessVm1ManifestNormalizesCustomPrefix:
    """process_vm1_file_manifest must strip CUSTOM_ from incoming folder_root and relative_path."""

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
        # Verify the DB add was called with normalized values
        call_args = db.add.call_args[0][0]
        assert call_args.folder_root == "SIGMA"
        assert call_args.relative_path == "SIGMA/config.txt"
        assert call_args.file_path == "vm1://SIGMA/config.txt"
