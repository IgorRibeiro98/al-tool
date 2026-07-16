"""Modelo de job genérico (SQLite) + worker multi-fila.

Cada tipo de job é uma tabela com colunas `id, status, erro, updated_at` (PENDING→RUNNING→
DONE/FAILED). O claim é serializado pelo lock do MetadataStore (sidecar local single-user).

`process_pending_once(store, table, process)` roda UM job de forma síncrona (testes
determinísticos); `JobWorker` drena várias filas em background. O `process` recebe a linha
do job e faz o trabalho, levantando exceção em erro.
"""

from __future__ import annotations

import sqlite3
import threading
from typing import Callable, Sequence

from ..metadata.store import MetadataStore

JobProcessor = Callable[[sqlite3.Row], None]


# --------------------------------------------------------------- fila genérica

def get_job(store: MetadataStore, table: str, job_id: int) -> sqlite3.Row | None:
    return store.query_one(f"SELECT * FROM {table} WHERE id = ?", (job_id,))


def latest_job(
    store: MetadataStore, table: str, where_col: str, where_val: object
) -> sqlite3.Row | None:
    return store.query_one(
        f"SELECT * FROM {table} WHERE {where_col} = ? ORDER BY id DESC LIMIT 1", (where_val,)
    )


def _claim_next(store: MetadataStore, table: str) -> sqlite3.Row | None:
    with store.tx() as con:
        row = con.execute(
            f"SELECT * FROM {table} WHERE status = 'PENDING' ORDER BY id LIMIT 1"
        ).fetchone()
        if row is None:
            return None
        con.execute(
            f"UPDATE {table} SET status='RUNNING', updated_at=datetime('now') WHERE id=?",
            (row["id"],),
        )
        return row


def mark(store: MetadataStore, table: str, job_id: int, status: str, erro: str | None = None) -> None:
    with store.tx() as con:
        con.execute(
            f"UPDATE {table} SET status=?, erro=?, updated_at=datetime('now') WHERE id=?",
            (status, erro, job_id),
        )


def process_pending_once(store: MetadataStore, table: str, process: JobProcessor) -> bool:
    """Processa UM job pendente de `table`. Retorna True se processou algo."""
    job = _claim_next(store, table)
    if job is None:
        return False
    try:
        process(job)
        mark(store, table, int(job["id"]), "DONE")
    except Exception as e:
        mark(store, table, int(job["id"]), "FAILED", str(e) or "erro")
    return True


# --------------------------------------------------------------- ingest (wrappers)

def enqueue_ingest(store: MetadataStore, base_id: int) -> int:
    with store.tx() as con:
        cur = con.execute(
            "INSERT INTO ingest_jobs (base_id, status) VALUES (?, 'PENDING')", (base_id,)
        )
        return int(cur.lastrowid or 0)


def get_ingest_job(store: MetadataStore, job_id: int) -> sqlite3.Row | None:
    return get_job(store, "ingest_jobs", job_id)


def latest_ingest_job_for_base(store: MetadataStore, base_id: int) -> sqlite3.Row | None:
    return latest_job(store, "ingest_jobs", "base_id", base_id)


# --------------------------------------------------------------- worker

class JobWorker:
    """Thread que drena uma ou mais filas em background."""

    def __init__(
        self,
        store: MetadataStore,
        handlers: Sequence[tuple[str, JobProcessor]],
        *,
        poll_interval: float = 0.5,
    ) -> None:
        self._store = store
        self._handlers = list(handlers)
        self._poll = poll_interval
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="job-worker", daemon=True)
        self._thread.start()

    def _run(self) -> None:
        while not self._stop.is_set():
            did = False
            for table, process in self._handlers:
                try:
                    did = process_pending_once(self._store, table, process) or did
                except Exception:
                    pass
            if not did:
                self._stop.wait(self._poll)

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2.0)
