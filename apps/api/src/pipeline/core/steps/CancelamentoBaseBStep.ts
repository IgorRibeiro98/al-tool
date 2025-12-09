import { PipelineStep, PipelineContext } from '../index';
import { Knex } from 'knex';

const GROUP_NF_CANCELADA = 'NF Cancelada';
const STATUS_NAO_AVALIADO = '04_Não avaliado';
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
        const rows = await this.db.select('id').from(tableName).where(indicatorColumn, canceledValue);
        return rows.map((r: any) => r.id) as number[];
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
        const cfgId = ctx.configCancelamentoId;
        if (!cfgId) return;

        const cfg = await this.getConfig(cfgId);
        if (!cfg) return;

        const baseId = ctx.baseFiscalId ?? cfg.base_id;
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

        const canceledRowIds = await this.fetchCanceledRowIds(tableName, indicatorColumn, canceledValue as any);
        if (canceledRowIds.length === 0) return;

        const existing = await this.fetchExistingMarks(baseId, canceledRowIds);
        const missing = canceledRowIds.filter(id => !existing.has(id));
        if (missing.length === 0) return;

        await this.insertMarks(baseId, missing);
    }
}

export default CancelamentoBaseBStep;
