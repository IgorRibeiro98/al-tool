# Lista de arquivos em `apps/api` e propósito

Este arquivo lista os arquivos presentes em `apps/api` (recursivamente) com uma breve descrição do que cada um faz.

- `apps/api/.env.example`: Exemplo de variáveis de ambiente usadas pela API (modelos e valores esperados).
- `apps/api/knexfile.js`: Configuração do Knex para executar migrations e comandos de banco.
- `apps/api/readme.md`: Documentação sobre carregamento de `.env`, variáveis suportadas e dicas de uso da API.
- `apps/api/package.json`: Manifesto npm do pacote `@al-tool/api` (scripts, dependências e comandos úteis como `migrate`).
- `apps/api/tsconfig.json`: Configuração TypeScript do projeto `apps/api`.

- `apps/api/src/env.ts`: Carrega o `.env` da pasta `apps/api`, faz parsing das variáveis e exporta `env` com helpers e defaults.
- `apps/api/src/server.ts`: Configura e inicia o servidor Express; registra rotas, CORS, health checks e inicia workers em background.
- `apps/api/src/runMigrations.ts`: Script standalone para executar migrations do Knex apontando para o `DB_PATH` configurado.

- `apps/api/src/config/paths.ts`: Resolve e garante existência de diretórios (DATA_DIR, DB_PATH, UPLOAD_DIR, INGESTS, EXPORTS).
- `apps/api/knexfile.js`: Arquivo de configuração do Knex (listado acima) — usado por CLI do Knex para migrations.

- `apps/api/src/db/knex.ts`: Instancia e exporta o cliente Knex (better-sqlite3) e aplica PRAGMAs de SQLite no startup.
- `apps/api/src/db/indexHelpers.ts`: Helpers para criar índices sqlite dinamicamente e garantir índices a partir de configurações.

- `apps/api/src/infra/storage/FileStorage.ts`: Abstração para salvar/excluir/verificar arquivos de upload no disco (gera nomes únicos).

- `apps/api/src/pipeline/integration.ts`: Monta a pipeline de conciliação com os steps padrão e exporta singleton `pipeline`.
- `apps/api/src/pipeline/core/index.ts`: Implementação da `ConciliacaoPipeline` e re-exports dos steps.
- `apps/api/src/pipeline/core/steps/NullsBaseAStep.ts`: Step que normaliza valores nulos/ vazios na Base A (contábil) conforme metadata.
- `apps/api/src/pipeline/core/steps/NullsBaseBStep.ts`: Step que normaliza valores nulos/ vazios na Base B (fiscal) conforme metadata.
- `apps/api/src/pipeline/core/steps/EstornoBaseAStep.ts`: Step que detecta pares de estorno e insere `conciliacao_marks` com grupo de estorno.
- `apps/api/src/pipeline/core/steps/CancelamentoBaseBStep.ts`: Step que marca notas canceladas (insere `conciliacao_marks` de cancelamento).

- `apps/api/src/services/ExcelIngestService.ts`: Serviço responsável por processar arquivos XLSX/JSONL, criar tabelas sqlite `base_<id>` e popular os dados.
- `apps/api/src/services/baseColumnsService.ts`: Utilitário para copiar flags monetárias (is_monetary) entre bases de referência.
- `apps/api/src/services/ConciliacaoExportService.ts`: Serviço (exportação) para produzir arquivos de export dos resultados de conciliação. (arquivo presente no projeto)
- `apps/api/src/services/licensingService.ts`: Lógica relacionada a licenciamento do produto (criação/verificação de licença).

- `apps/api/src/repos/baseColumnsRepository.ts`: Repositório para obter/guardar metadata das colunas de cada base (cache em memória incluído).
- `apps/api/src/repos/ingestJobsRepository.ts`: Repositório para criar/atualizar/consultar jobs de ingestão (fila de conversão de bases).
- `apps/api/src/repos/jobsRepository.ts`: Repositório para jobs de conciliação (criação, status, pipeline stage, export progress).

- `apps/api/src/routes/bases.ts`: Rotas REST para gerenciar `bases` (upload, ingest, preview, CRUD de metadados e colunas, derived columns).
- `apps/api/src/routes/keys.ts`: Rotas CRUD para `keys_definitions` (definição de chaves de conciliação e validações).
- `apps/api/src/routes/keysPairs.ts`: Rotas CRUD para `keys_pairs` (pares contabil ↔ fiscal) e expansão das definições referenciadas.
- `apps/api/src/routes/configsMapeamento.ts`: Rotas para configurações de mapeamento (configs_mapeamento_bases) — gerencia mapeamentos usados em export/transform.
- `apps/api/src/routes/configsConciliacao.ts`: Rotas para `configs_conciliacao` (configurações que dizem como conciliar duas bases).
- `apps/api/src/routes/configsCancelamento.ts`: Rotas para `configs_cancelamento` (configurações sobre como identificar cancelamentos em bases).
- `apps/api/src/routes/configsEstorno.ts`: Rotas para `configs_estorno` (configurações de detecção de estorno / pares que somam zero).
- `apps/api/src/routes/conciliacoes.ts`: Rotas relacionadas ao gerenciamento e execução de jobs de conciliação (listar, iniciar, status, exports).
- `apps/api/src/routes/maintenance.ts`: Rotas utilitárias de manutenção (limpeza, health, ações administrativas simples).
- `apps/api/src/routes/license.ts`: Rotas para consultar/atualizar licença do produto via `licensingService`.

