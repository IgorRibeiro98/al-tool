import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusType = "success" | "error" | "warning" | "info" | "pending" | "running" | "done" | "failed";

interface StatusChipProps {
    status: string | StatusType;
    label?: string;
}

const statusConfig = {
    success: { color: "bg-success text-success-foreground", label: "Sucesso" },
    error: { color: "bg-destructive text-destructive-foreground", label: "Erro" },
    warning: { color: "bg-warning text-warning-foreground", label: "Atenção" },
    info: { color: "bg-info text-info-foreground", label: "Info" },
    pending: { color: "bg-muted text-muted-foreground", label: "Pendente" },
    running: { color: "bg-info text-info-foreground", label: "Executando" },
    done: { color: "bg-success text-success-foreground", label: "Concluído" },
    failed: { color: "bg-destructive text-destructive-foreground", label: "Falhou" },
};

export function StatusChip({ status, label }: StatusChipProps) {
    // normalize status to lowercase string so we tolerate API values like 'DONE' or 'FAILED'
    const key = String(status || '').toLowerCase() as keyof typeof statusConfig;
    const defaultConfig = { color: 'bg-muted text-muted-foreground', label: 'Desconhecido' };
    const config = (statusConfig as any)[key] ?? defaultConfig;

    return (
        <Badge className={cn('font-medium', config.color)}>
            {label || config.label}
        </Badge>
    );
}
