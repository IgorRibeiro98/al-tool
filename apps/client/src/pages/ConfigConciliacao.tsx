import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from 'react';
import { fetchConfigsConciliacao, updateConfigConciliacao, deleteConfigConciliacao } from '@/services/configsService';
import { fetchBases } from '@/services/baseService';
import { toast } from 'sonner';
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

const ConfigConciliacao = () => {
    const navigate = useNavigate();

    const [configs, setConfigs] = useState<any[]>([]);
    const [basesMap, setBasesMap] = useState<Record<number, string>>({});
    const [loading, setLoading] = useState<boolean>(true);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

    useEffect(() => {
        let mounted = true;
        setLoading(true);
        Promise.all([fetchConfigsConciliacao(), fetchBases()])
            .then(([cfgResp, basesResp]) => {
                if (!mounted) return;
                const cfgs = cfgResp.data || [];
                setConfigs(cfgs);
                const bases = basesResp.data.data || [];
                const map: Record<number, string> = {};
                bases.forEach((b: any) => { if (b.id) map[b.id] = b.nome ?? String(b.id); });
                setBasesMap(map);
            })
            .catch((err) => {
                console.error('failed to load conciliacao configs', err);
                toast.error('Falha ao carregar configurações');
            })
            .finally(() => { if (mounted) setLoading(false); });

        return () => { mounted = false; };
    }, []);

    const toggleActive = async (cfg: any) => {
        const id = cfg.id;
        try {
            const updated = { ...cfg };
            // no direct ativa field for conciliacao in schema, skip toggle unless exists
            if (updated.ativa === undefined) return;
            updated.ativa = !updated.ativa;
            await updateConfigConciliacao(id, updated);
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
            await deleteConfigConciliacao(id);
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
                    <h1 className="text-3xl font-bold">Configuração de Conciliação</h1>
                    <p className="text-muted-foreground">Gerencie as configurações de conciliação</p>
                </div>
                <Button onClick={() => navigate("/configs/conciliacao/new")}>
                    <Plus className="mr-2 h-4 w-4" />
                    Nova Configuração
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Configurações Cadastradas</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {loading ? (
                            <div className="text-sm text-muted-foreground">Carregando...</div>
                        ) : (
                            configs.map((config) => (
                                <div
                                    key={config.id}
                                    className="p-4 rounded-lg border hover:bg-muted/50 transition-colors"
                                >
                                    <div className="flex items-start justify-between mb-3">
                                        <div>
                                            <p className="font-medium text-lg">{config.nome}</p>
                                            <div className="flex gap-2 mt-2">
                                                {config.inverter_sinal_fiscal && <Badge variant="secondary">Inverter Sinal</Badge>}
                                                <Badge variant="outline">Dif. Imaterial: {config.limite_diferenca_imaterial ?? '-'}</Badge>
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <Button variant="ghost" size="sm" onClick={() => navigate(`/configs/conciliacao/${config.id}`)}>
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="sm" onClick={() => confirmDelete(config.id)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="grid md:grid-cols-2 gap-4 text-sm">
                                        <div>
                                            <p className="text-muted-foreground mb-1">Base Contábil</p>
                                            <p className="font-medium">{basesMap[config.base_contabil_id] ?? String(config.base_contabil_id ?? '-')}</p>
                                            <p className="text-muted-foreground mt-2 mb-1">Chaves Contábeis</p>
                                            <div className="flex gap-1 flex-wrap">
                                                {(config.chaves_contabil || []).map((chave: string) => (
                                                    <Badge key={chave} variant="outline" className="font-mono text-xs">
                                                        {chave}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </div>

                                        <div>
                                            <p className="text-muted-foreground mb-1">Base Fiscal</p>
                                            <p className="font-medium">{basesMap[config.base_fiscal_id] ?? String(config.base_fiscal_id ?? '-')}</p>
                                            <p className="text-muted-foreground mt-2 mb-1">Chaves Fiscais</p>
                                            <div className="flex gap-1 flex-wrap">
                                                {(config.chaves_fiscal || []).map((chave: string) => (
                                                    <Badge key={chave} variant="outline" className="font-mono text-xs">
                                                        {chave}
                                                    </Badge>
                                                ))}
                                            </div>
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

export default ConfigConciliacao;
