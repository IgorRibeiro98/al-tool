"""AtribuicaoService — run de atribuição: create → start → run (engine) → results → export.

Fluxo em DOIS passos (fiel à v1): POST /runs cria o run (status CREATED, não roda); POST
/runs/:id/start o torna PENDING (o JobWorker então claima). O worker chama `atribuir`
(engine da Fase 3). As chaves vêm de keysPairs (resolvidas por KeysService).
"""

from __future__ import annotations

import json
import os
from math import ceil
from pathlib import Path
from typing import Any

from ..engine.atribuicao import AtribKey, AtribuicaoConfig, atribuir
from ..engine.data_store import DuckDBStore
from ..engine.export import export_resultado_xlsx
from ..metadata.store import MetadataStore
from .keys import KeysService

RUNS = "atribuicao_runs"
_VALID_TIPOS = {"CONTABIL", "FISCAL"}
_MEDIA_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _export_dir() -> Path:
    d = Path(os.environ.get("EXPORT_DIR") or (Path(os.environ.get("DATA_DIR", ".")) / "exports"))
    d.mkdir(parents=True, exist_ok=True)
    return d


class AtribuicaoService:
    def __init__(self, store: MetadataStore, data: DuckDBStore, keys: KeysService) -> None:
        self._store = store
        self._data = data
        self._keys = keys

    # ------------------------------------------------------------------ create
    def create_run(self, body: dict[str, Any]) -> dict[str, Any]:
        origem_id = body.get("baseOrigemId")
        destino_id = body.get("baseDestinoId")
        mode = body.get("modeWrite", "OVERWRITE")
        selected = body.get("selectedColumns") or []
        keys_pairs = body.get("keysPairs") or []

        if not origem_id or not destino_id:
            raise ValueError("baseOrigemId e baseDestinoId são obrigatórios")
        if origem_id == destino_id:
            raise ValueError("origem e destino devem ser diferentes")
        to = self._base_tipo(origem_id)
        td = self._base_tipo(destino_id)
        if to not in _VALID_TIPOS or td not in _VALID_TIPOS or to == td:
            raise ValueError("tipos de origem e destino devem ser FISCAL e CONTABIL distintos")
        if not keys_pairs:
            raise ValueError("keysPairs é obrigatório (>=1)")
        if mode not in ("OVERWRITE", "ONLY_EMPTY"):
            raise ValueError("modeWrite inválido")

        with self._store.tx() as con:
            cur = con.execute(
                f"INSERT INTO {RUNS} (nome, base_origem_id, base_destino_id, mode_write, "
                "selected_columns_json, update_original_base, status, pipeline_stage, "
                "pipeline_progress) VALUES (?,?,?,?,?,?, 'CREATED', 'created', 0)",
                (body.get("nome"), origem_id, destino_id, mode, json.dumps(selected),
                 1 if body.get("updateOriginalBase", True) else 0),
            )
            run_id = int(cur.lastrowid or 0)
            for i, kp in enumerate(keys_pairs):
                con.execute(
                    "INSERT INTO atribuicao_run_keys (atribuicao_run_id, keys_pair_id, "
                    "key_identifier, ordem) VALUES (?,?,?,?)",
                    (run_id, kp.get("keysPairId"),
                     kp.get("keyIdentifier") or f"CHAVE_{i + 1}", kp.get("ordem", i)),
                )
        return self.get_run(run_id)  # type: ignore[return-value]

    # ------------------------------------------------------------------ start
    def start_run(self, run_id: int) -> tuple[int, dict[str, Any]]:
        run = self._run(run_id)
        if run is None:
            return 404, {"error": "run not found"}
        if run["status"] in ("RUNNING", "DONE"):
            return 409, {"error": "run já em execução ou concluído"}
        with self._store.tx() as con:
            con.execute(
                f"UPDATE {RUNS} SET status='PENDING', updated_at=datetime('now') WHERE id=?",
                (run_id,),
            )
        return 200, {"runId": run_id, "status": "started"}

    # ------------------------------------------------------------------ process
    def process(self, run: Any) -> None:
        run_id = int(run["id"])
        origem_id, destino_id = run["base_origem_id"], run["base_destino_id"]
        origem_table = self._base_table(origem_id)
        destino_table = self._base_table(destino_id)
        origem_tipo = self._base_tipo(origem_id)
        destino_tipo = self._base_tipo(destino_id)

        run_keys = self._store.query_all(
            "SELECT * FROM atribuicao_run_keys WHERE atribuicao_run_id = ? ORDER BY ordem, id",
            (run_id,),
        )
        keys: list[AtribKey] = []
        for i, rk in enumerate(run_keys):
            cols = self._keys.pair_columns(int(rk["keys_pair_id"]))
            keys.append(AtribKey(
                key_id=rk["key_identifier"] or f"CHAVE_{i + 1}",
                origem_cols=_cols_for(cols, origem_tipo),
                destino_cols=_cols_for(cols, destino_tipo),
            ))
        if not keys:
            raise ValueError("run sem chaves")

        selected = json.loads(run["selected_columns_json"] or "[]")
        config = AtribuicaoConfig(keys=keys, selected_columns=selected, mode=run["mode_write"])
        result_table = f"atribuicao_result_{run_id}"
        with self._data.use() as con:
            atribuir(con, config, table_origem=origem_table, table_destino=destino_table,
                     result=result_table)
        with self._store.tx() as con:
            con.execute(
                f"UPDATE {RUNS} SET pipeline_stage='done', pipeline_progress=100, "
                "result_table_name=?, updated_at=datetime('now') WHERE id=?",
                (result_table, run_id),
            )

    # ------------------------------------------------------------------ read
    def list_runs(self, *, page: int = 1, page_size: int = 20, status: str | None = None) -> dict:
        where, params = ("", ())
        if status:
            where, params = (" WHERE status = ?", (status,))
        total = self._store.query_one(f"SELECT count(*) c FROM {RUNS}{where}", params)["c"]  # type: ignore[index]
        offset = (page - 1) * page_size
        rows = self._store.query_all(
            f"SELECT * FROM {RUNS}{where} ORDER BY id DESC LIMIT ? OFFSET ?",
            params + (page_size, offset),
        )
        return {
            "page": page, "pageSize": page_size, "total": total,
            "totalPages": ceil(total / page_size) if page_size else 0,
            "data": [self._enrich(dict(r)) for r in rows],
        }

    def get_run(self, run_id: int) -> dict[str, Any] | None:
        run = self._run(run_id)
        if run is None:
            return None
        d = self._enrich(run)
        d["keys"] = [dict(r) for r in self._store.query_all(
            "SELECT * FROM atribuicao_run_keys WHERE atribuicao_run_id = ? ORDER BY ordem, id",
            (run_id,),
        )]
        return d

    def results(
        self, run_id: int, *, page: int = 1, page_size: int = 50, search: str | None = None
    ) -> dict[str, Any] | None:
        run = self._run(run_id)
        if run is None:
            return None
        table = run.get("result_table_name") or f"atribuicao_result_{run_id}"
        with self._data.use() as con:
            if not _table_exists(con, table):
                return {"page": page, "pageSize": page_size, "total": 0, "totalPages": 0,
                        "data": [], "columns": []}
            cols = [d[0] for d in con.execute(f'SELECT * FROM "{table}" LIMIT 0').description]
            where, params = ("", [])
            if search:
                likes = " OR ".join(f'CAST("{c}" AS VARCHAR) ILIKE ?' for c in cols)
                where = f" WHERE {likes}"
                params = [f"%{search}%"] * len(cols)
            total = con.execute(f'SELECT count(*) FROM "{table}"{where}', params).fetchone()[0]
            offset = (page - 1) * page_size
            recs = con.execute(
                f'SELECT * FROM "{table}"{where} LIMIT ? OFFSET ?', params + [page_size, offset]
            ).fetchall()
            data = [dict(zip(cols, r)) for r in recs]
        return {
            "page": page, "pageSize": page_size, "total": total,
            "totalPages": ceil(total / page_size) if page_size else 0,
            "data": data, "columns": cols,
        }

    # ------------------------------------------------------------------ export
    def export(self, run_id: int) -> tuple[int, dict[str, Any]]:
        run = self._run(run_id)
        if run is None:
            return 404, {"error": "run not found"}
        if run["status"] != "DONE":
            return 409, {"error": "run not completed yet"}
        arq = run.get("arquivo_exportado")
        if arq and Path(arq).exists():
            return 200, {"status": "ready", "downloadUrl": f"/atribuicoes/runs/{run_id}/download-xlsx"}
        with self._store.tx() as con:
            con.execute(
                "INSERT INTO atribuicao_export_jobs (atribuicao_run_id, status) VALUES (?, 'PENDING')",
                (run_id,),
            )
            con.execute(
                f"UPDATE {RUNS} SET export_status='PENDING', export_progress=0, "
                "updated_at=datetime('now') WHERE id=?", (run_id,),
            )
        return 200, {"status": "processing", "message": "Exportação iniciada"}

    def process_export(self, export_row: Any) -> None:
        run_id = int(export_row["atribuicao_run_id"])
        run = self._run(run_id)
        if run is None:
            raise ValueError("run não encontrado")
        table = run.get("result_table_name") or f"atribuicao_result_{run_id}"
        out_path = _export_dir() / f"atribuicao_{run_id}.xlsx"
        self._set_export(run_id, "RUNNING", 0)
        try:
            with self._data.use() as con:
                export_resultado_xlsx(con, table, str(out_path), monetary_cols=())
        except Exception:
            self._set_export(run_id, "FAILED", None)
            raise
        with self._store.tx() as con:
            con.execute(
                f"UPDATE {RUNS} SET arquivo_exportado=?, export_status='READY', "
                "export_progress=100, updated_at=datetime('now') WHERE id=?",
                (str(out_path), run_id),
            )

    def download_info(self, run_id: int) -> dict[str, Any] | None:
        run = self._run(run_id)
        arq = run.get("arquivo_exportado") if run else None
        if not arq or not Path(arq).exists():
            return None
        p = Path(arq)
        return {"path": str(p), "filename": p.name, "media_type": _MEDIA_XLSX}

    # ------------------------------------------------------------------ delete
    def delete(self, run_id: int) -> tuple[int, dict[str, Any]]:
        run = self._run(run_id)
        if run is None:
            return 404, {"error": "run not found"}
        if run["status"] == "RUNNING":
            return 409, {"error": "run em execução"}
        table = run.get("result_table_name") or f"atribuicao_result_{run_id}"
        with self._data.use() as con:
            con.execute(f'DROP TABLE IF EXISTS "{table}"')
        with self._store.tx() as con:
            con.execute("DELETE FROM atribuicao_run_keys WHERE atribuicao_run_id = ?", (run_id,))
            con.execute(f"DELETE FROM {RUNS} WHERE id = ?", (run_id,))
        return 200, {"success": True}

    # ------------------------------------------------------------------ helpers
    def _run(self, run_id: int) -> dict[str, Any] | None:
        row = self._store.query_one(f"SELECT * FROM {RUNS} WHERE id = ?", (run_id,))
        return dict(row) if row else None

    def _enrich(self, run: dict[str, Any]) -> dict[str, Any]:
        run["selected_columns"] = json.loads(run.get("selected_columns_json") or "[]")
        run["update_original_base"] = bool(run.get("update_original_base"))
        run["base_origem"] = self._base_brief(run["base_origem_id"])
        run["base_destino"] = self._base_brief(run["base_destino_id"])
        return run

    def _base_brief(self, base_id: object) -> dict[str, Any] | None:
        row = self._store.query_one("SELECT id, nome, tipo FROM bases WHERE id = ?", (base_id,))
        return dict(row) if row else None

    def _base_tipo(self, base_id: object) -> str:
        row = self._store.query_one("SELECT tipo FROM bases WHERE id = ?", (base_id,))
        if row is None:
            raise ValueError(f"base {base_id} não encontrada")
        return str(row["tipo"])

    def _base_table(self, base_id: object) -> str:
        row = self._store.query_one("SELECT tabela_sqlite FROM bases WHERE id = ?", (base_id,))
        if row is None or not row["tabela_sqlite"]:
            raise ValueError(f"base {base_id} não ingerida")
        return str(row["tabela_sqlite"])

    def _set_export(self, run_id: int, status: str, progress: float | None) -> None:
        with self._store.tx() as con:
            con.execute(
                f"UPDATE {RUNS} SET export_status=?, export_progress=?, "
                "updated_at=datetime('now') WHERE id=?", (status, progress, run_id),
            )


def _cols_for(pair_cols: dict[str, list[str]], tipo: str) -> list[str]:
    return pair_cols["contabil"] if tipo == "CONTABIL" else pair_cols["fiscal"]


def _table_exists(con: Any, table: str) -> bool:
    return con.execute(
        "SELECT 1 FROM information_schema.tables WHERE table_name = ?", (table,)
    ).fetchone() is not None
