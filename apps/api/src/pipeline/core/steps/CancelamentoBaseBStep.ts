import { PipelineStep, PipelineContext } from '../index';
import { Knex } from 'knex';

const GROUP_NF_CANCELADA = 'NF Cancelada';
const STATUS_NAO_AVALIADO = '04_Não Avaliado';
const INSERT_CHUNK = 500;

type ConfigCancelamentoRow = {
    id: number;
    base_id: number;
    coluna_indicador?: string | null;
    valor_cancelado?: string | number | null;
};

type BaseRow = {
    id: number;
    tabela_sqlite?: string | null;
};

export class CancelamentoBaseBStep implements PipelineStep {
    name = 'CancelamentoBaseB';

    constructor(private readonly db: Knex) {}

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

    private async fetchCanceledRowIds(tableName: string, indicatorColumn: string, canceledValue: string | number) {
        // Normalize value and compare using lower(trim(ifnull(...))) to handle whitespace and case differences.
        const val = String(canceledValue ?? '').trim().toLowerCase();
        if (val === '') return [];

        // Use identifier binding (??) to safely inject column name into raw SQL
        const rows = await this.db.select('id').from(tableName).whereRaw("lower(trim(ifnull(??, ''))) = ?", [indicatorColumn, val]);
        return rows.map((r: any) => Number(r.id)).filter(Boolean) as number[];
    }

    private async fetchExistingMarks(baseId: number, rowIds: number[], grupo = GROUP_NF_CANCELADA) {
        if (rowIds.length === 0) return new Set<number>();
        const existing = await this.db('conciliacao_marks').select('row_id').where({ base_id: baseId, grupo }).whereIn('row_id', rowIds);
        return new Set<number>(existing.map((r: any) => r.row_id));
    }

    private async insertMarks(baseId: number, rowIds: number[], status = STATUS_NAO_AVALIADO, grupo = GROUP_NF_CANCELADA) {
        if (rowIds.length === 0) return;
        const chunks: number[][] = [];
        for (let i = 0; i < rowIds.length; i += INSERT_CHUNK) chunks.push(rowIds.slice(i, i + INSERT_CHUNK));

        for (const chunk of chunks) {
            const inserts = chunk.map(rid => ({ base_id: baseId, row_id: rid, status, grupo, chave: null, created_at: this.db.fn.now() }));
            await this.db('conciliacao_marks').insert(inserts);
        }
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

        if (!cfg) return;
        if (!baseId) return;

        const base = await this.getBase(baseId);
        if (!base || !base.tabela_sqlite) return;
        const tableName = base.tabela_sqlite;

        const tableExists = await this.db.schema.hasTable(tableName);
        if (!tableExists) return;

        await this.ensureMarksTableExists();

        const indicatorColumn = cfg.coluna_indicador;
        const canceledValue = cfg.valor_cancelado as string | number | undefined | null;
        if (!indicatorColumn || canceledValue === undefined || canceledValue === null) return;

        // ensure the indicator column exists in the target table to avoid silent no-ops
        const hasCol = await this.db.schema.hasColumn(tableName, indicatorColumn);
        if (!hasCol) return;

        const canceledRowIds = await this.fetchCanceledRowIds(tableName, indicatorColumn, canceledValue as any);
        if (canceledRowIds.length === 0) return;

        const existing = await this.fetchExistingMarks(baseId, canceledRowIds);
        const missing = canceledRowIds.filter(id => !existing.has(id));
        if (missing.length === 0) return;

        await this.insertMarks(baseId, missing);
    }
}

export default CancelamentoBaseBStep;
