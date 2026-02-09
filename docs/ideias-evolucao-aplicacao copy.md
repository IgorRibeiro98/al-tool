# 🚀 Ideias Inovadoras para Performance em Máquinas Fracas

**Data:** 01/02/2026  
**Objetivo:** Otimizações de performance e eficiência para rodar em hardware limitado (4GB RAM, CPU fraca, SSD lento)  
**Contexto:** Complementa `ideias-inovadoras-performance.md` (IDEIAs 1, 3, 5 implementadas). Foco agora em **Conciliação, Atribuição, Estorno, Exportação e UI**.

---

## ✅ Status de Implementação

| # | Ideia | Área | Status |
|---|-------|------|--------|
| 1 | Conciliação Lazy/On-Demand | Conciliação | ⏳ Futura |
| 2 | Index-Only Matching | Conciliação | ⏳ Futura |
| 3 | Atribuição Incremental | Atribuição | ⏳ Futura |
| 4 | Exportação Paginada/Chunk | Exportação | ⏳ Futura |
| 5 | UI Virtual Scrolling | Frontend | ⏳ Futura |
| 6 | SQLite WAL Tuning | Database | ⏳ Futura |
| 7 | Garbage Collection Agressivo | Node.js | ⏳ Futura |
| 8 | Worker Pool Dinâmico | Workers | ⏳ Futura |
| 9 | Compressão LZ4 para Light Tables | Conciliação | ⏳ Futura |
| 10 | Disk-Based Sorting | Conciliação | ⏳ Futura |
| 11 | Progressive Loading UI | Frontend | ⏳ Futura |
| 12 | SQLite VACUUM Incremental | Database | ⏳ Futura |

---

## 📊 Diagnóstico: Gargalos em Máquinas Fracas

### Perfil de Hardware Alvo
- **RAM:** 4-8 GB (sendo 2-4GB para o app)
- **CPU:** 2-4 cores, frequência baixa
- **Disco:** SSD SATA ou HDD
- **SO:** Windows 10/11 ou Linux

### Problemas Atuais em Máquinas Fracas

| Operação | Problema | Sintoma |
|----------|----------|---------|
| Conciliação | Carrega bases inteiras em memória | OOM em bases >500K linhas |
| Atribuição | Precalcula todas as possibilidades | Travamento em bases grandes |
| Exportação | Buffer do XLSX em memória | OOM em exports >100K linhas |
| UI Tabela | Renderiza todas as linhas | Browser trava em >10K linhas |
| SQLite | Configuração padrão | I/O wait alto, locks |

---

## 💡 IDEIA 1: Conciliação Lazy/On-Demand (Sem Carregar Tudo)

## 💡 IDEIA 1: Conciliação Lazy/On-Demand (Sem Carregar Tudo)

### Problema
Conciliação atual carrega Base A e Base B inteiramente na Light Table antes de comparar. Em máquinas com 4GB RAM, bases com >500K linhas causam OOM.

### Solução
**Conciliação por chunks** - carregar apenas o necessário para cada operação, liberando memória progressivamente.

### Implementação

```typescript
// LazyConciliacaoService.ts
interface ConciliacaoChunk {
    offset: number;
    limit: number;
    keyRange: { min: string; max: string };
}

class LazyConciliacaoService {
    private readonly CHUNK_SIZE = 10_000; // Ajustável baseado em RAM disponível
    
    async *conciliarLazy(jobId: number): AsyncGenerator<ConciliacaoResult> {
        // 1. Criar índice de chaves ordenadas (não carrega dados)
        await this.createKeyIndex(jobId);
        
        // 2. Dividir em chunks baseado nas chaves
        const chunks = await this.calculateChunks(jobId);
        
        // 3. Processar chunk por chunk
        for (const chunk of chunks) {
            // Carregar APENAS dados deste chunk
            const baseAChunk = await this.loadChunk('base_a', chunk);
            const baseBChunk = await this.loadChunk('base_b', chunk);
            
            // Conciliar este chunk
            const results = await this.matchChunk(baseAChunk, baseBChunk);
            
            // Salvar resultados
            yield* results;
            
            // IMPORTANTE: Liberar memória explicitamente
            baseAChunk.length = 0;
            baseBChunk.length = 0;
            
            // Forçar GC se disponível
            if (global.gc) global.gc();
        }
    }
    
    private async createKeyIndex(jobId: number): Promise<void> {
        // Criar tabela temporária apenas com chaves + rowid
        await db.raw(`
            CREATE TEMP TABLE _key_index AS
            SELECT rowid, ${keyColumns.join(' || ')} as _key
            FROM light_table_${jobId}
            ORDER BY _key
        `);
        
        // Índice para busca rápida por range
        await db.raw(`CREATE INDEX _idx_key ON _key_index(_key)`);
    }
    
    private async loadChunk(base: string, chunk: ConciliacaoChunk): Promise<Row[]> {
        // Carrega só o chunk necessário via range de chaves
        return db.raw(`
            SELECT * FROM light_table_${jobId}
            WHERE _source = ? AND _key BETWEEN ? AND ?
            ORDER BY _key
        `, [base, chunk.keyRange.min, chunk.keyRange.max]);
    }
}
```

### Otimização de Memória: Range-Based Partitioning

```
Memória Atual (carrega tudo):
┌─────────────────────────────────────────────────┐
│ Base A (500K rows) + Base B (500K rows) = 2GB   │  ❌ OOM
└─────────────────────────────────────────────────┘

Memória Proposta (chunks):
┌───────────┐
│ Chunk 1   │  10K rows = ~40MB
│ A + B     │
└─────┬─────┘
      │ libera
      ▼
┌───────────┐
│ Chunk 2   │  10K rows = ~40MB
│ A + B     │
└─────┬─────┘
      │ libera
      ▼
     ...
```

