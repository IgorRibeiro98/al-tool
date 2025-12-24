import React, { FC, useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { ArrowLeft, ArrowRightLeft, Play, Download, RefreshCw, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import * as atribuicaoService from '@/services/atribuicaoService';
import { downloadFromResponse } from '@/lib/download';
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

const AtribuicaoDetails: FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { toast } = useToast();

    const [run, setRun] = useState<AtribuicaoRun | null>(null);
    const [loading, setLoading] = useState(true);
    const [starting, setStarting] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [exportStatus, setExportStatus] = useState<'idle' | 'processing' | 'ready'>('idle');
    const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

    // Results state
    const [results, setResults] = useState<any[]>([]);
    const [columns, setColumns] = useState<string[]>([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(0);
    const [total, setTotal] = useState(0);
    const [search, setSearch] = useState('');
    const [loadingResults, setLoadingResults] = useState(false);

    const runId = id ? Number(id) : 0;

    const translatePipelineStage = (label?: string | null, stage?: string | null) => {
        // Map known internal stage labels to Portuguese translations
        const normalized = (label || stage || '') as string;
        if (!normalized) return '';
        if (normalized === 'queued') return 'Pronto para iniciar';
        if (normalized === 'starting') return 'Iniciando';
        if (normalized === 'finalizing') return 'Finalizado';
        return normalized;
    };

    const loadRun = useCallback(async () => {
        if (!runId) return;
        try {
            const res = await atribuicaoService.getRun(runId);
            setRun(res.data);
        } catch (err: any) {
            console.error('Failed to load run', err);
            toast({ title: 'Erro', description: 'Falha ao carregar atribuição', variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [runId, toast]);

    const loadResults = useCallback(async () => {
        if (!runId || !run || run.status !== 'DONE') return;
        setLoadingResults(true);
        try {
            const res = await atribuicaoService.getResults(runId, page, 50, search || undefined);
            setResults(res.data?.data || []);
            setColumns(res.data?.columns || []);
            setTotalPages(res.data?.totalPages || 0);
            setTotal(res.data?.total || 0);
        } catch (err) {
            console.error('Failed to load results', err);
        } finally {
            setLoadingResults(false);
        }
    }, [runId, run, page, search]);


    // Carrega run e status de exportação
    useEffect(() => {
        loadRun();
    }, [loadRun]);

    // Checa status de exportação quando run está DONE
    useEffect(() => {
        if (!runId || !run || run.status !== 'DONE') {
            setExportStatus('idle');
            setDownloadUrl(null);
            return;
        }

        let cancelled = false;
        let interval: ReturnType<typeof setInterval> | null = null;

        const handleStatus = (status: string) => {
            if (status === 'ready') {
                setExportStatus('ready');
                setDownloadUrl(atribuicaoService.getDownloadUrl(runId));
            } else {
                setExportStatus('processing');
                setDownloadUrl(null);
            }
        };

        const checkExport = async () => {
            try {
                const res = await atribuicaoService.getExportStatus(runId);
                if (cancelled) return;
                handleStatus(res.data.status);
                if (res.data.status === 'ready' && interval) {
                    clearInterval(interval);
                    interval = null;
                }
            } catch {
                if (cancelled) return;
                setExportStatus('idle');
                setDownloadUrl(null);
            }
        };

        // Initial check
        checkExport();

        // Poll only while export is not ready; interval will be cleared when status becomes 'ready'
        interval = setInterval(() => {
            checkExport();
        }, 2000);

        return () => {
            cancelled = true;
            if (interval) clearInterval(interval);
        };
    }, [runId, run]);

    useEffect(() => {
        loadResults();
    }, [loadResults]);

    // Auto-refresh when running
    useEffect(() => {
        if (!run || run.status !== 'RUNNING') return;
        const interval = setInterval(loadRun, 2000);
        return () => clearInterval(interval);
    }, [run, loadRun]);

    const handleStart = async () => {
        if (!runId) return;
        setStarting(true);
        try {
            await atribuicaoService.startRun(runId);
            toast({ title: 'Iniciado', description: 'Execução iniciada' });
            loadRun();
        } catch (err: any) {
            toast({
                title: 'Erro',
                description: err?.response?.data?.error || 'Falha ao iniciar',
                variant: 'destructive',
            });
        } finally {
            setStarting(false);
        }
    };

    const handleExport = async () => {
        if (!runId) return;
        setExporting(true);
        try {
            // Dispara exportação (GET /export)
            const res = await atribuicaoService.getExportStatus(runId);
            if (res.data.status === 'ready') {
                // Download direto usando helper que respeita content-disposition
                const fileRes = await atribuicaoService.downloadExportFile(runId);
                downloadFromResponse(fileRes, run?.nome || undefined);
                toast({ title: 'Sucesso', description: 'Download iniciado' });
            } else {
                // Dispara processamento
                await atribuicaoService.getExportStatus(runId);
                toast({ title: 'Exportação iniciada', description: 'Aguarde o processamento...' });
            }
        } catch (err: any) {
            toast({
                title: 'Erro',
                description: err?.response?.data?.error || 'Falha ao exportar',
                variant: 'destructive',
            });
        } finally {
            setExporting(false);
        }
    };

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setPage(1);
        loadResults();
    };

    if (loading) {
        return (
            <div className="p-6 flex items-center justify-center">
                <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!run) {
        return (
            <div className="p-6">
                <p className="text-muted-foreground">Atribuição não encontrada</p>
            </div>
        );
    }

    const progress = run.pipeline_progress ?? 0;
    const canStart = run.status === 'PENDING' || run.status === 'FAILED';
    const canExport = run.status === 'DONE';

    // Display columns (prioritize important ones)
    const priorityCols = ['dest_row_id', 'orig_row_id', 'matched_key_identifier'];
    const otherCols = columns.filter(c => !priorityCols.includes(c) && c !== 'id' && c !== 'created_at' && c !== 'updated_at');
    const displayCols = [...priorityCols.filter(c => columns.includes(c)), ...otherCols].slice(0, 10);

    return (
        <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate('/atribuicoes')}>
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div className="flex items-center gap-3">
                        <ArrowRightLeft className="h-8 w-8 text-primary" />
                        <div>
                            <h1 className="text-2xl font-bold">{run.nome || `Atribuição #${run.id}`}</h1>
                            <p className="text-sm text-muted-foreground">
                                {translatePipelineStage(run.pipeline_stage_label, run.pipeline_stage) || 'Aguardando'}
                            </p>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Badge className={STATUS_COLORS[run.status] || 'bg-gray-500'}>
                        {STATUS_LABELS[run.status] || run.status}
                    </Badge>
                    {canStart && (
                        <Button onClick={handleStart} disabled={starting}>
                            <Play className="h-4 w-4 mr-2" />
                            {starting ? 'Iniciando...' : 'Iniciar Execução'}
                        </Button>
                    )}
                    {canExport && (
                        <Button
                            variant="outline"
                            onClick={handleExport}
                            disabled={exporting || exportStatus === 'processing'}
                        >
                            <Download className="h-4 w-4 mr-2" />
                            {exporting
                                ? 'Exportando...'
                                : exportStatus === 'processing'
                                    ? 'Processando arquivo...'
                                    : exportStatus === 'ready'
                                        ? 'Baixar XLSX'
                                        : 'Exportar XLSX'}
                        </Button>
                    )}
                </div>
            </div>

            {/* Progress */}
            {run.status === 'RUNNING' && (
                <Card>
                    <CardContent className="pt-6">
                        <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                                <span>{translatePipelineStage(run.pipeline_stage_label, run.pipeline_stage) || 'Processando...'}</span>
                                <span>{progress}%</span>
                            </div>
                            <Progress value={progress} className="h-2" />
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Error */}
            {run.status === 'FAILED' && run.erro && (
                <Card className="border-destructive">
                    <CardContent className="pt-6">
                        <p className="text-destructive">Erro: {run.erro}</p>
                    </CardContent>
                </Card>
            )}

            {/* Summary */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Configuração</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <p className="text-sm text-muted-foreground">Base Origem</p>
                                <p className="font-medium">{run.base_origem?.nome || `Base ${run.base_origem_id}`}</p>
                                <p className="text-xs text-muted-foreground">{run.base_origem?.tipo}</p>
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Base Destino</p>
                                <p className="font-medium">{run.base_destino?.nome || `Base ${run.base_destino_id}`}</p>
                                <p className="text-xs text-muted-foreground">{run.base_destino?.tipo}</p>
                            </div>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">Modo de Escrita</p>
                            <p className="font-medium">
                                {run.mode_write === 'ONLY_EMPTY' ? 'Somente se vazio' : 'Sobrescrever sempre'}
                            </p>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Colunas e Chaves</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <p className="text-sm text-muted-foreground">Colunas Importadas</p>
                            <div className="flex flex-wrap gap-1 mt-1">
                                {(run.selected_columns || []).map((col) => (
                                    <Badge key={col} variant="outline">{col}</Badge>
                                ))}
                            </div>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">Chaves (por prioridade)</p>
                            <div className="flex flex-wrap gap-1 mt-1">
                                {(run.keys || []).map((k) => (
                                    <Badge key={k.id} variant="secondary">
                                        {k.key_identifier}: {k.keys_pair?.nome || `Par ${k.keys_pair_id}`}
                                    </Badge>
                                ))}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Results */}
            {run.status === 'DONE' && (
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle>Resultados</CardTitle>
                                <CardDescription>{total} registros encontrados</CardDescription>
                            </div>
                            <form onSubmit={handleSearch} className="flex items-center gap-2">
                                <Input
                                    placeholder="Buscar..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="w-48"
                                />
                                <Button type="submit" variant="outline" size="icon">
                                    <Search className="h-4 w-4" />
                                </Button>
                            </form>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {loadingResults ? (
                            <div className="text-center py-8">
                                <RefreshCw className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                            </div>
                        ) : results.length === 0 ? (
                            <p className="text-center py-8 text-muted-foreground">Nenhum resultado encontrado</p>
                        ) : (
                            <>
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                {displayCols.map((col) => (
                                                    <TableHead key={col} className="whitespace-nowrap">{col}</TableHead>
                                                ))}
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {results.map((row, idx) => (
                                                <TableRow key={row.id || idx}>
                                                    {displayCols.map((col) => (
                                                        <TableCell key={col} className="whitespace-nowrap max-w-xs truncate">
                                                            {String(row[col] ?? '')}
                                                        </TableCell>
                                                    ))}
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                                {/* Pagination */}
                                {totalPages > 1 && (
                                    <div className="flex items-center justify-center gap-2 mt-4">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setPage(p => Math.max(1, p - 1))}
                                            disabled={page <= 1}
                                        >
                                            Anterior
                                        </Button>
                                        <span className="text-sm">
                                            Página {page} de {totalPages}
                                        </span>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                            disabled={page >= totalPages}
                                        >
                                            Próxima
                                        </Button>
                                    </div>
                                )}
                            </>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
};

export default AtribuicaoDetails;
