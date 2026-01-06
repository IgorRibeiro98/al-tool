import db from '../db/knex';
import * as ingestRepo from '../repos/ingestJobsRepository';
import path from 'path';
import { fork, ChildProcess } from 'child_process';

const DEFAULT_INTERVAL_SECONDS = parseInt(process.env.WORKER_POLL_SECONDS || '5', 10);
const FAST_POLL_INTERVAL_MS = 500; // Quick poll when there might be more work
const MIN_POLL_INTERVAL_MS = 1000;
const LOG_PREFIX = '[ingestWorker]';

type IngestJobRow = ingestRepo.IngestJobRow;

interface RunnerScript {
    readonly script: string;
    readonly useTsNode: boolean;
}

async function fetchOldestPendingIngestJob(): Promise<IngestJobRow | null> {
    const job = await db<IngestJobRow>('ingest_jobs').where({ status: 'PENDING' }).orderBy('created_at', 'asc').first();
    return job || null;
}

async function countPendingJobs(): Promise<number> {
    const result = await db('ingest_jobs').where({ status: 'PENDING' }).count('* as cnt').first();
    return Number(result?.cnt) || 0;
}

async function claimIngestJob(jobId: number): Promise<boolean> {
    const updated = await db('ingest_jobs').where({ id: jobId, status: 'PENDING' }).update({ status: 'RUNNING', updated_at: db.fn.now() });
    return Boolean(updated);
}

function runnerScriptPath(): RunnerScript {
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd) return { script: path.resolve(__dirname, 'ingestRunner.js'), useTsNode: false };
    return { script: path.resolve(__dirname, 'ingestRunner.ts'), useTsNode: true };
}

function spawnIngestRunner(jobId: number): ChildProcess {
    const { script, useTsNode } = runnerScriptPath();
    const execArgv = useTsNode ? ['-r', 'ts-node/register'] : [];
    return fork(script, [String(jobId)], { stdio: 'inherit', execArgv });
}

function safeUpdateStatus(jobId: number, status: ingestRepo.IngestJobStatus, message?: string): Promise<void> {
    return ingestRepo.updateJobStatus(jobId, status, message || '')
        .then(() => { /* success */ })
        .catch((err) => console.warn(`${LOG_PREFIX} Failed to update status for job ${jobId}`, err));
}

export function startIngestWorker(intervalSeconds = DEFAULT_INTERVAL_SECONDS) {
    let running = false;
    let activeChild: ChildProcess | null = null;
    let pendingCount = 0;

    const scheduleNextTick = (fast = false): void => {
        const delay = fast ? FAST_POLL_INTERVAL_MS : Math.max(MIN_POLL_INTERVAL_MS, intervalSeconds * 1000);
        setTimeout(() => void tick(), delay);
    };

    const tick = async () => {
        if (running) {
            scheduleNextTick(false);
            return;
        }
        running = true;
        try {
            const job = await fetchOldestPendingIngestJob();
            if (!job) {
                scheduleNextTick(false);
                return;
            }

            const jobId = job.id;
            const claimed = await claimIngestJob(jobId);
            if (!claimed) {
                scheduleNextTick(true); // Try again quickly - someone else might have claimed it
                return;
            }

            // Check if there are more pending jobs
            pendingCount = await countPendingJobs();

            let child: ChildProcess;
            try {
                child = spawnIngestRunner(jobId);
                activeChild = child;
            } catch (err) {
                console.error(`${LOG_PREFIX} Error while spawning ingest runner for job ${jobId}`, err);
                await safeUpdateStatus(jobId, 'FAILED', String((err as Error).message || err));
                scheduleNextTick(pendingCount > 0);
                return;
            }

            child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
                activeChild = null;
                running = false;
                if (code !== 0) {
                    console.error(`${LOG_PREFIX} ingestRunner exited with code ${code} signal ${signal} for job ${jobId}`);
                } else {
                    console.log(`${LOG_PREFIX} ingestRunner completed for job ${jobId}`);
                }
                // Schedule next tick immediately if there are pending jobs
                scheduleNextTick(pendingCount > 0);
            });

            child.on('error', (err: Error) => {
                activeChild = null;
                running = false;
                console.error(`${LOG_PREFIX} Failed to spawn ingestRunner child process for job ${jobId}`, err);
                void safeUpdateStatus(jobId, 'FAILED', 'Failed to spawn ingest runner');
                scheduleNextTick(pendingCount > 0);
            });

            // Don't schedule next tick here - wait for child to exit
            return;

        } catch (err) {
            console.error(`${LOG_PREFIX} Ingest worker tick error`, err);
            scheduleNextTick(false);
        } finally {
            if (!activeChild) {
                running = false;
            }
        }
    };

    // Start first tick
    void tick();

    return () => {
        // Cleanup - nothing to clear since we use setTimeout now
    };
}

export default { startIngestWorker };
