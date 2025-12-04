import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusChip } from "@/components/StatusChip";
import { ArrowLeft, Download, Trash } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useEffect, useState, useRef } from 'react';
import PageSkeletonWrapper from '@/components/PageSkeletonWrapper';
import { getConciliacao, fetchConciliacaoResultado, exportConciliacao, deleteConciliacao, getDownloadUrl } from '@/services/conciliacaoService';
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

const EXPORT_STATUS_MESSAGES: Record<string, string> = {
    STARTING: 'Preparando exportação',
    EXPORT_BUILDING_A: 'Exportando resultados da Base A',
    EXPORT_BUILT_A: 'Base A concluída',
    EXPORT_BUILDING_B: 'Exportando resultados da Base B',
    EXPORT_BUILT_B: 'Base B concluída',
    EXPORT_BUILDING_COMBINED: 'Gerando planilha comparativa',
    EXPORT_BUILT_COMBINED: 'Comparativo concluído',
    EXPORT_ZIPPED: 'Compactando arquivos',
    EXPORT_DONE: 'Exportação finalizada',
    FAILED: 'Exportação falhou'
};

const getExportStatusLabel = (code?: string | null) => {
    if (!code) return 'Iniciando...';
    const normalized = code.toUpperCase();
    return EXPORT_STATUS_MESSAGES[normalized] ?? code;
};



