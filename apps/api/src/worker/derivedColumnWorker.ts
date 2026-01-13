/**
 * derivedColumnWorker.ts
 *
 * Worker that processes derived column jobs. It polls the derived_column_jobs
 * table for pending jobs and executes the SQL expression to populate the
 * target column.
 *
 * OPTIMIZATIONS:
 * - FAST mode: Single UPDATE for tables <= threshold (default 500K rows)
 * - BATCH mode: Direct UPDATE with WHERE for larger tables
 * - Configurable batch sizes and thresholds via ENV
 * - Progress tracking with minimal overhead
 */

import db from '../db/knex';

// Configuration via ENV
const POLL_INTERVAL_MS = parseInt(process.env.DERIVED_COLUMN_POLL_INTERVAL || '3000', 10);
const FAST_MODE_THRESHOLD = parseInt(process.env.DERIVED_COLUMN_FAST_THRESHOLD || '500000', 10);
const BATCH_SIZE = parseInt(process.env.DERIVED_COLUMN_BATCH_SIZE || '50000', 10);
const DEBUG = process.env.DERIVED_COLUMN_DEBUG === 'true';

// Type definitions
interface DerivedColumnJob {
    id: number;
    base_id: number;
    source_column: string;
    target_column: string;
    operation: 'ABS' | 'INVERTER';
    status: string;
    progress: number;
    error_message?: string;
    started_at?: string;
    completed_at?: string;
    created_at: string;
}

const log = (msg: string, data?: unknown) => {
    if (DEBUG) {
        console.log(`[derivedColumnWorker] ${msg}`, data ?? '');
    }
};

/**
 * Build the SQL expression for a given operation
 */
function buildExpression(operation: string, sourceColumn: string): string {
    const escapedCol = `"${sourceColumn}"`;

    switch (operation.toUpperCase()) {
        case 'ABS':
            return `ABS(CAST(${escapedCol} AS REAL))`;
        case 'INVERTER':
            return `(CAST(${escapedCol} AS REAL) * -1)`;
        default:
            throw new Error(`Unknown operation: ${operation}`);
    }
}

/**
 * Get the table name for a base
 */
function getTableName(baseId: number): string {
    return `base_${baseId}`;
}

/**
 * Count total rows in a table
 */
async function countRows(tableName: string): Promise<number> {
    const result = await db(tableName).count('* as cnt').first();
    return parseInt(String(result?.cnt ?? 0), 10);
}

/**
 * Count rows where target column is NULL
 */
async function countPendingRows(
    tableName: string,
    targetColumn: string
): Promise<number> {
    const result = await db(tableName)
        .whereNull(targetColumn)
        .count('* as cnt')
        .first();
    return parseInt(String(result?.cnt ?? 0), 10);
}

/**
 * Update job progress
 */
async function updateProgress(
    jobId: number,
    progress: number
): Promise<void> {
    await db('derived_column_jobs')
        .where('id', jobId)
        .update({ progress: Math.min(100, Math.round(progress)) });
}

/**
 * Execute derived column calculation - FAST mode
 * Single UPDATE statement for entire table
 */
async function executeFastMode(
    tableName: string,
    targetColumn: string,
    expression: string
): Promise<number> {
    const sql = `UPDATE "${tableName}" SET "${targetColumn}" = ${expression} WHERE "${targetColumn}" IS NULL`;
    const result = await db.raw(sql);
    return result?.changes ?? 0;
}

/**
 * Execute derived column calculation - BATCH mode
 * Uses ROWID-based batching for efficiency
 */