### Configuração Dinâmica por RAM

```typescript
function calculateOptimalChunkSize(): number {
    const totalRam = os.totalmem();
    const freeRam = os.freemem();
    const targetUsage = Math.min(freeRam * 0.5, 500 * 1024 * 1024); // Max 500MB
    
    const avgRowSize = 2048; // ~2KB por linha (estimativa)
    const rowsPerChunk = Math.floor(targetUsage / (avgRowSize * 2)); // x2 para A+B
    
    return Math.max(1000, Math.min(50000, rowsPerChunk));
}
```

### Ganhos Esperados
| Cenário | RAM Atual | RAM Proposta | Status |
|---------|-----------|--------------|--------|
| 100K linhas | 400MB | 80MB | ✅ OK |
| 500K linhas | 2GB | 80MB | ✅ OK |
| 1M linhas | 4GB (OOM) | 80MB | ✅ OK |

### Prioridade: ⭐⭐⭐⭐⭐ (Crítica)
### Esforço: Médio (2-3 semanas)

---

## 💡 IDEIA 2: Index-Only Matching (Evitar Full Scan)

### Problema
Matching atual faz scan completo da Base B para cada linha da Base A. Em bases grandes, é O(n×m).

### Solução
Usar **índices de hash** para matching O(1) por chave, sem carregar dados completos.

### Implementação

```typescript
// IndexOnlyMatcher.ts
class IndexOnlyMatcher {
    async createHashIndex(jobId: number): Promise<void> {
        // Criar tabela de hash apenas com chave → rowid
        // Muito mais leve que dados completos
        await db.raw(`
            CREATE TABLE hash_index_a_${jobId} (
                key_hash BLOB PRIMARY KEY,  -- Hash da chave (8 bytes)
                rowid INTEGER,
                valor REAL                   -- Só o valor, não todos os campos
            ) WITHOUT ROWID
        `);
        
        // Inserir hashes (usa muito menos RAM que dados)
        await db.raw(`
            INSERT INTO hash_index_a_${jobId}
            SELECT 
                sha1(${keyColumns.join(' || ')}) as key_hash,
                rowid,
                ${valorColumn}
            FROM light_table_${jobId}
            WHERE _source = 'A'
        `);
    }
    
    async matchWithIndex(jobId: number): Promise<void> {
        // Matching usando apenas índice - O(n) não O(n×m)
        await db.raw(`
            INSERT INTO conciliacao_marks
            SELECT 
                a.rowid as base_a_id,
                b.rowid as base_b_id,
                CASE 
                    WHEN a.valor = b.valor THEN '01_Conciliado'
                    ELSE '02_Diferença'
                END as status
            FROM hash_index_a_${jobId} a
            INNER JOIN hash_index_b_${jobId} b ON a.key_hash = b.key_hash
        `);
    }
}
```

### Comparativo de Memória

```
Approach Atual:
- Load Base A: 500K × 50 colunas × 50 bytes = 1.25GB
- Load Base B: 500K × 50 colunas × 50 bytes = 1.25GB
- Total: 2.5GB

Approach Index-Only:
- Hash Index A: 500K × (8 + 4 + 8) bytes = 10MB
- Hash Index B: 500K × (8 + 4 + 8) bytes = 10MB
- Total: 20MB  (125x menos!)
```

### Ganhos Esperados
- **125x menos memória** durante matching
- **10x mais rápido** (índice B-tree vs scan)
- **Permite bases ilimitadas** (limitado apenas por disco)

### Prioridade: ⭐⭐⭐⭐⭐ (Crítica)
### Esforço: Médio (2 semanas)

---

## 💡 IDEIA 3: Atribuição Incremental (Processar sob Demanda)

### Problema
Atribuição atual precalcula todas as combinações possíveis de chaves. Em bases grandes, explode memória.

### Solução
**Atribuição lazy** - processar apenas linhas visualizadas/solicitadas.

### Implementação

```typescript
// IncrementalAtribuicaoService.ts
class IncrementalAtribuicaoService {
    // Cache LRU para evitar recálculos
    private cache = new LRUCache<string, AtribuicaoResult>({ max: 10000 });
    
    async atribuirPagina(
        runId: number, 
        offset: number, 
        limit: number
    ): Promise<AtribuicaoResult[]> {
        // 1. Buscar apenas linhas da página
        const linhas = await this.getLinhasPagina(runId, offset, limit);
        
        // 2. Verificar cache
        const results: AtribuicaoResult[] = [];
        const toProcess: typeof linhas = [];
        
        for (const linha of linhas) {
            const cached = this.cache.get(linha.id);
            if (cached) {
                results.push(cached);
            } else {
                toProcess.push(linha);
            }
        }
        
        // 3. Processar apenas não-cacheadas
        for (const linha of toProcess) {
            const result = await this.processarLinha(linha);
            this.cache.set(linha.id, result);
            results.push(result);
        }
        
        return results;
    }
    
    // Processa UMA linha por vez (memória constante)
    private async processarLinha(linha: Row): Promise<AtribuicaoResult> {
        const chaves = this.extrairChaves(linha);
        
        // Busca match na base B usando índice
        const match = await db('base_b_index')
            .where('key_hash', this.hashKey(chaves))
            .first();
        
        return {
            linhaId: linha.id,
            matchId: match?.rowid,
            status: match ? 'matched' : 'not_found'
        };
    }
}
```

### Comparativo

