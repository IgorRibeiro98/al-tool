import { PipelineStep, PipelineContext } from '../index';
import { Knex } from 'knex';

/*
    Replace null/empty values in Base A table:
    - numeric columns -> 0
    - non-numeric columns -> literal string 'NULL'

    Implemented with small helpers, input validation and batched updates.
*/

const IGNORED_COLUMNS = new Set(['id', 'created_at', 'updated_at']);
const BATCH_SIZE = 1000;

export class NullsBaseAStep implements PipelineStep {
    name = 'NullsBaseA';

    constructor(private readonly db: Knex) {}

    private isNumericColumnType(type?: string | null): boolean {
        if (!type) return false;
        return /int|real|float|numeric|decimal|number/.test(type.toLowerCase());
    }

    private async updateColumnValues(table: string, column: string, replacement: any) {
        // Perform updates in a transaction for safety; chunking not necessary for update queries
        await this.db.transaction(async trx => {
            await trx(table).whereNull(column).orWhere(column, '').update({ [column]: replacement });
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

        for (const col of columns) {
            const info = (columnInfo as any)[col] || {};
            const type = info.type ? String(info.type) : '';
            const isNumeric = this.isNumericColumnType(type);

            try {
                const replacement = isNumeric ? 0 : 'NULL';
                await this.updateColumnValues(tableName, col, replacement);
            } catch (err) {
                // log error minimally; leave system running
                // eslint-disable-next-line no-console
                console.error(`NullsBaseA: failed updating column ${col} on ${tableName}:`, err && (err as Error).message ? (err as Error).message : err);
            }
        }
    }
}

export default NullsBaseAStep;
