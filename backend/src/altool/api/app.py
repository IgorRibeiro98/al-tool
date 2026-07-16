"""FastAPI app da v2 — espelha o contrato REST da v1 (frontend React congelado).

Rotas sob `/api` (via routers); `/health` e `/api/diagnostics/env` fora do padrão, como na v1.
Storage híbrido: MetadataStore (SQLite) para metadados; DuckDBStore para dados pesados.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .. import __version__
from ..engine.data_store import DuckDBStore, default_data_store
from ..engine.db import duckdb_version
from ..metadata.store import MetadataStore, default_store
from ..services.atribuicoes import AtribuicaoService
from ..services.bases import BasesService
from ..services.conciliacoes import ConciliacaoService
from ..services.configs import ConfigsService
from ..services.jobs import JobWorker
from ..services.keys import KeysService
from ..services.licensing import LicensingService
from ..services.maintenance import MaintenanceService
from .routers.atribuicoes import router as atribuicoes_router
from .routers.bases import router as bases_router
from .routers.conciliacoes import router as conciliacoes_router
from .routers.configs import ALL_CONFIG_ROUTERS
from .routers.debug import router as debug_router
from .routers.keys import keys_pairs_router, keys_router
from .routers.license import router as license_router
from .routers.maintenance import router as maintenance_router


def create_app(store: MetadataStore | None = None, data: DuckDBStore | None = None) -> FastAPI:
    store = store or default_store()
    store.bootstrap()
    data = data or default_data_store()

    bases = BasesService(store, data)
    keys = KeysService(store)
    configs = ConfigsService(store, keys)
    conciliacoes = ConciliacaoService(store, data, configs)
    atribuicoes = AtribuicaoService(store, data, keys)
    maintenance = MaintenanceService(store, data)
    worker = JobWorker(store, [
        ("ingest_jobs", lambda row: bases.process_ingest(int(row["base_id"]))),
        ("jobs_conciliacao", conciliacoes.process),
        ("export_jobs", conciliacoes.process_export),
        ("atribuicao_runs", atribuicoes.process),
        ("atribuicao_export_jobs", atribuicoes.process_export),
        ("derived_column_jobs", lambda row: bases.process_derived(
            int(row["base_id"]), row["source_column"], row["operation"])),
    ])

    @asynccontextmanager
    async def lifespan(_app: FastAPI):  # type: ignore[no-untyped-def]
        worker.start()
        try:
            yield
        finally:
            worker.stop()

    app = FastAPI(title="AL-Tool v2", version=__version__, lifespan=lifespan)
    app.state.store = store
    app.state.data = data
    app.state.licensing = LicensingService(store)
    app.state.bases = bases
    app.state.configs = configs
    app.state.keys = keys
    app.state.conciliacoes = conciliacoes
    app.state.atribuicoes = atribuicoes
    app.state.maintenance = maintenance
    app.state.worker = worker

    @app.get("/health")
    def health() -> dict:
        return {
            "status": "ok",
            "dataDir": os.environ.get("DATA_DIR", ""),
            "dbPath": os.environ.get("DB_PATH", ""),
            "engine": "duckdb+polars",
            "duckdb": duckdb_version(),
            "version": __version__,
        }

    @app.get("/api/diagnostics/env")
    def diagnostics_env() -> dict:
        keys = [
            "APP_PORT", "DATA_DIR", "DB_PATH", "UPLOAD_DIR",
            "EXPORT_DIR", "INGESTS_DIR", "METADATA_DB_PATH",
        ]
        return {k: os.environ.get(k, "") for k in keys}

    app.include_router(license_router, prefix="/api")
    app.include_router(bases_router, prefix="/api")
    app.include_router(conciliacoes_router, prefix="/api")
    app.include_router(atribuicoes_router, prefix="/api")
    app.include_router(keys_router, prefix="/api")
    app.include_router(keys_pairs_router, prefix="/api")
    app.include_router(maintenance_router, prefix="/api")
    app.include_router(debug_router, prefix="/api")
    for r in ALL_CONFIG_ROUTERS:
        app.include_router(r, prefix="/api")

    _mount_spa(app)  # serve o SPA React (client/dist) — registrado por último (catch-all)
    return app


def _mount_spa(app: FastAPI) -> None:
    """Serve o build do React (client/dist) com fallback SPA — igual à v1 (express.static)."""
    client_dist = os.environ.get("CLIENT_DIST")
    if not client_dist or not Path(client_dist).is_dir():
        return
    root = Path(client_dist)
    index = str(root / "index.html")
    assets = root / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets)), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):  # type: ignore[no-untyped-def]
        if full_path.startswith("api/"):
            return JSONResponse(status_code=404, content={"error": "not found"})
        candidate = root / full_path
        if full_path and candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(index)


app = create_app()
