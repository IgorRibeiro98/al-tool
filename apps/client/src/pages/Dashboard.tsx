import { MetricCard } from "@/components/MetricCard";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Database, CheckCircle2, PlayCircle, Plus, Eraser, Trash } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchBases } from '@/services/baseService';
import { fetchConciliacoes } from '@/services/conciliacaoService';
import { fetchConfigsConciliacao, fetchConfigsEstorno, fetchConfigsCancelamento, fetchConfigsMapeamento } from '@/services/configsService';
import { maintenanceCleanup, maintenanceCleanupStorage } from '@/services/maintenanceService';
import { toast } from 'sonner';
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

const SCOPE = 'Dashboard';
const DAYS_30_MS = 30 * 24 * 60 * 60 * 1000;
const MSG_CLEANUP_FAILED = 'Falha ao executar limpeza';
const MSG_CLEANUP_STORAGE_FAILED = 'Falha ao limpar arquivos';
const MSG_CLEANUP_DONE = 'Limpeza concluída';
const MSG_CLEANUP_STORAGE_DONE = 'Limpeza de arquivos concluída';

const formatDateOrEmpty = (d?: string | null) => {
    if (!d) return '';
    try {
        return new Date(d).toLocaleDateString('pt-BR');
    } catch {
        return '';
    }
};

const JobRow = ({ job, onView }: { job: JobConciliacao; onView: (id: number) => void }) => (
    <div
        key={job.id}
        className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer"
        onClick={() => onView(job.id)}
    >
        <div className="flex-1">
            <p className="font-medium">{job.nome || `Job ${job.id}`}</p>
            <p className="text-sm text-muted-foreground">Config: {job.config_conciliacao_id}</p>
        </div>
        <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">{formatDateOrEmpty(job.created_at)}</span>
            <StatusChip status={(job.status || 'PENDING') as any} />
        </div>
    </div>
);

