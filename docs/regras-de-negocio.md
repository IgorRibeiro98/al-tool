# 📋 Regras de Negócio - AL-Tool API

**Gerado em:** Fevereiro de 2026  
**Versão:** 1.0  
**Escopo:** Módulo API (`apps/api`)

Este documento consolida todas as regras de negócio extraídas do código-fonte da API do AL-Tool, organizadas por domínio funcional.

---

## Índice

1. [Ingestão de Dados](#1-ingestão-de-dados)
2. [Conciliação](#2-conciliação)
3. [Atribuição](#3-atribuição)
4. [Estorno](#4-estorno)
5. [Cancelamento](#5-cancelamento)
6. [Licenciamento](#6-licenciamento)
7. [Exportação](#7-exportação)
8. [Mapeamento e Configurações](#8-mapeamento-e-configurações)
9. [Performance e Limites](#9-performance-e-limites)
10. [Apêndices](#apêndice-constantes-importantes)

---

## 1. Ingestão de Dados

### 1.1 Formatos de Arquivo Suportados

| Formato | Extensão | Observação |
|---------|----------|------------|
| Excel | `.xlsx` | Usa ExcelJS streaming |
| Apache Arrow IPC | `.arrow` | 10-100x mais rápido que JSONL |
| Excel Binário | `.xlsb` | Python (pyxlsb) |

> **IDEIA 1 Implementada:** Formato binário colunar Apache Arrow substitui JSONL para performance 10-100x melhor.

**Regra:** Arquivos Arrow IPC são **priorizados** quando disponíveis (`arquivo_arrow_path` tem precedência sobre `arquivo_caminho`).

### 1.2 Configuração de Header

```typescript
headerLinhaInicial: number  // Linha onde começa o header (1-indexed, padrão: 1)
headerColunaInicial: number // Coluna inicial do header (1-indexed, padrão: 1)
```

**Regras:**
- O header é extraído da linha especificada em `header_linha_inicial`
- Colunas antes de `header_coluna_inicial` são ignoradas
- Colunas sem nome recebem nomenclatura automática: `col_{índice}`

### 1.3 Sanitização de Nomes de Colunas

```typescript
// Regra de sanitização
nome.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')
```

**Comportamento:**
- Nomes vazios → `col_{índice}`
- Caracteres especiais → substituídos por `_`
- Nomes duplicados → recebem sufixo numérico (`nome_2`, `nome_3`, etc.)

### 1.4 Inferência de Tipos

| Amostragem | Tipo Inferido | Condição |
|------------|---------------|----------|
| 1000 primeiras linhas | `real` | Todos os valores são numéricos |
| 1000 primeiras linhas | `text` | Pelo menos um valor não é numérico |

### 1.5 Conversão de Valores Numéricos

```typescript
// Normalização de strings numéricas
valor.trim().replace(',', '.')  // Converte formato brasileiro para decimal
parseFloat(normalized)          // Converte para número
```

**Regra:** Valores `NaN` ou não-finitos são convertidos para `NULL`.

### 1.6 Tabela de Destino

- Nome da tabela: `base_{baseId}`
- Coluna `id` é criada automaticamente como `PRIMARY KEY`
- Índices são criados automaticamente para colunas de chave configuradas

### 1.7 Limpeza Pós-Ingestão

1. Arquivos fonte (`.xlsx`, `.arrow`) são **removidos** após ingestão bem-sucedida
2. Caminhos `arquivo_arrow_path` e `arquivo_caminho` são limpos no banco
3. Flags monetários são copiados da base de referência (quando `reference_base_id` está definido)

### 1.8 Pipeline de Streaming (IDEIA 5)

**Arquitetura:**
```
Disco ──► mmap (zero-copy) ──► TransformStream ──► WritableStream ──► SQLite
          (SO gerencia)        (parse+batch)       (bulk insert)
```

**Características:**
- **Backpressure automático** via Node.js streams
- **Nunca materializa arquivo completo** em memória
- **Buffer pooling** com 10 buffers de 1MB reutilizáveis
- **highWaterMark** de 64KB para streaming otimizado

### 1.9 Batch Sizes Dinâmicos por RAM

| RAM Disponível | Arrow Batch | XLSX Batch | Max Rows/TX |
|----------------|-------------|------------|-------------|
| < 6GB | 5.000 | 1.500 | 50.000 |
| 6-10GB | 10.000 | 3.000 | 100.000 |
| > 10GB | 20.000 | 5.000 | 200.000 |

### 1.10 Estados do Job de Ingestão

| Status | Descrição |
|--------|-----------|
| `PENDING` | Aguardando processamento |
| `RUNNING` | Em execução |
| `DONE` | Concluído com sucesso |
| `FAILED` | Falhou (erro em `erro`) |

---

## 2. Conciliação

### 2.1 Tipos de Base

| Tipo | Descrição |
|------|-----------|
| `CONTABIL` | Base A (contábil) |
| `FISCAL` | Base B (fiscal) |

**Regra:** Base contábil e fiscal **devem ser diferentes** (`baseContabilId !== baseFiscalId`).

### 2.2 Configuração de Chaves

#### Sistema de Chaves Centralizado (Atual)

```typescript
// Estrutura de chave
{
  key_identifier: string,      // Ex: "CHAVE_1", "CHAVE_2"
  keys_pair_id?: number,       // Referência ao par de chaves
  contabil_key_id?: number,    // Chave contábil direta
  fiscal_key_id?: number,      // Chave fiscal direta
  ordem: number                // Ordem de prioridade
}
```

**Regras:**
- Cada chave deve ter `keys_pair_id` **OU** (`contabil_key_id` **E** `fiscal_key_id`)
- `key_identifier` deve ser **único** dentro de uma configuração
- Chaves são processadas na ordem definida por `ordem`

#### Validação de Chaves

1. `contabil_key` deve ter `base_tipo = 'CONTABIL'`
2. `fiscal_key` deve ter `base_tipo = 'FISCAL'`
3. `base_subtipo` das chaves deve ser compatível com as bases selecionadas

### 2.3 Colunas de Conciliação (Valores)

```typescript
coluna_conciliacao_contabil: string  // Coluna de valor na Base A
coluna_conciliacao_fiscal: string    // Coluna de valor na Base B
inverter_sinal_fiscal: boolean       // Inverte sinal da Base B (× -1)
limite_diferenca_imaterial: number   // Tolerância para diferenças
```

### 2.4 Status de Conciliação

| Status | Código | Descrição |
|--------|--------|-----------|
| Conciliado | `01_Conciliado` | Match perfeito |
| Encontrado c/Diferença | `02_Encontrado c/Diferença` | Match com diferença dentro do limite |
| Não Encontrado | `03_Não Encontrado` | Sem correspondência |
| Não Avaliado | `04_Não Avaliado` | Cancelado ou estornado |

### 2.5 Grupos Especiais

| Grupo | Descrição | Origem |
|-------|-----------|--------|
| `Conciliado_Estorno` | Par de documentos estornados | EstornoBaseAStep |
| `NF Cancelada` | Nota fiscal cancelada | CancelamentoBaseBStep |
| `Documentos estornados` | Documentos identificados como estorno | EstornoBaseAStep |

### 2.6 Regras de Matching

```typescript
const EPSILON = 1e-6;  // Tolerância para comparação de valores float

// Cálculo de diferença
difference = value_a - value_b;

// Classificação
if (Math.abs(difference) < EPSILON) → STATUS_CONCILIADO
else if (Math.abs(difference) <= limite_diferenca_imaterial) → STATUS_FOUND_DIFF
else → STATUS_NOT_FOUND
```

### 2.7 Construção de Chave Composta

```typescript
// Concatenação de valores das colunas de chave
chave = colunas.map(c => String(row[c] ?? '')).join('_');
```

### 2.8 Pipeline de Conciliação

**Ordem de execução dos steps:**

1. `NullsBaseAStep` - Normalização de nulos na Base A
2. `EstornoBaseAStep` - Identificação de estornos na Base A
3. `NullsBaseBStep` - Normalização de nulos na Base B
4. `CancelamentoBaseBStep` - Identificação de cancelamentos na Base B
5. `CreateLightTableStep` - Criação de tabelas leves otimizadas
6. `ConciliacaoABStep` - Matching principal A × B
7. `CleanupLightTableStep` - Limpeza de tabelas temporárias

### 2.9 Uso de Workers

| Volume de Grupos | Estratégia |
|------------------|------------|
| < 500 grupos | Processamento síncrono |
| ≥ 500 grupos | Worker pool paralelo |

**Chunk Size:** 200 grupos por worker

### 2.10 Tabela de Resultados

- Nome: `conciliacao_result_{jobId}`
- Colunas fixas: `id`, `job_id`, `chave`, `status`, `grupo`, `a_row_id`, `b_row_id`, `value_a`, `value_b`, `difference`, `a_values`, `b_values`, `created_at`
- Colunas dinâmicas: Uma coluna para cada `key_identifier` (ex: `CHAVE_1`, `CHAVE_2`)

---

## 3. Atribuição

### 3.1 Conceito

Atribuição é o processo de **copiar valores de colunas** de uma base origem para uma base destino, baseado em **correspondência de chaves**.

### 3.2 Restrições de Bases

```typescript
// Regras de validação
origemId !== destinoId                              // Bases devem ser diferentes
tipoOrigem !== tipoDestino                          // Tipos devem ser diferentes
tipoOrigem ∈ ['FISCAL', 'CONTABIL']                // Tipos válidos
tipoDestino ∈ ['FISCAL', 'CONTABIL']               // Tipos válidos
```

### 3.3 Modos de Escrita

| Modo | Comportamento |
|------|---------------|
| `OVERWRITE` | Sobrescreve valores existentes |
| `ONLY_EMPTY` | Apenas preenche células vazias |

### 3.4 Definição de Valor Vazio

```typescript
function isEmptyValue(val: unknown): boolean {
  if (val === null || val === undefined) return true;
  const str = String(val).trim();
  return str === '' || 
         str.toLowerCase() === 'null' || 
         str === '0' || 
         str === '0.00';
}
```

### 3.5 Normalização de Valores para Chave

```typescript
function normalizeKeyValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val).trim();
  if (str.toLowerCase() === 'null') return '';
  return str;
}
```

### 3.6 Seleção de Colunas

- `selected_columns`: Lista de colunas a copiar da origem
- Colunas devem existir na base origem (validado em runtime)

### 3.7 Atualização da Base Original

```typescript
update_original_base: boolean  // default: true
```

**Quando `true`:** Valores são copiados diretamente para a tabela da base destino.

### 3.8 Tabela de Resultados

- Nome: `atribuicao_result_{runId}`
- Contém todas as colunas da base destino + colunas copiadas da origem

### 3.9 Colunas Reservadas

Colunas que **NÃO** são sobrescritas durante atribuição:
- `id`
- `created_at`
- `updated_at`
- Colunas de resultado de conciliação

### 3.10 Colunas CHAVE_n

Para cada chave configurada, uma coluna `CHAVE_n` é criada contendo a concatenação dos valores das colunas da chave.

### 3.11 Uso de Workers

| Volume de Matches | Estratégia |
|-------------------|------------|
| < 100 matches | Processamento síncrono |
| ≥ 100 matches | Worker pool paralelo |

### 3.12 Estados do Run

| Status | Descrição |
|--------|-----------|
| `PENDING` | Aguardando execução |
| `RUNNING` | Em execução |
| `DONE` | Concluído com sucesso |
| `FAILED` | Falhou (erro em `erro`) |

---

## 4. Estorno

### 4.1 Conceito

Identificar pares de documentos na **mesma base** (contábil) onde a soma de valores é aproximadamente zero, indicando operação de estorno.

### 4.2 Configuração

```typescript
{
  coluna_a: string,      // Coluna de identificação A (ex: doc_origem)
  coluna_b: string,      // Coluna de identificação B (ex: doc_referencia)
  coluna_soma: string,   // Coluna de valor para soma
  limite_zero: number    // Tolerância para considerar soma = 0
}
```

### 4.3 Algoritmo de Matching

```typescript
const SOMA_PRECISION = 100;  // 2 casas decimais

// Indexação por valor de soma
somaKey = Math.round(soma * SOMA_PRECISION);

// Para cada item A, busca item B onde:
// |soma_A + soma_B| <= limite_zero
```

**Complexidade:** O(n) usando lookup indexado, ao invés de O(n²) com nested loops.

### 4.4 Resultado

- Pares encontrados recebem:
  - `status = '01_Conciliado'`
  - `grupo = 'Conciliado_Estorno'`
- Documentos não pareados recebem:
  - `status = '04_Não Avaliado'`
  - `grupo = 'Documentos estornados'`

### 4.5 Uso de Workers

| Volume de Entries | Estratégia |
|-------------------|------------|
| < 5.000 entries | Processamento síncrono |
| ≥ 5.000 entries | Worker único (algoritmo depende de estado global) |

---

## 5. Cancelamento

### 5.1 Conceito

Identificar registros na **Base B (fiscal)** marcados como cancelados, para exclusão da conciliação.

### 5.2 Configuração

```typescript
{
  coluna_indicador: string,      // Coluna que indica cancelamento
  valor_cancelado: string,       // Valor que indica cancelamento
  valor_nao_cancelado: string    // Valor que indica não-cancelamento
}
```

### 5.3 Regra de Identificação

```typescript
// Comparação case-insensitive com trim
lower(trim(ifnull(coluna_indicador, ''))) === lower(trim(valor_cancelado))
```

### 5.4 Resultado

Registros cancelados recebem:
- `status = '04_Não Avaliado'`
- `grupo = 'NF Cancelada'`

### 5.5 Estratégia por Volume

| Volume da Tabela | Estratégia |
|------------------|------------|
| ≤ 500.000 rows | INSERT direto |
| > 500.000 rows | INSERT em batches por faixa de ID |

### 5.6 Batch Size Dinâmico

| RAM Disponível | Batch Size |
|----------------|------------|
| < 6GB | 5.000 |
| 6-10GB | 10.000 |
| > 10GB | 20.000 |

---

## 6. Licenciamento

### 6.1 Status de Licença

| Status | Descrição |
|--------|-----------|
| `not_activated` | Licença não ativada (sem registro no banco) |
| `expired` | Licença expirada (`expires_at < now`) |
| `blocked_offline` | Bloqueado por validação offline expirada |
| `active` | Licença ativa e válida |

### 6.2 Validação Offline

```typescript
const OFFLINE_GRACE_DAYS = 37;  // dias permitidos após última validação online

// Regra
if (!lastSuccessOnlineValidation) → blocked_offline
if (now > lastSuccessOnlineValidation + 37 days) → blocked_offline
```

### 6.3 Fingerprint de Máquina

```typescript
fingerprint = sha256(`${hostname}|${platform}|${arch}|${cpuModel}`)
```

### 6.4 Ativação

```javascript
POST /api/license/activate
{
  "licenseKey": "XXXX-XXXX-XXXX-XXXX"
}
```

**Resposta do servidor de licenças deve conter:**
- `activation_token` ou `token` ou `activationToken`
- `expires_at` ou `expiresAt` ou `expires`

### 6.5 Período de Validação

```typescript
const DEFAULT_VALIDATION_DAYS = 30;  // intervalo entre validações online
```

---

## 7. Exportação

### 7.1 Formatos de Exportação

| Formato | Conteúdo |
|---------|----------|
| `.xlsx` | Planilha única com resultados |
| `.zip` | `Base_A.xlsx`, `Base_B.xlsx`, `Base_Comparativo.xlsx` |

### 7.2 Estrutura do ZIP

```
{nome_job}.zip
├── Base_A.xlsx    # Base contábil com colunas status, chave, grupo
├── Base_B.xlsx    # Base fiscal com colunas status, chave, grupo
└── Base_Comparativo.xlsx  # Comparativo lado a lado
```

### 7.3 Formatação Monetária

```typescript
// Colunas identificadas como monetárias
numFmt = '#,##0.00'

// Normalização de valores string
'12.345,67' → 12345.67  // Remove separador de milhar, troca vírgula por ponto
```

### 7.4 Cores de Header

| Base | Cor do Header | Formato ARGB |
|------|---------------|--------------|
| Base A (Contábil) | Azul | `FF3C78D8` |
| Base B (Fiscal) | Cinza | `FF78909C` |

### 7.5 Processamento de Exportação

```typescript
PARALLEL_BASE_EXPORT = true   // Exporta Base A e B em paralelo (se RAM > 2GB)
ZIP_COMPRESSION_LEVEL = 6     // Nível de compressão (1-9)
```

---

## 8. Mapeamento e Configurações

### 8.1 Mapeamento de Colunas (`configs_mapeamento_bases`)

Define correspondência entre colunas de bases diferentes:

```typescript
{
  nome: string,
  base_contabil_id: number,
  base_fiscal_id: number,
  mapeamentos: [
    { coluna_contabil: string, coluna_fiscal: string },
    // ...
  ]
}
```

**Regras:**
- `base_contabil_id !== base_fiscal_id`
- Mapeamentos deve ter pelo menos um item válido
- Colunas devem existir nas respectivas bases

### 8.2 Definições de Chaves (`keys_definitions`)

```typescript
{
  nome: string,
  descricao?: string,
  base_tipo: 'CONTABIL' | 'FISCAL',
  base_subtipo: string,           // Deve existir em base_subtypes
  columns: string[]               // Lista de colunas que compõem a chave
}
```

**Validações:**
- `nome` único por `base_tipo` + `base_subtipo`
- `columns` não pode ser vazio
- Cada coluna deve ser string não-vazia

### 8.3 Pares de Chaves (`keys_pairs`)

```typescript
{
  nome: string,
  contabil_key_id: number,   // Referência a keys_definitions (CONTABIL)
  fiscal_key_id: number,     // Referência a keys_definitions (FISCAL)
}
```

**Validações:**
- `contabil_key_id` deve referenciar chave com `base_tipo = 'CONTABIL'`
- `fiscal_key_id` deve referenciar chave com `base_tipo = 'FISCAL'`
- `base_subtipo` das chaves deve ser compatível
- Par de IDs deve ser único

### 8.4 Configuração de Conciliação (`configs_conciliacao`)

```typescript
{
  nome: string,
  base_contabil_id: number,
  base_fiscal_id: number,
  keys: KeyItem[],                       // Referências a chaves centrais
  coluna_conciliacao_contabil: string,
  coluna_conciliacao_fiscal: string,
  inverter_sinal_fiscal?: boolean,       // default: false
  limite_diferenca_imaterial?: number    // default: 0
}
```

**Regras Deprecadas:**
- `chaves_contabil` e `chaves_fiscal` inline são **deprecados**
- Usar sistema de `keys` referenciando chaves centrais

### 8.5 Configuração de Estorno (`configs_estorno`)

```typescript
{
  base_id?: number,          // Opcional - pode ser determinado pelo contexto
  nome: string,
  coluna_a: string,          // Coluna de referência A
  coluna_b: string,          // Coluna de referência B
  coluna_soma: string,       // Coluna de valor para soma
  limite_zero?: number,      // Tolerância (default: 0)
  ativa?: boolean            // default: true
}
```

### 8.6 Configuração de Cancelamento (`configs_cancelamento`)

```typescript
{
  base_id?: number,          // Opcional
  nome: string,
  coluna_indicador: string,  // Coluna que indica status
  valor_cancelado: string,   // Valor que indica cancelamento
  valor_nao_cancelado: string,
  ativa?: boolean            // default: true
}
```

---

## 9. Performance e Limites

### 9.1 Perfis de Hardware

| Perfil | RAM | CPUs | Características |
|--------|-----|------|-----------------|
| `low` | < 6GB | ≤ 2 | Modo conservador |
| `standard` | 6-10GB | 3-6 | Modo padrão (target: 8GB/i5) |
| `high` | > 10GB | > 6 | Modo performance |

### 9.2 Configurações por Perfil

#### Low Memory (< 6GB)
```typescript
{
    workers: { maxPoolSize: 2, minPoolSize: 1 },
    sqlite: { cachePages: -25000, mmapSize: 256MB },
    processing: { pageSize: 5000, batchSize: 2000 }
}
```

#### Standard (6-10GB)
```typescript
{
    workers: { maxPoolSize: 4, minPoolSize: 2 },
    sqlite: { cachePages: -50000, mmapSize: 512MB },
    processing: { pageSize: 10000, batchSize: 5000 }
}
```

#### High Performance (> 10GB)
```typescript
{
    workers: { maxPoolSize: 6, minPoolSize: 3 },
    sqlite: { cachePages: -100000, mmapSize: 1GB },
    processing: { pageSize: 20000, batchSize: 10000 }
}
```

### 9.3 Batch Sizes Dinâmicos (Baseado em RAM)

| RAM Total | Arrow Batch | XLSX Batch | Max Rows/Tx |
|-----------|-------------|------------|-------------|
| < 6 GB | 5.000 | 1.500 | 50.000 |
| 6-10 GB | 10.000 | 3.000 | 100.000 |
| > 10 GB | 20.000 | 5.000 | 200.000 |

### 9.4 Limites SQLite

| Limite | Valor | Uso |
|--------|-------|-----|
| `SQLITE_LIMIT_VARIABLE_NUMBER` | 999 | Máximo de variáveis em prepared statement |
| `SQLITE_LIMIT_COMPOUND_SELECT` | 500 | Máximo de SELECTs em UNION |
| Chunk Size (INSERT) | 50 | 50 rows × ~10 cols = 500 < 999 |
| Chunk Size (Query) | 500 | IDs por WHERE IN |

### 9.5 Limites de API

```typescript
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100
DEFAULT_RESULT_PAGE_SIZE = 50
```

### 9.4 Workers e Polling

| Worker | Intervalo Padrão | Configuração |
|--------|------------------|--------------|
| Conciliação | 5 segundos | `WORKER_POLL_SECONDS` |
| Ingestão | 5 segundos | `WORKER_POLL_SECONDS` |
| Derived Column | 3 segundos | `DERIVED_COLUMN_POLL_INTERVAL` |

### 9.5 Derived Column Processing

```typescript
FAST_MODE_THRESHOLD = 500000   // Usa UPDATE único abaixo deste limite
BATCH_SIZE = 50000             // Tamanho do batch para tabelas grandes
```

### 9.6 Exportação

```typescript
EXPORT_CHUNK_SIZE = dinâmico   // Baseado em RAM disponível
TEMP_INDEX_THRESHOLD = dinâmico // Cria índice temp acima deste limite
ZIP_COMPRESSION_LEVEL = 6      // Pode ser configurado via ENV
```

### 9.7 Light Tables (Otimização)

**Objetivo:** Reduzir I/O durante conciliação criando tabelas com apenas colunas necessárias.

```typescript
// Nome da tabela leve
base_{baseId}_light_{jobId}

// Colunas incluídas
- id (sempre)
- Colunas de chave
- Coluna de valor (se definida)
- created_at (se existir)
```

**Índices criados:**
1. Índice único em `id`
2. Índice composto nas colunas de chave
3. Índice na coluna de valor

### 9.8 Índices Automáticos

**Criados durante ingestão:**
- Índices nas colunas referenciadas em configurações de conciliação

**Criados durante pipeline:**
- Índices temporários nas colunas de JOIN
- Removidos após finalização do job

### 9.9 Índices Temporários

```typescript
// Criados para tabelas > TEMP_INDEX_THRESHOLD
const TEMP_INDEX_THRESHOLD = {
    low: 50000,
    standard: 100000,
    high: 150000
};
```

### 9.10 Limpeza e Manutenção

```typescript
// TTL para limpeza de resultados
CLEANUP_RESULTS_TTL_DAYS = 7   // dias após completion

// Endpoints de manutenção
POST /maintenance/cleanup          // Limpeza completa
POST /maintenance/cleanup/storage  // Apenas arquivos
POST /maintenance/cleanup/results  // Apenas resultados antigos
```

### 9.10 Limites de Memória para Arquivos

```typescript
MAX_SIZE_FOR_BUFFER = 2 GB   // Limite para leitura em buffer único
```

**Nota:** Arquivos maiores que 2GB requerem streaming ou processamento especial.

---

## Apêndice: Constantes Importantes

### Status de Jobs

```typescript
type JobStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
type IngestJobStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
type AtribuicaoRunStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
```

### Status de Conciliação

```typescript
const STATUS_CONCILIADO = '01_Conciliado';
const STATUS_FOUND_DIFF = '02_Encontrado c/Diferença';
const STATUS_NOT_FOUND = '03_Não Encontrado';
const STATUS_NAO_AVALIADO = '04_Não Avaliado';
```

### Grupos de Marcação

```typescript
const GROUP_ESTORNO = 'Conciliado_Estorno';
const GROUP_NF_CANCELADA = 'NF Cancelada';
const GROUP_DOC_ESTORNADOS = 'Documentos estornados';
```

### Colunas Ignoradas em Normalização

```typescript
const IGNORED_COLUMNS = ['id', 'created_at', 'updated_at'];
```

### Colunas Excluídas de Exportação de Atribuição

```typescript
const EXCLUDE_COLS = ['dest_row_id', 'orig_row_id', 'created_at', 'updated_at'];
```

---

## Variáveis de Ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `WORKER_POLL_SECONDS` | 5 | Intervalo de polling dos workers |
| `API_DEFAULT_PAGE_SIZE` | 20 | Tamanho padrão de página |
| `API_MAX_PAGE_SIZE` | 100 | Tamanho máximo de página |
| `API_RESULT_PAGE_SIZE` | 50 | Tamanho padrão para resultados |
| `EXPORT_CHUNK_SIZE` | dinâmico | Chunk de exportação |
| `EXPORT_ZIP_COMPRESSION_LEVEL` | 6 | Nível de compressão ZIP |
| `EXPORT_TEMP_INDEX_THRESHOLD` | dinâmico | Limiar para índices temp |
| `EXPORT_PARALLEL_BASES` | true | Exportação paralela |
| `DERIVED_COLUMN_POLL_INTERVAL` | 3000 | Polling derived column (ms) |
| `DERIVED_COLUMN_FAST_THRESHOLD` | 500000 | Limite para modo fast |
| `DERIVED_COLUMN_BATCH_SIZE` | 50000 | Batch size |
| `DERIVED_COLUMN_DEBUG` | false | Debug mode |
| `CLEANUP_RESULTS_TTL_DAYS` | 7 | TTL para cleanup |
| `LICENSE_API_BASE_URL` | - | URL do servidor de licenças |
| `LICENSE_API_SECRET` | - | API key do servidor |
| `NODE_ENV` | development | Ambiente de execução |

---

## Formatos de Arquivo Suportados

| Extensão | MIME Type | Processador |
|----------|-----------|-------------|
| `.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | ExcelJS |
| `.xlsb` | `application/vnd.ms-excel.sheet.binary.macroEnabled.12` | Python (pyxlsb) |
| `.arrow` | `application/vnd.apache.arrow.file` | Apache Arrow |

---

## Changelog

| Data | Versão | Descrição |
|------|--------|-----------|
| 01/02/2026 | 1.0 | Versão inicial extraída do código-fonte |

---

*Documento gerado automaticamente a partir da análise do código-fonte do AL-Tool API.*
