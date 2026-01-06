import db from '../db/knex';
import * as jobsRepo from '../repos/jobsRepository';
import path from 'path';
import { fork, ChildProcess } from 'child_process';

const DEFAULT_INTERVAL_SECONDS = parseInt(process.env.WORKER_POLL_SECONDS || '5', 10);
const MIN_POLL_INTERVAL_MS = 1000;
const LOG_PREFIX = '[conciliacaoWorker]';

interface JobRow {
    readonly id: number;
    readonly status?: string;
    readonly created_at?: string;
}

interface RunnerScript {
    readonly script: string;
    readonly useTsNode: boolean;
}

async function fetchOldestPendingJob(): Promise<JobRow | null> {
    const job = await db<JobRow>('jobs_conciliacao').where({ status: 'PENDING' }).orderBy('created_at', 'asc').first();
    return job || null;
}

async function claimJob(jobId: number): Promise<boolean> {
    const claimed = await db('jobs_conciliacao').where({ id: jobId, status: 'PENDING' }).update({ status: 'RUNNING', updated_at: db.fn.now() });
    return Boolean(claimed);
}

function runnerScriptPath(): RunnerScript {
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd) return { script: path.resolve(__dirname, 'jobRunner.js'), useTsNode: false };
    return { script: path.resolve(__dirname, 'jobRunner.ts'), useTsNode: true };
}

function spawnJobRunner(jobId: number): ChildProcess {
    const { script, useTsNode } = runnerScriptPath();
    const execArgv = useTsNode ? ['-r', 'ts-node/register'] : [];
    return fork(script, [String(jobId)], { stdio: 'inherit', execArgv });
}

function safeSetPipelineStage(jobId: number, stage: string, order: number | null, message: string): Promise<void> {
    return jobsRepo.setJobPipelineStage(jobId, stage, order, message)
        .then(() => { /* success */ })
        .catch((err) => console.warn(`${LOG_PREFIX} Failed to set pipeline stage for job ${jobId}`, err));
}

function safeUpdateJobStatus(jobId: number, status: jobsRepo.JobStatus, message?: string): Promise<void> {
    return jobsRepo.updateJobStatus(jobId, status, message || '')
        .then(() => { /* success */ })
        .catch((err) => console.warn(`${LOG_PREFIX} Failed to update status for job ${jobId}`, err));
}

export function startConciliacaoWorker(intervalSeconds = DEFAULT_INTERVAL_SECONDS) {
    let running = false;

    const tick = async (): Promise<void> => {
        if (running) return;
        running = true;
        try {
            const job = await fetchOldestPendingJob();
            if (!job) return;

            const jobId = job.id;
            const claimed = await claimJob(jobId);
            if (!claimed) return; // someone else claimed

            // best-effort: mark pipeline stage
            await safeSetPipelineStage(jobId, 'starting_worker', 8, 'Iniciando conciliação');

            let child: ChildProcess;
            try {
                child = spawnJobRunner(jobId);
            } catch (err) {
                console.error(`${LOG_PREFIX} Error spawning runner for job ${jobId}`, err);
                await safeSetPipelineStage(jobId, 'failed', null, 'Conciliação interrompida');
                await safeUpdateJobStatus(jobId, 'FAILED', String((err as Error).message || err));
                return;
            }

            child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
                if (code !== 0) console.error(`${LOG_PREFIX} jobRunner exited with code ${code} signal ${signal} for job ${jobId}`);
                else console.log(`${LOG_PREFIX} jobRunner completed for job ${jobId}`);
            });

            child.on('error', (err: Error) => {
                console.error(`${LOG_PREFIX} Failed to spawn jobRunner child process for job ${jobId}`, err);
                void safeSetPipelineStage(jobId, 'failed', null, 'Conciliação interrompida');
                void safeUpdateJobStatus(jobId, 'FAILED', 'Failed to spawn runner process');
            });
        } catch (err) {
            console.error(`${LOG_PREFIX} Worker tick error`, err);
        } finally {
            running = false;
        }
    };

    const timer = setInterval(() => void tick(), Math.max(MIN_POLL_INTERVAL_MS, intervalSeconds * 1000));
    void tick();
    return () => clearInterval(timer);
}

export default { startConciliacaoWorker };
