import { PipelineStep, PipelineContext } from '../index';
import { Knex } from 'knex';
import { totalmem } from 'os';

/*
    Estorno step for Base A (contábil).
    Finds pairs (A,B) within the same table where column_sum(A) + column_sum(B) ~= 0
    and inserts conciliacao_marks with group 'Conciliado_Estorno'.
    
    OPTIMIZED v3: 
    - Uses O(n) matching algorithm via soma-indexed lookup instead of O(n²) nested loops
    - Streaming/pagination to avoid loading entire table into memory at once
    - Batch inserts with larger chunks
    - Single timestamp for all marks in a batch
    - Dynamic batch sizes based on available RAM
*/

const LOG_PREFIX = '[EstornoBaseA]';
const GROUP_ESTORNO = 'Conciliado_Estorno' as const;
const STATUS_CONCILIADO = '01_Conciliado' as const;
const GROUP_DOC_ESTORNADOS = 'Documentos estornados' as const;
const STATUS_NAO_AVALIADO = '04_Não Avaliado' as const;
const INSERT_CHUNK = 50; // SQLite SQLITE_LIMIT_COMPOUND_SELECT=500, 6 cols × 50 rows = 300 < 500

/**
 * Calculate optimal page size based on available RAM.
 */
function getOptimalPageSize(): number {
    const totalRamMB = Math.floor(totalmem() / 1024 / 1024);

    if (totalRamMB < 6000) return 5000;
    if (totalRamMB < 10000) return 10000;
    return 20000;
}

const PAGE_SIZE = getOptimalPageSize();
// Precision for soma indexing (to handle floating point)
const SOMA_PRECISION = 100; // 2 decimal places

interface ConfigEstorno {
    readonly id: number;
    readonly base_id: number;
    readonly coluna_a?: string | null;
    readonly coluna_b?: string | null;
    readonly coluna_soma?: string | null;
    readonly limite_zero?: number | null;
}

interface BaseRow {
    readonly id: number;
    readonly tabela_sqlite?: string | null;
}

interface IndexEntry {
    readonly id: number;
    readonly soma: number;
    paired: boolean; // mutable for tracking
}

interface MarkEntry {
    readonly base_id: number;
    readonly row_id: number;
    readonly status: string;
    readonly grupo: string;
    readonly chave: string;
    readonly created_at: ReturnType<Knex['fn']['now']>;
}

export class EstornoBaseAStep implements PipelineStep {
    readonly name = 'EstornoBaseA';

    constructor(private readonly db: Knex) { }

    private async ensureMarksTableExists(): Promise<void> {
        const exists = await this.db.schema.hasTable('conciliacao_marks');
        if (!exists) {
            throw new Error("Missing DB table 'conciliacao_marks'. Run migrations to create required tables.");
        }
    }

    private toStringKey(value: unknown): string {
        if (value === null || value === undefined) return '';
        return String(value);
    }

    /**
     * Round soma to integer key for indexing (handles floating point comparison)
     */
    private somaToKey(soma: number): number {
        return Math.round(soma * SOMA_PRECISION);
    }

