# Estudo de Viabilidade: Tabelas Leves para Pipeline de Conciliação

**Data:** 28/01/2026  
**Versão:** 1.0

---

## 1. Resumo Executivo

Este documento analisa a viabilidade de implementar uma arquitetura de "tabelas leves" para otimizar a pipeline de conciliação. A proposta é:

1. **Ingestão Completa**: Manter a tabela completa (`base_{id}`) com todas as colunas e linhas
2. **Tabelas Leves para Pipeline**: Criar tabelas reduzidas (`base_{id}_light`) apenas com as colunas necessárias para conciliação
3. **Exportação com Merge**: Na exportação, fazer JOIN da tabela completa com os resultados da pipeline

---

## 2. Arquitetura Atual

### 2.1 Fluxo de Dados Atual

```
┌─────────────────┐    ┌──────────────────┐    ┌───────────────────┐    ┌────────────────┐
│   Upload/JSONL  │───►│   Ingest Full    │───►│  Pipeline Steps   │───►│    Export      │
│   (arquivo)     │    │  (base_{id})     │    │  (usa base_{id})  │    │   (ZIP/XLSX)   │
└─────────────────┘    └──────────────────┘    └───────────────────┘    └────────────────┘
```

### 2.2 Tabelas Envolvidas

| Tabela | Descrição | Uso na Pipeline |
|--------|-----------|-----------------|
| `bases` | Metadados das bases | Configuração |
| `base_{id}` | Tabela SQLite com dados completos | **Todas as operações** |
| `base_columns` | Mapeamento colunas Excel → SQLite | Exportação |
| `conciliacao_result_{jobId}` | Resultados da conciliação | Saída da pipeline |
| `conciliacao_marks` | Marcações manuais de pares | Pipeline |

### 2.3 Steps da Pipeline

1. **NullsBaseAStep / NullsBaseBStep**: Identificam linhas com valores nulos/zerados
2. **ConciliacaoABStep**: Conciliação principal entre Base A e Base B
3. **EstornoBaseAStep**: Identificação de estornos na Base A
4. **CancelamentoBaseBStep**: Identificação de cancelamentos na Base B

### 2.4 Colunas Usadas na Pipeline (análise do código)

```typescript
// ConciliacaoABStep.ts - colunas acessadas:
- id (sempre)
- Colunas de chave (chavesContabil[keyId], chavesFiscal[keyId])
- Coluna de valor (coluna_conciliacao_contabil, coluna_conciliacao_fiscal)

// NullsBaseAStep/NullsBaseBStep - colunas acessadas:
- id (sempre)
- Todas as colunas (para verificar nulos) - MAS poderia usar apenas colunas de chave

// EstornoBaseAStep - colunas acessadas:
- id
- Colunas de identificação de estorno (configuráveis)
- Coluna de valor

// CancelamentoBaseBStep - colunas acessadas:
- id
- Coluna indicadora de cancelamento
- Coluna de valor
```

---

## 3. Proposta: Tabelas Leves

### 3.1 Nova Arquitetura

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐
│   Upload/JSONL  │───►│   Ingest Full    │───►│  Create Light Table │
│   (arquivo)     │    │  (base_{id})     │    │  (base_{id}_light)  │
└─────────────────┘    └──────────────────┘    └──────────┬──────────┘
                                                          │
                                                          ▼
┌────────────────┐    ┌─────────────────────┐    ┌───────────────────┐
│    Export      │◄───│  Merge Results      │◄───│  Pipeline Steps   │
│   (ZIP/XLSX)   │    │  (full + results)   │    │  (usa _light)     │
└────────────────┘    └─────────────────────┘    └───────────────────┘
```

### 3.2 Estrutura da Tabela Light

```sql
-- Tabela light criada dinamicamente baseada na configuração
CREATE TABLE base_{id}_light (
    id INTEGER PRIMARY KEY,           -- FK para base_{id}.id
    -- Colunas de chave (dinâmico por config)
    chave_col_1 TEXT/NUMERIC,
    chave_col_2 TEXT/NUMERIC,
    ...
    -- Coluna de valor monetário
    valor_conciliacao NUMERIC,
    -- Índices compostos para otimizar JOINs
    created_at DATETIME
);

