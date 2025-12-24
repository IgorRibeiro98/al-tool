import React, { FC, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, RefreshCw, Eye, Trash2, ArrowRightLeft } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import * as atribuicaoService from '@/services/atribuicaoService';
import type { AtribuicaoRun } from '@/services/atribuicaoService';

const STATUS_COLORS: Record<string, string> = {
    PENDING: 'bg-yellow-500',
    RUNNING: 'bg-blue-500',
    DONE: 'bg-green-500',
    FAILED: 'bg-red-500',
};

const STATUS_LABELS: Record<string, string> = {
    PENDING: 'Pendente',
    RUNNING: 'Executando',
    DONE: 'Concluído',
    FAILED: 'Falhou',
};

const Atribuicoes: FC = () => {
    const navigate = useNavigate();
    const { toast } = useToast();
    const [runs, setRuns] = useState<AtribuicaoRun[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

    const loadRuns = useCallback(async () => {
        setLoading(true);
        try {
            const status = statusFilter !== 'all' ? statusFilter : undefined;
            const res = await atribuicaoService.listRuns(1, 100, status);
            setRuns(res.data?.data || []);
        } catch (err: any) {
            console.error('Failed to load runs', err);
            toast({ title: 'Erro', description: 'Falha ao carregar atribuições', variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [statusFilter, toast]);

    useEffect(() => {
        loadRuns();
    }, [loadRuns]);

    // Auto-refresh for running jobs
    useEffect(() => {
        const hasRunning = runs.some(r => r.status === 'RUNNING');
        if (!hasRunning) return;
        const interval = setInterval(loadRuns, 3000);
        return () => clearInterval(interval);
    }, [runs, loadRuns]);

    const handleDelete = async () => {
        if (!pendingDeleteId) return;
        try {
            await atribuicaoService.deleteRun(pendingDeleteId);
            toast({ title: 'Sucesso', description: 'Atribuição deletada' });
            loadRuns();
        } catch (err: any) {
            toast({ title: 'Erro', description: err?.response?.data?.error || 'Falha ao deletar', variant: 'destructive' });
        } finally {
            setDeleteDialogOpen(false);
            setPendingDeleteId(null);
        }
    };

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return '-';
        try {
            return new Date(dateStr).toLocaleString('pt-BR');
        } catch {
            return dateStr;
        }
    };

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <ArrowRightLeft className="h-8 w-8 text-primary" />
                    <h1 className="text-2xl font-bold">Atribuições</h1>
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
                    <Button variant="outline" size="icon" onClick={loadRuns} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
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
                    {loading && runs.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">Carregando...</div>
                    ) : runs.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            Nenhuma atribuição encontrada. Clique em "Nova Atribuição" para começar.
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>ID</TableHead>
                                    <TableHead>Nome</TableHead>
                                    <TableHead>Origem</TableHead>
                                    <TableHead>Destino</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Data</TableHead>
                                    <TableHead className="text-right">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {runs.map((run) => (
                                    <TableRow key={run.id}>
                                        <TableCell className="font-mono">{run.id}</TableCell>
                                        <TableCell>{run.nome || '-'}</TableCell>
                                        <TableCell>
                                            <div className="flex flex-col">
                                                <span>{run.base_origem?.nome || `Base ${run.base_origem_id}`}</span>
                                                <span className="text-xs text-muted-foreground">{run.base_origem?.tipo}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col">
                                                <span>{run.base_destino?.nome || `Base ${run.base_destino_id}`}</span>
                                                <span className="text-xs text-muted-foreground">{run.base_destino?.tipo}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge className={STATUS_COLORS[run.status] || 'bg-gray-500'}>
                                                {STATUS_LABELS[run.status] || run.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>{formatDate(run.created_at)}</TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => navigate(`/atribuicoes/${run.id}`)}
                                                >
                                                    <Eye className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => {
                                                        setPendingDeleteId(run.id);
                                                        setDeleteDialogOpen(true);
                                                    }}
                                                    disabled={run.status === 'RUNNING'}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
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
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete}>Excluir</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default Atribuicoes;
