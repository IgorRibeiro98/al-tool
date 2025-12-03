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
        const cfg = await this.db('configs_estorno').where({ id: cfgId }).first();
        if (!cfg) return;

        const baseId = ctx.baseContabilId ?? cfg.base_id;
        if (!baseId) return;

        const base = await this.db('bases').where({ id: baseId }).first();
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

        // read relevant rows (id and the three columns)
        const rows: any[] = await this.db.select('id', colunaA, colunaB, colunaSoma).from(tableName);

        // build maps: value -> list of rows where colunaA == value, and where colunaB == value
        const mapA = new Map<string, any[]>();
        const mapB = new Map<string, any[]>();

        for (const r of rows) {
            const a = r[colunaA];
            const b = r[colunaB];
            if (a !== null && a !== undefined) {
                const key = String(a);
                let arrA = mapA.get(key);
                if (!arrA) {
                    arrA = [];
                    mapA.set(key, arrA);
                }
                arrA.push(r);
            }
            if (b !== null && b !== undefined) {
                const key = String(b);
                let arrB = mapB.get(key);
                if (!arrB) {
                    arrB = [];
                    mapB.set(key, arrB);
                }
                arrB.push(r);
            }
        }

        let groupCounter = 0;

        // for each key present in both maps, attempt pairings
        for (const [key, listA] of mapA.entries()) {
            const listB = mapB.get(key);
            if (!listB) continue;

            for (const ra of listA) {
                for (const rb of listB) {
                    // skip if same row
                    if (ra.id === rb.id) continue;

                    const valA = Number(ra[colunaSoma]) || 0;
                    const valB = Number(rb[colunaSoma]) || 0;
                    const sum = valA + valB;
                    if (Math.abs(sum) <= limiteZero) {
                        // mark both rows as conciliado com estorno
                        const grupo = 'Conciliado_Estorno';
                        const status = '01_Conciliado';
                        const chave = `${key}_${Date.now()}_${groupCounter++}`;

                        // idempotency: check if marks exist for these row_ids and grupo
                        const existsA = await this.db('conciliacao_marks').where({ base_id: baseId, row_id: ra.id, grupo }).first();
                        const existsB = await this.db('conciliacao_marks').where({ base_id: baseId, row_id: rb.id, grupo }).first();

                        if (!existsA) {
                            await this.db('conciliacao_marks').insert({ base_id: baseId, row_id: ra.id, status, grupo, chave, created_at: this.db.fn.now() });
                        }
                        if (!existsB) {
                            await this.db('conciliacao_marks').insert({ base_id: baseId, row_id: rb.id, status, grupo, chave, created_at: this.db.fn.now() });
                        }
                    }
                }
            }
        }
    }
}

export default EstornoBaseAStep;
