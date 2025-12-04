import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Upload, Eye, Trash } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PageSkeletonWrapper from '@/components/PageSkeletonWrapper';
import { fetchBases, ingestBase, deleteBase } from '@/services/baseService';
import { toast } from 'sonner';
import { StatusChip } from '@/components/StatusChip';
import { getConversionStatusMeta, getIngestStatusMeta, isConversionStatusActive, isIngestStatusActive } from '@/lib/baseStatus';
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

const truncate = (value?: string | null, maxLength = 160) => {
    if (!value) return null;
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
};

const Bases = () => {
    const navigate = useNavigate();
    const [bases, setBases] = useState<Base[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [ingesting, setIngesting] = useState<Record<number, boolean>>({});
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
    const statusSnapshotRef = useRef<Record<number, { conversion: string | null; ingest: JobStatus | null }>>({});
    const snapshotBootstrappedRef = useRef(false);

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
        }, 5000);
        return () => window.clearInterval(interval);
    }, [hasActiveProcesses, loadBases]);

    const handleIngest = async (id: number) => {
        setIngesting(prev => ({ ...prev, [id]: true }));
        try {
            await ingestBase(id);
            toast.info('Ingestão enviada para processamento. Status atualizado automaticamente.');
            await loadBases({ silent: true, notify: true });
        } catch (e) {
            console.error('Ingest failed', e);
            toast.error('Falha ao iniciar ingestão');
        } finally {
            setIngesting(prev => ({ ...prev, [id]: false }));
        }
    }

    const confirmDelete = (id: number) => {
        setPendingDeleteId(id);
        setDeleteDialogOpen(true);
    };

    const handleDelete = async (id: number | null) => {
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
    }

    return (
        <PageSkeletonWrapper loading={loading}>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold">Bases</h1>
                        <p className="text-muted-foreground">Gerencie as bases contábeis e fiscais</p>
                    </div>
                    <Button onClick={() => navigate("/bases/new")}>
                        <Plus className="mr-2 h-4 w-4" />
                        Nova Base
                    </Button>
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
                                    const conversionMeta = getConversionStatusMeta(base.conversion_status);
                                    const ingestMeta = getIngestStatusMeta(base);
                                    const conversionError = base.conversion_status === 'FAILED' ? truncate(base.conversion_error) : null;
                                    const ingestError = base.ingest_status === 'FAILED' ? truncate(base.ingest_job?.erro) : null;
                                    const canIngest = !base.tabela_sqlite && base.conversion_status === 'READY' && !isIngestStatusActive(base);

                                    return (
                                        <div
                                            key={base.id}
                                            className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between p-4 rounded-lg border hover:bg-muted/50 transition-colors"
                                        >
                                            <div className="flex items-center gap-4 flex-1">
                                                <Badge variant={base.tipo === "CONTABIL" ? "default" : "secondary"}>
                                                    {base.tipo}
                                                </Badge>
                                                <div>
                                                    <p className="font-medium">{base.nome || `Base ${base.id}`}</p>
                                                    <p className="text-sm text-muted-foreground">Período: {base.periodo || '-'}</p>
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap items-start gap-6">
                                                <div className="min-w-[180px] space-y-1">
                                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Conversão</p>
                                                    <StatusChip status={conversionMeta.chip} label={conversionMeta.label} />
                                                    {conversionError && (
                                                        <p className="text-xs text-destructive break-words">{conversionError}</p>
                                                    )}
                                                </div>
                                                <div className="min-w-[180px] space-y-1">
                                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ingestão</p>
                                                    <StatusChip status={ingestMeta.chip} label={ingestMeta.label} />
                                                    {ingestError && (
                                                        <p className="text-xs text-destructive break-words">{ingestError}</p>
                                                    )}
                                                </div>
                                                <div className="flex flex-col gap-3 min-w-[200px]">
                                                    <span className="text-sm text-muted-foreground">Criada em {base.created_at ? new Date(base.created_at).toLocaleDateString('pt-BR') : '-'}</span>
                                                    <div className="flex flex-wrap gap-2">
                                                        {canIngest && (
                                                            <Button variant="outline" size="sm" onClick={() => handleIngest(base.id)} disabled={!!ingesting[base.id]}>
                                                                <Upload className="mr-2 h-4 w-4" />
                                                                {ingesting[base.id] ? 'Ingerindo...' : 'Ingerir'}
                                                            </Button>
                                                        )}
                                                        <Button variant="ghost" size="icon" onClick={() => navigate(`/bases/${base.id}`)} aria-label="Ver base">
                                                            <Eye className="h-4 w-4" />
                                                        </Button>
                                                        <Button variant="destructive" size="icon" onClick={() => confirmDelete(base.id)} aria-label="Deletar base">
                                                            <Trash className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
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