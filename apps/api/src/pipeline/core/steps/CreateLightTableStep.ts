/**
 * CreateLightTableStep - Pipeline step that creates lightweight tables
 * for optimized conciliation processing.
 * 
 * This step should run early in the pipeline (before ConciliacaoABStep)
 * to create light tables containing only the columns necessary for
 * conciliation operations.
 */

import { PipelineStep, PipelineContext } from '../index';
import { Knex } from 'knex';
import { LightTableService, LightTableResult } from '../../../services/LightTableService';

const LOG_PREFIX = '[CreateLightTable]';

interface ConfigConciliacaoRow {
    readonly id: number;
    readonly base_contabil_id: number;
    readonly base_fiscal_id: number;
    readonly chaves_contabil?: string | null;
    readonly chaves_fiscal?: string | null;
    readonly coluna_conciliacao_contabil?: string | null;
    readonly coluna_conciliacao_fiscal?: string | null;
}

interface BaseRow {
    readonly id: number;
    readonly tabela_sqlite?: string | null;
    readonly subtype?: string | null;
}

export class CreateLightTableStep implements PipelineStep {
    readonly name = 'CreateLightTable';

    constructor(
        private readonly db: Knex,
        private readonly lightTableService: LightTableService = new LightTableService()
    ) { }

    /**
     * Parse chaves configuration from JSON string to column arrays.
     */
    private parseChaves(raw?: string | null): Record<string, string[]> {
        if (!raw) return {};
        try {
            const parsed: unknown = JSON.parse(raw);
            if (Array.isArray(parsed)) return { CHAVE_1: parsed as string[] };
            if (parsed && typeof parsed === 'object') return parsed as Record<string, string[]>;
        } catch {
            // ignore parse errors
        }
        return {};
    }

    /**
     * Extract all key columns from a chaves configuration.
     */
    private extractKeyColumns(chavesConfig: Record<string, string[]>): string[] {
        const columns = new Set<string>();
        for (const keyId of Object.keys(chavesConfig)) {
            const cols = chavesConfig[keyId] || [];
            for (const col of cols) {
                if (col) columns.add(col);
            }
        }
        return Array.from(columns);
    }

    /**
     * Resolve keys from configs_conciliacao_keys table (central linking).
     * Falls back to legacy inline chaves if no links are present.
     */
    private async resolveConfigKeyColumns(
        configId: number,
        baseA: BaseRow,
        baseB: BaseRow,
        cfg: ConfigConciliacaoRow
    ): Promise<{ keyColumnsA: string[]; keyColumnsB: string[] }> {
        // Try to load from configs_conciliacao_keys
        const links = await this.db('configs_conciliacao_keys')
            .where({ config_conciliacao_id: configId })
            .orderBy('ordem', 'asc')
            .orderBy('id', 'asc');

        if (links && links.length > 0) {
            // Collect definition IDs
            const pairIds: number[] = [];
            const defIds: number[] = [];

            for (const l of links) {
                if (l.keys_pair_id) pairIds.push(l.keys_pair_id);
                if (l.contabil_key_id) defIds.push(l.contabil_key_id);
                if (l.fiscal_key_id) defIds.push(l.fiscal_key_id);
            }

            // Load pairs
            let pairsMap: Record<number, any> = {};
            if (pairIds.length > 0) {
                const pairs = await this.db('keys_pairs').whereIn('id', pairIds).select('*');
                for (const p of pairs) {
                    pairsMap[p.id] = p;
                    if (p.contabil_key_id) defIds.push(p.contabil_key_id);
                    if (p.fiscal_key_id) defIds.push(p.fiscal_key_id);
                }
            }

            // Load definitions
            const uniqueDefIds = Array.from(new Set(defIds.filter(Boolean)));
            const defsMap: Record<number, any> = {};
            if (uniqueDefIds.length > 0) {
                const defs = await this.db('keys_definitions').whereIn('id', uniqueDefIds).select('*');
                for (const d of defs) defsMap[d.id] = d;
            }

            // Helper to parse columns
            const parseCols = (val: any): string[] => {
                if (!val) return [];
                try {
                    return Array.isArray(val) ? val : (typeof val === 'string' ? JSON.parse(val) : []);
                } catch { return []; }
            };

            // Extract columns from each link
            const keyColumnsA = new Set<string>();
            const keyColumnsB = new Set<string>();

            for (const l of links) {
                let contDef: any = null;
                let fiscDef: any = null;

                if (l.keys_pair_id) {
                    const pair = pairsMap[l.keys_pair_id];
                    if (pair) {
                        contDef = pair.contabil_key_id ? defsMap[pair.contabil_key_id] : null;
                        fiscDef = pair.fiscal_key_id ? defsMap[pair.fiscal_key_id] : null;
                    }
                } else {
                    contDef = l.contabil_key_id ? defsMap[l.contabil_key_id] : null;
                    fiscDef = l.fiscal_key_id ? defsMap[l.fiscal_key_id] : null;
                }

                if (contDef) {
                    const cols = parseCols(contDef.columns || contDef.columns_json || contDef.columns_text);
                    cols.forEach(c => keyColumnsA.add(c));
                }
                if (fiscDef) {
                    const cols = parseCols(fiscDef.columns || fiscDef.columns_json || fiscDef.columns_text);
                    cols.forEach(c => keyColumnsB.add(c));
                }
            }

            if (keyColumnsA.size > 0 || keyColumnsB.size > 0) {
                return {
                    keyColumnsA: Array.from(keyColumnsA),
                    keyColumnsB: Array.from(keyColumnsB)
                };
            }
        }

        // Fallback to legacy inline chaves
        const chavesContabil = this.parseChaves(cfg.chaves_contabil);
        const chavesFiscal = this.parseChaves(cfg.chaves_fiscal);

        return {
            keyColumnsA: this.extractKeyColumns(chavesContabil),
            keyColumnsB: this.extractKeyColumns(chavesFiscal)
        };
    }

