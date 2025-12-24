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

const IGNORED_COLUMNS = new Set(['id', 'created_at', 'updated_at']);
const BATCH_SIZE = 1000;

export class NullsBaseAStep implements PipelineStep {
    name = 'NullsBaseA';

    constructor(private readonly db: Knex) {}
    // Automatic monetary detection removed: rely on persisted metadata (user override)

    private async updateColumnValues(table: string, column: string, replacement: any) {
        // Batch updates to avoid long-running single UPDATEs which may lock SQLite
        const BATCH = BATCH_SIZE;
        await this.db.transaction(async trx => {
            while (true) {
                const ids = await trx(table).whereNull(column).orWhere(column, '').limit(BATCH).pluck('id') as number[];
                if (!ids || ids.length === 0) break;
                await trx(table).whereIn('id', ids).update({ [column]: replacement });
                if (ids.length < BATCH) break;
            }
        });
    }

    async execute(ctx: PipelineContext): Promise<void> {
        const baseId = ctx.baseContabilId;
        if (!baseId) return;

        const base = await this.db('bases').where({ id: baseId }).first();
        if (!base || !base.tabela_sqlite) return;
        const tableName: string = base.tabela_sqlite;

        const tableExists = await this.db.schema.hasTable(tableName);
        if (!tableExists) return;

        const columnInfo = await this.db(tableName).columnInfo();
        if (!columnInfo) return;

        const columns = Object.keys(columnInfo).filter(c => !IGNORED_COLUMNS.has(c));
        if (columns.length === 0) return;

        // fetch persisted column metadata once (if available)
        let metas: any[] = [];
        try {
            metas = await baseColumnsRepo.getColumnsForBase(baseId, { useCache: true, knex: this.db });
        } catch (_) { metas = []; }

        for (const col of columns) {
            
            let isMonetary = false;
            try {
                const meta = metas.find(m => m.sqlite_name === col);
                if (meta && typeof (meta as any).is_monetary !== 'undefined' && meta.is_monetary !== null) {
                    isMonetary = Number((meta as any).is_monetary) === 1;
                } else {
                    // no automatic detection: default to non-monetary when metadata missing
                    isMonetary = false;
                }
            } catch (err) {
                // on error, treat as non-monetary
                isMonetary = false;
            }

            try {
                if (isMonetary) {
                    await this.updateColumnValues(tableName, col, 0.0); // monetary empty -> 0.00
                } else {
                    await this.updateColumnValues(tableName, col, 'NULL');
                }
            } catch (err) {
                // log error minimally; leave system running
                // eslint-disable-next-line no-console
                console.error(`NullsBaseA: failed updating column ${col} on ${tableName}:`, err && (err as Error).message ? (err as Error).message : err);
            }
        }
    }
}

export default NullsBaseAStep;