const Dashboard: React.FC = () => {
    const navigate = useNavigate();

    const [bases, setBases] = useState<Base[]>([]);
    const [conciliacoes, setConciliacoes] = useState<JobConciliacao[]>([]);
    const [configsConciliacao, setConfigsConciliacao] = useState<ConfigConciliacao[]>([]);
    const [configsEstorno, setConfigsEstorno] = useState<ConfigEstorno[]>([]);
    const [configsCancelamento, setConfigsCancelamento] = useState<ConfigCancelamento[]>([]);
    const [configsMapeamento, setConfigsMapeamento] = useState<ConfigMapeamento[]>([]);
    const [cleaning, setCleaning] = useState(false);
    const [cleaningStorage, setCleaningStorage] = useState(false);
    const [confirmCleanupOpen, setConfirmCleanupOpen] = useState(false);
    const [confirmCleanupStorageOpen, setConfirmCleanupStorageOpen] = useState(false);

    const loadAll = useCallback(async () => {
        try {
            const [basesRes, jobsRes, cfgCRes, cfgERes, cfgCancRes, cfgMapRes] = await Promise.all([
                fetchBases(),
                fetchConciliacoes(),
                fetchConfigsConciliacao(),
                fetchConfigsEstorno(),
                fetchConfigsCancelamento(),
                fetchConfigsMapeamento(),
            ]);

            const basesData = basesRes.data?.data || basesRes.data || [];
            const jobsData = jobsRes.data?.data || jobsRes.data || [];
            const cfgCData = cfgCRes.data?.data || cfgCRes.data || [];
            const cfgEData = cfgERes.data?.data || cfgERes.data || [];
            const cfgCancData = cfgCancRes.data?.data || cfgCancRes.data || [];
            const cfgMapData = cfgMapRes.data?.data || cfgMapRes.data || [];

            setBases(basesData as Base[]);
            setConciliacoes(jobsData as JobConciliacao[]);
            setConfigsConciliacao(cfgCData as ConfigConciliacao[]);
            setConfigsEstorno(cfgEData as ConfigEstorno[]);
            setConfigsCancelamento(cfgCancData as ConfigCancelamento[]);
            setConfigsMapeamento(cfgMapData as ConfigMapeamento[]);
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`${SCOPE} - failed to load dashboard data`, err);
            // best-effort: clear affected states
            setBases([]);
            setConciliacoes([]);
            setConfigsConciliacao([]);
            setConfigsEstorno([]);
            setConfigsCancelamento([]);
            setConfigsMapeamento([]);
        }
    }, []);

    useEffect(() => {
        loadAll();
    }, [loadAll]);

    const executeCleanup = useCallback(async () => {
        if (cleaning) return;
        setCleaning(true);
        try {
            const res = await maintenanceCleanup();
            const payload = res.data || res || {};
            toast.success(MSG_CLEANUP_DONE, {
                description: `Uploads: ${payload.deletedUploads ?? 0}, Ingests: ${payload.deletedIngests ?? 0}, Exports: ${payload.deletedExports ?? 0}, Bases removidas: ${payload.deletedBases ?? 0}, Conciliações removidas: ${payload.deletedJobs ?? 0}, Tabelas base dropadas: ${(payload.droppedTables || []).length}, Resultados dropados: ${(payload.droppedResultTables || []).length}`,
            });
            // refresh data after cleanup
            await loadAll();
        } catch (e: any) {
            // eslint-disable-next-line no-console
            console.error(`${SCOPE} - cleanup failed`, e);
            toast.error(MSG_CLEANUP_FAILED, { description: e?.response?.data?.error || e?.message });
        } finally {
            setCleaning(false);
        }
    }, [cleaning, loadAll]);

    const executeCleanupStorage = useCallback(async () => {
        if (cleaningStorage) return;
        setCleaningStorage(true);
        try {
            const res = await maintenanceCleanupStorage();
            const payload = res.data || res || {};
            toast.success(MSG_CLEANUP_STORAGE_DONE, {
                description: `Uploads: ${payload.deletedUploads ?? 0}, Ingests: ${payload.deletedIngests ?? 0}, Exports: ${payload.deletedExports ?? 0}`,
            });
        } catch (e: any) {
            // eslint-disable-next-line no-console
            console.error(`${SCOPE} - cleanup storage failed`, e);
            toast.error(MSG_CLEANUP_STORAGE_FAILED, { description: e?.response?.data?.error || e?.message });
        } finally {
            setCleaningStorage(false);
        }
    }, [cleaningStorage]);

    const contabilCount = useMemo(() => bases.filter(b => b.tipo === 'CONTABIL').length, [bases]);
    const fiscalCount = useMemo(() => bases.filter(b => b.tipo === 'FISCAL').length, [bases]);
    const totalConciliacoes = conciliacoes.length;
    const runningJobs = useMemo(() => conciliacoes.filter(j => j.status === 'RUNNING').length, [conciliacoes]);
    const basesNotIngested = useMemo(() => bases.filter(b => !b.tabela_sqlite).length, [bases]);
    const totalConfigs = configsConciliacao.length + configsEstorno.length + configsCancelamento.length + configsMapeamento.length;

    const recentJobs = useMemo(() => conciliacoes.slice(0, 6), [conciliacoes]);

    const cutoff = useMemo(() => new Date(Date.now() - DAYS_30_MS), []);
    const contabilIngestedThisMonth = useMemo(() => bases.filter(b => b.tipo === 'CONTABIL' && b.created_at && new Date(b.created_at) > cutoff).length, [bases, cutoff]);
    const fiscalIngestedThisMonth = useMemo(() => bases.filter(b => b.tipo === 'FISCAL' && b.created_at && new Date(b.created_at) > cutoff).length, [bases, cutoff]);
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
                        <Button className="w-full justify-start" variant="secondary" onClick={() => setConfirmCleanupOpen(true)} disabled={cleaning}>
                            <Eraser className="mr-2 h-4 w-4" />
                            {cleaning ? 'Limpando...' : 'Limpar dados da aplicação'}
                        </Button>
                        <Button className="w-full justify-start" variant="outline" onClick={() => setConfirmCleanupStorageOpen(true)} disabled={cleaningStorage}>
                            <Trash className="mr-2 h-4 w-4" />
                            {cleaningStorage ? 'Limpando arquivos...' : 'Limpar apenas arquivos'}
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

            <AlertDialog open={confirmCleanupOpen} onOpenChange={setConfirmCleanupOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Confirmar limpeza completa</AlertDialogTitle>
                        <AlertDialogDescription>
                            Essa ação remove uploads, ingests, exports, conciliações e todos os registros de bases. Deseja continuar?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={cleaning} onClick={() => setConfirmCleanupOpen(false)}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction disabled={cleaning} onClick={() => { setConfirmCleanupOpen(false); executeCleanup(); }}>Confirmar</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={confirmCleanupStorageOpen} onOpenChange={setConfirmCleanupStorageOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Confirmar limpeza de arquivos</AlertDialogTitle>
                        <AlertDialogDescription>
                            Essa ação remove apenas arquivos (uploads, ingests, exports). Nenhum dado do banco será alterado. Deseja continuar?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={cleaningStorage} onClick={() => setConfirmCleanupStorageOpen(false)}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction disabled={cleaningStorage} onClick={() => { setConfirmCleanupStorageOpen(false); executeCleanupStorage(); }}>Confirmar</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default Dashboard;