# AL-Tool API

<p align="center">
  <img src="https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white" alt="Express"/>
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white" alt="SQLite"/>
  <img src="https://img.shields.io/badge/Knex-3.x-E16426?logo=knex&logoColor=white" alt="Knex"/>
</p>

API REST backend do AL-Tool, responsável por toda a lógica de negócio: ingestão de bases, configurações, pipeline de conciliação, exportação e licenciamento.

---

## 📑 Índice

- [Visão Geral](#-visão-geral)
- [Estrutura de Diretórios](#-estrutura-de-diretórios)
- [Configuração e Variáveis de Ambiente](#-configuração-e-variáveis-de-ambiente)
- [Instalação e Desenvolvimento](#-instalação-e-desenvolvimento)
- [Banco de Dados (SQLite)](#-banco-de-dados-sqlite)
- [Migrations](#-migrations)
- [Endpoints da API](#-endpoints-da-api)
- [Pipeline de Processamento](#-pipeline-de-processamento)
- [Workers Assíncronos](#-workers-assíncronos)
- [Serviços](#-serviços)
- [Exemplos de Uso](#-exemplos-de-uso)
- [Troubleshooting](#-troubleshooting)

---

## 🔎 Visão Geral

A API do AL-Tool é uma aplicação **Express + TypeScript** que:

- Expõe endpoints REST para gerenciamento de bases, configurações e jobs
- Processa pipeline de conciliação contábil × fiscal
- Armazena dados em **SQLite** com mode WAL para alta performance
- Serve o frontend compilado em produção
- Inclui workers para processamento assíncrono de ingestão e conciliação

### Tecnologias Utilizadas

| Tecnologia | Versão | Uso |
|------------|--------|-----|
| Express | 5.x | Framework HTTP |
| TypeScript | 5.x | Tipagem estática |
| Knex | 3.x | Query builder e migrations |
| better-sqlite3 | 12.x | Driver SQLite nativo |
| ExcelJS | 4.x | Geração de planilhas Excel |
| xlsx | 0.18.x | Leitura de arquivos Excel |
| Archiver | 5.x | Geração de arquivos ZIP |
| Multer | 2.x | Upload de arquivos |

---

## 🚀 Otimização de Performance

A API implementa um sistema de **configuração dinâmica** que ajusta automaticamente os parâmetros de performance com base na RAM disponível na máquina.

### Tiers de Memória

O sistema detecta automaticamente a RAM total e configura os parâmetros:

| Tier | RAM Total | Workers | SQLite Cache | SQLite MMAP | Batch JSONL | Batch XLSX |
|------|-----------|---------|--------------|-------------|-------------|------------|
| **Low** | < 6 GB | 2 | ~100 MB | ~256 MB | 2.500 | 1.500 |
| **Standard** | 6-10 GB | 4 | ~400 MB | ~512 MB | 5.000 | 3.000 |
| **High** | > 10 GB | 6+ | ~800 MB | ~1 GB | 10.000 | 5.000 |

### Arquitetura de Performance

```
src/config/performance.ts    # Módulo centralizado de configuração
├── getMemoryTier()          # Detecta tier (low/standard/high)
├── getMemoryBasedConfig()   # Configurações para o tier atual
├── shouldUseParallelExport()
├── getRecommendedWorkerCount()
└── logPerformanceSettings() # Log das configurações ativas
```

### Componentes Otimizados

1. **Worker Threads** (`src/workers/config.ts`)
   - Pool size calculado: `(RAM - 3.5GB) × 0.5 workers/GB`
   - Máximo 4 workers para 8GB RAM
   - Reserva memória para SO + Node + SQLite

2. **SQLite** (`src/db/knex.ts`)
   - Cache size: ~5% da RAM total
   - MMAP size: ~8% da RAM total
   - WAL mode + NORMAL sync para balance performance/durabilidade

3. **Pipeline Steps** (`src/pipeline/core/steps/`)
   - PAGE_SIZE dinâmico para conciliação
   - Batch sizes adaptativos por step

4. **Exportação** (`src/services/ConciliacaoExportService.ts`)
   - Chunks de leitura ajustados
   - Compressão ZIP nível 6 (balance velocidade/tamanho)
   - Export paralelo Base A + B (se RAM disponível)

5. **Índices** (`src/db/indexHelpers.ts`)
   - Criação paralela de índices (batches de 5)
   - Índices temporários para queries grandes

### Variáveis de Override

O sistema usa valores automáticos, mas você pode forçar configurações específicas:

```bash
# Workers
WORKER_POOL_SIZE=4              # Força número de workers
WORKER_INGEST_BATCH_SIZE=5000   # Batch para ingestão

# SQLite
SQLITE_CACHE_SIZE=-250000       # Cache em KB (negativo = KB)
SQLITE_MMAP_SIZE=1073741824     # MMAP em bytes

# Ingestão
INGEST_BATCH_SIZE=15000         # Override para batch de ingestão

# Exportação
EXPORT_CHUNK_SIZE=25000         # Linhas por query de export
EXPORT_PARALLEL_BASES=true      # Export Base A + B em paralelo
```

### Perfil de Referência

Configuração otimizada para: **8GB RAM, Intel i5 8ª Gen, Windows 11, SSD**

| Métrica | Valor Esperado |
|---------|----------------|
| Workers ativos | 4 |
| Cache SQLite | ~400 MB |
| MMAP SQLite | ~500 MB |
| Ingestão JSONL | 5.000 rows/batch |
| Conciliação PAGE_SIZE | 10.000 |
| Export paralelo | Habilitado |

---

## 📁 Estrutura de Diretórios

\`\`\`
apps/api/
├── migrations/                 # Migrations Knex
│   ├── helpers/                # Helpers para migrations
│   └── *.js                    # Arquivos de migration
├── src/
│   ├── config/
│   │   └── paths.ts            # Resolução de diretórios
│   ├── db/
│   │   ├── knex.ts             # Configuração Knex + PRAGMAs
│   │   └── indexHelpers.ts     # Utilitários de índices
│   ├── infra/
│   │   └── storage/            # Abstrações de storage
│   ├── lib/                    # Bibliotecas utilitárias
│   ├── pipeline/
│   │   ├── core/
│   │   │   ├── index.ts        # Interfaces do pipeline
│   │   │   └── steps/          # Steps do pipeline
│   │   ├── cancelamento/       # Step de cancelamento
│   │   ├── estorno/            # Step de estorno
│   │   └── integration.ts      # Integração do pipeline
│   ├── repos/                  # Repositórios (data access)
│   ├── routes/                 # Rotas Express
│   ├── services/               # Serviços de negócio
│   ├── worker/                 # Workers assíncronos
│   ├── env.ts                  # Carregamento de variáveis
│   ├── runMigrations.ts        # Executor de migrations
│   └── server.ts               # Entry point
├── storage/                    # Dados locais (dev)
├── .env                        # Variáveis de ambiente
├── knexfile.js                 # Configuração Knex
├── package.json
└── tsconfig.json
\`\`\`

---

## 🌍 Configuração e Variáveis de Ambiente

### Como Funciona o Carregamento

1. \`src/env.ts\` executa \`dotenv.config({ path: 'apps/api/.env' })\` no bootstrap
2. \`src/server.ts\` importa \`./env\` como primeira instrução
3. Variáveis ficam disponíveis para \`paths.ts\` e demais módulos

### Arquivo \`.env\`

Crie \`apps/api/.env\` com as variáveis necessárias:

\`\`\`bash
# ============================================
# SERVIDOR
# ============================================

# Porta do servidor HTTP
# Default: 3000
APP_PORT=3000

# Ambiente de execução
# Valores: development, production, test
# Default: development
NODE_ENV=development

# ============================================
# DIRETÓRIOS DE DADOS
# ============================================

# Diretório raiz de dados (contém db, uploads, exports, ingests)
# Default: ./storage (relativo ao CWD)
DATA_DIR=/caminho/para/dados

# Caminho completo do arquivo SQLite
# Default: <DATA_DIR>/db/dev.sqlite3
DB_PATH=/caminho/para/dados/db/dev.sqlite3

# Diretório para arquivos enviados pelo usuário
# Default: <DATA_DIR>/uploads
UPLOAD_DIR=/caminho/para/dados/uploads

# Diretório para arquivos exportados (ZIPs)
# Default: <DATA_DIR>/exports
EXPORT_DIR=/caminho/para/dados/exports

# Diretório para arquivos JSONL intermediários
# Default: <DATA_DIR>/ingests
INGESTS_DIR=/caminho/para/dados/ingests

# ============================================
# CORS
# ============================================

# Origens permitidas (separadas por vírgula)
# Use * para permitir qualquer origem (desenvolvimento)
# Default: *
CORS_ORIGIN=http://localhost:5173,http://localhost:3000

# ============================================
# SQLITE - PERFORMANCE TUNING
# ============================================

# Modo do journal
# Valores: WAL, DELETE, TRUNCATE, PERSIST, MEMORY, OFF
# Recomendado: WAL (melhor performance para read-heavy workloads)
# Default: WAL
SQLITE_JOURNAL_MODE=WAL

# Nível de sincronização
# Valores: OFF, NORMAL, FULL, EXTRA
# Default: NORMAL
SQLITE_SYNCHRONOUS=NORMAL

# Tamanho do cache em páginas (negativo = páginas, ~4KB cada)
# Default: -4000 (dev), -8000 (prod)
SQLITE_CACHE_SIZE=-8000

# Onde armazenar tabelas temporárias
# Valores: DEFAULT, FILE, MEMORY
# Default: MEMORY
SQLITE_TEMP_STORE=MEMORY

# Timeout para aguardar lock (milissegundos)
# Default: 30000
SQLITE_BUSY_TIMEOUT=30000

# ============================================
# PAGINAÇÃO
# ============================================

API_DEFAULT_PAGE_SIZE=20
API_MAX_PAGE_SIZE=100
API_RESULT_PAGE_SIZE=50

# ============================================
# LICENCIAMENTO (OPCIONAL)
# ============================================

LICENSE_API_BASE_URL=https://license.suaempresa.com
\`\`\`

### Precedência de Variáveis

\`\`\`
1. process.env (shell, Electron)     ← Maior precedência
2. Arquivo .env
3. Defaults no código               ← Menor precedência
\`\`\`

---

## 🚀 Instalação e Desenvolvimento

### Scripts Disponíveis

| Script | Descrição |
|--------|-----------|
| \`npm run dev\` | Inicia com ts-node-dev (hot reload) |
| \`npm run build\` | Compila TypeScript para \`dist/\` |
| \`npm run start\` | Inicia \`dist/server.js\` |
| \`npm run migrate\` | Executa migrations pendentes |
| \`npm run migrate:make <nome>\` | Cria nova migration |

### Desenvolvimento

\`\`\`bash
# Iniciar API em modo dev
npm --workspace=apps/api run dev
# ou da raiz:
npm run api:dev

# Servidor disponível em http://localhost:3000
\`\`\`

### Verificação

\`\`\`bash
curl http://localhost:3000/health
# { "status": "ok", "dataDir": "...", "dbPath": "..." }
\`\`\`

---

## 🗄️ Banco de Dados (SQLite)

### PRAGMAs Aplicados (Dinâmico)

O SQLite é configurado automaticamente com base na RAM disponível:

```sql
PRAGMA journal_mode = WAL;          -- Write-ahead logging
PRAGMA synchronous = NORMAL;        -- Balance performance/durabilidade
PRAGMA busy_timeout = 60000;        -- 60s para locks
PRAGMA foreign_keys = ON;
PRAGMA temp_store = MEMORY;

-- Calculados dinamicamente (~5% e ~8% da RAM):
PRAGMA cache_size = -400000;        -- ~400MB para 8GB RAM
PRAGMA mmap_size = 536870912;       -- ~500MB para 8GB RAM
```

**Fórmulas de cálculo:**
```typescript
// src/db/knex.ts
const cacheBytes = totalMem * 0.05;        // 5% da RAM
const cachePages = cacheBytes / 4096;      // Páginas de 4KB
const mmapBytes = totalMem * 0.08;         // 8% da RAM
```

**Override via variáveis de ambiente:**
```bash
SQLITE_CACHE_SIZE=-250000           # Força 250MB de cache
SQLITE_MMAP_SIZE=1073741824         # Força 1GB de MMAP
```

### Tabelas Principais

| Tabela | Descrição |
|--------|-----------|
| \`bases\` | Metadados das bases importadas |
| \`base_columns\` | Colunas de cada base |
| \`base_<id>\` | Dados de uma base específica (dinâmica) |
| \`configs_conciliacao\` | Configurações de conciliação |
| \`configs_estorno\` | Configurações de estorno |
| \`configs_cancelamento\` | Configurações de cancelamento |
| \`jobs_conciliacao\` | Jobs de conciliação |
| \`ingest_jobs\` | Jobs de ingestão |
| \`conciliacao_marks\` | Marcações de estorno/cancelamento |
| \`conciliacao_result_<jobId>\` | Resultados de conciliação (dinâmica) |

---

## 📋 Migrations

### Executar Migrations

\`\`\`bash
# Usando DATA_DIR padrão
npm --workspace=apps/api run migrate

# Usando DATA_DIR específico
DATA_DIR=/caminho/dados npm --workspace=apps/api run migrate
\`\`\`

### Criar Nova Migration

\`\`\`bash
npm --workspace=apps/api run migrate:make nome_descritivo
\`\`\`

---

## 🌐 Endpoints da API

### Health Check

\`\`\`http
GET /health
→ { "status": "ok", "dataDir": "...", "dbPath": "..." }
\`\`\`

### Bases (\`/api/bases\`)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | \`/api/bases\` | Listar bases (paginado) |
| GET | \`/api/bases/:id\` | Detalhes de uma base |
| POST | \`/api/bases\` | Upload de arquivo |
| GET | \`/api/bases/:id/data\` | Dados da base (paginado) |
| GET | \`/api/bases/:id/columns\` | Colunas da base |
| DELETE | \`/api/bases/:id\` | Excluir base |

### Conciliações (\`/api/conciliacoes\`)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | \`/api/conciliacoes\` | Listar jobs (paginado) |
| POST | \`/api/conciliacoes\` | Criar job |
| GET | \`/api/conciliacoes/:id\` | Detalhes do job |
| GET | \`/api/conciliacoes/:id/resultados\` | Resultados (paginado) |
| POST | \`/api/conciliacoes/:id/exportar\` | Iniciar exportação |
| GET | \`/api/conciliacoes/:id/download\` | Download do ZIP |

### Configurações

| Rota | Descrição |
|------|-----------|
| \`/api/configs/conciliacao\` | Configurações de conciliação |
| \`/api/configs/estorno\` | Configurações de estorno |
| \`/api/configs/cancelamento\` | Configurações de cancelamento |
| \`/api/configs/mapeamento\` | Mapeamentos de colunas |
| \`/api/keys\` | Definições de chaves |
| \`/api/keys-pairs\` | Pares de chaves A × B |
| \`/api/license\` | Licenciamento |

---

## �� Pipeline de Processamento

### Steps Disponíveis

| Step | Descrição |
|------|-----------|
| NullsBaseAStep | Normaliza nulos na Base A |
| NullsBaseBStep | Normaliza nulos na Base B |
| EstornoBaseAStep | Identifica estornos (A × A) |
| CancelamentoBaseBStep | Exclui cancelados da Base B |
| ConciliacaoABStep | Concilia A × B |

### Telemetria

- \`pipeline_stage\`: identificador do step
- \`pipeline_stage_label\`: descrição amigável
- \`pipeline_progress\`: 0-100

---

## ⚙️ Workers Assíncronos

### Polling Workers

| Worker | Arquivo | Descrição |
|--------|---------|-----------|
| Conciliação | `conciliacaoWorker.ts` | Processa jobs PENDING |
| Ingestão | `ingestWorker.ts` | Processa uploads para SQLite |
| Exportação | `exportRunner.ts` | Gera ZIPs em background |

### Worker Thread Pools (Multithreading)

O sistema usa pools de worker threads para processamento paralelo com **configuração dinâmica baseada na RAM**:

| Pool | Propósito | Threshold |
|------|-----------|-----------|
| `ingest` | Importação de arquivos | 2.000 rows |
| `conciliacao` | Matching A×B | 1.000 rows |
| `estorno` | Matching A×A | 10.000 rows |
| `atribuicao` | Atribuição de resultados | 100 rows |

**Sizing automático:**
- Pool size = `(RAM Total - 3.5GB) × 0.5`
- Máximo: `CPUs - 1` ou `6` (o menor)
- Exemplo 8GB: `(8 - 3.5) × 0.5 = 2.25` → **2-4 workers**

```typescript
// src/workers/config.ts
export function getMaxPoolSize(): number {
  const tier = getMemoryTier();
  return tier === 'low' ? 2 : tier === 'standard' ? 4 : 6;
}
```

**Variáveis de controle:**
```bash
WORKER_THREADS_ENABLED=true    # Habilita multithreading
WORKER_POOL_SIZE=4             # Override do pool size
WORKER_DEBUG_LOGGING=false     # Logs detalhados
WORKER_TASK_TIMEOUT=300000     # 5 minutos por tarefa
```

---

## 📝 Exemplos de Uso

### Upload e Conciliação

\`\`\`bash
# 1. Upload
curl -X POST http://localhost:3000/api/bases \\
  -F "file=@planilha.xlsx" \\
  -F "tipo=CONTABIL" \\
  -F "nome=Base Janeiro"

# 2. Criar job
curl -X POST http://localhost:3000/api/conciliacoes \\
  -H "Content-Type: application/json" \\
  -d '{"configConciliacaoId": 1}'

# 3. Monitorar
curl http://localhost:3000/api/conciliacoes/1

# 4. Exportar
curl -X POST http://localhost:3000/api/conciliacoes/1/exportar

# 5. Baixar
curl -o resultado.zip http://localhost:3000/api/conciliacoes/1/download
\`\`\`

---

## 🔧 Troubleshooting

| Problema | Solução |
|----------|---------|
| API não inicia | \`APP_PORT=3132 npm run api:dev\` |
| "no such table" | \`npm --workspace=apps/api run migrate\` |
| SQLite BUSY | \`SQLITE_BUSY_TIMEOUT=60000\` |
| better-sqlite3 erro | \`npm run rebuild:native\` |

---

## 📚 Documentação Relacionada

- [README principal](../../README.md)
- [Frontend README](../client/readme.md)
- [Desktop README](../desktop/readme.md)

---

<p align="center">
  <sub>AL-Tool API - <a href="https://revaleon.com.br">Revaleon</a></sub>
</p>
