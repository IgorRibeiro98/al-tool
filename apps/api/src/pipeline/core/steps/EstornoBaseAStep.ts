import { PipelineStep, PipelineContext } from '../index';
import { Knex } from 'knex';

/*
    Estorno step for Base A (contábil).
    Finds pairs (A,B) within the same table where column_sum(A) + column_sum(B) ~= 0
    and inserts conciliacao_marks with group 'Conciliado_Estorno'.
    
    OPTIMIZED: Uses streaming/pagination to avoid loading entire table into memory.
*/

const LOG_PREFIX = '[EstornoBaseA]';
const GROUP_ESTORNO = 'Conciliado_Estorno' as const;
const STATUS_CONCILIADO = '01_Conciliado' as const;
const GROUP_DOC_ESTORNADOS = 'Documentos estornados' as const;
const STATUS_NAO_AVALIADO = '04_Não Avaliado' as const;
const INSERT_CHUNK = 500;
const PAGE_SIZE = 5000;

interface ConfigEstorno {
    readonly id: number;
    readonly base_id: number;
    readonly coluna_a?: string | null;
    readonly coluna_b?: string | null;
    readonly coluna_soma?: string | null;
    readonly limite_zero?: number | null;
}

interface BaseRow {
    readonly id: number;
    readonly tabela_sqlite?: string | null;
}

interface IndexEntry {
    readonly id: number;
    readonly soma: number;
}

interface MarkEntry {
    readonly base_id: number;
    readonly row_id: number;
    readonly status: string;
    readonly grupo: string;
    readonly chave: string;
    readonly created_at: ReturnType<Knex['fn']['now']>;
}

export class EstornoBaseAStep implements PipelineStep {
    readonly name = 'EstornoBaseA';

    constructor(private readonly db: Knex) { }

    private async ensureMarksTableExists(): Promise<void> {
        const exists = await this.db.schema.hasTable('conciliacao_marks');
        if (!exists) {
            throw new Error("Missing DB table 'conciliacao_marks'. Run migrations to create required tables.");
        }
    }

    private toStringKey(value: unknown): string {
        if (value === null || value === undefined) return '';
        return String(value);
    }