-- Índices para performance
CREATE INDEX idx_base_{id}_light_keys ON base_{id}_light (chave_col_1, chave_col_2, ...);
CREATE INDEX idx_base_{id}_light_valor ON base_{id}_light (valor_conciliacao);
```

### 3.3 Momento de Criação da Tabela Light

**Opção A: Na Ingestão (recomendado)**
- Criar logo após o ingest completo
- Requer conhecimento das configurações de conciliação no momento da ingestão
- ❌ Problema: A configuração pode ainda não existir

**Opção B: Ao Iniciar um Job (recomendado)**
- Criar quando um job de conciliação é iniciado
- Tem acesso à configuração completa
- ✅ Flexível e sempre com contexto correto

**Opção C: Sob Demanda (lazy)**
- Criar na primeira vez que a pipeline precisa
- Adiciona latência no primeiro job
- ⚠️ Pode complicar a lógica

### 3.4 Colunas Necessárias para Tabela Light

Com base na análise do código:

```typescript
interface LightTableConfig {
    baseId: number;
    // Colunas essenciais
    columns: {
        // ID sempre presente (PK referenciando tabela original)
        id: true;
        
        // Colunas de chave - vêm da configuração
        keyColumns: string[]; // Ex: ['conta', 'centro_custo', 'data']
        
        // Coluna de valor para conciliação
        valueColumn: string;  // Ex: 'valor' ou 'saldo'
        
        // Para estorno (Base A)
        estornoIndicatorColumn?: string;
        estornoValueColumn?: string;
        
        // Para cancelamento (Base B)
        cancelamentoIndicatorColumn?: string;
    }
}
```

---

## 4. Análise de Impacto

### 4.1 Ganhos Esperados

| Aspecto | Atual | Com Tabelas Light | Ganho Estimado |
|---------|-------|-------------------|----------------|
| Memória em JOIN | ~100 cols × N rows | ~5-10 cols × N rows | **80-95%** |
| I/O Disco | Leitura de todas colunas | Leitura seletiva | **70-90%** |
| Índices | Genéricos ou sob demanda | Otimizados para chaves | **50-70%** mais rápido |
| Tamanho tabela | 100% | 5-10% | **90-95%** menor |

### 4.2 Exemplo Numérico

Cenário: Base com 1 milhão de linhas, 100 colunas, média 50 bytes/célula

| Métrica | Tabela Completa | Tabela Light (10 cols) |
|---------|-----------------|------------------------|
| Tamanho aproximado | ~5 GB | ~500 MB |
| Tempo scan completo | ~30s | ~3s |
| Memória para JOIN | ~500 MB+ | ~50 MB |
| Criação de índices | Lento (muitos cols) | Rápido (poucos cols) |

### 4.3 Custos e Trade-offs

| Custo | Descrição | Mitigação |
|-------|-----------|-----------|
| Espaço em disco | Duplicação parcial dos dados | Light table é ~10% do tamanho original |
| Tempo de criação | Precisa copiar dados na criação | Operação única por job; pode ser paralela |
| Complexidade de código | Nova camada de abstração | Encapsular em serviço dedicado |
| Sincronização | Light table pode ficar desatualizada | Recriar por job; ou invalidar em alterações |
| Migrations | Nova estrutura de tabelas | Tabelas dinâmicas, sem migration |

---

## 5. Impacto no Código Existente

### 5.1 Arquivos que Precisam de Modificação

```
apps/api/src/
├── services/
│   ├── LightTableService.ts (NOVO)      # Serviço para criar/gerenciar tabelas light
│   └── ExcelIngestService.ts            # Opcional: hook pós-ingestão
│
├── pipeline/
│   └── core/
│       ├── index.ts                      # Adicionar step de criação de tabela light
│       └── steps/
│           ├── CreateLightTableStep.ts  (NOVO)
│           ├── ConciliacaoABStep.ts     # Usar tabela light ao invés de full
│           ├── NullsBaseAStep.ts        # Adaptar para light table
│           ├── NullsBaseBStep.ts        # Adaptar para light table
│           ├── EstornoBaseAStep.ts      # Adaptar para light table
│           └── CancelamentoBaseBStep.ts # Adaptar para light table
│
├── services/
│   └── ConciliacaoExportService.ts      # Fazer merge da full com results
│
└── routes/
    └── jobs.ts                           # Orquestrar criação da light table
