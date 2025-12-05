import { PipelineStep, PipelineContext } from '../index';
import { Knex } from 'knex';

/**
 * PipelineStep that detects estorno pairs in BASE A according to a configs_estorno configuration.
 *
 * Strategy:
 * - Load configs_estorno by id.
 * - Determine the target base (config.base_id || ctx.baseContabilId).
 * - Read relevant columns: id, coluna_a, coluna_b, coluna_soma from the base table.
 * - For each value v that appears in coluna_a and in coluna_b, try pair combinations.
 * - If sum(coluna_soma of pair) is within limite_zero, mark both rows in an auxiliary table `conciliacao_marks`.
 *
 * Storage: auxiliary table `conciliacao_marks` with columns:
 *  - id, base_id, row_id, status, grupo, chave, created_at
 *
 * The step is idempotent: it checks for existing mark entries before inserting.
 */
export class EstornoBaseAStep implements PipelineStep {
    name = 'EstornoBaseA';

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
        const cfgId = ctx.configEstornoId;
        if (!cfgId) return; // nothing to do

        // load configuration
        const cfg = ctx.getConfigEstorno ? await ctx.getConfigEstorno(cfgId) : await this.db('configs_estorno').where({ id: cfgId }).first();
        if (!cfg) return;

        const baseId = ctx.baseContabilId ?? cfg.base_id;
        if (!baseId) return;

        const base = ctx.getBaseMeta ? await ctx.getBaseMeta(baseId) : await this.db('bases').where({ id: baseId }).first();
        if (!base || !base.tabela_sqlite) return;
        const tableName: string = base.tabela_sqlite;

        const has = await this.db.schema.hasTable(tableName);
        if (!has) return;

        // ensure marks table exists
        await this.ensureMarksTable();

        const colunaA = cfg.coluna_a;
        const colunaB = cfg.coluna_b;
        const colunaSoma = cfg.coluna_soma;
        const limiteZero = Number(cfg.limite_zero ?? 0);

        if (!colunaA || !colunaB || !colunaSoma) return;

        const colA = this.wrapIdentifier(colunaA);
        const colB = this.wrapIdentifier(colunaB);
        const colSum = this.wrapIdentifier(colunaSoma);
        const tableIdent = this.wrapIdentifier(tableName);

        const sql = `
            WITH pairs AS (
                SELECT DISTINCT
                    a.id AS a_id,
                    b.id AS b_id,
                    a.${colA} AS chave_val,
                    COALESCE(a.${colSum}, 0) AS soma_a,
                    COALESCE(b.${colSum}, 0) AS soma_b,
                    COALESCE(a.${colSum}, 0) + COALESCE(b.${colSum}, 0) AS soma_total
                FROM ${tableIdent} a
                JOIN ${tableIdent} b
                  ON a.${colA} = b.${colB}
                WHERE a.${colA} IS NOT NULL
                  AND b.${colB} IS NOT NULL
                  AND a.id <> b.id
                  AND ABS(COALESCE(a.${colSum}, 0) + COALESCE(b.${colSum}, 0)) <= ?
            )
            INSERT INTO conciliacao_marks (base_id, row_id, status, grupo, chave, created_at)
            SELECT ?, p.a_id, '01_Conciliado', 'Conciliado_Estorno',
                   printf('%s_%d_%d', COALESCE(p.chave_val, ''), p.a_id, p.b_id), CURRENT_TIMESTAMP
            FROM pairs p
            WHERE NOT EXISTS (
                SELECT 1 FROM conciliacao_marks cm
                WHERE cm.base_id = ? AND cm.row_id = p.a_id AND cm.grupo = 'Conciliado_Estorno'
            )
            UNION ALL
            SELECT ?, p.b_id, '01_Conciliado', 'Conciliado_Estorno',
                   printf('%s_%d_%d', COALESCE(p.chave_val, ''), p.a_id, p.b_id), CURRENT_TIMESTAMP
            FROM pairs p
            WHERE NOT EXISTS (
                SELECT 1 FROM conciliacao_marks cm
                WHERE cm.base_id = ? AND cm.row_id = p.b_id AND cm.grupo = 'Conciliado_Estorno'
            );
        `;

        await this.db.raw(sql, [limiteZero, baseId, baseId, baseId, baseId]);
    }
}

export default EstornoBaseAStep;
