import tempfile
from pathlib import Path
from types import SimpleNamespace

from SECURITY.security_engine import (
    AIPrediction,
    BACKUP_MANIFEST_NAME,
    MODEL_METADATA_PATH,
    MODEL_STATE_PATH,
    backup_ml_artifacts,
    record_detection,
    prune_backup_type,
    should_create_incident,
    scan_single_file,
    update_wazuh_monitored_folder,
    validate_backup_destination,
)
from SECURITY.wazuh_admin_helper import validate_config_path


def test_validate_backup_destination_requires_absolute_path():
    try:
        validate_backup_destination("relative/backups")
    except ValueError as exc:
        assert "absolute filesystem path" in str(exc)
    else:
        raise AssertionError("Expected ValueError for non-absolute backup path")


def test_prune_backup_type_keeps_newest_completed_backups():
    with tempfile.TemporaryDirectory() as tmp_dir:
        root = Path(tmp_dir)
        for idx in range(4):
            folder = root / f"manual_backup_20240101_00000{idx}"
            folder.mkdir()
            (folder / BACKUP_MANIFEST_NAME).write_text("{}", encoding="utf-8")
        incomplete = root / "manual_backup_20240101_999999"
        incomplete.mkdir()

        removed = prune_backup_type(root, "manual", keep=2)

        remaining = sorted(item.name for item in root.iterdir() if item.is_dir())
        # All backup folders (completed + incomplete) are now counted for retention,
        # so 5 total - keep 2 = 3 removed
        assert removed == 3
        assert "manual_backup_20240101_000003" in remaining
        assert "manual_backup_20240101_999999" in remaining


def test_update_wazuh_monitored_folder_writes_directory_entry():
    with tempfile.TemporaryDirectory() as tmp_dir:
        config_path = Path(tmp_dir) / "ossec.conf"
        target = Path(tmp_dir) / "watched"
        target.mkdir()

        changed = update_wazuh_monitored_folder(target, "add", config_path=config_path)

        content = config_path.read_text(encoding="utf-8")
        assert changed is True
        assert str(target) in content


def test_backup_ml_artifacts_adds_model_files_to_manifest(monkeypatch):
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_root = Path(tmp_dir)
        model_state = tmp_root / MODEL_STATE_PATH.name
        model_meta = tmp_root / MODEL_METADATA_PATH.name
        model_state.write_text('{"ok":true}', encoding="utf-8")
        model_meta.write_text('{"version":"v1"}', encoding="utf-8")

        monkeypatch.setattr("SECURITY.security_engine.MODEL_STATE_PATH", model_state)
        monkeypatch.setattr("SECURITY.security_engine.MODEL_METADATA_PATH", model_meta)

        manifest_files = []
        copied = backup_ml_artifacts(tmp_root / "backup", manifest_files)

        backed_up_paths = {item["path"] for item in manifest_files}
        assert copied == 2
        assert "SECURITY/ml/isolation_forest_state.json" in backed_up_paths
        assert "SECURITY/ml/isolation_forest_metadata.json" in backed_up_paths


def test_wazuh_helper_rejects_non_ossec_targets():
    try:
        validate_config_path(Path("C:/temp/not-ossec.txt"))
    except ValueError as exc:
        assert "Only ossec.conf can be modified" in str(exc)
    else:
        raise AssertionError("Expected helper to reject non-ossec.conf targets")


def test_should_create_incident_for_malicious_or_high_risk_cases():
    benign = AIPrediction("normal", 0.2, 0.9, "benign")
    malicious = AIPrediction("malicious", 0.95, 0.98, "attack")

    assert should_create_incident("file_deleted", benign, [], {"cvss_score": 0}) is True
    assert should_create_incident("content_modified", malicious, [], {"cvss_score": 1}) is True
    assert should_create_incident("content_modified", benign, ["script_injection"], {"cvss_score": 1}) is True
    assert should_create_incident("content_modified", benign, [], {"cvss_score": 7.5}) is True
    assert should_create_incident("content_modified", benign, [], {"cvss_score": 2.0}) is False


