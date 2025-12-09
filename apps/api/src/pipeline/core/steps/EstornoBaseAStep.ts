import { PipelineStep, PipelineContext } from '../index';
import { Knex } from 'knex';

/*
    Estorno step for Base A (contábil).
    Finds pairs (A,B) within the same table where column_sum(A) + column_sum(B) ~= 0
    and inserts conciliacao_marks with group 'Conciliado_Estorno'.
*/

const GROUP_ESTORNO = 'Conciliado_Estorno';
const STATUS_CONCILIADO = '01_Conciliado';
const INSERT_CHUNK = 500;

type ConfigEstorno = {
    id: number;
    base_id: number;
    coluna_a?: string | null;
    coluna_b?: string | null;
    coluna_soma?: string | null;
    limite_zero?: number | null;
};

type BaseRow = { id: number; tabela_sqlite?: string | null };

type SourceRow = { id: number; [key: string]: any };

export class EstornoBaseAStep implements PipelineStep {
    name = 'EstornoBaseA';

    constructor(private readonly db: Knex) {}

    private async ensureMarksTableExists(): Promise<void> {
        const exists = await this.db.schema.hasTable('conciliacao_marks');
        if (!exists) {
            throw new Error("Missing DB table 'conciliacao_marks'. Run migrations to create required tables.");
        }
    }

    private toStringKey(value: any): string {
        return value === null || value === undefined ? '' : String(value);
    }

    private async chunkInsertMarks(entries: Array<Record<string, any>>) {
        if (!entries.length) return;
        for (let i = 0; i < entries.length; i += INSERT_CHUNK) {
            const slice = entries.slice(i, i + INSERT_CHUNK);
            await this.db('conciliacao_marks').insert(slice);
        }
    }

    async execute(ctx: PipelineContext): Promise<void> {
        const cfgId = ctx.configEstornoId;
        if (!cfgId) return;

        const cfg = await this.db<ConfigEstorno>('configs_estorno').where({ id: cfgId }).first();
        if (!cfg) return;

        const baseId = ctx.baseContabilId ?? cfg.base_id;
        if (!baseId) return;

        const base = await this.db<BaseRow>('bases').where({ id: baseId }).first();
        if (!base || !base.tabela_sqlite) return;
        const tableName = base.tabela_sqlite;

        const tableExists = await this.db.schema.hasTable(tableName);
        if (!tableExists) return;

        await this.ensureMarksTableExists();

        const colunaA = cfg.coluna_a ?? undefined;
        const colunaB = cfg.coluna_b ?? undefined;
        const colunaSoma = cfg.coluna_soma ?? undefined;
        const limiteZero = Number(cfg.limite_zero ?? 0);

        if (!colunaA || !colunaB || !colunaSoma) return;

        const rows: SourceRow[] = await this.db.select('id', colunaA, colunaB, colunaSoma).from(tableName);

        const mapA = new Map<string, SourceRow[]>();
        const mapB = new Map<string, SourceRow[]>();

        for (const r of rows) {
            const keyA = this.toStringKey(r[colunaA]);
            const keyB = this.toStringKey(r[colunaB]);
            if (keyA) {
                const arr = mapA.get(keyA) ?? [];
                arr.push(r);
                mapA.set(keyA, arr);
            }
            if (keyB) {
                const arr = mapB.get(keyB) ?? [];
                arr.push(r);
                mapB.set(keyB, arr);
            }
        }

        const markEntries: Array<Record<string, any>> = [];
        const grupo = GROUP_ESTORNO;
        let groupCounter = 0;
        const jobIdPart = ctx.jobId ? `${ctx.jobId}_` : '';

        for (const [key, listA] of mapA.entries()) {
            const listB = mapB.get(key);
            if (!listB) continue;

            for (const aRow of listA) {
                for (const bRow of listB) {
                    if (aRow.id === bRow.id) continue;

                    const valA = Number(aRow[colunaSoma]) || 0;
                    const valB = Number(bRow[colunaSoma]) || 0;
                    const sum = valA + valB;
                    if (Math.abs(sum) <= limiteZero) {
                        const status = STATUS_CONCILIADO;
                        const chave = `${jobIdPart}${key}_${Date.now()}_${groupCounter++}`;

                        // push two entries (A and B) — duplicates will be filtered before insert
                        markEntries.push({ base_id: baseId, row_id: aRow.id, status, grupo, chave, created_at: this.db.fn.now() });
                        markEntries.push({ base_id: baseId, row_id: bRow.id, status, grupo, chave, created_at: this.db.fn.now() });
                    }
                }
            }
        }

        if (markEntries.length === 0) return;

        // Remove entries that already exist (same base_id, row_id, grupo)
        const rowIds = Array.from(new Set(markEntries.map(e => e.row_id)));
        const existing = await this.db('conciliacao_marks').where({ base_id: baseId, grupo }).whereIn('row_id', rowIds).select('row_id');
        const existingSet = new Set(existing.map((r: any) => r.row_id));

        const toInsert = markEntries.filter(e => !existingSet.has(e.row_id));
        if (toInsert.length === 0) return;

        await this.chunkInsertMarks(toInsert);
    }
}

export default EstornoBaseAStep;
