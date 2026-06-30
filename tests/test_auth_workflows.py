import asyncio
from datetime import timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth import hash_password
from auth import decorators
from auth.decorators import _validate_token_binding
from routes import branches, logs, unified_auth


class FakeQuery:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    def filter(self, *_args, **_kwargs):
        return self

    def order_by(self, *_args, **_kwargs):
        return self

    def offset(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def first(self):
        return self.rows[0] if self.rows else None

    def all(self):
        return self.rows

    def count(self):
        return len(self.rows)


class AuthWorkflowDB:
    def __init__(self):
        self.citizens = []
        self.email_otps = []
        self.activity_logs = []
        self.committed = False

    def query(self, model):
        if model is unified_auth.CitizenUser:
            return FakeQuery(self.citizens)
        if model is unified_auth.EmailOTP:
            return FakeQuery(self.email_otps)
        if model is logs.ActivityLog:
            return FakeQuery(self.activity_logs)
        if model is logs.Branch:
            return FakeQuery([SimpleNamespace(id=1, name="Galas", name_enc=None)])
        return FakeQuery()

    def add(self, obj):
        if isinstance(obj, unified_auth.CitizenUser) and obj not in self.citizens:
            obj.id = obj.id or len(self.citizens) + 1
            self.citizens.append(obj)
        elif isinstance(obj, unified_auth.EmailOTP) and obj not in self.email_otps:
            obj.id = obj.id or len(self.email_otps) + 1
            self.email_otps.append(obj)
        elif isinstance(obj, logs.ActivityLog) and obj not in self.activity_logs:
            obj.id = obj.id or len(self.activity_logs) + 1
            self.activity_logs.append(obj)

    def flush(self):
        return None

    def commit(self):
        self.committed = True

    def rollback(self):
        return None

    def refresh(self, _obj):
        return None


def make_unified_client(db):
    app = FastAPI()
    app.state.limiter = unified_auth.limiter
    app.include_router(unified_auth.router, prefix="/api/auth/unified")
    app.dependency_overrides[unified_auth.get_db] = lambda: db
    return app, TestClient(app)


def test_citizen_register_verify_and_login_workflow(monkeypatch):
    unified_auth.locked_accounts.clear()
    unified_auth.login_attempts.clear()
    unified_auth.limiter.reset()
    db = AuthWorkflowDB()
    app, client = make_unified_client(db)

    monkeypatch.setattr(unified_auth, "_generate_verification_code", lambda: "123456")
    monkeypatch.setattr(
        unified_auth,
        "send_citizen_verification_email",
        lambda *_args, **_kwargs: {"sent": True, "message": "Verification sent."},
    )
    monkeypatch.setattr(unified_auth, "send_login_notification_email", lambda **_kwargs: None)
    monkeypatch.setattr(unified_auth, "log_unified_security_context", lambda *_args, **_kwargs: None)

    register_response = client.post(
        "/api/auth/unified/register",
        json={
            "email": "citizen@example.com",
            "full_name": "Test Citizen",
            "contact_number": "09123456789",
            "address": "Quezon City",
            "password": "CorrectPass123!",
            "dpa_consent": True,
            "dpa_version": "v1",
        },
    )
    assert register_response.status_code == 200
    assert db.email_otps[0].email_hash
    assert db.email_otps[0].email.startswith("OTP_EMAIL_")

    verify_response = client.post(
        "/api/auth/unified/verification/confirm",
        json={"email": "citizen@example.com", "code": "123456"},
    )
    assert verify_response.status_code == 200
    assert db.citizens[0].is_verified is True

    login_response = client.post(
        "/api/auth/unified/login",
        headers={"user-agent": "pytest"},
        json={"identifier": "citizen@example.com", "password": "CorrectPass123!", "portal": "public"},
    )
    assert login_response.status_code == 200
    assert login_response.json()["portal"] == "public"
    # access_token now delivered via HttpOnly cookie
    assert "wards_user_access_token" in login_response.cookies

    app.dependency_overrides.clear()
    client.close()


def test_expired_citizen_verification_code_is_rejected():
    db = AuthWorkflowDB()
    citizen = unified_auth.CitizenUser(
        email="citizen@example.com",
        full_name="Test Citizen",
        contact_number="09123456789",
        hashed_password=hash_password("CorrectPass123!"),
        role="public",
        is_verified=False,
        status="Active",
    )
    unified_auth.apply_citizen_user_security(citizen)
    db.add(citizen)
    otp = unified_auth.EmailOTP(
        email="citizen@example.com",
        role="public",
        code_hash=unified_auth.pwd_context.hash("123456"),
        expires_at=unified_auth.utc_now() - timedelta(minutes=1),
    )
    db.add(otp)
    db.flush()
    unified_auth.apply_email_otp_security(otp)
    app, client = make_unified_client(db)

    response = client.post(
        "/api/auth/unified/verification/confirm",
        json={"email": "citizen@example.com", "code": "123456"},
    )
    assert response.status_code == 400
    assert "expired" in response.json()["detail"].lower()

    app.dependency_overrides.clear()
    client.close()


def test_superadmin_branch_session_preserves_unified_branch_payload():
    branch = SimpleNamespace(id=2, name="Galas", name_enc=None)
    staff = SimpleNamespace(
        id=10,
        username="galasadmin",
        email="galas@example.com",
        full_name="Galas Admin",
        role="branch_admin",
        status="Active",
        branch_id=2,
        account_scope="full_branch",
        service_window=None,
        service_window_label=None,
        assigned_window_number=None,
        branch=branch,
    )

    class BranchSessionDB:
        def query(self, model):
            if model is branches.Branch:
                return FakeQuery([branch])
            if model is branches.BranchStaff:
                return FakeQuery([staff])
            return FakeQuery()

        def add(self, _obj):
            return None

        def commit(self):
            return None

    response = asyncio.run(
        branches.create_superadmin_branch_session(
            branch_id=2,
            current_user=SimpleNamespace(id=1, username="superadmin", role="superadmin"),
            db=BranchSessionDB(),
        )
    )

    import json as _json
    body = _json.loads(response.body)
    assert "wards_branch_access_token" in response.headers.get("set-cookie", "")
    assert body["user"]["role"] == "branch"
    assert body["user"]["internal_role"] == "branch_admin"
    assert body["user"]["superadmin_managed_branch"] is True
    assert body["user"]["branch_name"] == "Galas"


def test_branch_admin_can_access_activity_logs(monkeypatch):
    staff = logs.BranchStaff(id=7, username="branchadmin", role="branch_admin", branch_id=1, status="Active")
    db = AuthWorkflowDB()
    db.activity_logs.append(
        logs.ActivityLog(id=1, action="Branch Login", user="branchadmin", details="Branch: Galas | IP: 127.0.0.1", type="auth")
    )

    monkeypatch.setattr(logs, "get_logs_current_user", lambda: staff)
    result = asyncio.run(logs.get_activity_logs(page=1, page_size=10, current_user=staff, db=db))

    assert result["total"] == 1
    assert result["items"][0]["action"] == "Branch Login"


def test_token_binding_rejects_changed_user_agent(monkeypatch):
    monkeypatch.setattr(decorators, "BINDING_CHECK_UA", True)
    request = SimpleNamespace(
        client=SimpleNamespace(host="127.0.0.1"),
        headers={"user-agent": "new-agent"},
    )

    with pytest.raises(Exception) as exc:
        _validate_token_binding(request, {"ip": "127.0.0.1", "ua": "old-agent"})

    assert "device" in str(exc.value.detail).lower()
