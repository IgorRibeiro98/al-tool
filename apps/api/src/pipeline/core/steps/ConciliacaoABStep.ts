import { PipelineStep, PipelineContext } from '../index';
import { Knex } from 'knex';

/*
    Conciliation step between Base A (contábil) and Base B (fiscal).
    Responsibilities:
    - load configuration and bases
    - ensure result table exists with key columns
    - collect marks and match/unmatch groups by configured keys
    - insert result rows in batches
*/

const RESULT_INSERT_CHUNK = 200;
const EPSILON = 1e-6;

const STATUS_CONCILIADO = '01_Conciliado';
const STATUS_FOUND_DIFF = '02_Encontrado c/Diferença';
const STATUS_NOT_FOUND = '03_Não Encontrado';

const LABEL_CONCILIADO = 'Conciliado';
const LABEL_DIFF_IMATERIAL = 'Diferença Imaterial';
const LABEL_NOT_FOUND = 'Não encontrado';

type ConfigConciliacaoRow = {
    id: number;
    base_contabil_id: number;
    base_fiscal_id: number;
    chaves_contabil?: string | null;
    chaves_fiscal?: string | null;
    coluna_conciliacao_contabil?: string | null;
    coluna_conciliacao_fiscal?: string | null;
    inverter_sinal_fiscal?: number | boolean | null;
    limite_diferenca_imaterial?: number | null;
};

type BaseRow = { id: number; tabela_sqlite?: string | null };

type MarkRow = { id: number; base_id: number; row_id: number; status?: string | null; grupo?: string | null; chave?: string | null };

type ResultEntry = Record<string, any>;

export class ConciliacaoABStep implements PipelineStep {
    name = 'ConciliacaoAB';

    constructor(private readonly db: Knex) {}

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

