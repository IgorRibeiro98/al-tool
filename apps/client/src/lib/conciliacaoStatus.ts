import type { StatusType } from '@/components/StatusChip';

export interface JobStatusMeta {
    chip: StatusType;
    label: string;
    description?: string | null;
}

const DEFAULT_WAITING_MESSAGE = 'Aguardando conciliação';
const DEFAULT_PROCESSING_MESSAGE = 'Processando conciliação';

const JOB_STATUS_META: Readonly<Record<JobStatus, JobStatusMeta>> = {
    PENDING: { chip: 'pending', label: 'Na fila', description: 'Aguardando processamento' },
    RUNNING: { chip: 'running', label: 'Processando', description: 'Conciliação em andamento' },
    DONE: { chip: 'success', label: 'Concluído', description: 'Conciliação finalizada' },
    FAILED: { chip: 'error', label: 'Falhou', description: 'Verifique o erro reportado' },
};

const JOB_META_FALLBACK: JobStatusMeta = { chip: 'pending', label: 'Desconhecido', description: null };

const STAGE_LABELS: Readonly<Record<string, string>> = {
    queued: 'Na fila para conciliação',
    preparando: 'Preparando conciliação',
    starting_worker: 'Iniciando conciliação',
    normalizando_base_a: 'Normalizando campos da Base Contábil',
    aplicando_estorno: 'Aplicando regras de estorno',
    normalizando_base_b: 'Normalizando campos da Base Fiscal',
    aplicando_cancelamento: 'Aplicando regras de cancelamento',
    conciliando: 'Conciliando bases A x B',
    finalizando: 'Conciliação finalizada',
    failed: 'Conciliação interrompida',
};

const POLL_STATUSES = new Set<JobStatus>(['PENDING', 'RUNNING']);

function toTrimmedString(value?: string | null): string | undefined {
    if (value == null) return undefined;
    const s = String(value).trim();
    return s === '' ? undefined : s;
}

function clampProgress(value: unknown): number | null {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, Math.trunc(n)));
}

export function getJobStatusMeta(job?: JobConciliacao | null): JobStatusMeta {
    if (!job) return JOB_META_FALLBACK;
    return JOB_STATUS_META[job.status] ?? JOB_META_FALLBACK;
}

function getStageCode(job?: JobConciliacao | null): string | undefined {
    if (!job) return undefined;
    return toTrimmedString(job.pipeline_stage);
}

function getStageLabelFromJob(job?: JobConciliacao | null): string | undefined {
    if (!job) return undefined;
    return toTrimmedString(job.pipeline_stage_label);
}

function deriveStageMessage(job?: JobConciliacao | null): string {
    const explicitLabel = getStageLabelFromJob(job);
    if (explicitLabel) return explicitLabel;

    const code = getStageCode(job);
    if (code && STAGE_LABELS[code]) return STAGE_LABELS[code];

    if (job?.status === 'RUNNING') return DEFAULT_PROCESSING_MESSAGE;
    return DEFAULT_WAITING_MESSAGE;
}

function extractPipelineProgress(job?: JobConciliacao | null): number | null {
    if (!job) return null;
    // pipeline_progress may be number|string|null — normalize safely
    return clampProgress((job as any).pipeline_progress);
}

export function getPipelineStageInfo(job?: JobConciliacao | null): { message: string; progress: number | null } {
    if (!job) return { message: DEFAULT_WAITING_MESSAGE, progress: null };
    return { message: deriveStageMessage(job), progress: extractPipelineProgress(job) };
}

export function shouldPollJob(job?: JobConciliacao | null): boolean {
    if (!job) return false;
    return POLL_STATUSES.has(job.status);
}
