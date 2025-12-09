import { PipelineStep, PipelineContext } from '../index';
import { Knex } from 'knex';

/*
    Nulls replacement for Base B (fiscal).
    - numeric columns -> 0
    - other columns -> 'NULL' (string)
*/

const IGNORED_COLUMNS = new Set(['id', 'created_at', 'updated_at']);

export class NullsBaseBStep implements PipelineStep {
    name = 'NullsBaseB';

    constructor(private readonly db: Knex) {}

    private isNumericColumn(type?: string | null): boolean {
        if (!type) return false;
        return /int|real|float|numeric|decimal|number/.test(type.toLowerCase());
    }

    private async updateNulls(tableName: string, column: string, replacement: any) {
        await this.db.transaction(async trx => {
            await trx(tableName).whereNull(column).orWhere(column, '').update({ [column]: replacement });
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
        for (const col of columns) {
            const info = (colInfo as any)[col] || {};
            const type = info.type ? String(info.type) : '';
            const numeric = this.isNumericColumn(type);
            try {
                await this.updateNulls(tableName, col, numeric ? 0 : 'NULL');
            } catch (err) {
                // eslint-disable-next-line no-console
                console.error(`NullsBaseB: failed updating ${col} on ${tableName}:`, (err as Error).message ?? err);
            }
        }
    }
}

type BaseRow = { id: number; tabela_sqlite?: string | null };

export default NullsBaseBStep;