    private async chunkInsertMarks(entries: MarkEntry[]): Promise<number> {
        if (entries.length === 0) return 0;

        // Deduplicate entries within the batch (same base_id, row_id, grupo)
        const seen = new Set<string>();
        const uniqueEntries: MarkEntry[] = [];
        for (const entry of entries) {
            const key = `${entry.base_id}|${entry.row_id}|${entry.grupo}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueEntries.push(entry);
            }
        }

        let inserted = 0;
        for (let i = 0; i < uniqueEntries.length; i += INSERT_CHUNK) {
            const slice = uniqueEntries.slice(i, i + INSERT_CHUNK);
            await this.db('conciliacao_marks')
                .insert(slice)
                .onConflict(['base_id', 'row_id', 'grupo'])
                .ignore();
            inserted += slice.length;
        }
        return inserted;
    }

    /**
     * O(n) matching algorithm using soma-indexed lookup
     * For each item in listA, look up items in listB whose soma is approximately -soma
     */
    private matchPairsOptimized(
        listA: IndexEntry[],
        listB: IndexEntry[],
        limiteZero: number
    ): Array<{ aId: number; bId: number }> {
        const pairs: Array<{ aId: number; bId: number }> = [];

        // Build index of listB by rounded soma value
        // Map from somaKey -> list of entries with that soma
        const bBySoma = new Map<number, IndexEntry[]>();
        for (const bItem of listB) {
            const key = this.somaToKey(bItem.soma);
            let arr = bBySoma.get(key);
            if (!arr) {
                arr = [];
                bBySoma.set(key, arr);
            }
            arr.push(bItem);
        }

        // For each item in A, find matching B items
        // We need to check the target key and neighboring keys due to limiteZero tolerance
        const keyTolerance = Math.ceil(limiteZero * SOMA_PRECISION) + 1;

        for (const aItem of listA) {
            if (aItem.paired) continue;

            const targetSoma = -aItem.soma;
            const targetKey = this.somaToKey(targetSoma);

            // Check keys in range [targetKey - keyTolerance, targetKey + keyTolerance]
            let found = false;
            for (let k = targetKey - keyTolerance; k <= targetKey + keyTolerance && !found; k++) {
                const candidates = bBySoma.get(k);
                if (!candidates) continue;

                for (const bItem of candidates) {
                    if (bItem.paired) continue;
                    if (aItem.id === bItem.id) continue;

                    const sum = aItem.soma + bItem.soma;
                    if (Math.abs(sum) <= limiteZero) {
                        aItem.paired = true;
                        bItem.paired = true;
                        pairs.push({ aId: aItem.id, bId: bItem.id });
                        found = true;
                        break;
                    }
                }
            }
        }

        return pairs;
    }

    async execute(ctx: PipelineContext): Promise<void> {
        const startTime = Date.now();
        const cfgId = ctx.configEstornoId;

        if (!cfgId) {
            console.log(`${LOG_PREFIX} No configEstornoId in context, skipping`);
            return;
        }

        const cfg = await this.db<ConfigEstorno>('configs_estorno').where({ id: cfgId }).first();
        if (!cfg) {
            console.log(`${LOG_PREFIX} Config ${cfgId} not found, skipping`);
            return;
        }

        const baseId = ctx.baseContabilId ?? cfg.base_id;
        if (!baseId) {
            console.log(`${LOG_PREFIX} No baseId available, skipping`);
            return;
        }

        const base = await this.db<BaseRow>('bases').where({ id: baseId }).first();
        if (!base?.tabela_sqlite) {
            console.log(`${LOG_PREFIX} Base ${baseId} not found or has no tabela_sqlite, skipping`);
            return;
        }
        const tableName = base.tabela_sqlite;

        const tableExists = await this.db.schema.hasTable(tableName);
        if (!tableExists) {
            console.log(`${LOG_PREFIX} Table ${tableName} does not exist, skipping`);
            return;
        }

        await this.ensureMarksTableExists();

        const colunaA = cfg.coluna_a ?? undefined;
        const colunaB = cfg.coluna_b ?? undefined;
        const colunaSoma = cfg.coluna_soma ?? undefined;
        const limiteZero = Number(cfg.limite_zero ?? 0);

        if (!colunaA || !colunaB || !colunaSoma) {
            console.log(`${LOG_PREFIX} Missing required columns config, skipping`);
            return;
        }

        // Get row count for logging
        const countResult = await this.db(tableName).count('* as cnt').first();
        const rowCount = Number(countResult?.cnt ?? 0);
        console.log(`${LOG_PREFIX} Processing ${rowCount.toLocaleString()} rows from ${tableName}`);

        // Build indexes in memory using pagination
        // Map: key (from colunaA/B) -> list of {id, soma, paired}
        const mapA = new Map<string, IndexEntry[]>();
        const mapB = new Map<string, IndexEntry[]>();

        let lastId = 0;
        let rowsRead = 0;

        while (true) {
            const rows = await this.db
                .select('id', colunaA, colunaB, colunaSoma)
                .from(tableName)
                .where('id', '>', lastId)
                .orderBy('id', 'asc')
                .limit(PAGE_SIZE);

            if (!rows || rows.length === 0) break;

            for (const r of rows) {
                const id = Number(r.id);
                const keyA = this.toStringKey(r[colunaA]);
                const keyB = this.toStringKey(r[colunaB]);
                const soma = Number(r[colunaSoma]) || 0;

                if (keyA) {
                    let arr = mapA.get(keyA);
                    if (!arr) {
                        arr = [];
                        mapA.set(keyA, arr);
                    }
                    arr.push({ id, soma, paired: false });
                }
                if (keyB) {
                    let arr = mapB.get(keyB);
                    if (!arr) {
                        arr = [];
                        mapB.set(keyB, arr);
                    }
                    arr.push({ id, soma, paired: false });
                }
            }

            rowsRead += rows.length;
            lastId = Number(rows[rows.length - 1].id);
            if (rows.length < PAGE_SIZE) break;
        }

        console.log(`${LOG_PREFIX} Built indexes: ${mapA.size} keys in A, ${mapB.size} keys in B`);

        // Process matches using optimized algorithm
        const markEntries: MarkEntry[] = [];
        let groupCounter = 0;
        let pairsFound = 0;
        let unpairedCount = 0;
        const jobIdPart = ctx.jobId ? `${ctx.jobId}_` : '';
        const batchTimestamp = Date.now();
        const nowFn = this.db.fn.now();

        for (const [key, listA] of mapA.entries()) {
            const listB = mapB.get(key);
            if (!listB) continue;

            // Use optimized O(n) matching
            const pairs = this.matchPairsOptimized(listA, listB, limiteZero);
            pairsFound += pairs.length;

            // Create marks for matched pairs
            for (const { aId, bId } of pairs) {
                const chave = `${jobIdPart}${key}_${batchTimestamp}_${groupCounter++}`;

                markEntries.push({
                    base_id: baseId,
                    row_id: aId,
                    status: STATUS_CONCILIADO,
                    grupo: GROUP_ESTORNO,
                    chave,
                    created_at: nowFn
                });
                markEntries.push({
                    base_id: baseId,
                    row_id: bId,
                    status: STATUS_CONCILIADO,
                    grupo: GROUP_ESTORNO,
                    chave,
                    created_at: nowFn
                });
            }

            // Mark unpaired rows as "Documentos estornados"
            for (const aItem of listA) {
                if (aItem.paired) continue;
                const chave = `${jobIdPart}${key}_docest_${batchTimestamp}_${groupCounter++}`;
                markEntries.push({
                    base_id: baseId,
                    row_id: aItem.id,
                    status: STATUS_NAO_AVALIADO,
                    grupo: GROUP_DOC_ESTORNADOS,
                    chave,
                    created_at: nowFn
                });
                unpairedCount++;
            }

            for (const bItem of listB) {
                if (bItem.paired) continue;
                const chave = `${jobIdPart}${key}_docest_${batchTimestamp}_${groupCounter++}`;
                markEntries.push({
                    base_id: baseId,
                    row_id: bItem.id,
                    status: STATUS_NAO_AVALIADO,
                    grupo: GROUP_DOC_ESTORNADOS,
                    chave,
                    created_at: nowFn
                });
                unpairedCount++;
            }

            // Flush periodically to keep memory bounded
            if (markEntries.length >= INSERT_CHUNK * 4) {
                await this.chunkInsertMarks(markEntries);
                markEntries.length = 0;
            }
        }

        // Final flush
        if (markEntries.length > 0) {
            await this.chunkInsertMarks(markEntries);
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`${LOG_PREFIX} Completed in ${elapsed}s - ${pairsFound} pairs matched, ${unpairedCount} unpaired rows marked`);
    }
}

export default EstornoBaseAStep;