- `apps/api/src/worker/conciliacaoWorker.ts`: Worker que periodicamente consome `jobs_conciliacao` PENDING e dispara `jobRunner` em processo filho.
- `apps/api/src/worker/ingestWorker.ts`: Worker que consome `ingest_jobs` PENDING e dispara `ingestRunner` em processo filho.
- `apps/api/src/worker/jobRunner.ts`: Runner (executado em subprocesso) que carrega job de conciliação, prepara contexto e executa a pipeline.
- `apps/api/src/worker/ingestRunner.ts`: Runner (executado em subprocesso) que realiza o ingest usando `ExcelIngestService` (gera tabela `base_<id>`).
- `apps/api/src/worker/ingestRunner.ts.bak` and `jobRunner.ts` backups: cópias `.bak` existentes como histórico/backup local.

- `apps/api/src/worker/ingestRunner.ts` (arquivo principal): Implementa o fluxo de um job de ingest, usa `ExcelIngestService` e atualiza status no repositório.
- `apps/api/src/worker/ingestRunner.ts` (se houver variante JS no build): quando em produção usa transpiled JS (`.js`) em child process.

- `apps/api/src/worker/ingestRunner.ts` (observação): o repositório lista tanto TS quanto possíveis .js gerados; o worker escolhe qual usar conforme `NODE_ENV`.

- `apps/api/src/worker/ingestRunner.ts` (nota): se algum `*.ts.bak` existir, são backups locais — não usados em runtime.

- `apps/api/src/worker/exportRunner.ts`: Orquestra a geração de exports (arquivos ZIP/XLSX) para um job de conciliação existente.

- `apps/api/src/pipeline/core/steps/NullsBaseAStep.ts.bak` e `NullsBaseBStep.ts.bak` e outros `.bak`: backups/versionamentos locais dos steps.

- `apps/api/src/repos/baseColumnsRepository.ts.bak`: cópia de segurança do repositório de colunas.

- `apps/api/migrations/helpers/migrationHelpers.js`: Helpers usados nas migrations (criação de colunas, índices e compatibilidade retroativa).

- Migrations (ordenadas por timestamp): cada arquivo cria/atualiza partes do schema
  - `apps/api/migrations/20251125_initial_metadata.js`: Cria tabelas metadata iniciais (bases, base_columns, configs básicas, etc.).
  - `apps/api/migrations/20251126_create_base_columns.js`: Cria tabela `base_columns` e colunas relacionadas.
  - `apps/api/migrations/20251126_add_jsonl_columns_to_bases.js`: Adiciona colunas para suportar ingest via JSONL nas `bases`.
  - `apps/api/migrations/20251129_add_job_columns.js`: Adiciona colunas extras à tabela de jobs para export/progress/stage.
  - `apps/api/migrations/20251129_create_conciliacao_marks.js`: Cria tabela `conciliacao_marks` usada para marcações de pares/estornos/cancelamentos.
  - `apps/api/migrations/20251129_create_ingest_jobs.js`: Cria tabela `ingest_jobs` (fila de ingestão/conversão).
  - `apps/api/migrations/20251203_create_configs_mapeamento_bases.js`: Cria tabelas de configurações de mapeamento entre bases.
  - `apps/api/migrations/20251204_create_license_table.js`: Cria tabela de licença e campos relacionados à gestão de licença.
  - `apps/api/migrations/20251209_create_base_subtypes.js`: Adiciona `base_subtypes` para categorizar subtipos de bases.
  - `apps/api/migrations/20251210_add_base_overrides_to_jobs.js`: Adiciona campos de override de base nos jobs (para test/forçar bases).
  - `apps/api/migrations/20251210_add_subtype_and_reference_to_bases.js`: Adiciona coluna `subtype` e `reference_base_id` em `bases`.
  - `apps/api/migrations/20251211_add_indexes_for_conciliacao.js`: Cria índices para acelerar queries de conciliação.
  - `apps/api/migrations/20251211_add_unique_index_keys_definitions.js`: Adiciona índice único para `keys_definitions`.
  - `apps/api/migrations/20251211_add_unique_index_keys_pairs.js`: Adiciona índice único para `keys_pairs`.
  - `apps/api/migrations/20251215_add_pipeline_stage_columns_to_jobs.js`: Adiciona colunas relacionadas ao estágio da pipeline em `jobs_conciliacao`.
  - `apps/api/migrations/20251216_add_monetary_columns_to_base_columns.js`: Adiciona coluna `is_monetary` em `base_columns`.
  - `apps/api/migrations/20251217_create_keys_definitions_and_pairs.js`: Cria tabelas `keys_definitions` e `keys_pairs`.
  - `apps/api/migrations/20251218_create_configs_conciliacao_keys.js`: Tabela de ligação entre `configs_conciliacao` e chaves (config de chaves usadas na conciliação).

- `apps/api/migrations/helpers/migrationHelpers.js`: Funções auxiliares para as migrations (reaproveitadas por múltiplos arquivos acima).

- Arquivos `.bak` (ex.: `*.ts.bak` / `baseColumnsRepository.ts.bak`): Cópias de segurança do desenvolvimento — mantidas no repositório, não são usadas diretamente em runtime.

---
Nota: para algumas rotas/serviços/arquivos a descrição é baseada no conteúdo e nomes dos arquivos; arquivos `.bak` e variações JS/TS podem coexistir (TS para dev, JS gerado para produção). Se quiser, eu posso:

- executar um script que valide cada rota abrindo `src/routes` e gerando documentação Swagger mínima;
- ou gerar um `apps/api/FILES_SUMMARY.json` com metadados estruturados (tamanho, primeira linha, exportações principais).

Fim.
