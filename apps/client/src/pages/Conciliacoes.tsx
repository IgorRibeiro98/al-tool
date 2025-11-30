import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusChip } from "@/components/StatusChip";
import { Plus, Eye, Trash } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from 'react';
import PageSkeletonWrapper from '@/components/PageSkeletonWrapper';
import { fetchConciliacoes, deleteConciliacao, exportConciliacao, getExportStatus, getDownloadUrl } from '@/services/conciliacaoService';
import { toast } from 'sonner';
// api import removed; use `getDownloadUrl` from `conciliacaoService` instead
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogAction,
    AlertDialogCancel,
} from '@/components/ui/alert-dialog';

const Conciliacoes = () => {
    const navigate = useNavigate();
    const [jobs, setJobs] = useState<JobConciliacao[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

    useEffect(() => {
        let mounted = true;
        setLoading(true);
        fetchConciliacoes()
            .then((res) => {
                if (!mounted) return;
                const data = res.data?.data ?? res.data ?? [];
                setJobs(data);
            })
            .catch((err) => {
                console.error('Failed to fetch conciliacoes', err);
                toast.error('Falha ao carregar conciliações');
            })
            .finally(() => { if (mounted) setLoading(false); });

        return () => { mounted = false; };
    }, []);

    // after jobs load, fetch export status for each job in background
    useEffect(() => {
        if (!jobs || jobs.length === 0) return;
        const mounted = { v: true };
        (async () => {
            await Promise.allSettled(jobs.map(async (job) => {
                try {
                    const r = await getExportStatus(job.id);
                    if (!mounted.v) return;
                    setJobs(prev => prev.map(j => j.id === job.id ? ({ ...j, export_status: r.data.export_status, export_progress: r.data.export_progress, arquivo_exportado: r.data.arquivo_exportado }) : j));
                } catch (e) {
                    // ignore per-job status errors
                }
            }));
        })();
        return () => { mounted.v = false; };
    }, [jobs.length]);

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
                            <div className="space-y-2">
                                {jobs.length === 0 ? (
                                    <div className="p-4 text-sm text-muted-foreground">Nenhuma conciliação encontrada.</div>
                                ) : (
                                    jobs.map((job) => (
                                        <div
                                            key={job.id}
                                            className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50 transition-colors"
                                        >
                                            <div className="flex-1 space-y-1">
                                                <p className="font-medium">{job.nome ?? `Job ${job.id}`}</p>
                                                <div className="text-sm text-muted-foreground">
                                                    <span>Config: {job.nome ?? String(job.config_conciliacao_id ?? '-')}</span>
                                                    <span className="mx-2">•</span>
                                                    <span>Estorno: {job.config_estorno_nome ?? String(job.config_estorno_id ?? '-')}</span>
                                                    <span className="mx-2">•</span>
                                                    <span>Cancelamento: {job.config_cancelamento_nome ?? String(job.config_cancelamento_id ?? '-')}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-6">
                                                <div className="text-right">
                                                    <p className="text-xs text-muted-foreground">Criado</p>
                                                    <p className="text-sm font-mono">{job.created_at ? new Date(job.created_at).toLocaleDateString('pt-BR') : '-'}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-xs text-muted-foreground">Atualizado</p>
                                                    <p className="text-sm font-mono">{job.updated_at ? new Date(job.updated_at).toLocaleDateString('pt-BR') : '-'}</p>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <StatusChip status={(job.status || 'PENDING') as any} />
                                                    {job.erro && (
                                                        <div className="text-xs text-red-600">Erro: {String(job.erro)}</div>
                                                    )}
                                                    {((job as any).export_status === 'DONE') || job.arquivo_exportado ? (
                                                        <a
                                                            className="text-sm text-primary underline"
                                                            href={getDownloadUrl(job.id)}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                        >
                                                            Baixar
                                                        </a>
                                                    ) : (job as any).export_status ? (
                                                        <span className="text-sm text-muted-foreground">{String((job as any).export_status)}{(job as any).export_progress ? ` — ${(job as any).export_progress}%` : ''}</span>
                                                    ) : (job.status === 'DONE') && (
                                                        <Button size="sm" variant="outline" onClick={async () => {
                                                            try {
                                                                await exportConciliacao(job.id);
                                                                toast.success('Exportação iniciada');
                                                                // refresh status for this job
                                                                const r = await getExportStatus(job.id);
                                                                setJobs(prev => prev.map(j => j.id === job.id ? ({ ...j, export_status: r.data.export_status, export_progress: r.data.export_progress }) : j));
                                                            } catch (e) {
                                                                console.error('start export failed', e);
                                                                toast.error('Falha ao iniciar exportação');
                                                            }
                                                        }}>Exportar</Button>
                                                    )}
                                                    <Button variant="ghost" size="sm" onClick={() => navigate(`/conciliacoes/${job.id}`)}>
                                                        <Eye className="h-4 w-4" />
                                                    </Button>
                                                    <Button variant="destructive" size="icon" onClick={() => { setPendingDeleteId(job.id); setDeleteDialogOpen(true); }} aria-label="Deletar conciliação">
                                                        <Trash className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>
                <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Confirmação de Exclusão</AlertDialogTitle>
                            <AlertDialogDescription>Deseja realmente deletar esta conciliação e seus resultados? Esta ação não pode ser desfeita.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel onClick={() => { setDeleteDialogOpen(false); setPendingDeleteId(null); }}>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={async () => {
                                if (!pendingDeleteId) return;
                                try {
                                    await deleteConciliacao(pendingDeleteId);
                                    toast.success('Conciliação deletada');
                                    setJobs(prev => prev.filter(j => j.id !== pendingDeleteId));
                                } catch (e) {
                                    console.error('Failed to delete conciliacao', e);
                                    toast.error('Falha ao deletar conciliação');
                                } finally {
                                    setDeleteDialogOpen(false);
                                    setPendingDeleteId(null);
                                }
                            }}>Excluir</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </PageSkeletonWrapper>
    );
};

export default Conciliacoes;