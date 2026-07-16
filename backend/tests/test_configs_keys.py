"""Routers de configs/keys/keys-pairs — CRUD e convenções do contrato."""

from __future__ import annotations

from fastapi.testclient import TestClient

from altool.api.app import create_app
from altool.engine.data_store import DuckDBStore
from altool.metadata.store import MetadataStore


def _client():  # type: ignore[no-untyped-def]
    store = MetadataStore(":memory:")
    store.bootstrap()
    return TestClient(create_app(store=store, data=DuckDBStore(None)))


def _mk_pair(client):  # type: ignore[no-untyped-def]
    ck = client.post("/api/keys", json={"nome": "ck", "base_tipo": "CONTABIL",
                                        "base_subtipo": "x", "columns": ["nota"]}).json()
    fk = client.post("/api/keys", json={"nome": "fk", "base_tipo": "FISCAL",
                                        "base_subtipo": "x", "columns": ["nf"]}).json()
    pair = client.post("/api/keys-pairs", json={"nome": "p", "contabil_key_id": ck["id"],
                                                "fiscal_key_id": fk["id"]}).json()
    return ck, fk, pair


# ------------------------------------------------------------------ keys
def test_keys_crud_envelope_e_delete_bloqueante() -> None:
    client = _client()
    r = client.post("/api/keys", json={"nome": "k", "base_tipo": "CONTABIL",
                                       "base_subtipo": "x", "columns": ["a", "b"]})
    assert r.status_code == 201
    kid = r.json()["id"]
    assert r.json()["columns"] == ["a", "b"]

    # list = envelope {data, meta}
    lst = client.get("/api/keys").json()
    assert lst["meta"]["total"] == 1 and len(lst["data"]) == 1

    # update
    up = client.put(f"/api/keys/{kid}", json={"columns": ["a"]}).json()
    assert up["columns"] == ["a"]

    # delete → 204
    assert client.delete(f"/api/keys/{kid}").status_code == 204
    assert client.get(f"/api/keys/{kid}").status_code == 404


def test_key_em_uso_nao_deleta() -> None:
    client = _client()
    ck, _fk, _pair = _mk_pair(client)
    # ck está referenciada pelo pair → 400
    assert client.delete(f"/api/keys/{ck['id']}").status_code == 400


# ------------------------------------------------------------------ keys-pairs
def test_keys_pairs_crud_expandido() -> None:
    client = _client()
    _ck, _fk, pair = _mk_pair(client)
    assert pair["contabil_key"]["columns"] == ["nota"]
    assert pair["fiscal_key"]["columns"] == ["nf"]

    lst = client.get("/api/keys-pairs").json()
    assert lst["meta"]["total"] == 1
    assert client.delete(f"/api/keys-pairs/{pair['id']}").status_code == 204


# ------------------------------------------------------------------ configs conciliação
def test_config_conciliacao_resolve_keys() -> None:
    client = _client()
    _ck, _fk, pair = _mk_pair(client)
    body = {
        "nome": "cfg", "base_contabil_id": 1, "base_fiscal_id": 2,
        "keys": [{"key_identifier": "CHAVE_1", "keys_pair_id": pair["id"]}],
        "coluna_conciliacao_contabil": "valor", "coluna_conciliacao_fiscal": "valor",
        "inverter_sinal_fiscal": True, "limite_diferenca_imaterial": 0.5,
    }
    r = client.post("/api/configs/conciliacao", json=body)
    assert r.status_code == 201
    cfg = r.json()
    # chaves denormalizadas resolvidas a partir do par
    assert cfg["chaves_contabil"] == {"CHAVE_1": ["nota"]}
    assert cfg["chaves_fiscal"] == {"CHAVE_1": ["nf"]}
    assert cfg["inverter_sinal_fiscal"] is True
    # keys expandidas
    assert cfg["keys"][0]["keys_pair"]["id"] == pair["id"]

    # GET lista = ARRAY puro (sem envelope)
    lst = client.get("/api/configs/conciliacao").json()
    assert isinstance(lst, list) and len(lst) == 1

    # DELETE = 204 sem corpo
    resp = client.delete(f"/api/configs/conciliacao/{cfg['id']}")
    assert resp.status_code == 204 and resp.content == b""
    assert client.get(f"/api/configs/conciliacao/{cfg['id']}").status_code == 404


def test_config_conciliacao_key_sem_par_400() -> None:
    client = _client()
    body = {"nome": "x", "keys": [{"key_identifier": "CHAVE_1"}],
            "coluna_conciliacao_contabil": "v", "coluna_conciliacao_fiscal": "v"}
    assert client.post("/api/configs/conciliacao", json=body).status_code == 400


# ------------------------------------------------------------------ estorno / cancelamento / mapeamento
def test_estorno_array_e_204() -> None:
    client = _client()
    r = client.post("/api/configs/estorno", json={"nome": "e", "coluna_a": "a",
                                                  "coluna_b": "b", "coluna_soma": "s"})
    assert r.status_code == 201
    eid = r.json()["id"]
    assert isinstance(client.get("/api/configs/estorno").json(), list)
    assert client.delete(f"/api/configs/estorno/{eid}").status_code == 204


def test_cancelamento_crud() -> None:
    client = _client()
    r = client.post("/api/configs/cancelamento", json={"nome": "c", "coluna_indicador": "ind",
                                                       "valor_cancelado": "S", "valor_nao_cancelado": "N"})
    assert r.status_code == 201
    cid = r.json()["id"]
    assert client.get(f"/api/configs/cancelamento/{cid}").json()["valor_cancelado"] == "S"
    assert client.delete(f"/api/configs/cancelamento/{cid}").status_code == 204


def test_mapeamento_parse() -> None:
    client = _client()
    maps = [{"coluna_contabil": "a", "coluna_fiscal": "x"}]
    r = client.post("/api/configs/mapeamento", json={"nome": "m", "base_contabil_id": 1,
                                                     "base_fiscal_id": 2, "mapeamentos": maps})
    assert r.status_code == 201
    assert r.json()["mapeamentos"] == maps
    assert client.get("/api/configs/mapeamento/99999").status_code == 404
