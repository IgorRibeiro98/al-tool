import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusChip } from "@/components/StatusChip";
import { ArrowLeft, Download } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useEffect, useState } from 'react';
import { getConciliacao, fetchConciliacaoResultado, exportConciliacao } from '@/services/conciliacaoService';



const ConciliacaoDetails = () => {
    const navigate = useNavigate();
    const { id } = useParams();

    const [job, setJob] = useState<JobConciliacao | null>(null);
    const [metrics, setMetrics] = useState<any>(null);
    const [results, setResults] = useState<ConciliacaoResultRow[]>([]);
    const [page, setPage] = useState<number>(1);
    const [pageSize] = useState<number>(50);
    const [totalPages, setTotalPages] = useState<number>(1);
    const [loading, setLoading] = useState<boolean>(true);
    const [exporting, setExporting] = useState<boolean>(false);

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
            setMetrics(body.metrics ?? null);
        }).catch(err => {
            console.error('getConciliacao failed', err);
            toast.error('Falha ao obter dados da conciliação');
        });

        // load results page
        const loadResults = (p: number) => {
            setLoading(true);
            fetchConciliacaoResultado(jid, p, pageSize)
                .then(r => {
                    if (!mounted) return;
                    const b = r.data;
                    setResults(b.data || []);
                    setPage(b.page || p);
                    setTotalPages(b.totalPages || 1);
                })
                .catch(err => {
                    console.error('fetchConciliacaoResultado failed', err);
                    toast.error('Falha ao carregar resultados');
                })
                .finally(() => { if (mounted) setLoading(false); });
        };

        loadResults(page);

        return () => { mounted = false; };
    }, [id]);

    const handleExport = async () => {
        if (!id) return;
        setExporting(true);
        try {
            await exportConciliacao(Number(id));
            toast.success('Exportação iniciada em background');
            // refresh job after short delay
            setTimeout(async () => {
                try {
                    const r = await getConciliacao(Number(id));
                    setJob(r.data.job ?? null);
                } catch (e) { }
            }, 1500);
        } catch (err: any) {
            console.error('export failed', err);
            toast.error(err?.response?.data?.error || 'Falha ao iniciar exportação');
        } finally {
            setExporting(false);
        }
    };

    const handlePageChange = (newPage: number) => {
        if (!id) return;
        setLoading(true);
        fetchConciliacaoResultado(Number(id), newPage, pageSize)
            .then(r => {
                const b = r.data;
                setResults(b.data || []);
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
        return String(vals[0]);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => navigate("/conciliacoes")}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="flex-1">
                    <h1 className="text-3xl font-bold">Detalhes da Conciliação</h1>
                    <p className="text-muted-foreground">Conciliação Janeiro 2024</p>
                </div>
                <Button onClick={handleExport}>
                    <Download className="mr-2 h-4 w-4" />
                    Exportar ZIP
                </Button>
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
                            <p className="text-sm text-muted-foreground">Data de Criação</p>
                            <p className="font-medium">{job?.created_at ?? '-'}</p>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">Data de Conclusão</p>
                            <p className="font-medium">{job?.updated_at ?? '-'}</p>
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
                    <CardTitle>Resultados da Conciliação</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted/50">
                                <tr>
                                    <th className="px-4 py-3 text-left font-medium">Conta Contábil</th>
                                    <th className="px-4 py-3 text-right font-medium">Valor Contábil</th>
                                    <th className="px-4 py-3 text-left font-medium">Conta Fiscal</th>
                                    <th className="px-4 py-3 text-right font-medium">Valor Fiscal</th>
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

                    <div className="flex items-center justify-between mt-4">
                        <div>
                            <button className="btn" onClick={() => handlePageChange(Math.max(1, page - 1))} disabled={page <= 1 || loading}>Anterior</button>
                            <button className="btn ml-2" onClick={() => handlePageChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages || loading}>Próxima</button>
                        </div>
                        <div className="text-sm text-muted-foreground">Página {page} de {totalPages}</div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default ConciliacaoDetails;