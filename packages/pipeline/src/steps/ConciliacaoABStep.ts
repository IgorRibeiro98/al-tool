import { PipelineStep, PipelineContext } from '../index';
import { Knex } from 'knex';

/**
 * PipelineStep that performs reconciliation between BASE A and BASE B.
 *
 * Creates a result table `conciliacao_result_{jobId}` with columns:
 * - id INTEGER PRIMARY KEY
 * - job_id INTEGER
 * - chave TEXT
 * - status TEXT
 * - grupo TEXT
 * - a_row_id INTEGER
 * - b_row_id INTEGER
 * - a_values TEXT (JSON)
 * - b_values TEXT (JSON)
 * - value_a REAL
 * - value_b REAL
 * - difference REAL
 * - created_at TIMESTAMP
 *
 * Classification follows the specification in T18.
 */
export class ConciliacaoABStep implements PipelineStep {
    name = 'ConciliacaoAB';

    private db: Knex;

    constructor(db: Knex) {
        this.db = db;
    }

    private async ensureResultTable(jobId: number) {
        const tableName = `conciliacao_result_${jobId}`;
        const exists = await this.db.schema.hasTable(tableName);
        if (!exists) {
            await this.db.schema.createTable(tableName, table => {
                table.increments('id').primary();
                table.integer('job_id').notNullable();
                table.string('chave').nullable();
                table.string('status').nullable();
                table.string('grupo').nullable();
                table.integer('a_row_id').nullable();
                table.integer('b_row_id').nullable();
                table.text('a_values').nullable();
                table.text('b_values').nullable();
                table.float('value_a').nullable();
                table.float('value_b').nullable();
                table.float('difference').nullable();
                table.timestamp('created_at').defaultTo(this.db.fn.now()).notNullable();
            });
        }
        return tableName;
    }

