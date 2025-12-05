#!/usr/bin/env python3
"""
Simple conversion worker that polls the `bases` table for pending conversions
and runs the JSONL converter. Intended to run inside the `converter` container.

Behavior:
- Polls sqlite DB (path configurable via DB_PATH env, default to apps/api/db/dev.sqlite3)
- Finds one base with conversion_status = 'PENDING'
- Atomically sets it to RUNNING and calls the converter script (`scripts/xlsb_to_xlsx.py --jsonl in out`)
- Updates conversion_status to READY or FAILED and writes arquivo_jsonl_path

This is a small, pragmatic worker for development environments. For production,
replace with a queue backed worker and proper locking.
"""
import os
import sys
import time
import sqlite3
import subprocess
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.environ.get('REPO_ROOT', os.path.abspath(os.path.join(SCRIPT_DIR, '..')))

# Paths aligned to API/Electron runtime
DATA_DIR = os.environ.get('DATA_DIR') or os.path.abspath(os.path.join(REPO_ROOT, 'storage'))
DB_PATH = os.environ.get('DB_PATH') or os.path.join(DATA_DIR, 'db', 'dev.sqlite3')
POLL_INTERVAL = float(os.environ.get('POLL_INTERVAL', '5'))
INGESTS_DIR = os.environ.get('INGESTS_DIR') or os.path.join(DATA_DIR, 'ingests')
UPLOAD_DIR_ENV = os.environ.get('UPLOAD_DIR') or os.path.join(DATA_DIR, 'uploads')
BUSY_TIMEOUT_MS = int(os.environ.get('SQLITE_BUSY_TIMEOUT') or os.environ.get('BUSY_TIMEOUT') or 8000)
JOURNAL_MODE = os.environ.get('SQLITE_JOURNAL_MODE') or os.environ.get('JOURNAL_MODE') or 'WAL'
BACKOFF_MAX_SECONDS = float(os.environ.get('WORKER_BACKOFF_MAX_SECONDS', '30'))

CONVERTER_SCRIPT = os.path.join(SCRIPT_DIR, 'xlsb_to_xlsx.py')

running = True
stats = {
    'claimed': 0,
    'converted': 0,
    'failed': 0,
}


def ensure_dir(path):
    try:
        os.makedirs(path, exist_ok=True)
    except Exception:
        pass


def handle_signal(signum, frame):
    global running
    running = False
    print(f"Received signal {signum}, shutting down gracefully...")


def now_iso():
    return datetime.now(timezone.utc).isoformat(sep=' ', timespec='seconds')


def resolve_uploaded_path(arquivo_caminho: str):
    candidates = []
    cleaned = arquivo_caminho.lstrip('./') if arquivo_caminho else ''

    def add(path_candidate):
        if not path_candidate:
            return
        norm = os.path.abspath(path_candidate)
        if norm not in candidates:
            candidates.append(norm)

    if not arquivo_caminho:
        return None, []

    if os.path.isabs(arquivo_caminho):
        add(arquivo_caminho)
    else:
        add(os.path.join(os.getcwd(), arquivo_caminho))
        add(os.path.join(os.getcwd(), cleaned))
        add(os.path.join(SCRIPT_DIR, arquivo_caminho))
        add(os.path.join(SCRIPT_DIR, cleaned))
        add(os.path.join(REPO_ROOT, arquivo_caminho))
        add(os.path.join(REPO_ROOT, cleaned))
        add(os.path.join(REPO_ROOT, 'apps/api', arquivo_caminho))
        add(os.path.join(REPO_ROOT, 'apps/api', cleaned))

    # Legacy container locations
    add(os.path.join('/home/app', arquivo_caminho))
    add(os.path.join('/home/app/apps/api', arquivo_caminho))
    add(os.path.join('/home/app/apps', arquivo_caminho))

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


