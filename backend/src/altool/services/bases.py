"""BasesService — CRUD de bases + ingestão assíncrona (processador de job).

Espelha routes/bases.ts no essencial: list paginada enriquecida com estado de ingest,
get com rowCount, columns, preview, ingest (enfileira job), delete. `process_ingest` é o
processador chamado pelo JobWorker: ingere o arquivo no DuckDB (base_{id}) e popula base_columns.
"""

from __future__ import annotations

import sqlite3
from math import ceil
from typing import Any

from ..engine.data_store import DuckDBStore
from ..engine.ingest import IngestSpec, column_mapping, ingest, numeric_sql
from ..metadata.store import MetadataStore
from .jobs import enqueue_ingest, latest_ingest_job_for_base

_ACTIVE = ("PENDING", "RUNNING")
_DERIVED_SYNC_MAX = 10_000  # acima disso, derivação vira job assíncrono (igual à v1)
_DERIVED_OPS = {"ABS": "abs", "INVERTER": "-1 *"}


class BasesService:
    def __init__(self, store: MetadataStore, data: DuckDBStore) -> None:
        self._store = store
        self._data = data

    # ------------------------------------------------------------------ create
    def create_bases(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        created: list[int] = []
        with self._store.tx() as con:
            for it in items:
                cur = con.execute(
                    "INSERT INTO bases (tipo, nome, periodo, arquivo_caminho, "
                    "header_linha_inicial, header_coluna_inicial, subtype, reference_base_id, "
                    "conversion_status) VALUES (?,?,?,?,?,?,?,?, 'PENDING')",
                    (
                        it.get("tipo"), it.get("nome"), it.get("periodo"),
                        it.get("arquivo_caminho"),
                        int(it.get("header_linha_inicial") or 1),
                        int(it.get("header_coluna_inicial") or 1),
                        it.get("subtype"), it.get("reference_base_id"),
                    ),
                )
                created.append(int(cur.lastrowid or 0))
        return [self.get_base(bid) for bid in created]  # type: ignore[misc]

    # ------------------------------------------------------------------ read
    def list_bases(
        self, *, page: int = 1, page_size: int = 20,
        tipo: str | None = None, periodo: str | None = None, subtype: str | None = None,
    ) -> dict[str, Any]:
        where, params = [], []
        for col, val in (("tipo", tipo), ("periodo", periodo), ("subtype", subtype)):
            if val:
                where.append(f"{col} = ?")
                params.append(val)
        clause = (" WHERE " + " AND ".join(where)) if where else ""
        total = self._store.query_one(
            f"SELECT count(*) c FROM bases{clause}", tuple(params)
        )["c"]  # type: ignore[index]
        offset = (page - 1) * page_size
        rows = self._store.query_all(
            f"SELECT * FROM bases{clause} ORDER BY id DESC LIMIT ? OFFSET ?",
            tuple(params) + (page_size, offset),
        )
        return {
            "data": [self._enrich(r) for r in rows],
            "page": page, "pageSize": page_size,
            "total": total, "totalPages": ceil(total / page_size) if page_size else 0,
        }

    def get_base(self, base_id: int) -> dict[str, Any] | None:
        row = self._store.query_one("SELECT * FROM bases WHERE id = ?", (base_id,))
        if row is None:
            return None
        base = self._enrich(row)
        base["rowCount"] = self._row_count(row["tabela_sqlite"])
        return base

    def get_columns(self, base_id: int) -> list[dict[str, Any]]:
        rows = self._store.query_all(
            "SELECT * FROM base_columns WHERE base_id = ? ORDER BY col_index ASC", (base_id,)
        )
        return [dict(r) for r in rows]

    def preview(self, base_id: int, limit: int = 50) -> dict[str, Any] | None:
        row = self._store.query_one("SELECT * FROM bases WHERE id = ?", (base_id,))
        if row is None:
            return None
        table = row["tabela_sqlite"]
        if not table:
            raise ValueError("base ainda não ingerida")
        with self._data.use() as con:
            cur = con.execute(f'SELECT * FROM "{table}" LIMIT {int(limit)}')
            columns = [d[0] for d in cur.description]
            rows = [dict(zip(columns, rec)) for rec in cur.fetchall()]
        return {"columns": columns, "rows": rows}

    # ------------------------------------------------------------------ ingest
    def enqueue_ingest(self, base_id: int) -> dict[str, Any]:
        job_id = enqueue_ingest(self._store, base_id)
        return {"jobId": job_id, "status": "PENDING"}

    def process_ingest(self, base_id: int) -> None:
        """Processador do job: ingere o arquivo no DuckDB e popula base_columns."""
        base = self._store.query_one("SELECT * FROM bases WHERE id = ?", (base_id,))
        if base is None:
            raise ValueError(f"base {base_id} não encontrada")
        path = base["arquivo_caminho"]
        if not path:
            raise ValueError(f"base {base_id} sem arquivo_caminho")
        spec = IngestSpec(
            header_row=int(base["header_linha_inicial"] or 1),
            start_col=int(base["header_coluna_inicial"] or 1),
        )
        table = f"base_{base_id}"
        with self._data.use() as con:
            mapping = column_mapping(con, path, spec)
            ingest(con, path, table, spec)
        with self._store.tx() as con:
            con.execute("DELETE FROM base_columns WHERE base_id = ?", (base_id,))
            for idx, (excel, sqlite_name) in enumerate(mapping):
                con.execute(
                    "INSERT INTO base_columns (base_id, col_index, excel_name, sqlite_name, "
                    "is_monetary) VALUES (?,?,?,?,0)",
                    (base_id, idx, excel, sqlite_name),
                )
            con.execute(
                "UPDATE bases SET tabela_sqlite=?, conversion_status='READY', "
                "updated_at=datetime('now') WHERE id=?",
                (table, base_id),
            )

    # ------------------------------------------------------------------ patch
    def patch_base(self, base_id: int, body: dict[str, Any]) -> dict[str, Any] | None:
        if self.get_base(base_id) is None:
            return None
        fields, params = [], []
        for col in ("nome", "periodo", "header_linha_inicial", "header_coluna_inicial",
                    "subtype", "reference_base_id"):
            if col in body:
                fields.append(f"{col} = ?")
                params.append(body[col])
        if fields:
            with self._store.tx() as con:
                con.execute(
                    f"UPDATE bases SET {', '.join(fields)}, updated_at=datetime('now') WHERE id=?",
                    (*params, base_id),
                )
        return self.get_base(base_id)

    def patch_column(self, base_id: int, col_id: int, is_monetary: Any) -> dict[str, Any] | None:
        row = self._store.query_one(
            "SELECT * FROM base_columns WHERE id=? AND base_id=?", (col_id, base_id)
        )
        if row is None:
            return None
        val = 1 if (is_monetary in (1, True, "1", "true")) else 0
        with self._store.tx() as con:
            con.execute("UPDATE base_columns SET is_monetary=? WHERE id=?", (val, col_id))
        return dict(self._store.query_one("SELECT * FROM base_columns WHERE id=?", (col_id,)))  # type: ignore[arg-type]

    def reuse_monetary(self, base_id: int, opts: dict[str, Any]) -> dict[str, Any]:
        """Copia os flags is_monetary desta base para outras (mesmas colunas)."""
        src = {
            r["sqlite_name" if opts.get("matchBy") != "excel_name" else "excel_name"]: r["is_monetary"]
            for r in self._store.query_all(
                "SELECT * FROM base_columns WHERE base_id=? AND is_monetary=1", (base_id,)
            )
        }
        match_col = "excel_name" if opts.get("matchBy") == "excel_name" else "sqlite_name"
        targets: list[int] = list(opts.get("targetBaseIds") or [])
        if opts.get("applyToSameTipo"):
            tipo = self._store.query_one("SELECT tipo FROM bases WHERE id=?", (base_id,))
            if tipo:
                targets += [
                    int(r["id"]) for r in self._store.query_all(
                        "SELECT id FROM bases WHERE tipo=? AND id<>?", (tipo["tipo"], base_id)
                    )
                ]
        details = []
        with self._store.tx() as con:
            for tid in sorted(set(targets)):
                updated = 0
                for name, mon in src.items():
                    updated += con.execute(
                        f"UPDATE base_columns SET is_monetary=? WHERE base_id=? AND {match_col}=?"
                        + ("" if opts.get("override") else " AND is_monetary=0"),
                        (mon, tid, name),
                    ).rowcount or 0
                details.append({"baseId": tid, "updated": updated})
        return {"success": True, "details": details}

    # ------------------------------------------------------------------ derived columns
    def create_derived(self, base_id: int, source_column: str, op: str) -> dict[str, Any]:
        op = op.upper()
        if op not in _DERIVED_OPS:
            raise ValueError(f"operação inválida: {op} (use ABS ou INVERTER)")
        base = self._store.query_one("SELECT * FROM bases WHERE id=?", (base_id,))
        if base is None or not base["tabela_sqlite"]:
            raise ValueError("base não ingerida")
        rows = self._row_count(base["tabela_sqlite"]) or 0
        if rows > _DERIVED_SYNC_MAX:
            with self._store.tx() as con:
                cur = con.execute(
                    "INSERT INTO derived_column_jobs (base_id, source_column, operation, status, "
                    "total_rows) VALUES (?,?,?, 'PENDING', ?)",
                    (base_id, source_column, op, rows),
                )
                job_id = int(cur.lastrowid or 0)
            return {"success": True, "background": True, "jobId": job_id, "rowCount": rows,
                    "message": "Derivação enfileirada"}
        target = self._apply_derived(base_id, base["tabela_sqlite"], source_column, op)
        return {"success": True, "background": False, "column": target, "rowsUpdated": rows}

    def process_derived(self, base_id: int, source_column: str, op: str) -> None:
        base = self._store.query_one("SELECT tabela_sqlite FROM bases WHERE id=?", (base_id,))
        if base and base["tabela_sqlite"]:
            self._apply_derived(base_id, base["tabela_sqlite"], source_column, op)

    def _apply_derived(self, base_id: int, table: str, source: str, op: str) -> str:
        target = f"{op.lower()}_{source}"
        expr = _DERIVED_OPS[op]
        val = f"abs({numeric_sql(source)})" if op == "ABS" else f"-1 * {numeric_sql(source)}"
        with self._data.use() as con:
            cols = [d[0] for d in con.execute(f'SELECT * FROM "{table}" LIMIT 0').description]
            if target not in cols:
                con.execute(f'ALTER TABLE "{table}" ADD COLUMN "{target}" VARCHAR')
            con.execute(f'UPDATE "{table}" SET "{target}" = CAST({val} AS VARCHAR)')
        with self._store.tx() as con:
            exists = con.execute(
                "SELECT 1 FROM base_columns WHERE base_id=? AND sqlite_name=?", (base_id, target)
            ).fetchone()
            if not exists:
                idx = con.execute(
                    "SELECT coalesce(max(col_index),0)+1 FROM base_columns WHERE base_id=?", (base_id,)
                ).fetchone()[0]
                con.execute(
                    "INSERT INTO base_columns (base_id, col_index, excel_name, sqlite_name, "
                    "is_monetary) VALUES (?,?,?,?,1)", (base_id, idx, target, target),
                )
        return target

    def list_derived_jobs(self, base_id: int) -> list[dict[str, Any]]:
        return [dict(r) for r in self._store.query_all(
            "SELECT * FROM derived_column_jobs WHERE base_id=? ORDER BY id DESC", (base_id,)
        )]

    def get_derived_job(self, job_id: int) -> dict[str, Any] | None:
        row = self._store.query_one("SELECT * FROM derived_column_jobs WHERE id=?", (job_id,))
        return dict(row) if row else None

    # ------------------------------------------------------------------ subtypes
    def list_subtypes(self) -> list[dict[str, Any]]:
        return [dict(r) for r in self._store.query_all("SELECT * FROM base_subtypes ORDER BY id")]

    def get_subtype(self, sub_id: int) -> dict[str, Any] | None:
        row = self._store.query_one("SELECT * FROM base_subtypes WHERE id=?", (sub_id,))
        return dict(row) if row else None

    def create_subtype(self, name: str) -> dict[str, Any]:
        with self._store.tx() as con:
            cur = con.execute("INSERT INTO base_subtypes (name) VALUES (?)", (name,))
            sid = int(cur.lastrowid or 0)
        return self.get_subtype(sid)  # type: ignore[return-value]

    def update_subtype(self, sub_id: int, name: str | None) -> dict[str, Any] | None:
        if self.get_subtype(sub_id) is None:
            return None
        if name is not None:
            with self._store.tx() as con:
                con.execute(
                    "UPDATE base_subtypes SET name=?, updated_at=datetime('now') WHERE id=?",
                    (name, sub_id),
                )
        return self.get_subtype(sub_id)

    def delete_subtype(self, sub_id: int) -> dict[str, Any]:
        with self._store.tx() as con:
            con.execute("DELETE FROM base_subtypes WHERE id=?", (sub_id,))
        return {"success": True}

    # ------------------------------------------------------------------ delete
    def delete_base(self, base_id: int) -> dict[str, Any]:
        row = self._store.query_one("SELECT tabela_sqlite FROM bases WHERE id = ?", (base_id,))
        table = row["tabela_sqlite"] if row else None
        if table:
            with self._data.use() as con:
                con.execute(f'DROP TABLE IF EXISTS "{table}"')
        with self._store.tx() as con:
            con.execute("DELETE FROM base_columns WHERE base_id = ?", (base_id,))
            con.execute("DELETE FROM ingest_jobs WHERE base_id = ?", (base_id,))
            con.execute("DELETE FROM bases WHERE id = ?", (base_id,))
        return {"success": True}

    # ------------------------------------------------------------------ helpers
    def _enrich(self, row: sqlite3.Row) -> dict[str, Any]:
        base = dict(row)
        job = latest_ingest_job_for_base(self._store, int(row["id"]))
        base["ingest_job"] = dict(job) if job else None
        base["ingest_status"] = job["status"] if job else None
        base["ingest_in_progress"] = bool(job and job["status"] in _ACTIVE)
        return base

    def _row_count(self, table: str | None) -> int | None:
        if not table:
            return None
        with self._data.use() as con:
            exists = con.execute(
                "SELECT 1 FROM information_schema.tables WHERE table_name = ?", (table,)
            ).fetchone()
            if not exists:
                return None
            return int(con.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0])
