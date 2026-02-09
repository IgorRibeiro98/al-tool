/**
 * LightTableService - Manages lightweight tables for pipeline optimization.
 * 
 * Light tables contain only the columns necessary for conciliation operations
 * (key columns + value columns), significantly reducing memory and I/O during
 * pipeline execution.
 * 
 * The full base table is preserved and used during export to merge results
 * back with all original columns.
 */

import { Knex } from 'knex';
import db from '../db/knex';

const LOG_PREFIX = '[LightTableService]';

export interface LightTableConfig {
    baseId: number;
    jobId: number;
    keyColumns: string[];
    valueColumn?: string;
    extraColumns?: string[];
}

export interface LightTableResult {
    tableName: string;
    columnCount: number;
    rowCount: number;
    creationTimeMs: number;
}

export class LightTableService {
    constructor(private readonly knex: Knex = db) { }

    /**
     * Generate the name for a light table.
     * Format: base_{baseId}_light_{jobId}
     */
    getLightTableName(baseId: number, jobId: number): string {
        return `base_${baseId}_light_${jobId}`;
    }

    /**
     * Check if a light table already exists.
     */
    async exists(baseId: number, jobId: number): Promise<boolean> {
        const tableName = this.getLightTableName(baseId, jobId);
        return this.knex.schema.hasTable(tableName);
    }

    /**
     * Create a light table with only the specified columns from the base table.
     * Uses CREATE TABLE AS SELECT for optimal performance.
     * 
     * @param config Configuration for the light table
     * @returns Information about the created table
     */
    async createLightTable(config: LightTableConfig): Promise<LightTableResult> {
        const startTime = Date.now();
        const { baseId, jobId, keyColumns, valueColumn, extraColumns = [] } = config;

        // Get the source table name
        const base = await this.knex('bases').where({ id: baseId }).first();
        if (!base) {
            throw new Error(`Base ${baseId} not found`);
        }
        const sourceTable = base.tabela_sqlite;
        if (!sourceTable) {
            throw new Error(`Base ${baseId} has no tabela_sqlite`);
        }

        // Check if source table exists
        const sourceExists = await this.knex.schema.hasTable(sourceTable);
        if (!sourceExists) {
            throw new Error(`Source table ${sourceTable} does not exist`);
        }

        const lightTableName = this.getLightTableName(baseId, jobId);

        // Check if light table already exists
        const alreadyExists = await this.knex.schema.hasTable(lightTableName);
        if (alreadyExists) {
            console.log(`${LOG_PREFIX} Light table ${lightTableName} already exists, reusing`);
            const countResult = await this.knex(lightTableName).count('* as cnt').first();
            const rowCount = Number(countResult?.cnt) || 0;
            const colInfo = await this.knex(lightTableName).columnInfo();
            return {
                tableName: lightTableName,
                columnCount: Object.keys(colInfo).length,
                rowCount,
                creationTimeMs: Date.now() - startTime
            };
        }

        // Get column info from source table to validate requested columns exist
        const sourceColInfo = await this.knex(sourceTable).columnInfo();
        const sourceColumns = Object.keys(sourceColInfo);

        // Build list of columns to include (always include 'id')
        const columnsToInclude = new Set<string>(['id']);

        // Add key columns (validate they exist)
        for (const col of keyColumns) {
            if (col && sourceColumns.includes(col)) {
                columnsToInclude.add(col);
            } else if (col) {
                console.warn(`${LOG_PREFIX} Key column '${col}' not found in ${sourceTable}, skipping`);
            }
        }

        // Add value column
        if (valueColumn && sourceColumns.includes(valueColumn)) {
            columnsToInclude.add(valueColumn);
        } else if (valueColumn) {
            console.warn(`${LOG_PREFIX} Value column '${valueColumn}' not found in ${sourceTable}, skipping`);
        }

        // Add extra columns
        for (const col of extraColumns) {
            if (col && sourceColumns.includes(col)) {
                columnsToInclude.add(col);
            }
        }

        // Always include created_at if it exists (useful for debugging)
        if (sourceColumns.includes('created_at')) {
            columnsToInclude.add('created_at');
        }

        const columnList = Array.from(columnsToInclude);
        console.log(`${LOG_PREFIX} Creating light table ${lightTableName} with ${columnList.length} columns: ${columnList.join(', ')}`);

        // Use CREATE TABLE AS SELECT for optimal performance
        // Quote column names to handle any special characters
        const quotedColumns = columnList.map(c => `"${c}"`).join(', ');
        const createSQL = `CREATE TABLE "${lightTableName}" AS SELECT ${quotedColumns} FROM "${sourceTable}"`;

        try {
            await this.knex.raw(createSQL);
        } catch (err) {
            console.error(`${LOG_PREFIX} Failed to create light table:`, err);
            throw new Error(`Failed to create light table: ${err instanceof Error ? err.message : String(err)}`);
        }

        // Create index on id (primary key equivalent)
        try {
            await this.knex.raw(`CREATE UNIQUE INDEX "idx_${lightTableName}_id" ON "${lightTableName}" ("id")`);
        } catch (err) {
            console.warn(`${LOG_PREFIX} Failed to create id index:`, err);
        }

        // Create composite index on key columns for faster JOINs
        if (keyColumns.length > 0) {
            const validKeyColumns = keyColumns.filter(c => columnsToInclude.has(c));
            if (validKeyColumns.length > 0) {
                try {
                    const keyColsQuoted = validKeyColumns.map(c => `"${c}"`).join(', ');
                    await this.knex.raw(`CREATE INDEX "idx_${lightTableName}_keys" ON "${lightTableName}" (${keyColsQuoted})`);
                } catch (err) {
                    console.warn(`${LOG_PREFIX} Failed to create keys index:`, err);
                }
            }
        }

        // Create index on value column if present
        if (valueColumn && columnsToInclude.has(valueColumn)) {
            try {
                await this.knex.raw(`CREATE INDEX "idx_${lightTableName}_value" ON "${lightTableName}" ("${valueColumn}")`);
            } catch (err) {
                console.warn(`${LOG_PREFIX} Failed to create value index:`, err);
            }
        }

        // Analyze the table for query optimization
        try {
            await this.knex.raw(`ANALYZE "${lightTableName}"`);
        } catch (err) {
            console.warn(`${LOG_PREFIX} Failed to analyze light table:`, err);
        }

        // Get final row count
        const countResult = await this.knex(lightTableName).count('* as cnt').first();
        const rowCount = Number(countResult?.cnt) || 0;

        const creationTimeMs = Date.now() - startTime;
        console.log(`${LOG_PREFIX} Created ${lightTableName}: ${rowCount} rows, ${columnList.length} columns in ${creationTimeMs}ms`);

        return {
            tableName: lightTableName,
            columnCount: columnList.length,
            rowCount,
            creationTimeMs
        };
    }

