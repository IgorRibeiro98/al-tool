import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import PageSkeletonWrapper from '@/components/PageSkeletonWrapper';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { fetchBases } from '@/services/baseService';
import { fetchConfigsMapeamento, deleteConfigMapeamento } from '@/services/configsService';
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

const ConfigMapeamento = () => {
    const navigate = useNavigate();
    const [configs, setConfigs] = useState<ConfigMapeamento[]>([]);
    const [basesMap, setBasesMap] = useState<Record<number, string>>({});
    const [loading, setLoading] = useState(true);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

    useEffect(() => {
        let mounted = true;
        const loadData = async () => {
            setLoading(true);
            try {
                const [cfgResp, basesResp] = await Promise.all([fetchConfigsMapeamento(), fetchBases()]);
                if (!mounted) return;
                const cfgs = cfgResp.data || [];
                const bases = basesResp.data?.data || basesResp.data || [];
                setConfigs(cfgs as ConfigMapeamento[]);
                const names: Record<number, string> = {};
                (bases as Base[]).forEach((b) => { if (b.id) names[b.id] = b.nome ?? `Base ${b.id}`; });
                setBasesMap(names);
            } catch (err) {
                console.error('failed to load mapping configs', err);
                if (mounted) {
                    toast.error('Falha ao carregar configurações de mapeamento');
                    setConfigs([]);
                }
            } finally {
                if (mounted) setLoading(false);
            }
        };
        loadData();
        return () => { mounted = false; };
    }, []);

    const confirmDelete = (id: number) => {
        setPendingDeleteId(id);
        setDeleteDialogOpen(true);
    };

    const handleDelete = async () => {
        if (!pendingDeleteId) return;
        try {
            await deleteConfigMapeamento(pendingDeleteId);
            setConfigs((prev) => prev.filter((cfg) => cfg.id !== pendingDeleteId));
            toast.success('Configuração removida');
        } catch (err) {
            console.error('failed to delete mapping config', err);
            toast.error('Falha ao excluir configuração');
        } finally {
            setDeleteDialogOpen(false);
            setPendingDeleteId(null);
        }
    };

    return (
        <PageSkeletonWrapper loading={loading}>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold">Configurações de Mapeamento</h1>
                        <p className="text-muted-foreground">Gerencie os relacionamentos entre colunas contábeis e fiscais</p>
                    </div>
                    <Button onClick={() => navigate('/configs/mapeamento/new')}>
                        <Plus className="mr-2 h-4 w-4" />
                        Nova Configuração
                    </Button>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Configurações Cadastradas</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {configs.length === 0 ? (
                            <div className="text-sm text-muted-foreground">Nenhuma configuração cadastrada.</div>
                        ) : (
                            <div className="space-y-4">
                                {configs.map((config) => (
                                    <div key={config.id} className="p-4 rounded-lg border hover:bg-muted/50 transition-colors">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <Link2 className="h-4 w-4 text-muted-foreground" />
                                                    <p className="font-semibold text-lg">{config.nome}</p>
                                                </div>
                                                <div className="text-sm text-muted-foreground">
                                                    <span>Base Contábil: {basesMap[config.base_contabil_id] ?? `#${config.base_contabil_id}`}</span>
                                                    <span className="mx-2">•</span>
                                                    <span>Base Fiscal: {basesMap[config.base_fiscal_id] ?? `#${config.base_fiscal_id}`}</span>
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    <Badge variant="secondary">{config.mapeamentos?.length ?? 0} colunas mapeadas</Badge>
                                                </div>
                                                {config.mapeamentos && config.mapeamentos.length > 0 && (
                                                    <div className="flex flex-wrap gap-2 mt-2">
                                                        {config.mapeamentos.slice(0, 4).map((pair) => (
                                                            <Badge key={`${pair.coluna_contabil}-${pair.coluna_fiscal}`} variant="outline" className="font-mono text-xs">
                                                                {pair.coluna_contabil} → {pair.coluna_fiscal}
                                                            </Badge>
                                                        ))}
                                                        {config.mapeamentos.length > 4 && (
                                                            <Badge variant="outline">+{config.mapeamentos.length - 4}</Badge>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex gap-2">
                                                <Button variant="ghost" size="icon" onClick={() => navigate(`/configs/mapeamento/${config.id}`)} aria-label="Editar">
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                                <Button variant="ghost" size="icon" onClick={() => confirmDelete(config.id)} aria-label="Excluir">
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
                            <AlertDialogTitle>Excluir configuração?</AlertDialogTitle>
                            <AlertDialogDescription>Essa ação removerá o mapeamento selecionado e não poderá ser desfeita.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel onClick={() => { setDeleteDialogOpen(false); setPendingDeleteId(null); }}>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDelete}>Excluir</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </PageSkeletonWrapper>
    );
};

export default ConfigMapeamento;
