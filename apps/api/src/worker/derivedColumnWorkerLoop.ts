/**
 * Derived Column Worker Loop
 * Runs as part of the main server process, polling for pending derived column jobs
 * and processing them in the background.
 */

import db from '../db/knex';

const LOG_PREFIX = '[derivedColumnWorkerLoop]';
const DEFAULT_INTERVAL_SECONDS = parseInt(process.env.DERIVED_COLUMN_POLL_SECONDS || '5', 10);
const FAST_POLL_INTERVAL_MS = 500;
const MIN_POLL_INTERVAL_MS = 1000;
// Increased batch size for better performance on Windows machines with 8GB+ RAM
const BATCH_SIZE = parseInt(process.env.DERIVED_COLUMN_BATCH_SIZE || '50000', 10);
// Use direct SQL UPDATE instead of SELECT + UPDATE for much better performance
const USE_DIRECT_UPDATE = process.env.DERIVED_COLUMN_DIRECT_UPDATE !== 'false';
// Fast mode: single UPDATE for tables smaller than this threshold
const FAST_MODE_THRESHOLD = parseInt(process.env.DERIVED_COLUMN_FAST_THRESHOLD || '500000', 10);
const DEBUG = process.env.DERIVED_COLUMN_DEBUG === 'true';

interface DerivedColumnJob {
    id: number;
    base_id: number;
    source_column: string;
    target_column: string | null;
    operation: string;
    status: string;
    total_rows: number | null;
    processed_rows: number;
    progress: number;
    error: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────────────────────────────────────────

async function updateJobProgress(jobId: number, processedRows: number, totalRows: number) {
    const progress = totalRows > 0 ? Math.min(100, Math.round((processedRows / totalRows) * 100)) : 0;
    await db('derived_column_jobs')
        .where({ id: jobId })
        .update({
            processed_rows: processedRows,
            progress,
            updated_at: db.fn.now()
        });
}

async function updateJobStatus(jobId: number, status: string, error?: string): Promise<void> {
    const updates: Record<string, unknown> = {
        status,
        updated_at: db.fn.now()
    };
    if (error !== undefined) {
        updates.error = error;
    }
    if (status === 'DONE' || status === 'FAILED') {
        updates.completed_at = db.fn.now();
    }
    await db('derived_column_jobs').where({ id: jobId }).update(updates);
}

function getOperationExpression(op: string, sourceColumn: string): any {
    const opUpper = String(op).toUpperCase();
    switch (opUpper) {
        case 'ABS':
            // Use COALESCE to handle NULL values - ABS(NULL) returns NULL which causes infinite loops
            return db.raw('COALESCE(abs(??), 0)', [sourceColumn]);
        case 'INVERTER':
            // Use COALESCE to handle NULL values
            return db.raw('COALESCE((-1) * ??, 0)', [sourceColumn]);
        default:
            throw new Error(`Unsupported derived operation: ${op}`);
    }
}

/**
 * Get the raw SQL expression for an operation (for use in raw queries)
 */
function getOperationSQL(op: string, sourceColumn: string): string {
    const opUpper = String(op).toUpperCase();
    const escapedCol = `"${sourceColumn.replace(/"/g, '""')}"`;
    switch (opUpper) {
        case 'ABS':
            return `COALESCE(abs(${escapedCol}), 0)`;
        case 'INVERTER':
            return `COALESCE((-1) * ${escapedCol}, 0)`;
        default:
            throw new Error(`Unsupported derived operation: ${op}`);
    }
}

function generateTargetColumnName(op: string, sourceColumn: string): string {
    const prefix = String(op).toLowerCase();
    let targetCol = `${prefix}_${sourceColumn}`.toLowerCase();
    return targetCol.replace(/[^a-z0-9_]/g, '_');
}

async function persistMetadata(baseId: number, targetCol: string, operation: string, _sourceColumn: string) {
    try {
        const existingCol = await db('base_columns')
            .where({ base_id: baseId, sqlite_name: targetCol })
            .first();

        if (!existingCol) {
            const maxIdxRow = await db('base_columns')
                .where({ base_id: baseId })
                .max('col_index as mx')
                .first();
            const nextIndex = (maxIdxRow && (maxIdxRow.mx || 0)) + 1;
            const excelName = `${String(operation).toUpperCase()}`;

            await db('base_columns').insert({
                base_id: baseId,
                col_index: nextIndex,
                excel_name: excelName,
                sqlite_name: targetCol
            });
            console.log(`${LOG_PREFIX} added base_columns metadata for ${targetCol}`);
        }
    } catch (e) {
        console.error(`${LOG_PREFIX} failed to save base_columns metadata`, e);
    }

    // Clear cache
    try {
        const baseColsRepo = require('../repos/baseColumnsRepository').default;
        if (baseColsRepo && typeof baseColsRepo.clearColumnsCache === 'function') {
            baseColsRepo.clearColumnsCache(baseId);
        }
    } catch (_) { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Job processing
// ─────────────────────────────────────────────────────────────────────────────

async function fetchNextJob(): Promise<DerivedColumnJob | null> {
    // First, check for jobs that need recovery (RUNNING with 100% progress)
    const stuckJob = await db<DerivedColumnJob>('derived_column_jobs')
        .where({ status: 'RUNNING' })
        .where('progress', '>=', 100)
        .orderBy('created_at', 'asc')
        .first();

    if (stuckJob) {
        return stuckJob;
    }

    // Then, check for RUNNING jobs that need to continue (recovery from crash)
    const runningJob = await db<DerivedColumnJob>('derived_column_jobs')
        .where({ status: 'RUNNING' })
        .orderBy('created_at', 'asc')
        .first();

    if (runningJob) {
        return runningJob;
    }

    // Finally, check for PENDING jobs
    const pendingJob = await db<DerivedColumnJob>('derived_column_jobs')
        .where({ status: 'PENDING' })
        .orderBy('created_at', 'asc')
        .first();

    return pendingJob || null;
}

async function processJob(job: DerivedColumnJob): Promise<void> {
    const jobId = job.id;
    console.log(`${LOG_PREFIX} processing job ${jobId} (status: ${job.status}, progress: ${job.progress}%)`);

    try {
        // Get base
        const base = await db('bases').where({ id: job.base_id }).first();
        if (!base || !base.tabela_sqlite) {
            await updateJobStatus(jobId, 'FAILED', 'Base inválida ou não ingerida');
            return;
        }

        const tableName = base.tabela_sqlite;
        const sourceColumn = job.source_column;
        const operation = job.operation;

        // Validate source column exists
        const colInfo = await db(tableName).columnInfo();
        const columns = Object.keys(colInfo || {});
        if (!columns.includes(sourceColumn)) {
            await updateJobStatus(jobId, 'FAILED', `Coluna origem '${sourceColumn}' não encontrada na tabela ${tableName}`);
            return;
        }

        // Generate or use target column name
        const targetCol = job.target_column || generateTargetColumnName(operation, sourceColumn);

        // Add column if it doesn't exist
        if (!columns.includes(targetCol)) {
            console.log(`${LOG_PREFIX} adding column ${targetCol} to ${tableName}`);
            await db.schema.alterTable(tableName, (t) => {
                t.decimal(targetCol, 30, 10).nullable();
            });
        }

        // Update job with target column if it wasn't set
        if (!job.target_column) {
            await db('derived_column_jobs').where({ id: jobId }).update({
                target_column: targetCol,
                updated_at: db.fn.now()
            });
        }

        // If job was at 100% progress but stuck as RUNNING, just finalize it
        if (job.status === 'RUNNING' && job.progress >= 100) {
            console.log(`${LOG_PREFIX} job ${jobId} was stuck at 100%, finalizing...`);
            await persistMetadata(job.base_id, targetCol, operation, sourceColumn);
            await updateJobStatus(jobId, 'DONE');
            console.log(`${LOG_PREFIX} job ${jobId} finalized successfully`);
            return;
        }

        // Get remaining rows to process (NULL target column)
        const countResult = await db(tableName).whereNull(targetCol).count('* as cnt').first();
        const remainingRows = Number(countResult?.cnt) || 0;

        // Get total rows in table for progress calculation
        const totalCountResult = await db(tableName).count('* as cnt').first();
        const totalTableRows = Number(totalCountResult?.cnt) || 0;

        const isRecovery = job.status === 'RUNNING';
        const alreadyProcessed = totalTableRows - remainingRows;

        console.log(`${LOG_PREFIX} job ${jobId}: remaining=${remainingRows}, total=${totalTableRows}${isRecovery ? ' (recovery)' : ''}`);

        await db('derived_column_jobs').where({ id: jobId }).update({
            total_rows: totalTableRows,
            processed_rows: alreadyProcessed,
            status: 'RUNNING',
            started_at: isRecovery ? job.started_at : db.fn.now(),
            updated_at: db.fn.now()
        });

        if (remainingRows === 0) {
            console.log(`${LOG_PREFIX} job ${jobId}: no rows to process, marking as done`);
            await persistMetadata(job.base_id, targetCol, operation, sourceColumn);
            await updateJobStatus(jobId, 'DONE');
            return;
        }

        // Get operation expression
        const opExpression = getOperationExpression(operation, sourceColumn);
        const opSQL = getOperationSQL(operation, sourceColumn);
        const escapedTableName = tableName.replace(/"/g, '""');
        const escapedTargetCol = targetCol.replace(/"/g, '""');

        // Process in batches - use direct UPDATE for much better performance
        let processedRows = alreadyProcessed;
        let lastProgressLog = 0;

        // FAST MODE: For small tables, use a single UPDATE (much faster)
        if (remainingRows <= FAST_MODE_THRESHOLD && USE_DIRECT_UPDATE) {
            console.log(`${LOG_PREFIX} job ${jobId}: using FAST mode (${remainingRows} rows <= threshold ${FAST_MODE_THRESHOLD})`);

            const startTime = Date.now();
            const updateResult = await db.raw(`
                UPDATE "${escapedTableName}"
                SET "${escapedTargetCol}" = ${opSQL}
                WHERE "${escapedTargetCol}" IS NULL
            `);

            const changes = updateResult?.changes || remainingRows;
            processedRows += changes;
            const elapsed = Date.now() - startTime;
            const rowsPerSecond = changes > 0 ? Math.round(changes / (elapsed / 1000)) : 0;

            if (DEBUG) {
                console.log(`${LOG_PREFIX} job ${jobId}: FAST mode completed in ${elapsed}ms (${rowsPerSecond} rows/sec)`);
            }
        } else if (USE_DIRECT_UPDATE) {
            // OPTIMIZED: Use direct UPDATE with LIMIT instead of SELECT + UPDATE
            // This is MUCH faster as it avoids fetching IDs and uses a single query
            console.log(`${LOG_PREFIX} job ${jobId}: using direct UPDATE mode (batch=${BATCH_SIZE})`);

            while (true) {
                // Get the rowids to update in this batch using a subquery
                // SQLite doesn't support UPDATE...LIMIT, so we use rowid IN (subquery)
                const updateResult = await db.raw(`
                    UPDATE "${escapedTableName}"
                    SET "${escapedTargetCol}" = ${opSQL}
                    WHERE rowid IN (
                        SELECT rowid FROM "${escapedTableName}"
                        WHERE "${escapedTargetCol}" IS NULL
                        LIMIT ?
                    )
                `, [BATCH_SIZE]);

                // SQLite returns changes in the result
                const changes = updateResult?.changes || 0;

                if (changes === 0) {
                    break;
                }

                processedRows += changes;

                // Update progress every 5%
                const currentProgress = Math.round((processedRows / totalTableRows) * 100);
                if (currentProgress >= lastProgressLog + 5 || currentProgress === 100) {
                    console.log(`${LOG_PREFIX} job ${jobId}: ${processedRows}/${totalTableRows} (${currentProgress}%)`);
                    await updateJobProgress(jobId, processedRows, totalTableRows);
                    lastProgressLog = currentProgress;
                }
            }
        } else {
            // FALLBACK: Original method with SELECT + UPDATE (slower but safer)
            console.log(`${LOG_PREFIX} job ${jobId}: using SELECT+UPDATE mode (batch=${BATCH_SIZE})`);

            while (true) {
                const ids: number[] = await db(tableName)
                    .whereNull(targetCol)
                    .limit(BATCH_SIZE)
                    .pluck('id');

                if (!ids || ids.length === 0) {
                    break;
                }

                // Update in batches (SQLite has limit of ~999 variables)
                const CHUNK_SIZE = 500;
                for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
                    const chunk = ids.slice(i, i + CHUNK_SIZE);
                    await db(tableName)
                        .whereIn('id', chunk)
                        .update({ [targetCol]: opExpression });
                }

                processedRows += ids.length;

                // Update progress every 5%
                const currentProgress = Math.round((processedRows / totalTableRows) * 100);
                if (currentProgress >= lastProgressLog + 5 || currentProgress === 100) {
                    console.log(`${LOG_PREFIX} job ${jobId}: ${processedRows}/${totalTableRows} (${currentProgress}%)`);
                    await updateJobProgress(jobId, processedRows, totalTableRows);
                    lastProgressLog = currentProgress;
                }
            }
        }

        // Persist metadata BEFORE marking as done
        await persistMetadata(job.base_id, targetCol, operation, sourceColumn);

        // Mark as done
        await db('derived_column_jobs').where({ id: jobId }).update({
            processed_rows: processedRows,
            progress: 100,
            status: 'DONE',
            completed_at: db.fn.now(),
            updated_at: db.fn.now()
        });

        console.log(`${LOG_PREFIX} job ${jobId} completed: ${processedRows} rows processed`);

    } catch (err) {
        console.error(`${LOG_PREFIX} job ${jobId} failed:`, err);
        await updateJobStatus(jobId, 'FAILED', String((err as any)?.message || err));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker loop
// ─────────────────────────────────────────────────────────────────────────────

export function startDerivedColumnWorker(intervalSeconds = DEFAULT_INTERVAL_SECONDS) {
    let running = false;

    const scheduleNextTick = (fast = false) => {
        const delay = fast ? FAST_POLL_INTERVAL_MS : Math.max(1000, intervalSeconds * 1000);
        setTimeout(() => void tick(), delay);
    };

    const tick = async () => {
        if (running) {
            scheduleNextTick(false);
            return;
        }

        running = true;
        try {
            const job = await fetchNextJob();
            if (!job) {
                scheduleNextTick(false);
                return;
            }

            await processJob(job);

            // Check if there are more jobs
            const nextJob = await fetchNextJob();
            scheduleNextTick(!!nextJob);

        } catch (err) {
            console.error(`${LOG_PREFIX} tick error:`, err);
            scheduleNextTick(false);
        } finally {
            running = false;
        }
    };

    // Start first tick
    console.log(`${LOG_PREFIX} started (poll interval: ${intervalSeconds}s)`);
    void tick();

    return () => {
        // Cleanup - nothing to clear since we use setTimeout
    };
}

export default { startDerivedColumnWorker };
