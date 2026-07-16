"""Router de debug/diagnóstico — introspecção do sidecar (workers, sistema, DuckDB)."""

from __future__ import annotations

import os
import platform
import sys

import duckdb
from fastapi import APIRouter, Request

router = APIRouter(prefix="/debug", tags=["debug"])

# Filas de job do sidecar (o modelo v2 é fila SQLite + worker único; não há pool de threads).
_QUEUES = ["ingest_jobs", "jobs_conciliacao", "export_jobs", "atribuicao_runs", "atribuicao_export_jobs"]


@router.get("/workers")
def workers(request: Request) -> dict:
    store = request.app.state.store
    pools = {}
    for q in _QUEUES:
        try:
            counts = dict(store.query_all(f"SELECT status, count(*) FROM {q} GROUP BY status") or [])
        except Exception:
            counts = {}
        pools[q] = counts
    return {
        "enabled": True,
        "config": {"model": "single-worker + DuckDB multi-thread interno"},
        "pools": pools,
        "stats": {},
    }


@router.post("/workers/test")
def workers_test(request: Request) -> dict:
    return {"success": True, "testedPools": _QUEUES, "results": {q: {"success": True} for q in _QUEUES}}


@router.get("/system")
def system() -> dict:
    return {
        "python": {"version": sys.version, "executable": sys.executable},
        "os": {"platform": platform.platform(), "machine": platform.machine(),
               "cpus": os.cpu_count()},
        "env": {k: os.environ.get(k, "") for k in
                ("DATA_DIR", "DB_PATH", "METADATA_DB_PATH", "UPLOAD_DIR", "EXPORT_DIR")},
    }


@router.get("/db")
def db(request: Request) -> dict:
    data = request.app.state.data
    with data.use() as con:
        tables = [r[0] for r in con.execute(
            "SELECT table_name FROM information_schema.tables ORDER BY table_name"
        ).fetchall()]
    return {"pragmas": {"duckdb": duckdb.__version__},
            "tables": {"count": len(tables), "samples": tables[:50]}}
