import gzip
import asyncio
import subprocess
import time
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from auth import USER_SECRET_KEY, create_access_token, create_refresh_token
from auth.jwt_utils import ALGORITHM
from middleware import dos_protection
from middleware.https import HttpsEnforcementMiddleware
from database import models as db_models
from database.models import ActivityLog, Backup, BranchSystemSetting, Service, SystemSetting
from routes import public
from routes import security_dashboard
from utils import backup_engine
from utils.background_jobs import BackgroundJobManager, RateLimitExceeded
from utils import security_client
from utils.file_validation import SafeFileType, validate_upload_file
from utils.request_signing import sign_request


def test_https_middleware_redirects_when_enabled(monkeypatch):
    monkeypatch.setenv("HTTPS_ONLY", "true")
    app = FastAPI()
    app.add_middleware(HttpsEnforcementMiddleware)

    @app.get("/")
    async def root():
        return {"ok": True}

    client = TestClient(app, base_url="http://wards.example")
    response = client.get("/", follow_redirects=False, headers={"x-forwarded-proto": "http"})

    assert response.status_code == 308
    assert response.headers["location"].startswith("https://wards.example/")


def test_security_timeout_exempts_long_running_routes():
    exempt = dos_protection.REQUEST_TIMEOUT_EXEMPT_PATHS
    assert any("/api/security/backup" in item for item in exempt)
    assert any("/api/security/recover" in item for item in exempt)
    assert any("/api/security/scan" in item for item in exempt)
    assert any("/api/security/files" in item for item in exempt)


def test_security_client_uses_long_timeout_for_background_operations(monkeypatch):
    calls = []
    monkeypatch.setattr(security_client, "SECURITY_API_URL", "http://security-api")

    def fake_post(path, payload=None, timeout=10.0):
        calls.append((path, timeout))
        return {"ok": True}

    monkeypatch.setattr(security_client, "_sync_post", fake_post)

    security_client.create_full_system_backup(None, 1)
    security_client.create_files_backup(None, 1)
    security_client.recover_files(None, 1)
    security_client.scan_single_file(None, SimpleNamespace(id=89686, relative_path=None), context={"manual_scan": True})
    security_client.manual_recover_file(None, 89686, 1)

    assert calls
    assert all(timeout >= 600.0 for _path, timeout in calls)


def test_security_api_rate_limit_awaits_async_endpoints():
    source = Path("SECURITY/api_main.py").read_text(encoding="utf-8")

    assert "py_inspect.iscoroutinefunction(func)" in source
    assert "async def async_wrapper" in source
    assert "return await func(*args, **kwargs)" in source


def test_background_job_manager_rejects_duplicate_active_job():
    manager = BackgroundJobManager()
    manager.set_rate_limit("security_full_backup", 0)

    manager.submit("security_full_backup")

    with pytest.raises(RateLimitExceeded, match="already pending or running"):
        manager.submit("security_full_backup")


def test_vm2_incident_resolve_path_route_exists():
    source = Path("SECURITY/api_main.py").read_text(encoding="utf-8")

    assert '@app.post("/v1/incidents/resolve"' in source
    assert '@app.post("/v1/incidents/{incident_id}/resolve"' in source


def test_vm2_rate_limit_allows_evaluation_bypass():
    source = Path("SECURITY/api_main.py").read_text(encoding="utf-8")

    assert 'request.headers.get("X-Evaluation-Run"' in source
    assert "eval_secret == ADMIN_SECRET" in source
    assert "return func(*args, **kwargs)" in source


def test_deployed_scan_file_returns_serialized_dict_without_double_serializing(monkeypatch):
    detection = {"id": 42, "change_type": "content_modified", "target_name": "WARDS/backend/main.py"}
    db = SimpleNamespace(add=lambda _item: None, commit=lambda: None)
    request = SimpleNamespace(client=SimpleNamespace(host="127.0.0.1"))
    admin = SimpleNamespace(username="admin")

    monkeypatch.setattr(security_dashboard, "SECURITY_API_URL", "https://security.example")
    monkeypatch.setattr(security_dashboard, "scan_single_file", lambda *_args, **_kwargs: detection)

    result = security_dashboard.scan_file(89686, request, db=db, admin=admin)

    assert result["detection"] is detection