    /**
     * Drop a light table.
     */
    async dropLightTable(baseId: number, jobId: number): Promise<boolean> {
        const tableName = this.getLightTableName(baseId, jobId);
        const exists = await this.knex.schema.hasTable(tableName);
        if (!exists) {
            return false;
        }

        try {
            await this.knex.schema.dropTable(tableName);
            console.log(`${LOG_PREFIX} Dropped light table ${tableName}`);
            return true;
        } catch (err) {
            console.error(`${LOG_PREFIX} Failed to drop light table ${tableName}:`, err);
            return false;
        }
    }

    /**
     * Drop all light tables for a specific job.
     * Useful for cleanup after job completion or cancellation.
     */
    async dropAllLightTablesForJob(jobId: number): Promise<number> {
        // Find all tables matching the pattern base_*_light_{jobId}
        const pattern = `%_light_${jobId}`;

        try {
            // SQLite-specific query to find matching tables
            const tables = await this.knex.raw(
                `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ?`,
                [pattern]
            );

            const tableList = Array.isArray(tables) ? tables : (tables?.rows || []);
            let dropped = 0;

            for (const row of tableList) {
                const tableName = row.name;
                if (tableName && tableName.endsWith(`_light_${jobId}`)) {
                    try {
                        await this.knex.schema.dropTableIfExists(tableName);
                        dropped++;
                        console.log(`${LOG_PREFIX} Dropped ${tableName}`);
                    } catch (err) {
                        console.error(`${LOG_PREFIX} Failed to drop ${tableName}:`, err);
                    }
                }
            }

            console.log(`${LOG_PREFIX} Dropped ${dropped} light tables for job ${jobId}`);
            return dropped;
        } catch (err) {
            console.error(`${LOG_PREFIX} Failed to enumerate light tables for job ${jobId}:`, err);
            return 0;
        }
    }

    /**
     * Get or create a light table. If it exists, return it; otherwise create it.
     */
    async getOrCreateLightTable(config: LightTableConfig): Promise<LightTableResult> {
        const { baseId, jobId } = config;
        const tableName = this.getLightTableName(baseId, jobId);

        const exists = await this.knex.schema.hasTable(tableName);
        if (exists) {
            const countResult = await this.knex(tableName).count('* as cnt').first();
            const rowCount = Number(countResult?.cnt) || 0;
            const colInfo = await this.knex(tableName).columnInfo();
            return {
                tableName,
                columnCount: Object.keys(colInfo).length,
                rowCount,
                creationTimeMs: 0
            };
        }

        return this.createLightTable(config);
    }

    /**
     * Validate that all required columns exist in the light table.
     */
    async validateLightTable(tableName: string, requiredColumns: string[]): Promise<boolean> {
        const exists = await this.knex.schema.hasTable(tableName);
        if (!exists) {
            return false;
        }

        const colInfo = await this.knex(tableName).columnInfo();
        const existingColumns = Object.keys(colInfo);

        for (const col of requiredColumns) {
            if (!existingColumns.includes(col)) {
                console.warn(`${LOG_PREFIX} Light table ${tableName} missing required column: ${col}`);
                return false;
            }
        }

        return true;
    }
}

// Export singleton instance for convenience
export const lightTableService = new LightTableService();

export default LightTableService;
