"""KeysService (mínimo) — keys_definitions + keys_pairs.

Uma key define as colunas de chave para um base_tipo/subtipo; um pair liga uma key contábil
a uma fiscal. `pair_columns` resolve o par para {contabil: [...], fiscal: [...]} — é o que a
atribuição/conciliação consomem. O router contract-compliant (validações completas) é fatia
separada; aqui fica o suficiente para resolver as chaves.
"""

from __future__ import annotations

import json
from math import ceil
from typing import Any

from ..metadata.store import MetadataStore


class KeyInUse(Exception):
    """Key referenciada por keys_pairs ou configs — não pode ser removida."""


class KeysService:
    def __init__(self, store: MetadataStore) -> None:
        self._store = store

    # ------------------------------------------------------------- keys: list/update/delete
    def list_keys(
        self, *, base_tipo: str | None = None, base_subtipo: str | None = None,
        nome: str | None = None, page: int = 1, page_size: int = 100,
    ) -> dict[str, Any]:
        where, params = [], []
        for col, val in (("base_tipo", base_tipo), ("base_subtipo", base_subtipo)):
            if val:
                where.append(f"{col} = ?")
                params.append(val)
        if nome:
            where.append("nome LIKE ?")
            params.append(f"%{nome}%")
        clause = (" WHERE " + " AND ".join(where)) if where else ""
        total = self._store.query_one(
            f"SELECT count(*) c FROM keys_definitions{clause}", tuple(params)
        )["c"]  # type: ignore[index]
        offset = (page - 1) * page_size
        rows = self._store.query_all(
            f"SELECT id FROM keys_definitions{clause} ORDER BY id DESC LIMIT ? OFFSET ?",
            tuple(params) + (page_size, offset),
        )
        data = [self.get_key(int(r["id"])) for r in rows]
        return {"data": data, "meta": {"total": total, "page": page, "pageSize": page_size}}

    def update_key(self, key_id: int, body: dict[str, Any]) -> dict[str, Any] | None:
        cur = self.get_key(key_id)
        if cur is None:
            return None
        with self._store.tx() as con:
            con.execute(
                "UPDATE keys_definitions SET nome=?, descricao=?, base_tipo=?, base_subtipo=?, "
                "columns=?, updated_at=datetime('now') WHERE id=?",
                (body.get("nome", cur["nome"]), body.get("descricao", cur["descricao"]),
                 body.get("base_tipo", cur["base_tipo"]), body.get("base_subtipo", cur["base_subtipo"]),
                 json.dumps(body.get("columns", cur["columns"])), key_id),
            )
        return self.get_key(key_id)

    def delete_key(self, key_id: int) -> None:
        refs = self._store.query_one(
            "SELECT (SELECT count(*) FROM keys_pairs WHERE contabil_key_id=? OR fiscal_key_id=?) "
            "+ (SELECT count(*) FROM configs_conciliacao_keys WHERE contabil_key_id=? OR fiscal_key_id=?) c",
            (key_id, key_id, key_id, key_id),
        )["c"]  # type: ignore[index]
        if refs:
            raise KeyInUse()
        with self._store.tx() as con:
            con.execute("DELETE FROM keys_definitions WHERE id = ?", (key_id,))

    def create_key(
        self, *, nome: str, base_tipo: str, base_subtipo: str, columns: list[str],
        descricao: str | None = None,
    ) -> dict[str, Any]:
        with self._store.tx() as con:
            cur = con.execute(
                "INSERT INTO keys_definitions (nome, descricao, base_tipo, base_subtipo, columns) "
                "VALUES (?,?,?,?,?)",
                (nome, descricao, base_tipo, base_subtipo, json.dumps(columns)),
            )
            kid = int(cur.lastrowid or 0)
        return self.get_key(kid)  # type: ignore[return-value]

    def get_key(self, key_id: int) -> dict[str, Any] | None:
        row = self._store.query_one("SELECT * FROM keys_definitions WHERE id = ?", (key_id,))
        if row is None:
            return None
        d = dict(row)
        d["columns"] = json.loads(d["columns"] or "[]")
        return d

    def create_pair(
        self, *, nome: str, contabil_key_id: int, fiscal_key_id: int,
        descricao: str | None = None,
    ) -> dict[str, Any]:
        with self._store.tx() as con:
            cur = con.execute(
                "INSERT INTO keys_pairs (nome, descricao, contabil_key_id, fiscal_key_id) "
                "VALUES (?,?,?,?)", (nome, descricao, contabil_key_id, fiscal_key_id),
            )
            pid = int(cur.lastrowid or 0)
        return self.get_pair(pid)  # type: ignore[return-value]

    def get_pair(self, pair_id: int) -> dict[str, Any] | None:
        row = self._store.query_one("SELECT * FROM keys_pairs WHERE id = ?", (pair_id,))
        if row is None:
            return None
        d = dict(row)
        d["contabil_key"] = self.get_key(d["contabil_key_id"]) if d["contabil_key_id"] else None
        d["fiscal_key"] = self.get_key(d["fiscal_key_id"]) if d["fiscal_key_id"] else None
        return d

    def pair_columns(self, pair_id: int) -> dict[str, list[str]]:
        """Resolve o par para {contabil: [...], fiscal: [...]}."""
        pair = self.get_pair(pair_id)
        if pair is None:
            raise ValueError(f"keys_pair {pair_id} não encontrado")
        return {
            "contabil": (pair["contabil_key"] or {}).get("columns", []),
            "fiscal": (pair["fiscal_key"] or {}).get("columns", []),
        }

    def list_pairs(self, *, page: int = 1, page_size: int = 100) -> dict[str, Any]:
        total = self._store.query_one("SELECT count(*) c FROM keys_pairs")["c"]  # type: ignore[index]
        offset = (page - 1) * page_size
        rows = self._store.query_all(
            "SELECT id FROM keys_pairs ORDER BY id DESC LIMIT ? OFFSET ?", (page_size, offset)
        )
        data = [self.get_pair(int(r["id"])) for r in rows]
        return {"data": data, "meta": {"total": total, "page": page, "pageSize": page_size}}

    def update_pair(self, pair_id: int, body: dict[str, Any]) -> dict[str, Any] | None:
        cur = self.get_pair(pair_id)
        if cur is None:
            return None
        with self._store.tx() as con:
            con.execute(
                "UPDATE keys_pairs SET nome=?, descricao=?, contabil_key_id=?, fiscal_key_id=?, "
                "updated_at=datetime('now') WHERE id=?",
                (body.get("nome", cur["nome"]), body.get("descricao", cur["descricao"]),
                 body.get("contabil_key_id", cur["contabil_key_id"]),
                 body.get("fiscal_key_id", cur["fiscal_key_id"]), pair_id),
            )
        return self.get_pair(pair_id)

    def delete_pair(self, pair_id: int) -> None:
        with self._store.tx() as con:
            con.execute("DELETE FROM keys_pairs WHERE id = ?", (pair_id,))
