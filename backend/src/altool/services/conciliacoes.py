"""ConciliacaoService — job de conciliação: create → run (engine) → metrics → resultado.

Amarra o modelo de job (jobs_conciliacao é a própria fila via `status`), as configs
denormalizadas e o engine `run_conciliacao` (Fases 2/3) num fluxo que o frontend consome
por polling. `process` é o processador chamado pelo JobWorker.
"""

from __future__ import annotations

import os
from math import ceil
from pathlib import Path
from typing import Any

from ..engine.conciliacao import KeyDef
from ..engine.data_store import DuckDBStore
from ..engine.export import export_resultado_xlsx
from ..engine.pipeline import CancelamentoConfig, EstornoConfig, run_conciliacao
from ..metadata.store import MetadataStore
from .configs import ConfigsService

TABLE = "jobs_conciliacao"

_MEDIA = {
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".zip": "application/zip",
}


def _export_dir() -> Path:
    d = Path(os.environ.get("EXPORT_DIR") or (Path(os.environ.get("DATA_DIR", ".")) / "exports"))
    d.mkdir(parents=True, exist_ok=True)
    return d


class ConciliacaoService:
    def __init__(self, store: MetadataStore, data: DuckDBStore, configs: ConfigsService) -> None:
        self._store = store
        self._data = data
        self._configs = configs

    # ------------------------------------------------------------------ create
    def create_job(self, body: dict[str, Any]) -> dict[str, Any]:
        config_id = body.get("configConciliacaoId")
        if not config_id or self._configs.get_conciliacao(int(config_id)) is None:
            raise ValueError("configConciliacaoId inválido")
        with self._store.tx() as con:
            cur = con.execute(
                f"INSERT INTO {TABLE} (nome, status, config_conciliacao_id, config_estorno_id, "
                "config_cancelamento_id, config_mapeamento_id, base_contabil_id_override, "
                "base_fiscal_id_override, pipeline_stage, pipeline_progress) "
                "VALUES (?, 'PENDING', ?, ?, ?, ?, ?, ?, 'queued', 0)",
                (body.get("nome"), int(config_id),
                 _int_or_none(body.get("configEstornoId")),
                 _int_or_none(body.get("configCancelamentoId")),
                 _int_or_none(body.get("configMapeamentoId")),
                 _int_or_none(body.get("baseContabilId")),
                 _int_or_none(body.get("baseFiscalId"))),
            )
            jid = int(cur.lastrowid or 0)
        return self._job(jid)  # type: ignore[return-value]

    # ------------------------------------------------------------------ process
    def process(self, job: Any) -> None:
        job_id = int(job["id"])
        config = self._configs.get_conciliacao(int(job["config_conciliacao_id"]))
        if config is None:
            raise ValueError("config de conciliação não encontrada")

        base_a_id = job["base_contabil_id_override"] or config["base_contabil_id"]
        base_b_id = job["base_fiscal_id_override"] or config["base_fiscal_id"]
        table_a = self._base_table(base_a_id)
        table_b = self._base_table(base_b_id)

        keys = _build_keys(config["chaves_contabil"], config["chaves_fiscal"])
        if not keys:
            raise ValueError("config sem chaves")

        estorno = None
        if job["config_estorno_id"]:
            e = self._configs.get_estorno(int(job["config_estorno_id"]))
            if e:
                estorno = EstornoConfig(
                    col_a=e["coluna_a"], col_b=e["coluna_b"], col_soma=e["coluna_soma"],
                    limite_zero=float(e["limite_zero"] or 0),
                )
        cancelamento = None
        if job["config_cancelamento_id"]:
            c = self._configs.get_cancelamento(int(job["config_cancelamento_id"]))
            if c:
                cancelamento = CancelamentoConfig(
                    coluna=c["coluna_indicador"], valor_cancelado=c["valor_cancelado"],
                )

        result_table = f"conciliacao_result_{job_id}"
        with self._data.use() as con:
            run_conciliacao(
                con, keys,
                value_col_a=config["coluna_conciliacao_contabil"],
                value_col_b=config["coluna_conciliacao_fiscal"],
                inverter=config["inverter_sinal_fiscal"],
                limite=float(config["limite_diferenca_imaterial"] or 0),
                estorno=estorno, cancelamento=cancelamento,
                table_a=table_a, table_b=table_b, result=result_table,
            )
        with self._store.tx() as con:
            con.execute(
                f"UPDATE {TABLE} SET pipeline_stage='done', pipeline_progress=100, "
                "result_table_name=?, updated_at=datetime('now') WHERE id=?",
                (result_table, job_id),
            )

    # ------------------------------------------------------------------ read
    def list_jobs(self, *, page: int = 1, page_size: int = 20, status: str | None = None) -> dict:
        where, params = ("", ())
        if status:
            where, params = (" WHERE status = ?", (status,))
        total = self._store.query_one(f"SELECT count(*) c FROM {TABLE}{where}", params)["c"]  # type: ignore[index]
        offset = (page - 1) * page_size
        rows = self._store.query_all(
            f"SELECT * FROM {TABLE}{where} ORDER BY id DESC LIMIT ? OFFSET ?",
            params + (page_size, offset),
        )
        return {
            "page": page, "pageSize": page_size, "total": total,
            "totalPages": ceil(total / page_size) if page_size else 0,
            "data": [dict(r) for r in rows],
        }

    def get_with_metrics(self, job_id: int) -> dict[str, Any] | None:
        job = self._job(job_id)
        if job is None:
            return None
        return {"job": job, "metrics": self._metrics(job)}

    def resultado(
        self, job_id: int, *, page: int = 1, page_size: int = 50,
        status: str | None = None, search: str | None = None, search_column: str | None = None,
    ) -> dict[str, Any] | None:
        job = self._job(job_id)
        if job is None:
            return None
        table = job.get("result_table_name") or f"conciliacao_result_{job_id}"
        with self._data.use() as con:
            if not _table_exists(con, table):
                return {"page": page, "pageSize": page_size, "total": 0, "totalPages": 0,
                        "data": [], "keys": []}
            cols = [d[0] for d in con.execute(f'SELECT * FROM "{table}" LIMIT 0').description]
            where, params = _result_filter(status, search, search_column, cols)
            total = con.execute(f'SELECT count(*) FROM "{table}"{where}', params).fetchone()[0]
            offset = (page - 1) * page_size
            recs = con.execute(
                f'SELECT * FROM "{table}"{where} ORDER BY row_id LIMIT ? OFFSET ?',
                params + [page_size, offset],
            ).fetchall()
            data = [dict(zip(cols, r)) for r in recs]
            import re
            keys = [c for c in cols if re.fullmatch(r"CHAVE_\d+", c)]
        return {
            "page": page, "pageSize": page_size, "total": total,
            "totalPages": ceil(total / page_size) if page_size else 0,
            "data": data, "keys": keys,
        }

    # ------------------------------------------------------------------ export
    def exportar(self, job_id: int) -> tuple[int, dict[str, Any]]:
        """Dispara/retorna o export. (404 sem job, 409 se não DONE, 200 se já existe, 202 senão)."""
        job = self._job(job_id)
        if job is None:
            return 404, {"error": "job not found"}
        if job.get("status") != "DONE":
            return 409, {"error": "job not completed yet"}
        arq = job.get("arquivo_exportado")
        if arq and Path(arq).exists():
            return 200, {"path": arq, "filename": Path(arq).name}
        with self._store.tx() as con:
            cur = con.execute(
                "INSERT INTO export_jobs (conciliacao_id, status) VALUES (?, 'PENDING')", (job_id,)
            )
            export_job_id = int(cur.lastrowid or 0)
            con.execute(
                f"UPDATE {TABLE} SET export_status='PENDING', export_progress=0, "
                "updated_at=datetime('now') WHERE id=?", (job_id,),
            )
        return 202, {"jobId": export_job_id, "status": "export_started"}

    def process_export(self, export_row: Any) -> None:
        """Processador do export_job: gera o XLSX e atualiza export_status no job."""
        job_id = int(export_row["conciliacao_id"])
        job = self._job(job_id)
        if job is None:
            raise ValueError("job de conciliação não encontrado")
        table = job.get("result_table_name") or f"conciliacao_result_{job_id}"
        out_path = _export_dir() / f"conciliacao_{job_id}.xlsx"
        self._set_export(job_id, "RUNNING", 0)
        try:
            with self._data.use() as con:
                export_resultado_xlsx(con, table, str(out_path))
        except Exception:
            self._set_export(job_id, "FAILED", None)
            raise
        with self._store.tx() as con:
            con.execute(
                f"UPDATE {TABLE} SET arquivo_exportado=?, export_status='READY', "
                "export_progress=100, updated_at=datetime('now') WHERE id=?",
                (str(out_path), job_id),
            )

    def export_status(self, job_id: int) -> dict[str, Any] | None:
        job = self._job(job_id)
        if job is None:
            return None
        return {
            "id": job_id, "export_status": job.get("export_status"),
            "export_progress": job.get("export_progress"),
            "arquivo_exportado": job.get("arquivo_exportado"),
        }

    def download_info(self, job_id: int) -> dict[str, Any] | None:
        job = self._job(job_id)
        arq = job.get("arquivo_exportado") if job else None
        if not arq or not Path(arq).exists():
            return None
        p = Path(arq)
        return {"path": str(p), "filename": p.name,
                "media_type": _MEDIA.get(p.suffix.lower(), "application/octet-stream")}

    def _set_export(self, job_id: int, status: str, progress: float | None) -> None:
        with self._store.tx() as con:
            con.execute(
                f"UPDATE {TABLE} SET export_status=?, export_progress=?, "
                "updated_at=datetime('now') WHERE id=?", (status, progress, job_id),
            )

    def delete(self, job_id: int) -> dict[str, Any]:
        job = self._job(job_id)
        table = (job or {}).get("result_table_name") or f"conciliacao_result_{job_id}"
        with self._data.use() as con:
            con.execute(f'DROP TABLE IF EXISTS "{table}"')
        with self._store.tx() as con:
            con.execute(f"DELETE FROM {TABLE} WHERE id = ?", (job_id,))
        return {"success": True}

    # ------------------------------------------------------------------ helpers
    def _job(self, job_id: int) -> dict[str, Any] | None:
        row = self._store.query_one(f"SELECT * FROM {TABLE} WHERE id = ?", (job_id,))
        return dict(row) if row else None

    def _base_table(self, base_id: object) -> str:
        row = self._store.query_one(
            "SELECT tabela_sqlite FROM bases WHERE id = ?", (base_id,)
        )
        if row is None or not row["tabela_sqlite"]:
            raise ValueError(f"base {base_id} não ingerida")
        return str(row["tabela_sqlite"])

    def _metrics(self, job: dict[str, Any]) -> dict[str, Any]:
        table = job.get("result_table_name") or f"conciliacao_result_{job['id']}"
        with self._data.use() as con:
            if not _table_exists(con, table):
                return {"totalRows": 0, "byStatus": [], "byGroup": []}
            total = con.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]
            by_status = [
                {"status": r[0], "count": r[1]}
                for r in con.execute(
                    f'SELECT status, count(*) FROM "{table}" GROUP BY status ORDER BY 2 DESC'
                ).fetchall()
            ]
            by_group = [
                {"grupo": r[0], "count": r[1]}
                for r in con.execute(
                    f'SELECT grupo, count(*) FROM "{table}" GROUP BY grupo ORDER BY 2 DESC'
                ).fetchall()
            ]
        return {"totalRows": total, "byStatus": by_status, "byGroup": by_group}


