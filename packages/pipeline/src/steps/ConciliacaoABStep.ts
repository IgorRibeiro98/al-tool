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

        const parseChaves = (raw: any) => {
            try {
                const p = raw ? JSON.parse(raw) : {};
                if (Array.isArray(p)) return { CHAVE_1: p } as Record<string, string[]>;
                if (p && typeof p === 'object') return p as Record<string, string[]>;
                return {} as Record<string, string[]>;
            } catch {
                return {} as Record<string, string[]>;
            }
        };

        const chavesContabil = parseChaves(cfg.chaves_contabil);
        const chavesFiscal = parseChaves(cfg.chaves_fiscal);

        // ordered list of key identifiers (preserve insertion order)
        const keyIdentifiers = Array.from(new Set([...Object.keys(chavesContabil || {}), ...Object.keys(chavesFiscal || {})]));

        const colA = cfg.coluna_conciliacao_contabil;
        const colB = cfg.coluna_conciliacao_fiscal;
        const inverter = !!cfg.inverter_sinal_fiscal;
        const limite = Number(cfg.limite_diferenca_imaterial || 0);

        const jobId = ctx.jobId;
        const resultTable = await this.ensureResultTable(jobId);

        // ensure result table has columns for each key identifier (if table already exists this is a no-op here)
        const exists = await this.db.schema.hasTable(resultTable);
        if (exists) {
            // add missing columns if necessary
            for (const k of keyIdentifiers) {
                const has = await this.db.schema.hasColumn(resultTable, k);
                if (!has) {
                    await this.db.schema.alterTable(resultTable, t => {
                        t.text(k).nullable();
                    });
                }
            }
        }

        // We'll perform matching per configured key identifier (first-match-wins).

        // Load marks for both bases so we can include marked rows in the results
        const marksRows: any[] = await this.db('conciliacao_marks').whereIn('base_id', [baseAId, baseBId]).select('*');
        const marksA = new Map<number, any>();
        const marksB = new Map<number, any>();
        for (const m of marksRows) {
            if (m.base_id === baseAId) marksA.set(m.row_id, m);
            if (m.base_id === baseBId) marksB.set(m.row_id, m);
        }

        const inserts: any[] = [];

        // We'll iterate keyIdentifiers in order and perform matches per key. First match wins.
        const matchedA = new Set<number>();
        const matchedB = new Set<number>();

        const buildComposite = (row: any, cols?: string[]) => {
            if (!row || !cols || !cols.length) return null;
            try { return cols.map(c => String(row[c] ?? '')).join('_'); } catch { return null; }
        };

        for (const keyId of keyIdentifiers) {
            const aCols = chavesContabil[keyId] || [];
            const bCols = chavesFiscal[keyId] || [];
            if ((!aCols || aCols.length === 0) && (!bCols || bCols.length === 0)) continue;

            const aAlias = 'a';
            const bAlias = 'b';

            // inner join on all pair columns for this keyId
            const query = this.db.select(
                this.db.raw(`${aAlias}.id as a_row_id`),
                this.db.raw(`${bAlias}.id as b_row_id`),
                this.db.raw(`${aAlias}.*`),
                this.db.raw(`${bAlias}.*`)
            ).from({ [aAlias]: tableA })
                .innerJoin({ [bAlias]: tableB }, function () {
                    const maxLen = Math.max(aCols.length || 0, bCols.length || 0);
                    for (let i = 0; i < maxLen; i++) {
                        const aKey = aCols[i] || aCols[0];
                        const bKey = bCols[i] || bCols[0];
                        if (aKey && bKey) this.on(`${aAlias}.${aKey}`, '=', `${bAlias}.${bKey}`);
                    }
                });

            const rows = await query;

            for (const r of rows) {
                const a_row_id = r.a_row_id || null;
                const b_row_id = r.b_row_id || null;
                if (a_row_id && matchedA.has(a_row_id)) continue;
                if (b_row_id && matchedB.has(b_row_id)) continue;

                const aRow = a_row_id ? await this.db.select('*').from(tableA).where({ id: a_row_id }).first() : null;
                const bRow = b_row_id ? await this.db.select('*').from(tableB).where({ id: b_row_id }).first() : null;

                const valueA = aRow && colA ? Number(aRow[colA]) || 0 : 0;
                const valueB_raw = bRow && colB ? Number(bRow[colB]) || 0 : 0;
                const valueB = inverter ? -valueB_raw : valueB_raw;
                const diff = valueA - valueB;

                const aMark = a_row_id ? marksA.get(a_row_id) : null;
                const bMark = b_row_id ? marksB.get(b_row_id) : null;

                let status = null as string | null;
                let group = null as string | null;
                let chave = null as string | null;

                const entry: any = {
                    job_id: jobId,
                    chave: null,
                    status: null,
                    grupo: null,
                    a_row_id,
                    b_row_id,
                    a_values: aRow ? JSON.stringify(aRow) : null,
                    b_values: bRow ? JSON.stringify(bRow) : null,
                    value_a: valueA,
                    value_b: valueB,
                    difference: diff,
                    created_at: this.db.fn.now()
                };

                if (aMark || bMark) {
                    const mark = aMark || bMark;
                    entry.status = mark.status;
                    entry.grupo = mark.grupo;
                    entry.chave = mark.chave;
                    // populate key columns
                    for (const kid of keyIdentifiers) {
                        entry[kid] = aRow ? buildComposite(aRow, chavesContabil[kid]) : (bRow ? buildComposite(bRow, chavesFiscal[kid]) : null);
                    }
                    inserts.push(entry);
                    if (a_row_id) matchedA.add(a_row_id);
                    if (b_row_id) matchedB.add(b_row_id);
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
                    chave = keyId;
                } else {
                    status = '03_Não Encontrado';
                    group = 'Não encontrado';
                    chave = aRow ? keyId : (bRow ? keyId : null);
                }

                entry.status = status;
                entry.grupo = group;
                entry.chave = chave;
                for (const kid of keyIdentifiers) {
                    entry[kid] = aRow ? buildComposite(aRow, chavesContabil[kid]) : (bRow ? buildComposite(bRow, chavesFiscal[kid]) : null);
                }

                inserts.push(entry);
                if (a_row_id) matchedA.add(a_row_id);
                if (b_row_id) matchedB.add(b_row_id);
            }
        }

        // insert results in chunks
        const chunk = 200;
        for (let i = 0; i < inserts.length; i += chunk) {
            const slice = inserts.slice(i, i + chunk);
            await this.db(resultTable).insert(slice);
        }

        // Now handle remaining A-only rows (not matched)
        if (matchedA.size > 0) {
            const unmatchedA = await this.db.select('id').from(tableA).whereNotIn('id', Array.from(matchedA));
            for (const r of unmatchedA) {
                const aRow = await this.db.select('*').from(tableA).where({ id: r.id }).first();
                const valueA = aRow && colA ? Number(aRow[colA]) || 0 : 0;
                const valueB = 0;
                const diff = valueA - valueB;
                const aMark = marksA.get(r.id);
                const entry: any = {
                    job_id: jobId,
                    chave: null,
                    status: null,
                    grupo: null,
                    a_row_id: r.id,
                    b_row_id: null,
                    a_values: aRow ? JSON.stringify(aRow) : null,
                    b_values: null,
                    value_a: valueA,
                    value_b: valueB,
                    difference: diff,
                    created_at: this.db.fn.now()
                };
                if (aMark) {
                    entry.status = aMark.status;
                    entry.grupo = aMark.grupo;
                    entry.chave = aMark.chave;
                } else {
                    entry.status = '03_Não Encontrado';
                    entry.grupo = 'Não encontrado';
                    entry.chave = keyIdentifiers.length ? keyIdentifiers[0] : null;
                }
                for (const kid of keyIdentifiers) entry[kid] = buildComposite(aRow, chavesContabil[kid]);
                await this.db(resultTable).insert(entry);
            }
        } else {
            // no matched at all: insert all A rows as not found
            const allA = await this.db.select('*').from(tableA);
            for (const aRow of allA) {
                const valueA = aRow && colA ? Number(aRow[colA]) || 0 : 0;
                const valueB = 0;
                const diff = valueA - valueB;
                const aMark = marksA.get(aRow.id);
                const entry: any = {
                    job_id: jobId,
                    chave: null,
                    status: null,
                    grupo: null,
                    a_row_id: aRow.id,
                    b_row_id: null,
                    a_values: aRow ? JSON.stringify(aRow) : null,
                    b_values: null,
                    value_a: valueA,
                    value_b: valueB,
                    difference: diff,
                    created_at: this.db.fn.now()
                };
                if (aMark) {
                    entry.status = aMark.status;
                    entry.grupo = aMark.grupo;
                    entry.chave = aMark.chave;
                } else {
                    entry.status = '03_Não Encontrado';
                    entry.grupo = 'Não encontrado';
                    entry.chave = keyIdentifiers.length ? keyIdentifiers[0] : null;
                }
                for (const kid of keyIdentifiers) entry[kid] = buildComposite(aRow, chavesContabil[kid]);
                await this.db(resultTable).insert(entry);
            }
        }

        // Handle remaining B-only rows
        if (matchedB.size > 0) {
            const unmatchedB = await this.db.select('id').from(tableB).whereNotIn('id', Array.from(matchedB));
            for (const r of unmatchedB) {
                const bRow = await this.db.select('*').from(tableB).where({ id: r.id }).first();
                const valueA = 0;
                const valueB_raw = bRow && colB ? Number(bRow[colB]) || 0 : 0;
                const valueB = inverter ? -valueB_raw : valueB_raw;
                const diff = valueA - valueB;
                const bMark = marksB.get(r.id);
                const entry: any = {
                    job_id: jobId,
                    chave: null,
                    status: null,
                    grupo: null,
                    a_row_id: null,
                    b_row_id: r.id,
                    a_values: null,
                    b_values: bRow ? JSON.stringify(bRow) : null,
                    value_a: valueA,
                    value_b: valueB,
                    difference: diff,
                    created_at: this.db.fn.now()
                };
                if (bMark) {
                    entry.status = bMark.status;
                    entry.grupo = bMark.grupo;
                    entry.chave = bMark.chave;
                } else {
                    entry.status = '03_Não Encontrado';
                    entry.grupo = 'Não encontrado';
                    entry.chave = keyIdentifiers.length ? keyIdentifiers[0] : null;
                }
                for (const kid of keyIdentifiers) entry[kid] = buildComposite(bRow, chavesFiscal[kid]);
                await this.db(resultTable).insert(entry);
            }
        } else {
            const allB = await this.db.select('*').from(tableB);
            for (const bRow of allB) {
                const valueA = 0;
                const valueB_raw = bRow && colB ? Number(bRow[colB]) || 0 : 0;
                const valueB = inverter ? -valueB_raw : valueB_raw;
                const diff = valueA - valueB;
                const bMark = marksB.get(bRow.id);
                const entry: any = {
                    job_id: jobId,
                    chave: null,
                    status: null,
                    grupo: null,
                    a_row_id: null,
                    b_row_id: bRow.id,
                    a_values: null,
                    b_values: bRow ? JSON.stringify(bRow) : null,
                    value_a: valueA,
                    value_b: valueB,
                    difference: diff,
                    created_at: this.db.fn.now()
                };
                if (bMark) {
                    entry.status = bMark.status;
                    entry.grupo = bMark.grupo;
                    entry.chave = bMark.chave;
                } else {
                    entry.status = '03_Não Encontrado';
                    entry.grupo = 'Não encontrado';
                    entry.chave = keyIdentifiers.length ? keyIdentifiers[0] : null;
                }
                for (const kid of keyIdentifiers) entry[kid] = buildComposite(bRow, chavesFiscal[kid]);
                await this.db(resultTable).insert(entry);
            }
        }
    }
}

export default ConciliacaoABStep;
