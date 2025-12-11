import { PipelineStep, PipelineContext } from '../index';
import { Knex } from 'knex';
import baseColumnsRepo from '../../../repos/baseColumnsRepository';

/*
    Normalize empty/null cells in Base B table according to T52 rules:
    - monetary empty -> 0.00
    - numeric empty -> NULL
    - text empty -> NULL

    Monetary columns detected by name heuristics (e.g. 'valor', 'vlr', 'amount', 'preco', 'price', 'total').
*/

const IGNORED_COLUMNS = new Set(['id', 'created_at', 'updated_at']);

export class NullsBaseBStep implements PipelineStep {
    name = 'NullsBaseB';

    constructor(private readonly db: Knex) {}
    // Automatic monetary detection removed: rely on persisted metadata (user override)

    private async updateNulls(tableName: string, column: string, replacement: any) {
        const BATCH = 1000;
        await this.db.transaction(async trx => {
            while (true) {
                const ids = await trx(tableName).whereNull(column).orWhere(column, '').limit(BATCH).pluck('id') as number[];
                if (!ids || ids.length === 0) break;
                await trx(tableName).whereIn('id', ids).update({ [column]: replacement });
                if (ids.length < BATCH) break;
            }
        });
    }

    async execute(ctx: PipelineContext): Promise<void> {
        const baseId = ctx.baseFiscalId;
        if (!baseId) return;

        const base = await this.db<BaseRow>('bases').where({ id: baseId }).first();
        if (!base || !base.tabela_sqlite) return;
        const tableName = base.tabela_sqlite as string;

        const exists = await this.db.schema.hasTable(tableName);
        if (!exists) return;

        const colInfo = await this.db(tableName).columnInfo();
        if (!colInfo) return;

        const columns = Object.keys(colInfo).filter(c => !IGNORED_COLUMNS.has(c));

        // try to read persisted metadata once
        let metas: any[] = [];
        try { metas = await baseColumnsRepo.getColumnsForBase(baseId, { useCache: true, knex: this.db }); } catch (_) { metas = []; }

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
                isMonetary = false;
            }

            try {
                if (isMonetary) {
                    await this.updateNulls(tableName, col, 0.0); // monetary empty -> 0.00
                } else {
                    await this.updateNulls(tableName, col, 'NULL');
                }
            } catch (err) {
                // eslint-disable-next-line no-console
                console.error(`NullsBaseB: failed updating ${col} on ${tableName}:`, (err as Error).message ?? err);
            }
        }
    }
}

type BaseRow = { id: number; tabela_sqlite?: string | null };

export default NullsBaseBStep;
