import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusChip } from "@/components/StatusChip";
import { Plus, Eye } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from 'react';
import { fetchConciliacoes } from '@/services/conciliacaoService';
import { toast } from 'sonner';
import api from '@/services/api';

const Conciliacoes = () => {
    const navigate = useNavigate();
    const [jobs, setJobs] = useState<JobConciliacao[]>([]);
    const [loading, setLoading] = useState<boolean>(true);

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

    return (
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
                                                <span>Config: {String(job.config_conciliacao_id ?? '-')}</span>
                                                <span className="mx-2">•</span>
                                                <span>Estorno: {String(job.config_estorno_id ?? '-')}</span>
                                                <span className="mx-2">•</span>
                                                <span>Cancelamento: {String(job.config_cancelamento_id ?? '-')}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-6">
                                            <div className="text-right">
                                                <p className="text-xs text-muted-foreground">Criado</p>
                                                <p className="text-sm font-mono">{job.created_at ? new Date(job.created_at).toLocaleString() : '-'}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-xs text-muted-foreground">Atualizado</p>
                                                <p className="text-sm font-mono">{job.updated_at ? new Date(job.updated_at).toLocaleString() : '-'}</p>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <StatusChip status={(job.status || 'PENDING') as any} />
                                                {job.erro && (
                                                    <div className="text-xs text-red-600">Erro: {String(job.erro)}</div>
                                                )}
                                                {job.arquivo_exportado ? (
                                                    <a
                                                        className="text-sm text-primary underline"
                                                        href={`${api.defaults.baseURL || ''}/conciliacoes/${job.id}/download`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                    >
                                                        Baixar
                                                    </a>
                                                ) : null}
                                                <Button variant="ghost" size="sm" onClick={() => navigate(`/conciliacoes/${job.id}`)}>
                                                    <Eye className="h-4 w-4" />
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
        </div>
    );
};

export default Conciliacoes;