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
const PAGE_SIZE = 1000;
const MATCHED_NOTIN_THRESHOLD = 5000;
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

    // Resolve keys for a given configs_conciliacao id using linking table + central keys
    private async resolveConfigKeys(configId: number, baseA: BaseRow, baseB: BaseRow) {
        // load link rows ordered by ordem then id
        const links = await this.db('configs_conciliacao_keys')
            .where({ config_conciliacao_id: configId })
            .orderBy('ordem', 'asc')
            .orderBy('id', 'asc');

        const keyIdentifiers: string[] = [];
        const chavesContabil: Record<string, string[]> = {};
        const chavesFiscal: Record<string, string[]> = {};

        if (!links || links.length === 0) return { keyIdentifiers, chavesContabil, chavesFiscal };

        // collect ids to fetch in bulk
        const pairIds: number[] = [];
        const defIds: number[] = [];
        for (const l of links) {
            if (l.keys_pair_id) pairIds.push(l.keys_pair_id);
            if (l.contabil_key_id) defIds.push(l.contabil_key_id);
            if (l.fiscal_key_id) defIds.push(l.fiscal_key_id);
        }

        // also include defs referenced by pairs
        let pairsMap: Record<number, any> = {};
        if (pairIds.length) {
            const pairs = await this.db('keys_pairs').whereIn('id', pairIds).select('*');
            pairsMap = {};
            for (const p of pairs) {
                pairsMap[p.id] = p;
                if (p.contabil_key_id) defIds.push(p.contabil_key_id);
                if (p.fiscal_key_id) defIds.push(p.fiscal_key_id);
            }
        }

        const uniqueDefIds = Array.from(new Set(defIds.filter(Boolean)));
        const defsMap: Record<number, any> = {};
        if (uniqueDefIds.length) {
            const defs = await this.db('keys_definitions').whereIn('id', uniqueDefIds).select('*');
            for (const d of defs) defsMap[d.id] = d;
        }

        // helper to parse columns field into string[]
        const parseCols = (val: any) => {
            if (!val) return [] as string[];
            try {
                return Array.isArray(val) ? val : (typeof val === 'string' ? JSON.parse(val) : []);
            } catch (_) { return [] as string[]; }
        };

        // iterate links in order
        for (const l of links) {
            const kid = String(l.key_identifier || '').trim();
            if (!kid) continue;
            keyIdentifiers.push(kid);

            let contDef: any = null;
            let fiscDef: any = null;

            if (l.keys_pair_id) {
                const pair = pairsMap[l.keys_pair_id];
                if (!pair) throw new Error(`keys_pair ${l.keys_pair_id} not found for config ${configId}`);
                contDef = pair.contabil_key_id ? defsMap[pair.contabil_key_id] : null;
                fiscDef = pair.fiscal_key_id ? defsMap[pair.fiscal_key_id] : null;
            } else {
                contDef = l.contabil_key_id ? defsMap[l.contabil_key_id] : null;
                fiscDef = l.fiscal_key_id ? defsMap[l.fiscal_key_id] : null;
            }

            if (!contDef) throw new Error(`Contabil key not found for key_identifier ${kid}`);
            if (!fiscDef) throw new Error(`Fiscal key not found for key_identifier ${kid}`);

            // validate base_tipo
            if ((contDef.base_tipo || '').toUpperCase() !== 'CONTABIL') throw new Error(`Chave ${kid} (contabil) não é do tipo CONTABIL`);
            if ((fiscDef.base_tipo || '').toUpperCase() !== 'FISCAL') throw new Error(`Chave ${kid} (fiscal) não é do tipo FISCAL`);

            // validate subtype compatibility if present
            const contSub = contDef.base_subtipo || null;
            const fiscSub = fiscDef.base_subtipo || null;
            const baseASub = (baseA as any).subtype || null;
            const baseBSub = (baseB as any).subtype || null;
            if (contSub && baseASub && contSub !== baseASub) throw new Error(`Chave ${kid} não é compatível com base contábil (subtipo)`);
            if (fiscSub && baseBSub && fiscSub !== baseBSub) throw new Error(`Chave ${kid} não é compatível com base fiscal (subtipo)`);

            chavesContabil[kid] = parseCols(contDef.columns || contDef.columns_json || contDef.columns_text);
            chavesFiscal[kid] = parseCols(fiscDef.columns || fiscDef.columns_json || fiscDef.columns_text);
        }

        return { keyIdentifiers, chavesContabil, chavesFiscal };
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

    // Batch fetch rows by ids and populate cache to avoid N queries
    private async fetchRowsBatch(table: string, ids: number[], cache: Map<number, any>) {
        const missing = ids.filter(id => !cache.has(id));
        if (!missing || missing.length === 0) return;
        const rows = await this.db.select('*').from(table).whereIn('id', missing as number[]);
        for (const r of rows) {
            cache.set(Number(r.id), r);
        }
    }

    private async ensureResultColumns(tableName: string, keys: string[]) {
        if (!keys || keys.length === 0) return;
        const exists = await this.db.schema.hasTable(tableName);
        if (!exists) return;
        // minimize DDL calls: get existing columns once and alter table adding all missing
        const info = await this.db(tableName).columnInfo();
        const missing = keys.filter(k => !(k in info));
        if (missing.length === 0) return;
        await this.db.schema.alterTable(tableName, t => {
            for (const k of missing) t.text(k).nullable();
        });
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

        // Resolve keys from central linking table; fall back to legacy inline chaves only if no links present
        let chavesContabil: Record<string, string[]> = {};
        let chavesFiscal: Record<string, string[]> = {};
        let keyIdentifiers: string[] = [];
        try {
            const resolved = await this.resolveConfigKeys(cfg.id, baseA, baseB);
            if (resolved && resolved.keyIdentifiers && resolved.keyIdentifiers.length) {
                chavesContabil = resolved.chavesContabil;
                chavesFiscal = resolved.chavesFiscal;
                keyIdentifiers = resolved.keyIdentifiers;
            } else {
                chavesContabil = this.parseChaves(cfg.chaves_contabil);
                chavesFiscal = this.parseChaves(cfg.chaves_fiscal);
                keyIdentifiers = Array.from(new Set([...Object.keys(chavesContabil), ...Object.keys(chavesFiscal)]));
            }
        } catch (err: any) {
            // If resolution fails, abort the step with an error
            throw new Error(`Failed to resolve config keys for config ${cfgId}: ${(err && err.message) || err}`);
        }

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

        // Helper to insert accumulated results in chunks inside a transaction
        const flushInserts = async () => {
            if (inserts.length === 0) return;
            const trx = await this.db.transaction();
            try {
                for (let i = 0; i < inserts.length; i += RESULT_INSERT_CHUNK) {
                    const slice = inserts.slice(i, i + RESULT_INSERT_CHUNK);
                    await trx<ResultEntry>(resultTable).insert(slice);
                }
                await trx.commit();
                inserts.length = 0; // clear
            } catch (err) {
                await trx.rollback();
                throw err;
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

        // Process unmatched rows in a paginated way to avoid loading entire tables or huge whereNotIn lists
        const processRemaining = async (table: string, matchedSet: Set<number>, cache: Map<number, any>, col: string | undefined, marksMap: Map<number, MarkRow>, chavesMap: Record<string, string[]>, keyDefault: string | null, isA: boolean) => {
            let lastId = 0;
            const joinSide = isA ? 'a_row_id' : 'b_row_id';
            while (true) {
                const dbRef = this.db;
                // Build base query to fetch a page of rows that are not yet present in result for this job
                const pageQuery = this.db.select(`${table}.*`).from(table)
                    .leftJoin(resultTable, function () {
                        this.on(`${table}.id`, '=', `${resultTable}.${joinSide}`)
                            .andOn(`${resultTable}.job_id`, '=', dbRef.raw('?', [jobId]));
                    })
                    .whereNull(`${resultTable}.${joinSide}`)
                    .andWhere(`${table}.id`, '>', lastId)
                    .orderBy(`${table}.id`, 'asc')
                    .limit(PAGE_SIZE);

                const rows: any[] = await pageQuery;
                if (!rows || rows.length === 0) break;

                const ids = rows.map(r => Number(r.id)).filter(Boolean) as number[];
                await this.fetchRowsBatch(table, ids, cache);

                for (const row of rows) {
                    const id = Number(row.id);
                    if (!id) continue;

                    const cached = cache.get(id) ?? row;

                    const valueA = isA ? (col ? Number(cached[col] ?? 0) || 0 : 0) : 0;
                    const rawB = !isA ? (col ? Number(cached[col] ?? 0) || 0 : 0) : 0;
                    const valueB = !isA && inverter ? -rawB : rawB;
                    const diff = valueA - valueB;

                    const mark = marksMap.get(id);

                    const entry: ResultEntry = {
                        job_id: jobId,
                        chave: mark ? mark.chave ?? mark.grupo ?? null : keyDefault,
                        status: mark ? mark.status ?? STATUS_NOT_FOUND : STATUS_NOT_FOUND,
                        grupo: mark ? mark.grupo ?? LABEL_NOT_FOUND : LABEL_NOT_FOUND,
                        a_row_id: isA ? id : null,
                        b_row_id: isA ? null : id,
                        a_values: isA ? JSON.stringify(cached) : null,
                        b_values: !isA ? JSON.stringify(cached) : null,
                        value_a: valueA,
                        value_b: valueB,
                        difference: diff,
                        created_at: this.db.fn.now()
                    };

                    for (const kid of keyIdentifiers) {
                        entry[kid] = isA ? this.buildComposite(cached, chavesContabil[kid]) : this.buildComposite(cached, chavesFiscal[kid]);
                    }

                    inserts.push(entry);
                    // flush periodically to keep memory bounded
                    if (inserts.length >= RESULT_INSERT_CHUNK) await flushInserts();
                }

                lastId = Number(rows[rows.length - 1].id) || lastId;
                if (rows.length < PAGE_SIZE) break; // last page
            }
            // flush any remaining
            if (inserts.length > 0) await flushInserts();
        };

        const defaultKey = keyIdentifiers.length ? keyIdentifiers[0] : null;
        await processRemaining(tableA, matchedA, aRowCache, colA, marksA, chavesContabil, defaultKey, true);
        await processRemaining(tableB, matchedB, bRowCache, colB, marksB, chavesFiscal, defaultKey, false);
    }
}

export default ConciliacaoABStep;

