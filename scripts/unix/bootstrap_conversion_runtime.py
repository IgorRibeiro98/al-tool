#!/usr/bin/env python3
"""Create and bootstrap a dedicated Python virtualenv for the desktop conversion runtime.

Responsibilities:
- Ensure a venv exists at `apps/desktop/python-runtime`.
- Install pip (fallback to get-pip.py when necessary).
- Install package requirements from `scripts/requirements.txt`.

Design goals: single-purpose functions, clear logging, early returns,
and recoverable fallbacks for common platform issues.
"""
from __future__ import annotations

from pathlib import Path
import sys
import shutil
import tempfile
import urllib.request
import subprocess
import venv
import os


REPO_ROOT = Path(__file__).resolve().parents[2]
RUNTIME_DIR = REPO_ROOT / 'apps' / 'desktop' / 'python-runtime'
REQUIREMENTS = REPO_ROOT / 'scripts' / 'requirements.txt'
GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py'

NEXT_VALIDATION_MS = 30 * 24 * 60 * 60 * 1000  # not used here but kept for parity


def log(msg: str) -> None:
    print(f"[python-bootstrap] {msg}")


def python_executable(runtime_dir: Path) -> Path:
    """Return the expected python executable inside a venv for the current platform."""
    if sys.platform == 'win32':
        return runtime_dir / 'Scripts' / 'python.exe'
    # Prefer python3 but fall back to python
    candidate = runtime_dir / 'bin' / 'python3'
    if candidate.exists():
        return candidate
    return runtime_dir / 'bin' / 'python'


def safe_run(cmd: list[str], **kwargs) -> None:
    """Run a command and raise a clear exception on failure."""
    log(f"Running: {' '.join(str(c) for c in cmd)}")
    subprocess.run(cmd, check=True, **kwargs)


def download_get_pip(dest: Path) -> None:
    """Download get-pip.py to the destination path."""
    log(f"Downloading get-pip.py -> {dest}")
    urllib.request.urlretrieve(GET_PIP_URL, str(dest))


def create_virtualenv(runtime_dir: Path, with_pip: bool = True) -> None:
    """Create a virtualenv at runtime_dir. Raises on unrecoverable errors."""
    builder = venv.EnvBuilder(with_pip=with_pip, clear=False, upgrade=True)
    builder.create(runtime_dir)


def bootstrap_venv_with_get_pip(runtime_dir: Path) -> None:
    """Fallback bootstrap: create venv without pip and run get-pip.py inside it."""
    log("Falling back to venv creation without pip and bootstrapping get-pip.py")
    create_virtualenv(runtime_dir, with_pip=False)
    py = python_executable(runtime_dir)
    if not py.exists():
        raise RuntimeError(f"Python binary missing after venv creation: {py}")

    with tempfile.TemporaryDirectory() as tmp:
        gp = Path(tmp) / 'get-pip.py'
        download_get_pip(gp)
        safe_run([str(py), str(gp), '--disable-pip-version-check'])


def ensure_runtime_dir() -> Path:
    """Ensure the Python runtime venv exists; return the runtime path."""
    log(f"Ensuring virtualenv at {RUNTIME_DIR}")
    try:
        create_virtualenv(RUNTIME_DIR, with_pip=True)
    except Exception as exc:
        log(f"Default venv creation failed: {exc}")
        # Try fallback bootstrapping flow
        bootstrap_venv_with_get_pip(RUNTIME_DIR)

    return RUNTIME_DIR


def install_requirements(python_path: Path, requirements_file: Path) -> None:
    if not requirements_file.exists():
        raise FileNotFoundError(f"Requirements file not found: {requirements_file}")

    # Upgrade pip first, then install requirements
    safe_run([str(python_path), '-m', 'pip', 'install', '--upgrade', 'pip'])
    safe_run([str(python_path), '-m', 'pip', 'install', '--upgrade', '-r', str(requirements_file)])


def main() -> int:
    try:
        if not REQUIREMENTS.exists():
            print(f"[python-bootstrap] Requirements file not found: {REQUIREMENTS}", file=sys.stderr)
            return 1

        runtime_path = ensure_runtime_dir()
        py = python_executable(runtime_path)
        if not py.exists():
            print(f"[python-bootstrap] Python binary missing after venv creation: {py}", file=sys.stderr)
            return 2

        install_requirements(py, REQUIREMENTS)
        log('Runtime ready.')
        return 0
    except subprocess.CalledProcessError as cpe:
        print(f"[python-bootstrap] Command failed: {cpe}", file=sys.stderr)
        return 3
    except Exception as exc:
        print(f"[python-bootstrap] Error: {exc}", file=sys.stderr)
        return 4


if __name__ == '__main__':
    raise SystemExit(main())
