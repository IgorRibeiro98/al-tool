"""MaintenanceService — limpeza de storage e tabelas de resultado.

Port do essencial de routes/maintenance.ts: cleanup de uploads/ingests/exports e drop de
tabelas de resultado (conciliacao_result_*/atribuicao_result_*).
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from ..engine.data_store import DuckDBStore
from ..metadata.store import MetadataStore

_RESULT_PREFIXES = ("conciliacao_result_", "atribuicao_result_")


def _clear_dir(env_key: str) -> int:
    d = os.environ.get(env_key)
    if not d or not Path(d).is_dir():
        return 0
    n = 0
    for f in Path(d).iterdir():
        try:
            if f.is_file():
                f.unlink()
                n += 1
        except OSError:
            pass
    return n


class MaintenanceService:
    def __init__(self, store: MetadataStore, data: DuckDBStore) -> None:
        self._store = store
        self._data = data

    def cleanup_storage(self) -> dict[str, Any]:
        return {
            "deletedUploads": _clear_dir("UPLOAD_DIR"),
            "deletedIngests": _clear_dir("INGESTS_DIR"),
            "deletedExports": _clear_dir("EXPORT_DIR"),
            "message": "storage cleanup finished",
        }

    def _drop_result_tables(self) -> list[str]:
        with self._data.use() as con:
            names = [
                r[0] for r in con.execute(
                    "SELECT table_name FROM information_schema.tables"
                ).fetchall()
                if any(str(r[0]).startswith(p) for p in _RESULT_PREFIXES)
            ]
            for t in names:
                con.execute(f'DROP TABLE IF EXISTS "{t}"')
        return names

    def cleanup_results(self, ttl_days: int = 7) -> dict[str, Any]:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=ttl_days)).isoformat()
        dropped = self._drop_result_tables()
        deleted_exports = _clear_dir("EXPORT_DIR")
        with self._store.tx() as con:
            updated = con.execute(
                "UPDATE jobs_conciliacao SET arquivo_exportado=NULL, export_status=NULL"
            ).rowcount or 0
        return {
            "cutoff": cutoff, "ttlDays": ttl_days, "droppedTables": dropped,
            "deletedExports": deleted_exports, "deletedStray": 0, "updatedJobs": updated,
            "message": "cleanup results finished",
        }

    def cleanup(self) -> dict[str, Any]:
        storage = self.cleanup_storage()
        dropped_results = self._drop_result_tables()
        # dropa tabelas base_* órfãs (sem base correspondente)
        base_ids = {int(r["id"]) for r in self._store.query_all("SELECT id FROM bases")}
        dropped_tables: list[str] = []
        with self._data.use() as con:
            for r in con.execute("SELECT table_name FROM information_schema.tables").fetchall():
                name = str(r[0])
                if name.startswith("base_") and name[5:].isdigit() and int(name[5:]) not in base_ids:
                    con.execute(f'DROP TABLE IF EXISTS "{name}"')
                    dropped_tables.append(name)
        return {
            "deletedUploads": storage["deletedUploads"],
            "deletedIngests": storage["deletedIngests"],
            "deletedExports": storage["deletedExports"],
            "droppedTables": dropped_tables,
            "droppedResultTables": dropped_results,
            "deletedBases": 0, "deletedJobs": 0,
            "message": "cleanup finished",
        }