```
Atribuição Atual (Batch):
- Carrega: 500K linhas Base A + 500K linhas Base B
- Memória: 2GB+
- Tempo: 10 min (mas tudo de uma vez)

Atribuição Incremental:
- Carrega: 100 linhas por página
- Memória: <10MB constante
- Tempo: 50ms por página (sob demanda)
```

### Ganhos Esperados
- **Memória constante** independente do tamanho da base
- **Resposta instantânea** para primeira página
- **Cache inteligente** evita reprocessamento

### Prioridade: ⭐⭐⭐⭐ (Alta)
### Esforço: Médio (2 semanas)

---

## 💡 IDEIA 4: Exportação Paginada/Streaming Real

### Problema
ExcelJS atual mantém todo o workbook em memória antes de salvar. Em exports >100K linhas, OOM.

### Solução
**Streaming verdadeiro** - escrever diretamente no disco, página por página.

### Implementação

```typescript
// StreamingExportService.ts
import { stream } from 'exceljs';

class StreamingExportService {
    async exportarStreaming(jobId: number, outputPath: string): Promise<void> {
        // Workbook streaming - escreve direto no disco
        const options = {
            filename: outputPath,
            useStyles: false,           // Desabilitar estilos = 2x mais rápido
            useSharedStrings: false,    // Menos memória
        };
        
        const workbook = new stream.xlsx.WorkbookWriter(options);
        const sheet = workbook.addWorksheet('Resultado');
        
        // Headers
        const columns = await this.getColumns(jobId);
        sheet.columns = columns.map(c => ({ header: c.name, key: c.name }));
        
        // Streaming de dados - NUNCA carrega tudo
        const PAGE_SIZE = 5000;
        let offset = 0;
        let hasMore = true;
        
        while (hasMore) {
            const rows = await this.getRowsPage(jobId, offset, PAGE_SIZE);
            
            for (const row of rows) {
                sheet.addRow(row).commit(); // commit() libera da memória!
            }
            
            offset += PAGE_SIZE;
            hasMore = rows.length === PAGE_SIZE;
            
            // Log progresso
            this.emit('progress', { exported: offset });
        }
        
        await sheet.commit();
        await workbook.commit(); // Finaliza arquivo
    }
    
    private async getRowsPage(
        jobId: number, 
        offset: number, 
        limit: number
    ): Promise<Row[]> {
        return db.raw(`
            SELECT * FROM conciliacao_results_${jobId}
            LIMIT ? OFFSET ?
        `, [limit, offset]);
    }
}
```

### Comparativo de Memória

```
ExcelJS Normal:
┌─────────────────────────────────┐
│ workbook.xlsx.writeBuffer()     │
│ Carrega 500K rows = 2GB RAM     │
└─────────────────────────────────┘

ExcelJS Streaming:
┌─────────────────────────────────┐
│ stream.xlsx.WorkbookWriter      │
│ 5K rows por vez = 20MB RAM      │  ✅ 100x menos!
│ commit() libera memória         │
└─────────────────────────────────┘
```

### Otimização Extra: Desabilitar Formatação

```typescript
const options = {
    useStyles: false,           // -30% tempo
    useSharedStrings: false,    // -20% memória
    zip: {
        compression: 'DEFLATE',
        compressionOptions: { level: 1 } // Compressão rápida
    }
};
```

### Ganhos Esperados
- **Memória constante** (~20-50MB) independente do tamanho
- **2x mais rápido** sem formatação
- **Permite exports ilimitados** (apenas limitado por disco)

### Prioridade: ⭐⭐⭐⭐⭐ (Crítica)
### Esforço: Baixo (1 semana)

---

## 💡 IDEIA 5: UI Virtual Scrolling (Renderizar Apenas Visível)

### Problema
Tabelas React renderizam todas as linhas. Em bases >10K linhas, browser trava.

### Solução
**Virtual scrolling** - renderizar apenas linhas visíveis na viewport.

### Implementação com TanStack Virtual

```tsx
// VirtualTable.tsx
import { useVirtualizer } from '@tanstack/react-virtual';

interface VirtualTableProps {
    data: Row[];
    columns: Column[];
    rowHeight: number;
}

export function VirtualTable({ data, columns, rowHeight = 35 }: VirtualTableProps) {
    const parentRef = useRef<HTMLDivElement>(null);
    
    const virtualizer = useVirtualizer({
        count: data.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => rowHeight,
        overscan: 10, // Render 10 extra rows for smooth scrolling
    });
    
    const virtualRows = virtualizer.getVirtualItems();
    
    return (
        <div 
            ref={parentRef} 
            style={{ height: '600px', overflow: 'auto' }}
        >
            {/* Spacer for total height */}
            <div style={{ height: virtualizer.getTotalSize() }}>
                {/* Only visible rows */}
                <div style={{ 
                    transform: `translateY(${virtualRows[0]?.start ?? 0}px)` 
                }}>
                    {virtualRows.map(virtualRow => {
                        const row = data[virtualRow.index];
                        return (
                            <TableRow 
                                key={virtualRow.key}
                                data={row}
                                columns={columns}
                                style={{ height: rowHeight }}
                            />
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
```

### Comparativo de DOM Nodes

```
Renderização Normal (100K linhas):
- DOM Nodes: 100.000 × 10 colunas = 1.000.000 nodes
- RAM Browser: 2GB+
- FPS: 5 (travando)

Virtual Scrolling (100K linhas):
- DOM Nodes: 30 visíveis × 10 colunas = 300 nodes
- RAM Browser: 50MB
- FPS: 60 (fluido)
```

### Server-Side Pagination Integrada

