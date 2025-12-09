#!/usr/bin/env python3
"""Platform-aware Python setup for build pipeline.

This script selects the proper preparer depending on the host platform:
- Windows: runs `scripts/windows/prepare_python_runtime_win.py` (for embeddable runtime)
- Other: runs `scripts/unix/bootstrap_conversion_runtime.py` (creates a venv)

The module is intentionally small and delegates work to the platform-specific
preparers. It forwards any additional CLI args to the selected preparer.
"""
from __future__ import annotations

import sys
import subprocess
from pathlib import Path
from typing import List


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = REPO_ROOT / 'scripts'


def log(msg: str) -> None:
    print(f"[python-setup] {msg}")


def find_preparer_for_platform() -> Path:
    """Return the platform-specific preparer script path or raise FileNotFoundError."""
    if sys.platform.startswith('win'):
        candidate = SCRIPTS_DIR / 'windows' / 'prepare_python_runtime_win.py'
    else:
        candidate = SCRIPTS_DIR / 'unix' / 'bootstrap_conversion_runtime.py'

    if not candidate.exists():
        raise FileNotFoundError(str(candidate))
    return candidate


def run_script(python_executable: str, script_path: Path, args: List[str]) -> int:
    """Execute the given script with provided args, returning the exit code."""
    cmd = [python_executable, str(script_path), *args]
    log(f"Running: {' '.join(cmd)}")
    try:
        completed = subprocess.run(cmd, check=True)
        return completed.returncode or 0
    except subprocess.CalledProcessError as cpe:
        log(f"Preparers exited with non-zero code: {cpe.returncode}")
        return cpe.returncode or 1
    except Exception as exc:
        log(f"Failed to launch preparer: {exc}")
        return 2


def main(argv: List[str] | None = None) -> int:
    argv = list(argv or sys.argv[1:])
    try:
        preparer = find_preparer_for_platform()
    except FileNotFoundError as fnf:
        print(f"Preparer not found: {fnf}", file=sys.stderr)
        return 3

    # On Windows we typically want to force recreate the embeddable; if the
    # caller didn't pass '--force' we add it by default for deterministic builds.
    if sys.platform.startswith('win') and '--force' not in argv:
        argv = ['--force', *argv]

    return run_script(sys.executable, preparer, argv)


if __name__ == '__main__':
    raise SystemExit(main())
