type ConversionStatus = Base['conversion_status'];

type IngestStatus = JobStatus | null | undefined;

type StatusTone = 'success' | 'error' | 'warning' | 'info' | 'pending' | 'running' | 'done' | 'failed';

export interface BaseStatusMeta {
    chip: StatusTone;
    label: string;
    description?: string | null;
}

const conversionStatusLabels: Record<string, BaseStatusMeta> = {
    READY: { chip: 'success', label: 'Conversão concluída' },
    PENDING: { chip: 'pending', label: 'Na fila de conversão' },
    PROCESSING: { chip: 'running', label: 'Convertendo arquivo' },
    RUNNING: { chip: 'running', label: 'Convertendo arquivo' },
    FAILED: { chip: 'error', label: 'Falha na conversão' },
};

const fallbackConversionMeta: BaseStatusMeta = { chip: 'pending', label: 'Conversão não iniciada' };

export function getConversionStatusMeta(status?: ConversionStatus | null): BaseStatusMeta {
    if (!status) return fallbackConversionMeta;
    const normalized = status.toUpperCase();
    return conversionStatusLabels[normalized] ?? fallbackConversionMeta;
}

export function getIngestStatusMeta(base?: Base | null): BaseStatusMeta {
    if (!base) return { chip: 'pending', label: 'Ingestão não iniciada' };

    if (base.tabela_sqlite) {
        return { chip: 'success', label: 'Ingestão concluída' };
    }

    const status: IngestStatus = base.ingest_status;
    if (!status) {
        if (base.conversion_status && base.conversion_status !== 'READY') {
            return { chip: 'warning', label: 'Aguardando término da conversão' };
        }
        return { chip: 'pending', label: 'Ingestão não iniciada' };
    }

    switch (status) {
        case 'PENDING':
            return { chip: 'pending', label: 'Na fila de ingestão' };
        case 'RUNNING':
            return { chip: 'running', label: 'Ingestão em andamento' };
        case 'DONE':
            return { chip: 'success', label: 'Ingestão concluída' };
        case 'FAILED':
            return { chip: 'error', label: 'Falha na ingestão' };
        default:
            return { chip: 'pending', label: 'Ingestão não iniciada' };
    }
}

export function isConversionStatusActive(status?: ConversionStatus | null) {
    if (!status) return false;
    const normalized = status.toUpperCase();
    return normalized === 'PENDING' || normalized === 'RUNNING' || normalized === 'PROCESSING';
}

export function isIngestStatusActive(base?: Base | null) {
    if (!base) return false;
    const status = base.ingest_status;
    if (status === 'PENDING' || status === 'RUNNING') return true;
    return Boolean(base.ingest_in_progress);
}