const ConciliacaoDetails = () => {
    const navigate = useNavigate();
    const { id } = useParams();

    const [job, setJob] = useState<JobConciliacao | null>(null);
    const [metrics, setMetrics] = useState<any>(null);
    const [results, setResults] = useState<ConciliacaoResultRow[]>([]);
    const [keyIds, setKeyIds] = useState<string[]>([]);
    const [statusFilter, setStatusFilter] = useState<string | null | undefined>(undefined);
    const [page, setPage] = useState<number>(1);
    const [pageSize] = useState<number>(50);
    const [totalPages, setTotalPages] = useState<number>(1);
    const [loading, setLoading] = useState<boolean>(true);
    const [exporting, setExporting] = useState<boolean>(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
    const [exportProgress, setExportProgress] = useState<number | null>(null);
    const [exportStatus, setExportStatus] = useState<string | null>(null);
    const [exportFile, setExportFile] = useState<string | null>(null);
    const pollRef = useRef<number | null>(null);

    useEffect(() => {
        if (!id) return;
        const jid = Number(id);
        let mounted = true;
        setLoading(true);

        // get job + metrics
        getConciliacao(jid).then(res => {
            if (!mounted) return;
            const body = res.data;
            setJob(body.job ?? null);
            // populate export-related UI fields if present on job
            const jb = body.job ?? null;
            if (jb) {
                if ((jb as any).export_progress != null) setExportProgress(Number((jb as any).export_progress));
                if ((jb as any).export_status != null) setExportStatus(String((jb as any).export_status));
                if (jb.arquivo_exportado) setExportFile(String(jb.arquivo_exportado));
            }
            setMetrics(body.metrics ?? null);
        }).catch(err => {
            console.error('getConciliacao failed', err);
            toast.error('Falha ao obter dados da conciliação');
        });

        // load results page
        const loadResults = (p: number) => {
            setLoading(true);
            fetchConciliacaoResultado(jid, p, pageSize, statusFilter)
                .then(r => {
                    if (!mounted) return;
                    const b = r.data;
                    const rows = b.data || [];
                    setResults(rows);
                    // detect dynamic key identifiers (e.g. CHAVE_1, CHAVE_2)
                    if (rows && rows.length > 0) {
                        const first = rows[0];
                        const keys = Object.keys(first).filter(k => /^CHAVE_\d+/.test(k));
                        setKeyIds(keys);
                    } else {
                        setKeyIds([]);
                    }
                    setPage(b.page || p);
                    setTotalPages(b.totalPages || 1);
                })
                .catch(err => {
                    console.error('fetchConciliacaoResultado failed', err);
                    toast.error('Falha ao carregar resultados');
                })
                .finally(() => { if (mounted) setLoading(false); });
        };

        // always load first page when mounting or when filter changes
        loadResults(1);

        return () => { mounted = false; };
    }, [id, statusFilter]);

    // cleanup polling on unmount
    useEffect(() => {
        return () => {
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
        };
    }, []);

    const handleExport = async () => {
        if (!id) return;
        setExporting(true);
        setExportProgress(null);
        setExportStatus('STARTING');
        setExportFile(null);
        try {
            const resp = await exportConciliacao(Number(id));
            toast.success('Exportação iniciada em background');

            // start polling job status for export progress
            const startPolling = () => {
                if (pollRef.current) return;
                const iv = window.setInterval(async () => {
                    try {
                        const r = await getConciliacao(Number(id));
                        const jb = r.data.job ?? null;
                        if (!jb) return;
                        // update progress/status/file from job row
                        if ((jb as any).export_progress != null) setExportProgress(Number((jb as any).export_progress));
                        if ((jb as any).export_status != null) setExportStatus(String((jb as any).export_status));
                        if ((jb as any).arquivo_exportado) {
                            setExportFile(String((jb as any).arquivo_exportado));
                            setExporting(false);
                            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
                            toast.success('Exportação concluída');
                            // refresh job metadata once more
                            setJob(jb);
                        } else {
                            // still exporting; optionally refresh job metadata
                            setJob(jb);
                        }
                    } catch (e) {
                        console.error('poll export status failed', e);
                    }
                }, 5000);
                pollRef.current = iv;
            };

            // give the worker a moment then start polling
            setTimeout(startPolling, 800);
        } catch (err: any) {
            console.error('export failed', err);
            toast.error(err?.response?.data?.error || 'Falha ao iniciar exportação');
            setExporting(false);
            setExportStatus('FAILED');
        }
    };

    const handlePageChange = (newPage: number) => {
        if (!id) return;
        setLoading(true);
        fetchConciliacaoResultado(Number(id), newPage, pageSize, statusFilter)
            .then(r => {
                const b = r.data;
                const rows = b.data || [];
                setResults(rows);
                if (rows && rows.length > 0) {
                    const first = rows[0];
                    const keys = Object.keys(first).filter(k => /^CHAVE_\d+/.test(k));
                    setKeyIds(keys);
                } else setKeyIds([]);
                setPage(b.page || newPage);
                setTotalPages(b.totalPages || 1);
            })
            .catch(err => {
                console.error('fetch page failed', err);
                toast.error('Falha ao carregar resultados');
            })
            .finally(() => setLoading(false));
    };

    const displayAccount = (values: any, rowId?: number) => {
        if (!values) return rowId ? `#${rowId}` : '-';
        if (typeof values === 'string') return values;
        if (typeof values === 'number') return values.toString();
        const vals = Object.values(values);
        if (vals.length === 0) return rowId ? `#${rowId}` : '-';
        return String(vals[1] ?? vals[0]);
    };

    const getPageList = () => {
        const pages: Array<number | string> = [];
        const total = totalPages || 1;
        const maxButtons = 10; // total buttons shown (including first and last)

        if (total <= maxButtons) {
            for (let i = 1; i <= total; i++) pages.push(i);
            return pages;
        }

        pages.push(1);

        // compute a sliding window of middle pages (reserve first + last + possible ellipses)
        const middleCount = maxButtons - 2; // exclude first and last
        let start = Math.max(2, page - Math.floor((middleCount - 1) / 2));
        let end = start + middleCount - 1;

        if (end >= total) {
            end = total - 1;
            start = Math.max(2, end - (middleCount - 1));
        }

        if (start > 2) pages.push('...');
        for (let i = start; i <= end; i++) pages.push(i);
        if (end < total - 1) pages.push('...');

        pages.push(total);
        return pages;
    };

    return (
        <PageSkeletonWrapper loading={loading}>
            <div className="space-y-6">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate("/conciliacoes")}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div className="flex-1">
                        <h1 className="text-3xl font-bold">Detalhes da Conciliação</h1>
                        <p className="text-muted-foreground">Conciliação Janeiro 2024</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-2">
                            {!exportFile ? (
                                job?.status === 'DONE' && (
                                    <Button onClick={handleExport} disabled={exporting}>
                                        <Download className="mr-2 h-4 w-4" />
                                        {exporting ? 'Exportando...' : 'Exportar ZIP'}
                                    </Button>
                                )
                            ) : (
                                <Button onClick={() => { if (!id) return; window.location.href = getDownloadUrl(Number(id)); }}>
                                    <Download className="mr-2 h-4 w-4" />
                                    Baixar
                                </Button>
                            )}

                            {/* inline small progress indicator */}
                            {exporting && (
                                <div className="w-48">
                                    <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                                        <div className="h-2 bg-primary transition-all" style={{ width: `${exportProgress ?? 4}%` }} />
                                    </div>
                                    <div className="text-xs text-muted-foreground mt-1">{getExportStatusLabel(exportStatus)} {exportProgress != null ? `— ${Math.round(exportProgress)}%` : ''}</div>
                                </div>
                            )}
                        </div>
                        <Button variant="destructive" size="icon" onClick={() => { if (!id) return; setPendingDeleteId(Number(id)); setDeleteDialogOpen(true); }} aria-label="Deletar conciliação">
                            <Trash className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>Informações do Job</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div>
                                <p className="text-sm text-muted-foreground">Status</p>
                                <StatusChip status={job?.status ?? 'PENDING'} />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Configuração</p>
                                <p className="font-medium">{job?.nome ?? 'Configuração'}</p>
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Mapeamento</p>
                                <p className="font-medium">{job?.config_mapeamento_nome ?? (job?.config_mapeamento_id ? `#${job.config_mapeamento_id}` : 'Não aplicado')}</p>
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Data de Criação</p>
                                <p className="font-medium">{job?.created_at ? new Date(job.created_at).toLocaleDateString('pt-BR') : '-'}</p>
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Data de Conclusão</p>
                                <p className="font-medium">{job?.updated_at ? new Date(job.updated_at).toLocaleDateString('pt-BR') : '-'}</p>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Métricas</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="flex justify-between">
                                <span className="text-sm text-muted-foreground">Total de Registros</span>
                                <span className="font-bold">{metrics?.totalRows != null ? Number(metrics.totalRows).toLocaleString('pt-BR') : '-'}</span>
                            </div>

                            {/* breakdown by status */}
                            <div>
                                <p className="text-sm text-muted-foreground">Por Status</p>
                                {metrics?.byStatus && metrics.byStatus.length > 0 ? (
                                    metrics.byStatus.map((s: any) => (
                                        <div key={s.status} className="flex justify-between">
                                            <span className="text-sm">{s.status}</span>
                                            <span className="font-bold">{Number(s.count).toLocaleString('pt-BR')}</span>
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-sm text-muted-foreground">Sem dados</div>
                                )}
                            </div>

                            {/* breakdown by group */}
                            <div>
                                <p className="text-sm text-muted-foreground">Por Grupo</p>
                                {metrics?.byGroup && metrics.byGroup.length > 0 ? (
                                    metrics.byGroup.map((g: any) => (
                                        <div key={g.grupo} className="flex justify-between">
                                            <span className="text-sm">{g.grupo}</span>
                                            <span className="font-bold">{Number(g.count).toLocaleString('pt-BR')}</span>
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-sm text-muted-foreground">Sem dados</div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between w-full">
                            <CardTitle>Resultados da Conciliação</CardTitle>
                            <div>
                                <Select
                                    onValueChange={(v) => {
                                        if (v === '__ALL__') setStatusFilter(undefined);
                                        else if (v === '__NULL__') setStatusFilter(null);
                                        else setStatusFilter(v);
                                        setPage(1);
                                    }}
                                    value={statusFilter === undefined ? '__ALL__' : (statusFilter === null ? '__NULL__' : statusFilter)}
                                >
                                    <SelectTrigger className="w-56">
                                        <SelectValue placeholder="Todos" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__ALL__">Todos</SelectItem>
                                        {metrics?.byStatus && metrics.byStatus.map((s: any) => {
                                            const val = s.status != null ? String(s.status) : '__NULL__';
                                            const label = `${s.status ?? 'Sem status'} (${Number(s.count).toLocaleString('pt-BR')})`;
                                            return <SelectItem key={String(val)} value={val}>{label}</SelectItem>;
                                        })}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-md border overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="border-b bg-muted/50">
                                    <tr>
                                        <th className="px-4 py-3 text-left font-medium">Índice Contábil</th>
                                        <th className="px-4 py-3 text-right font-medium">Valor Contábil</th>
                                        <th className="px-4 py-3 text-left font-medium">Índice Fiscal</th>
                                        <th className="px-4 py-3 text-right font-medium">Valor Fiscal</th>
                                        {keyIds.map(k => (
                                            <th key={k} className="px-4 py-3 text-left font-medium">{k.replace('_', ' ')}</th>
                                        ))}
                                        <th className="px-4 py-3 text-center font-medium">Status</th>
                                        <th className="px-4 py-3 text-center font-medium">Grupo</th>
                                        <th className="px-4 py-3 text-center font-medium">Chave</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {results.map((row) => (
                                        <tr key={row.id} className="border-b hover:bg-muted/50 transition-colors">
                                            <td className="px-4 py-3 font-mono">{displayAccount(row.a_values, row.a_row_id)}</td>
                                            <td className="px-4 py-3 text-right font-mono">
                                                {row.value_a != null ? Number(row.value_a).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : "-"}
                                            </td>
                                            <td className="px-4 py-3 font-mono">{displayAccount(row.b_values, row.b_row_id)}</td>
                                            <td className="px-4 py-3 text-right font-mono">
                                                {row.value_b != null ? Number(row.value_b).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : "-"}
                                            </td>
                                            {keyIds.map(k => (
                                                <td key={k} className="px-4 py-3 font-mono">{row[k] ?? '-'}</td>
                                            ))}
                                            <td className="px-4 py-3 text-center">
                                                <StatusChip status={String(row.status ?? '').toLowerCase() || 'pending'} label={String(row.status ?? '')} />
                                            </td>
                                            <td className="px-4 py-3 text-center font-mono">{row.grupo ?? '-'}</td>
                                            <td className="px-4 py-3 text-center font-mono">{row.chave ?? '-'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex items-center justify-center mt-4">
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => handlePageChange(Math.max(1, page - 1))}
                                    disabled={page <= 1 || loading}
                                    className="inline-flex items-center px-3 py-1 rounded-md border text-sm"
                                    aria-label="Página anterior"
                                >
                                    Anterior
                                </button>

                                <nav className="flex items-center gap-2" aria-label="Páginas">
                                    {getPageList().map((p, i) => (
                                        p === '...' ? (
                                            <span key={`dots-${i}`} className="px-2 text-sm text-muted-foreground">{p}</span>
                                        ) : (
                                            <button
                                                key={p}
                                                onClick={() => handlePageChange(Number(p))}
                                                className={`inline-flex items-center justify-center min-w-[44px] px-3 h-9 text-sm rounded-md border ${Number(p) === page ? 'bg-primary text-white' : 'bg-stone text-white-700'}`}
                                                aria-current={Number(p) === page ? 'page' : undefined}
                                                disabled={loading}
                                            >
                                                {p}
                                            </button>
                                        )
                                    ))}
                                </nav>

                                <button
                                    onClick={() => handlePageChange(Math.min(totalPages, page + 1))}
                                    disabled={page >= totalPages || loading}
                                    className="inline-flex items-center px-3 py-1 rounded-md border text-sm"
                                    aria-label="Próxima página"
                                >
                                    Próxima
                                </button>
                            </div>
                        </div>
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
                                    navigate('/conciliacoes');
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

export default ConciliacaoDetails;