import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Eye, Trash } from "lucide-react";
import { toast } from "sonner";
import PageSkeletonWrapper from "@/components/PageSkeletonWrapper";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusChip } from "@/components/StatusChip";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getJobStatusMeta, getPipelineStageInfo, shouldPollJob } from "@/lib/conciliacaoStatus";
import {
    deleteConciliacao,
    exportConciliacao,
    fetchConciliacoes,
    getDownloadUrl,
} from "@/services/conciliacaoService";

const EXPORT_STATUS_MESSAGES: Record<string, string> = {
    STARTING: "Preparando exportação",
    EXPORT_BUILDING_A: "Exportando resultados da Base A",
    EXPORT_BUILT_A: "Base A concluída",
    EXPORT_BUILDING_B: "Exportando resultados da Base B",
    EXPORT_BUILT_B: "Base B concluída",
    EXPORT_BUILDING_COMBINED: "Gerando planilha comparativa",
    EXPORT_BUILT_COMBINED: "Comparativo concluído",
    EXPORT_ZIPPED: "Compactando arquivos",
    EXPORT_DONE: "Exportação finalizada",
    FAILED: "Exportação falhou",
};

const getExportStatusLabel = (code?: string | null) => {
    if (!code) return "Exportação em preparação";
    const normalized = code.toUpperCase();
    return EXPORT_STATUS_MESSAGES[normalized] ?? code;
};

const isJobExporting = (job: JobConciliacao) => {
    if (!job) return false;
    if (job.arquivo_exportado) return false;
    if (!job.export_status) return false;
    const status = job.export_status.toUpperCase();
    return status !== 'DONE' && status !== 'FAILED';
};

