"""Licença: get_status (ramos offline) + activate, no service e via HTTP (TestClient)."""

from __future__ import annotations

from datetime import timedelta

from fastapi.testclient import TestClient

from altool.api.app import create_app
from altool.metadata.store import MetadataStore
from altool.services.licensing import LicenseError, LicensingService, _iso_z, _now


def _store() -> MetadataStore:
    s = MetadataStore(":memory:")
    s.bootstrap()
    return s


def _set_license(store: MetadataStore, *, status="active", expires_at=None, last_success=None) -> None:
    with store.tx() as con:
        con.execute(
            "INSERT OR REPLACE INTO license "
            "(id, status, expires_at, last_success_online_validation_at) VALUES (1, ?, ?, ?)",
            (status, _iso_z(expires_at), _iso_z(last_success)),
        )


# --------------------------------------------------------------- get_status


def test_status_not_activated() -> None:
    svc = LicensingService(_store())
    assert svc.get_status() == {"status": "not_activated"}


def test_status_active() -> None:
    store = _store()
    now = _now()
    _set_license(store, expires_at=now + timedelta(days=100), last_success=now)
    r = LicensingService(store).get_status()
    assert r["status"] == "active"
    assert r["expiresAt"].endswith("Z")


def test_status_expired() -> None:
    store = _store()
    now = _now()
    _set_license(store, expires_at=now - timedelta(days=1), last_success=now)
    assert LicensingService(store).get_status()["status"] == "expired"


def test_status_blocked_offline_sem_validacao() -> None:
    store = _store()
    _set_license(store, expires_at=_now() + timedelta(days=100), last_success=None)
    assert LicensingService(store).get_status()["status"] == "blocked_offline"


def test_status_blocked_offline_grace_expirado() -> None:
    store = _store()
    now = _now()
    # última validação há 38 dias > grace de 37.
    _set_license(store, expires_at=now + timedelta(days=100), last_success=now - timedelta(days=38))
    assert LicensingService(store).get_status()["status"] == "blocked_offline"


def test_status_dentro_do_grace() -> None:
    store = _store()
    now = _now()
    _set_license(store, expires_at=now + timedelta(days=100), last_success=now - timedelta(days=36))
    assert LicensingService(store).get_status()["status"] == "active"


# --------------------------------------------------------------- activate


def test_activate_missing_key() -> None:
    svc = LicensingService(_store())
    try:
        svc.activate(None)
        raise AssertionError("deveria lançar")
    except LicenseError as e:
        assert e.code == "missing_license_key"


def test_activate_sem_base_configurada(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.delenv("LICENSE_API_BASE_URL", raising=False)
    monkeypatch.delenv("LICENSE_SERVER_BASE_URL", raising=False)
    svc = LicensingService(_store())
    try:
        svc.activate("XXXX-YYYY")
        raise AssertionError("deveria lançar")
    except LicenseError as e:
        assert e.code == "LICENSE_API_BASE_URL not configured"
        assert e.status_code == 500


def test_activate_sucesso(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("LICENSE_API_BASE_URL", "https://lic.example.com")
    store = _store()
    captured = {}

    def fake_post(url, body, api_key):  # type: ignore[no-untyped-def]
        captured["url"] = url
        captured["body"] = body
        return {"activation_token": "TOK123", "expires_at": "2027-01-01T00:00:00.000Z"}

    svc = LicensingService(store, fingerprint_fn=lambda: "FP", http_post=fake_post)
    assert svc.activate("KEY-1") == {"success": True}
    assert captured["url"] == "https://lic.example.com/api/licenses/activate"
    assert captured["body"]["machineFingerprint"] == "FP"
    # persistiu e agora status = active.
    assert svc.get_status()["status"] == "active"


def test_activate_sem_token(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("LICENSE_API_BASE_URL", "https://lic.example.com")
    svc = LicensingService(_store(), http_post=lambda u, b, k: {"foo": "bar"})
    try:
        svc.activate("KEY-1")
        raise AssertionError("deveria lançar")
    except LicenseError as e:
        assert e.code == "activation_response_missing_token"


# --------------------------------------------------------------- HTTP (contrato)


def test_http_status_bypass_v2_sem_auth() -> None:
    # v2 sem autenticação: /status sempre 'active', /activate é no-op.
    client = TestClient(create_app(store=_store()))
    assert client.get("/api/license/status").json() == {"status": "active", "expiresAt": None}
    assert client.post("/api/license/activate", json={}).json() == {"success": True}


def test_http_status_com_licenciamento_ligado(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("ALTOOL_LICENSE_ENABLED", "1")
    client = TestClient(create_app(store=_store()))
    assert client.get("/api/license/status").json() == {"status": "not_activated"}
    r = client.post("/api/license/activate", json={})
    assert r.status_code == 400 and r.json() == {"error": "missing_license_key"}
