from utils import security_client


def test_remote_scan_all_unwraps_detections_and_invalidates_cache(monkeypatch):
    monkeypatch.setattr(security_client, "SECURITY_API_URL", "https://vm2.example")
    security_client._cache.clear()
    security_client._cache["dashboard_payload"] = ({"stale": True}, 9999999999)
    security_client._cache["query_detections:a"] = ([{"stale": True}], 9999999999)

    def fake_post(path, payload, timeout=None):
        assert path == "/v1/scan/all"
        assert payload == {"context": {"manual_scan": True}}
        assert timeout == 600.0
        return {"detections": [{"id": 12, "target_name": "WARDS/frontend/index.html"}]}

    monkeypatch.setattr(security_client, "_sync_post", fake_post)

    detections = security_client.scan_all_files(object(), context={"manual_scan": True})

    assert detections == [{"id": 12, "target_name": "WARDS/frontend/index.html"}]
    assert "dashboard_payload" not in security_client._cache
    assert "query_detections:a" not in security_client._cache


def test_remote_dashboard_payload_has_health_fallback(monkeypatch):
    monkeypatch.setattr(security_client, "SECURITY_API_URL", "https://vm2.example")
    security_client._cache.clear()

    def fake_get():
        raise RuntimeError("vm2 unavailable")

    monkeypatch.setattr(security_client, "_sync_get", lambda *_args, **_kwargs: fake_get())

    payload = security_client.dashboard_payload(object())

    assert payload["health"]["security_api"] == "unavailable"
    assert payload["health"]["last_interval_scan_status"] == "unknown"
