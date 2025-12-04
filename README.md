# AL-Tool — Conciliação Contábil × Fiscal

Ferramenta completa para conciliar bases contábeis e fiscais sem depender de infraestrutura externa. O projeto ingere planilhas grandes, aplica regras de normalização/estorno/cancelamento, concilia por múltiplas chaves, gera relatórios, exporta evidências e opera como um aplicativo desktop totalmente offline (Electron + API local + React UI + SQLite).

## 🔎 Visão Geral
- **Domínio:** Conciliação A × B entre BASE CONTÁBIL e BASE FISCAL com regras configuráveis.
- **Pipeline:** Ingestão → Normalização → Estorno → Cancelamento → Conciliação por grupo → Resultados + Exportação ZIP.
- **Experiência do usuário:** Frontend React + MUI com feedback em tempo real (pipeline stage, progressos de exportação, métricas e filtros avançados).
- **Execução local:** Electron inicia a API e o worker Python automaticamente, garantindo operação offline com armazenamento em `SQLite` e arquivos no `DATA_DIR` do usuário.
- **Status observability:** Jobs rastreados com `status`, `pipeline_stage`, `pipeline_stage_label`, `pipeline_progress`, `export_status`, `export_progress` e notificações no front.

## 🧠 Regras de Negócio
1. **Padronização de base:** campos vazios viram "NULL" (texto) ou `0` (numérico); tabelas mantêm estrutura original.
2. **Estorno (A × A):** linhas da base contábil que se anulam somando 0 recebem status `Conciliado_Estorno` e são marcadas em `conciliacao_marks`.
3. **Cancelamento (B):** coluna de cancelamento na base fiscal (valor `S`) exclui notas dos cenários A × B.
4. **Múltiplas chaves:** chaves compostas por ordem de prioridade (`CHAVE_1`, `CHAVE_2`, ...). Cada chave vira coluna própria no resultado/exportação.
5. **Conciliação por grupo:** a pipeline agrega A e B por chave, calcula `somaA`, `somaB`, aplica inversões configuradas e classifica o grupo inteiro (Status, Grupo, Chave).
6. **Exportação:** gera ZIP com bases reconstruídas, colunas de chave, status, grupo e chave consolidada.

## 🏗️ Arquitetura e Workspaces
| Workspace | Descrição |
| --- | --- |
| `apps/api` | API REST Express + TypeScript + Knex + SQLite. Expõe rotas de ingestão, configurações, conciliações, exportação e health-check. Serve `apps/client/dist` em produção. |
| `apps/client` | React + Vite + TypeScript + Tailwind + shadcn-ui/MUI. UI moderna com DataGrid, toasts e polling de jobs/exportações. |
| `apps/desktop` | Electron (main process em TS). Spawna a API como child process, roda health-check, injeta envs, agrupa logs e empacota em instalador com electron-builder. |
| `packages/pipeline` | Motor da pipeline: `PipelineStep`, `PipelineContext`, steps reutilizáveis (normalização, estorno, cancelamento, conciliação, export). |
| `packages/domain` e `packages/shared` | Futuras bibliotecas de domínio/utilidades. |
| `scripts/` | Ferramentas auxiliares (conversion worker Python, conversão XLSB→XLSX, parser JSONL, bootstrap de runtime Python). |

Principais tecnologias: Node.js 18+, Express, Knex, better-sqlite3, Zod, workers TS, React 18, Vite, shadcn-ui/Tailwind/MUI DataGrid, Electron 28, Python 3.11 (conversão), ExcelJS/xlsx e TypeScript em todos os pacotes.

## 🔄 Pipeline de Processamento
1. **Upload & Ingestão**
   - Upload Excel/TXT/PDF em `/bases`.
   - Conversão para JSONL/SQLite via scripts Python (`conversion_worker.py`) + ingest runner (`apps/api/src/worker/ingestRunner.ts`).
   - Cada base vira `base_{id}` com colunas inferidas e índices criados on-demand (`indexHelpers`).
2. **Normalização**
   - `NullsBaseAStep` / `NullsBaseBStep`: padroniza nulos, strings e valores monetários.
3. **Estorno e Cancelamento**
   - `EstornoBaseAStep`: identifica pares que se anulam e marca estornos.
   - `CancelamentoBaseBStep`: ignora NFs canceladas antes da conciliação.
4. **Conciliação A × B**
   - `ConciliacaoABStep`: agrega por chaves múltiplas, calcula diferenças, aplica `inverter_sinal_fiscal`, classifica grupos e salva em `conciliacao_result_{jobId}`.
5. **Exportação**
   - `ConciliacaoExportService`: reconstrói bases A/B, adiciona colunas de chave/status/grupo, gera planilhas individuais e comparativo, compacta em ZIP, atualiza `jobs_conciliacao.arquivo_exportado`.

### Telemetria do pipeline
- Jobs possuem `status` (`PENDING`, `RUNNING`, `DONE`, `FAILED`).
- Cada etapa reporta `pipeline_stage`, `pipeline_stage_label` e `pipeline_progress` (0–100) para feedback granular no front.
- Exportação emite `export_status` (`STARTING`, `EXPORT_BUILDING_A`, ..., `EXPORT_DONE`, `FAILED`) e `export_progress`.

