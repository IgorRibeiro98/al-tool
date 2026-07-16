"""ConfigsService — CRUD de configs de conciliação/estorno/cancelamento/mapeamento.

Conciliação: as `keys` do contrato (keys_pair_id ou contabil/fiscal_key_id) são resolvidas
para colunas e guardadas denormalizadas (`chaves_contabil`/`chaves_fiscal`) — o que o engine
consome — e também em `configs_conciliacao_keys` para a response expandida do contrato.
Convenções: GET lista = array puro; create = 201; delete = 204 sem corpo.
"""

from __future__ import annotations

import json
from typing import Any

from ..metadata.store import MetadataStore
from .keys import KeysService


class ConfigNotFound(Exception):
    pass


class ConfigsService:
    def __init__(self, store: MetadataStore, keys: KeysService | None = None) -> None:
        self._store = store
        self._keys = keys or KeysService(store)

    # ============================================================ conciliação
    def list_conciliacao(self) -> list[dict[str, Any]]:
        rows = self._store.query_all("SELECT id FROM configs_conciliacao ORDER BY id DESC")
        return [self.get_conciliacao(int(r["id"])) for r in rows]  # type: ignore[misc]

    def get_conciliacao(self, config_id: int) -> dict[str, Any] | None:
        row = self._store.query_one("SELECT * FROM configs_conciliacao WHERE id = ?", (config_id,))
        if row is None:
            return None
        d = dict(row)
        d["chaves_contabil"] = json.loads(d["chaves_contabil"] or "{}")
        d["chaves_fiscal"] = json.loads(d["chaves_fiscal"] or "{}")
        d["inverter_sinal_fiscal"] = bool(d["inverter_sinal_fiscal"])
        d["keys"] = self._expanded_keys(config_id)
        return d

    def create_conciliacao_from_body(self, body: dict[str, Any]) -> dict[str, Any]:
        chaves_c, chaves_f, key_rows = self._resolve_keys(body.get("keys") or [])
        if not key_rows:
            raise ValueError("keys é obrigatório (>=1)")
        cid = self._insert_conciliacao(body, chaves_c, chaves_f, key_rows)
        return self.get_conciliacao(cid)  # type: ignore[return-value]

    def update_conciliacao(self, config_id: int, body: dict[str, Any]) -> dict[str, Any]:
        if self.get_conciliacao(config_id) is None:
            raise ConfigNotFound()
        chaves_c, chaves_f, key_rows = self._resolve_keys(body.get("keys") or [])
        with self._store.tx() as con:
            con.execute(
                "UPDATE configs_conciliacao SET nome=?, base_contabil_id=?, base_fiscal_id=?, "
                "chaves_contabil=?, chaves_fiscal=?, coluna_conciliacao_contabil=?, "
                "coluna_conciliacao_fiscal=?, inverter_sinal_fiscal=?, "
                "limite_diferenca_imaterial=?, updated_at=datetime('now') WHERE id=?",
                (body.get("nome"), body.get("base_contabil_id"), body.get("base_fiscal_id"),
                 json.dumps(chaves_c), json.dumps(chaves_f),
                 body.get("coluna_conciliacao_contabil"), body.get("coluna_conciliacao_fiscal"),
                 1 if body.get("inverter_sinal_fiscal") else 0,
                 float(body.get("limite_diferenca_imaterial") or 0), config_id),
            )
            con.execute("DELETE FROM configs_conciliacao_keys WHERE config_conciliacao_id=?", (config_id,))
            self._insert_keys(con, config_id, key_rows)
        return self.get_conciliacao(config_id)  # type: ignore[return-value]

    def delete_conciliacao(self, config_id: int) -> None:
        with self._store.tx() as con:
            con.execute("DELETE FROM configs_conciliacao_keys WHERE config_conciliacao_id=?", (config_id,))
            con.execute("DELETE FROM configs_conciliacao WHERE id=?", (config_id,))

    # ---- interno: usado pelo ConciliacaoService (chaves diretas, sem keys UI)
    def create_conciliacao(
        self, *, nome: str, base_contabil_id: int, base_fiscal_id: int,
        chaves_contabil: dict[str, list[str]], chaves_fiscal: dict[str, list[str]],
        coluna_conciliacao_contabil: str, coluna_conciliacao_fiscal: str,
        inverter_sinal_fiscal: bool = False, limite_diferenca_imaterial: float = 0.0,
    ) -> dict[str, Any]:
        body = {
            "nome": nome, "base_contabil_id": base_contabil_id, "base_fiscal_id": base_fiscal_id,
            "coluna_conciliacao_contabil": coluna_conciliacao_contabil,
            "coluna_conciliacao_fiscal": coluna_conciliacao_fiscal,
            "inverter_sinal_fiscal": inverter_sinal_fiscal,
            "limite_diferenca_imaterial": limite_diferenca_imaterial,
        }
        cid = self._insert_conciliacao(body, chaves_contabil, chaves_fiscal, [])
        return self.get_conciliacao(cid)  # type: ignore[return-value]

    def _insert_conciliacao(
        self, body: dict[str, Any], chaves_c: dict, chaves_f: dict, key_rows: list[dict]
    ) -> int:
        with self._store.tx() as con:
            cur = con.execute(
                "INSERT INTO configs_conciliacao (nome, base_contabil_id, base_fiscal_id, "
                "chaves_contabil, chaves_fiscal, coluna_conciliacao_contabil, "
                "coluna_conciliacao_fiscal, inverter_sinal_fiscal, limite_diferenca_imaterial) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (body.get("nome"), body.get("base_contabil_id"), body.get("base_fiscal_id"),
                 json.dumps(chaves_c), json.dumps(chaves_f),
                 body.get("coluna_conciliacao_contabil"), body.get("coluna_conciliacao_fiscal"),
                 1 if body.get("inverter_sinal_fiscal") else 0,
                 float(body.get("limite_diferenca_imaterial") or 0)),
            )
            cid = int(cur.lastrowid or 0)
            self._insert_keys(con, cid, key_rows)
        return cid

    def _insert_keys(self, con: Any, config_id: int, key_rows: list[dict]) -> None:
        for kr in key_rows:
            con.execute(
                "INSERT INTO configs_conciliacao_keys (config_conciliacao_id, key_identifier, "
                "keys_pair_id, contabil_key_id, fiscal_key_id, ordem) VALUES (?,?,?,?,?,?)",
                (config_id, kr["key_identifier"], kr.get("keys_pair_id"),
                 kr.get("contabil_key_id"), kr.get("fiscal_key_id"), kr.get("ordem", 0)),
            )

    def _resolve_keys(self, keys: list[dict]) -> tuple[dict, dict, list[dict]]:
        chaves_c: dict[str, list[str]] = {}
        chaves_f: dict[str, list[str]] = {}
        rows: list[dict] = []
        for i, k in enumerate(keys):
            kid = k.get("key_identifier") or f"CHAVE_{i + 1}"
            if k.get("keys_pair_id"):
                cols = self._keys.pair_columns(int(k["keys_pair_id"]))
                cc, fc = cols["contabil"], cols["fiscal"]
            elif k.get("contabil_key_id") and k.get("fiscal_key_id"):
                cc = (self._keys.get_key(int(k["contabil_key_id"])) or {}).get("columns", [])
                fc = (self._keys.get_key(int(k["fiscal_key_id"])) or {}).get("columns", [])
            else:
                raise ValueError("cada key precisa de keys_pair_id ou contabil_key_id+fiscal_key_id")
            chaves_c[kid], chaves_f[kid] = cc, fc
            rows.append({"key_identifier": kid, "keys_pair_id": k.get("keys_pair_id"),
                         "contabil_key_id": k.get("contabil_key_id"),
                         "fiscal_key_id": k.get("fiscal_key_id"), "ordem": k.get("ordem", i)})
        return chaves_c, chaves_f, rows

    def _expanded_keys(self, config_id: int) -> list[dict[str, Any]]:
        rows = self._store.query_all(
            "SELECT * FROM configs_conciliacao_keys WHERE config_conciliacao_id = ? "
            "ORDER BY ordem, id", (config_id,),
        )
        out = []
        for r in rows:
            d = dict(r)
            d["keys_pair"] = self._keys.get_pair(d["keys_pair_id"]) if d["keys_pair_id"] else None
            d["contabil_key"] = self._keys.get_key(d["contabil_key_id"]) if d["contabil_key_id"] else None
            d["fiscal_key"] = self._keys.get_key(d["fiscal_key_id"]) if d["fiscal_key_id"] else None
            out.append(d)
        return out

    # ============================================================ estorno
    def list_estorno(self) -> list[dict[str, Any]]:
        return [dict(r) for r in self._store.query_all("SELECT * FROM configs_estorno ORDER BY id DESC")]

    def get_estorno(self, config_id: int) -> dict[str, Any] | None:
        row = self._store.query_one("SELECT * FROM configs_estorno WHERE id = ?", (config_id,))
        return dict(row) if row else None

    def create_estorno(
        self, *, nome: str, coluna_a: str, coluna_b: str, coluna_soma: str,
        base_id: int | None = None, limite_zero: float = 0.0, ativa: bool = True,
    ) -> dict[str, Any]:
        with self._store.tx() as con:
            cur = con.execute(
                "INSERT INTO configs_estorno (base_id, nome, coluna_a, coluna_b, coluna_soma, "
                "limite_zero, ativa) VALUES (?,?,?,?,?,?,?)",
                (base_id, nome, coluna_a, coluna_b, coluna_soma, float(limite_zero), int(ativa)),
            )
            eid = int(cur.lastrowid or 0)
        return self.get_estorno(eid)  # type: ignore[return-value]

    def update_estorno(self, config_id: int, body: dict[str, Any]) -> dict[str, Any]:
        if self.get_estorno(config_id) is None:
            raise ConfigNotFound()
        with self._store.tx() as con:
            con.execute(
                "UPDATE configs_estorno SET nome=?, coluna_a=?, coluna_b=?, coluna_soma=?, "
                "base_id=?, limite_zero=?, ativa=?, updated_at=datetime('now') WHERE id=?",
                (body.get("nome"), body.get("coluna_a"), body.get("coluna_b"),
                 body.get("coluna_soma"), body.get("base_id"),
                 float(body.get("limite_zero") or 0),
                 1 if body.get("ativa", True) else 0, config_id),
            )
        return self.get_estorno(config_id)  # type: ignore[return-value]

    def delete_estorno(self, config_id: int) -> None:
        with self._store.tx() as con:
            con.execute("DELETE FROM configs_estorno WHERE id = ?", (config_id,))

    # ============================================================ cancelamento
    def list_cancelamento(self) -> list[dict[str, Any]]:
        return [dict(r) for r in self._store.query_all("SELECT * FROM configs_cancelamento ORDER BY id DESC")]

    def get_cancelamento(self, config_id: int) -> dict[str, Any] | None:
        row = self._store.query_one("SELECT * FROM configs_cancelamento WHERE id = ?", (config_id,))
        return dict(row) if row else None

    def create_cancelamento(
        self, *, nome: str, coluna_indicador: str, valor_cancelado: str,
        valor_nao_cancelado: str = "N", base_id: int | None = None, ativa: bool = True,
    ) -> dict[str, Any]:
        with self._store.tx() as con:
            cur = con.execute(
                "INSERT INTO configs_cancelamento (base_id, nome, coluna_indicador, "
                "valor_cancelado, valor_nao_cancelado, ativa) VALUES (?,?,?,?,?,?)",
                (base_id, nome, coluna_indicador, valor_cancelado, valor_nao_cancelado, int(ativa)),
            )
            cid = int(cur.lastrowid or 0)
        return self.get_cancelamento(cid)  # type: ignore[return-value]

    def update_cancelamento(self, config_id: int, body: dict[str, Any]) -> dict[str, Any]:
        if self.get_cancelamento(config_id) is None:
            raise ConfigNotFound()
        with self._store.tx() as con:
            con.execute(
                "UPDATE configs_cancelamento SET nome=?, coluna_indicador=?, valor_cancelado=?, "
                "valor_nao_cancelado=?, base_id=?, ativa=?, updated_at=datetime('now') WHERE id=?",
                (body.get("nome"), body.get("coluna_indicador"), body.get("valor_cancelado"),
                 body.get("valor_nao_cancelado", "N"), body.get("base_id"),
                 1 if body.get("ativa", True) else 0, config_id),
            )
        return self.get_cancelamento(config_id)  # type: ignore[return-value]

    def delete_cancelamento(self, config_id: int) -> None:
        with self._store.tx() as con:
            con.execute("DELETE FROM configs_cancelamento WHERE id = ?", (config_id,))

    # ============================================================ mapeamento
    def list_mapeamento(self) -> list[dict[str, Any]]:
        rows = self._store.query_all("SELECT * FROM configs_mapeamento_bases ORDER BY id DESC")
        return [self._parse_map(dict(r)) for r in rows]

    def get_mapeamento(self, config_id: int) -> dict[str, Any] | None:
        row = self._store.query_one("SELECT * FROM configs_mapeamento_bases WHERE id = ?", (config_id,))
        return self._parse_map(dict(row)) if row else None

    def create_mapeamento(
        self, *, nome: str, base_contabil_id: int, base_fiscal_id: int, mapeamentos: Any,
    ) -> dict[str, Any]:
        maps = mapeamentos if isinstance(mapeamentos, list) else json.loads(mapeamentos or "[]")
        with self._store.tx() as con:
            cur = con.execute(
                "INSERT INTO configs_mapeamento_bases (nome, base_contabil_id, base_fiscal_id, "
                "mapeamentos) VALUES (?,?,?,?)",
                (nome, base_contabil_id, base_fiscal_id, json.dumps(maps)),
            )
            mid = int(cur.lastrowid or 0)
        return self.get_mapeamento(mid)  # type: ignore[return-value]

    def update_mapeamento(self, config_id: int, body: dict[str, Any]) -> dict[str, Any]:
        if self.get_mapeamento(config_id) is None:
            raise ConfigNotFound()
        maps = body.get("mapeamentos")
        maps = maps if isinstance(maps, list) else json.loads(maps or "[]")
        with self._store.tx() as con:
            con.execute(
                "UPDATE configs_mapeamento_bases SET nome=?, base_contabil_id=?, base_fiscal_id=?, "
                "mapeamentos=?, updated_at=datetime('now') WHERE id=?",
                (body.get("nome"), body.get("base_contabil_id"), body.get("base_fiscal_id"),
                 json.dumps(maps), config_id),
            )
        return self.get_mapeamento(config_id)  # type: ignore[return-value]

    def delete_mapeamento(self, config_id: int) -> None:
        with self._store.tx() as con:
            con.execute("DELETE FROM configs_mapeamento_bases WHERE id = ?", (config_id,))

    @staticmethod
    def _parse_map(d: dict[str, Any]) -> dict[str, Any]:
        d["mapeamentos"] = json.loads(d.get("mapeamentos") or "[]")
        return d