def test_record_detection_creates_incident_and_quarantine(monkeypatch):
    class DummyDb:
        def __init__(self):
            self.added = []

        def add(self, obj):
            self.added.append(obj)

        def commit(self):
            return None

        def refresh(self, obj):
            if getattr(obj, "id", None) is None:
                obj.id = 99

        def query(self, _model):
            return SimpleNamespace(
                join=lambda *_a, **_kw: SimpleNamespace(
                    filter=lambda *_a, **_kw: SimpleNamespace(first=lambda: None)
                )
            )

    db = DummyDb()
    file_entry = SimpleNamespace(
        id=7,
        file_path="C:/repo/suspicious.py",
        relative_path="sigma/suspicious.py",
    )
    calls = {"incident": 0, "alert": 0, "recovery": 0}

    monkeypatch.setattr("SECURITY.security_engine.enrich_security_context", lambda _db, context: dict(context))
    monkeypatch.setattr("SECURITY.security_engine.recent_admin_change", lambda _db, _path: None)
    monkeypatch.setattr("SECURITY.security_engine.get_ai_rules", lambda _db: {})
    monkeypatch.setattr("SECURITY.security_engine.ai_predict", lambda *_args, **_kwargs: AIPrediction("malicious", 0.97, 0.98, "test"))
    monkeypatch.setattr("SECURITY.security_engine.content_flags", lambda *_args, **_kwargs: ["script_injection"])
    monkeypatch.setattr(
        "SECURITY.security_engine.classify",
        lambda *_args, **_kwargs: {
            "incident_type": "code_tamper",
            "severity_level": "high",
            "cvss_score": 9.1,
            "cvss_vector": "AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
            "nist_category": "CAT 1",
            "enisa_threat_type": "malware",
        },
    )
    monkeypatch.setattr("SECURITY.security_engine.diff_lines", lambda *_args, **_kwargs: {"added": ["evil"], "removed": []})
    monkeypatch.setattr("SECURITY.security_engine.portable_monitored_path", lambda _entry: Path("C:/repo/suspicious.py"))
    monkeypatch.setattr("SECURITY.security_engine.quarantine_file", lambda _path, detection_id: f"QUARANTINE/detection_{detection_id}/suspicious.py")
    monkeypatch.setattr(
        "SECURITY.security_engine.create_incident",
        lambda *_args, **_kwargs: SimpleNamespace(id=5, response_action="monitoring"),
    )
    monkeypatch.setattr(
        "SECURITY.security_engine.restore_from_backup",
        lambda *_args, **_kwargs: calls.__setitem__("recovery", calls["recovery"] + 1) or SimpleNamespace(status="success"),
    )
    monkeypatch.setattr(
        "SECURITY.security_engine.create_incident_system_alert",
        lambda *_args, **_kwargs: calls.__setitem__("alert", calls["alert"] + 1),
    )

    detection = record_detection(
        db,
        file_entry,
        "content_modified",
        old_hash="old",
        new_hash="new",
        old_content="safe",
        new_content="evil",
        context={"source_ip": "127.0.0.1"},
    )

    assert detection.id == 99
    assert detection.ai_prediction == "malicious"
    assert calls["recovery"] == 1
    assert calls["alert"] == 1


def test_record_detection_logs_alert_when_no_incident(monkeypatch):
    class DummyDb:
        def add(self, _obj):
            return None

        def commit(self):
            return None

        def refresh(self, obj):
            if getattr(obj, "id", None) is None:
                obj.id = 123

        def query(self, _model):
            return SimpleNamespace(
                join=lambda *_a, **_kw: SimpleNamespace(
                    filter=lambda *_a, **_kw: SimpleNamespace(first=lambda: None)
                )
            )

    db = DummyDb()
    file_entry = SimpleNamespace(
        id=4,
        file_path="C:/repo/note.txt",
        relative_path="sigma/note.txt",
    )
    alert_calls = []

    monkeypatch.setattr("SECURITY.security_engine.enrich_security_context", lambda _db, context: dict(context))
    monkeypatch.setattr("SECURITY.security_engine.recent_admin_change", lambda _db, _path: None)
    monkeypatch.setattr("SECURITY.security_engine.get_ai_rules", lambda _db: {})
    monkeypatch.setattr("SECURITY.security_engine.ai_predict", lambda *_args, **_kwargs: AIPrediction("normal", 0.1, 0.95, "safe"))
    monkeypatch.setattr("SECURITY.security_engine.content_flags", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(
        "SECURITY.security_engine.classify",
        lambda *_args, **_kwargs: {
            "incident_type": "informational",
            "severity_level": "low",
            "cvss_score": 1.0,
            "cvss_vector": "AV:L/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N",
            "nist_category": "CAT 4",
            "enisa_threat_type": "low_risk_change",
        },
    )
    monkeypatch.setattr("SECURITY.security_engine.diff_lines", lambda *_args, **_kwargs: {"added": ["ok"], "removed": []})
    monkeypatch.setattr("SECURITY.security_engine.portable_monitored_path", lambda _entry: Path("C:/repo/note.txt"))
    monkeypatch.setattr("SECURITY.security_engine.create_system_alert", lambda *_args, **_kwargs: alert_calls.append("alert"))

    detection = record_detection(
        db,
        file_entry,
        "content_modified",
        old_hash="old",
        new_hash="new",
        old_content="before",
        new_content="after",
        context={"source_ip": "127.0.0.1"},
    )

    assert detection.id == 123
    assert detection.ai_prediction == "normal"
    assert alert_calls == ["alert"]


def test_scan_single_file_reports_deletion(monkeypatch):
    class DummyDb:
        def add(self, _obj):
            return None

        def commit(self):
            return None

        def flush(self):
            return None

    file_entry = SimpleNamespace(
        id=8,
        file_path="C:/repo/missing.txt",
        relative_path="sigma/missing.txt",
        current_hash="abc",
        status="clean",
        last_checked=None,
    )
    detection_calls = []

    monkeypatch.setattr("SECURITY.security_engine.is_database_entry", lambda _entry: False)
    monkeypatch.setattr("SECURITY.security_engine.portable_monitored_path", lambda _entry: Path("C:/definitely/missing.txt"))
    monkeypatch.setattr("SECURITY.security_engine.latest_backup_root", lambda _db: None)
    monkeypatch.setattr(
        "SECURITY.security_engine.record_detection",
        lambda *_args, **_kwargs: detection_calls.append(_args[2]) or {"change_type": _args[2]},
    )

    result = scan_single_file(DummyDb(), file_entry, context={"manual_scan": True})

    assert result == {"change_type": "file_deleted"}
    assert file_entry.status == "missing"
    assert detection_calls == ["file_deleted"]
