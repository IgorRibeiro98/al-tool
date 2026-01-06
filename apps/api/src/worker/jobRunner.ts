import db from '../db/knex';
import pipeline from '../pipeline/integration';
import * as jobsRepo from '../repos/jobsRepository';
import idxHelpers from '../db/indexHelpers';

const LOG_PREFIX = '[jobRunner]';
const EXIT_MISSING_ARG = 2;
const EXIT_JOB_NOT_FOUND = 3;
const EXIT_CONFIG_NOT_FOUND = 4;
const EXIT_BASES_NOT_DEFINED = 5;

interface StageReportParams {
    stepName: string;
    stepIndex: number;
    totalSteps?: number;
}

interface StageConfig {
    readonly code: string;
    readonly label: string;
}

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
    const stageMap: Record<string, StageConfig> = {
        NullsBaseA: { code: 'normalizando_base_a', label: 'Normalizando campos da Base Contábil' },
        EstornoBaseA: { code: 'aplicando_estorno', label: 'Aplicando regras de estorno' },
        NullsBaseB: { code: 'normalizando_base_b', label: 'Normalizando campos da Base Fiscal' },
        CancelamentoBaseB: { code: 'aplicando_cancelamento', label: 'Aplicando regras de cancelamento' },
        ConciliacaoAB: { code: 'conciliando', label: 'Conciliando bases A x B' },
    };

    return async ({ stepName, stepIndex, totalSteps: totalFromCtx }: StageReportParams): Promise<void> => {
        const meta = stageMap[stepName] || { code: stepName, label: `Executando ${stepName}` };
        const divisor = Math.max(totalFromCtx || totalSteps, 1);
        const progressBase = Math.round((stepIndex / divisor) * 100);
        const progress = Math.min(99, Math.max(progressBase, 10));
        await jobsRepo.setJobPipelineStage(jobId, meta.code, progress, meta.label);
    };
}

async function handleFatal(jobId: number | null, err: unknown): Promise<never> {
    console.error(`${LOG_PREFIX} fatal error`, err);
    if (!jobId) process.exit(1);
    const message = err instanceof Error ? err.message : String(err);
    try { await jobsRepo.updateJobStatus(jobId, 'FAILED', message); } catch { /* ignore */ }
    try { await jobsRepo.setJobPipelineStage(jobId, 'failed', null, 'Conciliação interrompida'); } catch { /* ignore */ }
    process.exit(1);
}

async function main(): Promise<void> {
    const argv = process.argv || [];
    const jobId = parseJobId(argv[2]);
    if (!jobId) {
        console.error(`${LOG_PREFIX} requires a numeric jobId argument`);
        process.exit(EXIT_MISSING_ARG);
    }

    try {
        const job = await db('jobs_conciliacao').where({ id: jobId }).first();
        if (!job) {
            console.error(`${LOG_PREFIX} job not found`, jobId);
            await jobsRepo.updateJobStatus(jobId, 'FAILED', 'Job não encontrado');
            process.exit(EXIT_JOB_NOT_FOUND);
        }

        const getBaseMeta = createDbCache<Record<string, unknown>>('bases');
        const getConfigConciliacao = createDbCache<Record<string, unknown>>('configs_conciliacao');
        const getConfigEstorno = createDbCache<Record<string, unknown>>('configs_estorno');
        const getConfigCancelamento = createDbCache<Record<string, unknown>>('configs_cancelamento');

        const cfg = await getConfigConciliacao((job as Record<string, unknown>).config_conciliacao_id as number | undefined);
        if (!cfg) {
            console.error(`${LOG_PREFIX} config conciliacao not found for job`, jobId);
            await jobsRepo.updateJobStatus(jobId, 'FAILED', 'Config conciliacao not found');
            process.exit(EXIT_CONFIG_NOT_FOUND);
        }

        const jobRecord = job as Record<string, unknown>;
        const cfgRecord = cfg as Record<string, unknown>;
        const baseContabilId = (jobRecord.base_contabil_id_override || cfgRecord.base_contabil_id) as number | undefined;
        const baseFiscalId = (jobRecord.base_fiscal_id_override || cfgRecord.base_fiscal_id) as number | undefined;
        if (!baseContabilId || !baseFiscalId) {
            console.error(`${LOG_PREFIX} job lacks base references`, jobId);
            await jobsRepo.updateJobStatus(jobId, 'FAILED', 'Bases não definidas para o job');
            process.exit(EXIT_BASES_NOT_DEFINED);
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
