import { PipelineStep, PipelineContext } from '../index';
import { Knex } from 'knex';

/*
    Conciliation step between Base A (contábil) and Base B (fiscal).
    Responsibilities:
    - load configuration and bases
    - ensure result table exists with key columns
    - collect marks and match/unmatch groups by configured keys
    - insert result rows in batches

    MEMORY OPTIMIZATIONS (2025-01):
    - Paginated JOIN processing instead of loading all matched pairs
    - Limited row caching with periodic clearing
    - Reduced a_values/b_values storage to essential columns only
    - Batch inserts with frequent flushes
    - Stream-based processing for large datasets
*/

const LOG_PREFIX = '[ConciliacaoAB]';
const RESULT_INSERT_CHUNK = 200;
const PAGE_SIZE = 2000;
const EPSILON = 1e-6;
const CHUNK_SIZE = 500; // SQLite variable limit safety

const STATUS_CONCILIADO = '01_Conciliado' as const;
const STATUS_FOUND_DIFF = '02_Encontrado c/Diferença' as const;
const STATUS_NOT_FOUND = '03_Não Encontrado' as const;

const LABEL_CONCILIADO = 'Conciliado' as const;
const LABEL_DIFF_IMATERIAL = 'Diferença Imaterial' as const;
const LABEL_NOT_FOUND = 'Não encontrado' as const;

interface ConfigConciliacaoRow {
    readonly id: number;
    readonly base_contabil_id: number;
    readonly base_fiscal_id: number;
    readonly chaves_contabil?: string | null;
    readonly chaves_fiscal?: string | null;
    readonly coluna_conciliacao_contabil?: string | null;
    readonly coluna_conciliacao_fiscal?: string | null;
    readonly inverter_sinal_fiscal?: number | boolean | null;
    readonly limite_diferenca_imaterial?: number | null;
}

interface BaseRow {
    readonly id: number;
    readonly tabela_sqlite?: string | null;
    readonly subtype?: string | null;
}

interface MarkRow {
    readonly id: number;
    readonly base_id: number;
    row_id: number;
    readonly status?: string | null;
    readonly grupo?: string | null;
    readonly chave?: string | null;
}

interface ResultEntry {
    job_id: number;
    chave: string | null;
    status: string | null | undefined;
    grupo: string | null | undefined;
    a_row_id: number | null;
    b_row_id: number | null;
    a_values: string | null;
    b_values: string | null;
    value_a: number;
    value_b: number;
    difference: number;
    created_at: ReturnType<Knex['fn']['now']>;
    [key: string]: unknown;
}

interface GroupData {
    keyId: string;
    chaveValor: string | null;
    aIds: Set<number>;
    bIds: Set<number>;
}

// Minimal row representation for storage (excludes large/unnecessary columns)
function serializeRowCompact(row: Record<string, unknown> | null | undefined, keyCols: string[], valueCol?: string): string {
    if (!row) return '{}';
    const compact: Record<string, unknown> = { id: row.id };
    // Include key columns
    for (const c of keyCols) {
        if (c && row[c] !== undefined) compact[c] = row[c];
    }
    // Include value column
    if (valueCol && row[valueCol] !== undefined) compact[valueCol] = row[valueCol];
    return JSON.stringify(compact);
}

export class ConciliacaoABStep implements PipelineStep {
    readonly name = 'ConciliacaoAB';

    constructor(private readonly db: Knex) { }

