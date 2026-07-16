"""Bases: service (CRUD + ingest via job) e HTTP (upload multipart + polling)."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from altool.api.app import create_app
from altool.engine.data_store import DuckDBStore
from altool.metadata.store import MetadataStore
from altool.services.bases import BasesService
from altool.services.jobs import enqueue_ingest, get_ingest_job, process_pending_once

FX = Path(__file__).resolve().parent / "fixtures"


def _svc():  # type: ignore[no-untyped-def]
    store = MetadataStore(":memory:")
    store.bootstrap()
    data = DuckDBStore(None)
    return store, data, BasesService(store, data)


# ------------------------------------------------------------------ service


def test_create_e_get() -> None:
    store, _data, svc = _svc()
    [base] = svc.create_bases([{
        "tipo": "CONTABIL", "subtype": "razao", "nome": "Razão",
        "arquivo_caminho": str(FX / "sample.csv"),
        "header_linha_inicial": 1, "header_coluna_inicial": 1,
    }])
    assert base["tipo"] == "CONTABIL"
    assert base["conversion_status"] == "PENDING"
    assert base["ingest_in_progress"] is False
    assert base["rowCount"] is None  # ainda não ingerida


def test_ingest_via_job_popula_colunas_e_preview() -> None:
    store, _data, svc = _svc()
    [base] = svc.create_bases([{
        "tipo": "CONTABIL", "subtype": "razao",
        "arquivo_caminho": str(FX / "sample.csv"),
    }])
    bid = base["id"]

    # enfileira + processa (síncrono, determinístico)
    r = svc.enqueue_ingest(bid)
    assert r["status"] == "PENDING"
    assert process_pending_once(store, "ingest_jobs", lambda r: svc.process_ingest(r["base_id"])) is True
    assert get_ingest_job(store, r["jobId"])["status"] == "DONE"

    # base agora READY com rowCount
    base = svc.get_base(bid)
    assert base["conversion_status"] == "READY"
    assert base["tabela_sqlite"] == f"base_{bid}"
    assert base["rowCount"] == 3
    assert base["ingest_status"] == "DONE"

    # colunas sanitizadas + excel_name original
    cols = svc.get_columns(bid)
    assert [c["sqlite_name"] for c in cols] == ["empresa", "nota_fiscal", "valor_cont_bil"]
    assert cols[2]["excel_name"] == "Valor Contábil"

    # preview
    prev = svc.preview(bid)
    assert prev["columns"] == ["empresa", "nota_fiscal", "valor_cont_bil"]
    assert len(prev["rows"]) == 3
    assert prev["rows"][0]["empresa"] == "TBRA"


def test_ingest_falha_marca_job_failed() -> None:
    store, _data, svc = _svc()
    [base] = svc.create_bases([{
        "tipo": "CONTABIL", "subtype": "x",
        "arquivo_caminho": str(FX / "inexistente.csv"),
    }])
    r = svc.enqueue_ingest(base["id"])
    process_pending_once(store, "ingest_jobs", lambda r: svc.process_ingest(r["base_id"]))
    assert get_ingest_job(store, r["jobId"])["status"] == "FAILED"


def test_delete_remove_base_e_tabela() -> None:
    store, data, svc = _svc()
    [base] = svc.create_bases([{
        "tipo": "CONTABIL", "subtype": "x",
        "arquivo_caminho": str(FX / "sample.csv"),
    }])
    bid = base["id"]
    enqueue_ingest(store, bid)
    process_pending_once(store, "ingest_jobs", lambda r: svc.process_ingest(r["base_id"]))
    assert svc.delete_base(bid) == {"success": True}
    assert svc.get_base(bid) is None
    with data.use() as con:
        exists = con.execute(
            "SELECT 1 FROM information_schema.tables WHERE table_name = ?", (f"base_{bid}",)
        ).fetchone()
    assert exists is None


# ------------------------------------------------------------------ HTTP


def test_http_upload_ingest_poll(monkeypatch, tmp_path) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    store = MetadataStore(":memory:")
    store.bootstrap()
    app = create_app(store=store, data=DuckDBStore(None))
    client = TestClient(app)
    svc: BasesService = app.state.bases

    # lista vazia
    assert client.get("/api/bases").json() == {
        "data": [], "page": 1, "pageSize": 20, "total": 0, "totalPages": 0
    }

    # upload multipart
    with (FX / "sample.csv").open("rb") as f:
        resp = client.post(
            "/api/bases",
            files={"arquivo": ("sample.csv", f, "text/csv")},
            data={"tipo": "CONTABIL", "subtype": "razao", "periodo": "2025_12"},
        )
    assert resp.status_code == 201
    base = resp.json()["data"][0]
    bid = base["id"]
    assert base["conversion_status"] == "PENDING"

    # ingest → 202
    resp = client.post(f"/api/bases/{bid}/ingest")
    assert resp.status_code == 202
    assert resp.json()["status"] == "PENDING"

    # processa (o worker faria isso; aqui síncrono) e faz o "polling"
    process_pending_once(store, "ingest_jobs", lambda r: svc.process_ingest(r["base_id"]))
    got = client.get(f"/api/bases/{bid}").json()
    assert got["conversion_status"] == "READY"
    assert got["rowCount"] == 3

    cols = client.get(f"/api/bases/{bid}/columns").json()["data"]
    assert len(cols) == 3
    prev = client.get(f"/api/bases/{bid}/preview").json()
    assert prev["columns"] == ["empresa", "nota_fiscal", "valor_cont_bil"]

    assert client.get("/api/bases/99999").status_code == 404
    assert client.delete(f"/api/bases/{bid}").json() == {"success": True}
