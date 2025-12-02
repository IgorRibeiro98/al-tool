import { PipelineStep, PipelineContext } from '../index';
import { Knex } from 'knex';

export class CancelamentoBaseBStep implements PipelineStep {
    name = 'CancelamentoBaseB';

    private db: Knex;

    constructor(db: Knex) {
        this.db = db;
    }

    private async ensureMarksTable() {
        const exists = await this.db.schema.hasTable('conciliacao_marks');
        if (!exists) {
            throw new Error("Missing DB table 'conciliacao_marks'. Run the API migrations (e.g. `npm --prefix apps/api run migrate`) to create required tables.");
        }
    }

    async execute(ctx: PipelineContext): Promise<void> {
        const cfgId = ctx.configCancelamentoId;
        if (!cfgId) return;

        const cfg = await this.db('configs_cancelamento').where({ id: cfgId }).first();
        if (!cfg) return;

        const baseId = cfg.base_id ?? ctx.baseFiscalId;
        if (!baseId) return;

        const base = await this.db('bases').where({ id: baseId }).first();
        if (!base || !base.tabela_sqlite) return;
        const tableName: string = base.tabela_sqlite;

        const has = await this.db.schema.hasTable(tableName);
        if (!has) return;

        await this.ensureMarksTable();

        const coluna = cfg.coluna_indicador;
        const valorCancelado = cfg.valor_cancelado;

        if (!coluna || valorCancelado === undefined || valorCancelado === null) return;

        const rows = await this.db.select('id').from(tableName).where(coluna, valorCancelado);

        if (!rows || rows.length === 0) return;

        const grupo = 'NF Cancelada';
        const status = '04_Não avaliado';

        for (const r of rows) {
            const exists = await this.db('conciliacao_marks').where({ base_id: baseId, row_id: r.id, grupo }).first();
            if (!exists) {
                await this.db('conciliacao_marks').insert({ base_id: baseId, row_id: r.id, status, grupo, chave: null, created_at: this.db.fn.now() });
            }
        }
    }
}

export default CancelamentoBaseBStep;
