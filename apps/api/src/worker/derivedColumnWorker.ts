/**
 * Derived Column Worker
 * Processes derived column creation in background for large bases
 * Usage: npx ts-node src/worker/derivedColumnWorker.ts <jobId>
 */

import db from '../db/knex';

const LOG_PREFIX = '[derivedColumnWorker]';
const BATCH_SIZE = parseInt(process.env.DERIVED_COLUMN_BATCH_SIZE || '2000', 10);
const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;
const EXIT_INVALID_ARG = 2;
const EXIT_JOB_NOT_FOUND = 3;
const EXIT_INVALID_BASE = 4;
const EXIT_COLUMN_NOT_FOUND = 5;

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

async function updateJobProgress(jobId: number, processedRows: number, totalRows: number, status = 'RUNNING'): Promise<void> {
    const progress = totalRows > 0 ? Math.min(100, Math.round((processedRows / totalRows) * 100)) : 0;
    await db('derived_column_jobs')
        .where({ id: jobId })
        .update({
            processed_rows: processedRows,
            progress,
            status,
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

async function handleFatal(jobId: number | null, err: unknown): Promise<never> {
    console.error(`${LOG_PREFIX} fatal error`, err);
    if (jobId) {
        const message = err instanceof Error ? err.message : String(err);
        try {
            await updateJobStatus(jobId, 'FAILED', message);
        } catch { /* ignore */ }
    }
    process.exit(EXIT_FAILURE);
}

function getOperationExpression(op: string, sourceColumn: string): any {
    const opUpper = String(op).toUpperCase();
    switch (opUpper) {
        case 'ABS':
            return db.raw('abs(??)', [sourceColumn]);
        case 'INVERTER':
            return db.raw('(-1) * ??', [sourceColumn]);
        default:
            throw new Error(`Unsupported derived operation: ${op}`);
    }
}

function generateTargetColumnName(op: string, sourceColumn: string): string {
    const prefix = String(op).toLowerCase();
    let targetCol = `${prefix}_${sourceColumn}`.toLowerCase();
    return targetCol.replace(/[^a-z0-9_]/g, '_');
}

async function main(): Promise<void> {
    const argv = process.argv || [];
    const jobId = parseInt(argv[2] || '', 10);

    if (!jobId || Number.isNaN(jobId)) {
        console.error(`${LOG_PREFIX} requires a numeric jobId argument`);
        process.exit(EXIT_INVALID_ARG);
    }

    console.log(`${LOG_PREFIX} starting job ${jobId}`);

    try {
        const job = await db('derived_column_jobs').where({ id: jobId }).first() as DerivedColumnJob | undefined;
        if (!job) {
            console.error(`${LOG_PREFIX} job not found`, jobId);
            process.exit(EXIT_JOB_NOT_FOUND);
        }

        // Check if already done
        if (job.status === 'DONE') {
            console.log(`${LOG_PREFIX} job already completed, exiting`);
            process.exit(EXIT_SUCCESS);
        }

        // If job is RUNNING with progress=100, it likely crashed before finalizing
        // We should finalize it (persist metadata and mark as DONE)
        if (job.status === 'RUNNING' && job.progress >= 100) {
            console.log(`${LOG_PREFIX} job was RUNNING with 100% progress, finalizing...`);
            const base = await db('bases').where({ id: job.base_id }).first();
            if (base && base.tabela_sqlite && job.target_column) {
                await persistMetadata(job.base_id, job.target_column, job.operation, job.source_column);
                await db('derived_column_jobs').where({ id: jobId }).update({
                    status: 'DONE',
                    completed_at: db.fn.now(),
                    updated_at: db.fn.now()
                });
                console.log(`${LOG_PREFIX} job ${jobId} finalized successfully`);
            }
            process.exit(0);
        }

        // If job is RUNNING but not at 100%, allow it to continue (recover from crash)
        // The loop will skip already-processed rows since they have non-null target column values

        // Get base
        const base = await db('bases').where({ id: job.base_id }).first();
        if (!base?.tabela_sqlite) {
            await updateJobStatus(jobId, 'FAILED', 'Base inválida ou não ingerida');
            process.exit(EXIT_INVALID_BASE);
        }

        const tableName = base.tabela_sqlite as string;
        const sourceColumn = job.source_column;
        const operation = job.operation;

        // Validate source column exists
        const colInfo = await db(tableName).columnInfo();
        const columns = Object.keys(colInfo || {});
        if (!columns.includes(sourceColumn)) {
            await updateJobStatus(jobId, 'FAILED', `Coluna origem '${sourceColumn}' não encontrada na tabela ${tableName}`);
            process.exit(EXIT_COLUMN_NOT_FOUND);
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

        // Get remaining rows to process (NULL target column)
        const countResult = await db(tableName).whereNull(targetCol).count('* as cnt').first();
        const remainingRows = Number(countResult?.cnt) || 0;

        // Get total rows in table for progress calculation
        const totalCountResult = await db(tableName).count('* as cnt').first();
        const totalTableRows = Number(totalCountResult?.cnt) || 0;

        // Determine if this is a recovery (job was already running)
        const isRecovery = job.status === 'RUNNING';
        const alreadyProcessed = totalTableRows - remainingRows;

        console.log(`${LOG_PREFIX} remaining rows to process: ${remainingRows}${isRecovery ? ` (recovery mode, already processed: ${alreadyProcessed})` : ''}`);

        await db('derived_column_jobs').where({ id: jobId }).update({
            total_rows: totalTableRows,
            processed_rows: alreadyProcessed,
            status: 'RUNNING',
            started_at: isRecovery ? job.started_at : db.fn.now(),
            updated_at: db.fn.now()
        });

        if (remainingRows === 0) {
            console.log(`${LOG_PREFIX} no rows to process, marking as done`);
            await updateJobStatus(jobId, 'DONE');
            await persistMetadata(job.base_id, targetCol, operation, sourceColumn);
            process.exit(0);
        }

        // Get operation expression
        const opExpression = getOperationExpression(operation, sourceColumn);

        // Process in batches
        let processedRows = alreadyProcessed;
        let lastProgressLog = 0;

        while (true) {
            // Get batch of IDs where target column is null
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
                console.log(`${LOG_PREFIX} progress: ${processedRows}/${totalTableRows} (${currentProgress}%)`);
                await updateJobProgress(jobId, processedRows, totalTableRows);
                lastProgressLog = currentProgress;
            }

            // Allow GC between batches for very large datasets
            if (processedRows % (BATCH_SIZE * 10) === 0 && global.gc) {
                global.gc();
            }
        }

        // Persist metadata
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
        process.exit(0);

    } catch (err) {
        await handleFatal(jobId, err);
    }
}

async function persistMetadata(baseId: number, targetCol: string, operation: string, sourceColumn: string) {
    try {
        // Check if column already exists in base_columns
        const existingCol = await db('base_columns')
            .where({ base_id: baseId, sqlite_name: targetCol })
            .first();

        if (!existingCol) {
            const maxIdxRow = await db('base_columns')
                .where({ base_id: baseId })
                .max('col_index as mx')
                .first();
            const nextIndex = (maxIdxRow && (maxIdxRow.mx || 0)) + 1;
            // Use descriptive name: OP(source_column)
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

main().catch((err) => {
    console.error(`${LOG_PREFIX} unhandled error`, err);
    process.exit(1);
});
