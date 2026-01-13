import { PipelineStep, PipelineContext } from '../index';
import { Knex } from 'knex';
import { totalmem } from 'os';
import baseColumnsRepo from '../../../repos/baseColumnsRepository';

/*
    Normalize empty/null cells in Base B table according to T52 rules:
    - monetary empty -> 0.00
    - numeric empty -> NULL
    - text empty -> NULL

    Monetary columns detected by name heuristics (e.g. 'valor', 'vlr', 'amount', 'preco', 'price', 'total').
    
    Performance optimizations for large tables (800k+ rows):
    - Uses direct SQL UPDATE with CASE expressions instead of row-by-row batches
    - Groups columns by type (monetary vs non-monetary) to minimize queries
    - Processes in batches of columns rather than batches of rows
    - Single transaction for all updates
    - Dynamic batch sizes based on available RAM
*/

const IGNORED_COLUMNS = Object.freeze(new Set(['id', 'created_at', 'updated_at']));
const COLUMNS_PER_BATCH = 10; // Number of columns to update in a single query

/**
 * Calculate optimal row batch size based on available RAM.
 */
function getOptimalRowBatchSize(): number {
    const totalRamMB = Math.floor(totalmem() / 1024 / 1024);

    if (totalRamMB < 6000) return 25000;
    if (totalRamMB < 10000) return 50000;
    return 100000;
}

const ROWS_BATCH_SIZE = getOptimalRowBatchSize(); // For very large tables, process in row batches
const LOG_PREFIX = '[NullsBaseB]';

interface BaseRow {
    id: number;
    tabela_sqlite?: string | null;
}

interface ColumnMeta {
    sqlite_name: string;
    is_monetary?: number | null;
}

export class NullsBaseBStep implements PipelineStep {
    readonly name = 'NullsBaseB';

    constructor(private readonly db: Knex) { }

    /**
     * Update multiple columns at once using direct SQL UPDATE.
     * For monetary columns: empty string or NULL -> 0.0
     * For non-monetary columns: empty string -> NULL (already NULL stays NULL)
     */
    private async updateColumnsDirectly(
        trx: Knex.Transaction,
        table: string,
        monetaryColumns: string[],
        nonMonetaryColumns: string[]
    ): Promise<{ monetaryUpdated: number; nonMonetaryUpdated: number }> {
        let monetaryUpdated = 0;
        let nonMonetaryUpdated = 0;

        // Update monetary columns: set NULL or empty to 0.0
        if (monetaryColumns.length > 0) {
            for (let i = 0; i < monetaryColumns.length; i += COLUMNS_PER_BATCH) {
                const batch = monetaryColumns.slice(i, i + COLUMNS_PER_BATCH);

                const setClauses = batch.map(col => {
                    const quotedCol = `"${col}"`;
                    return `${quotedCol} = CASE WHEN ${quotedCol} IS NULL OR ${quotedCol} = '' THEN 0.0 ELSE ${quotedCol} END`;
                }).join(', ');

                const whereConditions = batch.map(col => {
                    const quotedCol = `"${col}"`;
                    return `(${quotedCol} IS NULL OR ${quotedCol} = '')`;
                }).join(' OR ');

                const sql = `UPDATE "${table}" SET ${setClauses} WHERE ${whereConditions}`;
                const result = await trx.raw(sql);
                monetaryUpdated += result?.changes ?? 0;
            }
        }

        // Update non-monetary columns: set empty string to NULL
        if (nonMonetaryColumns.length > 0) {
            for (let i = 0; i < nonMonetaryColumns.length; i += COLUMNS_PER_BATCH) {
                const batch = nonMonetaryColumns.slice(i, i + COLUMNS_PER_BATCH);

                const setClauses = batch.map(col => {
                    const quotedCol = `"${col}"`;
                    return `${quotedCol} = CASE WHEN ${quotedCol} = '' THEN NULL ELSE ${quotedCol} END`;
                }).join(', ');

                const whereConditions = batch.map(col => `"${col}" = ''`).join(' OR ');

                const sql = `UPDATE "${table}" SET ${setClauses} WHERE ${whereConditions}`;
                const result = await trx.raw(sql);
                nonMonetaryUpdated += result?.changes ?? 0;
            }
        }

        return { monetaryUpdated, nonMonetaryUpdated };
    }

