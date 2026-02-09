import { useState, useEffect, useCallback } from 'react';
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, RefreshCw, Eye, Trash2, ArrowRightLeft, Loader2 } from 'lucide-react';
import PageSkeletonWrapper from '@/components/PageSkeletonWrapper';
import { StatusChip } from '@/components/StatusChip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import * as atribuicaoService from '@/services/atribuicaoService';
import type { AtribuicaoRun } from '@/services/atribuicaoService';

const POLL_INTERVAL_MS = 3000;

const MESSAGES = {
    LOAD_FAIL: 'Falha ao carregar atribuições',
    DELETE_SUCCESS: 'Atribuição excluída com sucesso!',
    DELETE_FAIL: 'Falha ao excluir atribuição',
} as const;

const STATUS_LABELS: Record<string, string> = {
    PENDING: 'Pendente',
    RUNNING: 'Executando',
    DONE: 'Concluído',
    FAILED: 'Falhou',
};

const getStatusChip = (status?: string): 'pending' | 'running' | 'done' | 'failed' => {
    if (!status) return 'pending';
    const s = status.toUpperCase();
    if (s === 'DONE') return 'done';
    if (s === 'RUNNING') return 'running';
    if (s === 'FAILED') return 'failed';
    return 'pending';
};

const Atribuicoes: FC = () => {
    const navigate = useNavigate();
    const [runs, setRuns] = useState<AtribuicaoRun[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
    const [deleting, setDeleting] = useState(false);

    const loadRuns = useCallback(async (options?: { silent?: boolean }) => {
        const { silent = false } = options || {};
        if (!silent) setLoading(true);
        try {
            const status = statusFilter !== 'all' ? statusFilter : undefined;
            const res = await atribuicaoService.listRuns(1, 100, status);
            setRuns(res.data?.data || []);
        } catch (err) {
            console.error('Failed to load runs', err);
            if (!silent) toast.error(MESSAGES.LOAD_FAIL);
        } finally {
            if (!silent) setLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => {
        loadRuns();
    }, [loadRuns]);

    // Auto-refresh for running jobs
    useEffect(() => {
        const hasRunning = runs.some(r => r.status === 'RUNNING');
        if (!hasRunning) return;
        const interval = setInterval(() => loadRuns({ silent: true }), POLL_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [runs, loadRuns]);

    const handleDelete = useCallback(async () => {
        if (!pendingDeleteId) return;
        setDeleting(true);
        try {
            await atribuicaoService.deleteRun(pendingDeleteId);
            toast.success(MESSAGES.DELETE_SUCCESS);
            await loadRuns({ silent: true });
        } catch (err: unknown) {
            const e = err as { response?: { data?: { error?: string } } };
            toast.error(e?.response?.data?.error || MESSAGES.DELETE_FAIL);
        } finally {
            setDeleting(false);
            setDeleteDialogOpen(false);
            setPendingDeleteId(null);
        }
    }, [pendingDeleteId, loadRuns]);

    const confirmDelete = useCallback((id: number) => {
        setPendingDeleteId(id);
        setDeleteDialogOpen(true);
    }, []);

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return '-';
        try {
            return new Date(dateStr).toLocaleString('pt-BR');
        } catch {
            return dateStr;
        }
    };

    return (
        <PageSkeletonWrapper loading={loading && runs.length === 0}>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <ArrowRightLeft className="h-8 w-8 text-primary" />
                        <div>
                            <h1 className="text-3xl font-bold">Atribuições</h1>
                            <p className="text-muted-foreground">Gerenciar importação de colunas entre bases</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="w-40">
                                <SelectValue placeholder="Filtrar status" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todos</SelectItem>
                                <SelectItem value="PENDING">Pendente</SelectItem>
                                <SelectItem value="RUNNING">Executando</SelectItem>
                                <SelectItem value="DONE">Concluído</SelectItem>
                                <SelectItem value="FAILED">Falhou</SelectItem>
                            </SelectContent>
                        </Select>
                        <Button variant="outline" size="icon" onClick={() => loadRuns()} disabled={loading}>
                            {loading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <RefreshCw className="h-4 w-4" />
                            )}
                        </Button>
                        <Button onClick={() => navigate('/atribuicoes/new')}>
                            <Plus className="h-4 w-4 mr-2" />
                            Nova Atribuição
                        </Button>
                    </div>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Execuções de Atribuição</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {runs.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                Nenhuma atribuição encontrada. Clique em "Nova Atribuição" para começar.
                            </p>
                        ) : (
                            <div className="space-y-4">
                                {runs.map((run) => (
                                    <div
                                        key={run.id}
                                        className="flex flex-col gap-4 rounded-lg border p-4 transition-colors hover:bg-muted/50 md:flex-row md:items-center md:justify-between"
                                    >
                                        <div className="flex-1 space-y-1">
                                            <p className="font-medium">{run.nome || `Atribuição #${run.id}`}</p>
                                            <div className="text-sm text-muted-foreground flex flex-wrap gap-x-2 gap-y-1">
                                                <span>Origem: {run.base_origem?.nome || `Base ${run.base_origem_id}`} ({run.base_origem?.tipo})</span>
                                                <span>→</span>
                                                <span>Destino: {run.base_destino?.nome || `Base ${run.base_destino_id}`} ({run.base_destino?.tipo})</span>
                                            </div>
                                        </div>
                                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-6">
                                            <div className="text-sm text-muted-foreground">
                                                {formatDate(run.created_at)}
                                            </div>
                                            <StatusChip
                                                status={getStatusChip(run.status)}
                                                label={STATUS_LABELS[run.status] || run.status}
                                            />
                                            <div className="flex items-center gap-2">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => navigate(`/atribuicoes/${run.id}`)}
                                                    aria-label="Ver detalhes"
                                                >
                                                    <Eye className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="destructive"
                                                    size="icon"
                                                    onClick={() => confirmDelete(run.id)}
                                                    disabled={run.status === 'RUNNING'}
                                                    aria-label="Excluir"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
                            <AlertDialogDescription>
                                Tem certeza que deseja excluir esta atribuição? Esta ação não pode ser desfeita.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDelete} disabled={deleting}>
                                {deleting ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Excluindo...
                                    </>
                                ) : (
                                    'Excluir'
                                )}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </PageSkeletonWrapper>
    );
};

export default Atribuicoes;
