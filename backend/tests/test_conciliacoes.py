"""Conciliações: fluxo completo create → job (run_conciliacao) → metrics → resultado."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from altool.api.app import create_app
from altool.engine.data_store import DuckDBStore
from altool.metadata.store import MetadataStore
from altool.services.bases import BasesService
from altool.services.conciliacoes import ConciliacaoService
from altool.services.configs import ConfigsService
from altool.services.jobs import process_pending_once


def _csv(path: Path, rows: list[tuple[str, str]]) -> None:
    path.write_text("nota,valor\n" + "\n".join(f"{a},{b}" for a, b in rows), encoding="utf-8")


def _setup(tmp_path):  # type: ignore[no-untyped-def]
    store = MetadataStore(":memory:")
    store.bootstrap()
    data = DuckDBStore(None)
    bases = BasesService(store, data)
    configs = ConfigsService(store)
    concil = ConciliacaoService(store, data, configs)

    _csv(tmp_path / "contabil.csv", [("K1", "1000"), ("K2", "500")])
    _csv(tmp_path / "fiscal.csv", [("K1", "1000"), ("K3", "300")])

    [ba] = bases.create_bases([{"tipo": "CONTABIL", "subtype": "x",
                                "arquivo_caminho": str(tmp_path / "contabil.csv")}])
    [bb] = bases.create_bases([{"tipo": "FISCAL", "subtype": "x",
                                "arquivo_caminho": str(tmp_path / "fiscal.csv")}])
    for bid in (ba["id"], bb["id"]):
        bases.enqueue_ingest(bid)
        process_pending_once(store, "ingest_jobs", lambda r: bases.process_ingest(r["base_id"]))

    config = configs.create_conciliacao(
        nome="cfg", base_contabil_id=ba["id"], base_fiscal_id=bb["id"],
        chaves_contabil={"CHAVE_1": ["nota"]}, chaves_fiscal={"CHAVE_1": ["nota"]},
        coluna_conciliacao_contabil="valor", coluna_conciliacao_fiscal="valor",
    )
    return store, data, bases, configs, concil, config


def test_fluxo_completo_service(tmp_path) -> None:  # type: ignore[no-untyped-def]
    store, _data, _bases, _configs, concil, config = _setup(tmp_path)

    job = concil.create_job({"configConciliacaoId": config["id"], "nome": "j1"})
    assert job["status"] == "PENDING"
    assert job["pipeline_stage"] == "queued"

    assert process_pending_once(store, "jobs_conciliacao", concil.process) is True

    res = concil.get_with_metrics(job["id"])
    assert res["job"]["status"] == "DONE"
    assert res["job"]["pipeline_stage"] == "done"
    m = res["metrics"]
    assert m["totalRows"] == 4  # A(K1),A(K2),B(K1),B(K3)
    by_status = {r["status"]: r["count"] for r in m["byStatus"]}
    assert by_status["01_Conciliado"] == 2
    assert by_status["03_Não Encontrado"] == 2

    # resultado paginado + keys
    r = concil.resultado(job["id"])
    assert r["total"] == 4
    assert r["keys"] == ["CHAVE_1"]
    # filtro por status
    conc = concil.resultado(job["id"], status="01_Conciliado")
    assert conc["total"] == 2


def test_worker_background_drena_fila(tmp_path) -> None:  # type: ignore[no-untyped-def]
    import time

    from altool.services.jobs import JobWorker

    store, _data, _bases, _configs, concil, config = _setup(tmp_path)
    worker = JobWorker(store, [("jobs_conciliacao", concil.process)], poll_interval=0.05)
    worker.start()
    try:
        job = concil.create_job({"configConciliacaoId": config["id"]})
        for _ in range(100):  # espera o worker processar (bounded ~5s)
            if concil.get_with_metrics(job["id"])["job"]["status"] == "DONE":
                break
            time.sleep(0.05)
        assert concil.get_with_metrics(job["id"])["job"]["status"] == "DONE"
    finally:
        worker.stop()


def test_export_e_download_service(tmp_path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("EXPORT_DIR", str(tmp_path / "exports"))
    store, _data, _bases, _configs, concil, config = _setup(tmp_path)
    job = concil.create_job({"configConciliacaoId": config["id"]})

    # 409 antes de concluir
    assert concil.exportar(job["id"])[0] == 409

    process_pending_once(store, "jobs_conciliacao", concil.process)

    # 202 dispara o export
    code, payload = concil.exportar(job["id"])
    assert code == 202 and payload["status"] == "export_started"

    # worker de export gera o arquivo
    assert process_pending_once(store, "export_jobs", concil.process_export) is True
    st = concil.export_status(job["id"])
    assert st["export_status"] == "READY"
    assert Path(st["arquivo_exportado"]).exists()

    info = concil.download_info(job["id"])
    assert info["media_type"].endswith("spreadsheetml.sheet")
    assert info["filename"] == f"conciliacao_{job['id']}.xlsx"

    # já existe → 200 { path, filename }
    code, payload = concil.exportar(job["id"])
    assert code == 200 and payload["filename"].endswith(".xlsx")


def test_export_download_http(tmp_path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("EXPORT_DIR", str(tmp_path / "exports"))
    store = MetadataStore(":memory:")
    store.bootstrap()
    app = create_app(store=store, data=DuckDBStore(None))
    client = TestClient(app)
    bases: BasesService = app.state.bases
    configs: ConfigsService = app.state.configs
    concil: ConciliacaoService = app.state.conciliacoes

    _csv(tmp_path / "c.csv", [("K1", "1000")])
    _csv(tmp_path / "f.csv", [("K1", "1000")])
    [ba] = bases.create_bases([{"tipo": "CONTABIL", "subtype": "x", "arquivo_caminho": str(tmp_path / "c.csv")}])
    [bb] = bases.create_bases([{"tipo": "FISCAL", "subtype": "x", "arquivo_caminho": str(tmp_path / "f.csv")}])
    for bid in (ba["id"], bb["id"]):
        bases.enqueue_ingest(bid)
        process_pending_once(store, "ingest_jobs", lambda r: bases.process_ingest(r["base_id"]))
    cfg = configs.create_conciliacao(
        nome="c", base_contabil_id=ba["id"], base_fiscal_id=bb["id"],
        chaves_contabil={"CHAVE_1": ["nota"]}, chaves_fiscal={"CHAVE_1": ["nota"]},
        coluna_conciliacao_contabil="valor", coluna_conciliacao_fiscal="valor",
    )
    jid = client.post("/api/conciliacoes", json={"configConciliacaoId": cfg["id"]}).json()["id"]
    process_pending_once(store, "jobs_conciliacao", concil.process)

    # exportar → 202
    resp = client.post(f"/api/conciliacoes/{jid}/exportar")
    assert resp.status_code == 202 and resp.json()["status"] == "export_started"

    process_pending_once(store, "export_jobs", concil.process_export)

    # export-status → READY
    st = client.get(f"/api/conciliacoes/{jid}/export-status").json()
    assert st["export_status"] == "READY"

    # download → stream xlsx
    dl = client.get(f"/api/conciliacoes/{jid}/download")
    assert dl.status_code == 200
    assert "spreadsheetml.sheet" in dl.headers["content-type"]
    assert len(dl.content) > 0  # bytes do arquivo


def test_config_invalida_400(tmp_path) -> None:  # type: ignore[no-untyped-def]
    _s, _d, _b, _c, concil, _cfg = _setup(tmp_path)
    try:
        concil.create_job({"configConciliacaoId": 99999})
        raise AssertionError("deveria falhar")
    except ValueError as e:
        assert "inválido" in str(e)


def test_http(tmp_path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "up"))
    store = MetadataStore(":memory:")
    store.bootstrap()
    app = create_app(store=store, data=DuckDBStore(None))
    client = TestClient(app)
    bases: BasesService = app.state.bases
    configs: ConfigsService = app.state.configs
    concil: ConciliacaoService = app.state.conciliacoes

    _csv(tmp_path / "c.csv", [("K1", "1000"), ("K2", "500")])
    _csv(tmp_path / "f.csv", [("K1", "1000"), ("K3", "300")])
    [ba] = bases.create_bases([{"tipo": "CONTABIL", "subtype": "x", "arquivo_caminho": str(tmp_path / "c.csv")}])
    [bb] = bases.create_bases([{"tipo": "FISCAL", "subtype": "x", "arquivo_caminho": str(tmp_path / "f.csv")}])
    for bid in (ba["id"], bb["id"]):
        bases.enqueue_ingest(bid)
        process_pending_once(store, "ingest_jobs", lambda r: bases.process_ingest(r["base_id"]))
    cfg = configs.create_conciliacao(
        nome="c", base_contabil_id=ba["id"], base_fiscal_id=bb["id"],
        chaves_contabil={"CHAVE_1": ["nota"]}, chaves_fiscal={"CHAVE_1": ["nota"]},
        coluna_conciliacao_contabil="valor", coluna_conciliacao_fiscal="valor",
    )

    # POST cria job (201)
    resp = client.post("/api/conciliacoes", json={"configConciliacaoId": cfg["id"]})
    assert resp.status_code == 201
    jid = resp.json()["id"]

    # processa e faz polling
    process_pending_once(store, "jobs_conciliacao", concil.process)
    detail = client.get(f"/api/conciliacoes/{jid}").json()
    assert detail["job"]["status"] == "DONE"
    assert detail["metrics"]["totalRows"] == 4

    resultado = client.get(f"/api/conciliacoes/{jid}/resultado").json()
    assert resultado["total"] == 4 and resultado["keys"] == ["CHAVE_1"]

    assert client.get("/api/conciliacoes").json()["total"] == 1
    assert client.get("/api/conciliacoes/99999").status_code == 404
    assert client.delete(f"/api/conciliacoes/{jid}").json() == {"success": True}
