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

    def order_by(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def first(self):
        return self._result

    def all(self):
        if self._result is None:
            return []
        return [self._result]


class FakeDB:
    def __init__(self, admin=None, branch=None, citizen=None, email_otp=None):
        self.admin = admin
        self.branch = branch
        self.citizen = citizen
        self.email_otp = email_otp
        self._committed = False

    def query(self, model):
        if model is unified_auth.Admin:
            return FakeQuery(self.admin)
        if model is unified_auth.BranchStaff:
            return FakeQuery(self.branch)
        if model is unified_auth.CitizenUser:
            return FakeQuery(self.citizen)
        if model is unified_auth.EmailOTP:
            return FakeQuery(self.email_otp)
        return FakeQuery(None)

    def add(self, obj):
        pass

    def commit(self):
        self._committed = True

    def rollback(self):
        pass

    def refresh(self, obj):
        pass


def make_client(db):
    app = FastAPI()
    app.state.limiter = unified_auth.limiter
    app.include_router(unified_auth.router, prefix="/api/auth/unified")
    app.dependency_overrides[unified_auth.get_db] = lambda: db
    return app, TestClient(app)


def make_account(portal, **overrides):
    defaults = dict(
        id=1,
        username="testuser",
        email="test@example.com",
        status="Active",
        role="main_admin" if portal == "admin" else "branch_admin" if portal == "branch" else "citizen",
        hashed_password=unified_auth.pwd_context.hash("CorrectPass1!"),
        last_login=None,
        is_verified=True,
        full_name="Test User",
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


class LoginProfileQuery:
    def __init__(self, profiles):
        self._profiles = list(profiles)

    def _match_expr(self, obj, expr):
        left = getattr(expr, "left", None)
        key = getattr(left, "key", None) or getattr(left, "name", None)
        if not key:
            return True
        operator_name = getattr(getattr(expr, "operator", None), "__name__", "")
        if operator_name == "is_not":
            return getattr(obj, key, None) is not None
        right = getattr(expr, "right", None)
        expected = getattr(right, "value", None)
        return getattr(obj, key, None) == expected

    def filter(self, *args, **_kwargs):
        profiles = self._profiles
        for expr in args:
            profiles = [profile for profile in profiles if self._match_expr(profile, expr)]
        self._profiles = profiles
        return self

    def order_by(self, *_args, **_kwargs):
        self._profiles.sort(key=lambda profile: profile.last_seen_at or unified_auth.datetime.min, reverse=True)
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def first(self):
        return self._profiles[0] if self._profiles else None

    def all(self):
        return list(self._profiles)


class LoginProfileDB:
    def __init__(self, profiles=None):
        self.profiles = profiles or []
        self.added = []
        self.committed = False

    def query(self, model):
        if model is unified_auth.AdminLoginSecurityProfile:
            return LoginProfileQuery(self.profiles)
        return FakeQuery(None)

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        self.committed = True


def test_admin_login_security_context_collects_device_geo_and_keystroke(monkeypatch):
    account = make_account("admin", id=7)
    db = LoginProfileDB()
    request = SimpleNamespace(
        headers={
            "user-agent": "pytest-browser",
            "accept-language": "en-US",
            "sec-ch-ua-platform": "Windows",
            "sec-ch-ua-mobile": "?0",
        },
        client=SimpleNamespace(host="8.8.8.8"),
    )

    monkeypatch.setattr(
        unified_auth,
        "_geo_lookup",
        lambda _ip: {"country": "United States", "city": "Mountain View", "latitude": 37.386, "longitude": -122.0838, "vpn_detection": {}},
    )
    monkeypatch.setattr(unified_auth, "get_redis_client", lambda: None)

    context = unified_auth.build_admin_login_security_context(
        db,
        request=request,
        account=account,
        session_id="sid-1",
        keystroke_metrics={"key_events": 10, "avg_dwell_ms": 90, "avg_flight_ms": 120, "typing_variance_ms": 30, "paste_count": 1},
    )

    assert context["first_time_device"] is True
    assert context["first_time_country"] is True
    assert context["country"] == "United States"
    assert context["pasted_password"] is True
    assert context["keystroke_dynamics_available"] is True
    assert db.committed is True
    assert db.added


def test_admin_login_security_context_reuses_old_device_profile(monkeypatch):
    account = make_account("admin", id=7)
    request = SimpleNamespace(
        headers={"user-agent": "pytest-browser", "accept-language": "en-US"},
        client=SimpleNamespace(host="8.8.8.8"),
    )
    device_hash = unified_auth._sha256_text("|".join(["pytest-browser", "en-US", unified_auth._ip_prefix("8.8.8.8"), "", ""]))
    old_profile = SimpleNamespace(
        admin_id=7,
        device_hash=device_hash,
        source_ip="8.8.4.4",
        ip_prefix=unified_auth._ip_prefix("8.8.4.4"),
        country="United States",
        country_code="US",
        city="Old City",
        latitude=37.0,
        longitude=-122.0,
        user_agent_hash="old",
        login_count=3,
        first_seen_at=unified_auth.datetime.utcnow(),
        last_seen_at=unified_auth.datetime.utcnow(),
    )
    db = LoginProfileDB(profiles=[old_profile])
    monkeypatch.setattr(unified_auth, "_geo_lookup", lambda _ip: {"country": "United States", "country_code": "US", "city": "Mountain View", "latitude": 37.386, "longitude": -122.0838, "vpn_detection": {}})
    monkeypatch.setattr(unified_auth, "get_redis_client", lambda: None)

    context = unified_auth.build_admin_login_security_context(
        db,
        request=request,
        account=account,
        session_id="sid-2",
        keystroke_metrics={},
    )

    assert context["first_time_device"] is False
    assert context["first_time_country"] is False
    assert old_profile.login_count == 4
    assert db.added == [old_profile]


def test_admin_login_country_code_normalization_prevents_name_false_positive(monkeypatch):
    account = make_account("admin", id=7)
    request = SimpleNamespace(headers={"user-agent": "new-browser", "accept-language": "en-US"}, client=SimpleNamespace(host="8.8.8.8"))
    old_profile = SimpleNamespace(
        admin_id=7,
        device_hash="older-device",
        source_ip="8.8.4.4",
        ip_prefix="8.8.4.0/24",
        country="US",
        country_code="US",
        city=None,
        latitude=None,
        longitude=None,
        user_agent_hash="old",
        login_count=1,
        first_seen_at=unified_auth.datetime.utcnow(),
        last_seen_at=unified_auth.datetime.utcnow(),
    )
    db = LoginProfileDB(profiles=[old_profile])
    monkeypatch.setattr(unified_auth, "_geo_lookup", lambda _ip: {"country": "United States", "city": "Mountain View", "latitude": None, "longitude": None, "vpn_detection": {}})
    monkeypatch.setattr(unified_auth, "get_redis_client", lambda: None)

    context = unified_auth.build_admin_login_security_context(
        db,
        request=request,
        account=account,
        session_id="sid-3",
        keystroke_metrics={},
    )

    assert context["country_code"] == "US"
    assert context["first_time_country"] is False
    assert context["first_time_device"] is True


def test_keystroke_context_sanitizes_bad_client_values():
    context = unified_auth._keystroke_context({
        "key_events": "-50",
        "paste_count": "999999",
        "avg_dwell_ms": "nan",
        "avg_flight_ms": "-10",
        "typing_variance_ms": "999999999",
        "autofill_used": True,
    })

    assert context["keystroke_dynamics_available"] is False
    assert context["password_paste_count"] == 100
    assert 0 <= context["keystroke_anomaly_confidence"] <= 1


# ---------------------------------------------------------------------------
# 1. Admin login without MFA configured succeeds (MFA not enforced when not set up)
# ---------------------------------------------------------------------------
def test_admin_login_without_mfa_succeeds():
    unified_auth.locked_accounts.clear()
    unified_auth.login_attempts.clear()
    account = make_account("admin", username="adminuser", email="admin@example.com")
    db = FakeDB(admin=account)
    app, client = make_client(db)

    original_find = unified_auth.find_account_for_portal
    original_log = unified_auth.log_activity
    original_get_mfa = unified_auth.get_mfa_secret
    try:
        unified_auth.find_account_for_portal = lambda *_args, **_kwargs: ("admin", account)
        unified_auth.log_activity = lambda *_args, **_kwargs: None
        unified_auth.get_mfa_secret = lambda *_args, **_kwargs: None
        response = client.post(
            "/api/auth/unified/login",
            json={"identifier": account.email, "password": "CorrectPass1!"},
        )
        assert response.status_code == 200
        data = response.json()
        # access_token now delivered via HttpOnly cookie
        assert "wards_admin_access_token" in response.cookies
        assert data["token_type"] == "bearer"
        assert data["portal"] == "admin"
        assert "user" in data
        assert data["mfa_setup_required"] is True
    finally:
        unified_auth.find_account_for_portal = original_find
        unified_auth.log_activity = original_log
        unified_auth.get_mfa_secret = original_get_mfa
        app.dependency_overrides.clear()
        client.close()


# ---------------------------------------------------------------------------
# 2. Branch login without MFA configured succeeds (MFA not enforced when not set up)
# ---------------------------------------------------------------------------
def test_branch_login_without_mfa_succeeds():
    unified_auth.locked_accounts.clear()
    unified_auth.login_attempts.clear()
    account = make_account("branch", username="branchuser", email="branch@example.com", branch_id=1)
    db = FakeDB(branch=account)
    app, client = make_client(db)

    original_find = unified_auth.find_account_for_portal
    original_log = unified_auth.log_activity
    original_get_mfa = unified_auth.get_mfa_secret
    try:
        unified_auth.find_account_for_portal = lambda *_args, **_kwargs: ("branch", account)
        unified_auth.log_activity = lambda *_args, **_kwargs: None
        unified_auth.get_mfa_secret = lambda *_args, **_kwargs: None
        response = client.post(
            "/api/auth/unified/login",
            json={"identifier": account.email, "password": "CorrectPass1!", "portal": "branch"},
        )
        assert response.status_code == 200
        data = response.json()
        # access_token now delivered via HttpOnly cookie
        assert "wards_branch_access_token" in response.cookies
        assert data["token_type"] == "bearer"
        assert data["portal"] == "branch"
        assert "user" in data
        assert data["mfa_setup_required"] is True
    finally:
        unified_auth.find_account_for_portal = original_find
        unified_auth.log_activity = original_log
        unified_auth.get_mfa_secret = original_get_mfa
        app.dependency_overrides.clear()
        client.close()


# ---------------------------------------------------------------------------
# 3. Public (citizen) login without MFA configured succeeds and sets flag
# ---------------------------------------------------------------------------
def test_public_login_without_mfa_succeeds_with_setup_flag():
    unified_auth.locked_accounts.clear()
    unified_auth.login_attempts.clear()
    unified_auth.limiter.reset()
    account = make_account(
        "public",
        username="citizen@example.com",
        email="citizen@example.com",
        full_name="Test Citizen",
        contact_number="09123456789",
    )
    db = FakeDB(citizen=account)
    app, client = make_client(db)

    original_find = unified_auth.find_account_for_portal
    original_log = unified_auth.log_activity
    original_send = unified_auth.send_login_notification_email
    original_sec = unified_auth.log_unified_security_context
    original_get_mfa = unified_auth.get_mfa_secret
    try:
        unified_auth.find_account_for_portal = lambda *_args, **_kwargs: ("public", account)
        unified_auth.log_activity = lambda *_args, **_kwargs: None
        unified_auth.send_login_notification_email = lambda **_kwargs: None
        unified_auth.log_unified_security_context = lambda *_args, **_kwargs: None
        unified_auth.get_mfa_secret = lambda *_args, **_kwargs: None
        response = client.post(
            "/api/auth/unified/login",
            json={"identifier": account.email, "password": "CorrectPass1!"},
        )
        assert response.status_code == 200
        result = response.json()
        assert result["portal"] == "public"
        assert result["mfa_setup_required"] is True
        assert result["requires_mfa"] is False
        # access_token now delivered via HttpOnly cookie
        assert "wards_public_access_token" in response.cookies
    finally:
        unified_auth.find_account_for_portal = original_find
        unified_auth.log_activity = original_log
        unified_auth.send_login_notification_email = original_send
        unified_auth.log_unified_security_context = original_sec
        unified_auth.get_mfa_secret = original_get_mfa
        app.dependency_overrides.clear()
        client.close()


def test_public_login_unverified_requires_email_verification():
    unified_auth.locked_accounts.clear()
    unified_auth.login_attempts.clear()
    account = make_account(
        "public",
        username="citizen@example.com",
        email="citizen@example.com",
        full_name="Test Citizen",
        contact_number="09123456789",
        is_verified=False,
    )
    db = FakeDB(citizen=account)
    app, client = make_client(db)

    original_find = unified_auth.find_account_for_portal
    try:
        unified_auth.find_account_for_portal = lambda *_args, **_kwargs: ("public", account)
        response = client.post(
            "/api/auth/unified/login",
            json={"identifier": account.email, "password": "CorrectPass1!"},
        )
        assert response.status_code == 403
        data = response.json()
        assert data["detail"] == "Please verify your email before logging in."
        assert data["requires_email_verification"] is True
        assert response.headers.get("x-requires-email-verification") == "true"
    finally:
        unified_auth.find_account_for_portal = original_find
        app.dependency_overrides.clear()
        client.close()


def test_verification_confirm_uses_hashed_otp_lookup():
    citizen = make_account(
        "public",
        username="citizen@example.com",
        email="citizen@example.com",
        full_name="Test Citizen",
        contact_number="09123456789",
        is_verified=False,
    )
    otp_record = SimpleNamespace(
        code_hash=unified_auth.pwd_context.hash("123456"),
        expires_at=unified_auth.datetime.utcnow() + unified_auth.timedelta(minutes=10),
        consumed_at=None,
        attempts=0,
    )
    db = FakeDB(citizen=citizen, email_otp=otp_record)
    app, client = make_client(db)

    try:
        response = client.post(
            "/api/auth/unified/verification/confirm",
            json={"email": citizen.email, "code": "123456"},
        )
        assert response.status_code == 200
        assert response.json()["message"] == "Email verified. You can now log in."
        assert citizen.is_verified is True
        assert otp_record.consumed_at is not None
        assert db._committed is True
    finally:
        app.dependency_overrides.clear()
        client.close()


# ---------------------------------------------------------------------------
# 4. Logout succeeds and revokes token
# ---------------------------------------------------------------------------
def test_logout_with_token_succeeds():
    db = FakeDB()
    app, client = make_client(db)

    original_revoke = unified_auth.revoke_token
    try:
        unified_auth.revoke_token = lambda *_args, **_kwargs: None
        token = unified_auth.create_access_token(
            "admin",
            {"sub": "admin", "email": "admin@example.com", "type": "admin", "role": "admin", "user_id": 1},
        )
        response = client.post(
            "/api/auth/unified/logout",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        assert response.json()["message"] == "Logged out successfully"
    finally:
        unified_auth.revoke_token = original_revoke
        app.dependency_overrides.clear()
        client.close()


def test_logout_without_token_succeeds():
    db = FakeDB()
    app, client = make_client(db)
    try:
        response = client.post("/api/auth/unified/logout")
        assert response.status_code == 200
        assert response.json()["message"] == "Logged out successfully"
    finally:
        app.dependency_overrides.clear()
        client.close()


# ---------------------------------------------------------------------------
# 5. Setup MFA returns QR payload for valid credentials
# ---------------------------------------------------------------------------
def test_setup_mfa_returns_qr_payload():
    unified_auth.locked_accounts.clear()
    unified_auth.login_attempts.clear()
    account = make_account("admin", username="adminuser", email="admin@example.com")
    db = FakeDB(admin=account)
    app, client = make_client(db)

    original_find = unified_auth.find_account_for_portal
    original_log = unified_auth.log_activity
    original_save = unified_auth.save_mfa_secret
    try:
        unified_auth.find_account_for_portal = lambda *_args, **_kwargs: ("admin", account)
        unified_auth.log_activity = lambda *_args, **_kwargs: None
        unified_auth.save_mfa_secret = lambda *_args, **_kwargs: None
        response = client.post(
            "/api/auth/unified/setup-mfa",
            json={"identifier": account.email, "password": "CorrectPass1!", "portal": "admin"},
        )
        assert response.status_code == 200
        result = response.json()
        assert result["message"] == "MFA setup successful"
        assert result["totp_secret"]
        assert result["qr_code"]
        assert result["manual_entry_key"]
    finally:
        unified_auth.find_account_for_portal = original_find
        unified_auth.log_activity = original_log
        unified_auth.save_mfa_secret = original_save
        app.dependency_overrides.clear()
        client.close()


# ---------------------------------------------------------------------------
# 6. Verify MFA setup enables MFA when TOTP is correct
# ---------------------------------------------------------------------------
def test_verify_mfa_setup_enables_mfa():
    unified_auth.locked_accounts.clear()
    unified_auth.login_attempts.clear()
    account = make_account("admin", username="adminuser", email="admin@example.com")
    secret = pyotp.random_base32()
    db = FakeDB(admin=account)
    app, client = make_client(db)

    fake_mfa_record = SimpleNamespace(enabled=False)

    original_find = unified_auth.find_account_for_portal
    original_get_raw = unified_auth.get_mfa_secret_raw
    original_log = unified_auth.log_activity
    original_dec = unified_auth.get_decrypted_or_raw
    try:
        unified_auth.find_account_for_portal = lambda *_args, **_kwargs: ("admin", account)
        unified_auth.get_mfa_secret_raw = lambda *_args, **_kwargs: fake_mfa_record
        unified_auth.log_activity = lambda *_args, **_kwargs: None
        unified_auth.get_decrypted_or_raw = lambda record, field: secret if field == "secret" else getattr(record, field, None)
        response = client.post(
            "/api/auth/unified/verify-mfa-setup",
            json={
                "identifier": account.email,
                "password": "CorrectPass1!",
                "portal": "admin",
                "totp_code": pyotp.TOTP(secret).now(),
            },
        )
        assert response.status_code == 200
        result = response.json()
        assert result["message"] == "MFA enabled successfully"
        assert result["portal"] == "admin"
        assert fake_mfa_record.enabled is True
    finally:
        unified_auth.find_account_for_portal = original_find
        unified_auth.get_mfa_secret_raw = original_get_raw
        unified_auth.log_activity = original_log
        unified_auth.get_decrypted_or_raw = original_dec
        app.dependency_overrides.clear()
        client.close()


# ---------------------------------------------------------------------------
# 7. Password reset request always returns 200 (prevents enumeration)
# ---------------------------------------------------------------------------
def test_password_reset_request_returns_200_even_for_unknown():
    unified_auth.locked_accounts.clear()
    unified_auth.login_attempts.clear()
    db = FakeDB()
    app, client = make_client(db)

    original_find = unified_auth.find_account_for_portal
    original_send = unified_auth.send_password_reset_email
    original_log = unified_auth.log_activity
    try:
        unified_auth.find_account_for_portal = lambda *_args, **_kwargs: (None, None)
        unified_auth.send_password_reset_email = lambda **_kwargs: None
        unified_auth.log_activity = lambda *_args, **_kwargs: None
        response = client.post(
            "/api/auth/unified/request-password-reset",
            json={"email": "nobody@example.com", "portal": "admin"},
        )
        assert response.status_code == 200
        assert "if the email exists" in response.json()["message"].lower()
    finally:
        unified_auth.find_account_for_portal = original_find
        unified_auth.send_password_reset_email = original_send
        unified_auth.log_activity = original_log
        app.dependency_overrides.clear()
        client.close()


# ---------------------------------------------------------------------------
# 8. Password reset confirm rejects invalid token
# ---------------------------------------------------------------------------
def test_password_reset_confirm_rejects_invalid_token():
    db = FakeDB()
    app, client = make_client(db)
    try:
        response = client.post(
            "/api/auth/unified/reset-password",
            json={"token": "invalid-token", "new_password": "NewPass1!", "confirm_password": "NewPass1!"},
        )
        assert response.status_code == 400
        assert "invalid or expired" in response.json()["detail"].lower()
    finally:
        app.dependency_overrides.clear()
        client.close()


# ---------------------------------------------------------------------------
# 9. /verify endpoint returns token validity
# ---------------------------------------------------------------------------
def test_verify_endpoint_returns_valid_for_good_token():
    admin = make_account("admin", username="adminuser", email="admin@example.com")
    token = unified_auth.create_access_token(
        "admin",
        {"sub": admin.username, "email": admin.email, "type": "admin", "role": "admin", "user_id": admin.id},
    )
    db = FakeDB(admin=admin)
    app, client = make_client(db)
    try:
        response = client.get(
            "/api/auth/unified/verify",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        result = response.json()
        assert result["valid"] is True
        assert result["portal"] == "admin"
        assert result["user"]["email"] == admin.email
    finally:
        app.dependency_overrides.clear()
        client.close()


def test_verify_endpoint_rejects_missing_header():
    db = FakeDB()
    app, client = make_client(db)
    try:
        response = client.get("/api/auth/unified/verify")
        assert response.status_code == 401
        assert "missing or invalid" in response.json()["detail"].lower()
    finally:
        app.dependency_overrides.clear()
        client.close()


# ---------------------------------------------------------------------------
# 10. /me endpoint returns current user info
# ---------------------------------------------------------------------------
def test_me_endpoint_returns_user_info():
    admin = make_account("admin", username="adminuser", email="admin@example.com")
    token = unified_auth.create_access_token(
        "admin",
        {"sub": admin.username, "email": admin.email, "type": "admin", "role": "admin", "user_id": admin.id},
    )
    db = FakeDB(admin=admin)
    app, client = make_client(db)
    try:
        response = client.get(
            "/api/auth/unified/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        result = response.json()
        assert result["email"] == admin.email
        assert result["internal_role"] == "main_admin"
    finally:
        app.dependency_overrides.clear()
        client.close()


def test_me_endpoint_rejects_missing_header():
    db = FakeDB()
    app, client = make_client(db)
    try:
        response = client.get("/api/auth/unified/me")
        assert response.status_code == 401
        assert "missing or invalid" in response.json()["detail"].lower()
    finally:
        app.dependency_overrides.clear()
        client.close()


# ---------------------------------------------------------------------------
# 11. Setup MFA authenticated endpoint requires auth
# ---------------------------------------------------------------------------
def test_setup_mfa_authenticated_requires_auth():
    db = FakeDB()
    app, client = make_client(db)
    try:
        response = client.post("/api/auth/unified/setup-mfa-authenticated")
        assert response.status_code == 401
        assert "missing or invalid" in response.json()["detail"].lower()
    finally:
        app.dependency_overrides.clear()
        client.close()


def test_setup_mfa_authenticated_succeeds_with_valid_token():
    admin = make_account("admin", username="adminuser", email="admin@example.com")
    token = unified_auth.create_access_token(
        "admin",
        {"sub": admin.username, "email": admin.email, "type": "admin", "role": "admin", "user_id": admin.id},
    )
    db = FakeDB(admin=admin)
    app, client = make_client(db)

    original_log = unified_auth.log_activity
    original_save = unified_auth.save_mfa_secret
    try:
        unified_auth.log_activity = lambda *_args, **_kwargs: None
        unified_auth.save_mfa_secret = lambda *_args, **_kwargs: None
        response = client.post(
            "/api/auth/unified/setup-mfa-authenticated",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        result = response.json()
        assert result["message"] == "MFA setup successful"
        assert result["totp_secret"]
        assert result["qr_code"]
    finally:
        unified_auth.log_activity = original_log
        unified_auth.save_mfa_secret = original_save
        app.dependency_overrides.clear()
        client.close()


# ---------------------------------------------------------------------------
# 12. Check contact endpoint
# ---------------------------------------------------------------------------
def test_check_contact_returns_available_for_new_number():
    db = FakeDB()
    app, client = make_client(db)

    original_find = unified_auth.find_citizen_by_contact_number
    try:
        unified_auth.find_citizen_by_contact_number = lambda *_args, **_kwargs: None
        response = client.post(
            "/api/auth/unified/check-contact",
            json={"contact_number": "09999999999"},
        )
        assert response.status_code == 200
        assert response.json()["available"] is True
    finally:
        unified_auth.find_citizen_by_contact_number = original_find
        app.dependency_overrides.clear()
        client.close()


# ---------------------------------------------------------------------------
# 13. Public user change password endpoint
# ---------------------------------------------------------------------------
def test_public_user_change_password_rejects_incorrect_old_password():
    from auth.decorators import get_current_user
    account = make_account("public", username="citizen@example.com", email="citizen@example.com")
    db = FakeDB(citizen=account)
    app, client = make_client(db)
    app.dependency_overrides[get_current_user] = lambda: account

    try:
        response = client.put(
            "/api/auth/unified/user/password",
            json={
                "current_password": "WrongPass1!",
                "new_password": "NewPass1!",
                "confirm_new_password": "NewPass1!",
            },
        )
        assert response.status_code == 401
        assert "incorrect" in response.json()["detail"].lower()
    finally:
        app.dependency_overrides.clear()
        client.close()