```tsx
// Para datasets MUITO grandes, combinar com paginação server-side
function VirtualTableServerPaginated({ jobId }: { jobId: number }) {
    const [pages, setPages] = useState<Map<number, Row[]>>(new Map());
    const PAGE_SIZE = 100;
    
    const fetchPage = useCallback(async (pageIndex: number) => {
        if (pages.has(pageIndex)) return;
        
        const data = await api.get(`/results/${jobId}`, {
            params: { offset: pageIndex * PAGE_SIZE, limit: PAGE_SIZE }
        });
        
        setPages(prev => new Map(prev).set(pageIndex, data));
    }, [jobId, pages]);
    
    // Fetch pages on scroll
    const onScroll = useCallback((e: React.UIEvent) => {
        const scrollTop = e.currentTarget.scrollTop;
        const visiblePageStart = Math.floor(scrollTop / (PAGE_SIZE * 35));
        
        // Prefetch current and next page
        fetchPage(visiblePageStart);
        fetchPage(visiblePageStart + 1);
    }, [fetchPage]);
    
    // ...
}
```

### Ganhos Esperados
- **99.97% menos DOM nodes** (300 vs 1M)
- **60 FPS** mesmo com 1M linhas
- **Memória constante** no browser

### Prioridade: ⭐⭐⭐⭐⭐ (Crítica)
### Esforço: Médio (2 semanas)

---

## 💡 IDEIA 6: SQLite WAL + PRAGMA Tuning para SSD/HDD

### Problema
SQLite padrão usa configurações conservadoras. Em máquinas fracas com HDD, I/O é gargalo.

### Solução
**Tuning agressivo** de PRAGMAs baseado no hardware detectado.

### Implementação

```typescript
// SqliteTuning.ts
async function tuneSqliteForHardware(db: Knex): Promise<void> {
    const diskInfo = await detectDiskType();
    const ramInfo = await detectRamSize();
    
    // WAL mode - sempre melhor para concorrência
    await db.raw('PRAGMA journal_mode = WAL');
    
    if (diskInfo.isSSD) {
        // SSD: Pode ser mais agressivo
        await db.raw('PRAGMA synchronous = NORMAL');    // Menos fsync
        await db.raw('PRAGMA wal_autocheckpoint = 10000'); // Checkpoint maior
        await db.raw(`PRAGMA cache_size = -${Math.min(ramInfo.free * 0.25, 512 * 1024)}`); // 25% RAM livre, max 512MB
        await db.raw('PRAGMA temp_store = MEMORY');
        await db.raw('PRAGMA mmap_size = 1073741824');  // 1GB mmap
    } else {
        // HDD: Balancear segurança e performance
        await db.raw('PRAGMA synchronous = NORMAL');
        await db.raw('PRAGMA wal_autocheckpoint = 1000');
        await db.raw(`PRAGMA cache_size = -${Math.min(ramInfo.free * 0.15, 256 * 1024)}`); // 15% RAM, max 256MB
        await db.raw('PRAGMA temp_store = FILE');       // Temp em disco (salva RAM)
        await db.raw('PRAGMA mmap_size = 268435456');   // 256MB mmap
    }
    
    // Comum
    await db.raw('PRAGMA busy_timeout = 30000');        // 30s timeout
    await db.raw('PRAGMA foreign_keys = OFF');          // Desabilitar FK check
    await db.raw('PRAGMA auto_vacuum = INCREMENTAL');   // Vacuum gradual
}

async function detectDiskType(): Promise<{ isSSD: boolean }> {
    try {
        // Linux: checar rotational
        const rotational = await fs.readFile(
            '/sys/block/sda/queue/rotational', 
            'utf8'
        );
        return { isSSD: rotational.trim() === '0' };
    } catch {
        // Windows ou fallback: assumir HDD para ser seguro
        return { isSSD: false };
    }
}
```

### Batch Insert Otimizado

```typescript
// Inserção em batch com transação única
async function bulkInsertOptimized(
    db: Knex, 
    table: string, 
    rows: Row[]
): Promise<void> {
    const BATCH_SIZE = 500; // SQLite limit de variáveis
    
    await db.transaction(async trx => {
        // Desabilitar índices temporariamente
        const indexes = await getIndexes(trx, table);
        for (const idx of indexes) {
            await trx.raw(`DROP INDEX IF EXISTS ${idx.name}`);
        }
        
        // Insert em batches
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const batch = rows.slice(i, i + BATCH_SIZE);
            await trx(table).insert(batch);
        }
        
        // Recriar índices (mais rápido que manter durante insert)
        for (const idx of indexes) {
            await trx.raw(idx.createSql);
        }
    });
}
```

### Ganhos Esperados

| Config | Insert 100K | Select 100K | RAM |
|--------|-------------|-------------|-----|
| Default | 45s | 8s | 50MB |
| Tuned SSD | 12s | 3s | 200MB |
| Tuned HDD | 25s | 5s | 150MB |

### Prioridade: ⭐⭐⭐⭐ (Alta)
### Esforço: Baixo (3-5 dias)

---

## 💡 IDEIA 7: Garbage Collection Agressivo + Memory Profiling

### Problema
Node.js não libera memória imediatamente. Em operações longas, memória acumula.

### Solução
**GC manual** em pontos estratégicos + **monitoramento proativo**.

### Implementação

