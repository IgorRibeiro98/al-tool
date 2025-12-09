import db from '../db/knex';
import * as ingestRepo from '../repos/ingestJobsRepository';
import ExcelIngestService from '../services/ExcelIngestService';

const LOG_PREFIX = '[ingestRunner]';
const EXIT_INVALID_ARGS = 2;
const EXIT_JOB_NOT_FOUND = 3;

function parseJobIdFromArgs(argv: string[]): number | null {
    const args = argv.slice(2);
    if (args.length < 1) return null;
    const n = Number(args[0]);
    return Number.isNaN(n) ? null : n;
}

async function fetchJobOrExit(jobId: number): Promise<ingestRepo.IngestJobRow | null> {
    try {
        const job = await ingestRepo.getJobById(jobId);
        return job;
    } catch (err) {
        // repository logs errors; rethrow to let caller decide
        throw err;
    }
}

async function runJob(jobId: number): Promise<number> {
    const job = await fetchJobOrExit(jobId);
    if (!job) {
        console.error(`${LOG_PREFIX} job not found: ${jobId}`);
        return EXIT_JOB_NOT_FOUND;
    }

    const baseId = job.base_id as number;
    try {
        await ingestRepo.updateJobStatus(jobId, 'RUNNING');
        const result = await ExcelIngestService.ingest(baseId);
        await ingestRepo.updateJobStatus(jobId, 'DONE');
        console.log(`${LOG_PREFIX} Ingest done for job ${jobId}`, result);
        return 0;
    } catch (err: any) {
        console.error(`${LOG_PREFIX} Ingest failed for base ${baseId}:`, err);
        try { await ingestRepo.updateJobStatus(jobId, 'FAILED', String(err?.message || err)); } catch (e) { console.warn(`${LOG_PREFIX} Failed to mark job failed:`, e); }
        return 1;
    }
}

async function main() {
    const jobId = parseJobIdFromArgs(process.argv);
    if (jobId == null) {
        console.error(`${LOG_PREFIX} requires a numeric jobId argument`);
        process.exit(EXIT_INVALID_ARGS);
    }

    try {
        const code = await runJob(jobId);
        process.exit(code);
    } catch (err) {
        console.error(`${LOG_PREFIX} unexpected error:`, err);
        process.exit(1);
    }
}

void main();
