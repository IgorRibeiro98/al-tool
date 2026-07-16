"""Metadata store — SQLite (stdlib) para metadados/filas/configs.

Arquitetura híbrida (§2.1 do plano): SQLite transacional para metadados; DuckDB para
os dados pesados. Aqui vive o schema OLTP (license, bases, jobs, configs…) que espelha
as migrações da v1. Bootstrap idempotente via DDL `CREATE TABLE IF NOT EXISTS`.

Conexão única persistente (check_same_thread=False + lock): adequado a um sidecar local
single-user, evita overhead por-request e funciona com `:memory:` compartilhado nos testes.
"""

from __future__ import annotations

import os
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

# DDL das tabelas de metadados. Espelha as migrações da v1 (adicionar conforme as fatias).
_SCHEMA: tuple[str, ...] = (
    # Licença (apps/api/migrations/..._create_license_table.js)
    """
    CREATE TABLE IF NOT EXISTS license (
        id INTEGER PRIMARY KEY,
        license_key TEXT,
        activation_token TEXT,
        machine_fingerprint TEXT,
        status TEXT,
        expires_at TEXT,
        last_success_online_validation_at TEXT,
        next_online_validation_at TEXT,
        last_error TEXT
    )
    """,
    # Bases (campo tabela_sqlite mantido pelo contrato; guarda o nome da tabela DuckDB).
    """
    CREATE TABLE IF NOT EXISTS bases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT NOT NULL,
        nome TEXT,
        periodo TEXT,
        arquivo_caminho TEXT,
        tabela_sqlite TEXT,
        arquivo_arrow_path TEXT,
        header_linha_inicial INTEGER DEFAULT 1,
        header_coluna_inicial INTEGER DEFAULT 1,
        subtype TEXT,
        reference_base_id INTEGER,
        conversion_status TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS base_columns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        base_id INTEGER NOT NULL,
        col_index INTEGER NOT NULL,
        excel_name TEXT,
        sqlite_name TEXT,
        is_monetary INTEGER DEFAULT 0
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS ingest_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        base_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        erro TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS base_subtypes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS derived_column_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        base_id INTEGER NOT NULL,
        source_column TEXT,
        target_column TEXT,
        operation TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        total_rows INTEGER,
        processed_rows INTEGER DEFAULT 0,
        progress REAL DEFAULT 0,
        erro TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )
    """,
    # Config de conciliação (chaves denormalizadas como JSON, igual à v1).
    """
    CREATE TABLE IF NOT EXISTS configs_conciliacao (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT,
        base_contabil_id INTEGER,
        base_fiscal_id INTEGER,
        chaves_contabil TEXT,
        chaves_fiscal TEXT,
        coluna_conciliacao_contabil TEXT,
        coluna_conciliacao_fiscal TEXT,
        inverter_sinal_fiscal INTEGER DEFAULT 0,
        limite_diferenca_imaterial REAL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS configs_estorno (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        base_id INTEGER,
        nome TEXT,
        coluna_a TEXT,
        coluna_b TEXT,
        coluna_soma TEXT,
        limite_zero REAL DEFAULT 0,
        ativa INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS configs_cancelamento (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        base_id INTEGER,
        nome TEXT,
        coluna_indicador TEXT,
        valor_cancelado TEXT,
        valor_nao_cancelado TEXT,
        ativa INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS configs_mapeamento_bases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT,
        base_contabil_id INTEGER,
        base_fiscal_id INTEGER,
        mapeamentos TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )
    """,
    # Chaves de uma config de conciliação (para a response expandida do contrato).
    """
    CREATE TABLE IF NOT EXISTS configs_conciliacao_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        config_conciliacao_id INTEGER NOT NULL,
        key_identifier TEXT,
        keys_pair_id INTEGER,
        contabil_key_id INTEGER,
        fiscal_key_id INTEGER,
        ordem INTEGER DEFAULT 0
    )
    """,
    # Job/queue de conciliação (a própria linha é o item da fila via `status`).
    """
    CREATE TABLE IF NOT EXISTS jobs_conciliacao (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        erro TEXT,
        config_conciliacao_id INTEGER,
        config_estorno_id INTEGER,
        config_cancelamento_id INTEGER,
        config_mapeamento_id INTEGER,
        base_contabil_id_override INTEGER,
        base_fiscal_id_override INTEGER,
        arquivo_exportado TEXT,
        export_progress REAL,
        export_status TEXT,
        pipeline_stage TEXT,
        pipeline_progress REAL,
        result_table_name TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )
    """,
    # Fila de export (reusa o JobWorker; atualiza export_status em jobs_conciliacao).
    """
    CREATE TABLE IF NOT EXISTS export_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conciliacao_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        erro TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )
    """,
    # Keys (definições) e KeysPairs — colunas por base_tipo/subtipo.
    """
    CREATE TABLE IF NOT EXISTS keys_definitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT,
        descricao TEXT,
        base_tipo TEXT,
        base_subtipo TEXT,
        columns TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS keys_pairs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT,
        descricao TEXT,
        contabil_key_id INTEGER,
        fiscal_key_id INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )
    """,
    # Runs de atribuição (a linha é a fila via `status`; CREATED → PENDING no /start).
    """
    CREATE TABLE IF NOT EXISTS atribuicao_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT,
        base_origem_id INTEGER,
        base_destino_id INTEGER,
        mode_write TEXT,
        selected_columns_json TEXT,
        update_original_base INTEGER DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'CREATED',
        erro TEXT,
        pipeline_stage TEXT,
        pipeline_progress REAL,
        result_table_name TEXT,
        export_status TEXT,
        export_progress REAL,
        arquivo_exportado TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS atribuicao_run_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        atribuicao_run_id INTEGER NOT NULL,
        keys_pair_id INTEGER NOT NULL,
        key_identifier TEXT,
        ordem INTEGER DEFAULT 0
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS atribuicao_export_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        atribuicao_run_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        erro TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )
    """,
)


