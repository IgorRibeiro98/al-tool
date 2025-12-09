"""Conversion worker that polls SQLITE for pending 'bases' and runs converter.

This refactor keeps the original behavior but improves structure, naming,
error handling and testability. It is still intended as a small development
worker; production should use a proper queue and worker infrastructure.
"""
from __future__ import annotations

import os
import sys
import time
import sqlite3
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple, List


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.environ.get('REPO_ROOT', os.path.abspath(os.path.join(SCRIPT_DIR, '..')))

# Configurable paths / behavior via environment
DATA_DIR = os.environ.get('DATA_DIR') or os.path.abspath(os.path.join(REPO_ROOT, 'storage'))
DB_PATH = os.environ.get('DB_PATH') or os.path.join(DATA_DIR, 'db', 'dev.sqlite3')
POLL_INTERVAL = float(os.environ.get('POLL_INTERVAL', '5'))
INGESTS_DIR = os.environ.get('INGESTS_DIR') or os.path.join(DATA_DIR, 'ingests')
UPLOAD_DIR_ENV = os.environ.get('UPLOAD_DIR') or os.path.join(DATA_DIR, 'uploads')
BUSY_TIMEOUT_MS = int(os.environ.get('SQLITE_BUSY_TIMEOUT') or os.environ.get('BUSY_TIMEOUT') or 8000)
JOURNAL_MODE = os.environ.get('SQLITE_JOURNAL_MODE') or os.environ.get('JOURNAL_MODE') or 'WAL'
BACKOFF_MAX_SECONDS = float(os.environ.get('WORKER_BACKOFF_MAX_SECONDS', '30'))

CONVERTER_SCRIPT = os.path.join(SCRIPT_DIR, 'xlsb_to_xlsx.py')

# Runtime state
running = True
stats = {
    'claimed': 0,
    'converted': 0,
    'failed': 0,
}


def log(msg: str) -> None:
    print(f"[conversion-worker] {msg}")


def ensure_dir(path: str) -> None:
    try:
        os.makedirs(path, exist_ok=True)
    except Exception:
        # Best-effort; if we cannot create directories later operations will fail explicitly
        pass


def handle_signal(signum, frame) -> None:
    global running
    running = False
    log(f"Received signal {signum}, shutting down gracefully...")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(sep=' ', timespec='seconds')


def resolve_uploaded_path(arquivo_caminho: Optional[str]) -> Tuple[Optional[str], List[str]]:
    """Return the first existing candidate path and the list of candidates tried.

    The function attempts several likely locations to support different
    development and container layouts.
    """
    candidates: List[str] = []
    if not arquivo_caminho:
        return None, candidates

    cleaned = arquivo_caminho.lstrip('./')

    def add(candidate: Optional[str]) -> None:
        if not candidate:
            return
        norm = os.path.abspath(candidate)
        if norm not in candidates:
            candidates.append(norm)

    # Absolute path provided
    if os.path.isabs(arquivo_caminho):
        add(arquivo_caminho)
    else:
        add(os.path.join(os.getcwd(), arquivo_caminho))
        add(os.path.join(os.getcwd(), cleaned))
        add(os.path.join(SCRIPT_DIR, arquivo_caminho))
        add(os.path.join(SCRIPT_DIR, cleaned))
        add(os.path.join(REPO_ROOT, arquivo_caminho))
        add(os.path.join(REPO_ROOT, cleaned))
        add(os.path.join(REPO_ROOT, 'apps', 'api', arquivo_caminho))
        add(os.path.join(REPO_ROOT, 'apps', 'api', cleaned))

    # Legacy container paths
    add(os.path.join('/home/app', arquivo_caminho))
    add(os.path.join('/home/app', 'apps', 'api', arquivo_caminho))
    add(os.path.join('/home/app', 'apps', arquivo_caminho))

    # Storage and uploads
    if DATA_DIR:
        add(os.path.join(DATA_DIR, arquivo_caminho))
        add(os.path.join(DATA_DIR, cleaned))
        add(os.path.join(DATA_DIR, 'uploads', os.path.basename(cleaned)))

    if UPLOAD_DIR_ENV:
        add(os.path.join(UPLOAD_DIR_ENV, os.path.basename(cleaned)))

    for candidate in candidates:
        if os.path.exists(candidate):
            return candidate, candidates

    return None, candidates


def claim_pending(conn: sqlite3.Connection) -> Optional[Tuple[int, Optional[str]]]:
    """Atomically claim a single PENDING base and mark it RUNNING.

    Returns (base_id, arquivo_caminho) or None when nothing to claim.
    """
    cur = conn.cursor()
    cur.execute("BEGIN IMMEDIATE")
    try:
        cur.execute("SELECT id, arquivo_caminho FROM bases WHERE conversion_status = 'PENDING' ORDER BY id LIMIT 1")
        row = cur.fetchone()
        if not row:
            conn.commit()
            return None
        base_id, arquivo_caminho = row

        cur.execute(
            "UPDATE bases SET conversion_status = 'RUNNING', conversion_started_at = ? WHERE id = ? AND conversion_status = 'PENDING'",
            (now_iso(), base_id)
        )
        if cur.rowcount == 0:
            conn.commit()
            return None
        conn.commit()
        return int(base_id), arquivo_caminho
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        return None


