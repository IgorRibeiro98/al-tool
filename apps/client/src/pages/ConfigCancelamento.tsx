import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
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
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from 'react';
import { fetchConfigsCancelamento, updateConfigCancelamento, deleteConfigCancelamento } from '@/services/configsService';
import { fetchBases } from '@/services/baseService';
import { toast } from 'sonner';



const ConfigCancelamento = () => {
    const navigate = useNavigate();

    const [configs, setConfigs] = useState<any[]>([]);
    const [basesMap, setBasesMap] = useState<Record<number, string>>({});
    const [loading, setLoading] = useState<boolean>(true);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

    useEffect(() => {
        let mounted = true;
        setLoading(true);
        Promise.all([fetchConfigsCancelamento(), fetchBases()])
            .then(([cfgResp, basesResp]) => {
                if (!mounted) return;
                const cfgs = cfgResp.data || [];
                setConfigs(cfgs);
                const bases = basesResp.data || [];
                const map: Record<number, string> = {};
                bases.forEach((b: any) => { if (b.id) map[b.id] = b.nome ?? String(b.id); });
                setBasesMap(map);
            })
            .catch((err) => {
                console.error('failed to load cancelamento configs', err);
                toast.error('Falha ao carregar configurações');
            })
            .finally(() => { if (mounted) setLoading(false); });

        return () => { mounted = false; };
    }, []);

    const toggleActive = async (cfg: any) => {
        const id = cfg.id;
        try {
            const updated = { ...cfg, ativa: !cfg.ativa };
            await updateConfigCancelamento(id, updated);
            setConfigs((cur) => cur.map(c => c.id === id ? { ...c, ativa: !c.ativa } : c));
            toast.success('Configuração atualizada');
        } catch (err) {
            console.error('toggle failed', err);
            toast.error('Falha ao atualizar configuração');
        }
    };

    const confirmDelete = (id: number) => {
        setPendingDeleteId(id);
        setDeleteDialogOpen(true);
    };

    const handleDelete = async (id: number | null) => {
        if (id === null) return;
        try {
            await deleteConfigCancelamento(id);
            setConfigs((cur) => cur.filter(c => c.id !== id));
            toast.success('Configuração removida');
        } catch (err) {
            console.error('delete failed', err);
            toast.error('Falha ao remover configuração');
        } finally {
            setDeleteDialogOpen(false);
            setPendingDeleteId(null);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">Configuração de Cancelamento</h1>
                    <p className="text-muted-foreground">Gerencie as regras de identificação de cancelamento</p>
                </div>
                <Button onClick={() => navigate("/configs/cancelamento/new")}>
                    <Plus className="mr-2 h-4 w-4" />
                    Nova Configuração
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Configurações Cadastradas</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-2">
                        {loading ? (
                            <div className="text-sm text-muted-foreground">Carregando...</div>
                        ) : (
                            configs.map((config) => (
                                <div
                                    key={config.id}
                                    className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50 transition-colors"
                                >
                                    <div className="flex-1 space-y-1">
                                        <p className="font-medium">{config.nome}</p>
                                        <div className="flex gap-4 text-sm text-muted-foreground">
                                            <span>Coluna: <span className="font-mono">{config.coluna_indicador ?? config.coluna}</span></span>
                                            <span>Cancelado: <span className="font-mono">{config.valor_cancelado ?? config.valorCancelado}</span></span>
                                            <span>Não Cancelado: <span className="font-mono">{config.valor_nao_cancelado ?? config.valorNaoCancelado}</span></span>
                                        </div>
                                        <p className="text-sm text-muted-foreground">{basesMap[config.base_id] ?? String(config.base_id ?? '-')}</p>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="flex items-center gap-2">
                                            <Switch checked={!!config.ativa} onCheckedChange={() => toggleActive(config)} />
                                            <span className="text-sm">{config.ativa ? "Ativa" : "Inativa"}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button variant="ghost" size="sm" onClick={() => navigate(`/configs/cancelamento/${config.id}`)}>
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="sm" onClick={() => confirmDelete(config.id)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </CardContent>
            </Card>

            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Confirmação de Exclusão</AlertDialogTitle>
                        <AlertDialogDescription>Deseja realmente deletar esta configuração? Esta ação não pode ser desfeita.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => { setDeleteDialogOpen(false); setPendingDeleteId(null); }}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(pendingDeleteId)}>Excluir</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default ConfigCancelamento;