```typescript
// MemoryManager.ts
class MemoryManager {
    private readonly threshold = 0.8; // 80% do heap limit
    
    async withMemoryManagement<T>(
        operation: () => Promise<T>,
        operationName: string
    ): Promise<T> {
        const startHeap = process.memoryUsage().heapUsed;
        
        try {
            return await operation();
        } finally {
            const endHeap = process.memoryUsage().heapUsed;
            const delta = endHeap - startHeap;
            
            console.log(`[Memory] ${operationName}: ${formatBytes(delta)} delta`);
            
            // Se usou muita memória, forçar GC
            if (delta > 100 * 1024 * 1024) { // 100MB
                await this.forceGC();
            }
        }
    }
    
    async forceGC(): Promise<void> {
        if (global.gc) {
            global.gc();
            // Aguardar GC completar
            await new Promise(resolve => setImmediate(resolve));
            console.log('[Memory] GC forçado executado');
        }
    }
    
    async checkMemoryPressure(): Promise<'ok' | 'warning' | 'critical'> {
        const usage = process.memoryUsage();
        const heapLimit = v8.getHeapStatistics().heap_size_limit;
        const ratio = usage.heapUsed / heapLimit;
        
        if (ratio > 0.9) return 'critical';
        if (ratio > 0.7) return 'warning';
        return 'ok';
    }
    
    async waitForMemory(requiredMB: number): Promise<void> {
        while (true) {
            const free = v8.getHeapStatistics().heap_size_limit - 
                         process.memoryUsage().heapUsed;
            
            if (free > requiredMB * 1024 * 1024) break;
            
            console.log(`[Memory] Aguardando ${requiredMB}MB livres...`);
            await this.forceGC();
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
}

// Uso em operações pesadas
const memoryManager = new MemoryManager();

async function processarConciliacao(jobId: number) {
    for (const chunk of chunks) {
        await memoryManager.withMemoryManagement(
            () => processChunk(chunk),
            `Chunk ${chunk.id}`
        );
        
        // Verificar pressão de memória
        const pressure = await memoryManager.checkMemoryPressure();
        if (pressure === 'critical') {
            console.warn('Memória crítica! Reduzindo batch size...');
            // Reduzir batch size dinamicamente
        }
    }
}
```

### Node.js Flag Necessária

```bash
# Habilitar GC manual
node --expose-gc src/index.js
```

### Monitoramento Contínuo

```typescript
// Monitor em background
setInterval(async () => {
    const usage = process.memoryUsage();
    
    metrics.gauge('heap_used', usage.heapUsed);
    metrics.gauge('heap_total', usage.heapTotal);
    metrics.gauge('rss', usage.rss);
    metrics.gauge('external', usage.external);
    
    // Log se acima de threshold
    const ratio = usage.heapUsed / v8.getHeapStatistics().heap_size_limit;
    if (ratio > 0.7) {
        console.warn(`[Memory] Uso alto: ${(ratio * 100).toFixed(1)}%`);
    }
}, 10000);
```

### Ganhos Esperados
- **Previne OOM** em operações longas
- **Libera memória proativamente**
- **Visibilidade** de uso de memória

### Prioridade: ⭐⭐⭐⭐ (Alta)
### Esforço: Baixo (1 semana)

---

## 💡 IDEIA 8: Worker Pool Dinâmico Baseado em CPU/RAM

### Problema
Worker pool fixo pode sobrecarregar máquinas fracas ou subutilizar máquinas fortes.

### Solução
**Pool dinâmico** que ajusta workers baseado em recursos disponíveis.

### Implementação

```typescript
// DynamicWorkerPool.ts
import { Worker } from 'worker_threads';
import os from 'os';

interface PoolConfig {
    minWorkers: number;
    maxWorkers: number;
    memoryPerWorkerMB: number;
    cpuThreshold: number; // % CPU para adicionar worker
}

class DynamicWorkerPool {
    private workers: Worker[] = [];
    private config: PoolConfig;
    private queue: Task[] = [];
    
    constructor(workerPath: string, config?: Partial<PoolConfig>) {
        this.config = {
            minWorkers: 1,
            maxWorkers: Math.max(1, os.cpus().length - 1),
            memoryPerWorkerMB: 256,
            cpuThreshold: 80,
            ...config
        };
        
        // Calcular workers iniciais baseado em RAM
        const availableRam = os.freemem() / (1024 * 1024);
        const maxByRam = Math.floor(availableRam / this.config.memoryPerWorkerMB);
        const initialWorkers = Math.min(
            this.config.maxWorkers,
            Math.max(this.config.minWorkers, maxByRam)
        );
        
        this.spawnWorkers(initialWorkers);
        this.startMonitor();
    }
    
    private async startMonitor() {
        setInterval(async () => {
            const cpuUsage = await this.getCpuUsage();
            const memUsage = 1 - (os.freemem() / os.totalmem());
            
            // Ajustar pool dinamicamente
            if (cpuUsage < 50 && memUsage < 0.6 && this.queue.length > 0) {
                // Recursos livres e tasks pendentes: adicionar worker
                if (this.workers.length < this.config.maxWorkers) {
                    this.spawnWorker();
                    console.log(`[Pool] +1 worker (total: ${this.workers.length})`);
                }
            } else if (cpuUsage > 90 || memUsage > 0.85) {
                // Sobrecarga: remover worker
                if (this.workers.length > this.config.minWorkers) {
                    this.removeWorker();
                    console.log(`[Pool] -1 worker (total: ${this.workers.length})`);
                }
            }
        }, 5000);
    }
    
    private async getCpuUsage(): Promise<number> {
        const start = os.cpus();
        await new Promise(resolve => setTimeout(resolve, 100));
        const end = os.cpus();
        
        let totalDiff = 0;
        let idleDiff = 0;
        
        for (let i = 0; i < start.length; i++) {
            const startTotal = Object.values(start[i].times).reduce((a, b) => a + b);
            const endTotal = Object.values(end[i].times).reduce((a, b) => a + b);
            
            totalDiff += endTotal - startTotal;
            idleDiff += end[i].times.idle - start[i].times.idle;
        }
        
        return 100 - (idleDiff / totalDiff * 100);
    }
    
    async execute<T>(task: () => T): Promise<T> {
        // Adicionar à fila e processar quando worker disponível
        return new Promise((resolve, reject) => {
            this.queue.push({ task, resolve, reject });
            this.processQueue();
        });
    }
}
```