def claim_pending(conn):
    # Find one pending base and atomically set to RUNNING
    cur = conn.cursor()
    cur.execute("BEGIN IMMEDIATE")
    try:
        cur.execute("SELECT id, arquivo_caminho FROM bases WHERE conversion_status = 'PENDING' ORDER BY id LIMIT 1")
        row = cur.fetchone()
        if not row:
            conn.commit()
            return None
        base_id, arquivo_caminho = row
        # mark as RUNNING if still PENDING
        cur.execute(
            "UPDATE bases SET conversion_status = 'RUNNING', conversion_started_at = ? WHERE id = ? AND conversion_status = 'PENDING'",
            (now_iso(), base_id)
        )
        if cur.rowcount == 0:
            conn.commit()
            return None
        conn.commit()
        return (base_id, arquivo_caminho)
    except Exception:
        conn.rollback()
        return None


def update_status(conn, base_id, status, jsonl_rel=None, error_msg=None):
    cur = conn.cursor()
    fields = []
    params = []
    fields.append('conversion_status = ?')
    params.append(status)
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


def run_conversion(abs_input, abs_output):
    # Use the same interpreter that started the worker, unless explicitly overridden
    python_cmd = os.environ.get('PYTHON_EXECUTABLE') or sys.executable or 'python'
    cmd = [python_cmd, CONVERTER_SCRIPT, '--jsonl', abs_input, abs_output]
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return p.returncode, p.stdout.decode('utf-8', errors='replace'), p.stderr.decode('utf-8', errors='replace')


def connect_db():
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


def main_loop():
    ensure_dir(DATA_DIR)
    ensure_dir(os.path.join(DATA_DIR, 'db'))
    ensure_dir(INGESTS_DIR)
    ensure_dir(UPLOAD_DIR_ENV)
    print(f"Conversion worker starting. DB={DB_PATH} poll={POLL_INTERVAL}s ingests={INGESTS_DIR} journal_mode={JOURNAL_MODE} busy_timeout={BUSY_TIMEOUT_MS}ms")

    backoff = POLL_INTERVAL
    while running:
        try:
            conn = connect_db()
            backoff = POLL_INTERVAL
        except Exception as e:
            sleep_for = min(backoff, BACKOFF_MAX_SECONDS)
            print(f"Cannot open DB ({DB_PATH}): {e}. Retrying in {sleep_for}s")
            time.sleep(sleep_for)
            backoff = min(backoff * 2, BACKOFF_MAX_SECONDS)
            continue

        try:
            claimed = claim_pending(conn)
            if not claimed:
                conn.close()
                time.sleep(POLL_INTERVAL)
                continue

            base_id, arquivo_caminho = claimed
            stats['claimed'] += 1
            print(f"Claimed base id={base_id} file={arquivo_caminho} (claimed={stats['claimed']})")

            abs_input, candidates = resolve_uploaded_path(arquivo_caminho)

            if abs_input is None:
                print(f"Cannot find uploaded file for base {base_id}; tried: {candidates}")
                update_status(conn, base_id, 'FAILED', error_msg='uploaded file not found')
                stats['failed'] += 1
                conn.close()
                continue

            abs_output = os.path.join(INGESTS_DIR, f"{base_id}.jsonl")
            ensure_dir(os.path.dirname(abs_output))
            try:
                rc, out, err = run_conversion(abs_input, abs_output)
                if rc == 0:
                    update_status(conn, base_id, 'READY', jsonl_rel=abs_output)
                    stats['converted'] += 1
                    print(f"Converted base {base_id} -> {abs_output} (ok={stats['converted']} fail={stats['failed']})")
                else:
                    errmsg = f"converter exit {rc}: {err or out}"
                    update_status(conn, base_id, 'FAILED', error_msg=errmsg)
                    stats['failed'] += 1
                    print(f"Conversion failed for base {base_id}: {errmsg} (ok={stats['converted']} fail={stats['failed']})")
            except Exception as e:
                errmsg = str(e)
                update_status(conn, base_id, 'FAILED', error_msg=errmsg)
                stats['failed'] += 1
                print(f"Conversion exception for base {base_id}: {errmsg} (ok={stats['converted']} fail={stats['failed']})")

            conn.close()
        except Exception as e:
            print('Worker loop error', e)
            try:
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
