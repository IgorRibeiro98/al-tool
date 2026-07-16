# Empacotamento do sidecar — spike (resultado)

Prova de que o backend Python roda como **sidecar self-contained**, spawnado pelo shell
desktop, **offline**. Retira o risco 🟡 de empacotamento do plano ([../docs/remake-v2-python.md](../docs/remake-v2-python.md) §5).

## Resultado (Linux x86_64) — ✅

| Item | Resultado |
|---|---|
| Artefato self-contained | PyInstaller onedir — **não depende de Python/venv do sistema** |
| Boot até `/health` | **~0,5s** |
| Ingestão `.xlsx` no binário standalone | ✅ (upload → ingest → READY) |
| Extensão `excel` do DuckDB **offline** | ✅ embarcada (`_internal/duckdb_ext/excel.duckdb_extension`), carregada via `LOAD '<path>'` — **sem INSTALL/rede** |
| Tamanho do bundle (onedir, sem compressão) | **~496 MB** — `pyarrow` é o maior contribuinte (ver "Enxugar") |

## Componentes

- **`build-sidecar.sh`** — build reproduzível (PyInstaller onedir), embarca a extensão excel.
- **`sidecar_entry.py`** — entrypoint; aponta `ALTOOL_EXCEL_EXTENSION` para o arquivo embarcado (`sys._MEIPASS`) antes de subir a API.
- **`spawn-sidecar.mjs`** — harness que **modela o que o Electron/Tauri fará**: spawna o sidecar, faz probe do `/health` até responder, mata no fim. Serve tanto para o venv (`backend/.venv/bin/python -m altool.main`) quanto para o binário empacotado.

O `engine/db.py` carrega a extensão offline-first: `ALTOOL_EXCEL_EXTENSION` (arquivo embarcado) → cache local → `INSTALL` (só em dev, com rede).

## Como reproduzir

```bash
cd backend && python3 -m venv .venv && . .venv/bin/activate && pip install -e '.[dev]' pyinstaller
cd .. && bash packaging/build-sidecar.sh
# spawn do binário standalone (padrão Electron):
APP_PORT=8091 node packaging/spawn-sidecar.mjs packaging/dist/altool-sidecar/altool-sidecar
```

## Integração no shell desktop — ✅ implementada

`apps/desktop/src/main.ts` já faz `spawn()` do sidecar (dev: `backend/.venv` + `-m altool.main`;
packaged: `resources/altool-sidecar/altool-sidecar`), health-probe e kill no `before-quit`.
**Validado com Electron real (xvfb)**: boot → spawn do sidecar → `/health` OK → serve SPA+API.

O `electron-builder` (`apps/desktop/package.json` → `build.extraResources`) embarca:
`packaging/dist/altool-sidecar` → `resources/altool-sidecar`, e `client/dist` → `resources/client/dist`.

**Ordem de build do instalador (por SO):**
```bash
npm run client:build                 # gera apps/client/dist
bash packaging/build-sidecar.sh      # gera packaging/dist/altool-sidecar (deste SO)
npm --workspace=apps/desktop run build && npm --workspace=apps/desktop run dist
```

## Pendências cross-SO

- **Windows / macOS**: rodar `build-sidecar.sh` (equivalente) **em cada SO** — PyInstaller não faz cross-compile. CI com runners win/mac/linux gera os 3 binários. O caminho da extensão excel muda por plataforma (`windows_amd64`, `osx_*`); o script já descobre dinamicamente.
- **Antivírus (Windows)**: onedir tende a ter menos falso-positivo que onefile; assinar o executável.
- A recomendação do plano (python-build-standalone) é uma **variação com o mesmo contrato de spawn** — este spike provou a viabilidade via PyInstaller; a escolha final pode trocar a ferramenta sem mudar `sidecar_entry.py`/`spawn-sidecar.mjs`.

## Enxugar o bundle (roadmap R7)

- **`pyarrow`** é o maior peso e é usado só em `ingest_calamine` (`pa.table`). Trocar por Polars nesse caminho permitiria **remover pyarrow** do runtime → bundle bem menor.
- `--exclude-module` para tests/tkinter/etc.; UPX opcional.
