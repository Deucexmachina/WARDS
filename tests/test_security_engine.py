import tempfile
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

from SECURITY.security_engine import (
    AIPrediction,
    BACKUP_MANIFEST_NAME,
    IFOREST_META_PATH,
    IFOREST_MODEL_PATH,
    MODEL_METADATA_PATH,
    MODEL_STATE_PATH,
    RECOVERY_DOMAIN_FILES,
    RECOVERY_DOMAIN_ML,
    RECOVERY_DOMAIN_VM2_DATABASE,
    _get_cached_model,
    all_backup_roots,
    behavioral_score_from_profile,
    backup_ml_artifacts,
    backup_folder_sort_key,
    build_feature_vector,
    compute_profile_confidence,
    content_flags,
    full_system_recovery,
    load_isolation_forest_metadata,
    list_backup_inventory,
    ml_anomaly_score,
    newest_valid_backup_for_domain,
    newest_valid_backup_for_path,
    record_detection,
    prune_backup_type,
    restore_ml_artifacts_from_backup,
    retrain_ai,
    seed_initial_ai_training,
    set_backup_location,
    should_create_incident,
    scan_single_file,
    train_isolation_forest,
    update_wazuh_monitored_folder,
    validate_backup_destination,
    write_backup_manifest,
    ai_predict,
)
from SECURITY.security_models import (
    SecurityAdminFileChange,
    SecurityDetectionEvent,
    SecurityMonitoredFile,
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


def test_prune_backup_type_is_per_label():
    with tempfile.TemporaryDirectory() as tmp_dir:
        root = Path(tmp_dir)
        for idx in range(12):
            manual = root / f"manual_backup_20240101_0000{idx:02d}"
            full = root / f"full_backup_20240101_0000{idx:02d}"
            manual.mkdir()
            full.mkdir()

        removed = prune_backup_type(root, "manual", keep=10)

        manual_remaining = sorted(item.name for item in root.iterdir() if item.name.startswith("manual_backup_"))
        full_remaining = sorted(item.name for item in root.iterdir() if item.name.startswith("full_backup_"))
        assert removed == 2
        assert len(manual_remaining) == 10
        assert len(full_remaining) == 12


def test_all_backup_roots_sorts_by_folder_timestamp_across_locations(monkeypatch, tmp_path):
    configured = tmp_path / "z_configured"
    fallback = tmp_path / "a_fallback"
    configured.mkdir()
    fallback.mkdir()
    older = configured / "manual_backup_20260628_120000"
    newer = fallback / "manual_backup_20260629_120000"
    older.mkdir()
    newer.mkdir()

    monkeypatch.setattr("SECURITY.security_engine.get_setting", lambda _db, key, default="": str(configured) if key == "backup_location" else default)
    monkeypatch.setattr("SECURITY.security_engine.DEFAULT_BACKUP_ROOT", fallback)

    roots = all_backup_roots(SimpleNamespace())

    assert roots[:2] == [newer, older]
    assert backup_folder_sort_key(newer) > backup_folder_sort_key(older)


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
        iforest_meta = tmp_root / IFOREST_META_PATH.name
        iforest_model = tmp_root / IFOREST_MODEL_PATH.name
        model_state.write_text('{"ok":true}', encoding="utf-8")
        model_meta.write_text('{"version":"v1"}', encoding="utf-8")
        iforest_meta.write_text('{"version":"iforest-v1"}', encoding="utf-8")
        iforest_model.write_bytes(b"model")

        monkeypatch.setattr("SECURITY.security_engine.MODEL_STATE_PATH", model_state)
        monkeypatch.setattr("SECURITY.security_engine.MODEL_METADATA_PATH", model_meta)
        monkeypatch.setattr("SECURITY.security_engine.IFOREST_META_PATH", iforest_meta)
        monkeypatch.setattr("SECURITY.security_engine.IFOREST_MODEL_PATH", iforest_model)

        manifest_files = []
        copied = backup_ml_artifacts(tmp_root / "backup", manifest_files)

        backed_up_paths = {item["path"] for item in manifest_files}
        assert copied == 4
        assert "SECURITY/ml/isolation_forest_state.json" in backed_up_paths
        assert "SECURITY/ml/isolation_forest_metadata.json" in backed_up_paths
        assert "SECURITY/ml_models/isolation_forest.pkl" in backed_up_paths
        assert "SECURITY/ml_models/model_metadata.json" in backed_up_paths


def test_backup_ml_artifacts_skips_disappeared_artifact(monkeypatch, tmp_path):
    missing = tmp_path / "isolation_forest.pkl"
    monkeypatch.setattr("SECURITY.security_engine.iter_model_artifact_paths", lambda: [missing])

    manifest_files = []
    copied = backup_ml_artifacts(tmp_path / "backup", manifest_files)

    assert copied == 0
    assert manifest_files == []


def test_restore_ml_artifacts_restores_json_and_isolation_forest(monkeypatch, tmp_path):
    backup_root = tmp_path / "backup"
    backup_state = backup_root / "SECURITY" / "ml" / "isolation_forest_state.json"
    backup_meta = backup_root / "SECURITY" / "ml" / "isolation_forest_metadata.json"
    backup_iforest_meta = backup_root / "SECURITY" / "ml_models" / "model_metadata.json"
    backup_iforest_model = backup_root / "SECURITY" / "ml_models" / "isolation_forest.pkl"
    backup_state.parent.mkdir(parents=True)
    backup_iforest_meta.parent.mkdir(parents=True)
    backup_state.write_text('{"state":true}', encoding="utf-8")
    backup_meta.write_text('{"profile":true}', encoding="utf-8")
    backup_iforest_meta.write_text('{"iforest":true}', encoding="utf-8")
    backup_iforest_model.write_bytes(b"pkl")
    write_backup_manifest(backup_root)

    dest_root = tmp_path / "dest"
    monkeypatch.setattr("SECURITY.security_engine.all_backup_roots", lambda _db: [backup_root])
    monkeypatch.setattr("SECURITY.security_engine.MODEL_STATE_PATH", dest_root / "ml" / "isolation_forest_state.json")
    monkeypatch.setattr("SECURITY.security_engine.MODEL_METADATA_PATH", dest_root / "ml" / "isolation_forest_metadata.json")
    monkeypatch.setattr("SECURITY.security_engine.IFOREST_META_PATH", dest_root / "ml_models" / "model_metadata.json")
    monkeypatch.setattr("SECURITY.security_engine.IFOREST_MODEL_PATH", dest_root / "ml_models" / "isolation_forest.pkl")
    monkeypatch.setattr("SECURITY.security_engine._ml_model_cache", {"model": object(), "mtime": 123.0})

    restored = restore_ml_artifacts_from_backup(SimpleNamespace())

    assert restored == 4
    assert (dest_root / "ml" / "isolation_forest_state.json").exists()
    assert (dest_root / "ml" / "isolation_forest_metadata.json").exists()
    assert (dest_root / "ml_models" / "model_metadata.json").exists()
    assert (dest_root / "ml_models" / "isolation_forest.pkl").read_bytes() == b"pkl"


def test_backup_manifest_records_recovery_domains(tmp_path):
    backup_root = tmp_path / "full_backup_20260601_000000"
    app_file = backup_root / "WARDS" / "backend" / "main.py"
    db_file = backup_root / "DATABASE" / "wards_db_snapshot.json"
    ml_file = backup_root / "SECURITY" / "ml_models" / "isolation_forest.pkl"
    app_file.parent.mkdir(parents=True)
    db_file.parent.mkdir(parents=True)
    ml_file.parent.mkdir(parents=True)
    app_file.write_text("app", encoding="utf-8")
    db_file.write_text("db", encoding="utf-8")
    ml_file.write_bytes(b"ml")

    manifest_path = write_backup_manifest(backup_root)
    manifest = __import__("json").loads(manifest_path.read_text(encoding="utf-8"))
    by_path = {item["path"]: item for item in manifest["files"]}

    assert by_path["WARDS/backend/main.py"]["domain"] == RECOVERY_DOMAIN_FILES
    assert by_path["DATABASE/wards_db_snapshot.json"]["domain"] == RECOVERY_DOMAIN_VM2_DATABASE
    assert by_path["SECURITY/ml_models/isolation_forest.pkl"]["domain"] == RECOVERY_DOMAIN_ML
    assert set(manifest["recovery_domains"]) == {RECOVERY_DOMAIN_FILES, RECOVERY_DOMAIN_VM2_DATABASE, RECOVERY_DOMAIN_ML}


def test_newest_valid_backup_for_domain_selects_granular_over_older_full(monkeypatch, tmp_path):
    full_root = tmp_path / "full_backup_20260620_000000"
    granular_root = tmp_path / "ml_backup_20260627_000000"
    full_ml = full_root / "SECURITY" / "ml_models" / "isolation_forest.pkl"
    granular_ml = granular_root / "SECURITY" / "ml_models" / "isolation_forest.pkl"
    full_ml.parent.mkdir(parents=True)
    granular_ml.parent.mkdir(parents=True)
    full_ml.write_bytes(b"old")
    granular_ml.write_bytes(b"new")
    write_backup_manifest(full_root)
    write_backup_manifest(granular_root)
    monkeypatch.setattr("SECURITY.security_engine.all_backup_roots", lambda _db: [granular_root, full_root])

    selected = newest_valid_backup_for_domain(SimpleNamespace(), RECOVERY_DOMAIN_ML)
    source, source_root = newest_valid_backup_for_path(SimpleNamespace(), "SECURITY/ml_models/isolation_forest.pkl")

    assert selected == granular_root
    assert source_root == granular_root
    assert source.read_bytes() == b"new"


def test_newest_valid_backup_for_domain_skips_corrupted_newer_backup(monkeypatch, tmp_path):
    newer_root = tmp_path / "ml_backup_20260627_000000"
    older_root = tmp_path / "ml_backup_20260626_000000"
    newer_ml = newer_root / "SECURITY" / "ml_models" / "isolation_forest.pkl"
    older_ml = older_root / "SECURITY" / "ml_models" / "isolation_forest.pkl"
    newer_ml.parent.mkdir(parents=True)
    older_ml.parent.mkdir(parents=True)
    newer_ml.write_bytes(b"new")
    older_ml.write_bytes(b"old")
    write_backup_manifest(newer_root)
    write_backup_manifest(older_root)
    newer_ml.write_bytes(b"tampered")
    manifest_path = newer_root / BACKUP_MANIFEST_NAME
    manifest = __import__("json").loads(manifest_path.read_text(encoding="utf-8"))
    manifest["files"][0]["sha256"] = __import__("hashlib").sha256(b"tampered").hexdigest()
    manifest["files"][0]["size_bytes"] = len(b"tampered")
    manifest_path.write_text(__import__("json").dumps(manifest), encoding="utf-8")
    monkeypatch.setattr("SECURITY.security_engine.all_backup_roots", lambda _db: [newer_root, older_root])

    selected = newest_valid_backup_for_domain(SimpleNamespace(), RECOVERY_DOMAIN_ML)
    source, source_root = newest_valid_backup_for_path(SimpleNamespace(), "SECURITY/ml_models/isolation_forest.pkl")

    assert selected == older_root
    assert source_root == older_root
    assert source.read_bytes() == b"old"


def test_build_feature_vector_is_deterministic():
    log = {"hour_of_day": 14, "day_of_week": 2, "source_ip": "192.168.1.1", "file_path": "/tmp/test.py"}
    v1 = build_feature_vector(log)
    v2 = build_feature_vector(log)
    assert v1 == v2
    assert len(v1) == 28


def test_build_feature_vector_preserves_zero_over_fallback_values():
    vector = build_feature_vector(
        {
            "hour_of_day": 10,
            "day_of_week": 1,
            "file_path": "/tmp/test.py",
            "geo_distance_from_last_login_km": 0.0,
            "geo_distance_km": 900.0,
            "keystroke_dynamics": 0.0,
            "keystroke_anomaly_confidence": 0.8,
            "admin_action_rarity": 0.0,
            "admin_action_rarity_score": 0.5,
            "restore_frequency": 0,
            "restore_count": 3,
            "affected_files_count": 0,
            "modified_file_count": 5,
        }
    )

    assert vector[11] == 0.0
    assert vector[19] == 0.0
    assert vector[25] == 0.0
    assert vector[26] == 0.0
    assert vector[27] == 0.0


def test_build_feature_vector_sanitizes_nan_and_inf_values():
    vector = build_feature_vector(
        {
            "hour_of_day": 10,
            "day_of_week": 1,
            "file_path": "/tmp/test.py",
            "keystroke_dynamics": float("nan"),
            "admin_action_rarity": float("inf"),
            "geo_distance_from_last_login": float("-inf"),
        }
    )

    assert vector[11] == 0.0
    assert vector[19] == 0.0
    assert vector[25] == 0.0


def test_train_isolation_forest_creates_pkl(monkeypatch, tmp_path):
    if not getattr(__import__("SECURITY.security_engine", fromlist=["_SKLEARN_AVAILABLE"]), "_SKLEARN_AVAILABLE"):
        return
    monkeypatch.setattr("SECURITY.security_engine.ML_MODELS_DIR", tmp_path / "ml_models")
    monkeypatch.setattr("SECURITY.security_engine.IFOREST_MODEL_PATH", tmp_path / "ml_models" / "isolation_forest.pkl")
    monkeypatch.setattr("SECURITY.security_engine.IFOREST_META_PATH", tmp_path / "ml_models" / "model_metadata.json")
    monkeypatch.setattr("SECURITY.security_engine._ml_model_cache", {"model": None, "mtime": 0.0})
    logs = [
        {"hour_of_day": 9 + (i % 9), "day_of_week": i % 5, "source_ip": f"1.1.1.{i}", "file_path": f"/tmp/{i}.py", "admin_session_valid": 1, "method_legitimate": 1}
        for i in range(20)
    ]
    model = train_isolation_forest(logs)
    assert model is not None
    assert (tmp_path / "ml_models" / "isolation_forest.pkl").exists()
    assert (tmp_path / "ml_models" / "model_metadata.json").exists()


def test_train_isolation_forest_sanitizes_non_finite_training_data(monkeypatch, tmp_path):
    if not getattr(__import__("SECURITY.security_engine", fromlist=["_SKLEARN_AVAILABLE"]), "_SKLEARN_AVAILABLE"):
        return
    monkeypatch.setattr("SECURITY.security_engine.ML_MODELS_DIR", tmp_path / "ml_models")
    monkeypatch.setattr("SECURITY.security_engine.IFOREST_MODEL_PATH", tmp_path / "ml_models" / "isolation_forest.pkl")
    monkeypatch.setattr("SECURITY.security_engine.IFOREST_META_PATH", tmp_path / "ml_models" / "model_metadata.json")
    monkeypatch.setattr("SECURITY.security_engine._ml_model_cache", {"model": None, "mtime": 0.0})
    logs = [
        {
            "hour_of_day": 9 + (i % 9),
            "day_of_week": i % 5,
            "source_ip": f"1.1.1.{i}",
            "file_path": f"/tmp/{i}.py",
            "admin_session_valid": 1,
            "method_legitimate": 1,
            "admin_action_rarity": float("nan") if i == 0 else 0.0,
            "geo_distance_from_last_login": float("inf") if i == 1 else 0.0,
        }
        for i in range(20)
    ]

    model = train_isolation_forest(logs)

    assert model is not None


def test_full_system_recovery_fails_when_required_domains_have_no_valid_backups(monkeypatch):
    class FakeDb:
        def add(self, _item):
            pass

        def commit(self):
            pass

        def refresh(self, item):
            item.id = 1

    monkeypatch.setattr("SECURITY.security_engine.newest_valid_backup_for_domain", lambda _db, _domain: None)
    monkeypatch.setattr("SECURITY.security_engine.create_system_alert", lambda *_args, **_kwargs: None)

    result = full_system_recovery(FakeDb(), admin_id=1)

    assert result["failed_domains"] >= 3
    assert result["restored_domains"] == 0


def test_ml_anomaly_score_returns_valid_range(monkeypatch, tmp_path):
    if not getattr(__import__("SECURITY.security_engine", fromlist=["_SKLEARN_AVAILABLE"]), "_SKLEARN_AVAILABLE"):
        return
    monkeypatch.setattr("SECURITY.security_engine.ML_MODELS_DIR", tmp_path / "ml_models")
    monkeypatch.setattr("SECURITY.security_engine.IFOREST_MODEL_PATH", tmp_path / "ml_models" / "isolation_forest.pkl")
    monkeypatch.setattr("SECURITY.security_engine.IFOREST_META_PATH", tmp_path / "ml_models" / "model_metadata.json")
    monkeypatch.setattr("SECURITY.security_engine._ml_model_cache", {"model": None, "mtime": 0.0})
    logs = [
        {"hour_of_day": i % 24, "day_of_week": i % 7, "source_ip": f"1.1.1.{i}", "file_path": f"/tmp/{i}.py", "admin_session_valid": 1, "method_legitimate": 1}
        for i in range(20)
    ]
    train_isolation_forest(logs)
    normal_score = ml_anomaly_score({"hour_of_day": 10, "day_of_week": 1, "source_ip": "1.1.1.5", "file_path": "/tmp/5.py", "admin_session_valid": 1})
    weird_score = ml_anomaly_score({"hour_of_day": 3, "day_of_week": 6, "source_ip": "9.9.9.9", "file_path": "/tmp/exotic.xyz", "admin_session_valid": 0, "vpn_activity": 1, "first_time_device": 1})
    assert 0.0 <= normal_score <= 1.0
    assert 0.0 <= weird_score <= 1.0


def test_get_cached_model_returns_none_when_model_disappears(monkeypatch):
    class DisappearingModelPath:
        def exists(self):
            return True

        def stat(self):
            raise FileNotFoundError("model disappeared")

    monkeypatch.setattr("SECURITY.security_engine.IFOREST_MODEL_PATH", DisappearingModelPath())
    monkeypatch.setattr("SECURITY.security_engine._JOBLIB_AVAILABLE", True)
    monkeypatch.setattr("SECURITY.security_engine._ml_model_cache", {"model": object(), "mtime": 123.0})

    assert _get_cached_model() is None


def test_compute_profile_confidence_ignores_disappearing_model(monkeypatch):
    class DisappearingModelPath:
        def exists(self):
            return True

        def stat(self):
            raise FileNotFoundError("model disappeared")

    monkeypatch.setattr("SECURITY.security_engine.IFOREST_MODEL_PATH", DisappearingModelPath())

    confidence = compute_profile_confidence({"sample_count": 50, "normal_hours": [9], "normal_weekdays": [1], "common_extensions": [".py"], "known_source_ips": ["127.0.0.1"]})

    assert confidence == 0.8


def test_load_isolation_forest_metadata_returns_empty_when_file_disappears(monkeypatch):
    class DisappearingMetaPath:
        def exists(self):
            return True

        def read_text(self, encoding="utf-8"):
            raise FileNotFoundError("metadata disappeared")

    monkeypatch.setattr("SECURITY.security_engine.IFOREST_META_PATH", DisappearingMetaPath())

    assert load_isolation_forest_metadata() == {}


def test_ml_anomaly_score_falls_back_when_cache_races(monkeypatch):
    monkeypatch.setattr("SECURITY.security_engine._NUMPY_AVAILABLE", True)
    monkeypatch.setattr("SECURITY.security_engine._SKLEARN_AVAILABLE", True)
    monkeypatch.setattr("SECURITY.security_engine._JOBLIB_AVAILABLE", True)
    monkeypatch.setattr("SECURITY.security_engine.IFOREST_MODEL_PATH", SimpleNamespace(exists=lambda: True))
    monkeypatch.setattr("SECURITY.security_engine._get_cached_model", lambda: (_ for _ in ()).throw(FileNotFoundError("gone")))

    assert ml_anomaly_score({"hour_of_day": 10}) == 0.0


def test_behavioral_score_from_profile_detects_anomalies():
    profile = {
        "sample_count": 10,
        "normal_hours": [9, 10, 11, 12, 13, 14],
        "normal_weekdays": [0, 1, 2, 3, 4],
        "common_extensions": [".py", ".js"],
        "known_source_ips": ["192.168.1.1"],
    }
    risk1, _notes1, warn1 = behavioral_score_from_profile(
        {"hour_of_day": 10, "day_of_week": 1, "file_path": "/app.py", "source_ip": "192.168.1.1"},
        profile,
    )
    assert risk1 == 0.0
    assert not warn1
    risk2, notes2, warn2 = behavioral_score_from_profile(
        {"hour_of_day": 3, "day_of_week": 1, "file_path": "/app.py", "source_ip": "192.168.1.1"},
        profile,
    )
    assert risk2 > 0.0
    assert warn2
    assert any("hour" in n for n in notes2)


def test_compute_profile_confidence_scales_with_samples(monkeypatch, tmp_path):
    monkeypatch.setattr("SECURITY.security_engine.IFOREST_MODEL_PATH", tmp_path / "fake.pkl")
    low = compute_profile_confidence({"sample_count": 1, "normal_hours": [9]})
    (tmp_path / "fake.pkl").write_bytes(b"model")
    high = compute_profile_confidence({"sample_count": 50, "normal_hours": [9], "known_source_ips": ["1.1.1.1"], "common_extensions": [".py"]})
    assert 0.0 <= low < high <= 1.0


def test_ai_predict_fallback_without_ml_model(monkeypatch):
    monkeypatch.setattr("SECURITY.security_engine.IFOREST_MODEL_PATH", Path("/nonexistent/model.pkl"))
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


def test_disabled_ai_rule_suppresses_matching_flag():
    rules = {
        **{key: {**value} for key, value in __import__("SECURITY.security_engine", fromlist=["DEFAULT_AI_RULES"]).DEFAULT_AI_RULES.items()},
        "suspicious_pattern_score": {"enabled": False, "config": {}},
    }

    flags = content_flags("<script>alert('x')</script>", {"ai_rules": rules}, path=Path("index.html"))

    assert "script_injection" not in flags


def test_content_flags_uses_enriched_event_time(monkeypatch):
    monkeypatch.setattr("SECURITY.security_engine.now_utc", lambda: datetime(2026, 6, 28, 22, 0, 0))

    flags = content_flags(
        "normal content",
        {"hour_of_day": 14, "day_of_week": 1},
        path=Path("notes.txt"),
    )

    assert "after_hours" not in flags
    assert "weekend_activity" not in flags


def test_content_flags_includes_path_based_ai_flags():
    flags = content_flags(
        "print('login update')",
        {"hour_of_day": 14, "day_of_week": 1, "method_legitimate": False},
        path=Path("WARDS/backend/auth/login.py"),
    )

    assert "unauthorized_admin_path" in flags
    assert "auth_system_modification" in flags


def test_disabled_path_ai_rule_suppresses_matching_flag():
    defaults = __import__("SECURITY.security_engine", fromlist=["DEFAULT_AI_RULES"]).DEFAULT_AI_RULES
    rules = {
        **{key: {**value} for key, value in defaults.items()},
        "auth_system_modification": {**defaults["auth_system_modification"], "enabled": False},
    }

    flags = content_flags(
        "print('login update')",
        {"ai_rules": rules, "hour_of_day": 14, "day_of_week": 1, "method_legitimate": False},
        path=Path("WARDS/backend/auth/login.py"),
    )

    assert "auth_system_modification" not in flags
    assert "unauthorized_admin_path" in flags


def test_content_flags_include_context_threshold_flags():
    flags = content_flags(
        "new safe content",
        {
            "hour_of_day": 14,
            "day_of_week": 1,
            "admin_action_rarity_score": 0.9,
            "restore_count": 3,
            "backup_integrity_valid": False,
            "content_similarity_score": 0.2,
            "affected_files_count": 3,
        },
        path=Path("WARDS/backend/main.py"),
    )

    assert "admin_action_rarity" in flags
    assert "restore_frequency" in flags
    assert "backup_integrity_validation" in flags
    assert "content_similarity_score" in flags
    assert "affected_files_count" in flags


def test_ai_predict_shares_similarity_flag_context_with_callers():
    context = {"hour_of_day": 14, "day_of_week": 1}

    ai_predict(Path("WARDS/backend/main.py"), "original application content", "x", context)
    flags = content_flags("x", context, path=Path("WARDS/backend/main.py"))

    assert "content_similarity_score" in flags


def test_list_backup_inventory_marks_latest_domain(monkeypatch, tmp_path):
    older = tmp_path / "manual_backup_20260101_010101"
    newer = tmp_path / "manual_backup_20260102_010101"
    older_file = older / "WARDS" / "backend" / "old.py"
    newer_file = newer / "WARDS" / "backend" / "new.py"
    older_file.parent.mkdir(parents=True)
    newer_file.parent.mkdir(parents=True)
    older_file.write_text("old", encoding="utf-8")
    newer_file.write_text("new", encoding="utf-8")
    write_backup_manifest(older)
    write_backup_manifest(newer)

    monkeypatch.setattr("SECURITY.security_engine.all_backup_roots", lambda _db: [newer, older])
    monkeypatch.setattr("SECURITY.security_engine.newest_valid_backup_for_domain", lambda _db, domain: newer if domain == RECOVERY_DOMAIN_FILES else None)

    inventory = list_backup_inventory(object())

    assert inventory["items"][0]["filename"] == newer.name
    assert RECOVERY_DOMAIN_FILES in inventory["items"][0]["latest_domains"]


def test_set_backup_location_skips_deleting_parent_of_new_location(monkeypatch, tmp_path):
    previous = tmp_path / "old_backups"
    target = previous / "nested_new_backups"
    previous.mkdir()
    (previous / "keep.txt").write_text("keep", encoding="utf-8")
    settings = {}

    monkeypatch.setattr("SECURITY.security_engine.get_setting", lambda *_args, **_kwargs: str(previous))
    monkeypatch.setattr("SECURITY.security_engine.set_setting", lambda _db, key, value, _actor: settings.__setitem__(key, value))
    monkeypatch.setattr("SECURITY.security_engine.create_manual_backup", lambda *_args, **_kwargs: SimpleNamespace(id=123))

    result = set_backup_location(object(), str(target), True, "test")

    assert previous.exists()
    assert target.exists()
    assert result["previous_deleted"] is False
    assert result["deletion_skipped_reason"] == "new backup location is inside the previous backup location"
    assert settings["backup_location"]


def test_seed_initial_ai_training_runs_once(monkeypatch, tmp_path):
    settings = {"ai_initial_training_seeded": "false"}
    captured_logs = []

    class Query:
        def filter(self, *_args, **_kwargs):
            return self

        def first(self):
            return None

    class Db:
        def query(self, _model):
            return Query()

        def add(self, _obj):
            pass

        def commit(self):
            pass

    def fake_train(logs):
        captured_logs.extend(logs)
        return object()

    def fake_get_setting(_db, key, default=""):
        return settings.get(key, default)

    def fake_set_setting(_db, key, value, _actor):
        settings[key] = value

    monkeypatch.setattr("SECURITY.security_engine.MODEL_STATE_PATH", tmp_path / "ml" / "isolation_forest_state.json")
    monkeypatch.setattr("SECURITY.security_engine.MODEL_METADATA_PATH", tmp_path / "ml" / "isolation_forest_metadata.json")
    monkeypatch.setattr("SECURITY.security_engine.IFOREST_MODEL_PATH", tmp_path / "ml_models" / "isolation_forest.pkl")
    monkeypatch.setattr("SECURITY.security_engine.IFOREST_META_PATH", tmp_path / "ml_models" / "model_metadata.json")
    monkeypatch.setattr("SECURITY.security_engine.load_initial_training_samples", lambda: [{"hour_of_day": 9, "day_of_week": 1, "file_path": "WARDS/backend/main.py", "source_ip": "seed"} for _ in range(12)])
    monkeypatch.setattr("SECURITY.security_engine.train_isolation_forest", fake_train)
    monkeypatch.setattr("SECURITY.security_engine.iter_model_artifact_paths", lambda: [])
    monkeypatch.setattr("SECURITY.security_engine.get_setting", fake_get_setting)
    monkeypatch.setattr("SECURITY.security_engine.set_setting", fake_set_setting)

    seeded = seed_initial_ai_training(Db(), initiated_by="test")
    skipped = seed_initial_ai_training(Db(), initiated_by="test")
    forced = seed_initial_ai_training(Db(), initiated_by="test", force=True)

    assert seeded["normal_samples"] == 12
    assert captured_logs
    assert settings["ai_initial_training_seeded"] == "true"
    assert skipped["status"] == "skipped"
    assert forced["normal_samples"] == 12
    assert len(captured_logs) == 24


def test_retrain_ai_admin_logs_are_full_ueba_vectors_and_hash_race_safe(monkeypatch, tmp_path):
    captured_logs = []
    artifact = tmp_path / "artifact.json"
    artifact.write_text("{}", encoding="utf-8")
    monitored_entry = SimpleNamespace(
        current_hash=None,
        baseline_hash=None,
        status="modified",
        last_checked=None,
    )
    admin_change = SecurityAdminFileChange(
        admin_id=1,
        file_path=str(tmp_path / "auth" / "login.py"),
        change_type="content_modified",
        ip_address="10.0.0.5",
        user_agent="Mozilla",
    )
    admin_change.timestamp = datetime(2026, 1, 5, 10, 0, 0)

    class Query:
        def __init__(self, rows):
            self.rows = rows

        def filter(self, *_args, **_kwargs):
            return self

        def order_by(self, *_args, **_kwargs):
            return self

        def limit(self, *_args, **_kwargs):
            return self

        def all(self):
            return self.rows

        def first(self):
            return self.rows[0] if self.rows else None

    class Db:
        def __init__(self):
            self.added = []

        def query(self, model):
            if model is SecurityAdminFileChange:
                return Query([admin_change])
            if model is SecurityDetectionEvent:
                return Query([])
            if model is SecurityMonitoredFile:
                return Query([monitored_entry])
            return Query([])

        def add(self, obj):
            self.added.append(obj)

        def commit(self):
            return None

    def fake_train(logs):
        captured_logs.extend(logs)
        return None

    monkeypatch.setattr("SECURITY.security_engine.MODEL_STATE_PATH", tmp_path / "ml" / "isolation_forest_state.json")
    monkeypatch.setattr("SECURITY.security_engine.MODEL_METADATA_PATH", tmp_path / "ml" / "isolation_forest_metadata.json")
    monkeypatch.setattr("SECURITY.security_engine.IFOREST_MODEL_PATH", tmp_path / "ml_models" / "isolation_forest.pkl")
    monkeypatch.setattr("SECURITY.security_engine.IFOREST_META_PATH", tmp_path / "ml_models" / "model_metadata.json")
    monkeypatch.setattr("SECURITY.security_engine.train_isolation_forest", fake_train)
    monkeypatch.setattr("SECURITY.security_engine.iter_model_artifact_paths", lambda: [artifact])
    monkeypatch.setattr("SECURITY.security_engine.sha256_file", lambda _path: (_ for _ in ()).throw(FileNotFoundError("gone")))
    monkeypatch.setattr("SECURITY.security_engine.set_setting", lambda *_args, **_kwargs: None)

    state = retrain_ai(Db(), initiated_by="test")

    assert "ml_model_trained" not in state
    assert "ml_model_path" not in state
    assert "ml_model_trained" in state["report"]
    assert "ml_model_path" in state["report"]
    assert captured_logs
    admin_log = captured_logs[0]
    for key in [
        "session_duration",
        "source_ip_reputation",
        "keystroke_dynamics",
        "vpn_activity",
        "first_time_device",
        "first_time_country",
        "geo_distance_from_last_login",
        "unauthorized_admin_path",
        "sensitive_config_change",
        "backup_restore_activity",
        "mfa_configuration_change",
        "auth_system_modification",
        "admin_action_rarity",
        "restore_frequency",
        "affected_files_count",
    ]:
        assert key in admin_log


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
        folder_root=None,
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
        folder_root=None,
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
