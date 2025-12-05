import { PipelineStep, PipelineContext } from '../index';
import { Knex } from 'knex';

/**
 * PipelineStep that normalizes nulls/empty values for BASE B (fiscal).
 * - text columns: '' or NULL -> 'NULL'
 * - numeric columns: NULL or '' -> 0
 *
 * Idempotent: running multiple times has no additional effect.
 */
export class NullsBaseBStep implements PipelineStep {
    name = 'NullsBaseB';

    private db: Knex;

    constructor(db: Knex) {
        this.db = db;
    }

    private wrapIdentifier(value: string) {
        return `"${value.replace(/"/g, '""')}"`;
    }

    async execute(ctx: PipelineContext): Promise<void> {
        const baseFiscalId = ctx.baseFiscalId;
        if (!baseFiscalId) return;

        const base = ctx.getBaseMeta ? await ctx.getBaseMeta(baseFiscalId) : await this.db('bases').where({ id: baseFiscalId }).first();
        if (!base || !base.tabela_sqlite) return;
        const tableName: string = base.tabela_sqlite;

        const has = await this.db.schema.hasTable(tableName);
        if (!has) return;

        const colInfo = await this.db(tableName).columnInfo();

        const numericCols: string[] = [];
        const textCols: string[] = [];

        for (const col of Object.keys(colInfo || {})) {
            if (col === 'id' || col === 'created_at' || col === 'updated_at') continue;
            const info = (colInfo as any)[col] || {};
            const type: string = (info.type || '').toString().toLowerCase();
            const isNumeric = /int|real|float|numeric|decimal|number/.test(type);
            if (isNumeric) {
                numericCols.push(col);
            } else {
                textCols.push(col);
            }
        }

        if (!numericCols.length && !textCols.length) return;

        const tableIdent = this.wrapIdentifier(tableName);

        await this.db.transaction(async trx => {
            if (numericCols.length) {
                const setClause = numericCols
                    .map(col => `${this.wrapIdentifier(col)} = CASE WHEN ${this.wrapIdentifier(col)} IS NULL OR ${this.wrapIdentifier(col)} = '' THEN 0 ELSE ${this.wrapIdentifier(col)} END`)
                    .join(', ');
                await trx.raw(`UPDATE ${tableIdent} SET ${setClause}`);
            }

            if (textCols.length) {
                const setClause = textCols
                    .map(col => `${this.wrapIdentifier(col)} = CASE WHEN ${this.wrapIdentifier(col)} IS NULL OR ${this.wrapIdentifier(col)} = '' THEN 'NULL' ELSE ${this.wrapIdentifier(col)} END`)
                    .join(', ');
                await trx.raw(`UPDATE ${tableIdent} SET ${setClause}`);
            }
        });
    }
}

export default NullsBaseBStep;