### Configuração por Perfil de Hardware

```typescript
function getPoolConfigForHardware(): PoolConfig {
    const cpus = os.cpus().length;
    const ram = os.totalmem() / (1024 * 1024 * 1024); // GB
    
    if (ram <= 4) {
        // Máquina fraca
        return {
            minWorkers: 1,
            maxWorkers: Math.min(2, cpus - 1),
            memoryPerWorkerMB: 128,
            cpuThreshold: 70
        };
    } else if (ram <= 8) {
        // Máquina média
        return {
            minWorkers: 2,
            maxWorkers: Math.min(4, cpus - 1),
            memoryPerWorkerMB: 256,
            cpuThreshold: 80
        };
    } else {
        // Máquina potente
        return {
            minWorkers: 4,
            maxWorkers: cpus - 1,
            memoryPerWorkerMB: 512,
            cpuThreshold: 85
        };
    }
}
```

### Ganhos Esperados
- **Adaptação automática** a qualquer hardware
- **Máximo throughput** sem sobrecarga
- **Prevenção de OOM** por workers demais

### Prioridade: ⭐⭐⭐ (Média)
### Esforço: Médio (2 semanas)

---

## 💡 IDEIA 9: Compressão LZ4 para Light Tables

### Problema
Light Tables ocupam muito espaço em disco e RAM. I/O é gargalo em HDD.

### Solução
Usar **LZ4** (compressão ultra-rápida) para dados da Light Table.

### Implementação

```typescript
// CompressedLightTable.ts
import lz4 from 'lz4';

class CompressedLightTable {
    async createCompressed(jobId: number, data: Row[]): Promise<void> {
        const CHUNK_SIZE = 10000;
        
        for (let i = 0; i < data.length; i += CHUNK_SIZE) {
            const chunk = data.slice(i, i + CHUNK_SIZE);
            
            // Serializar e comprimir
            const json = JSON.stringify(chunk);
            const compressed = lz4.encode(Buffer.from(json));
            
            // Salvar chunk comprimido
            await db('light_table_chunks').insert({
                job_id: jobId,
                chunk_index: i / CHUNK_SIZE,
                data: compressed,
                row_count: chunk.length,
                original_size: json.length,
                compressed_size: compressed.length
            });
        }
    }
    
    async *readCompressedStream(jobId: number): AsyncGenerator<Row[]> {
        const chunks = await db('light_table_chunks')
            .where('job_id', jobId)
            .orderBy('chunk_index');
        
        for (const chunk of chunks) {
            const decompressed = lz4.decode(chunk.data);
            const rows = JSON.parse(decompressed.toString());
            yield rows;
            
            // Liberar memória do chunk
            rows.length = 0;
        }
    }
}
```

### Benchmark LZ4 vs Zlib vs Raw

| Método | Ratio | Compress Speed | Decompress Speed |
|--------|-------|----------------|------------------|
| Raw | 1x | - | - |
| Zlib | 3-5x | 50 MB/s | 200 MB/s |
| **LZ4** | **2-3x** | **500 MB/s** | **2 GB/s** |

### SQLite com Compressão

```sql
-- Usando BLOB comprimido
CREATE TABLE light_table_compressed (
    id INTEGER PRIMARY KEY,
    job_id INTEGER,
    chunk_data BLOB,  -- LZ4 compressed
    row_start INTEGER,
    row_end INTEGER
);

-- Índice para busca rápida por range
CREATE INDEX idx_lt_job_range ON light_table_compressed(job_id, row_start, row_end);
```

### Ganhos Esperados
- **50-70% menos espaço em disco**
- **Leitura mais rápida** (menos I/O)
- **Compressão quase gratuita** (LZ4 é muito rápido)

### Prioridade: ⭐⭐⭐ (Média)
### Esforço: Médio (2 semanas)

---

## 💡 IDEIA 10: Disk-Based Sorting (Ordenação Externa)

### Problema
Ordenação de bases grandes requer carregar tudo em memória. Em bases >1M linhas, OOM.

### Solução
**External merge sort** - ordenar em chunks no disco.

### Implementação

