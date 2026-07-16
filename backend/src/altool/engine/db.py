"""Bootstrap do DuckDB — motor de dados/compute da v2.

Fino de propósito: o DuckDB gerencia memória/spill sozinho (memory_limit/threads),
substituindo toda a matemática manual de batch/RAM da v1.
"""

from __future__ import annotations

import os
from pathlib import Path

import duckdb


def connect(db_path: str | os.PathLike[str] | None = None) -> duckdb.DuckDBPyConnection:
    """Abre conexão DuckDB. `None` → banco em memória (usado em testes)."""
    target = ":memory:" if db_path is None else str(Path(db_path))
    con = duckdb.connect(target)
    _apply_pragmas(con)
    _ensure_excel_extension(con)
    return con


def _ensure_excel_extension(con: duckdb.DuckDBPyConnection) -> None:
    """Garante a extensão `excel` (read_xlsx), offline-first.

    Ordem: (1) se `ALTOOL_EXCEL_EXTENSION` aponta o arquivo `.duckdb_extension` embarcado,
    carrega dele (app empacotado, sem rede); (2) tenta LOAD do cache local; (3) só em dev,
    INSTALL via rede. Assim o app empacotado nunca depende de internet.
    """
    bundled = os.environ.get("ALTOOL_EXCEL_EXTENSION")
    if bundled and Path(bundled).exists():
        con.execute(f"LOAD '{bundled}'")
        return
    ext_dir = os.environ.get("ALTOOL_DUCKDB_EXT_DIR")
    if ext_dir:
        con.execute(f"SET extension_directory='{ext_dir}'")
    try:
        con.execute("LOAD excel")
    except duckdb.Error:
        con.execute("INSTALL excel")
        con.execute("LOAD excel")


def _apply_pragmas(con: duckdb.DuckDBPyConnection) -> None:
    """Perfil de hardware: só configura memory_limit/threads por RAM/CPU (§3 do plano).

    Substitui os PRAGMAs calculados à mão da v1 (db/knex.ts). Valores conservadores
    para 'desktops modestos'; refinar na Fase 4 (perfis low/standard/high).
    """
    cpu = os.cpu_count() or 2
    threads = max(1, cpu - 1)
    con.execute(f"PRAGMA threads={threads}")
    # Deixa o DuckDB spillar para disco em vez de estourar RAM.
    con.execute("PRAGMA memory_limit='1GB'")
    # Sidecar headless: sem barra de progresso no stderr.
    con.execute("SET enable_progress_bar=false")


def duckdb_version() -> str:
    return duckdb.__version__
