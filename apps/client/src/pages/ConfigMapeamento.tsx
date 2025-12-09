import { useCallback, useEffect, useState } from 'react';
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
import type { FC } from 'react';

const SCOPE = 'ConfigMapeamento';
const MSG_LOAD_FAILED = 'Falha ao carregar configurações de mapeamento';
const MSG_REMOVED = 'Configuração removida';

type MappingPair = { coluna_contabil: string; coluna_fiscal: string };
type ConfigMapeamento = {
    id: number;
    nome?: string | null;
    base_contabil_id?: number | null;
    base_fiscal_id?: number | null;
    mapeamentos?: MappingPair[] | null;
};

type Base = { id: number; nome?: string | null };

type ColumnsMap = Record<string, string>;

const buildBasesMap = (bases: Base[]) =>
    bases.reduce<Record<number, string>>((acc, b) => {
        if (b?.id != null) acc[b.id] = b.nome ?? `Base ${b.id}`;
        return acc;
    }, {});

const MapRow: FC<{
    config: ConfigMapeamento;
    baseLabels: Record<number, string>;
    onEdit: (id: number) => void;
    onRequestDelete: (id: number) => void;
}> = ({ config, baseLabels, onEdit, onRequestDelete }) => {
    const mappedCount = config.mapeamentos?.length ?? 0;
    const preview = (config.mapeamentos ?? []).slice(0, 4);

    return (
        <div className="p-4 rounded-lg border hover:bg-muted/50 transition-colors">
            <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <Link2 className="h-4 w-4 text-muted-foreground" />
                        <p className="font-semibold text-lg">{config.nome}</p>
                    </div>
                    <div className="text-sm text-muted-foreground">
                        <span>Base Contábil: {baseLabels[Number(config.base_contabil_id)] ?? `#${config.base_contabil_id}`}</span>
                        <span className="mx-2">•</span>
                        <span>Base Fiscal: {baseLabels[Number(config.base_fiscal_id)] ?? `#${config.base_fiscal_id}`}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary">{mappedCount} colunas mapeadas</Badge>
                    </div>
                    {mappedCount > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                            {preview.map((pair) => (
                                <Badge key={`${pair.coluna_contabil}-${pair.coluna_fiscal}`} variant="outline" className="font-mono text-xs">
                                    {pair.coluna_contabil} → {pair.coluna_fiscal}
                                </Badge>
                            ))}
                            {mappedCount > preview.length && <Badge variant="outline">+{mappedCount - preview.length}</Badge>}
                        </div>
                    )}
                </div>

                <div className="flex gap-2">
                    <Button variant="ghost" size="icon" onClick={() => onEdit(config.id)} aria-label="Editar">
                        <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => onRequestDelete(config.id)} aria-label="Excluir">
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
};

const ConfigMapeamento: FC = () => {
    const navigate = useNavigate();

    const [configs, setConfigs] = useState<ConfigMapeamento[]>([]);
    const [basesMap, setBasesMap] = useState<Record<number, string>>({});
    const [loading, setLoading] = useState(true);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

    const loadAll = useCallback(async () => {
        setLoading(true);
        try {
            const [cfgResp, basesResp] = await Promise.all([fetchConfigsMapeamento(), fetchBases()]);
            const cfgs: ConfigMapeamento[] = cfgResp.data ?? [];
            setConfigs(cfgs);
            const bases: Base[] = basesResp.data?.data ?? basesResp.data ?? [];
            setBasesMap(buildBasesMap(bases));
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`${SCOPE} - failed to load mapping configs`, err);
            toast.error(MSG_LOAD_FAILED);
            setConfigs([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadAll();
    }, [loadAll]);

    const requestDelete = useCallback((id: number) => {
        setPendingDeleteId(id);
        setDeleteDialogOpen(true);
    }, []);

    const confirmDelete = useCallback(async () => {
        const id = pendingDeleteId;
        if (id == null) return;
        try {
            await deleteConfigMapeamento(id);
            setConfigs((prev) => prev.filter((cfg) => cfg.id !== id));
            toast.success(MSG_REMOVED);
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`${SCOPE} - failed to delete mapping config`, err);
            toast.error('Falha ao excluir configuração');
        } finally {
            setDeleteDialogOpen(false);
            setPendingDeleteId(null);
        }
    }, [pendingDeleteId]);

    const handleEdit = useCallback((id: number) => navigate(`/configs/mapeamento/${id}`), [navigate]);

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
                                    <MapRow key={config.id} config={config} baseLabels={basesMap} onEdit={handleEdit} onRequestDelete={requestDelete} />
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

export default ConfigMapeamento;
