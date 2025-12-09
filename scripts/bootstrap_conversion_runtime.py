#!/usr/bin/env python3
"""Compatibility wrapper for the unix bootstrap script.

Maintains the original CLI entrypoint at `scripts/bootstrap_conversion_runtime.py`
while delegating execution to `scripts/unix/bootstrap_conversion_runtime.py`.

This wrapper forwards any command-line arguments to the unix script and
returns the same exit code on failure or success.
"""
from __future__ import annotations

import sys
import subprocess
from pathlib import Path
from typing import List


def find_unix_bootstrap(repo_root: Path) -> Path:
    """Return the path to the unix bootstrap script.

    Raises FileNotFoundError if the target does not exist.
    """
    target = repo_root / "scripts" / "unix" / "bootstrap_conversion_runtime.py"
    if not target.exists():
        raise FileNotFoundError(str(target))
    return target


def run_unix_bootstrap(python_exe: str, target: Path, args: List[str]) -> int:
    """Execute the unix bootstrap script with provided args and return exit code."""
    cmd = [python_exe, str(target), *args]
    print(f"[bootstrap-wrapper] Executing: {' '.join(cmd)}")
    try:
        completed = subprocess.run(cmd, check=True)
        return completed.returncode or 0
    except subprocess.CalledProcessError as cpe:
        print(f"[bootstrap-wrapper] Child process failed with code {cpe.returncode}", file=sys.stderr)
        return cpe.returncode or 1
    except Exception as exc:
        print(f"[bootstrap-wrapper] Failed to execute target script: {exc}", file=sys.stderr)
        return 2


def main(argv: List[str] | None = None) -> int:
    argv = list(argv or sys.argv[1:])
    repo_root = Path(__file__).resolve().parents[1]
    try:
        target = find_unix_bootstrap(repo_root)
    except FileNotFoundError as fnf:
        print(f"[bootstrap-wrapper] Target bootstrap script not found: {fnf}", file=sys.stderr)
        return 3

    python_exe = sys.executable
    return run_unix_bootstrap(python_exe, target, argv)


if __name__ == "__main__":
    raise SystemExit(main())
