#!/usr/bin/env python3
"""Bootstrap the embedded Python runtime used by the Electron conversion worker.
- Creates/updates a virtualenv at apps/desktop/python-runtime
- Installs requirements from scripts/requirements.txt
Run via: python3 scripts/bootstrap_conversion_runtime.py
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
import venv

REPO_ROOT = Path(__file__).resolve().parents[1]
RUNTIME_DIR = REPO_ROOT / 'apps' / 'desktop' / 'python-runtime'
REQUIREMENTS = REPO_ROOT / 'scripts' / 'requirements.txt'


def ensure_runtime_dir() -> Path:
    print(f"[python-bootstrap] Creating virtualenv at {RUNTIME_DIR}")
    builder = venv.EnvBuilder(with_pip=True, clear=False, upgrade=True)
    builder.create(RUNTIME_DIR)
    return RUNTIME_DIR


def python_bin(runtime_dir: Path) -> Path:
    if sys.platform == 'win32':
        return runtime_dir / 'Scripts' / 'python.exe'
    return runtime_dir / 'bin' / 'python3'


def run(cmd, **kwargs):
    print(f"[python-bootstrap] Running: {' '.join(str(c) for c in cmd)}")
    subprocess.check_call(cmd, **kwargs)


def install_requirements(python_path: Path):
    run([python_path, '-m', 'pip', 'install', '--upgrade', 'pip'])
    run([python_path, '-m', 'pip', 'install', '--upgrade', '-r', str(REQUIREMENTS)])


def main():
    if not REQUIREMENTS.exists():
        print(f"[python-bootstrap] Requirements file not found: {REQUIREMENTS}", file=sys.stderr)
        sys.exit(1)
    runtime_path = ensure_runtime_dir()
    py = python_bin(runtime_path)
    if not py.exists():
        print(f"[python-bootstrap] Python binary missing after venv creation: {py}", file=sys.stderr)
        sys.exit(1)
    install_requirements(py)
    print('[python-bootstrap] Runtime ready.')


if __name__ == '__main__':
    main()
