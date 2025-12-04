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

        const stageMap: Record<string, { code: string; label: string }> = {
            NullsBaseA: { code: 'normalizando_base_a', label: 'Normalizando campos da Base Contábil' },
            EstornoBaseA: { code: 'aplicando_estorno', label: 'Aplicando regras de estorno' },
            NullsBaseB: { code: 'normalizando_base_b', label: 'Normalizando campos da Base Fiscal' },
            CancelamentoBaseB: { code: 'aplicando_cancelamento', label: 'Aplicando regras de cancelamento' },
            ConciliacaoAB: { code: 'conciliando', label: 'Conciliando bases A x B' },
        };

        const totalSteps = Math.max(pipeline.getStepNames().length, 1);

        await jobsRepo.setJobPipelineStage(jobId, 'preparando', 5, 'Preparando conciliação');

        ctx.reportStage = async ({ stepName, stepIndex, totalSteps: totalFromCtx }: any) => {
            const meta = stageMap[stepName] || { code: stepName, label: `Executando ${stepName}` };
            const divisor = Math.max(totalFromCtx || totalSteps, 1);
            const progressBase = Math.round((stepIndex / divisor) * 100);
            const progress = Math.min(99, Math.max(progressBase, 10));
            await jobsRepo.setJobPipelineStage(jobId, meta.code, progress, meta.label);
        };

        try {
            await pipeline.run(ctx as any);
            await jobsRepo.setJobPipelineStage(jobId, 'finalizando', 100, 'Conciliação finalizada');
            await jobsRepo.updateJobStatus(jobId, 'DONE');
            console.log('job completed', jobId);
            process.exit(0);
        } catch (err: any) {
            const msg = err && err.message ? err.message : String(err);
            console.error('pipeline failed for job', jobId, msg);
            await jobsRepo.setJobPipelineStage(jobId, 'failed', null, 'Conciliação interrompida');
            await jobsRepo.updateJobStatus(jobId, 'FAILED', msg);
            process.exit(1);
        }
    } catch (err: any) {
        console.error('jobRunner error', err);
        try { await jobsRepo.updateJobStatus(jobId, 'FAILED', String(err?.message || err)); } catch (_) { }
        try { await jobsRepo.setJobPipelineStage(jobId, 'failed', null, 'Conciliação interrompida'); } catch (_) { }
        process.exit(1);
    }
}

main();
