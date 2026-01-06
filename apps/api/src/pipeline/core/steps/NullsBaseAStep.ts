import { PipelineStep, PipelineContext } from '../index';
import { Knex } from 'knex';
import baseColumnsRepo from '../../../repos/baseColumnsRepository';

/*
    Normalize empty/null cells in Base A table according to T52 rules:
    - monetary empty -> 0.00
    - numeric empty -> NULL
    - text empty -> NULL

    Monetary columns are detected by name heuristics (e.g. containing 'valor', 'vlr', 'amount', 'preco', 'price', 'total').
*/

const IGNORED_COLUMNS = Object.freeze(new Set(['id', 'created_at', 'updated_at']));
const BATCH_SIZE = 1000;
const LOG_PREFIX = '[NullsBaseA]';

interface BaseRow {
    id: number;
    tabela_sqlite?: string | null;
}

export class NullsBaseAStep implements PipelineStep {
    readonly name = 'NullsBaseA';

    constructor(private readonly db: Knex) { }

    private async updateColumnValues(table: string, column: string, replacement: unknown): Promise<void> {
        // Batch updates to avoid long-running single UPDATEs which may lock SQLite
        await this.db.transaction(async trx => {
            let hasMore = true;
            while (hasMore) {
                const ids = await trx(table)
                    .whereNull(column)
                    .orWhere(column, '')
                    .limit(BATCH_SIZE)
                    .pluck('id') as number[];

                if (!ids || ids.length === 0) {
                    hasMore = false;
                    break;
                }

                await trx(table).whereIn('id', ids).update({ [column]: replacement });

                if (ids.length < BATCH_SIZE) {
                    hasMore = false;
                }
            }
        });
    }

    async execute(ctx: PipelineContext): Promise<void> {
        const baseId = ctx.baseContabilId;
        if (!baseId) {
            console.log(`${LOG_PREFIX} No baseContabilId in context, skipping`);
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

        const columnInfo = await this.db(tableName).columnInfo();
        const columns = Object.keys(columnInfo).filter(c => !IGNORED_COLUMNS.has(c));
        if (columns.length === 0) {
            console.log(`${LOG_PREFIX} No columns to process in ${tableName}`);
            return;
        }

        // Fetch persisted column metadata once (if available)
        let metas: Awaited<ReturnType<typeof baseColumnsRepo.getColumnsForBase>> = [];
        try {
            metas = await baseColumnsRepo.getColumnsForBase(baseId, { useCache: true, knex: this.db });
        } catch (err) {
            console.warn(`${LOG_PREFIX} Could not load column metadata for base ${baseId}:`, err);
            metas = [];
        }

        for (const col of columns) {
            const meta = metas.find(m => m.sqlite_name === col);
            const isMonetary = meta?.is_monetary === 1;

            try {
                const replacement = isMonetary ? 0.0 : 'NULL';
                await this.updateColumnValues(tableName, col, replacement);
            } catch (err) {
                console.error(`${LOG_PREFIX} Failed updating column ${col} on ${tableName}:`, err instanceof Error ? err.message : err);
            }
        }
    }
}

export default NullsBaseAStep;
