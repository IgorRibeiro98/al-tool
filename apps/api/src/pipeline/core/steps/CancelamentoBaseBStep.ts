import { PipelineStep, PipelineContext } from '../index';
import { Knex } from 'knex';

/*
    Cancelamento step for Base B (fiscal).
    Marks rows where indicator column matches canceled value as 'NF Cancelada'.
    
    OPTIMIZED v2:
    - Uses INSERT ... SELECT to avoid loading all IDs into memory
    - Single query for finding and inserting marks
    - Batch processing for very large result sets
*/

const GROUP_NF_CANCELADA = 'NF Cancelada' as const;
const STATUS_NAO_AVALIADO = '04_Não Avaliado' as const;
const BATCH_SIZE = 10000;
const LOG_PREFIX = '[CancelamentoBaseB]';

interface ConfigCancelamentoRow {
    readonly id: number;
    readonly base_id: number;
    readonly coluna_indicador?: string | null;
    readonly valor_cancelado?: string | number | null;
}

interface BaseRow {
    readonly id: number;
    readonly tabela_sqlite?: string | null;
}

export class CancelamentoBaseBStep implements PipelineStep {
    readonly name = 'CancelamentoBaseB';

    constructor(private readonly db: Knex) { }

    private async ensureMarksTableExists(): Promise<void> {
        const exists = await this.db.schema.hasTable('conciliacao_marks');
        if (!exists) {
            throw new Error("Missing DB table 'conciliacao_marks'. Run migrations to create required tables.");
        }
    }

    private async getConfig(cfgId: number): Promise<ConfigCancelamentoRow | null> {
        const cfg = await this.db<ConfigCancelamentoRow>('configs_cancelamento').where({ id: cfgId }).first();
        return cfg ?? null;
    }

    private async getBase(baseId: number): Promise<BaseRow | null> {
        const base = await this.db<BaseRow>('bases').where({ id: baseId }).first();
        return base ?? null;
    }

    /**
     * Count rows that match the canceled value
     */
    private async countCanceledRows(tableName: string, indicatorColumn: string, canceledValue: string): Promise<number> {
        const val = canceledValue.trim().toLowerCase();
        if (val === '') return 0;

        const result = await this.db(tableName)
            .count('* as cnt')
            .whereRaw("lower(trim(ifnull(??, ''))) = ?", [indicatorColumn, val])
            .first();

        return Number(result?.cnt ?? 0);
    }

    /**
     * Insert marks for all canceled rows that don't already have marks.
     * Uses INSERT ... SELECT for efficiency - no data loaded into JS memory.
     * Returns number of rows inserted.
     */
    private async insertMarksDirectly(
        baseId: number,
        tableName: string,
        indicatorColumn: string,
        canceledValue: string
    ): Promise<number> {
        const val = canceledValue.trim().toLowerCase();
        if (val === '') return 0;

        // Use raw SQL for INSERT ... SELECT with NOT EXISTS
        // This avoids loading any row data into JavaScript
        const sql = `
            INSERT OR IGNORE INTO conciliacao_marks (base_id, row_id, status, grupo, chave, created_at)
            SELECT 
                ? as base_id,
                t.id as row_id,
                ? as status,
                ? as grupo,
                NULL as chave,
                datetime('now') as created_at
            FROM "${tableName}" t
            WHERE lower(trim(ifnull(t."${indicatorColumn}", ''))) = ?
            AND NOT EXISTS (
                SELECT 1 FROM conciliacao_marks m 
                WHERE m.base_id = ? 
                AND m.row_id = t.id 
                AND m.grupo = ?
            )
        `;

        const result = await this.db.raw(sql, [
            baseId,
            STATUS_NAO_AVALIADO,
            GROUP_NF_CANCELADA,
            val,
            baseId,
            GROUP_NF_CANCELADA
        ]);

        return result?.changes ?? 0;
    }