    async execute(ctx: PipelineContext): Promise<void> {
        const cfgId = ctx.configConciliacaoId;
        if (!cfgId) return;

        const cfg = await this.db('configs_conciliacao').where({ id: cfgId }).first();
        if (!cfg) return;

        const baseAId = cfg.base_contabil_id ?? ctx.baseContabilId;
        const baseBId = cfg.base_fiscal_id ?? ctx.baseFiscalId;
        if (!baseAId || !baseBId) return;

        const baseA = await this.db('bases').where({ id: baseAId }).first();
        const baseB = await this.db('bases').where({ id: baseBId }).first();
        if (!baseA || !baseA.tabela_sqlite || !baseB || !baseB.tabela_sqlite) return;

        const tableA = baseA.tabela_sqlite;
        const tableB = baseB.tabela_sqlite;

        const chavesContabil = (() => { try { return JSON.parse(cfg.chaves_contabil || '[]'); } catch { return []; } })();
        const chavesFiscal = (() => { try { return JSON.parse(cfg.chaves_fiscal || '[]'); } catch { return []; } })();

        const colA = cfg.coluna_conciliacao_contabil;
        const colB = cfg.coluna_conciliacao_fiscal;
        const inverter = !!cfg.inverter_sinal_fiscal;
        const limite = Number(cfg.limite_diferenca_imaterial || 0);

        const jobId = ctx.jobId;
        const resultTable = await this.ensureResultTable(jobId);

        // Build matches: left join A->B to get matches and A-only; then B-only via left join B->A where a is null

        // Prepare base query for matched or A-present rows
        const aAlias = 'a';
        const bAlias = 'b';

        const qb = this.db.select(
            this.db.raw(`${aAlias}.id as a_row_id`),
            this.db.raw(`${bAlias}.id as b_row_id`),
            this.db.raw(`${aAlias}.*`),
            this.db.raw(`${bAlias}.*`)
        ).from({ [aAlias]: tableA })
            .leftJoin({ [bAlias]: tableB }, function () {
                // dynamic on clauses
                for (let i = 0; i < Math.max(chavesContabil.length, chavesFiscal.length); i++) {
                    const aKey = chavesContabil[i] || chavesContabil[0];
                    const bKey = chavesFiscal[i] || chavesFiscal[0];
                    if (aKey && bKey) {
                        this.on(`${aAlias}.${aKey}`, '=', `${bAlias}.${bKey}`);
                    }
                }
            });

        // NOTE: previously we excluded rows marked as estorno/cancelado here.
        // Change: include marked rows in the reconciliation output and annotate them with their mark (status/grupo/chave).

        const rows = await qb;

        // Load marks for both bases so we can include marked rows in the results
        const marksRows: any[] = await this.db('conciliacao_marks').whereIn('base_id', [baseAId, baseBId]).select('*');
        const marksA = new Map<number, any>();
        const marksB = new Map<number, any>();
        for (const m of marksRows) {
            if (m.base_id === baseAId) marksA.set(m.row_id, m);
            if (m.base_id === baseBId) marksB.set(m.row_id, m);
        }

        const inserts: any[] = [];

        for (const r of rows) {
            const a_row_id = r.a_row_id || null;
            const b_row_id = r.b_row_id || null;

            // because knex returns merged objects, we will re-query individual rows to produce value objects
            const aRow = a_row_id ? await this.db.select('*').from(tableA).where({ id: a_row_id }).first() : null;
            const bRow = b_row_id ? await this.db.select('*').from(tableB).where({ id: b_row_id }).first() : null;

            const valueA = aRow && colA ? Number(aRow[colA]) || 0 : 0;
            const valueB_raw = bRow && colB ? Number(bRow[colB]) || 0 : 0;
            const valueB = inverter ? -valueB_raw : valueB_raw;
            const diff = valueA - valueB;

            // check for marks (estorno on A, cancelamento on B) and prioritize emitting a mark-based result
            const aMark = a_row_id ? marksA.get(a_row_id) : null;
            const bMark = b_row_id ? marksB.get(b_row_id) : null;

            let status = null as string | null;
            let group = null as string | null;
            let chave = null as string | null;

            if (aMark || bMark) {
                // prefer A mark if present, otherwise B mark
                const mark = aMark || bMark;
                status = mark.status;
                group = mark.grupo;
                chave = mark.chave;
                // push marked entry
                inserts.push({
                    job_id: jobId,
                    chave,
                    status,
                    grupo: group,
                    a_row_id,
                    b_row_id,
                    a_values: aRow ? JSON.stringify(aRow) : null,
                    b_values: bRow ? JSON.stringify(bRow) : null,
                    value_a: valueA,
                    value_b: valueB,
                    difference: diff,
                    created_at: this.db.fn.now()
                });
                continue;
            }

            if (aRow && bRow) {
                if (Math.abs(diff) === 0) {
                    status = '01_Conciliado';
                    group = 'Conciliado';
                } else if (Math.abs(diff) <= limite) {
                    status = '02_Encontrado c/Diferença';
                    group = 'Diferença Imaterial';
                } else if (diff > limite) {
                    status = '02_Encontrado c/Diferença';
                    group = 'Encontrado com diferença, BASE A MAIOR';
                } else {
                    status = '02_Encontrado c/Diferença';
                    group = 'Encontrado com diferença, BASE B MAIOR';
                }
                chave = chavesContabil.map((k: string) => aRow[k]).join('_');
            } else {
                status = '03_Não Encontrado';
                group = 'Não encontrado';
                chave = aRow ? chavesContabil.map((k: string) => aRow[k]).join('_') : (bRow ? chavesFiscal.map((k: string) => bRow[k]).join('_') : null);
            }

            inserts.push({
                job_id: jobId,
                chave,
                status,
                grupo: group,
                a_row_id,
                b_row_id,
                a_values: aRow ? JSON.stringify(aRow) : null,
                b_values: bRow ? JSON.stringify(bRow) : null,
                value_a: valueA,
                value_b: valueB,
                difference: diff,
                created_at: this.db.fn.now()
            });
        }

        // insert results in chunks
        const chunk = 200;
        for (let i = 0; i < inserts.length; i += chunk) {
            const slice = inserts.slice(i, i + chunk);
            await this.db(resultTable).insert(slice);
        }

        // Now handle B-only rows (rows in B that have no matching A)
        const qbBOnly = this.db.select(`${bAlias}.id as b_row_id`).from({ [bAlias]: tableB }).leftJoin({ [aAlias]: tableA }, function () {
            for (let i = 0; i < Math.max(chavesContabil.length, chavesFiscal.length); i++) {
                const aKey = chavesContabil[i] || chavesContabil[0];
                const bKey = chavesFiscal[i] || chavesFiscal[0];
                if (aKey && bKey) this.on(`${aAlias}.${aKey}`, '=', `${bAlias}.${bKey}`);
            }
        }).whereNull('a.id');

        // NOTE: previously we excluded canceled B rows here; instead include them and mark accordingly

        const bOnlyRows = await qbBOnly;
        for (const r of bOnlyRows) {
            const bRow = await this.db.select('*').from(tableB).where({ id: r.b_row_id }).first();
            const valueA = 0;
            const valueB_raw = bRow && colB ? Number(bRow[colB]) || 0 : 0;
            const valueB = inverter ? -valueB_raw : valueB_raw;
            const diff = valueA - valueB;

            const bMark = marksB.get(r.b_row_id);
            if (bMark) {
                await this.db(resultTable).insert({
                    job_id: jobId,
                    chave: bMark.chave,
                    status: bMark.status,
                    grupo: bMark.grupo,
                    a_row_id: null,
                    b_row_id: r.b_row_id,
                    a_values: null,
                    b_values: JSON.stringify(bRow),
                    value_a: valueA,
                    value_b: valueB,
                    difference: diff,
                    created_at: this.db.fn.now()
                });
                continue;
            }

            const status = '03_Não Encontrado';
            const group = 'Não encontrado';
            const chave = chavesFiscal.map((k: string) => bRow[k]).join('_');

            await this.db(resultTable).insert({
                job_id: jobId,
                chave,
                status,
                grupo: group,
                a_row_id: null,
                b_row_id: r.b_row_id,
                a_values: null,
                b_values: JSON.stringify(bRow),
                value_a: valueA,
                value_b: valueB,
                difference: diff,
                created_at: this.db.fn.now()
            });
        }
    }
}

export default ConciliacaoABStep;
