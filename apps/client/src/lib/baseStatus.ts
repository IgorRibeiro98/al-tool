type ConversionStatus = Base['conversion_status'];

type IngestStatus = JobStatus | null | undefined;

export type StatusTone = 'success' | 'error' | 'warning' | 'info' | 'pending' | 'running' | 'done' | 'failed';

export interface BaseStatusMeta {
    chip: StatusTone;
    label: string;
    description?: string | null;
}

const CONVERSION_META: Record<string, BaseStatusMeta> = {
    READY: { chip: 'success', label: 'Conversão concluída' },
    PENDING: { chip: 'pending', label: 'Na fila de conversão' },
    PROCESSING: { chip: 'running', label: 'Convertendo arquivo' },
    RUNNING: { chip: 'running', label: 'Convertendo arquivo' },
    FAILED: { chip: 'error', label: 'Falha na conversão' },
};

const INGEST_META: Record<string, BaseStatusMeta> = {
    PENDING: { chip: 'pending', label: 'Na fila de ingestão' },
    RUNNING: { chip: 'running', label: 'Ingestão em andamento' },
    DONE: { chip: 'success', label: 'Ingestão concluída' },
    FAILED: { chip: 'error', label: 'Falha na ingestão' },
};

const FALLBACK_CONVERSION: BaseStatusMeta = { chip: 'pending', label: 'Conversão não iniciada' };
const FALLBACK_INGEST: BaseStatusMeta = { chip: 'pending', label: 'Ingestão não iniciada' };

function normalizeStatus(input?: string | null): string | undefined {
    if (!input) return undefined;
    return String(input).trim().toUpperCase();
}

export function getConversionStatusMeta(status?: ConversionStatus | null): BaseStatusMeta {
    const key = normalizeStatus(status);
    if (!key) return FALLBACK_CONVERSION;
    return CONVERSION_META[key] ?? FALLBACK_CONVERSION;
}

export function getIngestStatusMeta(base?: Base | null): BaseStatusMeta {
    if (!base) return FALLBACK_INGEST;

    // If the SQLite table is present we consider ingestion completed
    if (base.tabela_sqlite) return { chip: 'success', label: 'Ingestão concluída' };

    const key = normalizeStatus(base.ingest_status as any);
    if (!key) {
        const convKey = normalizeStatus(base.conversion_status as any);
        if (convKey && convKey !== 'READY') return { chip: 'warning', label: 'Aguardando término da conversão' };
        return FALLBACK_INGEST;
    }

    return INGEST_META[key] ?? FALLBACK_INGEST;
}

const ACTIVE_CONVERSION = new Set(['PENDING', 'RUNNING', 'PROCESSING']);
export function isConversionStatusActive(status?: ConversionStatus | null): boolean {
    const key = normalizeStatus(status);
    return !!key && ACTIVE_CONVERSION.has(key);
}

const ACTIVE_INGEST = new Set(['PENDING', 'RUNNING']);
export function isIngestStatusActive(base?: Base | null): boolean {
    if (!base) return false;
    const key = normalizeStatus(base.ingest_status as any);
    if (key && ACTIVE_INGEST.has(key)) return true;
    return Boolean(base.ingest_in_progress);
}