class MetadataStore:
    """Acesso ao SQLite de metadados. Uma conexão persistente por instância."""

    def __init__(self, db_path: str | os.PathLike[str]) -> None:
        self._path = str(db_path)
        self._lock = threading.RLock()
        self._con = sqlite3.connect(self._path, timeout=60.0, check_same_thread=False)
        self._con.row_factory = sqlite3.Row

    @property
    def path(self) -> str:
        return self._path

    def bootstrap(self) -> None:
        """Cria as tabelas (idempotente) e aplica PRAGMAs."""
        with self._lock:
            if self._path != ":memory:":
                self._con.execute("PRAGMA journal_mode=WAL")
            self._con.execute("PRAGMA busy_timeout=60000")
            self._con.execute("PRAGMA foreign_keys=ON")
            for ddl in _SCHEMA:
                self._con.execute(ddl)
            self._con.commit()

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        """Transação serializada: commit no fim, rollback em erro."""
        with self._lock:
            try:
                yield self._con
                self._con.commit()
            except Exception:
                self._con.rollback()
                raise

    def query_one(self, sql: str, params: tuple[object, ...] = ()) -> sqlite3.Row | None:
        with self._lock:
            return self._con.execute(sql, params).fetchone()

    def query_all(self, sql: str, params: tuple[object, ...] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._con.execute(sql, params).fetchall()

    def close(self) -> None:
        with self._lock:
            self._con.close()


def default_store() -> MetadataStore:
    """Store a partir do ambiente (METADATA_DB_PATH ou DATA_DIR/altool.sqlite); memória em teste."""
    db_path = os.environ.get("METADATA_DB_PATH")
    if not db_path:
        data_dir = os.environ.get("DATA_DIR")
        db_path = str(Path(data_dir) / "altool.sqlite") if data_dir else ":memory:"
    return MetadataStore(db_path)
