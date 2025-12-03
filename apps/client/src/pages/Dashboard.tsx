import { MetricCard } from "@/components/MetricCard";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Database, CheckCircle2, XCircle, PlayCircle, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { fetchBases } from '@/services/baseService';
import { fetchConciliacoes } from '@/services/conciliacaoService';
import { fetchConfigsConciliacao, fetchConfigsEstorno, fetchConfigsCancelamento, fetchConfigsMapeamento } from '@/services/configsService';

const Dashboard = () => {
    const navigate = useNavigate();

    const [bases, setBases] = useState<Base[]>([]);
    const [conciliacoes, setConciliacoes] = useState<JobConciliacao[]>([]);
    const [configsConciliacao, setConfigsConciliacao] = useState<ConfigConciliacao[]>([]);
    const [configsEstorno, setConfigsEstorno] = useState<ConfigEstorno[]>([]);
    const [configsCancelamento, setConfigsCancelamento] = useState<ConfigCancelamento[]>([]);
    const [configsMapeamento, setConfigsMapeamento] = useState<ConfigMapeamento[]>([]);

    useEffect(() => {
        let mounted = true;
        fetchBases().then((r: any) => {
            if (!mounted) return;
            const data = r.data?.data || r.data || [];
            setBases(data as Base[]);
        }).catch(() => setBases([]));

        fetchConciliacoes().then((r: any) => {
            if (!mounted) return;
            const data = r.data?.data || r.data || [];
            setConciliacoes(data as JobConciliacao[]);
        }).catch(() => setConciliacoes([]));

        fetchConfigsConciliacao().then((r: any) => {
            if (!mounted) return;
            const data = r.data?.data || r.data || [];
            setConfigsConciliacao(data as ConfigConciliacao[]);
        }).catch(() => setConfigsConciliacao([]));

        fetchConfigsEstorno().then((r: any) => {
            if (!mounted) return;
            const data = r.data?.data || r.data || [];
            setConfigsEstorno(data as ConfigEstorno[]);
        }).catch(() => setConfigsEstorno([]));

        fetchConfigsCancelamento().then((r: any) => {
            if (!mounted) return;
            const data = r.data?.data || r.data || [];
            setConfigsCancelamento(data as ConfigCancelamento[]);
        }).catch(() => setConfigsCancelamento([]));

        fetchConfigsMapeamento().then((r: any) => {
            if (!mounted) return;
            const data = r.data?.data || r.data || [];
            setConfigsMapeamento(data as ConfigMapeamento[]);
        }).catch(() => setConfigsMapeamento([]));

        return () => { mounted = false; };
    }, []);

    const contabilCount = bases.filter(b => b.tipo === 'CONTABIL').length;
    const fiscalCount = bases.filter(b => b.tipo === 'FISCAL').length;
    const totalConciliacoes = conciliacoes.length;
    const runningJobs = conciliacoes.filter(j => j.status === 'RUNNING').length;
    const basesNotIngested = bases.filter(b => !b.tabela_sqlite).length;
    const totalConfigs = configsConciliacao.length + configsEstorno.length + configsCancelamento.length + configsMapeamento.length;

    const recentJobs = conciliacoes.slice(0, 6);

    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const contabilIngestedThisMonth = bases.filter(b => b.tipo === 'CONTABIL' && b.created_at && new Date(b.created_at) > cutoff).length;
    const fiscalIngestedThisMonth = bases.filter(b => b.tipo === 'FISCAL' && b.created_at && new Date(b.created_at) > cutoff).length;
    const percentActive = totalConciliacoes > 0 ? Math.round((runningJobs / totalConciliacoes) * 100) : 0;

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold">Dashboard</h1>
                <p className="text-muted-foreground">Visão geral do sistema de conciliação</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                    title="Bases Contábeis"
                    value={String(contabilCount)}
                    icon={Database}
                    description={`${contabilIngestedThisMonth} ingeridas este mês`}
                />
                <MetricCard
                    title="Bases Fiscais"
                    value={String(fiscalCount)}
                    icon={Database}
                    description={`${fiscalIngestedThisMonth} ingeridas este mês`}
                />
                <MetricCard
                    title="Conciliações"
                    value={String(totalConciliacoes)}
                    icon={CheckCircle2}
                    description={totalConciliacoes > 0 ? `${percentActive}% ativos` : ''}
                />
                <MetricCard
                    title="Últimos Jobs"
                    value={String(recentJobs.length)}
                    icon={PlayCircle}
                    description={`${runningJobs} em execução`}
                />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Ações Rápidas</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        <Button className="w-full justify-start" onClick={() => navigate("/bases/new")}>
                            <Plus className="mr-2 h-4 w-4" />
                            Adicionar Base
                        </Button>
                        <Button className="w-full justify-start" variant="outline" onClick={() => navigate("/conciliacoes/new")}>
                            <Plus className="mr-2 h-4 w-4" />
                            Nova Conciliação
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Status do Sistema</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Bases não ingeridas</span>
                            <span className="font-medium">{basesNotIngested}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Configurações</span>
                            <span className="font-medium">{totalConfigs}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Jobs em execução</span>
                            <span className="font-medium">{runningJobs}</span>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Últimos Jobs Executados</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {recentJobs.map((job) => (
                            <div
                                key={job.id}
                                className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer"
                                onClick={() => navigate(`/conciliacoes/${job.id}`)}
                            >
                                <div className="flex-1">
                                    <p className="font-medium">{job.nome || `Job ${job.id}`}</p>
                                    <p className="text-sm text-muted-foreground">Config: {job.config_conciliacao_id}</p>
                                </div>
                                <div className="flex items-center gap-4">
                                    <span className="text-sm text-muted-foreground">{job.created_at ? new Date(job.created_at).toLocaleDateString('pt-BR') : ''}</span>
                                    <StatusChip status={(job.status || 'PENDING') as any} />
                                </div>
                            </div>
                        ))}
                        {recentJobs.length === 0 && (
                            <div className="text-sm text-muted-foreground">Nenhum job encontrado</div>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default Dashboard;