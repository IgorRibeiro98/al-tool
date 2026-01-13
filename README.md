# AL-Tool — Conciliação Contábil × Fiscal

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18+-339933?logo=nodedotjs&logoColor=white" alt="Node.js 18+"/>
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/Electron-39-47848F?logo=electron&logoColor=white" alt="Electron"/>
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black" alt="React 18"/>
  <img src="https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white" alt="SQLite"/>
  <img src="https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white" alt="Python 3.11+"/>
</p>

Ferramenta completa para **conciliar bases contábeis e fiscais** sem depender de infraestrutura externa. O projeto ingere planilhas grandes (Excel, XLSB, TXT, PDF, CSV), aplica regras de normalização/estorno/cancelamento, concilia por múltiplas chaves configuráveis, gera relatórios detalhados, exporta evidências em ZIP e opera como um **aplicativo desktop totalmente offline** (Electron + API local + React UI + SQLite).

---

## 📑 Índice

- [Visão Geral](#-visão-geral)
- [Arquitetura do Projeto](#-arquitetura-do-projeto)
- [Regras de Negócio](#-regras-de-negócio)
- [Pipeline de Processamento](#-pipeline-de-processamento)
- [Estrutura de Diretórios](#-estrutura-de-diretórios)
- [Variáveis de Ambiente](#-variáveis-de-ambiente)
- [Instalação e Configuração](#-instalação-e-configuração)
- [Comandos Disponíveis](#-comandos-disponíveis)
- [Desenvolvimento Local](#-desenvolvimento-local)
- [Build e Distribuição](#-build-e-distribuição)
- [Sistema de Licenciamento](#-sistema-de-licenciamento)
- [Banco de Dados](#-banco-de-dados)
- [API REST](#-api-rest)
- [Frontend](#-frontend)
- [Desktop (Electron)](#-desktop-electron)
- [Worker Python](#-worker-python)
- [Troubleshooting](#-troubleshooting)
- [Contribuição](#-contribuição)
- [Referências Rápidas](#-referências-rápidas)

---

## 🔎 Visão Geral

### O que é o AL-Tool?

O AL-Tool é uma ferramenta de **conciliação contábil × fiscal** que permite:

- **Ingerir** arquivos de dados em diversos formatos (Excel, XLSB, TXT, CSV, PDF)
- **Normalizar** dados para padrões consistentes
- **Identificar estornos** dentro da base contábil (A × A)
- **Excluir notas canceladas** da base fiscal
- **Conciliar** bases A (contábil) e B (fiscal) por múltiplas chaves
- **Exportar** resultados completos em formato ZIP com evidências

### Características Principais

| Recurso | Descrição |
|---------|-----------|
| 🔒 **Offline-first** | Funciona 100% sem internet após instalação |
| 📊 **Grandes volumes** | Processa centenas de milhares de linhas via streaming/chunking |
| 🔑 **Múltiplas chaves** | Suporta N chaves compostas com prioridade configurável |
| 📈 **Telemetria em tempo real** | Progress bars e status atualizados durante todo o pipeline |
| 💾 **Dados locais** | SQLite + arquivos no diretório do usuário |
| 🖥️ **Desktop nativo** | Instalador único para Windows/Linux/Mac |

---

## 🏗️ Arquitetura do Projeto

O AL-Tool é um **monorepo** com múltiplos workspaces:

```
al-tool/
├── apps/
│   ├── api/          # Backend REST (Express + SQLite)
│   ├── client/       # Frontend React (Vite + Tailwind)
│   └── desktop/      # Electron shell
├── packages/
│   ├── domain/       # Tipos e interfaces compartilhados
│   └── shared/       # Utilitários compartilhados
├── scripts/          # Workers Python e utilitários
├── storage/          # Dados locais (dev)
└── docs/             # Documentação adicional
```

### Workspaces Detalhados

| Workspace | Tecnologias | Responsabilidade |
|-----------|-------------|------------------|
| `apps/api` | Express, Knex, better-sqlite3, TypeScript | API REST, pipeline de processamento, jobs, exportação |
| `apps/client` | React 18, Vite, Tailwind, shadcn-ui, MUI DataGrid | Interface do usuário, polling de jobs, visualização de dados |
| `apps/desktop` | Electron, TypeScript | Orquestração, spawn da API, worker Python, empacotamento |
| `packages/domain` | TypeScript | Tipos e interfaces de domínio |
| `packages/shared` | TypeScript | Funções utilitárias compartilhadas |
| `scripts/` | Python 3.11+, Node.js | Conversão XLSB→XLSX, worker de ingestão |

### Fluxo de Dados

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   ELECTRON   │────▶│     API      │────▶│   SQLITE     │
│   (desktop)  │     │   (Express)  │     │    (DB)      │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │                    │
       │                    ▼                    │
       │             ┌──────────────┐            │
       │             │   PIPELINE   │            │
       │             │  (Steps TS)  │            │
       │             └──────────────┘            │
       │                    │                    │
       ▼                    ▼                    │
┌──────────────┐     ┌──────────────┐            │
│    PYTHON    │────▶│   STORAGE    │◀───────────┘
│   (worker)   │     │ (uploads/    │
└──────────────┘     │  exports)    │
                     └──────────────┘
```

---

## 🧠 Regras de Negócio

O AL-Tool implementa regras específicas de conciliação contábil × fiscal:

### 1. Padronização de Dados

```
Campo vazio (texto)   → "NULL" (string literal)
Campo vazio (número)  → 0
```

> **Importante:** As tabelas mantêm a estrutura original dos arquivos. Colunas nunca são removidas ou renomeadas - apenas valores são padronizados.

### 2. Estorno (A × A)

Identifica linhas dentro da **Base Contábil** que se anulam:

```
Linha 1: +1000,00 (Chave: ABC123)
Linha 2: -1000,00 (Chave: ABC123)
──────────────────────────────────
Soma:      0,00 → Status: Conciliado_Estorno
```

- Agrupa linhas por chave configurada
- Soma valores da coluna de conciliação
- Se soma = 0 (dentro do limite), marca como `Conciliado_Estorno`
- Registra em `conciliacao_marks`

### 3. Cancelamento (Base B)

Exclui notas fiscais canceladas da conciliação A × B:

```javascript
// Configuração de cancelamento
{
  coluna_indicador: "SITUACAO",
  valor_cancelado: "S",
  valor_nao_cancelado: "N"
}
```

- Linhas com `SITUACAO = "S"` são excluídas do A × B
- Mantidas no banco para auditoria

### 4. Múltiplas Chaves de Conciliação

O sistema suporta N chaves compostas com prioridade:

```javascript
// Exemplo de configuração de chaves
{
  "CHAVE_1": ["empresa", "filial", "numero_nota"],
  "CHAVE_2": ["empresa", "cnpj_fornecedor"],
  "CHAVE_3": ["data_emissao", "valor"]
}
```

- Cada chave é processada independentemente
- Prioridade = ordem de definição
- Cada chave gera coluna própria no resultado

### 5. Conciliação por Grupo

Para cada chave configurada:

```
1. Agrupa linhas de A e B pelo valor da chave composta
2. Calcula: somaA e somaB (considerando inversão de sinal)
3. Determina cenário: diferenca = somaA - somaB
4. Aplica classificação para TODAS as linhas do grupo
```

**Cenários de Resultado:**

| Cenário | Condição | Status |
|---------|----------|--------|
| Conciliado | `diferenca = 0` (dentro do limite) | ✅ `CONCILIADO` |
| Diferença Contábil | `somaA > somaB` | ⚠️ `DIFERENCA_CONTABIL` |
| Diferença Fiscal | `somaA < somaB` | ⚠️ `DIFERENCA_FISCAL` |
| Apenas A | Existe em A, não em B | ❌ `APENAS_A` |
| Apenas B | Existe em B, não em A | ❌ `APENAS_B` |

### 6. Exportação

Gera arquivo ZIP contendo:

```
exportacao.zip
├── base_contabil_resultado.xlsx    # Base A com colunas adicionais
├── base_fiscal_resultado.xlsx      # Base B com colunas adicionais
└── comparativo.xlsx                # Visão consolidada
```

**Colunas adicionais em cada base:**
- `CHAVE_1`, `CHAVE_2`, ... (uma por chave configurada)
- `STATUS` (resultado da conciliação)
- `GRUPO` (ID do grupo de conciliação)
- `CHAVE` (valor da chave utilizada)

---

## 🔄 Pipeline de Processamento

O pipeline é modular e baseado em **steps**:

### Arquitetura do Pipeline

```typescript
// Cada step implementa esta interface
interface PipelineStep {
  name: string;
  execute(ctx: PipelineContext): Promise<PipelineContext>;
}
```

### Steps do Pipeline

| Step | Arquivo | Descrição |
|------|---------|-----------|
| 1. Normalização A | `NullsBaseAStep.ts` | Padroniza nulos e valores na Base Contábil |
| 2. Normalização B | `NullsBaseBStep.ts` | Padroniza nulos e valores na Base Fiscal |
| 3. Estorno | `EstornoBaseAStep.ts` | Identifica e marca estornos (A × A) |
| 4. Cancelamento | `CancelamentoBaseBStep.ts` | Exclui notas canceladas da Base B |
| 5. Conciliação | `ConciliacaoABStep.ts` | Processa conciliação A × B por chaves |

### Telemetria do Pipeline

Jobs possuem campos de rastreamento em tempo real:

```typescript
interface JobTelemetry {
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  pipeline_stage: string;           // Ex: "estorno", "conciliacao"
  pipeline_stage_label: string;     // Ex: "Processando estornos..."
  pipeline_progress: number;        // 0-100
  export_status: string;            // Ex: "EXPORT_BUILDING_A"
  export_progress: number;          // 0-100
  erro: string | null;              // Mensagem de erro detalhada
}
```

**Fluxo de status de exportação:**
```
STARTING → EXPORT_BUILDING_A → EXPORT_BUILDING_B → 
EXPORT_BUILDING_CONSOLIDATED → EXPORT_COMPRESSING → EXPORT_DONE
```

---

## 📁 Estrutura de Diretórios

### Estrutura Completa

```
al-tool/
├── apps/
│   ├── api/
│   │   ├── migrations/           # Migrations Knex
│   │   ├── src/
│   │   │   ├── config/           # Configurações (paths, etc)
│   │   │   ├── db/               # Knex setup, helpers SQLite
│   │   │   ├── infra/            # Infraestrutura (storage, etc)
│   │   │   ├── lib/              # Bibliotecas utilitárias
│   │   │   ├── pipeline/         # Motor do pipeline
│   │   │   │   ├── core/         # Steps do pipeline
│   │   │   │   ├── cancelamento/ # Step de cancelamento
│   │   │   │   └── estorno/      # Step de estorno
│   │   │   ├── repos/            # Repositórios (data access)
│   │   │   ├── routes/           # Rotas Express
│   │   │   ├── services/         # Serviços de negócio
│   │   │   ├── worker/           # Workers assíncronos
│   │   │   ├── env.ts            # Carrega variáveis de ambiente
│   │   │   └── server.ts         # Entry point da API
│   │   ├── storage/              # Dados locais (dev)
│   │   └── .env                  # Variáveis de ambiente (local)
│   │
│   ├── client/
│   │   ├── public/               # Assets estáticos
│   │   ├── src/
│   │   │   ├── components/       # Componentes React
│   │   │   ├── hooks/            # Custom hooks
│   │   │   ├── lib/              # Utilitários
│   │   │   ├── pages/            # Páginas da aplicação
│   │   │   └── services/         # Serviços de API
│   │   └── .env.development      # Env de desenvolvimento
│   │
│   └── desktop/
│       ├── src/
│       │   ├── main/             # Main process Electron
│       │   │   └── services/     # Serviços (licensing, etc)
│       │   └── main.ts           # Entry point Electron
│       ├── python-runtime/       # Runtime Python embutido (dev)
│       └── python-runtime-win/   # Runtime Python Windows
│
├── packages/
│   ├── domain/                   # Tipos compartilhados
│   └── shared/                   # Utilitários compartilhados
│
├── scripts/
│   ├── conversion_worker.py      # Worker de conversão XLSB
│   ├── requirements.txt          # Dependências Python
│   ├── python_setup.py           # Setup do runtime Python
│   └── prepare_python_runtime_win.py
│
├── storage/                      # Dados locais (dev)
│   ├── db/                       # Banco SQLite
│   ├── exports/                  # Arquivos exportados
│   ├── ingests/                  # Arquivos JSONL intermediários
│   └── uploads/                  # Arquivos enviados
│
├── docs/                         # Documentação
├── package.json                  # Root package.json
└── docker-compose.yml            # Para desenvolvimento opcional
```

---

## 🌍 Variáveis de Ambiente

### Referência Completa

O sistema utiliza variáveis de ambiente para configuração. A precedência é:

1. Variáveis definidas no processo (shell, Electron)
2. Arquivo `.env` do workspace
3. Defaults internos do código

#### Variáveis da API (`apps/api/.env`)

| Variável | Tipo | Default | Descrição |
|----------|------|---------|-----------|
| `APP_PORT` | number | `3000` | Porta do servidor HTTP |
| `NODE_ENV` | string | `development` | Ambiente de execução |
| `DATA_DIR` | path | `./storage` | Diretório raiz de dados |
| `DB_PATH` | path | `<DATA_DIR>/db/dev.sqlite3` | Caminho do arquivo SQLite |
| `UPLOAD_DIR` | path | `<DATA_DIR>/uploads` | Diretório de uploads |
| `EXPORT_DIR` | path | `<DATA_DIR>/exports` | Diretório de exportações |
| `INGESTS_DIR` | path | `<DATA_DIR>/ingests` | Diretório de arquivos JSONL |
| `CORS_ORIGIN` | string | `*` | Origens permitidas para CORS |

##### Variáveis SQLite (Performance Tuning)

| Variável | Tipo | Default | Descrição |
|----------|------|---------|-----------|
| `SQLITE_JOURNAL_MODE` | string | `WAL` | Modo do journal (WAL recomendado) |
| `SQLITE_SYNCHRONOUS` | string | `NORMAL` | Nível de sync (NORMAL é um bom equilíbrio) |
| `SQLITE_CACHE_SIZE` | number | `-4000` | Tamanho do cache (negativo = páginas) |
| `SQLITE_TEMP_STORE` | string | `MEMORY` | Onde armazenar temp tables |
| `SQLITE_BUSY_TIMEOUT` | number | `30000` | Timeout para lock (ms) |
| `SQLITE_FOREIGN_KEYS` | string | `ON` | Habilitar foreign keys |

##### Variáveis de Paginação

| Variável | Tipo | Default | Descrição |
|----------|------|---------|-----------|
| `API_DEFAULT_PAGE_SIZE` | number | `20` | Tamanho padrão de página |
| `API_MAX_PAGE_SIZE` | number | `100` | Tamanho máximo de página |
| `API_RESULT_PAGE_SIZE` | number | `50` | Tamanho de página para resultados |

#### Variáveis do Frontend (`apps/client/.env`)

| Variável | Tipo | Default | Descrição |
|----------|------|---------|-----------|
| `VITE_API_BASE_URL` | URL | `http://localhost:3000/api` | URL base da API |

#### Variáveis do Desktop/Python

| Variável | Tipo | Default | Descrição |
|----------|------|---------|-----------|
| `PYTHON_EXECUTABLE` | path | auto-detect | Caminho do executável Python |
| `POLL_INTERVAL` | number | `5` | Intervalo de polling do worker (segundos) |

#### Variáveis de Licenciamento

| Variável | Tipo | Descrição |
|----------|------|-----------|
| `LICENSE_API_BASE_URL` | URL | URL do servidor de licenças |
| `LICENSE_SERVER_BASE_URL` | URL | Alias para LICENSE_API_BASE_URL |

### Exemplo de `.env` Completo

```bash
# apps/api/.env

# Servidor
APP_PORT=3000
NODE_ENV=development

# Diretórios de dados
DATA_DIR=/home/usuario/.config/AL-Tool/data
DB_PATH=/home/usuario/.config/AL-Tool/data/db/dev.sqlite3
UPLOAD_DIR=/home/usuario/.config/AL-Tool/data/uploads
EXPORT_DIR=/home/usuario/.config/AL-Tool/data/exports
INGESTS_DIR=/home/usuario/.config/AL-Tool/data/ingests

# CORS
CORS_ORIGIN=http://localhost:5173,http://localhost:3000

# SQLite Performance
SQLITE_JOURNAL_MODE=WAL
SQLITE_SYNCHRONOUS=NORMAL
SQLITE_CACHE_SIZE=-8000
SQLITE_TEMP_STORE=MEMORY
SQLITE_BUSY_TIMEOUT=30000

# Licenciamento (opcional)
LICENSE_API_BASE_URL=https://license.suaempresa.com
```

### Precedência no Electron

Quando rodando via Electron, as variáveis são definidas automaticamente:

```typescript
// Valores definidos pelo Electron têm precedência sobre .env
{
  DATA_DIR: path.join(app.getPath('userData'), 'data'),
  DB_PATH: path.join(dataDir, 'db', 'dev.sqlite3'),
  UPLOAD_DIR: path.join(dataDir, 'uploads'),
  EXPORT_DIR: path.join(dataDir, 'exports'),
  INGESTS_DIR: path.join(dataDir, 'ingests'),
  APP_PORT: '3000'
}
```

**Caminhos típicos do `userData` por sistema:**

| Sistema | Caminho |
|---------|---------|
| Windows | `C:\Users\<usuario>\AppData\Roaming\AL-Tool` |
| Linux | `/home/<usuario>/.config/AL-Tool` |
| macOS | `/Users/<usuario>/Library/Application Support/AL-Tool` |

---

## 📦 Instalação e Configuração

### Requisitos

| Requisito | Versão | Notas |
|-----------|--------|-------|
| Node.js | 18+ | LTS recomendado |
| npm | 10+ | Vem com Node.js |
| Python | 3.11+ | Apenas para worker de conversão |
| Git | 2.x | Para clonar o repositório |

### Instalação Rápida

```bash
# 1. Clone o repositório
git clone https://github.com/sua-org/al-tool.git
cd al-tool

# 2. Instale dependências (todos os workspaces)
npm install

# 3. Configure o runtime Python (necessário para conversão XLSB)
npm run python:setup

# 4. Execute as migrations
npm --workspace=apps/api run migrate

# 5. Inicie a API em modo desenvolvimento
npm run api:dev

# 6. (Em outro terminal) Inicie o frontend
npm run client:dev
```

### Verificação da Instalação

Após iniciar a API, verifique se está funcionando:

```bash
# Health check
curl http://localhost:3000/health

# Resposta esperada:
# {
#   "status": "ok",
#   "dataDir": "/caminho/para/storage",
#   "dbPath": "/caminho/para/storage/db/dev.sqlite3"
# }
```

---

## 🛠️ Comandos Disponíveis

### Comandos do Root (package.json raiz)

| Comando | Descrição |
|---------|-----------|
| `npm run api:dev` | Inicia API em modo dev (hot reload) |
| `npm run api:build` | Compila API para `apps/api/dist` |
| `npm run api:start` | Inicia API compilada |
| `npm run client:dev` | Inicia frontend em modo dev |
| `npm run client:build` | Compila frontend para `apps/client/dist` |
| `npm run desktop:dev` | Inicia Electron em modo dev |
| `npm run desktop:build` | Compila Electron para `apps/desktop/dist` |
| `npm run app:dist` | Gera instalador completo |
| `npm run python:setup` | Configura runtime Python (Unix) |
| `npm run python:prepare-win` | Configura runtime Python (Windows) |
| `npm run rebuild:native` | Recompila módulos nativos (better-sqlite3) |

### Comandos da API (`apps/api`)

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Inicia com ts-node-dev (hot reload) |
| `npm run build` | Compila TypeScript |
| `npm run start` | Inicia server.js compilado |
| `npm run migrate` | Executa migrations pendentes |
| `npm run migrate:make` | Cria nova migration |

### Comandos do Frontend (`apps/client`)

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Inicia Vite dev server |
| `npm run build` | Compila para produção |
| `npm run preview` | Preview do build de produção |
| `npm run lint` | Executa ESLint |

### Comandos do Desktop (`apps/desktop`)

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Compila e inicia Electron |
| `npm run build` | Compila TypeScript |
| `npm run dist` | Gera instalador com electron-builder |

---

## 💻 Desenvolvimento Local

### Fluxo Completo de Desenvolvimento

```bash
# Terminal 1: API
npm run api:dev
# Servidor rodando em http://localhost:3000

# Terminal 2: Frontend
npm run client:dev
# Dev server rodando em http://localhost:5173

# Terminal 3 (opcional): Electron
npm run desktop:dev
# Abre janela Electron apontando para o dev server
```

### Usando o Mesmo DATA_DIR do Electron

Para desenvolvimento consistente com o Electron:

```bash
# Linux
DATA_DIR=~/.config/AL-Tool/data npm run api:dev

# Windows (PowerShell)
$env:DATA_DIR="$env:APPDATA\AL-Tool\data"; npm run api:dev
```

### Executando Migrations

```bash
# Usando DATA_DIR padrão (./storage)
npm --workspace=apps/api run migrate

# Usando DATA_DIR específico
DATA_DIR=/caminho/para/dados npm --workspace=apps/api run migrate

# Criar nova migration
npm --workspace=apps/api run migrate:make nome_da_migration
```

### Debug e Diagnósticos

A API expõe um endpoint de diagnóstico:

```bash
curl http://localhost:3000/api/diagnostics/env

# Resposta:
# {
#   "NODE_ENV": "development",
#   "APP_PORT": "3000",
#   "DATA_DIR": "/caminho/storage",
#   "DB_PATH": "/caminho/storage/db/dev.sqlite3",
#   "UPLOAD_DIR": "/caminho/storage/uploads",
#   "EXPORT_DIR": "/caminho/storage/exports"
# }
```

---

## 📦 Build e Distribuição

### Build Completo

O comando `npm run app:dist` executa a sequência completa:

```bash
npm run app:dist

# Equivalente a:
# npm run python:setup    # Prepara runtime Python
# npm run client:build    # Compila frontend
# npm run api:build       # Compila API
# npm run desktop:build   # Compila Electron
# npm run rebuild:native  # Recompila better-sqlite3
# npm --workspace=apps/desktop run dist  # Gera instalador
```

### Estrutura do Instalador

O instalador empacota:

```
resources/
├── api/
│   ├── dist/           # API compilada
│   ├── migrations/     # Migrations Knex
│   └── node_modules/   # Dependências da API
├── client/
│   └── dist/           # Frontend compilado
├── python/             # Runtime Python (Unix)
├── python-win/         # Runtime Python (Windows)
├── scripts/            # Scripts de conversão
└── .env                # Variáveis de ambiente
```

### Checklist de Release

Antes de gerar o instalador:

- [ ] Executar `npm run python:setup` (ou `python:prepare-win` no Windows)
- [ ] Validar runtime Python em `apps/desktop/python-runtime`
- [ ] Executar `npm run client:build`
- [ ] Executar `npm run api:build`
- [ ] Executar `npm run rebuild:native`
- [ ] Executar `npm --workspace=apps/desktop run dist`
- [ ] Testar instalador em VM limpa (sem Node.js/Python instalados)

### Plataformas Suportadas

| Plataforma | Formato | Notas |
|------------|---------|-------|
| Windows | `.exe` / `.msi` | NSIS ou MSI installer |
| Linux | `.AppImage` / `.deb` | AppImage é portátil |
| macOS | `.dmg` | Requer assinatura para Gatekeeper |

---

## 🔐 Sistema de Licenciamento

O AL-Tool inclui um sistema de licenciamento opcional:

### Conceitos

| Conceito | Descrição |
|----------|-----------|
| **Machine Fingerprint** | Hash SHA-256 de hostname + OS + CPU |
| **Activation Token** | JWT retornado pelo servidor de licenças |
| **Validation Interval** | 30 dias entre validações online |
| **Offline Grace Period** | 7 dias de uso sem validação |

### Estados da Licença

| Estado | Descrição |
|--------|-----------|
| `not_activated` | Primeira execução, sem licença |
| `active` | Licença ativa e válida |
| `expired` | Licença expirou |
| `blocked` | Licença revogada ou usada em outra máquina |
| `blocked_offline` | Passou de 30+7 dias sem validar |

### Configuração

```bash
# apps/api/.env ou .env raiz
LICENSE_API_BASE_URL=https://license.suaempresa.com
```

### Endpoints de Licenciamento

```
POST /api/license/activate
  Body: { licenseKey: "XXXX-XXXX-XXXX-XXXX" }
  
GET /api/license/status
  Response: { status: "active", expiresAt: "2027-01-01", ... }
  
POST /api/license/validate
  # Valida licença com servidor (requer conexão)
```

---

## 🗄️ Banco de Dados

### SQLite com WAL Mode

O AL-Tool usa SQLite em modo **WAL (Write-Ahead Logging)** para melhor performance:

```sql
-- PRAGMAs aplicados na inicialização
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -4000;  -- 4000 páginas em memória
PRAGMA temp_store = MEMORY;
PRAGMA busy_timeout = 30000;
PRAGMA foreign_keys = ON;
```

### Tabelas Principais

| Tabela | Descrição |
|--------|-----------|
| `bases` | Metadados das bases importadas |
| `base_columns` | Colunas de cada base |
| `base_<id>` | Dados da base (tabela dinâmica) |
| `configs_conciliacao` | Configurações de conciliação |
| `configs_estorno` | Configurações de estorno |
| `configs_cancelamento` | Configurações de cancelamento |
| `configs_mapeamento_bases` | Mapeamentos entre bases |
| `keys_definitions` | Definições de chaves |
| `keys_pairs` | Pares de chaves A × B |
| `jobs_conciliacao` | Jobs de conciliação |
| `ingest_jobs` | Jobs de ingestão |
| `conciliacao_marks` | Marcações de estorno/cancelamento |
| `conciliacao_result_<jobId>` | Resultados (tabela dinâmica) |
| `license` | Dados de licenciamento local |

### Migrations

As migrations estão em `apps/api/migrations/`:

```bash
# Listar migrations
ls apps/api/migrations/

# Exemplo de saída:
# 20251125_initial_metadata.js
# 20251126_add_jsonl_columns_to_bases.js
# 20251126_create_base_columns.js
# ...
```

Para criar nova migration:

```bash
npm --workspace=apps/api run migrate:make nome_descritivo
```

---

## 🌐 API REST

### Visão Geral

A API expõe rotas sob o prefixo `/api`:

```
GET  /health                    # Health check
GET  /api/diagnostics/env       # Diagnóstico de ambiente

/api/bases                      # Gerenciamento de bases
/api/conciliacoes               # Jobs de conciliação
/api/configs/conciliacao        # Configurações de conciliação
/api/configs/estorno            # Configurações de estorno
/api/configs/cancelamento       # Configurações de cancelamento
/api/configs/mapeamento         # Mapeamentos de colunas
/api/keys                       # Definições de chaves
/api/keys-pairs                 # Pares de chaves
/api/atribuicoes                # Atribuições
/api/maintenance                # Manutenção
/api/license                    # Licenciamento
```

### Endpoints de Bases

```http
# Listar bases (paginado)
GET /api/bases?page=1&pageSize=20&tipo=CONTABIL

# Detalhes de uma base
GET /api/bases/:id

# Upload de arquivo
POST /api/bases
Content-Type: multipart/form-data
Body: file, tipo, nome, periodo, headerLinhaInicial, headerColunaInicial

# Dados da base (paginado)
GET /api/bases/:id/data?page=1&pageSize=50

# Colunas da base
GET /api/bases/:id/columns

# Excluir base
DELETE /api/bases/:id
```

### Endpoints de Conciliação

```http
# Listar jobs (paginado)
GET /api/conciliacoes?page=1&pageSize=20&status=DONE

# Criar job
POST /api/conciliacoes
Content-Type: application/json
{
  "configConciliacaoId": 1,
  "configEstornoId": 1,
  "configCancelamentoId": 1,
  "nome": "Conciliação Janeiro 2025",
  "baseContabilId": 1,    // Override opcional
  "baseFiscalId": 2       // Override opcional
}

# Detalhes do job
GET /api/conciliacoes/:id

# Resultados (paginado)
GET /api/conciliacoes/:id/resultados?page=1&pageSize=50

# Iniciar exportação
POST /api/conciliacoes/:id/exportar

# Download do ZIP
GET /api/conciliacoes/:id/download
```

### Códigos de Status HTTP

| Código | Significado |
|--------|-------------|
| 200 | Sucesso |
| 201 | Criado com sucesso |
| 400 | Erro de validação / request inválido |
| 404 | Recurso não encontrado |
| 409 | Conflito (ex: job ainda em execução) |
| 500 | Erro interno do servidor |

### Paginação

Endpoints de listagem suportam paginação:

```http
GET /api/bases?page=2&pageSize=50

# Resposta
{
  "page": 2,
  "pageSize": 50,
  "total": 150,
  "totalPages": 3,
  "data": [...]
}
```

---

## 🖥️ Frontend

### Tecnologias

| Tecnologia | Uso |
|------------|-----|
| React 18 | Framework UI |
| Vite | Build tool e dev server |
| TypeScript | Tipagem estática |
| Tailwind CSS | Estilização utility-first |
| shadcn-ui | Componentes UI |
| MUI DataGrid | Tabelas de alto volume |
| React Query | Gerenciamento de estado server-side |
| React Router | Navegação |
| Sonner | Notificações toast |

### Estrutura de Páginas

| Página | Rota | Descrição |
|--------|------|-----------|
| Dashboard | `/` | Visão geral |
| Bases | `/bases` | Lista e upload de bases |
| Base Details | `/bases/:id` | Detalhes e dados de uma base |
| Conciliações | `/conciliacoes` | Lista de jobs |
| Conciliação Details | `/conciliacoes/:id` | Detalhes e resultados |
| Configurações | `/configs/*` | Configurações diversas |

### Polling de Jobs

O frontend faz polling automático enquanto jobs estão em processamento:

```typescript
// Exemplo de lógica de polling
const shouldPoll = 
  job.status === 'PENDING' || 
  job.status === 'RUNNING' ||
  job.export_status === 'IN_PROGRESS';

// Intervalo típico: 2-5 segundos
```

### Desenvolvimento

```bash
# Iniciar dev server
npm run client:dev

# Acessar em http://localhost:5173
```

### Variáveis de Ambiente

Crie `apps/client/.env.local` para desenvolvimento:

```bash
VITE_API_BASE_URL=http://localhost:3000/api
```

---

## 💻 Desktop (Electron)

### Arquitetura

O Electron atua como **orquestrador**:

1. Inicia com `app.whenReady()`
2. Calcula `DATA_DIR` usando `app.getPath('userData')`
3. Cria diretórios necessários
4. Executa migrations via import dinâmico
5. Inicia a API como módulo (não child process)
6. Aguarda health check
7. Inicia worker Python de conversão
8. Abre janela apontando para a API

### Fluxo de Inicialização

```
┌─────────────────────────────────────────────────────────────┐
│                      ELECTRON MAIN                           │
├─────────────────────────────────────────────────────────────┤
│  1. loadEnvFiles()                                          │
│  2. app.whenReady()                                         │
│  3. calculateDataDir()                                      │
│  4. ensureRuntimeDirectories()                              │
│  5. startBackendAndMigrations()                             │
│     ├── import(migrationsEntry)                             │
│     └── import(backendEntry)                                │
│  6. waitForHealth(port)                                     │
│  7. startPythonConversionWorker()                           │
│  8. createWindow(url)                                       │
│  9. setupLicensingService()                                 │
└─────────────────────────────────────────────────────────────┘
```

### Logs

Logs são prefixados por origem:

```
[electron] userData: /home/usuario/.config/AL-Tool
[electron] DATA_DIR: /home/usuario/.config/AL-Tool/data
[api] App listening on http://localhost:3000
[py-conversion] Worker started, polling ingests/
```

Em produção, logs são gravados em:
- `<userData>/logs/backend-env.json` (diagnóstico de boot)
- `<userData>/logs/conversion-worker.log` (worker Python)

### Desenvolvimento

```bash
# Compilar API primeiro
npm run api:build

# Iniciar Electron em dev
npm run desktop:dev
```

### Troubleshooting Electron

| Problema | Solução |
|----------|---------|
| Health check falha | Verificar se API compilou (`apps/api/dist/server.js`) |
| Porta ocupada | Definir `APP_PORT=3132 npm run desktop:dev` |
| Dados corrompidos | Remover `<userData>/data` e reiniciar |
| Módulo nativo falha | Executar `npm run rebuild:native` |

---

## 🐍 Worker Python

### Propósito

O worker Python converte formatos não suportados nativamente:

| Formato | Conversão |
|---------|-----------|
| `.xlsb` | → XLSX → JSONL |
| `.pdf` | → Texto → JSONL |
| `.txt` | → JSONL |

### Dependências

```python
# scripts/requirements.txt
pyxlsb>=1.0.10
openpyxl>=3.1.2
```

### Setup do Runtime

```bash
# Unix (Linux/Mac)
npm run python:setup
# Cria venv em apps/desktop/python-runtime

# Windows
npm run python:prepare-win
# Baixa Python embeddable e instala dependências
```

### Como Funciona

1. Worker monitora `INGESTS_DIR` por arquivos `.xlsb`
2. Converte para XLSX usando `pyxlsb`
3. Gera JSONL para ingestão pela API
4. Remove arquivo temporário

### Logs

```bash
# Em desenvolvimento
[py-conversion] Processing file: exemplo.xlsb
[py-conversion] Conversion complete: exemplo.jsonl

# Arquivo de log (produção)
<userData>/logs/conversion-worker.log
```

### Variáveis de Ambiente do Worker

| Variável | Default | Descrição |
|----------|---------|-----------|
| `INGESTS_DIR` | `<DATA_DIR>/ingests` | Diretório a monitorar |
| `POLL_INTERVAL` | `5` | Intervalo de polling (segundos) |
| `PYTHONUNBUFFERED` | `1` | Desabilita buffer de output |

---

## ⚡ Performance e Otimização

Esta seção documenta as configurações de performance para processamento de bases grandes.

### Configurações Recomendadas para Produção

Use o arquivo `.env.production` como base para máquinas com 8GB+ de RAM:

```bash
# Copie o arquivo de configuração otimizado
cp .env.production .env
```

### PRAGMAs do SQLite

Os valores de cache e mmap foram aumentados significativamente para melhor performance:

| PRAGMA | Valor Padrão | Valor Produção | Impacto |
|--------|--------------|----------------|---------|
| `cache_size` | -4000 (~16MB) | -200000 (~800MB) | Mais dados em memória, menos I/O |
| `mmap_size` | 0 | 1073741824 (1GB) | Leituras muito mais rápidas via mmap |
| `busy_timeout` | 30000 (30s) | 60000 (60s) | Mais tempo para operações longas |
| `synchronous` | NORMAL | NORMAL | Bom equilíbrio segurança/velocidade |
| `journal_mode` | WAL | WAL | Melhor concorrência |

### Configurações de Ingestão

Para bases grandes (500k+ linhas), configure:

```env
# Batch sizes maiores = menos transações = mais rápido
INGEST_BATCH_SIZE=10000
INGEST_SAMPLE_ROWS=2000

# Cache extra durante ingestão (1.6GB)
INGEST_PRAGMA_CACHE_SIZE=-400000
INGEST_PRAGMA_MMAP_SIZE=1073741824
```

### Flags V8 do Electron

O Electron já está configurado com flags de performance:

- `--max-old-space-size=4096` - Aumenta heap do V8 para 4GB
- `--disable-renderer-backgrounding` - Evita throttling do processo
- `--disable-background-timer-throttling` - Mantém timers ativos

### Otimizações Específicas para Windows

O Windows pode ser mais lento que Linux/macOS. Aplique estas otimizações:

1. **Exclusões de Antivírus**
   - Adicione exclusões para:
     - `%APPDATA%\al-tool-desktop\data`
     - O diretório onde o SQLite é armazenado
     - O diretório de uploads temporários

2. **Desabilitar Indexação do Windows**
   - Clique direito na pasta de dados → Propriedades
   - Desmarque "Permitir que o conteúdo desta pasta seja indexado"

3. **Usar SSD**
   - O banco de dados deve estar em um SSD, não em HD mecânico

4. **Verificar Uso de Memória**
   - Abra o Gerenciador de Tarefas
   - Se a memória estiver > 90%, feche outros programas
   - Considere reduzir `cache_size` e `mmap_size` em máquinas com menos RAM

### Variáveis de Ambiente para Performance

| Variável | Tipo | Default | Descrição |
|----------|------|---------|-----------|
| `SQLITE_CACHE_SIZE` | number | -200000 | Cache do SQLite (negativo = páginas) |
| `SQLITE_MMAP_SIZE` | number | 1073741824 | Memory-mapped I/O em bytes |
| `SQLITE_BUSY_TIMEOUT` | number | 60000 | Timeout para locks (ms) |
| `INGEST_BATCH_SIZE` | number | 5000 | Linhas por transação de ingestão |
| `INGEST_SAMPLE_ROWS` | number | 1000 | Linhas para inferência de tipos |
| `WORKER_POLL_SECONDS` | number | 2 | Intervalo de polling do worker |

### Diagnóstico de Performance

```bash
# Verificar PRAGMAs aplicados
curl http://localhost:3000/health | jq '.sqlite'

# Ver uso de memória do processo
curl http://localhost:3000/api/diagnostics/memory

# Logs de performance durante ingestão
tail -f apps/api/logs/ingest-errors.log
```

### Problemas de Performance Comuns

| Problema | Possível Causa | Solução |
|----------|----------------|---------|
| Ingestão lenta (>10min para 100k linhas) | Antivírus escaneando | Adicionar exclusões |
| UI trava durante ingestão | Pouca memória | Fechar outros programas |
| Export demora muito | Disco lento | Usar SSD |
| Conciliação travando | Muitos grupos | Aumentar `MAX_GROUPS_IN_MEMORY` |

---

## 🔧 Troubleshooting

### Problemas Comuns

#### API não inicia

```bash
# Verificar se a porta está livre
lsof -i :3000

# Usar porta alternativa
APP_PORT=3132 npm run api:dev
```

#### "no such table" ao acessar dados

```bash
# Migrations não foram executadas no DATA_DIR correto
DATA_DIR=/caminho/correto npm --workspace=apps/api run migrate
```

#### Worker Python não converte arquivos

```bash
# Verificar se runtime foi configurado
ls apps/desktop/python-runtime/bin/python3

# Reconfigurar
npm run python:setup
```

#### Electron não abre janela

```bash
# Verificar logs no terminal
# Compilar API antes de rodar Electron
npm run api:build
npm run desktop:dev
```

#### better-sqlite3 erro de binding

```bash
# Recompilar módulos nativos
npm run rebuild:native

# Ou manualmente
./node_modules/.bin/electron-rebuild -f -w better-sqlite3
```

### Diagnósticos

```bash
# Health check da API
curl http://localhost:3000/health

# Variáveis de ambiente em uso
curl http://localhost:3000/api/diagnostics/env

# Logs do Electron (procurar por [electron], [api], [py-conversion])
```

---

## 🤝 Contribuição

### Diretrizes

1. **Regras de negócio são sagradas** - Não altere comportamento de estorno, cancelamento ou conciliação sem discussão
2. **Compatibilidade API ↔ Frontend** - Mudanças devem manter contratos
3. **Pipeline intacto** - O fluxo Upload → Ingestão → Pipeline → Export deve sempre funcionar
4. **Performance** - Código deve suportar centenas de milhares de linhas
5. **Tipagem** - TypeScript strict em todos os arquivos novos

### Estrutura de Commits

```
tipo(escopo): descrição curta

Tipos: feat, fix, docs, style, refactor, test, chore
Escopos: api, client, desktop, pipeline, docs
```

### Antes de um PR

- [ ] Testes passando
- [ ] Lint sem erros
- [ ] Migrations criadas se houver mudança de schema
- [ ] Documentação atualizada
- [ ] Testado com dados reais (se possível)

---

## 📚 Referências Rápidas

### Endpoints Essenciais

| Endpoint | Descrição |
|----------|-----------|
| `GET /health` | Health check (retorna dataDir e dbPath) |
| `POST /api/bases` | Upload de arquivo |
| `POST /api/conciliacoes` | Criar job de conciliação |
| `POST /api/conciliacoes/:id/exportar` | Iniciar exportação |
| `GET /api/conciliacoes/:id/download` | Baixar ZIP |

### Arquivos Críticos

| Arquivo | Responsabilidade |
|---------|------------------|
| `apps/api/src/server.ts` | Entry point da API |
| `apps/api/src/env.ts` | Carregamento de variáveis |
| `apps/api/src/config/paths.ts` | Resolução de diretórios |
| `apps/api/src/db/knex.ts` | Configuração SQLite |
| `apps/api/src/pipeline/core/steps/*` | Steps do pipeline |
| `apps/api/src/worker/jobRunner.ts` | Executor de jobs |
| `apps/api/src/services/ConciliacaoExportService.ts` | Exportação |
| `apps/desktop/src/main.ts` | Entry point Electron |
| `apps/client/src/pages/Conciliacoes.tsx` | Página de jobs |

### Variáveis Essenciais

```bash
# Mínimo para desenvolvimento
APP_PORT=3000
DATA_DIR=./storage

# Para licenciamento
LICENSE_API_BASE_URL=https://...

# Para Python customizado
PYTHON_EXECUTABLE=/path/to/python
```

### Comandos Mais Usados

```bash
# Desenvolvimento completo
npm run api:dev          # Terminal 1
npm run client:dev       # Terminal 2

# Build de produção
npm run app:dist

# Migrations
npm --workspace=apps/api run migrate

# Troubleshooting
curl http://localhost:3000/health
```

---

## 📄 Licença

Consulte o arquivo LICENSE na raiz do projeto.

---

<p align="center">
  <sub>Desenvolvido por <a href="https://revaleon.com.br">Revaleon</a></sub>
</p>
