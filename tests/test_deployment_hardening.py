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
from middleware.https import HttpsEnforcementMiddleware
from database.models import Backup, BranchSystemSetting, Service, SystemSetting
from routes import public
from utils import backup_engine
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


def test_frontend_dockerfile_uses_static_nginx_server():
    dockerfile = (Path(__file__).resolve().parents[1] / "WARDS" / "frontend" / "Dockerfile").read_text()

    assert "FROM nginx:" in dockerfile
    assert "npm run build" in dockerfile
    assert "npm\", \"run\", \"dev" not in dockerfile
