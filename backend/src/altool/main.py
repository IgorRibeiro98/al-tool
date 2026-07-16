"""Entrypoint do sidecar. O shell desktop (Electron/Tauri) faz spawn deste processo.

Porta 3000 fixa (igual à v1) para o cliente React continuar apontando p/ localhost:3000.
"""

from __future__ import annotations

import os

import uvicorn


def run() -> None:
    port = int(os.environ.get("APP_PORT", "3000"))
    # 127.0.0.1 no desktop (sidecar local); 0.0.0.0 no Docker (via APP_HOST) para o
    # mapeamento de porta funcionar de fora do container.
    host = os.environ.get("APP_HOST", "127.0.0.1")
    uvicorn.run("altool.api.app:app", host=host, port=port, log_level="info")


if __name__ == "__main__":
    run()
