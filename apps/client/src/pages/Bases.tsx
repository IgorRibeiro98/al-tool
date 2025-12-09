import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Upload, Eye, Trash } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FC } from 'react';
import PageSkeletonWrapper from '@/components/PageSkeletonWrapper';
import { fetchBases, ingestBase, deleteBase } from '@/services/baseService';
import { toast } from 'sonner';
import { StatusChip } from '@/components/StatusChip';
import { getConversionStatusMeta, getIngestStatusMeta, isConversionStatusActive, isIngestStatusActive } from '@/lib/baseStatus';
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

const POLL_INTERVAL_MS = 5000;
const TRUNCATE_LENGTH = 160;

const truncate = (value?: string | null, maxLength = TRUNCATE_LENGTH): string | null => {
    if (!value) return null;
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
};

function formatDate(date?: string | null): string {
    if (!date) return '-';
    try {
        return new Date(date).toLocaleDateString('pt-BR');
    } catch {
        return '-';
    }
}

const Bases = () => {
    const navigate = useNavigate();
    const [bases, setBases] = useState<Base[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [ingesting, setIngesting] = useState<Record<number, boolean>>({});
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
    const [autoIngestEnabled, setAutoIngestEnabled] = useState<boolean>(() => {
        if (typeof window === 'undefined') return true;
        const stored = window.localStorage.getItem('autoIngestEnabled');
        if (stored === 'false') return false;
        return true;
    });
    const statusSnapshotRef = useRef<Record<number, { conversion: string | null; ingest: JobStatus | null }>>({});
    const snapshotBootstrappedRef = useRef(false);
    const autoIngestTriggeredRef = useRef<Record<number, boolean>>({});
    const autoIngestDisabledByErrorRef = useRef(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem('autoIngestEnabled', String(autoIngestEnabled));
    }, [autoIngestEnabled]);

    const applyStatusFeedback = useCallback((list: Base[], notify: boolean) => {
        const snapshot = statusSnapshotRef.current;
        list.forEach((base) => {
            const prev = snapshot[base.id] || { conversion: null, ingest: null };
            const nextConversion = base.conversion_status ?? null;
            const nextIngest = base.ingest_status ?? (base.tabela_sqlite ? 'DONE' : null);
            const baseLabel = base.nome || `Base #${base.id}`;

            if (notify && prev.conversion !== nextConversion) {
                if (nextConversion === 'READY') {
                    toast.success(`${baseLabel} convertida com sucesso`);
                } else if (nextConversion === 'RUNNING' || nextConversion === 'PROCESSING') {
                    toast.info(`Conversão da ${baseLabel} iniciada`);
                } else if (nextConversion === 'FAILED') {
                    toast.error(`Falha na conversão da ${baseLabel}`, { description: base.conversion_error || undefined });
                }
            }

            if (notify && prev.ingest !== nextIngest) {
                if (nextIngest === 'PENDING') {
                    toast.info(`Ingestão da ${baseLabel} entrou na fila`);
                } else if (nextIngest === 'RUNNING') {
                    toast.info(`Ingestão da ${baseLabel} em andamento`);
                } else if (nextIngest === 'DONE') {
                    toast.success(`Ingestão da ${baseLabel} concluída`);
                } else if (nextIngest === 'FAILED') {
                    toast.error(`Falha na ingestão da ${baseLabel}`, { description: base.ingest_job?.erro || undefined });
                }
            }

            snapshot[base.id] = { conversion: nextConversion, ingest: nextIngest };
        });
        statusSnapshotRef.current = snapshot;
    }, []);

    const loadBases = useCallback(async (options?: { silent?: boolean; notify?: boolean }) => {
        const { silent = false, notify } = options || {};
        if (!silent) setLoading(true);
        try {
            const res = await fetchBases();
            const list = res.data?.data || res.data || [];
            setBases(list);
            const shouldNotify = notify ?? snapshotBootstrappedRef.current;
            applyStatusFeedback(list, shouldNotify);
            if (!snapshotBootstrappedRef.current) snapshotBootstrappedRef.current = true;
        } catch (err) {
            console.error('Failed to fetch bases', err);
            toast.error('Falha ao carregar bases');
        } finally {
            if (!silent) setLoading(false);
        }
    }, [applyStatusFeedback]);

        useEffect(() => {
            loadBases({ notify: false });
        }, [loadBases]);

    const hasActiveProcesses = useMemo(() => (
        bases.some((base) => isConversionStatusActive(base.conversion_status) || isIngestStatusActive(base))
    ), [bases]);

        useEffect(() => {
            if (!hasActiveProcesses) return;
            const interval = window.setInterval(() => {
                loadBases({ silent: true, notify: true });
            }, POLL_INTERVAL_MS);
            return () => window.clearInterval(interval);
        }, [hasActiveProcesses, loadBases]);

        const handleIngest = useCallback(
            async (id: number, options?: { auto?: boolean }) => {
                setIngesting((prev) => ({ ...prev, [id]: true }));
                try {
                    await ingestBase(id);
                    toast.info(
                        options?.auto
                            ? 'Ingestão automática iniciada. Status atualizado automaticamente.'
                            : 'Ingestão enviada para processamento. Status atualizado automaticamente.'
                    );
                    await loadBases({ silent: true, notify: true });
                } catch (e) {
                    console.error('Ingest failed', e);
                    toast.error('Falha ao iniciar ingestão');
                    if (options?.auto && !autoIngestDisabledByErrorRef.current) {
                        autoIngestDisabledByErrorRef.current = true;
                        setAutoIngestEnabled(false);
                        toast.error('Ingestão automática desativada após falha. Habilite novamente se desejar continuar.');
                    }
                } finally {
                    setIngesting((prev) => ({ ...prev, [id]: false }));
                }
            },
            [loadBases]
        );

        useEffect(() => {
            if (!autoIngestEnabled) return;
            bases.forEach((base) => {
                const readyForIngest = base.conversion_status === 'READY' && !base.tabela_sqlite && !isIngestStatusActive(base);
                if (readyForIngest && !autoIngestTriggeredRef.current[base.id]) {
                    autoIngestTriggeredRef.current[base.id] = true;
                    handleIngest(base.id, { auto: true });
                } else if (!readyForIngest) {
                    autoIngestTriggeredRef.current[base.id] = false;
                }
            });
        }, [bases, autoIngestEnabled, handleIngest]);

        const confirmDelete = useCallback((id: number) => {
            setPendingDeleteId(id);
            setDeleteDialogOpen(true);
        }, []);

        const handleDelete = useCallback(async (id: number | null) => {
            if (id === null) return;
            try {
                await deleteBase(id);
                toast.success('Base removida');
                await loadBases({ silent: true });
            } catch (e: any) {
                console.error('Delete failed', e);
                toast.error('Falha ao deletar base');
            } finally {
                setDeleteDialogOpen(false);
                setPendingDeleteId(null);
            }
        }, [loadBases]);

        type BaseRowProps = {
            base: Base;
            ingestHandler: (id: number, options?: { auto?: boolean }) => Promise<void>;
            ingestState?: boolean;
            onDeleteConfirm: (id: number) => void;
            navigate: (to: string) => void;
        };

        const BaseRow: FC<BaseRowProps> = ({ base, ingestHandler, ingestState, onDeleteConfirm, navigate }) => {
            const conversionMeta = getConversionStatusMeta(base.conversion_status);
            const ingestMeta = getIngestStatusMeta(base);
            const conversionError = base.conversion_status === 'FAILED' ? truncate(base.conversion_error) : null;
            const ingestError = base.ingest_status === 'FAILED' ? truncate(base.ingest_job?.erro) : null;
            const canIngest = !base.tabela_sqlite && base.conversion_status === 'READY' && !isIngestStatusActive(base);
            const disableActions = isConversionStatusActive(base.conversion_status) || isIngestStatusActive(base);

            return (
                <div
                    key={base.id}
                    className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between p-4 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                    <div className="flex items-center gap-4 flex-1">
                        <Badge variant={base.tipo === 'CONTABIL' ? 'default' : 'secondary'}>{base.tipo}</Badge>
                        <div>
                            <p className="font-medium">{base.nome || `Base ${base.id}`}</p>
                            <p className="text-sm text-muted-foreground">Período: {base.periodo || '-'}</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-start gap-6">
                        <div className="min-w-[180px] space-y-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Conversão</p>
                            <StatusChip status={conversionMeta.chip} label={conversionMeta.label} />
                            {conversionError && <p className="text-xs text-destructive break-words">{conversionError}</p>}
                        </div>
                        <div className="min-w-[180px] space-y-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ingestão</p>
                            <StatusChip status={ingestMeta.chip} label={ingestMeta.label} />
                            {ingestError && <p className="text-xs text-destructive break-words">{ingestError}</p>}
                        </div>
                        <div className="flex flex-col gap-3 min-w-[200px]">
                            <span className="text-sm text-muted-foreground">Criada em {formatDate(base.created_at)}</span>
                            <div className="flex flex-wrap gap-2">
                                {canIngest && (
                                    <Button variant="outline" size="sm" onClick={() => ingestHandler(base.id)} disabled={!!ingestState}>
                                        <Upload className="mr-2 h-4 w-4" />
                                        {ingestState ? 'Ingerindo...' : 'Ingerir'}
                                    </Button>
                                )}
                                <Button variant="ghost" size="icon" onClick={() => navigate(`/bases/${base.id}`)} aria-label="Ver base" disabled={disableActions}>
                                    <Eye className="h-4 w-4" />
                                </Button>
                                <Button variant="destructive" size="icon" onClick={() => onDeleteConfirm(base.id)} aria-label="Deletar base" disabled={disableActions}>
                                    <Trash className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            );
        };

    return (
        <PageSkeletonWrapper loading={loading}>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold">Bases</h1>
                        <p className="text-muted-foreground">Gerencie as bases contábeis e fiscais</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <Switch id="auto-ingest-toggle" checked={autoIngestEnabled} onCheckedChange={setAutoIngestEnabled} />
                            <label htmlFor="auto-ingest-toggle" className="text-sm text-muted-foreground">Ingestão automática</label>
                        </div>
                        <Button onClick={() => navigate("/bases/new")}>
                            <Plus className="mr-2 h-4 w-4" />
                            Nova Base
                        </Button>
                    </div>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Bases Cadastradas</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                                                        {loading ? (
                              <div>Carregando...</div>
                            ) : (
                              bases.map((base) => {
                                return (
                                  <BaseRow
                                    key={base.id}
                                    base={base}
                                    ingestHandler={handleIngest}
                                    ingestState={ingesting[base.id]}
                                    onDeleteConfirm={confirmDelete}
                                    navigate={navigate}
                                  />
                                );
                              })
                            )}
                        </div>
                    </CardContent>
                </Card>
                <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Confirmação de Exclusão</AlertDialogTitle>
                            <AlertDialogDescription>Deseja realmente deletar esta base? Esta ação removerá tabela e arquivos e não pode ser desfeita.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel onClick={() => { setDeleteDialogOpen(false); setPendingDeleteId(null); }}>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(pendingDeleteId)}>Excluir</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </PageSkeletonWrapper>
    );
};

export default Bases;