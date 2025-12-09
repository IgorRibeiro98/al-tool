import React, { FC, memo, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type StatusType =
    | 'success'
    | 'error'
    | 'warning'
    | 'info'
    | 'pending'
    | 'running'
    | 'done'
    | 'failed';

export interface StatusChipProps {
    status?: string | StatusType | null;
    label?: string;
    className?: string;
}

type StatusConfig = { color: string; label: string };

const DEFAULT_CONFIG: StatusConfig = { color: 'bg-muted text-muted-foreground', label: 'Desconhecido' };

const STATUS_MAP: Record<StatusType, StatusConfig> = {
    success: { color: 'bg-success text-success-foreground', label: 'Sucesso' },
    error: { color: 'bg-destructive text-destructive-foreground', label: 'Erro' },
    warning: { color: 'bg-warning text-warning-foreground', label: 'Atenção' },
    info: { color: 'bg-info text-info-foreground', label: 'Info' },
    pending: { color: 'bg-muted text-muted-foreground', label: 'Pendente' },
    running: { color: 'bg-info text-info-foreground', label: 'Executando' },
    done: { color: 'bg-success text-success-foreground', label: 'Concluído' },
    failed: { color: 'bg-destructive text-destructive-foreground', label: 'Falhou' },
};

function normalizeStatus(input?: string | StatusType | null): StatusType | undefined {
    if (!input) return undefined;
    const key = String(input).trim().toLowerCase();
    if (key in STATUS_MAP) return key as StatusType;
    return undefined;
}

export const StatusChip: FC<StatusChipProps> = memo(function StatusChip({ status, label, className }) {
    const normalized = normalizeStatus(status);

    const config = useMemo<StatusConfig>(() => {
        return normalized ? STATUS_MAP[normalized] : DEFAULT_CONFIG;
    }, [normalized]);

    const content = label || config.label;

    return (
        <Badge className={cn('font-medium', config.color, className)} aria-label={`Status: ${content}`}>
            {content}
        </Badge>
    );
});

export default StatusChip;