    private async chunkInsertMarks(entries: MarkEntry[]): Promise<void> {
        if (entries.length === 0) return;

        // Deduplicate entries within the batch (same base_id, row_id, grupo)
        const seen = new Set<string>();
        const uniqueEntries: MarkEntry[] = [];
        for (const entry of entries) {
            const key = `${entry.base_id}|${entry.row_id}|${entry.grupo}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueEntries.push(entry);
            }
        }

        for (let i = 0; i < uniqueEntries.length; i += INSERT_CHUNK) {
            const slice = uniqueEntries.slice(i, i + INSERT_CHUNK);
            await this.db('conciliacao_marks')
                .insert(slice)
                .onConflict(['base_id', 'row_id', 'grupo'])
                .ignore();
        }
    }

    async execute(ctx: PipelineContext): Promise<void> {
        const cfgId = ctx.configEstornoId;
        if (!cfgId) {
            console.log(`${LOG_PREFIX} No configEstornoId in context, skipping`);
            return;
        }

        const cfg = await this.db<ConfigEstorno>('configs_estorno').where({ id: cfgId }).first();
        if (!cfg) {
            console.log(`${LOG_PREFIX} Config ${cfgId} not found, skipping`);
            return;
        }

        const baseId = ctx.baseContabilId ?? cfg.base_id;
        if (!baseId) {
            console.log(`${LOG_PREFIX} No baseId available, skipping`);
            return;
        }

        const base = await this.db<BaseRow>('bases').where({ id: baseId }).first();
        if (!base?.tabela_sqlite) {
            console.log(`${LOG_PREFIX} Base ${baseId} not found or has no tabela_sqlite, skipping`);
            return;
        }
        const tableName = base.tabela_sqlite;

        const tableExists = await this.db.schema.hasTable(tableName);
        if (!tableExists) {
            console.log(`${LOG_PREFIX} Table ${tableName} does not exist, skipping`);
            return;
        }

        await this.ensureMarksTableExists();

        const colunaA = cfg.coluna_a ?? undefined;
        const colunaB = cfg.coluna_b ?? undefined;
        const colunaSoma = cfg.coluna_soma ?? undefined;
        const limiteZero = Number(cfg.limite_zero ?? 0);

        if (!colunaA || !colunaB || !colunaSoma) {
            console.log(`${LOG_PREFIX} Missing required columns config, skipping`);
            return;
        }

        // OPTIMIZATION: Build indexes in memory using pagination
        // Store only minimal data: {id, soma} per key
        const mapA = new Map<string, IndexEntry[]>();
        const mapB = new Map<string, IndexEntry[]>();

        // Read all rows in pages, building indexes with minimal data
        let lastId = 0;
        while (true) {
            const rows = await this.db
                .select('id', colunaA, colunaB, colunaSoma)
                .from(tableName)
                .where('id', '>', lastId)
                .orderBy('id', 'asc')
                .limit(PAGE_SIZE);

            if (!rows || rows.length === 0) break;

            for (const r of rows) {
                const id = Number(r.id);
                const keyA = this.toStringKey(r[colunaA]);
                const keyB = this.toStringKey(r[colunaB]);
                const soma = Number(r[colunaSoma]) || 0;

                if (keyA) {
                    let arr = mapA.get(keyA);
                    if (!arr) {
                        arr = [];
                        mapA.set(keyA, arr);
                    }
                    arr.push({ id, soma });
                }
                if (keyB) {
                    let arr = mapB.get(keyB);
                    if (!arr) {
                        arr = [];
                        mapB.set(keyB, arr);
                    }
                    arr.push({ id, soma });
                }
            }

            lastId = Number(rows[rows.length - 1].id);
            if (rows.length < PAGE_SIZE) break;
        }

        // Process matches
        const markEntries: MarkEntry[] = [];
        let groupCounter = 0;
        const jobIdPart = ctx.jobId ? `${ctx.jobId}_` : '';

        for (const [key, listA] of mapA.entries()) {
            const listB = mapB.get(key);
            if (!listB) continue;

            // Track rows that found a zero-sum partner within this key
            const pairedInKeyA = new Set<number>();
            const pairedInKeyB = new Set<number>();

            // Match rows where sum ~= 0
            for (const aItem of listA) {
                if (pairedInKeyA.has(aItem.id)) continue;

                for (const bItem of listB) {
                    if (aItem.id === bItem.id) continue;
                    if (pairedInKeyB.has(bItem.id)) continue;

                    const sum = aItem.soma + bItem.soma;
                    if (Math.abs(sum) <= limiteZero) {
                        const chave = `${jobIdPart}${key}_${Date.now()}_${groupCounter++}`;

                        pairedInKeyA.add(aItem.id);
                        pairedInKeyB.add(bItem.id);

                        markEntries.push({
                            base_id: baseId,
                            row_id: aItem.id,
                            status: STATUS_CONCILIADO,
                            grupo: GROUP_ESTORNO,
                            chave,
                            created_at: this.db.fn.now()
                        });
                        markEntries.push({
                            base_id: baseId,
                            row_id: bItem.id,
                            status: STATUS_CONCILIADO,
                            grupo: GROUP_ESTORNO,
                            chave,
                            created_at: this.db.fn.now()
                        });

                        // Flush periodically to keep memory bounded
                        if (markEntries.length >= INSERT_CHUNK * 2) {
                            await this.chunkInsertMarks(markEntries);
                            markEntries.length = 0;
                        }

                        break; // Move to next aItem after finding a match
                    }
                }
            }

            // Mark unpaired rows as "Documentos estornados"
            for (const aItem of listA) {
                if (pairedInKeyA.has(aItem.id)) continue;
                const chave = `${jobIdPart}${key}_docest_${Date.now()}_${groupCounter++}`;
                markEntries.push({
                    base_id: baseId,
                    row_id: aItem.id,
                    status: STATUS_NAO_AVALIADO,
                    grupo: GROUP_DOC_ESTORNADOS,
                    chave,
                    created_at: this.db.fn.now()
                });
            }

            for (const bItem of listB) {
                if (pairedInKeyB.has(bItem.id)) continue;
                const chave = `${jobIdPart}${key}_docest_${Date.now()}_${groupCounter++}`;
                markEntries.push({
                    base_id: baseId,
                    row_id: bItem.id,
                    status: STATUS_NAO_AVALIADO,
                    grupo: GROUP_DOC_ESTORNADOS,
                    chave,
                    created_at: this.db.fn.now()
                });
            }

            // Flush periodically
            if (markEntries.length >= INSERT_CHUNK * 2) {
                await this.chunkInsertMarks(markEntries);
                markEntries.length = 0;
            }
        }

        // Final flush
        if (markEntries.length > 0) {
            await this.chunkInsertMarks(markEntries);
        }
    }
}

export default EstornoBaseAStep;
