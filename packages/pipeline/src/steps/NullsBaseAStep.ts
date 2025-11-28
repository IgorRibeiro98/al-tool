import { PipelineStep, PipelineContext } from '../index';
import { Knex } from 'knex';

/**
 * PipelineStep that normalizes nulls/empty values for BASE A (contábil).
 * - text columns: '' or NULL -> 'NULL'
 * - numeric columns: NULL or '' -> 0
 *
 * The step is idempotent: applying it multiple times won't change already-normalized values.
 */
export class NullsBaseAStep implements PipelineStep {
    name = 'NullsBaseA';

    private db: Knex;

    constructor(db: Knex) {
        this.db = db;
    }

    async execute(ctx: PipelineContext): Promise<void> {
        const baseContabilId = ctx.baseContabilId;
        if (!baseContabilId) {
            // nothing to do
            return;
        }

        // find the table name for the base
        const base = await this.db('bases').where({ id: baseContabilId }).first();
        if (!base || !base.tabela_sqlite) return;
        const tableName: string = base.tabela_sqlite;

        const has = await this.db.schema.hasTable(tableName);
        if (!has) return;

        // get column info
        const colInfo = await this.db(tableName).columnInfo();

        // process each column
        for (const col of Object.keys(colInfo || {})) {
            // skip metadata columns
            if (col === 'id' || col === 'created_at' || col === 'updated_at') continue;

            const info = (colInfo as any)[col] || {};
            const type: string = (info.type || '').toString().toLowerCase();

            const isNumeric = /int|real|float|numeric|decimal|number/.test(type);

            // Build update: target only rows with NULL or empty string
            try {
                await this.db.transaction(async trx => {
                    if (isNumeric) {
                        // set numeric nulls/empty to 0
                        await trx(tableName)
                            .whereNull(col)
                            .orWhere(col, '')
                            .update({ [col]: 0 });
                    } else {
                        // set text nulls/empty to 'NULL'
                        await trx(tableName)
                            .whereNull(col)
                            .orWhere(col, '')
                            .update({ [col]: 'NULL' });
                    }
                });
            } catch (err) {
                // log and continue; step should be resilient
                // Note: in a real system use a logger
                // eslint-disable-next-line no-console
                console.error(`NullsBaseA: failed processing column ${col} on ${tableName}:`, err);
            }
        }
    }
}

export default NullsBaseAStep;