    private parseChaves(raw?: string | null): Record<string, string[]> {
        if (!raw) return {};
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return { CHAVE_1: parsed };
            if (parsed && typeof parsed === 'object') return parsed as Record<string, string[]>;
        } catch (_) {
            // ignore parse errors and return empty
        }
        return {};
    }

    private buildComposite(row: any, cols?: string[] | undefined | null): string | null {
        if (!row || !cols || cols.length === 0) return null;
        return cols.map(c => String(row[c] ?? '')).join('_');
    }

    private normalizeAmount(value: number) {
        if (value === 0) return 0;
        return Number(Number(value).toFixed(6));
    }

    private async getRowFromTable(table: string, id: number, cache: Map<number, any>) {
        if (cache.has(id)) return cache.get(id);
        const row = await this.db.select('*').from(table).where({ id }).first();
        if (row) cache.set(id, row);
        return row ?? null;
    }

    private async ensureResultColumns(tableName: string, keys: string[]) {
        if (!keys || keys.length === 0) return;
        const exists = await this.db.schema.hasTable(tableName);
        if (!exists) return;
        for (const k of keys) {
            const has = await this.db.schema.hasColumn(tableName, k);
            if (!has) {
                await this.db.schema.alterTable(tableName, t => {
                    t.text(k).nullable();
                });
            }
        }
    }

    private async loadMarksForBases(baseAId: number, baseBId: number) {
        const rows = await this.db<MarkRow>('conciliacao_marks').whereIn('base_id', [baseAId, baseBId]).select('*');
        const marksA = new Map<number, MarkRow>();
        const marksB = new Map<number, MarkRow>();
        for (const m of rows) {
            const rid = Number(m.row_id);
            const markCopy = { ...m, row_id: rid } as MarkRow;
            if (m.base_id === baseAId && !marksA.has(rid)) marksA.set(rid, markCopy);
            if (m.base_id === baseBId && !marksB.has(rid)) marksB.set(rid, markCopy);
        }
        return { marksA, marksB } as { marksA: Map<number, MarkRow>; marksB: Map<number, MarkRow> };
    }

    private async findMatchedPairsForKey(tableA: string, tableB: string, aCols: string[], bCols: string[]) {
        const aAlias = 'a';
        const bAlias = 'b';
        const query = this.db
            .select(this.db.raw(`${aAlias}.id as a_row_id`), this.db.raw(`${bAlias}.id as b_row_id`))
            .from({ [aAlias]: tableA })
            .innerJoin({ [bAlias]: tableB }, function () {
                const maxLen = Math.max(aCols.length || 0, bCols.length || 0);
                for (let i = 0; i < maxLen; i++) {
                    const aKey = aCols[i] || aCols[0];
                    const bKey = bCols[i] || bCols[0];
                    if (aKey && bKey) this.on(`${aAlias}.${aKey}`, '=', `${bAlias}.${bKey}`);
                }
            });
        return query;
    }

    async execute(ctx: PipelineContext): Promise<void> {
        const cfgId = ctx.configConciliacaoId;
        if (!cfgId) return;

        const cfg = await this.db<ConfigConciliacaoRow>('configs_conciliacao').where({ id: cfgId }).first();
        if (!cfg) return;

        const baseAId = ctx.baseContabilId ?? cfg.base_contabil_id;
        const baseBId = ctx.baseFiscalId ?? cfg.base_fiscal_id;
        if (!baseAId || !baseBId) return;

        const baseA = await this.db<BaseRow>('bases').where({ id: baseAId }).first();
        const baseB = await this.db<BaseRow>('bases').where({ id: baseBId }).first();
        if (!baseA || !baseA.tabela_sqlite || !baseB || !baseB.tabela_sqlite) return;

        const tableA = baseA.tabela_sqlite as string;
        const tableB = baseB.tabela_sqlite as string;

        const chavesContabil = this.parseChaves(cfg.chaves_contabil);
        const chavesFiscal = this.parseChaves(cfg.chaves_fiscal);

        const keyIdentifiers = Array.from(new Set([...Object.keys(chavesContabil), ...Object.keys(chavesFiscal)]));

        const colA = cfg.coluna_conciliacao_contabil ?? undefined;
        const colB = cfg.coluna_conciliacao_fiscal ?? undefined;
        const inverter = !!cfg.inverter_sinal_fiscal;
        const limite = Number(cfg.limite_diferenca_imaterial || 0);

        const jobId = ctx.jobId;
        const resultTable = await this.ensureResultTable(jobId);
        await this.ensureResultColumns(resultTable, keyIdentifiers);

        const aRowCache = new Map<number, any>();
        const bRowCache = new Map<number, any>();

        const { marksA, marksB } = await this.loadMarksForBases(baseAId, baseBId);

        const inserts: ResultEntry[] = [];
        const matchedA = new Set<number>();
        const matchedB = new Set<number>();

        // Process pre-existing marks (A and B) first
        for (const [rowId, mark] of marksA.entries()) {
            const aRow = await this.getRowFromTable(tableA, rowId, aRowCache);
            if (!aRow) continue;
            const markKey = mark?.grupo ?? mark?.chave ?? null;
            const valueA = aRow && colA ? Number(aRow[colA]) || 0 : 0;
            const diff = valueA - 0;

            const entry: ResultEntry = {
                job_id: jobId,
                chave: markKey,
                status: mark.status,
                grupo: mark.grupo,
                a_row_id: rowId,
                b_row_id: null,
                a_values: JSON.stringify(aRow),
                b_values: null,
                value_a: valueA,
                value_b: 0,
                difference: diff,
                created_at: this.db.fn.now()
            };

            for (const kid of keyIdentifiers) entry[kid] = markKey ?? this.buildComposite(aRow, chavesContabil[kid]);

            inserts.push(entry);
            matchedA.add(rowId);
        }

        for (const [rowId, mark] of marksB.entries()) {
            const bRow = await this.getRowFromTable(tableB, rowId, bRowCache);
            if (!bRow) continue;
            const markKey = mark?.grupo ?? mark?.chave ?? null;
            const rawB = bRow && colB ? Number(bRow[colB]) || 0 : 0;
            const valueB = inverter ? -rawB : rawB;
            const diff = 0 - valueB;

            const entry: ResultEntry = {
                job_id: jobId,
                chave: markKey,
                status: mark.status,
                grupo: mark.grupo,
                a_row_id: null,
                b_row_id: rowId,
                a_values: null,
                b_values: JSON.stringify(bRow),
                value_a: 0,
                value_b: valueB,
                difference: diff,
                created_at: this.db.fn.now()
            };

            for (const kid of keyIdentifiers) entry[kid] = markKey ?? this.buildComposite(bRow, chavesFiscal[kid]);

            inserts.push(entry);
            matchedB.add(rowId);
        }

        // Helper to insert accumulated results in chunks
        const flushInserts = async () => {
            for (let i = 0; i < inserts.length; i += RESULT_INSERT_CHUNK) {
                const slice = inserts.slice(i, i + RESULT_INSERT_CHUNK);
                await this.db(resultTable).insert(slice);
            }
        };

        // Main grouping/conciliation per key
        for (const keyId of keyIdentifiers) {
            const aCols = chavesContabil[keyId] || [];
            const bCols = chavesFiscal[keyId] || [];
            if ((aCols.length === 0) && (bCols.length === 0)) continue;

            const rows = await this.findMatchedPairsForKey(tableA, tableB, aCols, bCols);

            // Build groups in memory keyed by `${keyId}|${chaveValor}`
            const groups = new Map<string, { keyId: string; chaveValor: string | null; aIds: Set<number>; bIds: Set<number> }>();

            for (const r of rows) {
                const a_row_id: number | null = r.a_row_id ? Number(r.a_row_id) : null;
                const b_row_id: number | null = r.b_row_id ? Number(r.b_row_id) : null;

                if (a_row_id !== null && matchedA.has(a_row_id)) continue;
                if (b_row_id !== null && matchedB.has(b_row_id)) continue;

                const aRow = a_row_id ? await this.getRowFromTable(tableA, a_row_id, aRowCache) : null;
                const bRow = b_row_id ? await this.getRowFromTable(tableB, b_row_id, bRowCache) : null;
                if (a_row_id && !aRow) continue;
                if (b_row_id && !bRow) continue;

                const chaveA = aRow ? this.buildComposite(aRow, aCols) : null;
                const chaveB = bRow ? this.buildComposite(bRow, bCols) : null;
                const chaveValor = chaveA ?? chaveB ?? null;
                const groupKey = `${keyId}|${chaveValor ?? ''}`;

                let group = groups.get(groupKey);
                if (!group) {
                    group = { keyId, chaveValor, aIds: new Set<number>(), bIds: new Set<number>() };
                    groups.set(groupKey, group);
                }

                if (a_row_id) group.aIds.add(a_row_id);
                if (b_row_id) group.bIds.add(b_row_id);
            }

            for (const [, group] of groups) {
                const { keyId: groupKeyId, aIds, bIds } = group;
                const hasA = aIds.size > 0;
                const hasB = bIds.size > 0;
                if (!hasA && !hasB) continue;

                let somaA = 0;
                let somaB = 0;

                for (const aId of aIds) {
                    const row = await this.getRowFromTable(tableA, aId, aRowCache);
                    if (!row) continue;
                    const valueA = colA ? Number(row[colA]) || 0 : 0;
                    somaA += valueA;
                }

                for (const bId of bIds) {
                    const row = await this.getRowFromTable(tableB, bId, bRowCache);
                    if (!row) continue;
                    const rawB = colB ? Number(row[colB]) || 0 : 0;
                    const valueB = inverter ? -rawB : rawB;
                    somaB += valueB;
                }

                somaA = this.normalizeAmount(somaA);
                somaB = this.normalizeAmount(somaB);
                const diffGroup = this.normalizeAmount(somaA - somaB);
                const absDiff = Math.abs(diffGroup);
                const limiteEfetivo = Math.max(limite, EPSILON);

                let status: string;
                let groupLabel: string;

                if (hasA && hasB) {
                    if (absDiff <= EPSILON) {
                        status = STATUS_CONCILIADO;
                        groupLabel = LABEL_CONCILIADO;
                    } else if (limite > 0 && absDiff <= limiteEfetivo) {
                        status = STATUS_FOUND_DIFF;
                        groupLabel = LABEL_DIFF_IMATERIAL;
                    } else if (diffGroup > 0) {
                        status = STATUS_FOUND_DIFF;
                        groupLabel = 'Encontrado com diferença, BASE A MAIOR';
                    } else {
                        status = STATUS_FOUND_DIFF;
                        groupLabel = 'Encontrado com diferença, BASE B MAIOR';
                    }
                } else {
                    status = STATUS_NOT_FOUND;
                    groupLabel = LABEL_NOT_FOUND;
                }

                // create entries for A
                for (const aId of aIds) {
                    if (matchedA.has(aId)) continue;
                    const row = await this.getRowFromTable(tableA, aId, aRowCache);
                    if (!row) continue;

                    const entry: ResultEntry = {
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

                    for (const kid of keyIdentifiers) entry[kid] = this.buildComposite(row, chavesContabil[kid]);

                    inserts.push(entry);
                    matchedA.add(aId);
                }

                // create entries for B
                for (const bId of bIds) {
                    if (matchedB.has(bId)) continue;
                    const row = await this.getRowFromTable(tableB, bId, bRowCache);
                    if (!row) continue;

                    const entry: ResultEntry = {
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

                    for (const kid of keyIdentifiers) entry[kid] = this.buildComposite(row, chavesFiscal[kid]);

                    inserts.push(entry);
                    matchedB.add(bId);
                }
            }
        }

        // Persist intermediate inserts
        await flushInserts();

        // Process unmatched A rows
        const processRemaining = async (table: string, matchedSet: Set<number>, cache: Map<number, any>, col: string | undefined, marksMap: Map<number, MarkRow>, chavesMap: Record<string, string[]>, keyDefault: string | null, isA: boolean) => {
            const remaining = matchedSet.size > 0 ? await this.db.select('*').from(table).whereNotIn('id', Array.from(matchedSet)) : await this.db.select('*').from(table);
            for (const row of remaining) {
                const id = row.id;
                if (!id) continue;
                if (!cache.has(id)) cache.set(id, row);

                const valueA = isA ? (col ? Number(row[col]) || 0 : 0) : 0;
                const rawB = !isA ? (col ? Number(row[col]) || 0 : 0) : 0;
                const valueB = !isA && cfg.inverter_sinal_fiscal ? -rawB : rawB;
                const diff = valueA - valueB;

                const mark = marksMap.get(id);

                const entry: ResultEntry = {
                    job_id: jobId,
                    chave: mark ? mark.chave ?? mark.grupo ?? null : keyDefault,
                    status: mark ? mark.status ?? STATUS_NOT_FOUND : STATUS_NOT_FOUND,
                    grupo: mark ? mark.grupo ?? LABEL_NOT_FOUND : LABEL_NOT_FOUND,
                    a_row_id: isA ? id : null,
                    b_row_id: isA ? null : id,
                    a_values: isA ? JSON.stringify(row) : null,
                    b_values: !isA ? JSON.stringify(row) : null,
                    value_a: valueA,
                    value_b: valueB,
                    difference: diff,
                    created_at: this.db.fn.now()
                };

                for (const kid of keyIdentifiers) {
                    entry[kid] = isA ? this.buildComposite(row, chavesContabil[kid]) : this.buildComposite(row, chavesFiscal[kid]);
                }

                await this.db(resultTable).insert(entry);
            }
        };

        const defaultKey = keyIdentifiers.length ? keyIdentifiers[0] : null;
        await processRemaining(tableA, matchedA, aRowCache, colA, marksA, chavesContabil, defaultKey, true);
        await processRemaining(tableB, matchedB, bRowCache, colB, marksB, chavesFiscal, defaultKey, false);
    }
}

export default ConciliacaoABStep;

