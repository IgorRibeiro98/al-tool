import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FC } from "react";
import PageSkeletonWrapper from "@/components/PageSkeletonWrapper";
import {
    fetchConfigsConciliacao,
    deleteConfigConciliacao,
} from "@/services/configsService";
import { fetchBases } from "@/services/baseService";
import { toast } from "sonner";
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogAction,
    AlertDialogCancel,
} from "@/components/ui/alert-dialog";

const SCOPE = "ConfigConciliacao";
const MSG_LOAD_FAILED = "Falha ao carregar configurações";
const MSG_UPDATED = "Configuração atualizada";
const MSG_REMOVED = "Configuração removida";

type ConciliacaoConfig = {
    id: number;
    nome?: string | null;
    base_contabil_id?: number | null;
    base_fiscal_id?: number | null;
    inverter_sinal_fiscal?: boolean;
    limite_diferenca_imaterial?: string | number | null;
    chaves_contabil?: Record<string, unknown> | string[] | null;
    chaves_fiscal?: Record<string, unknown> | string[] | null;
};

type BaseItem = { id: number; nome?: string | null };

const buildBasesMap = (bases: BaseItem[]) =>
    bases.reduce<Record<number, string>>((acc, b) => {
        if (b?.id != null) acc[b.id] = b.nome ?? String(b.id);
        return acc;
    }, {});

const renderKeyBadges = (keys?: Record<string, unknown> | string[] | null) => {
    if (!keys) return null;
    if (Array.isArray(keys)) {
        return keys.map((k) => (
            <Badge key={String(k)} variant="outline" className="font-mono text-xs">
                {String(k)}
            </Badge>
        ));
    }
    return Object.keys(keys).map((k) => (
        <Badge key={k} variant="outline" className="font-mono text-xs">
            {k}
        </Badge>
    ));
};

const ConfigCard: FC<{
    config: ConciliacaoConfig;
    baseLabelMap: Record<number, string>;
    onEdit: (id: number) => void;
    onRequestDelete: (id: number) => void;
}> = ({ config, baseLabelMap, onEdit, onRequestDelete }) => {
    const contabilLabel = config.base_contabil_id ? baseLabelMap[Number(config.base_contabil_id)] : String(config.base_contabil_id ?? "-");
    const fiscalLabel = config.base_fiscal_id ? baseLabelMap[Number(config.base_fiscal_id)] : String(config.base_fiscal_id ?? "-");

    return (
        <div className="p-4 rounded-lg border hover:bg-muted/50 transition-colors">
            <div className="flex items-start justify-between mb-3">
                <div>
                    <p className="font-medium text-lg">{config.nome}</p>
                    <div className="flex gap-2 mt-2">
                        {!!config.inverter_sinal_fiscal && <Badge variant="secondary">Inverter Sinal</Badge>}
                        <Badge variant="outline">Dif. Imaterial: {config.limite_diferenca_imaterial ?? "-"}</Badge>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => onEdit(config.id)}>
                        <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onRequestDelete(config.id)}>
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4 text-sm">
                <div>
                    <p className="text-muted-foreground mb-1">Base Contábil</p>
                    <p className="font-medium">{contabilLabel}</p>
                    <p className="text-muted-foreground mt-2 mb-1">Chaves Contábeis</p>
                    <div className="flex gap-1 flex-wrap">{renderKeyBadges(config.chaves_contabil)}</div>
                </div>

                <div>
                    <p className="text-muted-foreground mb-1">Base Fiscal</p>
                    <p className="font-medium">{fiscalLabel}</p>
                    <p className="text-muted-foreground mt-2 mb-1">Chaves Fiscais</p>
                    <div className="flex gap-1 flex-wrap">{renderKeyBadges(config.chaves_fiscal)}</div>
                </div>
            </div>
        </div>
    );
};

const ConfigConciliacao: FC = () => {
    const navigate = useNavigate();

    const [configs, setConfigs] = useState<ConciliacaoConfig[]>([]);
    const [basesMap, setBasesMap] = useState<Record<number, string>>({});
    const [loading, setLoading] = useState(true);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

    const loadAll = useCallback(async () => {
        setLoading(true);
        try {
            const [cfgResp, basesResp] = await Promise.all([fetchConfigsConciliacao(), fetchBases()]);
            const cfgs: ConciliacaoConfig[] = cfgResp.data ?? [];
            setConfigs(cfgs);
            const bases: BaseItem[] = basesResp.data?.data ?? [];
            setBasesMap(buildBasesMap(bases));
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`${SCOPE} - failed to load configuracoes`, err);
            toast.error(MSG_LOAD_FAILED);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadAll();
    }, [loadAll]);

    const handleDelete = useCallback(async (id: number | null) => {
        if (id == null) return;
        try {
            await deleteConfigConciliacao(id);
            setConfigs((cur) => cur.filter((c) => c.id !== id));
            toast.success(MSG_REMOVED);
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`${SCOPE} - delete failed`, err);
            toast.error('Falha ao remover configuração');
        } finally {
            setDeleteDialogOpen(false);
            setPendingDeleteId(null);
        }
    }, []);

    const requestDelete = useCallback((id: number) => {
        setPendingDeleteId(id);
        setDeleteDialogOpen(true);
    }, []);

    const handleEdit = useCallback((id: number) => navigate(`/configs/conciliacao/${id}`), [navigate]);

    const visibleList = useMemo(() => configs || [], [configs]);

    return (
        <PageSkeletonWrapper loading={loading}>
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
                                visibleList.map((config) => (
                                    <ConfigCard
                                        key={config.id}
                                        config={config}
                                        baseLabelMap={basesMap}
                                        onEdit={handleEdit}
                                        onRequestDelete={requestDelete}
                                    />
                                ))
                            )}
                        </div>
                    </CardContent>
                </Card>

                <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Confirmação de Exclusão</AlertDialogTitle>
                            <AlertDialogDescription>
                                Deseja realmente deletar esta configuração? Esta ação não pode ser desfeita.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel
                                onClick={() => {
                                    setDeleteDialogOpen(false);
                                    setPendingDeleteId(null);
                                }}
                            >
                                Cancelar
                            </AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(pendingDeleteId)}>Excluir</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </PageSkeletonWrapper>
    );
};

export default ConfigConciliacao;
