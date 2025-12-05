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

    private wrapIdentifier(value: string) {
        return `"${value.replace(/"/g, '""')}"`;
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

        const cfg = ctx.getConfigCancelamento ? await ctx.getConfigCancelamento(cfgId) : await this.db('configs_cancelamento').where({ id: cfgId }).first();
        if (!cfg) return;

        const baseId = ctx.baseFiscalId ?? cfg.base_id;
        if (!baseId) return;

        const base = ctx.getBaseMeta ? await ctx.getBaseMeta(baseId) : await this.db('bases').where({ id: baseId }).first();
        if (!base || !base.tabela_sqlite) return;
        const tableName: string = base.tabela_sqlite;

        const has = await this.db.schema.hasTable(tableName);
        if (!has) return;

        await this.ensureMarksTable();

        const coluna = cfg.coluna_indicador;
        const valorCancelado = cfg.valor_cancelado;

        if (!coluna || valorCancelado === undefined || valorCancelado === null) return;

        const grupo = 'NF Cancelada';
        const status = '04_Não avaliado';

        const tableIdent = this.wrapIdentifier(tableName);
        const colIdent = this.wrapIdentifier(coluna);

        const sql = `
            INSERT INTO conciliacao_marks (base_id, row_id, status, grupo, chave, created_at)
            SELECT ?, t.id, ?, ?, NULL, CURRENT_TIMESTAMP
            FROM ${tableIdent} t
            WHERE t.${colIdent} = ?
            AND NOT EXISTS (
                SELECT 1 FROM conciliacao_marks cm
                WHERE cm.base_id = ? AND cm.row_id = t.id AND cm.grupo = ?
            )
        `;

        await this.db.raw(sql, [baseId, status, grupo, valorCancelado, baseId, grupo]);
    }
}

export default CancelamentoBaseBStep;