const Conciliacoes = () => {
    const navigate = useNavigate();
    const [jobs, setJobs] = useState<JobConciliacao[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
    const statusSnapshotRef = useRef<Record<number, { status?: JobStatus | null; stage?: string | null }>>({});
    const snapshotBootstrappedRef = useRef(false);

    const applyStatusFeedback = useCallback((list: JobConciliacao[], notify: boolean) => {
        const snapshot = { ...statusSnapshotRef.current };
        list.forEach((job) => {
            const prev = snapshot[job.id];
            const jobLabel = job.nome || `Job #${job.id}`;
            if (notify && prev?.status !== job.status) {
                if (job.status === 'RUNNING') toast.info(`${jobLabel} em processamento`);
                if (job.status === 'DONE') toast.success(`${jobLabel} finalizado`);
                if (job.status === 'FAILED') toast.error(`${jobLabel} falhou`, { description: job.erro || undefined });
            }
            if (notify && prev?.stage !== job.pipeline_stage && job.pipeline_stage_label && shouldPollJob(job)) {
                toast.message(job.pipeline_stage_label, { description: jobLabel });
            }
            snapshot[job.id] = { status: job.status, stage: job.pipeline_stage };
        });
        statusSnapshotRef.current = snapshot;
    }, []);

    const loadJobs = useCallback(async (options?: { silent?: boolean; notify?: boolean }) => {
        const { silent = false, notify } = options || {};
        if (!silent) setLoading(true);
        try {
            const res = await fetchConciliacoes();
            const data = res.data?.data ?? res.data ?? [];
            setJobs(data);
            const shouldNotify = notify ?? snapshotBootstrappedRef.current;
            applyStatusFeedback(data, shouldNotify);
            if (!snapshotBootstrappedRef.current) snapshotBootstrappedRef.current = true;
        } catch (err) {
            console.error('Failed to fetch conciliacoes', err);
            toast.error('Falha ao carregar conciliações');
        } finally {
            if (!silent) setLoading(false);
        }
    }, [applyStatusFeedback]);

    useEffect(() => {
        loadJobs({ notify: false });
    }, [loadJobs]);

    const shouldPollProcessing = useMemo(() => jobs.some((job) => shouldPollJob(job)), [jobs]);
    const shouldPollExports = useMemo(() => jobs.some((job) => isJobExporting(job)), [jobs]);
    const shouldPollAnything = shouldPollProcessing || shouldPollExports;

    useEffect(() => {
        if (!shouldPollAnything) return undefined;
        const interval = window.setInterval(() => {
            loadJobs({ silent: true, notify: true });
        }, 5000);
        return () => window.clearInterval(interval);
    }, [shouldPollAnything, loadJobs]);

    const handleDeleteConfirm = useCallback(async () => {
        if (!pendingDeleteId) return;
        try {
            await deleteConciliacao(pendingDeleteId);
            toast.success("Conciliação deletada");
            await loadJobs({ silent: true, notify: false });
        } catch (error) {
            console.error("Failed to delete conciliacao", error);
            toast.error("Falha ao deletar conciliação");
        } finally {
            setDeleteDialogOpen(false);
            setPendingDeleteId(null);
        }
    }, [pendingDeleteId, loadJobs]);

    const handleExportClick = useCallback(
        async (jobId: number) => {
            try {
                await exportConciliacao(jobId);
                toast.success("Exportação iniciada");
                await loadJobs({ silent: true, notify: true });
            } catch (error) {
                console.error("Falha ao iniciar exportação", error);
                const message = (error as any)?.response?.data?.error || "Falha ao iniciar exportação";
                toast.error(message);
            }
        },
        [loadJobs],
    );

    return (
        <PageSkeletonWrapper loading={loading}>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold">Conciliações</h1>
                        <p className="text-muted-foreground">Gerencie os jobs de conciliação</p>
                    </div>
                    <Button onClick={() => navigate("/conciliacoes/new")}>
                        <Plus className="mr-2 h-4 w-4" />
                        Nova Conciliação
                    </Button>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Jobs de Conciliação</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <div>Carregando...</div>
                        ) : (
                            <div className="space-y-3">
                                {jobs.length === 0 ? (
                                    <div className="p-4 text-sm text-muted-foreground">Nenhuma conciliação encontrada.</div>
                                ) : (
                                    jobs.map((job) => {
                                        const statusMeta = getJobStatusMeta(job);
                                        const pipelineInfo = getPipelineStageInfo(job);
                                        const isProcessing = shouldPollJob(job);
                                        const progressWidth = pipelineInfo.progress ?? (isProcessing ? 15 : 0);

                                        return (
                                            <div
                                                key={job.id}
                                                className="flex flex-col gap-4 rounded-lg border p-4 transition-colors hover:bg-muted/50 md:flex-row md:items-center md:justify-between"
                                            >
                                                <div className="flex-1 space-y-1">
                                                    <p className="font-medium">{job.nome ?? `Job ${job.id}`}</p>
                                                    <div className="text-sm text-muted-foreground flex flex-wrap gap-x-2 gap-y-1">
                                                        <span>Config: {job.nome ?? String(job.config_conciliacao_id ?? '-')}</span>
                                                        <span>•</span>
                                                        <span>Estorno: {job.config_estorno_nome ?? (job.config_estorno_id ? `#${job.config_estorno_id}` : 'Nenhum')}</span>
                                                        <span>•</span>
                                                        <span>Cancelamento: {job.config_cancelamento_nome ?? (job.config_cancelamento_id ? `#${job.config_cancelamento_id}` : 'Nenhum')}</span>
                                                        <span>•</span>
                                                        <span>Mapeamento: {job.config_mapeamento_nome ?? (job.config_mapeamento_id ? `#${job.config_mapeamento_id}` : 'Nenhum')}</span>
                                                    </div>
                                                </div>
                                                <div className="flex flex-col gap-4 md:flex-row md:items-center md:gap-6">
                                                    <div className="text-right space-y-2 min-w-[140px]">
                                                        <div>
                                                            <p className="text-xs text-muted-foreground">Criado</p>
                                                            <p className="text-sm font-mono">{job.created_at ? new Date(job.created_at).toLocaleDateString('pt-BR') : '-'}</p>
                                                        </div>
                                                        <div>
                                                            <p className="text-xs text-muted-foreground">Atualizado</p>
                                                            <p className="text-sm font-mono">{job.updated_at ? new Date(job.updated_at).toLocaleDateString('pt-BR') : '-'}</p>
                                                        </div>
                                                    </div>
                                                    <div className="min-w-[220px] space-y-2">
                                                        <StatusChip status={statusMeta.chip} label={statusMeta.label} />
                                                        {job.erro && (
                                                            <p className="text-xs text-red-600 text-right break-words">Erro: {String(job.erro)}</p>
                                                        )}
                                                        {(pipelineInfo.message && (isProcessing || job.pipeline_stage_label)) && (
                                                            <div>
                                                                <p className="text-xs text-muted-foreground text-right">{pipelineInfo.message}</p>
                                                                <div className="h-2 rounded-full bg-slate-200 overflow-hidden mt-1">
                                                                    <div
                                                                        className="h-full bg-primary transition-all"
                                                                        style={{ width: `${Math.max(8, Math.min(100, progressWidth))}%` }}
                                                                    />
                                                                </div>
                                                                {typeof pipelineInfo.progress === 'number' && (
                                                                    <p className="text-[10px] text-muted-foreground text-right mt-1">{pipelineInfo.progress}%</p>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="flex flex-wrap items-center justify-end gap-2 min-w-[220px]">
                                                        {job.arquivo_exportado ? (
                                                            <Button variant="link" className="px-0" onClick={() => window.open(getDownloadUrl(job.id), '_blank')}>
                                                                Baixar ZIP
                                                            </Button>
                                                        ) : job.export_status && job.export_status !== 'DONE' ? (
                                                            <div className="text-sm text-muted-foreground text-right">
                                                                {getExportStatusLabel(job.export_status)}
                                                                {job.export_progress != null ? ` — ${Math.round(job.export_progress)}%` : ''}
                                                            </div>
                                                        ) : job.status === 'DONE' ? (
                                                            <Button size="sm" variant="outline" onClick={() => handleExportClick(job.id)}>
                                                                Exportar
                                                            </Button>
                                                        ) : null}
                                                        <Button variant="ghost" size="icon" onClick={() => navigate(`/conciliacoes/${job.id}`)} aria-label="Ver conciliação">
                                                            <Eye className="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            variant="destructive"
                                                            size="icon"
                                                            onClick={() => {
                                                                setPendingDeleteId(job.id);
                                                                setDeleteDialogOpen(true);
                                                            }}
                                                            aria-label="Deletar conciliação"
                                                        >
                                                            <Trash className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>
                <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Confirmação de Exclusão</AlertDialogTitle>
                            <AlertDialogDescription>
                                Deseja realmente deletar esta conciliação e seus resultados? Esta ação não pode ser desfeita.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel
                                onClick={() => {
                                    setDeleteDialogOpen(false);
                                    setPendingDeleteId(null);
                                }}
                            >
                                Cancelar
                            </AlertDialogCancel>
                            <AlertDialogAction onClick={handleDeleteConfirm}>Excluir</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </PageSkeletonWrapper>
    );
};

export default Conciliacoes;