```

### 5.2 Modificações Detalhadas

#### 5.2.1 Novo Serviço: `LightTableService.ts`

```typescript
// Pseudo-código
class LightTableService {
    async createLightTable(opts: {
        baseId: number;
        jobId: number;
        keyColumns: string[];
        valueColumn: string;
        extraColumns?: string[];
    }): Promise<string> {
        const lightTableName = `base_${baseId}_light_${jobId}`;
        
        // 1. Verificar se já existe
        if (await this.db.schema.hasTable(lightTableName)) {
            return lightTableName;
        }
        
        // 2. Obter tabela original
        const base = await this.db('bases').where({ id: baseId }).first();
        const fullTable = base.tabela_sqlite;
        
        // 3. Criar tabela light com SELECT INTO
        const columns = ['id', ...keyColumns, valueColumn, ...extraColumns];
        await this.db.raw(`
            CREATE TABLE ${lightTableName} AS
            SELECT ${columns.join(', ')}
            FROM ${fullTable}
        `);
        
        // 4. Criar índices otimizados
        await this.db.raw(`
            CREATE INDEX idx_${lightTableName}_keys 
            ON ${lightTableName} (${keyColumns.join(', ')})
        `);
        
        // 5. Registrar na base para cleanup posterior
        await this.db('bases').where({ id: baseId }).update({
            tabela_light: lightTableName
        });
        
        return lightTableName;
    }
    
    async dropLightTable(baseId: number, jobId: number): Promise<void> {
        const lightTableName = `base_${baseId}_light_${jobId}`;
        await this.db.schema.dropTableIfExists(lightTableName);
    }
}
```

#### 5.2.2 Modificação em `ConciliacaoABStep.ts`

```typescript
// Antes:
const tableA = baseA.tabela_sqlite;
const tableB = baseB.tabela_sqlite;

// Depois:
const tableA = ctx.lightTableA ?? baseA.tabela_sqlite;
const tableB = ctx.lightTableB ?? baseB.tabela_sqlite;

// Ou criar no início do step se não existir:
if (!ctx.lightTableA) {
    ctx.lightTableA = await this.lightTableService.createLightTable({
        baseId: baseAId,
        jobId: ctx.jobId,
        keyColumns: allAKeyCols,
        valueColumn: colA
    });
}
```

#### 5.2.3 Modificação em `ConciliacaoExportService.ts`

A exportação já faz JOIN correto! Ela lê da tabela completa e faz join com `conciliacao_result_{jobId}`:

```typescript
// Já existente - NÃO precisa de grande modificação
const baseRows = await db
    .select(['id', ...sqliteCols])  // Lê da tabela COMPLETA
    .from(meta.tableName)           // base_{id} (full)
    .where('id', '>', lastId);

// Batch fetch result data
const resultRows = await db
    .select(resultSelectCols)
    .from(resultTable)              // conciliacao_result_{jobId}
    .whereIn(joinColumn, ids);
```

---

## 6. Estratégias de Implementação

### 6.1 Estratégia 1: Incremental (Recomendada)

**Fase 1: Infraestrutura** (1-2 dias)
- [ ] Criar `LightTableService.ts`
- [ ] Adicionar `CreateLightTableStep.ts` na pipeline
- [ ] Adicionar cleanup de light tables em jobs finalizados/cancelados

**Fase 2: Adaptação da Pipeline** (2-3 dias)
- [ ] Modificar `ConciliacaoABStep.ts` para usar light tables
- [ ] Ajustar context da pipeline para carregar light table names

**Fase 3: Otimização dos outros steps** (1-2 dias)
- [ ] Adaptar `NullsBaseAStep.ts` e `NullsBaseBStep.ts`
- [ ] Adaptar `EstornoBaseAStep.ts` e `CancelamentoBaseBStep.ts`

**Fase 4: Testes e Refinamento** (1-2 dias)
- [ ] Testes de performance com bases grandes
- [ ] Ajuste de configurações (batch sizes, etc.)

### 6.2 Estratégia 2: Feature Flag

Implementar com flag de feature para ativar/desativar:

```typescript
// env.ts
export const USE_LIGHT_TABLES = process.env.USE_LIGHT_TABLES === 'true';

// ConciliacaoABStep.ts
const tableA = USE_LIGHT_TABLES 
    ? await this.getOrCreateLightTable(baseAId, ctx.jobId, keyCols, valueCol)
    : baseA.tabela_sqlite;
```

### 6.3 Estratégia 3: Views Materializadas

Alternativa usando views materializadas (se o SQLite suportasse nativamente):

```sql
-- SQLite não suporta views materializadas nativamente,
-- mas podemos simular com tabelas temporárias
CREATE TEMP TABLE base_{id}_view AS
SELECT id, col1, col2, valor FROM base_{id};
```

---

## 7. Considerações de Performance

### 7.1 Criação da Light Table

```sql
-- Opção 1: CREATE TABLE AS SELECT (mais rápido)
CREATE TABLE base_1_light AS 
SELECT id, chave1, chave2, valor 
FROM base_1;

