"""Endpoints periféricos portados: subtypes, PATCH, reuse-monetary, derived, maintenance, debug."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from altool.api.app import create_app
from altool.engine.data_store import DuckDBStore
from altool.metadata.store import MetadataStore
from altool.services.bases import BasesService
from altool.services.jobs import process_pending_once

FX = Path(__file__).resolve().parent / "fixtures"


def _client_with_base():  # type: ignore[no-untyped-def]
    store = MetadataStore(":memory:")
    store.bootstrap()
    app = create_app(store=store, data=DuckDBStore(None))
    client = TestClient(app)
    bases: BasesService = app.state.bases
    [b] = bases.create_bases([{"tipo": "CONTABIL", "subtype": "x",
                               "arquivo_caminho": str(FX / "sample.csv")}])
    bases.enqueue_ingest(b["id"])
    process_pending_once(store, "ingest_jobs", lambda r: bases.process_ingest(r["base_id"]))
    return client, b["id"]


# ------------------------------------------------------------------ subtypes
def test_subtypes_crud() -> None:
    client, _ = _client_with_base()
    assert client.get("/api/bases/subtypes").json() == {"data": []}
    r = client.post("/api/bases/subtypes", json={"name": "razao"})
    assert r.status_code == 201
    sid = r.json()["data"]["id"]
    assert client.get(f"/api/bases/subtypes/{sid}").json()["data"]["name"] == "razao"
    assert client.put(f"/api/bases/subtypes/{sid}", json={"name": "livro"}).json()["data"]["name"] == "livro"
    assert client.delete(f"/api/bases/subtypes/{sid}").json() == {"success": True}
    assert client.get(f"/api/bases/subtypes/{sid}").status_code == 404


# ------------------------------------------------------------------ patch
def test_patch_base_e_coluna_monetary() -> None:
    client, bid = _client_with_base()
    # PATCH base
    assert client.patch(f"/api/bases/{bid}", json={"nome": "Renomeada"}).json()["data"]["nome"] == "Renomeada"
    # PATCH coluna is_monetary
    cols = client.get(f"/api/bases/{bid}/columns").json()["data"]
    col = next(c for c in cols if c["sqlite_name"] == "valor_cont_bil")
    r = client.patch(f"/api/bases/{bid}/columns/{col['id']}", json={"is_monetary": 1})
    assert r.json()["success"] is True and r.json()["data"]["is_monetary"] == 1


# ------------------------------------------------------------------ reuse-monetary
def test_reuse_monetary() -> None:
    client, bid = _client_with_base()
    cols = client.get(f"/api/bases/{bid}/columns").json()["data"]
    col = next(c for c in cols if c["sqlite_name"] == "valor_cont_bil")
    client.patch(f"/api/bases/{bid}/columns/{col['id']}", json={"is_monetary": 1})
    # segunda base com a mesma coluna
    bases: BasesService = client.app.state.bases  # type: ignore[attr-defined]
    [b2] = bases.create_bases([{"tipo": "FISCAL", "subtype": "x", "arquivo_caminho": str(FX / "sample.csv")}])
    bases.enqueue_ingest(b2["id"])
    process_pending_once(client.app.state.store, "ingest_jobs", lambda r: bases.process_ingest(r["base_id"]))  # type: ignore[attr-defined]
    r = client.post(f"/api/bases/{bid}/reuse-monetary", json={"targetBaseIds": [b2["id"]], "override": True})
    assert r.json()["success"] is True
    assert any(d["baseId"] == b2["id"] and d["updated"] >= 1 for d in r.json()["details"])


# ------------------------------------------------------------------ derived
def test_derived_column_sync() -> None:
    client, bid = _client_with_base()
    r = client.post(f"/api/bases/{bid}/columns/derived", json={"sourceColumn": "valor_cont_bil", "op": "ABS"})
    assert r.status_code == 201
    body = r.json()
    assert body["background"] is False and body["column"] == "abs_valor_cont_bil"
    # a coluna derivada aparece no preview e nas colunas
    prev = client.get(f"/api/bases/{bid}/preview").json()
    assert "abs_valor_cont_bil" in prev["columns"]
    assert client.get(f"/api/bases/{bid}/columns/derived/jobs").json() == {"jobs": []}


def test_derived_op_invalida_400() -> None:
    client, bid = _client_with_base()
    assert client.post(f"/api/bases/{bid}/columns/derived",
                       json={"sourceColumn": "valor_cont_bil", "op": "XYZ"}).status_code == 400


# ------------------------------------------------------------------ maintenance / debug
def test_maintenance_cleanup() -> None:
    client, _ = _client_with_base()
    r = client.post("/api/maintenance/cleanup/storage").json()
    assert r["message"] == "storage cleanup finished"
    r = client.post("/api/maintenance/cleanup").json()
    assert r["message"] == "cleanup finished"
    r = client.post("/api/maintenance/cleanup/results").json()
    assert r["message"] == "cleanup results finished"
    # alias que o service do frontend chama
    assert client.post("/api/maintenance/cleanup-results").json()["message"] == "cleanup results finished"


def test_debug() -> None:
    client, _ = _client_with_base()
    assert client.get("/api/debug/workers").json()["enabled"] is True
    assert "python" in client.get("/api/debug/system").json()
    assert client.get("/api/debug/db").json()["tables"]["count"] >= 1
