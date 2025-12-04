import db from '../db/knex';
import * as jobsRepo from '../repos/jobsRepository';
import path from 'path';
import { fork } from 'child_process';

const DEFAULT_INTERVAL_SECONDS = Number(process.env.WORKER_POLL_SECONDS || 5);

export function startConciliacaoWorker(intervalSeconds = DEFAULT_INTERVAL_SECONDS) {
    let running = false;

    const tick = async () => {
        if (running) return; // avoid overlapping ticks
        running = true;
        try {
            // fetch one pending job (oldest)
            const job: any = await db('jobs_conciliacao').where({ status: 'PENDING' }).orderBy('created_at', 'asc').first();
            if (!job) {
                running = false;
                return;
            }

            // claim job atomically: only update if still PENDING
            const claimed = await db('jobs_conciliacao').where({ id: job.id, status: 'PENDING' }).update({ status: 'RUNNING', updated_at: db.fn.now() });
            if (!claimed) {
                // someone else claimed it
                running = false;
                return;
            }

            const jobId = job.id as number;

            try {
                await jobsRepo.setJobPipelineStage(jobId, 'starting_worker', 8, 'Iniciando conciliação');
            } catch (stageErr) {
                console.warn('Failed to set initial pipeline stage for job', jobId, stageErr);
            }

            // spawn a child process to run the pipeline so we don't block the event loop
            try {
                const isProd = process.env.NODE_ENV === 'production';
                let child: any;

                if (isProd) {
                    const prodRunner = path.resolve(__dirname, 'jobRunner.js');
                    child = fork(prodRunner, [String(jobId)], { stdio: 'inherit' });
                } else {
                    const runnerPath = path.resolve(__dirname, 'jobRunner.ts');
                    child = fork(runnerPath, [String(jobId)], {
                        stdio: 'inherit',
                        execArgv: ['-r', 'ts-node/register']
                    });
                }

                child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
                    if (code !== 0) {
                        console.error(`jobRunner exited with code ${code} signal ${signal} for job ${jobId}`);
                    } else {
                        console.log(`jobRunner completed for job ${jobId}`);
                    }
                });

                child.on('error', (err: any) => {
                    console.error('Failed to spawn jobRunner child process', err);
                    // mark job as FAILED if child couldn't be spawned
                    jobsRepo.setJobPipelineStage(jobId, 'failed', null, 'Conciliação interrompida').catch(() => { /* ignore */ });
                    jobsRepo.updateJobStatus(jobId, 'FAILED', 'Failed to spawn runner process').catch(e => console.error(e));
                });
            } catch (err: any) {
                console.error('Error while spawning runner for job', jobId, err);
                try { await jobsRepo.setJobPipelineStage(jobId, 'failed', null, 'Conciliação interrompida'); } catch (_) { }
                await jobsRepo.updateJobStatus(jobId, 'FAILED', String(err?.message || err));
            }
        } catch (err: any) {
            console.error('Worker tick error', err);
        } finally {
            running = false;
        }
    };

    // start periodic timer
    const timer = setInterval(() => {
        void tick();
    }, Math.max(1000, intervalSeconds * 1000));

    // run immediately once
    void tick();

    return () => clearInterval(timer);
}

export default { startConciliacaoWorker };
