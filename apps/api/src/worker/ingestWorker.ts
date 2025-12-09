import db from '../db/knex';
import * as ingestRepo from '../repos/ingestJobsRepository';
import path from 'path';
import { fork, ChildProcess } from 'child_process';

const DEFAULT_INTERVAL_SECONDS = Number(process.env.WORKER_POLL_SECONDS || 5);
const LOG_PREFIX = '[ingestWorker]';

type IngestJobRow = ingestRepo.IngestJobRow;

async function fetchOldestPendingIngestJob(): Promise<IngestJobRow | null> {
    const job = await db<IngestJobRow>('ingest_jobs').where({ status: 'PENDING' }).orderBy('created_at', 'asc').first();
    return job || null;
}

async function claimIngestJob(jobId: number): Promise<boolean> {
    const updated = await db('ingest_jobs').where({ id: jobId, status: 'PENDING' }).update({ status: 'RUNNING', updated_at: db.fn.now() });
    return Boolean(updated);
}

function runnerScriptPath(): { script: string; useTsNode: boolean } {
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd) return { script: path.resolve(__dirname, 'ingestRunner.js'), useTsNode: false };
    return { script: path.resolve(__dirname, 'ingestRunner.ts'), useTsNode: true };
}

function spawnIngestRunner(jobId: number): ChildProcess {
    const { script, useTsNode } = runnerScriptPath();
    if (useTsNode) return fork(script, [String(jobId)], { stdio: 'inherit', execArgv: ['-r', 'ts-node/register'] });
    return fork(script, [String(jobId)], { stdio: 'inherit' });
}

function safeUpdateStatus(jobId: number, status: ingestRepo.IngestJobStatus, message?: string) {
    return ingestRepo.updateJobStatus(jobId, status, message || '').catch((err) => console.warn(`${LOG_PREFIX} Failed to update status for job ${jobId}`, err));
}

export function startIngestWorker(intervalSeconds = DEFAULT_INTERVAL_SECONDS) {
    let running = false;

    const tick = async () => {
        if (running) return;
        running = true;
        try {
            const job = await fetchOldestPendingIngestJob();
            if (!job) return;

            const jobId = job.id;
            const claimed = await claimIngestJob(jobId);
            if (!claimed) return;

            let child: ChildProcess;
            try {
                child = spawnIngestRunner(jobId);
            } catch (err) {
                console.error(`${LOG_PREFIX} Error while spawning ingest runner for job ${jobId}`, err);
                await safeUpdateStatus(jobId, 'FAILED', String((err as Error).message || err));
                return;
            }

            child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
                if (code !== 0) console.error(`${LOG_PREFIX} ingestRunner exited with code ${code} signal ${signal} for job ${jobId}`);
                else console.log(`${LOG_PREFIX} ingestRunner completed for job ${jobId}`);
            });

            child.on('error', (err: Error) => {
                console.error(`${LOG_PREFIX} Failed to spawn ingestRunner child process for job ${jobId}`, err);
                void safeUpdateStatus(jobId, 'FAILED', 'Failed to spawn ingest runner');
            });
        } catch (err) {
            console.error(`${LOG_PREFIX} Ingest worker tick error`, err);
        } finally {
            running = false;
        }
    };

    const timer = setInterval(() => void tick(), Math.max(1000, intervalSeconds * 1000));
    void tick();
    return () => clearInterval(timer);
}

export default { startIngestWorker };
