"""DuckDB data store — conexão persistente para os dados pesados (tabelas base_{id}, resultados).

A metade OLAP do storage híbrido. Conexão única + lock (DuckDB é single-writer; um sidecar
local serializa o acesso sem custo perceptível). Engine functions recebem `con` via `use()`.
"""

from __future__ import annotations

import os
import threading
from contextlib import contextmanager
from typing import Iterator

import duckdb

from .db import connect


class DuckDBStore:
    def __init__(self, db_path: str | None = None) -> None:
        self._con = connect(db_path)
        self._lock = threading.RLock()

    @contextmanager
    def use(self) -> Iterator[duckdb.DuckDBPyConnection]:
        """Acesso exclusivo serializado à conexão DuckDB."""
        with self._lock:
            yield self._con

    def close(self) -> None:
        with self._lock:
            self._con.close()


def default_data_store() -> DuckDBStore:
    """Store a partir do ambiente (DB_PATH); em memória se não definido (testes)."""
    return DuckDBStore(os.environ.get("DB_PATH") or None)