def _build_keys(chaves_a: dict[str, list[str]], chaves_b: dict[str, list[str]]) -> list[KeyDef]:
    keys: list[KeyDef] = []
    for kid in chaves_a:
        cols_a = chaves_a.get(kid) or []
        cols_b = chaves_b.get(kid) or cols_a
        if cols_a and cols_b:
            keys.append(KeyDef(kid, cols_a, cols_b))
    return keys


def _int_or_none(v: object) -> int | None:
    if v in (None, "", "config"):
        return None
    try:
        return int(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _table_exists(con: Any, table: str) -> bool:
    return con.execute(
        "SELECT 1 FROM information_schema.tables WHERE table_name = ?", (table,)
    ).fetchone() is not None


def _result_filter(
    status: str | None, search: str | None, search_column: str | None, cols: list[str]
) -> tuple[str, list[object]]:
    clauses: list[str] = []
    params: list[object] = []
    if status == "__NULL__":
        clauses.append("status IS NULL")
    elif status:
        clauses.append("status = ?")
        params.append(status)
    if search and search_column and search_column in cols:
        clauses.append(f'CAST("{search_column}" AS VARCHAR) ILIKE ?')
        params.append(f"%{search}%")
    return ((" WHERE " + " AND ".join(clauses)) if clauses else "", params)