```typescript
// ExternalSortService.ts
class ExternalSortService {
    private readonly CHUNK_SIZE = 50000; // Linhas por chunk
    private readonly TEMP_DIR = '/tmp/sort_chunks';
    
    async sortLargeTable(
        tableName: string, 
        orderBy: string[]
    ): Promise<void> {
        await fs.mkdir(this.TEMP_DIR, { recursive: true });
        
        // Fase 1: Dividir em chunks ordenados
        const chunkFiles = await this.createSortedChunks(tableName, orderBy);
        
        // Fase 2: Merge K-way dos chunks
        await this.mergeChunks(chunkFiles, tableName, orderBy);
        
        // Cleanup
        await fs.rm(this.TEMP_DIR, { recursive: true });
    }
    
    private async createSortedChunks(
        tableName: string, 
        orderBy: string[]
    ): Promise<string[]> {
        const chunkFiles: string[] = [];
        let offset = 0;
        let chunkIndex = 0;
        
        while (true) {
            // Ler chunk
            const chunk = await db(tableName)
                .orderBy(orderBy.map(col => ({ column: col })))
                .limit(this.CHUNK_SIZE)
                .offset(offset);
            
            if (chunk.length === 0) break;
            
            // Escrever chunk ordenado em arquivo temp
            const chunkFile = path.join(this.TEMP_DIR, `chunk_${chunkIndex}.json`);
            await fs.writeFile(chunkFile, JSON.stringify(chunk));
            chunkFiles.push(chunkFile);
            
            offset += this.CHUNK_SIZE;
            chunkIndex++;
        }
        
        return chunkFiles;
    }
    
    private async mergeChunks(
        chunkFiles: string[], 
        tableName: string,
        orderBy: string[]
    ): Promise<void> {
        // Usar SQLite para merge (mais eficiente)
        await db.raw(`DELETE FROM ${tableName}`);
        
        // Criar tabela temp para cada chunk
        for (let i = 0; i < chunkFiles.length; i++) {
            const chunk = JSON.parse(await fs.readFile(chunkFiles[i], 'utf8'));
            await db(`_merge_chunk_${i}`).insert(chunk);
        }
        
        // UNION ALL com ORDER BY - SQLite faz merge sort
        const unionQuery = chunkFiles
            .map((_, i) => `SELECT * FROM _merge_chunk_${i}`)
            .join(' UNION ALL ');
        
        await db.raw(`
            INSERT INTO ${tableName}
            SELECT * FROM (${unionQuery})
            ORDER BY ${orderBy.join(', ')}
        `);
        
        // Cleanup temp tables
        for (let i = 0; i < chunkFiles.length; i++) {
            await db.raw(`DROP TABLE _merge_chunk_${i}`);
        }
    }
}
```

### Alternativa: Usar SQLite ORDER BY com Temp Files

```typescript
// SQLite já faz external sort automaticamente!
// Basta configurar temp_store para FILE
await db.raw('PRAGMA temp_store = FILE');
await db.raw('PRAGMA temp_store_directory = "/tmp"');

// Agora ORDER BY de tabelas grandes usa disco automaticamente
const sorted = await db('huge_table').orderBy('column1').orderBy('column2');
```

### Ganhos Esperados
- **Permite ordenar tabelas de qualquer tamanho**
- **Memória constante** (~50MB para chunks)
- **Usa disco como swap** (SSD recomendado)

### Prioridade: ⭐⭐⭐ (Média)
### Esforço: Médio (2 semanas)

---

## 💡 IDEIA 11: Progressive Loading UI

### Problema
Telas esperam carregamento completo antes de mostrar qualquer coisa. Usuário vê loader por muito tempo.

### Solução
**Loading progressivo** - mostrar dados assim que chegam.

### Implementação React

```tsx
// ProgressiveResultsTable.tsx
function ProgressiveResultsTable({ jobId }: { jobId: number }) {
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [progress, setProgress] = useState({ loaded: 0, total: 0 });
    
    useEffect(() => {
        const eventSource = new EventSource(`/api/results/${jobId}/stream`);
        
        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            if (data.type === 'progress') {
                setProgress(data);
            } else if (data.type === 'rows') {
                // Append rows progressivamente
                setRows(prev => [...prev, ...data.rows]);
            } else if (data.type === 'done') {
                setLoading(false);
                eventSource.close();
            }
        };
        
        return () => eventSource.close();
    }, [jobId]);
    
    return (
        <div>
            {/* Mostra dados assim que chegam */}
            <VirtualTable data={rows} columns={columns} />
            
            {/* Progress bar */}
            {loading && (
                <ProgressBar 
                    value={progress.loaded} 
                    max={progress.total}
                    label={`Carregando: ${progress.loaded}/${progress.total}`}
                />
            )}
        </div>
    );
}
```

### Backend SSE (Server-Sent Events)

```typescript
// resultsStream.ts
app.get('/api/results/:jobId/stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const jobId = req.params.jobId;
    const PAGE_SIZE = 1000;
    
    // Contar total
    const [{ count }] = await db('results').where('job_id', jobId).count();
    res.write(`data: ${JSON.stringify({ type: 'progress', loaded: 0, total: count })}\n\n`);
    
    // Stream em páginas
    let offset = 0;
    while (offset < count) {
        const rows = await db('results')
            .where('job_id', jobId)
            .limit(PAGE_SIZE)
            .offset(offset);
        
        res.write(`data: ${JSON.stringify({ type: 'rows', rows })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'progress', loaded: offset + rows.length, total: count })}\n\n`);
        
        offset += PAGE_SIZE;
    }
    
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
});
```

### Ganhos Esperados
- **Time to first content: <500ms** (antes: aguardar 100% carregar)
- **Percepção de velocidade** muito melhor
- **Feedback contínuo** de progresso

### Prioridade: ⭐⭐⭐ (Média)
### Esforço: Médio (2 semanas)

---

## 💡 IDEIA 12: SQLite VACUUM Incremental

### Problema
VACUUM tradicional cria cópia do banco inteiro. Em bancos grandes, dobra uso de disco e trava.

### Solução
**VACUUM incremental** - libera espaço gradualmente.

### Implementação

