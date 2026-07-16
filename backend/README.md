# AL-Tool v2 — backend (Python)

FastAPI + DuckDB + Polars. Substitui `apps/api` (Node/Express). Ver plano em
[../docs/remake-v2-python.md](../docs/remake-v2-python.md).

## Estado: Fase 0 pronta + Fase 1 (ingestão) validada

- ✅ Regras de negócio puras portadas **fiéis à v1** (`src/altool/domain/`), com testes exaustivos
- ✅ `machine_fingerprint` valida contra **golden hash gerado pelo Node** (compatibilidade de licença)
- ✅ Engine DuckDB inicializável; protótipo de conciliação set-based em SQL comprovado
- ✅ FastAPI `/health` sobe como sidecar (prova do processo que o shell desktop fará `spawn`)
- ✅ **Ingestão xlsx → DuckDB** (`engine/ingest.py`) validada nos dados reais de `storage/ref`:
  Livro de Entradas (148MB, **429k linhas × 73 cols**) em **~12s a ~508MB de RAM**
- ✅ **Conciliação A×B set-based** (`engine/conciliacao.py`) — substitui `ConciliacaoABStep` (978 l):
  83k grupos reais em **~0,1s / ~130MB**; classificação SQL == `classify_group` (Python) em todos os grupos
- ✅ **Pipeline encadeado** (`engine/pipeline.py`) Estorno → Cancelamento → Conciliação, na ordem da v1:
  1.802 cancelamentos reais excluídos; estorno = port fiel do guloso O(n)
- ✅ **Multi-chave priorizada + resultado nível-linha** (`conciliar_multichave` / `run_conciliacao`):
  468k linhas em **~6s**; carry-forward CHAVE_1→CHAVE_2 comprovado; invariante total = |A|+|B|
- ✅ **Ingestão multi-formato** (`ingest()`): xlsx (read_xlsx), xlsb/xls (calamine), csv/txt (read_csv)
- ✅ **Export XLSX** (`engine/export.py`) — header estilizado + monetário BR, streaming:
  468k linhas → 15,8 MB em ~15s a ~327MB de RAM
- ✅ **Atribuição** (`engine/atribuicao.py`) — substitui `atribuicaoRunner` (558 l): chaves priorizadas,
  OVERWRITE/ONLY_EMPTY; Razão→Livro 42,7k linhas em ~0,1s
- ✅ **Camada de API** — FastAPI + storage híbrido (`MetadataStore` SQLite + `DuckDBStore`):
  **licença**, **bases**, **conciliações**, **atribuições** completas (create → engine no
  `JobWorker` → resultado → export/download xlsx) + **CRUD de configs/keys/keys-pairs**, contrato v1
- ✅ **165 testes unitários** + **8 de integração** (dados reais) verdes

## Rodar

```bash
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -e '.[dev]'

pytest                          # suíte rápida (unit; exclui integração)
pytest -m integration           # valida ingestão contra storage/ref (~25s)
APP_PORT=8099 python -m altool.main   # sobe o sidecar (default 3000)
curl http://127.0.0.1:8099/health
```

## Rodar via Docker (ambiente local, sem instalar nada)

Da raiz do repo — o sidecar serve a API **e** o SPA React na mesma porta:

```bash
docker compose up --build          # sobe em http://localhost:3100
docker compose down                # para
docker volume rm al-tool_altool-data   # reseta os dados persistidos
```

O `Dockerfile` (multi-stage) builda o React e instala o backend; a extensão `excel` do
DuckDB é pré-baixada no build (runtime offline). Dados persistem no volume `altool-data`.
Para desktop com Electron, ver a raiz (`npm run desktop:dev`).

## Estrutura

```
src/altool/
  domain/      regras PURAS (sem I/O) — fonte da verdade: a v1
    constants.py    EPSILON, status, labels (conciliacaoHelper.ts)
    matching.py     classify_group, normalize_amount, compose_key, sum_column
    nulls.py        parse_numeric, normalização monetária/texto (T52)
    columns.py      sanitize_column_name (bit-idêntico à v1)
    estorno.py      soma_to_key, is_estorno_pair
    fingerprint.py  hash puro (testado vs Node) + coleta best-effort
  metadata/    store.py — SQLite de metadados (license, bases, base_columns, ingest_jobs)
  services/    licensing.py — get_status (offline) + activate
               jobs.py — job model genérico + JobWorker multi-fila
               bases.py — CRUD de bases + process_ingest (job)
               configs.py, keys.py — configs e keys/keysPairs
               conciliacoes.py — job de conciliação (run → metrics → resultado → export)
               atribuicoes.py — run de atribuição (create → start → run → export)
  api/         app.py (FastAPI, /health, /api/diagnostics/env, lifespan do worker)
               routers/ — license, bases, conciliacoes, atribuicoes, configs, keys
  engine/      db.py — bootstrap DuckDB + extensão excel
               data_store.py — DuckDB persistente (dados) + lock
               ingest.py — read_xlsx dirigido por IngestSpec(header_row, start_col)
               conciliacao.py — conciliação A×B + multi-chave nível-linha
               pipeline.py — orquestra estorno → cancelamento → conciliação
               export.py — export XLSX (streaming, monetário BR)
               atribuicao.py — cópia de colunas por chave (OVERWRITE/ONLY_EMPTY)
  api/         app.py — FastAPI (/health; próximos: routers do contrato v1)
  main.py      entrypoint do sidecar (uvicorn, porta 3000)
tests/         unitários exaustivos por regra + contrato /health
```

## Pendências conhecidas (próximas fases)

- **fingerprint.gather_parts / _cpu_model**: `platform.processor()` no Linux costuma
  devolver `x86_64` em vez do modelo Intel que o Node lê via `os.cpus()[0].model`.
  Reconciliar por SO na **Fase 4** (ex.: `/proc/cpuinfo`, WMI/registry no Windows).
  A função de hash já é 100% compatível — falta só alimentar os mesmos valores.
- Portar demais regras/engine (ingestão, atribuição, cancelamento, export) — Fases 1-3.
