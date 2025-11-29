import db from '../db/knex';
import * as ingestRepo from '../repos/ingestJobsRepository';
import ExcelIngestService from '../services/ExcelIngestService';

async function run() {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.error('ingestRunner requires a numeric jobId argument');
        process.exit(2);
    }
    const jobId = Number(args[0]);
    if (Number.isNaN(jobId)) {
        console.error('ingestRunner requires a numeric jobId argument');
        process.exit(2);
    }

    const job: any = await ingestRepo.getJobById(jobId);
    if (!job) {
        console.error('ingestRunner: job not found', jobId);
        process.exit(3);
    }

    const baseId = job.base_id as number;
    try {
        await ingestRepo.updateJobStatus(jobId, 'RUNNING');
        const result = await ExcelIngestService.ingest(baseId);
        // optionally record results in job row (not required)
        await ingestRepo.updateJobStatus(jobId, 'DONE');
        console.log('Ingest done', result);
        process.exit(0);
    } catch (err: any) {
        console.error('Ingest failed for base', baseId, err);
        await ingestRepo.updateJobStatus(jobId, 'FAILED', String(err?.message || err));
        process.exit(1);
    }
}

void run();
