import gzip
import asyncio
import subprocess
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from jose import jwt

from auth import USER_SECRET_KEY, create_access_token, create_refresh_token
from auth.jwt_utils import ALGORITHM
from middleware.https import HttpsEnforcementMiddleware
from database.models import BranchSystemSetting, Service, SystemSetting
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


def test_frontend_dockerfile_uses_static_nginx_server():
    dockerfile = (Path(__file__).resolve().parents[1] / "WARDS" / "frontend" / "Dockerfile").read_text()

    assert "FROM nginx:" in dockerfile
    assert "npm run build" in dockerfile
    assert "npm\", \"run\", \"dev" not in dockerfile