    private async ensureResultTable(jobId: number): Promise<string> {
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
            const parsed: unknown = JSON.parse(raw);
            if (Array.isArray(parsed)) return { CHAVE_1: parsed as string[] };
            if (parsed && typeof parsed === 'object') return parsed as Record<string, string[]>;
        } catch {
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

    private async getRowFromTable(table: string, id: number, cache: Map<number, Record<string, unknown>>): Promise<Record<string, unknown> | null> {
        if (cache.has(id)) return cache.get(id) ?? null;
        const row = await this.db.select('*').from(table).where({ id }).first();
        if (row) cache.set(id, row as Record<string, unknown>);
        return row ?? null;
    }

    // Batch fetch rows by ids and populate cache to avoid N queries
    // Uses chunked queries to avoid SQLite variable limits
    private async fetchRowsBatch(table: string, ids: number[], cache: Map<number, Record<string, unknown>>): Promise<void> {
        const missing = ids.filter(id => !cache.has(id));
        if (missing.length === 0) return;

        for (let i = 0; i < missing.length; i += CHUNK_SIZE) {
            const chunk = missing.slice(i, i + CHUNK_SIZE);
            const rows = await this.db.select('*').from(table).whereIn('id', chunk);
            for (const r of rows) {
                cache.set(Number(r.id), r as Record<string, unknown>);
            }
        }
    }

    private async ensureResultColumns(tableName: string, keys: string[]): Promise<void> {
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

    private async loadMarksForBases(baseAId: number, baseBId: number): Promise<{ marksA: Map<number, MarkRow>; marksB: Map<number, MarkRow> }> {
        const rows = await this.db<MarkRow>('conciliacao_marks').whereIn('base_id', [baseAId, baseBId]).select('*');
        const marksA = new Map<number, MarkRow>();
        const marksB = new Map<number, MarkRow>();
        for (const m of rows) {
            const rid = Number(m.row_id);
            const markCopy: MarkRow = { ...m, row_id: rid };
            if (m.base_id === baseAId && !marksA.has(rid)) marksA.set(rid, markCopy);
            if (m.base_id === baseBId && !marksB.has(rid)) marksB.set(rid, markCopy);
        }
        return { marksA, marksB };
    }

    // Paginated version - yields matched pairs page by page to limit memory
    private buildMatchedPairsQuery(tableA: string, tableB: string, aCols: string[], bCols: string[]) {
        const aAlias = 'a';
        const bAlias = 'b';
        return this.db
            .select(this.db.raw(`${aAlias}.id as a_row_id`), this.db.raw(`${bAlias}.id as b_row_id`))
            .from({ [aAlias]: tableA })
            .innerJoin({ [bAlias]: tableB }, function () {
                const maxLen = Math.max(aCols.length || 0, bCols.length || 0);
                for (let i = 0; i < maxLen; i++) {
                    const aKey = aCols[i] || aCols[0];
                    const bKey = bCols[i] || bCols[0];
                    if (aKey && bKey) this.on(`${aAlias}.${aKey}`, '=', `${bAlias}.${bKey}`);
                }
            })
            .orderBy([{ column: `${aAlias}.id`, order: 'asc' }, { column: `${bAlias}.id`, order: 'asc' }]);
    }

    // Fetch only specific columns to reduce memory usage
    // Uses chunked queries to avoid SQLite variable limits
    private async fetchRowsLightweight(table: string, ids: number[], cols: string[], valueCol?: string): Promise<Map<number, Record<string, unknown>>> {
        if (!ids || ids.length === 0) return new Map();
        const selectCols = ['id', ...cols];
        if (valueCol && !selectCols.includes(valueCol)) selectCols.push(valueCol);

        const map = new Map<number, Record<string, unknown>>();

        for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
            const chunk = ids.slice(i, i + CHUNK_SIZE);
            const rows = await this.db.select(selectCols.map(c => `${table}.${c}`)).from(table).whereIn('id', chunk);
            for (const r of rows) map.set(Number(r.id), r as Record<string, unknown>);
        }

        return map;
    }

    async execute(ctx: PipelineContext): Promise<void> {
        const cfgId = ctx.configConciliacaoId;
        if (!cfgId) {
            console.log(`${LOG_PREFIX} No configConciliacaoId in context, skipping`);
            return;
        }

        const cfg = await this.db<ConfigConciliacaoRow>('configs_conciliacao').where({ id: cfgId }).first();
        if (!cfg) {
            console.log(`${LOG_PREFIX} Config ${cfgId} not found, skipping`);
            return;
        }

        const baseAId = ctx.baseContabilId ?? cfg.base_contabil_id;
        const baseBId = ctx.baseFiscalId ?? cfg.base_fiscal_id;
        if (!baseAId || !baseBId) {
            console.log(`${LOG_PREFIX} Missing baseAId or baseBId, skipping`);
            return;
        }

        const baseA = await this.db<BaseRow>('bases').where({ id: baseAId }).first();
        const baseB = await this.db<BaseRow>('bases').where({ id: baseBId }).first();
        if (!baseA?.tabela_sqlite || !baseB?.tabela_sqlite) {
            console.log(`${LOG_PREFIX} Base A or B not found or missing tabela_sqlite, skipping`);
            return;
        }

        const tableA = baseA.tabela_sqlite;
        const tableB = baseB.tabela_sqlite;

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

        // Collect all key columns for compact serialization
        const allAKeyCols = new Set<string>();
        const allBKeyCols = new Set<string>();
        for (const kid of keyIdentifiers) {
            (chavesContabil[kid] || []).forEach(c => allAKeyCols.add(c));
            (chavesFiscal[kid] || []).forEach(c => allBKeyCols.add(c));
        }

        const { marksA, marksB } = await this.loadMarksForBases(baseAId, baseBId);

        const inserts: ResultEntry[] = [];
        const matchedA = new Set<number>();
        const matchedB = new Set<number>();

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

        // Process pre-existing marks (A and B) first - paginated to avoid loading all rows at once
        const processMarksPagedA = async () => {
            const markIds = Array.from(marksA.keys());
            for (let i = 0; i < markIds.length; i += PAGE_SIZE) {
                const pageIds = markIds.slice(i, i + PAGE_SIZE);
                const aRowMap = await this.fetchRowsLightweight(tableA, pageIds, Array.from(allAKeyCols), colA);

                for (const rowId of pageIds) {
                    const mark = marksA.get(rowId);
                    if (!mark) continue;
                    const aRow = aRowMap.get(rowId);
                    if (!aRow) continue;

                    const markKey = mark.grupo ?? mark.chave ?? null;
                    const valueA = colA ? Number(aRow[colA]) || 0 : 0;
                    const diff = valueA - 0;

                    const entry: ResultEntry = {
                        job_id: jobId,
                        chave: markKey,
                        status: mark.status,
                        grupo: mark.grupo,
                        a_row_id: rowId,
                        b_row_id: null,
                        a_values: serializeRowCompact(aRow, Array.from(allAKeyCols), colA),
                        b_values: null,
                        value_a: valueA,
                        value_b: 0,
                        difference: diff,
                        created_at: this.db.fn.now()
                    };

                    for (const kid of keyIdentifiers) entry[kid] = markKey ?? this.buildComposite(aRow, chavesContabil[kid]);

                    inserts.push(entry);
                    matchedA.add(rowId);

                    if (inserts.length >= RESULT_INSERT_CHUNK) await flushInserts();
                }
            }
            await flushInserts();
        };

        const processMarksPagedB = async () => {
            const markIds = Array.from(marksB.keys());
            for (let i = 0; i < markIds.length; i += PAGE_SIZE) {
                const pageIds = markIds.slice(i, i + PAGE_SIZE);
                const bRowMap = await this.fetchRowsLightweight(tableB, pageIds, Array.from(allBKeyCols), colB);

                for (const rowId of pageIds) {
                    const mark = marksB.get(rowId);
                    if (!mark) continue;
                    const bRow = bRowMap.get(rowId);
                    if (!bRow) continue;

                    const markKey = mark.grupo ?? mark.chave ?? null;
                    const rawB = colB ? Number(bRow[colB]) || 0 : 0;
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
                        b_values: serializeRowCompact(bRow, Array.from(allBKeyCols), colB),
                        value_a: 0,
                        value_b: valueB,
                        difference: diff,
                        created_at: this.db.fn.now()
                    };

                    for (const kid of keyIdentifiers) entry[kid] = markKey ?? this.buildComposite(bRow, chavesFiscal[kid]);

                    inserts.push(entry);
                    matchedB.add(rowId);

                    if (inserts.length >= RESULT_INSERT_CHUNK) await flushInserts();
                }
            }
            await flushInserts();
        };

        await processMarksPagedA();
        await processMarksPagedB();

        // Main grouping/conciliation per key - PAGINATED JOIN processing
        for (const keyId of keyIdentifiers) {
            const aCols = chavesContabil[keyId] || [];
            const bCols = chavesFiscal[keyId] || [];
            if ((aCols.length === 0) && (bCols.length === 0)) continue;

            // Process matched pairs in pages to avoid loading entire JOIN result into memory
            let lastAId = 0;
            let lastBId = 0;

            // Accumulate all groups for this key - DO NOT process intermediately to avoid fragmentation
            const groups = new Map<string, { keyId: string; chaveValor: string | null; aIds: Set<number>; bIds: Set<number> }>();

            const processGroupsBatch = async () => {
                if (groups.size === 0) return;

                // Collect all unique IDs for batch fetch
                const allAIdsInBatch = new Set<number>();
                const allBIdsInBatch = new Set<number>();
                for (const g of groups.values()) {
                    g.aIds.forEach(id => allAIdsInBatch.add(id));
                    g.bIds.forEach(id => allBIdsInBatch.add(id));
                }

                // Fetch rows for this batch (lightweight)
                const aRowMap = await this.fetchRowsLightweight(tableA, Array.from(allAIdsInBatch), Array.from(allAKeyCols), colA);
                const bRowMap = await this.fetchRowsLightweight(tableB, Array.from(allBIdsInBatch), Array.from(allBKeyCols), colB);

                for (const [, group] of groups) {
                    const { keyId: groupKeyId, aIds, bIds } = group;
                    const hasA = aIds.size > 0;
                    const hasB = bIds.size > 0;
                    if (!hasA && !hasB) continue;

                    let somaA = 0;
                    let somaB = 0;

                    for (const aId of aIds) {
                        const row = aRowMap.get(aId);
                        if (!row) continue;
                        const valueA = colA ? Number(row[colA]) || 0 : 0;
                        somaA += valueA;
                    }

                    for (const bId of bIds) {
                        const row = bRowMap.get(bId);
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
                        const row = aRowMap.get(aId);
                        if (!row) continue;

                        const entry: ResultEntry = {
                            job_id: jobId,
                            chave: groupKeyId,
                            status,
                            grupo: groupLabel,
                            a_row_id: aId,
                            b_row_id: null,
                            a_values: serializeRowCompact(row, Array.from(allAKeyCols), colA),
                            b_values: null,
                            value_a: somaA,
                            value_b: somaB,
                            difference: diffGroup,
                            created_at: this.db.fn.now()
                        };

                        for (const kid of keyIdentifiers) entry[kid] = this.buildComposite(row, chavesContabil[kid]);

                        inserts.push(entry);
                        matchedA.add(aId);

                        if (inserts.length >= RESULT_INSERT_CHUNK) await flushInserts();
                    }

                    // create entries for B
                    for (const bId of bIds) {
                        if (matchedB.has(bId)) continue;
                        const row = bRowMap.get(bId);
                        if (!row) continue;

                        const entry: ResultEntry = {
                            job_id: jobId,
                            chave: groupKeyId,
                            status,
                            grupo: groupLabel,
                            a_row_id: null,
                            b_row_id: bId,
                            a_values: null,
                            b_values: serializeRowCompact(row, Array.from(allBKeyCols), colB),
                            value_a: somaA,
                            value_b: somaB,
                            difference: diffGroup,
                            created_at: this.db.fn.now()
                        };

                        for (const kid of keyIdentifiers) entry[kid] = this.buildComposite(row, chavesFiscal[kid]);

                        inserts.push(entry);
                        matchedB.add(bId);

                        if (inserts.length >= RESULT_INSERT_CHUNK) await flushInserts();
                    }
                }

                // Clear groups to free memory after processing
                groups.clear();
            };

            // Paginated iteration over the JOIN results
            while (true) {
                const baseQuery = this.buildMatchedPairsQuery(tableA, tableB, aCols, bCols);
                const page = await baseQuery
                    .where(function () {
                        this.where('a.id', '>', lastAId)
                            .orWhere(function () {
                                this.where('a.id', '=', lastAId).andWhere('b.id', '>', lastBId);
                            });
                    })
                    .limit(PAGE_SIZE);

                if (!page || page.length === 0) break;

                // Collect IDs from this page for batch lookup
                const pageAIds = new Set<number>();
                const pageBIds = new Set<number>();
                for (const r of page) {
                    if (r.a_row_id) pageAIds.add(Number(r.a_row_id));
                    if (r.b_row_id) pageBIds.add(Number(r.b_row_id));
                }

                // Lightweight batch fetch for this page
                const pageARows = await this.fetchRowsLightweight(tableA, Array.from(pageAIds), aCols, colA);
                const pageBRows = await this.fetchRowsLightweight(tableB, Array.from(pageBIds), bCols, colB);

                for (const r of page) {
                    const a_row_id: number | null = r.a_row_id ? Number(r.a_row_id) : null;
                    const b_row_id: number | null = r.b_row_id ? Number(r.b_row_id) : null;

                    if (a_row_id !== null && matchedA.has(a_row_id)) continue;
                    if (b_row_id !== null && matchedB.has(b_row_id)) continue;

                    const aRow = a_row_id ? pageARows.get(a_row_id) : null;
                    const bRow = b_row_id ? pageBRows.get(b_row_id) : null;
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

                    if (a_row_id && !group.aIds.has(a_row_id)) {
                        group.aIds.add(a_row_id);
                    }
                    if (b_row_id && !group.bIds.has(b_row_id)) {
                        group.bIds.add(b_row_id);
                    }
                }

                // DO NOT process groups intermediately - this fragments groups across pages
                // causing incorrect sums and duplicate entries

                // Update pagination cursors
                const lastRow = page[page.length - 1];
                lastAId = Number(lastRow.a_row_id) || lastAId;
                lastBId = Number(lastRow.b_row_id) || lastBId;

                if (page.length < PAGE_SIZE) break; // last page
            }

            // Process ALL groups for this key at once (after all pages accumulated)
            await processGroupsBatch();
        }

        // Persist any remaining inserts
        await flushInserts();

        // Process unmatched rows in a paginated way to avoid loading entire tables
        const processRemaining = async (
            table: string,
            col: string | undefined,
            marksMap: Map<number, MarkRow>,
            chavesMap: Record<string, string[]>,
            keyCols: Set<string>,
            keyDefault: string | null,
            isA: boolean,
            alreadyMatched: Set<number> // Add parameter to check already processed rows
        ) => {
            let lastId = 0;
            const joinSide = isA ? 'a_row_id' : 'b_row_id';

            while (true) {
                const dbRef = this.db;
                // Build base query to fetch a page of rows that are not yet present in result for this job
                const pageQuery = this.db.select(`${table}.id`).from(table)
                    .leftJoin(resultTable, function () {
                        this.on(`${table}.id`, '=', `${resultTable}.${joinSide}`)
                            .andOn(`${resultTable}.job_id`, '=', dbRef.raw('?', [jobId]));
                    })
                    .whereNull(`${resultTable}.${joinSide}`)
                    .andWhere(`${table}.id`, '>', lastId)
                    .orderBy(`${table}.id`, 'asc')
                    .limit(PAGE_SIZE);

                const idRows: any[] = await pageQuery;
                if (!idRows || idRows.length === 0) break;

                const ids = idRows.map(r => Number(r.id)).filter(Boolean) as number[];

                // Filter out already matched IDs to avoid duplicates
                const unprocessedIds = ids.filter(id => !alreadyMatched.has(id));
                if (unprocessedIds.length === 0) {
                    lastId = ids[ids.length - 1] || lastId;
                    if (idRows.length < PAGE_SIZE) break;
                    continue;
                }

                // Fetch only needed columns for these IDs
                const rowMap = await this.fetchRowsLightweight(table, unprocessedIds, Array.from(keyCols), col);

                for (const id of unprocessedIds) {
                    const cached = rowMap.get(id);
                    if (!cached) continue;

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
                        a_values: isA ? serializeRowCompact(cached, Array.from(keyCols), col) : null,
                        b_values: !isA ? serializeRowCompact(cached, Array.from(keyCols), col) : null,
                        value_a: valueA,
                        value_b: valueB,
                        difference: diff,
                        created_at: this.db.fn.now()
                    };

                    for (const kid of keyIdentifiers) {
                        entry[kid] = isA ? this.buildComposite(cached, chavesContabil[kid]) : this.buildComposite(cached, chavesFiscal[kid]);
                    }

                    inserts.push(entry);
                    alreadyMatched.add(id); // Mark as processed to avoid any future duplicates
                    // flush periodically to keep memory bounded
                    if (inserts.length >= RESULT_INSERT_CHUNK) await flushInserts();
                }

                lastId = ids[ids.length - 1] || lastId;
                if (idRows.length < PAGE_SIZE) break; // last page
            }
            // flush any remaining
            if (inserts.length > 0) await flushInserts();
        };

        const defaultKey = keyIdentifiers.length ? keyIdentifiers[0] : null;
        await processRemaining(tableA, colA, marksA, chavesContabil, allAKeyCols, defaultKey, true, matchedA);
        await processRemaining(tableB, colB, marksB, chavesFiscal, allBKeyCols, defaultKey, false, matchedB);
    }
}

export default ConciliacaoABStep;