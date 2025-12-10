#!/usr/bin/env python3
"""Prepare a relocatable Windows Python embeddable runtime for bundling.

This script downloads the official embeddable zip, patches its *_pth file to
enable standard imports, and installs the project's requirements by building
wheels with the host Python and extracting them into the embeddable root.

The script is intended to run on a Windows build machine (or CI) and keeps
operations explicit and recoverable.
"""
from __future__ import annotations

import argparse
import sys
import shutil
import tempfile
import urllib.request
import zipfile
import os
import subprocess
from pathlib import Path


DEFAULT_VERSION = "3.12.3"
PYTHON_EMBED_URL_TPL = "https://www.python.org/ftp/python/{v}/python-{v}-embed-amd64.zip"
GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py"
EMBED_SITE_PACKAGES_REL = Path("Lib") / "site-packages"


def log(msg: str) -> None:
    print(f"[prepare-python-win] {msg}")


def download(url: str, dest: Path) -> None:
    log(f"Downloading {url} -> {dest}")
    urllib.request.urlretrieve(url, str(dest))


def safe_run(cmd: list[str], cwd: Path | None = None) -> None:
    log(f"Running: {' '.join(cmd)}")
    subprocess.run(cmd, check=True, cwd=str(cwd) if cwd else None)


def extract_zip(zip_path: Path, target: Path) -> None:
    log(f"Extracting {zip_path} -> {target}")
    with zipfile.ZipFile(zip_path, "r") as z:
        z.extractall(target)


def patch_embedded_pth(embed_dir: Path) -> None:
    """Ensure the embedded runtime loads site-packages and executes `import site`.

    Modifies any *_pth file found in the root of the embedded distribution.
    """
    try:
        pth_files = list(embed_dir.glob("*._pth"))
        if not pth_files:
            log("No *_pth file found; skipping patch.")
            return

        for pth in pth_files:
            text = pth.read_text(encoding="utf-8")
            lines = [ln.rstrip("\n") for ln in text.splitlines()]

            normalized = [ln.replace("/", "\\").strip().lower() for ln in lines if ln.strip()]
            changed = False

            sp_str = str(EMBED_SITE_PACKAGES_REL).replace('/', '\\')
            if sp_str.lower() not in normalized:
                log(f"Patching {pth.name}: adding '{sp_str}'")
                lines.append(sp_str)
                changed = True
            else:
                log(f"{pth.name}: contains site-packages entry")

            if not any(ln.strip() == "import site" for ln in lines):
                log(f"Patching {pth.name}: enabling 'import site'")
                lines.append("import site")
                changed = True

            if changed:
                pth.write_text("\n".join(lines) + "\n", encoding="utf-8")
    except Exception as exc:
        log(f"Warning: failed to patch _pth file: {exc}")


def install_pip_best_effort(python_exe: Path, tmp_dir: Path) -> None:
    """Try to bootstrap pip into the embedded interpreter (best-effort).

    Failures here do not abort the overall runtime preparation because we
    install requirements by building wheels with the host Python instead.
    """
    gp = tmp_dir / "get-pip.py"
    try:
        log("Downloading get-pip.py")
        download(GET_PIP_URL, gp)
        log("Running get-pip.py inside embedded python (best-effort)")
        safe_run([str(python_exe), str(gp), "--disable-pip-version-check"], cwd=tmp_dir)
        log("pip bootstrapped into embedded runtime via get-pip.py")
        return
    except subprocess.CalledProcessError as cpe:
        log(f"get-pip.py failed: {cpe}")
    except Exception as exc:
        log(f"Unexpected error running get-pip.py: {exc}")

    # Fallback: try ensurepip if available
    try:
        log("Attempting ensurepip fallback (best-effort)")
        safe_run([str(python_exe), "-m", "ensurepip", "--default-pip"]) 
        log("pip bootstrapped into embedded runtime via ensurepip")
    except Exception as exc:
        log(f"Failed to bootstrap pip into embedded runtime; continuing without pip: {exc}")


def build_wheels_with_host(host_python: str, requirements: Path, wheel_dir: Path) -> None:
    wheel_dir.mkdir(parents=True, exist_ok=True)
    cmd = [host_python, "-m", "pip", "wheel", "-r", str(requirements), "-w", str(wheel_dir)]
    safe_run(cmd)


def copy_tree_item(src: Path, dest: Path) -> None:
    if dest.exists():
        if dest.is_dir():
            shutil.rmtree(dest)
        else:
            dest.unlink()
    if src.is_dir():
        shutil.copytree(src, dest)
    else:
        shutil.copy2(src, dest)


