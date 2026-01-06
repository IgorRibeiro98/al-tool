import { PipelineStep, PipelineContext } from '../index';
import { Knex } from 'knex';

const GROUP_NF_CANCELADA = 'NF Cancelada' as const;
const STATUS_NAO_AVALIADO = '04_Não Avaliado' as const;
const INSERT_CHUNK = 500;
const LOG_PREFIX = '[CancelamentoBaseB]';

interface ConfigCancelamentoRow {
    readonly id: number;
    readonly base_id: number;
    readonly coluna_indicador?: string | null;
    readonly valor_cancelado?: string | number | null;
}

interface BaseRow {
    readonly id: number;
    readonly tabela_sqlite?: string | null;
}

export class CancelamentoBaseBStep implements PipelineStep {
    readonly name = 'CancelamentoBaseB';

    constructor(private readonly db: Knex) { }

    private async ensureMarksTableExists(): Promise<void> {
        const exists = await this.db.schema.hasTable('conciliacao_marks');
        if (!exists) {
            throw new Error("Missing DB table 'conciliacao_marks'. Run migrations to create required tables.");
        }
    }

    private async getConfig(cfgId: number): Promise<ConfigCancelamentoRow | null> {
        const cfg = await this.db<ConfigCancelamentoRow>('configs_cancelamento').where({ id: cfgId }).first();
        return cfg ?? null;
    }

    private async getBase(baseId: number): Promise<BaseRow | null> {
        const base = await this.db<BaseRow>('bases').where({ id: baseId }).first();
        return base ?? null;
    }

    private async fetchCanceledRowIds(tableName: string, indicatorColumn: string, canceledValue: string): Promise<number[]> {
        // Normalize value and compare using lower(trim(ifnull(...))) to handle whitespace and case differences.
        const val = canceledValue.trim().toLowerCase();
        if (val === '') return [];

        // Use identifier binding (??) to safely inject column name into raw SQL
        const rows = await this.db.select('id').from(tableName).whereRaw("lower(trim(ifnull(??, ''))) = ?", [indicatorColumn, val]);
        return rows
            .map((r: { id?: number | string }) => Number(r.id))
            .filter((id): id is number => !isNaN(id) && id > 0);
    }

    private async fetchExistingMarks(baseId: number, rowIds: number[], grupo = GROUP_NF_CANCELADA): Promise<Set<number>> {
        if (rowIds.length === 0) return new Set<number>();

        // Paginate whereIn for large arrays to avoid SQLite limits
        const result = new Set<number>();
        for (let i = 0; i < rowIds.length; i += INSERT_CHUNK) {
            const chunk = rowIds.slice(i, i + INSERT_CHUNK);
            const existing = await this.db('conciliacao_marks')
                .select('row_id')
                .where({ base_id: baseId, grupo })
                .whereIn('row_id', chunk);
            for (const r of existing) result.add(Number(r.row_id));
        }
        return result;
    }

    private async insertMarks(baseId: number, rowIds: number[], status = STATUS_NAO_AVALIADO, grupo = GROUP_NF_CANCELADA): Promise<number> {
        if (rowIds.length === 0) return 0;

        const chunks: number[][] = [];
        for (let i = 0; i < rowIds.length; i += INSERT_CHUNK) {
            chunks.push(rowIds.slice(i, i + INSERT_CHUNK));
        }

        let insertedCount = 0;

        // Use transaction for atomicity - all or nothing
        await this.db.transaction(async trx => {
            for (const chunk of chunks) {
                const inserts = chunk.map(rid => ({
                    base_id: baseId,
                    row_id: rid,
                    status,
                    grupo,
                    chave: null,
                    created_at: trx.fn.now()
                }));

                // Idempotent insert - ignore if already exists
                await trx('conciliacao_marks')
                    .insert(inserts)
                    .onConflict(['base_id', 'row_id', 'grupo'])
                    .ignore();

                insertedCount += chunk.length;
            }
        });

        return insertedCount;
    }

    async execute(ctx: PipelineContext): Promise<void> {
        const cfgId = ctx.configCancelamentoId as number | undefined | null;

        // Determine baseId first (from ctx or from cfg fallback)
        const baseIdFromCtx = ctx.baseFiscalId as number | undefined | null;

        let cfg: ConfigCancelamentoRow | null = null;
        if (cfgId) {
            cfg = await this.getConfig(cfgId);
        }

        // If no explicit configId provided, try to find a config by base_id
        const baseId = baseIdFromCtx ?? cfg?.base_id;
        if (!cfg && baseId) {
            // try to load any config matching this base
            const maybe = await this.db<ConfigCancelamentoRow>('configs_cancelamento').where({ base_id: baseId }).first();
            if (maybe) cfg = maybe;
        }

        if (!cfg) {
            console.log(`${LOG_PREFIX} No config found for cfgId=${cfgId}, baseId=${baseId} - skipping`);
            return;
        }
        if (!baseId) {
            console.log(`${LOG_PREFIX} No baseId available - skipping`);
            return;
        }

        const base = await this.getBase(baseId);
        if (!base || !base.tabela_sqlite) {
            console.log(`${LOG_PREFIX} Base ${baseId} not found or has no tabela_sqlite - skipping`);
            return;
        }
        const tableName = base.tabela_sqlite;

        const tableExists = await this.db.schema.hasTable(tableName);
        if (!tableExists) {
            console.log(`${LOG_PREFIX} Table ${tableName} does not exist - skipping`);
            return;
        }

        await this.ensureMarksTableExists();

        const indicatorColumn = cfg.coluna_indicador;
        const canceledValue = cfg.valor_cancelado;

        if (!indicatorColumn) {
            console.log(`${LOG_PREFIX} No indicator column configured - skipping`);
            return;
        }
        if (canceledValue === undefined || canceledValue === null) {
            console.log(`${LOG_PREFIX} No canceled value configured - skipping`);
            return;
        }

        // Normalize canceled value to string
        const canceledValueStr = String(canceledValue).trim();
        if (canceledValueStr === '') {
            console.log(`${LOG_PREFIX} Empty canceled value - skipping`);
            return;
        }

        // Ensure the indicator column exists in the target table to avoid silent no-ops
        const hasCol = await this.db.schema.hasColumn(tableName, indicatorColumn);
        if (!hasCol) {
            console.log(`${LOG_PREFIX} Column ${indicatorColumn} not found in table ${tableName} - skipping`);
            return;
        }

        const canceledRowIds = await this.fetchCanceledRowIds(tableName, indicatorColumn, canceledValueStr);
        if (canceledRowIds.length === 0) {
            console.log(`${LOG_PREFIX} No rows found with canceled value "${canceledValueStr}" in column ${indicatorColumn}`);
            return;
        }

        const existing = await this.fetchExistingMarks(baseId, canceledRowIds);
        const missing = canceledRowIds.filter(id => !existing.has(id));

        console.log(`${LOG_PREFIX} Found ${canceledRowIds.length} canceled rows, ${existing.size} already marked, ${missing.length} new marks to insert`);

        if (missing.length === 0) {
            console.log(`${LOG_PREFIX} All canceled rows already marked - nothing to do`);
            return;
        }

        await this.insertMarks(baseId, missing);
        console.log(`${LOG_PREFIX} Inserted ${missing.length} new marks for base ${baseId}`);
    }
}

export default CancelamentoBaseBStep;
