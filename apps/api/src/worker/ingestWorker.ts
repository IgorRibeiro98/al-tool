import db from '../db/knex';
import * as ingestRepo from '../repos/ingestJobsRepository';
import path from 'path';
import { fork } from 'child_process';

const DEFAULT_INTERVAL_SECONDS = Number(process.env.WORKER_POLL_SECONDS || 5);

export function startIngestWorker(intervalSeconds = DEFAULT_INTERVAL_SECONDS) {
    let running = false;

    const tick = async () => {
        if (running) return;
        running = true;
        try {
            const job: any = await db('ingest_jobs').where({ status: 'PENDING' }).orderBy('created_at', 'asc').first();
            if (!job) { running = false; return; }

            const claimed = await db('ingest_jobs').where({ id: job.id, status: 'PENDING' }).update({ status: 'RUNNING', updated_at: db.fn.now() });
            if (!claimed) { running = false; return; }

            const jobId = job.id as number;
            try {
                const isProd = process.env.NODE_ENV === 'production';
                let child: any;
                if (isProd) {
                    const prodRunner = path.resolve(__dirname, 'ingestRunner.js');
                    child = fork(prodRunner, [String(jobId)], { stdio: 'inherit' });
                } else {
                    const runnerPath = path.resolve(__dirname, 'ingestRunner.ts');
                    child = fork(runnerPath, [String(jobId)], {
                        stdio: 'inherit',
                        execArgv: ['-r', 'ts-node/register']
                    });
                }

                child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
                    if (code !== 0) {
                        console.error(`ingestRunner exited with code ${code} signal ${signal} for job ${jobId}`);
                    } else {
                        console.log(`ingestRunner completed for job ${jobId}`);
                    }
                });

                child.on('error', (err: any) => {
                    console.error('Failed to spawn ingestRunner child process', err);
                    ingestRepo.updateJobStatus(jobId, 'FAILED', 'Failed to spawn ingest runner').catch(e => console.error(e));
                });
            } catch (err: any) {
                console.error('Error while spawning ingest runner for job', jobId, err);
                await ingestRepo.updateJobStatus(jobId, 'FAILED', String(err?.message || err));
            }
        } catch (err: any) {
            console.error('Ingest worker tick error', err);
        } finally {
            running = false;
        }
    };

    const timer = setInterval(() => void tick(), Math.max(1000, intervalSeconds * 1000));
    void tick();
    return () => clearInterval(timer);
}

export default { startIngestWorker };
