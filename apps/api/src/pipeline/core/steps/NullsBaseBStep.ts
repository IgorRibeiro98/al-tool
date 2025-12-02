import { PipelineStep, PipelineContext } from '../index';
import { Knex } from 'knex';

export class NullsBaseBStep implements PipelineStep {
    name = 'NullsBaseB';

    private db: Knex;

    constructor(db: Knex) {
        this.db = db;
    }

    async execute(ctx: PipelineContext): Promise<void> {
        const baseFiscalId = ctx.baseFiscalId;
        if (!baseFiscalId) return;

        const base = await this.db('bases').where({ id: baseFiscalId }).first();
        if (!base || !base.tabela_sqlite) return;
        const tableName: string = base.tabela_sqlite;

        const has = await this.db.schema.hasTable(tableName);
        if (!has) return;

        const colInfo = await this.db(tableName).columnInfo();

        for (const col of Object.keys(colInfo || {})) {
            if (col === 'id' || col === 'created_at' || col === 'updated_at') continue;

            const info = (colInfo as any)[col] || {};
            const type: string = (info.type || '').toString().toLowerCase();
            const isNumeric = /int|real|float|numeric|decimal|number/.test(type);

            try {
                await this.db.transaction(async trx => {
                    if (isNumeric) {
                        await trx(tableName)
                            .whereNull(col)
                            .orWhere(col, '')
                            .update({ [col]: 0 });
                    } else {
                        await trx(tableName)
                            .whereNull(col)
                            .orWhere(col, '')
                            .update({ [col]: 'NULL' });
                    }
                });
            } catch (err) {
                // eslint-disable-next-line no-console
                console.error(`NullsBaseB: failed processing column ${col} on ${tableName}:`, err);
            }
        }
    }
}

export default NullsBaseBStep;