def test_scan_result_normalizes_vm2_detection_response(monkeypatch):
    detection = {"id": 7, "change_type": "content_modified"}
    job = SimpleNamespace(
        id="job-1",
        type="security_full_scan",
        status=security_dashboard.JobStatus.COMPLETED,
        result={"detections": [detection]},
        error=None,
    )

    monkeypatch.setattr(security_dashboard.job_manager, "get", lambda _job_id: job)

    result = security_dashboard.scan_result("job-1", _=object())

    assert result["summary"] == "1 change(s) found."
    assert result["detections"] == [detection]


def test_request_signing_accepts_valid_signature(monkeypatch):
    monkeypatch.setenv("REQUIRE_INTERNAL_HMAC", "true")
    monkeypatch.setenv("INTERNAL_API_SECRET", "test-internal-secret")
    timestamp = str(time.time())
    body = b'{"amount":100}'

    app = FastAPI()
    from utils.request_signing import require_internal_signature

    @app.post("/signed")
    async def signed_endpoint(_ok=Depends(require_internal_signature)):
        return {"ok": True}

    client = TestClient(app)
    response = client.post(
        "/signed",
        data=body,
        headers={
            "x-request-timestamp": timestamp,
            "x-request-signature": sign_request(body, timestamp),
            "content-type": "application/json",
        },
    )

    assert response.status_code == 200


