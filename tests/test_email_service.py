from types import SimpleNamespace

from services import email_service


def test_mfa_recovery_brevo_payload_has_no_attachments(monkeypatch):
    captured = {}

    monkeypatch.setenv("BREVO_API_KEY", "test-key")
    monkeypatch.setenv("SMTP_FROM_EMAIL", "noreply@nanowards.com")
    monkeypatch.setenv("SMTP_FROM_NAME", "WARDS Verification")
    monkeypatch.setattr(
        email_service,
        "_load_email_logos",
        lambda: (_ for _ in ()).throw(AssertionError("MFA Brevo mail should not load logos")),
    )

    def fake_post(_url, *, headers, json, timeout):
        captured["headers"] = headers
        captured["json"] = json
        captured["timeout"] = timeout
        return SimpleNamespace(
            ok=True,
            status_code=201,
            reason="Created",
            text='{"messageId":"test-message"}',
            json=lambda: {"messageId": "test-message"},
            raise_for_status=lambda: None,
        )

    monkeypatch.setattr(email_service.requests, "post", fake_post)

    result = email_service.send_mfa_recovery_email("admin@example.com", "123456")

    assert result["sent"] is True
    payload = captured["json"]
    assert payload["sender"]["email"] == "noreply@nanowards.com"
    assert payload["subject"] == "WARDS MFA Reset Verification Code"
    assert "textContent" in payload
    assert "htmlContent" in payload
    assert "attachment" not in payload
    assert "cid:" not in payload["htmlContent"]
