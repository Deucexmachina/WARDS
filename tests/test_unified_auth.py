from types import SimpleNamespace

import pyotp
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routes import unified_auth


class FakeQuery:
    def __init__(self, result):
        self._result = result

    def filter(self, *_args, **_kwargs):
        return self

    def first(self):
        return self._result


class FakeDB:
    def __init__(self, admin=None, branch=None):
        self.admin = admin
        self.branch = branch

    def query(self, model):
        if model is unified_auth.Admin:
            return FakeQuery(self.admin)
        if model is unified_auth.BranchStaff:
            return FakeQuery(self.branch)
        return FakeQuery(None)


def make_login_client(db):
    app = FastAPI()
    app.state.limiter = unified_auth.limiter
    app.include_router(unified_auth.router, prefix="/api/auth/unified")
    app.dependency_overrides[unified_auth.get_db] = lambda: db
    return app, TestClient(app)


def test_decode_active_account_from_bearer_token_for_admin():
    admin = SimpleNamespace(id=1, username="mainadmin", email="treasurermain@gmail.com", status="Active", role="main_admin")
    token = unified_auth.create_access_token(
        "admin",
        {"sub": admin.username, "email": admin.email, "type": "admin", "role": "admin", "user_id": admin.id},
    )

    portal, account, payload = unified_auth.decode_active_account_from_bearer_token(
        token,
        FakeDB(admin=admin),
        allowed_portals=("admin",),
    )

    assert portal == "admin"
    assert account.email == "treasurermain@gmail.com"
    assert payload["type"] == "admin"


def test_unified_login_invalid_password():
    unified_auth.locked_accounts.clear()
    unified_auth.login_attempts.clear()
    account = SimpleNamespace(
        id=1,
        username="mainadmin",
        email="treasurermain@gmail.com",
        status="Active",
        role="main_admin",
        hashed_password=unified_auth.pwd_context.hash("CorrectPass1!"),
        last_login=None,
    )
    db = SimpleNamespace(commit=lambda: None)
    app, client = make_login_client(db)

    original_find = unified_auth.find_account_for_portal
    original_log = unified_auth.log_activity
    try:
        unified_auth.find_account_for_portal = lambda *_args, **_kwargs: ("admin", account)
        unified_auth.log_activity = lambda *_args, **_kwargs: None
        response = client.post(
            "/api/auth/unified/login",
            json={"identifier": account.email, "password": "WrongPass1!"},
        )
        assert response.status_code == 401
        assert response.json()["detail"] == "Invalid credentials. Please check your email and password."
    finally:
        unified_auth.find_account_for_portal = original_find
        unified_auth.log_activity = original_log
        app.dependency_overrides.clear()
        client.close()


def test_unified_login_requires_mfa_when_code_missing():
    unified_auth.locked_accounts.clear()
    unified_auth.login_attempts.clear()
    account = SimpleNamespace(
        id=1,
        username="mainadmin",
        email="treasurermain@gmail.com",
        status="Active",
        role="main_admin",
        hashed_password=unified_auth.pwd_context.hash("CorrectPass1!"),
        last_login=None,
    )
    db = SimpleNamespace(commit=lambda: None)
    secret = pyotp.random_base32()
    app, client = make_login_client(db)

    original_find = unified_auth.find_account_for_portal
    original_get_mfa = unified_auth.get_mfa_secret
    try:
        unified_auth.find_account_for_portal = lambda *_args, **_kwargs: ("admin", account)
        unified_auth.get_mfa_secret = lambda *_args, **_kwargs: secret
        response = client.post(
            "/api/auth/unified/login",
            json={"identifier": account.email, "password": "CorrectPass1!"},
        )
        assert response.status_code == 200
        result = response.json()
        assert result["requires_mfa"] is True
        assert result["portal"] == "admin"
    finally:
        unified_auth.find_account_for_portal = original_find
        unified_auth.get_mfa_secret = original_get_mfa
        app.dependency_overrides.clear()
        client.close()


def test_unified_login_succeeds_with_valid_totp():
    unified_auth.locked_accounts.clear()
    unified_auth.login_attempts.clear()
    account = SimpleNamespace(
        id=1,
        username="mainadmin",
        email="treasurermain@gmail.com",
        status="Active",
        role="main_admin",
        hashed_password=unified_auth.pwd_context.hash("CorrectPass1!"),
        last_login=None,
    )

    class DummyDb:
        def commit(self):
            return None

    db = DummyDb()
    secret = pyotp.random_base32()
    app, client = make_login_client(db)

    original_find = unified_auth.find_account_for_portal
    original_get_mfa = unified_auth.get_mfa_secret
    original_send = unified_auth.send_login_notification_email
    original_log = unified_auth.log_activity
    original_sec = unified_auth.log_unified_security_context
    try:
        unified_auth.find_account_for_portal = lambda *_args, **_kwargs: ("admin", account)
        unified_auth.get_mfa_secret = lambda *_args, **_kwargs: secret
        unified_auth.send_login_notification_email = lambda **_kwargs: None
        unified_auth.log_activity = lambda *_args, **_kwargs: None
        unified_auth.log_unified_security_context = lambda *_args, **_kwargs: None
        response = client.post(
            "/api/auth/unified/login",
            headers={"user-agent": "pytest"},
            json={
                "identifier": account.email,
                "password": "CorrectPass1!",
                "totp_code": pyotp.TOTP(secret).now(),
            },
        )
        assert response.status_code == 200
        result = response.json()
        assert result["requires_mfa"] is False
        assert result["portal"] == "admin"
        assert result["access_token"]
        assert result["user"]["internal_role"] == "main_admin"
    finally:
        unified_auth.find_account_for_portal = original_find
        unified_auth.get_mfa_secret = original_get_mfa
        unified_auth.send_login_notification_email = original_send
        unified_auth.log_activity = original_log
        unified_auth.log_unified_security_context = original_sec
        app.dependency_overrides.clear()
        client.close()
