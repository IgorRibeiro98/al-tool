import { PipelineStep, PipelineContext } from '../index';
import { Knex } from 'knex';

/**
 * PipelineStep that marks cancelled NFs in BASE B according to a configs_cancelamento configuration.
 *
 * Behavior:
 * - Load configs_cancelamento by id from ctx.configCancelamentoId.
 * - Determine base (config.base_id or ctx.baseFiscalId).
 * - Find rows where coluna_indicador == valor_cancelado.
 * - Insert marks into `conciliacao_marks` with status = "04_Não avaliado" and grupo = "NF Cancelada" and chave = NULL.
 * - Idempotent: does not insert duplicate marks for the same row and group.
 */
export class CancelamentoBaseBStep implements PipelineStep {
    name = 'CancelamentoBaseB';

    private db: Knex;

    constructor(db: Knex) {
        this.db = db;
    }

    private async ensureMarksTable() {
        const exists = await this.db.schema.hasTable('conciliacao_marks');
        if (!exists) {
            await this.db.schema.createTable('conciliacao_marks', table => {
                table.increments('id').primary();
                table.integer('base_id').notNullable();
                table.integer('row_id').notNullable();
                table.string('status').notNullable();
                table.string('grupo').nullable();
                table.string('chave').nullable();
                table.timestamp('created_at').defaultTo(this.db.fn.now()).notNullable();
            });
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

        // find rows matching the indicator
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
