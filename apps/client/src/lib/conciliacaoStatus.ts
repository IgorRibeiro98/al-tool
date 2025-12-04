import type { StatusType } from '@/components/StatusChip';

interface JobStatusMeta {
    chip: StatusType;
    label: string;
    description?: string | null;
}

const JOB_STATUS_LABELS: Record<JobStatus, JobStatusMeta> = {
    PENDING: { chip: 'pending', label: 'Na fila', description: 'Aguardando processamento' },
    RUNNING: { chip: 'running', label: 'Processando', description: 'Conciliação em andamento' },
    DONE: { chip: 'success', label: 'Concluído', description: 'Conciliação finalizada' },
    FAILED: { chip: 'error', label: 'Falhou', description: 'Verifique o erro reportado' },
};

const STAGE_FALLBACKS: Record<string, string> = {
    queued: 'Na fila para conciliação',
    preparando: 'Preparando conciliação',
    starting_worker: 'Iniciando conciliação',
    normalizando_base_a: 'Normalizando campos da Base Contábil',
    aplicando_estorno: 'Aplicando regras de estorno',
    normalizando_base_b: 'Normalizando campos da Base Fiscal',
    aplicando_cancelamento: 'Aplicando regras de cancelamento',
    conciliando: 'Conciliando bases A x B',
    finalizando: 'Conciliação finalizada',
    failed: 'Conciliação interrompida'
};

export function getJobStatusMeta(job?: JobConciliacao | null): JobStatusMeta {
    const fallback: JobStatusMeta = { chip: 'pending', label: 'Desconhecido', description: null };
    if (!job) return fallback;
    return JOB_STATUS_LABELS[job.status] || fallback;
}

export function getPipelineStageInfo(job?: JobConciliacao | null): { message: string; progress: number | null } {
    if (!job) return { message: 'Aguardando conciliação', progress: null };
    const code = job.pipeline_stage || '';
    const message = job.pipeline_stage_label || STAGE_FALLBACKS[code] || (job.status === 'RUNNING' ? 'Processando conciliação' : 'Aguardando conciliação');
    const progress = typeof job.pipeline_progress === 'number' ? Math.max(0, Math.min(100, job.pipeline_progress)) : null;
    return { message, progress };
}

export function shouldPollJob(job?: JobConciliacao | null): boolean {
    if (!job) return false;
    return job.status === 'PENDING' || job.status === 'RUNNING';
}
