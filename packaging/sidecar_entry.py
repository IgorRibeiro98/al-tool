"""Entrypoint do sidecar empacotado (PyInstaller).

Antes de subir a API, aponta a extensão `excel` do DuckDB para o arquivo embarcado
(sem rede/INSTALL) — ver engine.db._ensure_excel_extension.
"""

import os
import sys
from pathlib import Path


def _wire_bundled_excel() -> None:
    base = getattr(sys, "_MEIPASS", None)  # dir de runtime do PyInstaller
    if not base:
        return
    ext = Path(base) / "duckdb_ext" / "excel.duckdb_extension"
    if ext.exists():
        os.environ.setdefault("ALTOOL_EXCEL_EXTENSION", str(ext))


_wire_bundled_excel()

from altool.main import run  # noqa: E402

if __name__ == "__main__":
    run()
