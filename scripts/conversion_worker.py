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
import time
import sqlite3
import subprocess
from datetime import datetime

DB_PATH = os.environ.get('DB_PATH', '/home/app/apps/api/db/dev.sqlite3')
POLL_INTERVAL = float(os.environ.get('POLL_INTERVAL', '5'))
INGESTS_DIR = os.environ.get('INGESTS_DIR', '/home/app/storage/ingests')


def ensure_ingests_dir():
    try:
        os.makedirs(INGESTS_DIR, exist_ok=True)
    except Exception:
        pass


def now_iso():
    return datetime.utcnow().isoformat(sep=' ', timespec='seconds')


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
        cur.execute("UPDATE bases SET conversion_status = 'RUNNING', conversion_started_at = ? WHERE id = ? AND conversion_status = 'PENDING'", (now_iso(), base_id))
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
    # Use the converter script; it supports xlsb and xlsx when --jsonl is used
    cmd = ['python3', 'scripts/xlsb_to_xlsx.py', '--jsonl', abs_input, abs_output]
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return p.returncode, p.stdout.decode('utf-8', errors='replace'), p.stderr.decode('utf-8', errors='replace')


def main_loop():
    ensure_ingests_dir()
    print(f"Conversion worker starting. DB={DB_PATH} poll={POLL_INTERVAL}s ingests={INGESTS_DIR}")
    while True:
        try:
            conn = sqlite3.connect(DB_PATH, timeout=30)
        except Exception as e:
            print('Cannot open DB', e)
            time.sleep(POLL_INTERVAL)
            continue

        try:
            claimed = claim_pending(conn)
            if not claimed:
                conn.close()
                time.sleep(POLL_INTERVAL)
                continue

            base_id, arquivo_caminho = claimed
            print(f"Claimed base id={base_id} file={arquivo_caminho}")

            # Resolve possible locations for the uploaded file. The API may have stored
            # a relative path like 'storage/uploads/..' (relative to /home/app/apps/api),
            # or relative to repo root. Try several candidates and pick the first that exists.
            candidates = []
            if os.path.isabs(arquivo_caminho):
                candidates.append(arquivo_caminho)
            candidates.append(os.path.join('/home/app', arquivo_caminho))
            candidates.append(os.path.join('/home/app/apps/api', arquivo_caminho))
            candidates.append(os.path.join('/home/app/apps', arquivo_caminho))

            abs_input = None
            for c in candidates:
                if os.path.exists(c):
                    abs_input = c
                    break

            if abs_input is None:
                print(f"Cannot find uploaded file for base {base_id}; tried: {candidates}")
                update_status(conn, base_id, 'FAILED', error_msg='uploaded file not found')
                conn.close()
                continue

            abs_output = os.path.join(INGESTS_DIR, f"{base_id}.jsonl")
            try:
                rc, out, err = run_conversion(abs_input, abs_output)
                if rc == 0:
                    # store relative path used by API (relative to repo root)
                    rel = os.path.relpath(abs_output, start='/home/app')
                    update_status(conn, base_id, 'READY', jsonl_rel=rel)
                    print(f"Converted base {base_id} -> {rel}")
                else:
                    errmsg = f"converter exit {rc}: {err or out}"
                    update_status(conn, base_id, 'FAILED', error_msg=errmsg)
                    print(f"Conversion failed for base {base_id}: {errmsg}")
            except Exception as e:
                errmsg = str(e)
                update_status(conn, base_id, 'FAILED', error_msg=errmsg)
                print(f"Conversion exception for base {base_id}: {errmsg}")

            conn.close()
        except Exception as e:
            print('Worker loop error', e)
            try:
                conn.close()
            except Exception:
                pass
            time.sleep(POLL_INTERVAL)


if __name__ == '__main__':
    main_loop()