def test_backup_engine_creates_compressed_dump_with_checksum(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost:5432/wards")
    monkeypatch.setenv("BACKUP_DIR", str(tmp_path))

    def fake_run(command, stdout=None, stderr=None, check=False, stdin=None):
        assert command[0] in {"pg_dump", "psql"}
        if stdout:
            stdout.write(b"-- sql dump\n")
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(backup_engine.subprocess, "run", fake_run)
    result = backup_engine.create_database_backup()

    assert result.path.exists()
    assert result.db_type == "postgresql"
    assert result.checksum == backup_engine.sha256_file(result.path)
    with gzip.open(result.path, "rb") as handle:
        assert handle.read() == b"-- sql dump\n"


def test_unified_auth_uses_configured_session_timeout_for_cookie_jwt_and_redis():
    source = Path("WARDS/backend/routes/unified_auth.py").read_text(encoding="utf-8")

    assert "session_timeout_minutes = get_session_timeout_minutes(db)" in source
    assert "create_access_token(portal, token_payload, expires_minutes=session_timeout_minutes)" in source
    assert "set_auth_cookie(response, portal, access_token, max_age=session_timeout_minutes * 60)" in source
    assert "ttl = session_timeout_minutes * 60" in source


def test_frontend_global_error_modal_labels_session_expiration():
    source = Path("WARDS/frontend/src/services/api.js").read_text(encoding="utf-8")

    assert "const hasStoredPortalSession" in source
    assert "status === 401 && looksLikeAuthFailure" in source
    assert "status === 403" in source
    assert "loweredErrorDetail.includes('permission')" in source
    assert "title: isSessionExpirationError ? 'Session Expired'" in source


def test_backend_main_has_get_client_ip_import_fallback():
    source = Path("WARDS/backend/main.py").read_text(encoding="utf-8")

    assert "from middleware.dos_protection import RequestSizeMiddleware" in source
    assert "try:\n    from middleware.dos_protection import get_client_ip" in source
    assert "except ImportError:" in source
    assert "cf-connecting-ip" in source
    assert "x-forwarded-for" in source


def test_vm1_startup_does_not_manage_vm2_security_tables_when_proxying():
    main_source = Path("WARDS/backend/main.py").read_text(encoding="utf-8")
    integrity_source = Path("WARDS/backend/utils/log_integrity.py").read_text(encoding="utf-8")

    assert "def security_api_proxy_enabled" in main_source
    assert "SECURITY_TABLE_NAMES" in main_source
    assert "return [table for table in tables if table.name not in SECURITY_TABLE_NAMES]" in main_source
    assert "if security_api_proxy_enabled() and protected_table in SECURITY_TABLE_NAMES:" in main_source
    assert "SELECT GET_LOCK(:name, 30)" in main_source
    assert "is_concurrent_ddl_error" in main_source
    assert "if not _security_api_proxy_enabled():" in integrity_source
    assert "from SECURITY.security_models import" in integrity_source


def test_vm1_database_recovery_is_audited_to_vm2():
    vm1_source = Path("WARDS/backend/routes/security_dashboard.py").read_text(encoding="utf-8")
    client_source = Path("WARDS/backend/utils/security_client.py").read_text(encoding="utf-8")
    vm2_source = Path("SECURITY/api_main.py").read_text(encoding="utf-8")
    engine_source = Path("SECURITY/security_engine.py").read_text(encoding="utf-8")
    reporter_source = Path("scripts/vm1_security_reporter.py").read_text(encoding="utf-8")

    assert "def log_vm1_database_recovery" in client_source
    assert "/v1/vm1/database-recoveries/log" in client_source
    assert "_safe_log_vm1_database_recovery" in vm1_source
    assert "vm1_database_recovery" in vm2_source
    assert "api_log_vm1_database_recovery" in vm2_source
    assert "/v1/vm1/database/integrity" in vm2_source
    assert "process_vm1_database_integrity_report" in engine_source
    assert 'cmd.get("command_type") == "vm1_database_restore"' in reporter_source
    assert 'send_database_integrity_report(reason, force=reason == "forced")' in reporter_source
    assert '"unauthorized"' in reporter_source
    assert 'reason == "database_restore" and not suspicious' in engine_source
    assert "vm1_database_baseline_tainted" in engine_source


def test_manual_scan_marks_pending_risk_and_waits_for_vm1_db_integrity():
    vm2_source = Path("SECURITY/api_main.py").read_text(encoding="utf-8")
    vm1_source = Path("WARDS/backend/routes/security_dashboard.py").read_text(encoding="utf-8")
    dashboard_source = Path("SECURITY/security_engine.py").read_text(encoding="utf-8")

    assert 'recovery_type="security_scan_requested"' not in vm2_source
    assert 'set_setting(db, "security_scan_pending_since", force_token, "manual_scan")' in vm2_source
    assert 'set_setting(db, "vm1_database_integrity_status", "pending_scan", "manual_scan")' in vm2_source
    assert 'last_db_check = str(get_setting(db, "vm1_database_last_integrity_at", "") or "")' in vm2_source
    assert "last_manifest >= force_token and last_db_check >= force_token" in vm2_source
    assert 'set_setting(db, "security_scan_pending_since", scan_token, "manual_scan")' in vm1_source
    assert 'elif incidents:' in dashboard_source
    assert 'vm1_database_integrity_status in {"pending_scan", "restore_queued"}' not in dashboard_source


def test_vm1_file_restore_ack_updates_state_without_extra_history_rows():
    engine_source = Path("SECURITY/security_engine.py").read_text(encoding="utf-8")

    assert 'recovery_type="vm1_file_auto_restore"' not in engine_source
    assert "VM1 reporter acknowledged automatic restore" not in engine_source
    assert "VM1 reporter failed to apply file restore command" in engine_source
    assert "VM1 restore command queued for" not in engine_source
    assert "file_entry.status = \"clean\"" in engine_source


def test_vm1_repeat_hash_with_content_uses_normal_detection_flow():
    engine_source = Path("SECURITY/security_engine.py").read_text(encoding="utf-8")

    assert "hash-only deferral stores the modified hash as current" in engine_source
    assert "not open_incident_exists and content_supplied and new_content.strip()" in engine_source
    assert '_record_vm1_detection(\n                        db, entry, "vm1_content_modified", current_hash' in engine_source
    assert "repeat modified hash scan" in engine_source
    assert "if not has_pending_restore or not has_open_incident:" in engine_source
    assert "if not _has_pending_vm1_restore_for_file(db, entry.relative_path):" in engine_source


def test_vm1_poisoned_baseline_content_still_creates_detection():
    engine_source = Path("SECURITY/security_engine.py").read_text(encoding="utf-8")

    assert "def _vm1_manifest_content_is_malicious" in engine_source
    assert "VM1 poisoned-baseline guard" in engine_source
    assert "hash matched baseline but content looked malicious" in engine_source
    assert "VM1 safety-net bypassed" in engine_source
    assert '"defacement_keywords"' in engine_source


def test_security_unread_counts_use_batch_source_ids():
    vm2_source = Path("SECURITY/api_main.py").read_text(encoding="utf-8")
    client_source = Path("WARDS/backend/utils/security_client.py").read_text(encoding="utf-8")

    assert '@app.post("/v1/source-ids/batch"' in vm2_source
    assert '@app.post("/v1/source-ids/batch"' in vm2_source.split('@app.get("/v1/source-ids/{log_type}"')[0]
    assert '_sync_post("/v1/source-ids/batch"' in client_source
    assert 'key.startswith("source_ids_batch:")' in client_source


def test_security_route_guard_has_bounded_verify_request():
    source = Path("WARDS/frontend/src/components/SecurityProtectedRoute.jsx").read_text(encoding="utf-8")

    assert "verifyingRef" in source
    assert "timeout: 8000" in source
    assert "suppressGlobalErrorModal: true" in source


def test_vm1_recovery_retries_same_hash_and_existing_open_incidents():
    engine = Path("SECURITY/security_engine.py").read_text(encoding="utf-8")

    assert "def _queue_vm1_restore_if_needed" in engine
    assert "reason=\"repeat modified hash scan\"" in engine
    assert "reason=f\"existing open incident SEC-{existing_incident.id}\"" in engine
    assert "reason=\"snapshot scan found existing open incident\"" in engine
    assert "is_vm1_evidence_entry(file_entry)" in engine


def test_database_checksum_drift_without_audit_creates_detection():
    engine = Path("SECURITY/security_engine.py").read_text(encoding="utf-8")

    assert "database_checksum_drift_without_audit" in engine
    assert "Database checksum drift detected without matching audit rows" in engine
    assert "record_detection(db, file_entry, \"content_modified\", old_hash, current_hash, old_content, new_content, context)" in engine


def test_backup_engine_prunes_vm1_database_dumps_to_ten(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost:5432/wards")
    monkeypatch.setenv("BACKUP_DIR", str(tmp_path))

    for idx in range(12):
        old = tmp_path / f"database_20260101_0000{idx:02d}.sql.gz"
        old.write_bytes(b"old")
    unrelated = tmp_path / "manual_backup_20260101_000000.sql.gz"
    unrelated.write_bytes(b"keep")

    def fake_run(command, stdout=None, stderr=None, check=False, stdin=None):
        if stdout:
            stdout.write(b"-- sql dump\n")
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(backup_engine.subprocess, "run", fake_run)
    result = backup_engine.create_database_backup()

    backups = sorted(path.name for path in tmp_path.glob("database_*.sql.gz"))
    assert result.path.exists()
    assert len(backups) == 10
    assert "database_20260101_000000.sql.gz" not in backups
    assert unrelated.exists()


def test_prune_database_backups_is_configurable_and_scoped(tmp_path):
    for idx in range(5):
        (tmp_path / f"database_20260101_0000{idx:02d}.sql.gz").write_bytes(b"old")
    (tmp_path / "database_notes.txt").write_text("ignore", encoding="utf-8")

    removed = backup_engine.prune_database_backups(tmp_path, keep=3)

    assert removed == 2
    assert len(list(tmp_path.glob("database_*.sql.gz"))) == 3
    assert (tmp_path / "database_notes.txt").exists()


def test_prune_database_backup_records_keeps_ten_rows(monkeypatch, tmp_path):
    monkeypatch.setenv("BACKUP_DIR", str(tmp_path))
    engine = create_engine(f"sqlite:///{(tmp_path / 'rows.db').as_posix()}", connect_args={"check_same_thread": False})
    event.listen(engine, "connect", lambda connection, _record: connection.create_collation("utf8mb4_bin", lambda a, b: (a > b) - (a < b)))
    Backup.__table__.create(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        for idx in range(13):
            filename = f"database_20260101_0000{idx:02d}.sql.gz"
            (tmp_path / filename).write_bytes(b"dump")
            db.add(Backup(
                filename=filename,
                size="4",
                type="Scheduled" if idx % 2 else "Startup Baseline VM1",
                status="Completed",
                created_at=datetime(2026, 1, 1, 0, idx),
            ))
        db.add(Backup(
            filename="files_backup_20260101_000000",
            size="4",
            type="Files",
            status="Completed",
            created_at=datetime(2026, 1, 1, 1, 0),
        ))
        db.commit()

        removed = backup_engine.prune_database_backup_records(db, Backup, keep=10)

        remaining = db.query(Backup).filter(Backup.filename.like("database_%")).count()
        assert removed == 3
        assert remaining == 10
        assert db.query(Backup).filter(Backup.filename == "files_backup_20260101_000000").count() == 1
        assert len(list(tmp_path.glob("database_*.sql.gz"))) == 10
    finally:
        db.close()


def test_activity_logs_are_pruned_fifo_after_insert(monkeypatch, tmp_path):
    monkeypatch.setattr(db_models, "ACTIVITY_LOG_RETENTION_LIMIT", 3)
    engine = create_engine(f"sqlite:///{(tmp_path / 'logs.db').as_posix()}", connect_args={"check_same_thread": False})
    event.listen(engine, "connect", lambda connection, _record: connection.create_collation("utf8mb4_bin", lambda a, b: (a > b) - (a < b)))
    ActivityLog.__table__.create(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        for idx in range(5):
            db.add(ActivityLog(action=f"log-{idx}", user="tester", details="test", type="test"))
        db.commit()

        rows = db.query(ActivityLog).order_by(ActivityLog.id.asc()).all()

        assert len(rows) == 3
        assert [row.action for row in rows] == ["log-2", "log-3", "log-4"]
    finally:
        db.close()


def test_refresh_tokens_are_separate_from_access_tokens():
    access = create_access_token("public", {"sub": "citizen@example.com", "type": "user"})
    refresh = create_refresh_token("public", {"sub": "citizen@example.com", "type": "user"})

    access_payload = jwt.decode(access, USER_SECRET_KEY, algorithms=[ALGORITHM])
    refresh_payload = jwt.decode(refresh, USER_SECRET_KEY, algorithms=[ALGORITHM])

    assert access_payload["type"] == "user"
    assert refresh_payload["type"] == "refresh"
    assert refresh_payload["portal"] == "public"
    assert refresh_payload["exp"] > access_payload["exp"]


class Query:
    def __init__(self, rows):
        self.rows = list(rows)

    def filter(self, *_args, **_kwargs):
        return self

    def offset(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def order_by(self, *_args, **_kwargs):
        return self

    def first(self):
        return self.rows[0] if self.rows else None

    def all(self):
        return self.rows


class PublicBranchDB:
    def __init__(self, branch):
        self.branch = branch

    def add(self, _obj):
        pass

    def commit(self):
        pass

    def query(self, model):
        if model is public.Branch:
            return Query([self.branch])
        if model is public.BranchOperatingHours:
            return Query([SimpleNamespace(day_of_week="Mon", opening_time="08:00", closing_time="17:00", is_open=True)])
        if model is Service:
            return Query([])
        if model is SystemSetting:
            return Query([])
        if model is BranchSystemSetting:
            return Query([])
        return Query([])


def test_public_branch_details_are_minimal_for_anonymous_user():
    branch = SimpleNamespace(id=1, name="Galas", location="Quezon City", counters=4, status="Active")
    result = asyncio.run(
        public.get_branch_details(branch_id=1, db=PublicBranchDB(branch), current_user=None)
    )

    assert result["id"] == 1
    assert result["name"] == "Galas"
    assert result["location"] == "Quezon City"
    assert "services" in result
    assert "queue_enabled" in result
    assert "operating_hours" not in result
    assert "counters" not in result


def test_legacy_office_uploads_are_rejected_even_if_extension_is_allowed():
    upload = SimpleNamespace(filename="legacy.doc")
    ole_bytes = b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1" + b"\x00" * 64

    with pytest.raises(Exception) as exc_info:
        validate_upload_file(
            upload,
            ole_bytes,
            allowed_extensions={".doc", ".xls", ".docx", ".xlsx"},
        )

    assert getattr(exc_info.value, "status_code", None) == 400
    assert "legacy Office format" in exc_info.value.detail
    assert SafeFileType.OLE not in SafeFileType.all_types()


def test_deployment_compose_includes_redis_and_frontend_build_args():
    compose_text = (Path(__file__).resolve().parents[1] / "docker-compose.yml").read_text()

    assert "redis:" in compose_text
    assert "REDIS_URL: redis://redis:6379/0" in compose_text
    assert "VITE_API_BASE_URL:" in compose_text


def test_ci_deploy_status_requires_exact_commit_and_vm1_baseline():
    workflow = (Path(__file__).resolve().parents[1] / ".github" / "workflows" / "wards-ci.yml").read_text()

    assert 'TARGET_COMMIT="${GITHUB_SHA}"' in workflow
    assert '[ "$VM1_COMMIT" = "$TARGET_COMMIT" ]' in workflow
    assert '[ "$VM2_COMMIT" = "$TARGET_COMMIT" ]' in workflow
    assert "VM1 and VM2 are already synchronized at target commit" in workflow
    assert '[ "$VM2_VM1_MANIFEST_COMMIT" = "$TARGET_COMMIT" ]' in workflow
    assert '[ "$VM2_BASELINE_READY" = "true" ]' in workflow
    assert '[ "$VM2_PAUSED" = "false" ]' in workflow


def test_webhook_deploy_waits_for_vm1_baseline_manifest():
    script = (Path(__file__).resolve().parents[1] / "scripts" / "webhook_deploy.py").read_text()

    assert '"target_commit": target_commit' in script
    assert "deployment_vm1_baseline_ready" in script
    assert "vm1_last_manifest_commit" in script
    assert "VM1 did not upload a deployment-paused baseline manifest" in script
    assert "_trigger_vm2_post_deploy_backup_background" in script
    assert "timeout=120.0" not in script


def test_deploy_cleanup_removes_only_safe_ignored_leftovers():
    root = Path(__file__).resolve().parents[1]
    webhook = (root / "scripts" / "webhook_deploy.py").read_text()
    security_api = (root / "SECURITY" / "api_main.py").read_text()

    for source in (webhook, security_api):
        assert "git\", \"ls-files\", \"-io\", \"--exclude-standard\", \"-z\"" in source
        assert "\".env\" in lower_name" in source
        assert "\"vm1_snapshots\"" in source
        assert ".docx" in source
        assert ".xlsx" in source
        assert "path.unlink()" in source

    reset_index = webhook.index('run_cmd(["git", "reset", "--hard", "origin/main"]')
    cleanup_index = webhook.index("_cleanup_ignored_repo_files(DEPLOY_DIR)")
    compose_index = webhook.index('run_cmd(["docker", "compose", "up", "-d", "--build"]')
    assert reset_index < cleanup_index < compose_index


def test_deployment_manifest_retires_missing_vm1_files_without_incidents():
    engine = (Path(__file__).resolve().parents[1] / "SECURITY" / "security_engine.py").read_text()

    assert "def prune_deployment_removed_vm1_files" in engine
    assert "def prune_deployment_removed_local_files" in engine
    assert "def retire_deployment_removed_file" in engine
    assert "status = MONITORING_REMOVED_STATUS" in engine
    assert "seen_manifest_paths" in engine
    assert '"retired": prune_summary["retired"]' in engine
    assert "prune_deployment_removed_local_files(db, actor=\"deployment_scan\")" in engine
    assert "cleanup_retired_file_copies" in engine


def test_vm1_startup_creates_database_baseline_for_split_deployment():
    main_text = (Path(__file__).resolve().parents[1] / "WARDS" / "backend" / "main.py").read_text()

    assert "start_vm1_database_startup_baseline_if_configured" in main_text
    assert "Startup Baseline VM1" in main_text
    assert "SECURITY_API_URL" in main_text
    assert "create_vm1_database_backup" in main_text


def test_ci_backend_job_uses_cache_and_single_pytest_process():
    workflow = (Path(__file__).resolve().parents[1] / ".github" / "workflows" / "wards-ci.yml").read_text()

    assert "cache: pip" in workflow
    assert workflow.count("pytest -q") == 1
    assert "python -m compileall SECURITY\n      - name: Run" not in workflow


def test_file_status_scan_and_recover_routes_still_proxy_to_vm2():
    dashboard_route = (Path(__file__).resolve().parents[1] / "WARDS" / "backend" / "routes" / "security_dashboard.py").read_text()
    security_api = (Path(__file__).resolve().parents[1] / "SECURITY" / "api_main.py").read_text()
    client = (Path(__file__).resolve().parents[1] / "WARDS" / "backend" / "utils" / "security_client.py").read_text()

    assert '@router.post("/files/{file_id}/scan")' in dashboard_route
    assert '@router.post("/files/{file_id}/recover")' in dashboard_route
    assert '@app.post("/v1/scan/file"' in security_api
    assert '@app.post("/v1/files/recover"' in security_api
    assert 'return _sync_post("/v1/files/recover"' in client


def test_vm1_config_exposes_force_scan_token_for_reporter():
    security_api = (Path(__file__).resolve().parents[1] / "SECURITY" / "api_main.py").read_text()
    reporter = (Path(__file__).resolve().parents[1] / "scripts" / "vm1_security_reporter.py").read_text()

    assert '"force_scan_token": get_setting(db, "vm1_scan_requested_at", "")' in security_api
    assert '"deployment_paused": deployment_paused and not baseline_ready' in security_api
    assert 'set_setting(db, "vm1_scan_requested_at", force_token, "manual_scan")' in security_api
    assert "VM1_MANUAL_SCAN_WAIT_SECONDS" in security_api
    assert 'VM2 requested immediate manifest scan' in reporter
    assert 'scan_and_send_manifest("forced" if force_scan_due else "interval")' in reporter


def test_vm1_priority_hash_only_manifest_changes_create_detection():
    engine = (Path(__file__).resolve().parents[1] / "SECURITY" / "security_engine.py").read_text()
    reporter = (Path(__file__).resolve().parents[1] / "scripts" / "vm1_security_reporter.py").read_text()

    assert "recording priority-file detection and triggering recovery" in engine
    assert "Priority file auto-recovery was triggered from hash drift" in engine
    assert "recording hash-only detection and triggering recovery" in engine
    assert "deferring detection to avoid a hash-only false positive" in engine
    assert "content_missing_for_nonempty_file" in engine
    assert "size_bytes > 0" in engine
    assert 'set_setting(db, "vm1_scan_requested_at", now_utc().isoformat(), "vm2_hash_only_defer")' in engine
    assert '"inline_priority": not git_head_match or _is_critical_inline_path(relative_path, path)' in reporter
    assert '"inline_always": _is_critical_inline_path(relative_path, path)' in reporter
    assert "CRITICAL_INLINE_RELATIVE_PATHS" in reporter
    assert '"WARDS/frontend/index.html"' in reporter
    assert "inline_always" in reporter


def test_stale_deployment_pause_does_not_accept_vm1_manifest_as_baseline():
    engine = (Path(__file__).resolve().parents[1] / "SECURITY" / "security_engine.py").read_text()

    assert "deployment_baseline_allowed" in engine
    assert "and not baseline_already_ready" in engine
    assert "if deployment_paused and not deployment_baseline_allowed:" in engine
    assert "if deployment_baseline_allowed:" in engine


def test_vm1_deferred_git_clean_files_can_be_marked_clean():
    engine = (Path(__file__).resolve().parents[1] / "SECURITY" / "security_engine.py").read_text()

    git_check = engine.index("if f.get(\"git_head_match\") or local_repo_match:")
    repeat_hash_check = engine.index("if previous_hash == current_hash:", git_check)

    assert git_check < repeat_hash_check
    assert "hash-only deferral stores the modified hash as current" in engine


def test_vm1_push_changes_can_be_verified_against_vm2_repo_hash():
    engine = (Path(__file__).resolve().parents[1] / "SECURITY" / "security_engine.py").read_text()

    assert "def _vm1_hash_matches_local_repo" in engine
    assert "vm1_bulk_changes_match_local_repo" in engine
    assert "deployment_evidence" in engine
    assert "local_repo_hash" in engine


def test_site_traffic_context_route_uses_traffic_detector():
    api = (Path(__file__).resolve().parents[1] / "SECURITY" / "api_main.py").read_text()
    middleware = (Path(__file__).resolve().parents[1] / "WARDS" / "backend" / "middleware" / "dos_protection.py").read_text()

    assert "record_traffic_detection" in api
    assert 'payload.get("target_name") == "site_traffic"' in api
    assert '"top_source_ips": top_source_ips' in middleware


def test_incident_actions_use_throttled_monitored_file_housekeeping():
    engine = (Path(__file__).resolve().parents[1] / "SECURITY" / "security_engine.py").read_text()

    assert "HOUSEKEEPING_THROTTLE_SECONDS = 300" in engine
    assert engine.count("run_monitored_file_housekeeping(db)") >= 3


def test_startup_registration_handles_duplicate_monitored_file_rows():
    engine = (Path(__file__).resolve().parents[1] / "SECURITY" / "security_engine.py").read_text()

    assert "seen_path_keys: set[str] = set()" in engine
    assert "existing_by_path: dict[str, SecurityMonitoredFile] = {}" in engine
    assert "existing = existing_by_path.get(path_key) or existing_by_relative.get(rel_key)" in engine
    assert "Initial file registration hit duplicate monitored-file row" in engine
    assert "except IntegrityError as exc:" in engine


def test_startup_baseline_failure_rolls_back_before_status_update():
    security_api = (Path(__file__).resolve().parents[1] / "SECURITY" / "api_main.py").read_text()
    vm1_main = (Path(__file__).resolve().parents[1] / "WARDS" / "backend" / "main.py").read_text()

    assert "startup_db.rollback()" in security_api
    assert "startup_db.rollback()" in vm1_main
    assert 'set_setting(startup_db, "startup_baseline_status", "failed", "system")' in security_api
    assert 'set_setting(startup_db, "startup_baseline_status", "failed", "system")' in vm1_main


def test_backup_file_registration_is_serialized():
    engine = (Path(__file__).resolve().parents[1] / "SECURITY" / "security_engine.py").read_text()

    assert "_backup_registration_lock = threading.Lock()" in engine
    assert engine.count("with _backup_registration_lock:") >= 2
    assert "register_count = register_initial_files(db, ensure_backup=False, refresh_existing=False)" in engine


def test_vm1_frontend_rebuild_does_not_recreate_backend_dependency():
    reporter = (Path(__file__).resolve().parents[1] / "scripts" / "vm1_security_reporter.py").read_text()

    assert '["docker", "compose", "up", "-d", "--no-deps", "--build", "frontend"]' in reporter
    assert '["docker-compose", "up", "-d", "--no-deps", "--build", "frontend"]' in reporter
    assert "_queue_frontend_rebuild(rel_path)" in reporter
    assert "_flush_frontend_rebuild()" in reporter
    assert "Frontend rebuilt and restarted after restoring {restored_count} frontend file(s)" in reporter


def test_frontend_dockerfile_uses_static_nginx_server():
    dockerfile = (Path(__file__).resolve().parents[1] / "WARDS" / "frontend" / "Dockerfile").read_text()

    assert "FROM nginx:" in dockerfile
    assert "npm run build" in dockerfile
    assert "npm\", \"run\", \"dev" not in dockerfile