    async execute(ctx: PipelineContext): Promise<void> {
        const startTime = Date.now();
        const cfgId = ctx.configConciliacaoId;

        if (!cfgId) {
            console.log(`${LOG_PREFIX} No configConciliacaoId in context, skipping light table creation`);
            return;
        }

        // Load configuration
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

        // Load base info
        const baseA = await this.db<BaseRow>('bases').where({ id: baseAId }).first();
        const baseB = await this.db<BaseRow>('bases').where({ id: baseBId }).first();

        if (!baseA?.tabela_sqlite || !baseB?.tabela_sqlite) {
            console.log(`${LOG_PREFIX} Base A or B not found or missing tabela_sqlite, skipping`);
            return;
        }

        // Resolve key columns
        const { keyColumnsA, keyColumnsB } = await this.resolveConfigKeyColumns(cfgId, baseA, baseB, cfg);

        console.log(`${LOG_PREFIX} Creating light tables for job ${ctx.jobId}`);
        console.log(`${LOG_PREFIX} Base A (${baseAId}): key columns = [${keyColumnsA.join(', ')}], value = ${cfg.coluna_conciliacao_contabil}`);
        console.log(`${LOG_PREFIX} Base B (${baseBId}): key columns = [${keyColumnsB.join(', ')}], value = ${cfg.coluna_conciliacao_fiscal}`);

        // Create light table for Base A
        let lightTableA: LightTableResult;
        try {
            lightTableA = await this.lightTableService.createLightTable({
                baseId: baseAId,
                jobId: ctx.jobId,
                keyColumns: keyColumnsA,
                valueColumn: cfg.coluna_conciliacao_contabil ?? undefined
            });
            console.log(`${LOG_PREFIX} Created light table A: ${lightTableA.tableName} (${lightTableA.rowCount} rows, ${lightTableA.columnCount} cols, ${lightTableA.creationTimeMs}ms)`);
        } catch (err) {
            console.error(`${LOG_PREFIX} Failed to create light table for Base A:`, err);
            // Continue without light table - pipeline will fall back to full table
            return;
        }

        // Create light table for Base B
        let lightTableB: LightTableResult;
        try {
            lightTableB = await this.lightTableService.createLightTable({
                baseId: baseBId,
                jobId: ctx.jobId,
                keyColumns: keyColumnsB,
                valueColumn: cfg.coluna_conciliacao_fiscal ?? undefined
            });
            console.log(`${LOG_PREFIX} Created light table B: ${lightTableB.tableName} (${lightTableB.rowCount} rows, ${lightTableB.columnCount} cols, ${lightTableB.creationTimeMs}ms)`);
        } catch (err) {
            console.error(`${LOG_PREFIX} Failed to create light table for Base B:`, err);
            // Cleanup table A and continue without light tables
            await this.lightTableService.dropLightTable(baseAId, ctx.jobId);
            return;
        }

        // Store light table names in context for subsequent steps
        (ctx as any).lightTableContabil = lightTableA.tableName;
        (ctx as any).lightTableFiscal = lightTableB.tableName;

        const totalTime = Date.now() - startTime;
        console.log(`${LOG_PREFIX} Light tables created in ${totalTime}ms total`);
    }
}

export default CreateLightTableStep;
