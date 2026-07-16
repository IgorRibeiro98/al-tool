#!/usr/bin/env bash
# Empacota o backend Python num sidecar self-contained (PyInstaller, via spec cross-platform).
# Roda no próprio SO (PyInstaller não faz cross-compile). Saída: packaging/dist/altool-sidecar/.
# No Windows/macOS o CI invoca o mesmo spec: `pyinstaller packaging/altool-sidecar.spec`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
pyinstaller --noconfirm --distpath packaging/dist --workpath packaging/build packaging/altool-sidecar.spec
echo "OK → packaging/dist/altool-sidecar/altool-sidecar"