## 📦 Dados, Storage e Configuração
- **Banco:** SQLite. Em dev, `apps/api/db/dev.sqlite3`. Em produção, `DATA_DIR/db/dev.sqlite3` (dentro do diretório do usuário do Electron).
- **PRAGMAs ativos:** `journal_mode=WAL`, `synchronous=NORMAL`, `cache_size=-2000`, `temp_store=MEMORY`, `busy_timeout=5000`. Personalize via `SQLITE_JOURNAL_MODE`, `SQLITE_SYNCHRONOUS`, `SQLITE_CACHE_SIZE`, `SQLITE_TEMP_STORE`, `SQLITE_BUSY_TIMEOUT`.
- **Storage:** uploads em `<DATA_DIR>/uploads`, ingests em `<DATA_DIR>/ingests`, exports em `<DATA_DIR>/exports`.
- **Variáveis essenciais:** `APP_PORT`, `DATA_DIR`, `DB_PATH`, `UPLOAD_DIR`, `EXPORT_DIR`, `VITE_API_BASE_URL`, `PYTHON_EXECUTABLE`, `INGESTS_DIR`.
- **Bootstrap .env:** `apps/api/src/env.ts` carrega `apps/api/.env`; valores enviados pelo Electron têm precedência.

## ⚙️ Fluxos Assíncronos
### Ingestão e conversão
1. Usuário sobe arquivo → API salva em `uploads/`.
2. Runner de ingestão gera tabela SQLite em chunks (200–1000 linhas) evitando leituras repetidas.
3. Worker Python monitora `ingests/` para converter XLSB/PDF/TXT para JSONL antes da ingestão.

### Conciliação
1. `POST /conciliacoes` cria job (`jobs_conciliacao`).
2. `jobRunner` processa pipeline step a step, atualizando `pipeline_stage` antes de cada etapa e registrando erros detalhados.
3. Front (`Conciliacoes.tsx` / `ConciliacaoDetails.tsx`) realiza polling enquanto `shouldPollJob(job)` ou `isJobExporting(job)` forem verdadeiros, exibindo toasts e barras de progresso.

### Exportação
1. Usuário dispara `POST /conciliacoes/:id/exportar` ou clica em "Exportar" no front.
2. Worker gera planilhas A/B + consolidado; `export_status` guia o front.
3. Ao concluir, o botão "Baixar ZIP" fica disponível via `GET /conciliacoes/:id/download`.

## 🖥️ Frontend (React)
- Layout com shadcn-ui/Tailwind + MUI DataGrid para alto volume.
- Status chips, skeletons, toasts (`sonner`), barras de progresso e filtros amigáveis.
- Colunas de chave são geradas dinamicamente (`CHAVE_1`, `CHAVE_2`, ...); métricas agregadas exibem totais por status/grupo.

## 💻 Desktop (Electron)
- Electron calcula `DATA_DIR` via `app.getPath('userData')`, spawna API (`apps/api/dist/server.js`) e aguarda `/health` antes de abrir a UI servida pelo backend.
- Logs `[api]` e `[py-conversion]` são roteados para o console e para `<userData>/logs`.
- `npm run app:dist` executa `api:build`, `client:build`, `desktop:build`, `rebuild:native` (better-sqlite3) e `electron-builder`.
- Em dev é possível rodar `npm run desktop:dev` apontando para o dev server do client.

## 🐍 Conversion Worker (Python)
- `scripts/conversion_worker.py` converte XLSB/TXT/PDF para JSONL antes da ingestão.
- Runtime dedicado em `apps/desktop/python-runtime`, criado com `npm run python:setup` (executa `scripts/bootstrap_conversion_runtime.py`).
- Empacotado para `resources/python` em produção e executado com os mesmos envs do backend (`DATA_DIR`, `UPLOAD_DIR`, `EXPORT_DIR`, etc.).

## 🧪 Desenvolvimento Local
Requisitos: Node.js 18+, npm 10+, Python 3.11 (para worker), SQLite (opcional).

```bash
# Instalar dependências
git clone <repo>
cd al-tool
npm install

# Configurar runtime Python para o worker
npm run python:setup

# Aplicar migrations (usa DATA_DIR do repo)
npm --workspace=apps/api run migrate

# API em modo dev (http://localhost:3000)
npm run api:dev

# Frontend em modo dev (http://localhost:5173)
npm run client:dev

# Electron em dev (carrega API + client dev server)
npm run desktop:dev
```

### Dicas
- Exporte `DATA_DIR` antes da API/dev se quiser usar o mesmo caminho do Electron: `DATA_DIR=~/.config/AL-Tool/data npm run api:dev`.
- Rode `npm run api:build` e `npm run client:build` antes de `npm run app:dist`.
- `npm run python:setup` deve ser reexecutado ao atualizar `scripts/requirements.txt`.
- `electron-rebuild` está incluído em `npm run app:dist` para recompilar `better-sqlite3`.

## 📚 Referências Rápidas
- **Health:** `GET /health` → `{ status: 'ok', dataDir: '...' }`.
- **Tabelas críticas:** `bases`, `configs_*`, `jobs_conciliacao`, `conciliacao_marks`, `conciliacao_result_{jobId}`.
- **Helpers:** `apps/api/src/repos/jobsRepository.ts`, `apps/api/src/worker/jobRunner.ts`, `apps/client/src/lib/conciliacaoStatus.ts`, `apps/desktop/src/main.ts`.
- **Env overrides úteis:** `DATA_DIR`, `APP_PORT`, `DB_PATH`, `UPLOAD_DIR`, `EXPORT_DIR`, `SQLITE_*`, `VITE_API_BASE_URL`, `PYTHON_EXECUTABLE`.

## 🚀 Próximos Passos Sugeridos
1. Expandir `packages/domain` para compartilhar tipos entre API/Client.
2. Adicionar testes automatizados para steps críticos e exportação.
3. Implementar fila distribuída caso o processamento saia do ambiente local.
4. Documentar scripts de benchmark e geração de bases sintéticas.

---
Qualquer contribuição deve respeitar as regras de negócio descritas acima, manter compatibilidade entre API, frontend e desktop, e preservar o pipeline de conciliação ponta a ponta.
