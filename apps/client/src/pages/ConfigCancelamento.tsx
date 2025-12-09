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
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import type { FC } from "react";
import PageSkeletonWrapper from "@/components/PageSkeletonWrapper";
import {
    fetchConfigsCancelamento,
    updateConfigCancelamento,
    deleteConfigCancelamento,
} from "@/services/configsService";
import { fetchBases, getBaseColumns } from "@/services/baseService";
import { toast } from "sonner";

const SCOPE = "ConfigCancelamento";
const MSG_FAILED_LOAD = "Falha ao carregar configurações";
const MSG_UPDATED = "Configuração atualizada";
const MSG_REMOVED = "Configuração removida";

type CancelamentoConfig = {
    id: number;
    nome?: string | null;
    base_id?: number | null;
    coluna?: string | null;
    coluna_indicador?: string | null;
    valor_cancelado?: string | null;
    valorCancelado?: string | null;
    valor_nao_cancelado?: string | null;
    valorNaoCancelado?: string | null;
    ativa?: boolean;
    created_at?: string | null;
    updated_at?: string | null;
};

type BaseItem = { id: number; nome?: string | null };

type ColumnsMap = Record<string, string>;

const formatColumnDisplay = (columnsByBase: Record<number, ColumnsMap>, baseId?: number | null, sqliteName?: string) => {
    if (!sqliteName) return "-";
    const map = columnsByBase[Number(baseId)] || {};
    return map[sqliteName] ?? sqliteName;
};

const buildBasesMap = (bases: BaseItem[]) => {
    return bases.reduce<Record<number, string>>((acc, b) => {
        if (b?.id != null) acc[b.id] = b.nome ?? String(b.id);
        return acc;
    }, {});
};

const fetchColumnsForBaseIds = async (ids: number[]) => {
    const results: Record<number, ColumnsMap> = {};
    await Promise.all(
        ids.map(async (id) => {
            try {
                const res = await getBaseColumns(id);
                const rows: any[] = res.data?.data ?? [];
                results[id] = rows.reduce<ColumnsMap>((acc, r: any) => {
                    if (r?.sqlite_name) acc[r.sqlite_name] = r.excel_name ?? r.sqlite_name;
                    return acc;
                }, {} as ColumnsMap);
            } catch (err) {
                // don't fail the whole flow for one base
                // log with scope prefix
                // eslint-disable-next-line no-console
                console.error(`${SCOPE} - failed to fetch columns for base ${id}`, err);
                results[id] = {};
            }
        })
    );
    return results;
};

const ConfigRow: FC<{
    config: CancelamentoConfig;
    baseLabel?: string;
    columnsByBase: Record<number, ColumnsMap>;
    onToggleActive: (c: CancelamentoConfig) => void;
    onEdit: (id: number) => void;
    onRequestDelete: (id: number) => void;
}> = ({ config, baseLabel, columnsByBase, onToggleActive, onEdit, onRequestDelete }) => {
    const displayColumn = formatColumnDisplay(columnsByBase, config.base_id, config.coluna_indicador ?? config.coluna);
    const cancelledValue = config.valor_cancelado ?? config.valorCancelado ?? "-";
    const notCancelledValue = config.valor_nao_cancelado ?? config.valorNaoCancelado ?? "-";

    return (
        <div className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50 transition-colors">
            <div className="flex-1 space-y-1">
                <p className="font-medium">{config.nome}</p>
                <div className="flex gap-4 text-sm text-muted-foreground">
                    <span>
                        Coluna: <span className="font-mono">{displayColumn}</span>
                    </span>
                    <span>
                        Cancelado: <span className="font-mono">{cancelledValue}</span>
                    </span>
                    <span>
                        Não Cancelado: <span className="font-mono">{notCancelledValue}</span>
                    </span>
                </div>
                <p className="text-sm text-muted-foreground">{baseLabel ?? String(config.base_id ?? "-")}</p>
            </div>

            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                    <Switch checked={!!config.ativa} onCheckedChange={() => onToggleActive(config)} />
                    <span className="text-sm">{config.ativa ? "Ativa" : "Inativa"}</span>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => onEdit(config.id)}>
                        <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onRequestDelete(config.id)}>
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
};

const ConfigCancelamento: FC = () => {
    const navigate = useNavigate();

    const [configs, setConfigs] = useState<CancelamentoConfig[]>([]);
    const [basesMap, setBasesMap] = useState<Record<number, string>>({});
    const [columnsByBase, setColumnsByBase] = useState<Record<number, ColumnsMap>>({});
    const [loading, setLoading] = useState(true);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

    const loadAll = useCallback(async () => {
        setLoading(true);
        try {
            const [cfgResp, basesResp] = await Promise.all([fetchConfigsCancelamento(), fetchBases()]);
            const cfgs: CancelamentoConfig[] = cfgResp.data ?? [];
            setConfigs(cfgs);

            const bases: BaseItem[] = basesResp.data?.data ?? [];
            setBasesMap(buildBasesMap(bases));

            const uniqueBaseIds = Array.from(new Set(cfgs.map((c) => Number(c.base_id)).filter(Boolean))) as number[];
            if (uniqueBaseIds.length > 0) {
                const cols = await fetchColumnsForBaseIds(uniqueBaseIds);
                setColumnsByBase(cols);
            }
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`${SCOPE} - failed to load data`, err);
            toast.error(MSG_FAILED_LOAD);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadAll();
    }, [loadAll]);

    const toggleActive = useCallback(async (cfg: CancelamentoConfig) => {
        const id = cfg.id;
        // optimistic update
        setConfigs((cur) => cur.map((c) => (c.id === id ? { ...c, ativa: !c.ativa } : c)));
        try {
            await updateConfigCancelamento(id, { ...cfg, ativa: !cfg.ativa });
            toast.success(MSG_UPDATED);
        } catch (err) {
            // rollback
            setConfigs((cur) => cur.map((c) => (c.id === id ? { ...c, ativa: !!cfg.ativa } : c)));
            // eslint-disable-next-line no-console
            console.error(`${SCOPE} - toggle failed`, err);
            toast.error('Falha ao atualizar configuração');
        }
    }, []);

    const requestDelete = useCallback((id: number) => {
        setPendingDeleteId(id);
        setDeleteDialogOpen(true);
    }, []);

    const confirmDelete = useCallback(async () => {
        const id = pendingDeleteId;
        if (id == null) return;
        try {
            await deleteConfigCancelamento(id);
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
    }, [pendingDeleteId]);

    const handleEdit = useCallback((id: number) => navigate(`/configs/cancelamento/${id}`), [navigate]);

    return (
        <PageSkeletonWrapper loading={loading}>
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
                                    <ConfigRow
                                        key={config.id}
                                        config={config}
                                        baseLabel={config.base_id ? basesMap[Number(config.base_id)] : undefined}
                                        columnsByBase={columnsByBase}
                                        onToggleActive={toggleActive}
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
                            <AlertDialogAction onClick={confirmDelete}>Excluir</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </PageSkeletonWrapper>
    );
};

export default ConfigCancelamento;