def update_status(conn: sqlite3.Connection, base_id: int, status: str, jsonl_rel: Optional[str] = None, error_msg: Optional[str] = None) -> None:
    cur = conn.cursor()
    fields = ['conversion_status = ?']
    params: List[object] = [status]
    if jsonl_rel is not None:
        fields.append('arquivo_jsonl_path = ?')
        params.append(jsonl_rel)
    fields.append('conversion_finished_at = ?')
    params.append(now_iso())
    if error_msg is not None:
        fields.append('conversion_error = ?')
        params.append(error_msg)

    params.append(base_id)
    sql = f"UPDATE bases SET {', '.join(fields)} WHERE id = ?"
    cur.execute(sql, params)
    conn.commit()


def run_conversion(abs_input: str, abs_output: str) -> Tuple[int, str, str]:
    """Run the converter script and return (rc, stdout, stderr)."""
    python_cmd = os.environ.get('PYTHON_EXECUTABLE') or sys.executable or 'python'
    cmd = [python_cmd, CONVERTER_SCRIPT, '--jsonl', abs_input, abs_output]
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    out = p.stdout.decode('utf-8', errors='replace')
    err = p.stderr.decode('utf-8', errors='replace')
    return p.returncode, out, err


def connect_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=BUSY_TIMEOUT_MS / 1000.0)
    try:
        conn.execute(f"PRAGMA busy_timeout = {BUSY_TIMEOUT_MS}")
    except Exception:
        pass
    try:
        conn.execute(f"PRAGMA journal_mode = {JOURNAL_MODE}")
    except Exception:
        pass
    return conn


def main_loop() -> None:
    ensure_dir(DATA_DIR)
    ensure_dir(os.path.join(DATA_DIR, 'db'))
    ensure_dir(INGESTS_DIR)
    ensure_dir(UPLOAD_DIR_ENV)
    log(f"Conversion worker starting. DB={DB_PATH} poll={POLL_INTERVAL}s ingests={INGESTS_DIR} journal_mode={JOURNAL_MODE} busy_timeout={BUSY_TIMEOUT_MS}ms")

    backoff = POLL_INTERVAL
    while running:
        conn = None
        try:
            conn = connect_db()
            backoff = POLL_INTERVAL
        except Exception as exc:
            sleep_for = min(backoff, BACKOFF_MAX_SECONDS)
            log(f"Cannot open DB ({DB_PATH}): {exc}. Retrying in {sleep_for}s")
            time.sleep(sleep_for)
            backoff = min(backoff * 2, BACKOFF_MAX_SECONDS)
            continue

        try:
            claimed = claim_pending(conn)
            if not claimed:
                try:
                    conn.close()
                except Exception:
                    pass
                time.sleep(POLL_INTERVAL)
                continue

            base_id, arquivo_caminho = claimed
            stats['claimed'] += 1
            log(f"Claimed base id={base_id} file={arquivo_caminho} (claimed={stats['claimed']})")

            abs_input, candidates = resolve_uploaded_path(arquivo_caminho)
            if abs_input is None:
                log(f"Cannot find uploaded file for base {base_id}; tried: {candidates}")
                update_status(conn, base_id, 'FAILED', error_msg='uploaded file not found')
                stats['failed'] += 1
                try:
                    conn.close()
                except Exception:
                    pass
                continue

            abs_output = os.path.join(INGESTS_DIR, f"{base_id}.jsonl")
            ensure_dir(os.path.dirname(abs_output))

            try:
                rc, out, err = run_conversion(abs_input, abs_output)
                if rc == 0:
                    update_status(conn, base_id, 'READY', jsonl_rel=abs_output)
                    stats['converted'] += 1
                    log(f"Converted base {base_id} -> {abs_output} (ok={stats['converted']} fail={stats['failed']})")
                else:
                    errmsg = f"converter exit {rc}: {err or out}"
                    update_status(conn, base_id, 'FAILED', error_msg=errmsg)
                    stats['failed'] += 1
                    log(f"Conversion failed for base {base_id}: {errmsg} (ok={stats['converted']} fail={stats['failed']})")
            except Exception as exc:
                errmsg = str(exc)
                update_status(conn, base_id, 'FAILED', error_msg=errmsg)
                stats['failed'] += 1
                log(f"Conversion exception for base {base_id}: {errmsg} (ok={stats['converted']} fail={stats['failed']})")

            try:
                conn.close()
            except Exception:
                pass
        except Exception as exc:
            log(f'Worker loop error: {exc}')
            try:
                if conn:
                    conn.close()
            except Exception:
                pass
            sleep_for = min(backoff, BACKOFF_MAX_SECONDS)
            time.sleep(sleep_for)
            backoff = min(backoff * 2, BACKOFF_MAX_SECONDS)


if __name__ == '__main__':
    try:
        import signal

        signal.signal(signal.SIGINT, handle_signal)
        signal.signal(signal.SIGTERM, handle_signal)
    except Exception:
        pass

    main_loop()