    /**
     * For very large tables, use batched row updates to avoid long locks
     */
    private async updateColumnsBatched(
        trx: Knex.Transaction,
        table: string,
        monetaryColumns: string[],
        nonMonetaryColumns: string[]
    ): Promise<{ monetaryUpdated: number; nonMonetaryUpdated: number }> {
        let monetaryUpdated = 0;
        let nonMonetaryUpdated = 0;

        const maxIdResult = await trx(table).max('id as maxId').first();
        const maxId = maxIdResult?.maxId ?? 0;

        if (maxId === 0) {
            return { monetaryUpdated: 0, nonMonetaryUpdated: 0 };
        }

        for (let startId = 0; startId <= maxId; startId += ROWS_BATCH_SIZE) {
            const endId = startId + ROWS_BATCH_SIZE;

            if (monetaryColumns.length > 0) {
                for (let i = 0; i < monetaryColumns.length; i += COLUMNS_PER_BATCH) {
                    const batch = monetaryColumns.slice(i, i + COLUMNS_PER_BATCH);

                    const setClauses = batch.map(col => {
                        const quotedCol = `"${col}"`;
                        return `${quotedCol} = CASE WHEN ${quotedCol} IS NULL OR ${quotedCol} = '' THEN 0.0 ELSE ${quotedCol} END`;
                    }).join(', ');

                    const whereConditions = batch.map(col => {
                        const quotedCol = `"${col}"`;
                        return `(${quotedCol} IS NULL OR ${quotedCol} = '')`;
                    }).join(' OR ');

                    const sql = `UPDATE "${table}" SET ${setClauses} WHERE id > ${startId} AND id <= ${endId} AND (${whereConditions})`;
                    const result = await trx.raw(sql);
                    monetaryUpdated += result?.changes ?? 0;
                }
            }

            if (nonMonetaryColumns.length > 0) {
                for (let i = 0; i < nonMonetaryColumns.length; i += COLUMNS_PER_BATCH) {
                    const batch = nonMonetaryColumns.slice(i, i + COLUMNS_PER_BATCH);

                    const setClauses = batch.map(col => {
                        const quotedCol = `"${col}"`;
                        return `${quotedCol} = CASE WHEN ${quotedCol} = '' THEN NULL ELSE ${quotedCol} END`;
                    }).join(', ');

                    const whereConditions = batch.map(col => `"${col}" = ''`).join(' OR ');

                    const sql = `UPDATE "${table}" SET ${setClauses} WHERE id > ${startId} AND id <= ${endId} AND (${whereConditions})`;
                    const result = await trx.raw(sql);
                    nonMonetaryUpdated += result?.changes ?? 0;
                }
            }
        }

        return { monetaryUpdated, nonMonetaryUpdated };
    }

    async execute(ctx: PipelineContext): Promise<void> {
        const startTime = Date.now();
        const baseId = ctx.baseFiscalId;

        if (!baseId) {
            console.log(`${LOG_PREFIX} No baseFiscalId in context, skipping`);
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

        const colInfo = await this.db(tableName).columnInfo();
        const columns = Object.keys(colInfo).filter(c => !IGNORED_COLUMNS.has(c));
        if (columns.length === 0) {
            console.log(`${LOG_PREFIX} No columns to process in ${tableName}`);
            return;
        }

        // Get row count to decide on strategy
        const countResult = await this.db(tableName).count('* as cnt').first();
        const rowCount = Number(countResult?.cnt ?? 0);
        console.log(`${LOG_PREFIX} Processing ${columns.length} columns in ${tableName} (${rowCount.toLocaleString()} rows)`);

        // Try to read persisted metadata once
        let metas: ColumnMeta[] = [];
        try {
            metas = await baseColumnsRepo.getColumnsForBase(baseId, { useCache: true, knex: this.db });
        } catch (err) {
            console.warn(`${LOG_PREFIX} Could not load column metadata for base ${baseId}:`, err);
            metas = [];
        }

        // Separate columns by type
        const monetaryColumns: string[] = [];
        const nonMonetaryColumns: string[] = [];

        for (const col of columns) {
            const meta = metas.find(m => m.sqlite_name === col);
            if (meta?.is_monetary === 1) {
                monetaryColumns.push(col);
            } else {
                nonMonetaryColumns.push(col);
            }
        }

        console.log(`${LOG_PREFIX} Columns: ${monetaryColumns.length} monetary, ${nonMonetaryColumns.length} non-monetary`);

        // Use single transaction for all updates
        const result = await this.db.transaction(async trx => {
            // For very large tables (500k+ rows), use batched approach to avoid long locks
            if (rowCount > 500000) {
                console.log(`${LOG_PREFIX} Using batched update strategy for large table`);
                return await this.updateColumnsBatched(trx, tableName, monetaryColumns, nonMonetaryColumns);
            } else {
                return await this.updateColumnsDirectly(trx, tableName, monetaryColumns, nonMonetaryColumns);
            }
        });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`${LOG_PREFIX} Completed in ${elapsed}s - monetary updates: ${result.monetaryUpdated}, non-monetary updates: ${result.nonMonetaryUpdated}`);
    }
}

export default NullsBaseBStep;
