#!/usr/bin/env python3
"""Compatibility wrapper for the Windows Python preparer.

Maintains the original CLI entrypoint and delegates to
`scripts/windows/prepare_python_runtime_win.py`, forwarding any CLI
arguments and returning an appropriate exit code on failure.
"""
from __future__ import annotations

import sys
import subprocess
from pathlib import Path
from typing import List


def find_windows_preparer(repo_root: Path) -> Path:
    target = repo_root / "scripts" / "windows" / "prepare_python_runtime_win.py"
    if not target.exists():
        raise FileNotFoundError(str(target))
    return target


def run_preparer(python_exe: str, target: Path, args: List[str]) -> int:
    cmd = [python_exe, str(target), *args]
    print(f"[prepare-python-win-wrapper] Executing: {' '.join(cmd)}")
    try:
        completed = subprocess.run(cmd, check=True)
        return completed.returncode or 0
    except subprocess.CalledProcessError as cpe:
        print(f"[prepare-python-win-wrapper] Child process failed: {cpe}", file=sys.stderr)
        return cpe.returncode or 1
    except Exception as exc:
        print(f"[prepare-python-win-wrapper] Execution error: {exc}", file=sys.stderr)
        return 2


def main(argv: List[str] | None = None) -> int:
    argv = list(argv or sys.argv[1:])
    repo_root = Path(__file__).resolve().parents[1]
    try:
        target = find_windows_preparer(repo_root)
    except FileNotFoundError as fnf:
        print(f"[prepare-python-win-wrapper] Target preparer not found: {fnf}", file=sys.stderr)
        return 3

    return run_preparer(sys.executable, target, argv)


if __name__ == "__main__":
    raise SystemExit(main())