def install_wheels_by_extracting(wheel_dir: Path, target_site_packages: Path, target_scripts: Path) -> None:
    """Install wheels by extracting their contents into the embedded runtime."""
    import zipfile as _zip

    target_site_packages.mkdir(parents=True, exist_ok=True)

    for wh in sorted(wheel_dir.glob("*.whl")):
        log(f"Installing wheel by extraction: {wh.name}")
        with _zip.ZipFile(wh, "r") as z:
            with tempfile.TemporaryDirectory() as td:
                tdpath = Path(td)
                z.extractall(tdpath)

                # Handle .data (purelib/platlib/scripts)
                for data in tdpath.iterdir():
                    if not data.name.endswith(".data") or not data.is_dir():
                        continue

                    for lib_name in ("purelib", "platlib"):
                        lib_dir = data / lib_name
                        if not lib_dir.exists():
                            continue
                        for sub in lib_dir.iterdir():
                            dest = target_site_packages / sub.name
                            copy_tree_item(sub, dest)

                    scripts_sub = data / "scripts"
                    if scripts_sub.exists():
                        target_scripts.mkdir(parents=True, exist_ok=True)
                        for script_file in scripts_sub.iterdir():
                            dest = target_scripts / script_file.name
                            if dest.exists():
                                dest.unlink()
                            shutil.copy2(script_file, dest)

                # Handle top-level modules/packages/dist-info
                for item in tdpath.iterdir():
                    if item.name.endswith(".data"):
                        continue
                    dest = target_site_packages / item.name
                    copy_tree_item(item, dest)


def copy_to_standard_runtime(src: Path, dst: Path) -> None:
    if dst.exists():
        log(f"Removing existing standard runtime at {dst}")
        shutil.rmtree(dst)
    log(f"Copying prepared runtime {src} -> {dst}")
    shutil.copytree(src, dst)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", default=DEFAULT_VERSION)
    parser.add_argument("--force", action="store_true", help="Recreate runtime even if target exists")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    target_win = repo_root / "apps" / "desktop" / "python-runtime-win"
    standard_target = repo_root / "apps" / "desktop" / "python-runtime"
    requirements = repo_root / "scripts" / "requirements.txt"

    if not requirements.exists():
        print(f"Requirements file not found: {requirements}", file=sys.stderr)
        return 1

    url = PYTHON_EMBED_URL_TPL.format(v=args.version)

    # Download / extract embeddable if needed
    if target_win.exists() and not args.force:
        log(f"Target {target_win} already exists (use --force to recreate). Skipping download/extract.")
    else:
        if target_win.exists():
            shutil.rmtree(target_win)
        target_win.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory() as td:
            td_path = Path(td)
            zip_path = td_path / "python-embed.zip"
            download(url, zip_path)
            extract_zip(zip_path, target_win)

    # Patch pythonXY._pth so site-packages and import site work
    patch_embedded_pth(target_win)

    # Locate python.exe inside the embedded package
    python_exe = target_win / "python.exe"
    if not python_exe.exists():
        cand = list(target_win.rglob("python.exe"))
        if cand:
            python_exe = cand[0]
        else:
            print(f"python.exe not found in extracted embeddable at {target_win}", file=sys.stderr)
            return 2

    log(f"Using embedded python at: {python_exe}")

    # Best-effort pip installation inside embedded (not required for requirements)
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        install_pip_best_effort(python_exe, tmp)

    # Install requirements into embedded runtime using host Python (sys.executable)
    site_packages = target_win / "Lib" / "site-packages"
    scripts_dir = target_win / "Scripts"

    with tempfile.TemporaryDirectory() as td:
        wheel_dir = Path(td) / "wheels"
        try:
            host_python = sys.executable
            log(f"Building wheels using host python: {host_python}")
            build_wheels_with_host(host_python, requirements, wheel_dir)
            install_wheels_by_extracting(wheel_dir, site_packages, scripts_dir)
        except Exception as exc:
            print(f"Failed to build/extract wheels with host Python: {exc}", file=sys.stderr)
            return 3

    # For compatibility with current packaging (extraResources maps python-runtime -> resources/python)
    if os.name == "nt":
        try:
            copy_to_standard_runtime(target_win, standard_target)
        except Exception as exc:
            log(f"Warning: failed to copy prepared runtime to standard location: {exc}")

    log(f"Embedded Python runtime prepared successfully at {target_win}")
    log("If you plan to build the installer now, run: npm run app:dist")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
