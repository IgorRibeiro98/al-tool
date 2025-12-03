import db from '../db/knex';
import pipeline from '../pipeline/integration';
import * as jobsRepo from '../repos/jobsRepository';

async function main() {
    const argv = process.argv || [];
    const jobIdArg = argv[2];
    const jobId = Number(jobIdArg);
    if (!jobId || Number.isNaN(jobId)) {
        console.error('jobRunner requires a numeric jobId argument');
        process.exit(2);
    }

    try {
        const job: any = await db('jobs_conciliacao').where({ id: jobId }).first();
        if (!job) {
            console.error('job not found', jobId);
            process.exit(3);
        }

        // fetch config
        const cfg = await db('configs_conciliacao').where({ id: job.config_conciliacao_id }).first();
        if (!cfg) {
            console.error('config conciliacao not found for job', jobId);
            await jobsRepo.updateJobStatus(jobId, 'FAILED', 'Config conciliacao not found');
            process.exit(4);
        }

        const baseContabilId = job.base_contabil_id_override || cfg.base_contabil_id;
        const baseFiscalId = job.base_fiscal_id_override || cfg.base_fiscal_id;
        if (!baseContabilId || !baseFiscalId) {
            console.error('job lacks base references', jobId);
            await jobsRepo.updateJobStatus(jobId, 'FAILED', 'Bases não definidas para o job');
            process.exit(5);
        }

        const ctx: any = {
            jobId,
            baseContabilId,
            baseFiscalId,
            configConciliacaoId: cfg.id,
            configEstornoId: job.config_estorno_id ?? undefined,
            configCancelamentoId: job.config_cancelamento_id ?? undefined,
        };

        try {
            await pipeline.run(ctx as any);
            await jobsRepo.updateJobStatus(jobId, 'DONE');
            console.log('job completed', jobId);
            process.exit(0);
        } catch (err: any) {
            const msg = err && err.message ? err.message : String(err);
            console.error('pipeline failed for job', jobId, msg);
            await jobsRepo.updateJobStatus(jobId, 'FAILED', msg);
            process.exit(1);
        }
    } catch (err: any) {
        console.error('jobRunner error', err);
        try { await jobsRepo.updateJobStatus(jobId, 'FAILED', String(err?.message || err)); } catch (_) { }
        process.exit(1);
    }
}

main();