    /**
     * For very large tables, use batched INSERT ... SELECT by ID range
     * to avoid long-running single transactions
     */
    private async insertMarksBatched(
        baseId: number,
        tableName: string,
        indicatorColumn: string,
        canceledValue: string
    ): Promise<number> {
        const val = canceledValue.trim().toLowerCase();
        if (val === '') return 0;

        // Get max ID for batching
        const maxIdResult = await this.db(tableName).max('id as maxId').first();
        const maxId = Number(maxIdResult?.maxId ?? 0);

        if (maxId === 0) return 0;

        let totalInserted = 0;

        for (let startId = 0; startId <= maxId; startId += BATCH_SIZE) {
            const endId = startId + BATCH_SIZE;

            const sql = `
                INSERT OR IGNORE INTO conciliacao_marks (base_id, row_id, status, grupo, chave, created_at)
                SELECT 
                    ? as base_id,
                    t.id as row_id,
                    ? as status,
                    ? as grupo,
                    NULL as chave,
                    datetime('now') as created_at
                FROM "${tableName}" t
                WHERE t.id > ? AND t.id <= ?
                AND lower(trim(ifnull(t."${indicatorColumn}", ''))) = ?
                AND NOT EXISTS (
                    SELECT 1 FROM conciliacao_marks m 
                    WHERE m.base_id = ? 
                    AND m.row_id = t.id 
                    AND m.grupo = ?
                )
            `;

            const result = await this.db.raw(sql, [
                baseId,
                STATUS_NAO_AVALIADO,
                GROUP_NF_CANCELADA,
                startId,
                endId,
                val,
                baseId,
                GROUP_NF_CANCELADA
            ]);

            totalInserted += result?.changes ?? 0;
        }

        return totalInserted;
    }

    async execute(ctx: PipelineContext): Promise<void> {
        const startTime = Date.now();
        const cfgId = ctx.configCancelamentoId as number | undefined | null;

        // Determine baseId first (from ctx or from cfg fallback)
        const baseIdFromCtx = ctx.baseFiscalId as number | undefined | null;

        let cfg: ConfigCancelamentoRow | null = null;
        if (cfgId) {
            cfg = await this.getConfig(cfgId);
        }

        // If no explicit configId provided, try to find a config by base_id
        const baseId = baseIdFromCtx ?? cfg?.base_id;
        if (!cfg && baseId) {
            // try to load any config matching this base
            const maybe = await this.db<ConfigCancelamentoRow>('configs_cancelamento').where({ base_id: baseId }).first();
            if (maybe) cfg = maybe;
        }

        if (!cfg) {
            console.log(`${LOG_PREFIX} No config found for cfgId=${cfgId}, baseId=${baseId} - skipping`);
            return;
        }
        if (!baseId) {
            console.log(`${LOG_PREFIX} No baseId available - skipping`);
            return;
        }

        const base = await this.getBase(baseId);
        if (!base || !base.tabela_sqlite) {
            console.log(`${LOG_PREFIX} Base ${baseId} not found or has no tabela_sqlite - skipping`);
            return;
        }
        const tableName = base.tabela_sqlite;

        const tableExists = await this.db.schema.hasTable(tableName);
        if (!tableExists) {
            console.log(`${LOG_PREFIX} Table ${tableName} does not exist - skipping`);
            return;
        }

        await this.ensureMarksTableExists();

        const indicatorColumn = cfg.coluna_indicador;
        const canceledValue = cfg.valor_cancelado;

        if (!indicatorColumn) {
            console.log(`${LOG_PREFIX} No indicator column configured - skipping`);
            return;
        }
        if (canceledValue === undefined || canceledValue === null) {
            console.log(`${LOG_PREFIX} No canceled value configured - skipping`);
            return;
        }

        // Normalize canceled value to string
        const canceledValueStr = String(canceledValue).trim();
        if (canceledValueStr === '') {
            console.log(`${LOG_PREFIX} Empty canceled value - skipping`);
            return;
        }

        // Ensure the indicator column exists in the target table to avoid silent no-ops
        const hasCol = await this.db.schema.hasColumn(tableName, indicatorColumn);
        if (!hasCol) {
            console.log(`${LOG_PREFIX} Column ${indicatorColumn} not found in table ${tableName} - skipping`);
            return;
        }

        // Get row count to decide on strategy
        const countResult = await this.db(tableName).count('* as cnt').first();
        const rowCount = Number(countResult?.cnt ?? 0);

        // Count canceled rows for logging
        const canceledCount = await this.countCanceledRows(tableName, indicatorColumn, canceledValueStr);
        console.log(`${LOG_PREFIX} Processing ${tableName} (${rowCount.toLocaleString()} rows, ${canceledCount.toLocaleString()} with canceled value "${canceledValueStr}")`);

        if (canceledCount === 0) {
            console.log(`${LOG_PREFIX} No rows found with canceled value - nothing to do`);
            return;
        }

        // Use batched approach for large tables, direct for smaller ones
        let inserted: number;
        if (rowCount > 500000) {
            console.log(`${LOG_PREFIX} Using batched insert strategy for large table`);
            inserted = await this.insertMarksBatched(baseId, tableName, indicatorColumn, canceledValueStr);
        } else {
            inserted = await this.insertMarksDirectly(baseId, tableName, indicatorColumn, canceledValueStr);
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`${LOG_PREFIX} Completed in ${elapsed}s - inserted ${inserted} new marks (${canceledCount - inserted} already existed)`);
    }
}

export default CancelamentoBaseBStep;