async function executeBatchMode(
    tableName: string,
    targetColumn: string,
    expression: string,
    totalRows: number,
    jobId: number
): Promise<number> {
    let processedTotal = 0;
    let lastReportedProgress = 0;

    // Get min and max rowid
    const minMaxResult = await db.raw(
        `SELECT MIN(rowid) as minId, MAX(rowid) as maxId FROM "${tableName}" WHERE "${targetColumn}" IS NULL`
    );

    let minId = minMaxResult?.[0]?.minId ?? 0;
    const maxId = minMaxResult?.[0]?.maxId ?? 0;

    if (minId === null || maxId === null) {
        log('No pending rows found');
        return 0;
    }

    // Process in batches using rowid ranges
    while (minId <= maxId) {
        const batchEnd = minId + BATCH_SIZE - 1;

        // Direct UPDATE with rowid range - much faster than SELECT + UPDATE
        const sql = `
            UPDATE "${tableName}" 
            SET "${targetColumn}" = ${expression} 
            WHERE rowid >= ${minId} 
              AND rowid <= ${batchEnd}
              AND "${targetColumn}" IS NULL
        `;

        const result = await db.raw(sql);
        const affected = result?.changes ?? 0;
        processedTotal += affected;

        // Update progress (limit updates to reduce DB writes)
        const progress = Math.min(99, (processedTotal / totalRows) * 100);
        if (progress - lastReportedProgress >= 5) {
            await updateProgress(jobId, progress);
            lastReportedProgress = progress;
            log(`Progress: ${progress.toFixed(1)}% (${processedTotal}/${totalRows})`);
        }

        minId = batchEnd + 1;
    }

    return processedTotal;
}

/**
 * Process a single derived column job
 */
async function processJob(job: DerivedColumnJob): Promise<void> {
    const tableName = getTableName(job.base_id);
    const targetCol = job.target_column;
    const sourceCol = job.source_column;

    log(`Processing job ${job.id}`, { tableName, sourceCol, targetCol, operation: job.operation });

    try {
        // Mark as running
        await db('derived_column_jobs')
            .where('id', job.id)
            .update({
                status: 'running',
                started_at: new Date().toISOString(),
                progress: 0
            });

        // Build expression
        const expression = buildExpression(job.operation, sourceCol);
        log(`Expression: ${expression}`);

        // Count rows to process
        const totalRows = await countRows(tableName);
        const pendingRows = await countPendingRows(tableName, targetCol);

        log(`Table stats`, { totalRows, pendingRows });

        if (pendingRows === 0) {
            // Nothing to do
            await db('derived_column_jobs')
                .where('id', job.id)
                .update({
                    status: 'completed',
                    progress: 100,
                    completed_at: new Date().toISOString()
                });
            return;
        }

        const startTime = Date.now();
        let processedRows = 0;

        // Choose mode based on table size
        if (totalRows <= FAST_MODE_THRESHOLD) {
            log(`Using FAST mode (table has ${totalRows} rows, threshold is ${FAST_MODE_THRESHOLD})`);
            processedRows = await executeFastMode(tableName, targetCol, expression);
        } else {
            log(`Using BATCH mode (table has ${totalRows} rows, batch size ${BATCH_SIZE})`);
            processedRows = await executeBatchMode(tableName, targetCol, expression, pendingRows, job.id);
        }

        const elapsed = Date.now() - startTime;
        const rowsPerSecond = processedRows > 0 ? Math.round(processedRows / (elapsed / 1000)) : 0;

        log(`Job ${job.id} completed`, { processedRows, elapsedMs: elapsed, rowsPerSecond });

        // Mark as completed
        await db('derived_column_jobs')
            .where('id', job.id)
            .update({
                status: 'completed',
                progress: 100,
                completed_at: new Date().toISOString()
            });

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[derivedColumnWorker] Job ${job.id} failed:`, errorMessage);

        await db('derived_column_jobs')
            .where('id', job.id)
            .update({
                status: 'failed',
                error_message: errorMessage.slice(0, 1000),
                completed_at: new Date().toISOString()
            });
    }
}

/**
 * Poll for pending jobs and process them
 */
async function poll(): Promise<void> {
    try {
        // Get next pending job (FIFO)
        const job = await db('derived_column_jobs')
            .where('status', 'pending')
            .orderBy('created_at', 'asc')
            .first() as DerivedColumnJob | undefined;

        if (job) {
            await processJob(job);
        }
    } catch (error) {
        console.error('[derivedColumnWorker] Poll error:', error);
    }
}

/**
 * Main worker loop
 */
export async function derivedColumnWorkerLoop(): Promise<void> {
    console.log(`[derivedColumnWorkerLoop] started (poll interval: ${POLL_INTERVAL_MS / 1000}s, fast threshold: ${FAST_MODE_THRESHOLD}, batch size: ${BATCH_SIZE})`);

    // eslint-disable-next-line no-constant-condition
    while (true) {
        await poll();
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
}

// Start worker if running directly
if (require.main === module) {
    derivedColumnWorkerLoop().catch(console.error);
}
