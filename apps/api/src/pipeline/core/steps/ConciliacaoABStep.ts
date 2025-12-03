import { PipelineStep, PipelineContext } from '../index';
import { Knex } from 'knex';

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

        const baseAId = ctx.baseContabilId ?? cfg.base_contabil_id;
        const baseBId = ctx.baseFiscalId ?? cfg.base_fiscal_id;
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

        const keyIdentifiers = Array.from(
            new Set([
                ...Object.keys(chavesContabil || {}),
                ...Object.keys(chavesFiscal || {})
            ])
        );

        const colA = cfg.coluna_conciliacao_contabil;
        const colB = cfg.coluna_conciliacao_fiscal;
        const inverter = !!cfg.inverter_sinal_fiscal;
        const limite = Number(cfg.limite_diferenca_imaterial || 0);

        const jobId = ctx.jobId;
        const resultTable = await this.ensureResultTable(jobId);

        const exists = await this.db.schema.hasTable(resultTable);
        if (exists) {
            for (const k of keyIdentifiers) {
                const has = await this.db.schema.hasColumn(resultTable, k);
                if (!has) {
                    await this.db.schema.alterTable(resultTable, t => {
                        t.text(k).nullable();
                    });
                }
            }
        }

        const buildComposite = (row: any, cols?: string[]) => {
            if (!row || !cols || !cols.length) return null;
            try {
                return cols.map(c => String(row[c] ?? '')).join('_');
            } catch {
                return null;
            }
        };

        const inserts: any[] = [];
        const matchedA = new Set<number>();
        const matchedB = new Set<number>();

        const aRowCache = new Map<number, any>();
        const bRowCache = new Map<number, any>();

        const getARow = async (id: number): Promise<any | null> => {
            if (aRowCache.has(id)) return aRowCache.get(id);
            const row = await this.db.select('*').from(tableA).where({ id }).first();
            if (row) aRowCache.set(id, row);
            return row ?? null;
        };

        const getBRow = async (id: number): Promise<any | null> => {
            if (bRowCache.has(id)) return bRowCache.get(id);
            const row = await this.db.select('*').from(tableB).where({ id }).first();
            if (row) bRowCache.set(id, row);
            return row ?? null;
        };

        const marksRows: any[] = await this.db('conciliacao_marks')
            .whereIn('base_id', [baseAId, baseBId])
            .select('*');

        const marksA = new Map<number, any>();
        const marksB = new Map<number, any>();
        for (const m of marksRows) {
            if (m.base_id === baseAId && !marksA.has(m.row_id)) {
                marksA.set(m.row_id, m);
            }
            if (m.base_id === baseBId && !marksB.has(m.row_id)) {
                marksB.set(m.row_id, m);
            }
        }

        for (const [rowId, mark] of marksA.entries()) {
            const aRow = await getARow(rowId);
            if (!aRow) continue;

            const valueA = aRow && colA ? Number(aRow[colA]) || 0 : 0;
            const valueB = 0;
            const diff = valueA - valueB;

            const entry: any = {
                job_id: jobId,
                chave: mark.chave,
                status: mark.status,
                grupo: mark.grupo,
                a_row_id: rowId,
                b_row_id: null,
                a_values: JSON.stringify(aRow),
                b_values: null,
                value_a: valueA,
                value_b: valueB,
                difference: diff,
                created_at: this.db.fn.now()
            };

            for (const kid of keyIdentifiers) {
                entry[kid] = buildComposite(aRow, chavesContabil[kid]);
            }

            inserts.push(entry);
            matchedA.add(rowId);
        }

        for (const [rowId, mark] of marksB.entries()) {
            const bRow = await getBRow(rowId);
            if (!bRow) continue;

            const valueA = 0;
            const rawB = bRow && colB ? Number(bRow[colB]) || 0 : 0;
            const valueB = inverter ? -rawB : rawB;
            const diff = valueA - valueB;

            const entry: any = {
                job_id: jobId,
                chave: mark.chave,
                status: mark.status,
                grupo: mark.grupo,
                a_row_id: null,
                b_row_id: rowId,
                a_values: null,
                b_values: JSON.stringify(bRow),
                value_a: valueA,
                value_b: valueB,
                difference: diff,
                created_at: this.db.fn.now()
            };

            for (const kid of keyIdentifiers) {
                entry[kid] = buildComposite(bRow, chavesFiscal[kid]);
            }

            inserts.push(entry);
            matchedB.add(rowId);
        }

        interface GroupData {
            keyId: string;
            chaveValor: string | null;
            aIds: Set<number>;
            bIds: Set<number>;
        }

        const normalizeAmount = (value: number) => {
            if (value === 0) return 0;
            return Number(Number(value).toFixed(6));
        };
        const EPSILON = 1e-6;

        for (const keyId of keyIdentifiers) {
            const aCols = chavesContabil[keyId] || [];
            const bCols = chavesFiscal[keyId] || [];
            if ((!aCols || aCols.length === 0) && (!bCols || bCols.length === 0)) continue;

            const aAlias = 'a';
            const bAlias = 'b';

            const rows = await this.db
                .select(
                    this.db.raw(`${aAlias}.id as a_row_id`),
                    this.db.raw(`${bAlias}.id as b_row_id`)
                )
                .from({ [aAlias]: tableA })
                .innerJoin({ [bAlias]: tableB }, function () {
                    const maxLen = Math.max(aCols.length || 0, bCols.length || 0);
                    for (let i = 0; i < maxLen; i++) {
                        const aKey = aCols[i] || aCols[0];
                        const bKey = bCols[i] || bCols[0];
                        if (aKey && bKey) {
                            this.on(`${aAlias}.${aKey}`, '=', `${bAlias}.${bKey}`);
                        }
                    }
                });

            const groups = new Map<string, GroupData>();

            for (const r of rows) {
                const a_row_id: number | null = r.a_row_id || null;
                const b_row_id: number | null = r.b_row_id || null;

                if (a_row_id && matchedA.has(a_row_id)) continue;
                if (b_row_id && matchedB.has(b_row_id)) continue;

                let aRow: any = null;
                let bRow: any = null;

                if (a_row_id) {
                    aRow = await getARow(a_row_id);
                    if (!aRow) continue;
                }
                if (b_row_id) {
                    bRow = await getBRow(b_row_id);
                    if (!bRow) continue;
                }

                const chaveA = aRow ? buildComposite(aRow, aCols) : null;
                const chaveB = bRow ? buildComposite(bRow, bCols) : null;
                const chaveValor = chaveA ?? chaveB ?? null;
                const groupKey = `${keyId}|${chaveValor ?? ''}`;

                let group = groups.get(groupKey);
                if (!group) {
                    group = {
                        keyId,
                        chaveValor,
                        aIds: new Set<number>(),
                        bIds: new Set<number>()
                    };
                    groups.set(groupKey, group);
                }

                if (a_row_id && !group.aIds.has(a_row_id)) {
                    group.aIds.add(a_row_id);
                }

                if (b_row_id && !group.bIds.has(b_row_id)) {
                    group.bIds.add(b_row_id);
                }
            }

            for (const [, group] of groups) {
                const { keyId: groupKeyId, aIds, bIds } = group;

                const hasBaseA = aIds.size > 0;
                const hasBaseB = bIds.size > 0;
                if (!hasBaseA && !hasBaseB) continue;

                let somaA = 0;
                let somaB = 0;

                for (const aId of aIds.values()) {
                    const row = await getARow(aId);
                    if (!row) continue;
                    const valueA = colA ? Number(row[colA]) || 0 : 0;
                    somaA += valueA;
                }

                for (const bId of bIds.values()) {
                    const row = await getBRow(bId);
                    if (!row) continue;
                    const rawB = colB ? Number(row[colB]) || 0 : 0;
                    const valueB = inverter ? -rawB : rawB;
                    somaB += valueB;
                }

                somaA = normalizeAmount(somaA);
                somaB = normalizeAmount(somaB);
                const diffGroup = normalizeAmount(somaA - somaB);
                const absDiff = Math.abs(diffGroup);
                const limiteEfetivo = Math.max(limite, EPSILON);

                let status: string | null = null;
                let groupLabel: string | null = null;

                if (hasBaseA && hasBaseB) {
                    if (absDiff <= EPSILON) {
                        status = '01_Conciliado';
                        groupLabel = 'Conciliado';
                    } else if (limite > 0 && absDiff <= limiteEfetivo) {
                        status = '02_Encontrado c/Diferença';
                        groupLabel = 'Diferença Imaterial';
                    } else if (diffGroup > 0) {
                        status = '02_Encontrado c/Diferença';
                        groupLabel = 'Encontrado com diferença, BASE A MAIOR';
                    } else {
                        status = '02_Encontrado c/Diferença';
                        groupLabel = 'Encontrado com diferença, BASE B MAIOR';
                    }
                } else if (hasBaseA || hasBaseB) {
                    status = '03_Não Encontrado';
                    groupLabel = 'Não encontrado';
                } else {
                    continue;
                }

                for (const aId of aIds.values()) {
                    if (matchedA.has(aId)) continue;
                    const row = await getARow(aId);
                    if (!row) continue;

                    const entry: any = {
                        job_id: jobId,
                        chave: groupKeyId,
                        status,
                        grupo: groupLabel,
                        a_row_id: aId,
                        b_row_id: null,
                        a_values: JSON.stringify(row),
                        b_values: null,
                        value_a: somaA,
                        value_b: somaB,
                        difference: diffGroup,
                        created_at: this.db.fn.now()
                    };

                    for (const kid of keyIdentifiers) {
                        entry[kid] = buildComposite(row, chavesContabil[kid]);
                    }

                    inserts.push(entry);
                    matchedA.add(aId);
                }

                for (const bId of bIds.values()) {
                    if (matchedB.has(bId)) continue;
                    const row = await getBRow(bId);
                    if (!row) continue;

                    const entry: any = {
                        job_id: jobId,
                        chave: groupKeyId,
                        status,
                        grupo: groupLabel,
                        a_row_id: null,
                        b_row_id: bId,
                        a_values: null,
                        b_values: JSON.stringify(row),
                        value_a: somaA,
                        value_b: somaB,
                        difference: diffGroup,
                        created_at: this.db.fn.now()
                    };

                    for (const kid of keyIdentifiers) {
                        entry[kid] = buildComposite(row, chavesFiscal[kid]);
                    }

                    inserts.push(entry);
                    matchedB.add(bId);
                }
            }
        }

        const chunk = 200;
        for (let i = 0; i < inserts.length; i += chunk) {
            const slice = inserts.slice(i, i + chunk);
            await this.db(resultTable).insert(slice);
        }

        const processUnmatchedA = async () => {
            let remainingA: any[];

            if (matchedA.size > 0) {
                remainingA = await this.db
                    .select('*')
                    .from(tableA)
                    .whereNotIn('id', Array.from(matchedA));
            } else {
                remainingA = await this.db.select('*').from(tableA);
            }

            for (const aRow of remainingA) {
                const id = aRow.id;
                if (!id) continue;

                if (!aRowCache.has(id)) {
                    aRowCache.set(id, aRow);
                }

                const valueA = aRow && colA ? Number(aRow[colA]) || 0 : 0;
                const valueB = 0;
                const diff = valueA - valueB;
                const aMark = marksA.get(id);

                const entry: any = {
                    job_id: jobId,
                    chave: null,
                    status: null,
                    grupo: null,
                    a_row_id: id,
                    b_row_id: null,
                    a_values: JSON.stringify(aRow),
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

                for (const kid of keyIdentifiers) {
                    entry[kid] = buildComposite(aRow, chavesContabil[kid]);
                }

                await this.db(resultTable).insert(entry);
            }
        };

        const processUnmatchedB = async () => {
            let remainingB: any[];

            if (matchedB.size > 0) {
                remainingB = await this.db
                    .select('*')
                    .from(tableB)
                    .whereNotIn('id', Array.from(matchedB));
            } else {
                remainingB = await this.db.select('*').from(tableB);
            }

            for (const bRow of remainingB) {
                const id = bRow.id;
                if (!id) continue;

                if (!bRowCache.has(id)) {
                    bRowCache.set(id, bRow);
                }

                const valueA = 0;
                const rawB = bRow && colB ? Number(bRow[colB]) || 0 : 0;
                const valueB = inverter ? -rawB : rawB;
                const diff = valueA - valueB;
                const bMark = marksB.get(id);

                const entry: any = {
                    job_id: jobId,
                    chave: null,
                    status: null,
                    grupo: null,
                    a_row_id: null,
                    b_row_id: id,
                    a_values: null,
                    b_values: JSON.stringify(bRow),
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

                for (const kid of keyIdentifiers) {
                    entry[kid] = buildComposite(bRow, chavesFiscal[kid]);
                }

                await this.db(resultTable).insert(entry);
            }
        };

        await processUnmatchedA();
        await processUnmatchedB();
    }
}

export default ConciliacaoABStep;