-- Opção 2: INSERT INTO SELECT (mais controle)
CREATE TABLE base_1_light (
    id INTEGER PRIMARY KEY,
    chave1 TEXT,
    chave2 TEXT,
    valor NUMERIC
);
INSERT INTO base_1_light SELECT id, chave1, chave2, valor FROM base_1;
```

**Benchmarks estimados** (1M rows):
- CREATE AS SELECT: ~2-5 segundos
- INSERT INTO SELECT: ~5-10 segundos
- Com índices: +2-3 segundos

### 7.2 Memory Footprint

```
Cenário: 1M rows, 100 columns (full) vs 5 columns (light)

Full table scan:
- Page cache: ~100MB por batch
- Working memory: ~50MB
- Total: ~150MB

Light table scan:
- Page cache: ~5MB por batch
- Working memory: ~5MB
- Total: ~10MB

Redução: ~93%
```

### 7.3 Tempo de JOIN

```
Cenário: JOIN entre Base A (1M rows) e Base B (500K rows)

Com tabelas completas:
- Leitura A: 5GB
- Leitura B: 2.5GB
- Tempo estimado: 60-120 segundos

Com light tables:
- Leitura A: 50MB
- Leitura B: 25MB
- Tempo estimado: 5-15 segundos

Speedup: ~8-10x
```

---

## 8. Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| Light table desatualizada | Baixa | Alto | Recriar por job; timestamp de validação |
| Disco cheio (duplicação) | Média | Médio | Light tables são ~10% do original; cleanup automático |
| Colunas faltando na light | Média | Alto | Validar config antes de criar; fallback para full table |
| Inconsistência de dados | Baixa | Alto | Transação atômica na criação; verificação de integridade |
| Complexidade de debug | Média | Baixo | Logs detalhados; flag para desativar |

---

## 9. Recomendação Final

### ✅ VIÁVEL - Recomendo implementação

**Justificativa:**

1. **Ganho significativo de performance**: 8-10x mais rápido em JOINs
2. **Redução de uso de memória**: 90%+ menos memória
3. **Impacto moderado no código**: Mudanças localizadas nos steps da pipeline
4. **Exportação não afetada**: Já faz merge corretamente
5. **Rollback fácil**: Feature flag permite desativar se necessário

### Próximos Passos Sugeridos

1. **Prova de Conceito** (1 dia)
   - Implementar `LightTableService` básico
   - Testar criação de light table com base de 100K+ rows
   - Medir tempo e memória

2. **Implementação Completa** (3-5 dias)
   - Seguir Estratégia 1 (Incremental)
   - Usar feature flag (Estratégia 2) para rollback

3. **Validação** (1-2 dias)
   - Testes de regressão
   - Benchmarks comparativos
   - Validação com bases reais grandes

---

## 10. Apêndice: Código de Referência

### 10.1 Interface do PipelineContext Atualizado

```typescript
export interface PipelineContext {
    jobId: number;
    baseContabilId: number;
    baseFiscalId: number;
    configConciliacaoId: number;
    configEstornoId?: number;
    configCancelamentoId?: number;
    reportStage?: (...) => Promise<void>;
    
    // NOVO: Light tables
    lightTableContabil?: string;
    lightTableFiscal?: string;
}
```

### 10.2 Exemplo de CreateLightTableStep

```typescript
import { PipelineStep, PipelineContext } from '../index';
import { Knex } from 'knex';

export class CreateLightTableStep implements PipelineStep {
    readonly name = 'CreateLightTable';

    constructor(
        private readonly db: Knex,
        private readonly lightTableService: LightTableService
    ) {}

    async execute(ctx: PipelineContext): Promise<void> {
        const cfg = await this.db('configs_conciliacao')
            .where({ id: ctx.configConciliacaoId })
            .first();
        
        // Obter colunas necessárias da configuração
        const keysContabil = this.parseKeys(cfg.chaves_contabil);
        const keysFiscal = this.parseKeys(cfg.chaves_fiscal);
        
        // Criar light tables
        ctx.lightTableContabil = await this.lightTableService.createLightTable({
            baseId: ctx.baseContabilId,
            jobId: ctx.jobId,
            keyColumns: keysContabil,
            valueColumn: cfg.coluna_conciliacao_contabil
        });
        
        ctx.lightTableFiscal = await this.lightTableService.createLightTable({
            baseId: ctx.baseFiscalId,
            jobId: ctx.jobId,
            keyColumns: keysFiscal,
            valueColumn: cfg.coluna_conciliacao_fiscal
        });
        
        console.log(`[CreateLightTable] Created: ${ctx.lightTableContabil}, ${ctx.lightTableFiscal}`);
    }
    
    private parseKeys(raw: string): string[] {
        // ... parse logic
    }
}
```

---

**Autor:** GitHub Copilot  
**Última atualização:** 28/01/2026
