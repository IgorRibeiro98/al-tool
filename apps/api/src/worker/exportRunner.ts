import * as exportService from '../services/ConciliacaoExportService';
import * as jobsRepo from '../repos/jobsRepository';
import db from '../db/knex';

const LOG_PREFIX = '[exportRunner]';
const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;
const EXIT_INVALID_ARGS = 2;
const EXIT_JOB_NOT_FOUND = 3;

function parseJobId(arg?: string): number | null {
    const id = parseInt(arg || '', 10);
    if (!id || Number.isNaN(id)) return null;
    return id;
}

async function main(): Promise<void> {
    const argv = process.argv || [];
    const jobId = parseJobId(argv[2]);
    if (!jobId) {
        console.error(`${LOG_PREFIX} requires a numeric jobId argument`);
        process.exit(EXIT_INVALID_ARGS);
    }

    try {
        const job = await db('jobs_conciliacao').where({ id: jobId }).first();
        if (!job) {
            console.error(`${LOG_PREFIX} job not found`, jobId);
            await jobsRepo.setJobExportProgress(jobId, null, 'FAILED');
            process.exit(EXIT_JOB_NOT_FOUND);
        }

        try {
            await jobsRepo.setJobExportProgress(jobId, 1, 'STARTING');
        } catch { /* ignore */ }

        try {
            const info = await exportService.exportJobResultToZip(jobId);
            console.log(`${LOG_PREFIX} export finished for job ${jobId}:`, info?.path);
            try { await jobsRepo.setJobExportProgress(jobId, 100, 'DONE'); } catch { /* empty */ }
            process.exit(EXIT_SUCCESS);
        } catch (err) {
            console.error(`${LOG_PREFIX} export failed for job ${jobId}`, err);
            try { await jobsRepo.setJobExportProgress(jobId, null, 'FAILED'); } catch { /* empty */ }
            process.exit(EXIT_FAILURE);
        }
    } catch (err) {
        console.error(`${LOG_PREFIX} fatal error`, err);
        process.exit(EXIT_FAILURE);
    }
}

void main();
