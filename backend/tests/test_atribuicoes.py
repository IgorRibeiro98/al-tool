"""Atribuições: fluxo completo create → start → run → results → export/download."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from altool.api.app import create_app
from altool.engine.data_store import DuckDBStore
from altool.metadata.store import MetadataStore
from altool.services.atribuicoes import AtribuicaoService
from altool.services.bases import BasesService
from altool.services.jobs import process_pending_once
from altool.services.keys import KeysService


def _csv(path: Path, rows: list[tuple[str, str]]) -> None:
    path.write_text("nota,conta\n" + "\n".join(f"{a},{b}" for a, b in rows), encoding="utf-8")


def _drain(store, svc):  # type: ignore[no-untyped-def]
    process_pending_once(store, "ingest_jobs", lambda r: svc.process_ingest(r["base_id"]))


def _setup(tmp_path):  # type: ignore[no-untyped-def]
    store = MetadataStore(":memory:")
    store.bootstrap()
    data = DuckDBStore(None)
    bases = BasesService(store, data)
    keys = KeysService(store)
    atrib = AtribuicaoService(store, data, keys)

    _csv(tmp_path / "origem.csv", [("K1", "111"), ("K2", "222")])   # CONTABIL
    _csv(tmp_path / "destino.csv", [("K1", ""), ("K3", "")])         # FISCAL
    [bo] = bases.create_bases([{"tipo": "CONTABIL", "subtype": "x",
                                "arquivo_caminho": str(tmp_path / "origem.csv")}])
    [bd] = bases.create_bases([{"tipo": "FISCAL", "subtype": "x",
                                "arquivo_caminho": str(tmp_path / "destino.csv")}])
    for bid in (bo["id"], bd["id"]):
        bases.enqueue_ingest(bid)
        _drain(store, bases)

    ck = keys.create_key(nome="ck", base_tipo="CONTABIL", base_subtipo="x", columns=["nota"])
    fk = keys.create_key(nome="fk", base_tipo="FISCAL", base_subtipo="x", columns=["nota"])
    pair = keys.create_pair(nome="p", contabil_key_id=ck["id"], fiscal_key_id=fk["id"])
    return store, data, bases, keys, atrib, bo, bd, pair


def _body(bo, bd, pair) -> dict:  # type: ignore[no-untyped-def]
    return {
        "baseOrigemId": bo["id"], "baseDestinoId": bd["id"], "modeWrite": "OVERWRITE",
        "selectedColumns": ["conta"], "keysPairs": [{"keysPairId": pair["id"]}],
    }


def test_fluxo_completo_service(tmp_path) -> None:  # type: ignore[no-untyped-def]
    store, _data, _bases, _keys, atrib, bo, bd, pair = _setup(tmp_path)

    run = atrib.create_run(_body(bo, bd, pair))
    assert run["status"] == "CREATED"
    assert run["selected_columns"] == ["conta"]
    assert run["base_origem"]["tipo"] == "CONTABIL"

    code, payload = atrib.start_run(run["id"])
    assert code == 200 and payload["status"] == "started"

    assert process_pending_once(store, "atribuicao_runs", atrib.process) is True
    got = atrib.get_run(run["id"])
    assert got["status"] == "DONE"

    res = atrib.results(run["id"])
    assert res["total"] == 1  # só destino K1 casa com origem K1
    row = res["data"][0]
    assert row["conta"] == "111"  # copiado da origem


def test_validacoes_create(tmp_path) -> None:  # type: ignore[no-untyped-def]
    _s, _d, _b, _k, atrib, bo, bd, pair = _setup(tmp_path)
    # origem == destino
    try:
        atrib.create_run({**_body(bo, bd, pair), "baseDestinoId": bo["id"]})
        raise AssertionError("deveria falhar")
    except ValueError as e:
        assert "diferentes" in str(e)
    # sem keysPairs
    try:
        atrib.create_run({**_body(bo, bd, pair), "keysPairs": []})
        raise AssertionError("deveria falhar")
    except ValueError as e:
        assert "keysPairs" in str(e)


def test_start_409_se_ja_rodou(tmp_path) -> None:  # type: ignore[no-untyped-def]
    store, _d, _b, _k, atrib, bo, bd, pair = _setup(tmp_path)
    run = atrib.create_run(_body(bo, bd, pair))
    atrib.start_run(run["id"])
    process_pending_once(store, "atribuicao_runs", atrib.process)
    # já DONE → 409
    code, _ = atrib.start_run(run["id"])
    assert code == 409


def test_http_completo(tmp_path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("EXPORT_DIR", str(tmp_path / "exports"))
    store = MetadataStore(":memory:")
    store.bootstrap()
    app = create_app(store=store, data=DuckDBStore(None))
    client = TestClient(app)
    bases: BasesService = app.state.bases
    keys: KeysService = app.state.keys
    atrib: AtribuicaoService = app.state.atribuicoes

    _csv(tmp_path / "o.csv", [("K1", "111"), ("K2", "222")])
    _csv(tmp_path / "d.csv", [("K1", ""), ("K3", "")])
    [bo] = bases.create_bases([{"tipo": "CONTABIL", "subtype": "x", "arquivo_caminho": str(tmp_path / "o.csv")}])
    [bd] = bases.create_bases([{"tipo": "FISCAL", "subtype": "x", "arquivo_caminho": str(tmp_path / "d.csv")}])
    for bid in (bo["id"], bd["id"]):
        bases.enqueue_ingest(bid)
        process_pending_once(store, "ingest_jobs", lambda r: bases.process_ingest(r["base_id"]))
    ck = keys.create_key(nome="ck", base_tipo="CONTABIL", base_subtipo="x", columns=["nota"])
    fk = keys.create_key(nome="fk", base_tipo="FISCAL", base_subtipo="x", columns=["nota"])
    pair = keys.create_pair(nome="p", contabil_key_id=ck["id"], fiscal_key_id=fk["id"])

    # create (201) → CREATED
    resp = client.post("/api/atribuicoes/runs", json=_body(bo, bd, pair))
    assert resp.status_code == 201
    rid = resp.json()["id"]

    # export antes de rodar → 409
    assert client.get(f"/api/atribuicoes/runs/{rid}/export").status_code == 409

    # start → 200 started
    assert client.post(f"/api/atribuicoes/runs/{rid}/start").json()["status"] == "started"
    process_pending_once(store, "atribuicao_runs", atrib.process)

    # get + results
    assert client.get(f"/api/atribuicoes/runs/{rid}").json()["status"] == "DONE"
    assert client.get(f"/api/atribuicoes/runs/{rid}/results").json()["total"] == 1

    # export → processing → worker → download
    assert client.get(f"/api/atribuicoes/runs/{rid}/export").json()["status"] == "processing"
    process_pending_once(store, "atribuicao_export_jobs", atrib.process_export)
    exp = client.get(f"/api/atribuicoes/runs/{rid}/export").json()
    assert exp["status"] == "ready"
    dl = client.get(f"/api/atribuicoes/runs/{rid}/download-xlsx")
    assert dl.status_code == 200 and "spreadsheetml.sheet" in dl.headers["content-type"]

    assert client.delete(f"/api/atribuicoes/runs/{rid}").json() == {"success": True}