```typescript
// IncrementalVacuumService.ts
class IncrementalVacuumService {
    async setup(db: Knex): Promise<void> {
        // Habilitar auto_vacuum incremental
        await db.raw('PRAGMA auto_vacuum = INCREMENTAL');
    }
    
    async vacuumIncremental(db: Knex, pages: number = 100): Promise<void> {
        // Libera N páginas por vez (não trava o banco)
        await db.raw(`PRAGMA incremental_vacuum(${pages})`);
    }
    
    async schedulePeriodicVacuum(db: Knex): void {
        // Executar a cada 5 minutos durante idle
        setInterval(async () => {
            // Só vacuum se não houver queries ativas
            if (await this.isDatabaseIdle(db)) {
                await this.vacuumIncremental(db, 50);
            }
        }, 5 * 60 * 1000);
    }
    
    async getFragmentationStats(db: Knex): Promise<{
        pageCount: number;
        freePages: number;
        fragmentationPercent: number;
    }> {
        const [[{ page_count }]] = await db.raw('PRAGMA page_count');
        const [[{ freelist_count }]] = await db.raw('PRAGMA freelist_count');
        
        return {
            pageCount: page_count,
            freePages: freelist_count,
            fragmentationPercent: (freelist_count / page_count) * 100
        };
    }
    
    async shouldVacuum(db: Knex): Promise<boolean> {
        const stats = await this.getFragmentationStats(db);
        return stats.fragmentationPercent > 10; // Vacuum se >10% fragmentado
    }
}
```

### Comparativo

```
VACUUM tradicional (banco 2GB):
- Tempo: 60s
- Disco extra: 2GB (cópia completa)
- Banco travado: Sim

VACUUM incremental (banco 2GB):
- Tempo: 100ms (por batch de 100 páginas)
- Disco extra: 0
- Banco travado: Não (pode continuar queries)
```

### Ganhos Esperados
- **Zero downtime** durante vacuum
- **Sem disco extra** necessário
- **Fragmentação controlada** automaticamente

### Prioridade: ⭐⭐⭐ (Média)
### Esforço: Baixo (3-5 dias)

---

## 📋 Matriz de Priorização

| # | Ideia | Impacto | Esforço | Foco | Prioridade |
|---|-------|---------|---------|------|------------|
| 2 | Index-Only Matching | ⭐⭐⭐⭐⭐ | Médio | RAM | 🔴 1º |
| 1 | Conciliação Lazy | ⭐⭐⭐⭐⭐ | Médio | RAM | 🔴 2º |
| 4 | Export Streaming | ⭐⭐⭐⭐⭐ | Baixo | RAM | 🔴 3º |
| 5 | Virtual Scrolling UI | ⭐⭐⭐⭐⭐ | Médio | Browser | 🔴 4º |
| 6 | SQLite WAL Tuning | ⭐⭐⭐⭐ | Baixo | I/O | 🟠 5º |
| 7 | GC Agressivo | ⭐⭐⭐⭐ | Baixo | RAM | 🟠 6º |
| 3 | Atribuição Incremental | ⭐⭐⭐⭐ | Médio | RAM | 🟠 7º |
| 11 | Progressive Loading | ⭐⭐⭐ | Médio | UX | 🟡 8º |
| 8 | Worker Pool Dinâmico | ⭐⭐⭐ | Médio | CPU | 🟡 9º |
| 9 | LZ4 Compression | ⭐⭐⭐ | Médio | Disco | 🟡 10º |
| 10 | External Sort | ⭐⭐⭐ | Médio | RAM | 🟡 11º |
| 12 | VACUUM Incremental | ⭐⭐ | Baixo | Disco | 🟢 12º |

---

## 🎯 Impacto Estimado por Perfil de Máquina

### Máquina Fraca (4GB RAM, HDD, 2 cores)

| Cenário | Hoje | Com Otimizações | Melhoria |
|---------|------|-----------------|----------|
| Conciliar 100K linhas | OOM | 2 min | ✅ Possível |
| Conciliar 500K linhas | Impossível | 8 min | ✅ Possível |
| Export 100K linhas | OOM | 30s | ✅ Possível |
| UI com 50K linhas | Trava | 60 FPS | ✅ Fluido |

### Máquina Média (8GB RAM, SSD, 4 cores)

| Cenário | Hoje | Com Otimizações | Melhoria |
|---------|------|-----------------|----------|
| Conciliar 500K linhas | 15 min | 4 min | 3.7x |
| Conciliar 1M linhas | OOM | 10 min | ✅ Possível |
| Export 500K linhas | 5 min | 1 min | 5x |
| UI com 100K linhas | Lento | 60 FPS | ✅ Fluido |

---

## 🗓️ Roadmap de Implementação

### Sprint 1 (Semanas 1-2): Quick Wins
1. ✅ SQLite WAL Tuning (IDEIA 6)
2. ✅ GC Agressivo (IDEIA 7)
3. ✅ VACUUM Incremental (IDEIA 12)

### Sprint 2 (Semanas 3-4): Conciliação
4. Index-Only Matching (IDEIA 2)
5. Conciliação Lazy (IDEIA 1)

### Sprint 3 (Semanas 5-6): Export/UI
6. Export Streaming Real (IDEIA 4)
7. Virtual Scrolling UI (IDEIA 5)

### Sprint 4 (Semanas 7-8): Refinamentos
8. Atribuição Incremental (IDEIA 3)
9. Progressive Loading (IDEIA 11)

### Sprint 5 (Semanas 9-10): Avançado
10. Worker Pool Dinâmico (IDEIA 8)
11. LZ4 Compression (IDEIA 9)
12. External Sort (IDEIA 10)

---

## 📝 Próximos Passos

1. **Benchmark atual** - Medir uso de RAM/CPU em cada operação
2. **Implementar Quick Wins** - PRAGMAs + GC + VACUUM
3. **POC Index-Only** - Testar com base de 1M linhas
4. **Testar em hardware alvo** - Validar em máquina com 4GB RAM

---

*Documento focado em otimizações para máquinas com recursos limitados.*
*Complementa `ideias-inovadoras-performance.md` (pipeline/ingestão).*
*Última atualização: 01/02/2026*
