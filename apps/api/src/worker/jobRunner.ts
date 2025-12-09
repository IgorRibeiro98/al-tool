import db from '../db/knex';
import pipeline from '../pipeline/integration';
import * as jobsRepo from '../repos/jobsRepository';
import idxHelpers from '../db/indexHelpers';

const LOG_PREFIX = '[jobRunner]';

function parseJobId(arg?: string): number | null {
    const id = Number(arg);
    if (!id || Number.isNaN(id)) return null;
    return id;
}

function createDbCache<T>(table: string) {
    const cache = new Map<number, T | null>();
    return async (id?: number): Promise<T | undefined> => {
        if (!id) return undefined;
        if (cache.has(id)) return cache.get(id) || undefined;
        const row = (await db(table).where({ id }).first()) as T | undefined;
        cache.set(id, row || null);
        return row || undefined;
    };
}

function createStageReporter(jobId: number, totalSteps: number) {
    const stageMap: Record<string, { code: string; label: string }> = {
        NullsBaseA: { code: 'normalizando_base_a', label: 'Normalizando campos da Base Contábil' },
        EstornoBaseA: { code: 'aplicando_estorno', label: 'Aplicando regras de estorno' },
        NullsBaseB: { code: 'normalizando_base_b', label: 'Normalizando campos da Base Fiscal' },
        CancelamentoBaseB: { code: 'aplicando_cancelamento', label: 'Aplicando regras de cancelamento' },
        ConciliacaoAB: { code: 'conciliando', label: 'Conciliando bases A x B' },
    };

    return async ({ stepName, stepIndex, totalSteps: totalFromCtx }: any) => {
        const meta = stageMap[stepName] || { code: stepName, label: `Executando ${stepName}` };
        const divisor = Math.max(totalFromCtx || totalSteps, 1);
        const progressBase = Math.round((stepIndex / divisor) * 100);
        const progress = Math.min(99, Math.max(progressBase, 10));
        await jobsRepo.setJobPipelineStage(jobId, meta.code, progress, meta.label);
    };
}

async function handleFatal(jobId: number | null, err: unknown) {
    console.error(`${LOG_PREFIX} fatal error`, err);
    if (!jobId) process.exit(1);
    try { await jobsRepo.updateJobStatus(jobId, 'FAILED', String((err as any)?.message || err)); } catch (_) { /* ignore */ }
    try { await jobsRepo.setJobPipelineStage(jobId, 'failed', null, 'Conciliação interrompida'); } catch (_) { /* ignore */ }
    process.exit(1);
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
            await jobsRepo.updateJobStatus(jobId, 'FAILED', 'Job não encontrado');
            process.exit(3);
        }

        const getBaseMeta = createDbCache<any>('bases');
        const getConfigConciliacao = createDbCache<any>('configs_conciliacao');
        const getConfigEstorno = createDbCache<any>('configs_estorno');
        const getConfigCancelamento = createDbCache<any>('configs_cancelamento');

        const cfg = await getConfigConciliacao(job.config_conciliacao_id);
        if (!cfg) {
            console.error(`${LOG_PREFIX} config conciliacao not found for job`, jobId);
            await jobsRepo.updateJobStatus(jobId, 'FAILED', 'Config conciliacao not found');
            process.exit(4);
        }

        const baseContabilId = job.base_contabil_id_override || cfg.base_contabil_id;
        const baseFiscalId = job.base_fiscal_id_override || cfg.base_fiscal_id;
        if (!baseContabilId || !baseFiscalId) {
            console.error(`${LOG_PREFIX} job lacks base references`, jobId);
            await jobsRepo.updateJobStatus(jobId, 'FAILED', 'Bases não definidas para o job');
            process.exit(5);
        }

        await idxHelpers.ensureIndicesForBaseFromConfigs(baseContabilId);
        if (baseFiscalId !== baseContabilId) await idxHelpers.ensureIndicesForBaseFromConfigs(baseFiscalId);

        const totalSteps = Math.max(pipeline.getStepNames().length, 1);

        await jobsRepo.setJobPipelineStage(jobId, 'preparando', 5, 'Preparando conciliação');

        const ctx: any = {
            jobId,
            baseContabilId,
            baseFiscalId,
            configConciliacaoId: cfg.id,
            configEstornoId: job.config_estorno_id ?? undefined,
            configCancelamentoId: job.config_cancelamento_id ?? undefined,
            getBaseMeta,
            getConfigConciliacao,
            getConfigEstorno,
            getConfigCancelamento,
            reportStage: createStageReporter(jobId, totalSteps),
        };

        try {
            await pipeline.run(ctx as any);
            await jobsRepo.setJobPipelineStage(jobId, 'finalizando', 100, 'Conciliação finalizada');
            await jobsRepo.updateJobStatus(jobId, 'DONE');
            console.log(`${LOG_PREFIX} job completed`, jobId);
            process.exit(0);
        } catch (err: any) {
            const msg = err && err.message ? err.message : String(err);
            console.error(`${LOG_PREFIX} pipeline failed for job`, jobId, msg);
            await jobsRepo.setJobPipelineStage(jobId, 'failed', null, 'Conciliação interrompida');
            await jobsRepo.updateJobStatus(jobId, 'FAILED', msg);
            process.exit(1);
        }
    } catch (err: any) {
        await handleFatal(jobId, err);
    }
}

void main();
