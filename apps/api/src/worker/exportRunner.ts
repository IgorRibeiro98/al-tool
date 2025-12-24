import * as exportService from '../services/ConciliacaoExportService';
import * as jobsRepo from '../repos/jobsRepository';
import db from '../db/knex';

const LOG_PREFIX = '[exportRunner]';

function parseJobId(arg?: string): number | null {
    const id = Number(arg);
    if (!id || Number.isNaN(id)) return null;
    return id;
}

async function main() {
    const argv = process.argv || [];
    const jobId = parseJobId(argv[2]);
    if (!jobId) {
        console.error(`${LOG_PREFIX} requires a numeric jobId argument`);
        process.exit(2);
    }

    try {
        const job: any = await db('jobs_conciliacao').where({ id: jobId }).first();
        if (!job) {
            console.error(`${LOG_PREFIX} job not found`, jobId);
            await jobsRepo.setJobExportProgress(jobId, null, 'FAILED');
            process.exit(3);
        }

        try {
            await jobsRepo.setJobExportProgress(jobId, 1, 'STARTING');
        } catch (_) { /* ignore */ }

        try {
            const info = await exportService.exportJobResultToZip(jobId);
            console.log(`${LOG_PREFIX} export finished for job ${jobId}:`, info && info.path);
            try { await jobsRepo.setJobExportProgress(jobId, 100, 'DONE'); } catch (_) { }
            process.exit(0);
        } catch (err: any) {
            console.error(`${LOG_PREFIX} export failed for job ${jobId}`, err);
            try { await jobsRepo.setJobExportProgress(jobId, null, 'FAILED'); } catch (_) { }
            process.exit(1);
        }
    } catch (err: any) {
        console.error(`${LOG_PREFIX} fatal error`, err);
        process.exit(1);
    }
}

void main();
