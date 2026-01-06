import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Upload, Eye, Trash, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FC } from 'react';
import PageSkeletonWrapper from '@/components/PageSkeletonWrapper';
import { fetchBases, ingestBase, deleteBase, getBaseColumns, createDerivedColumn, getDerivedColumnJobStatus } from '@/services/baseService';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
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
    const [addColsDialogOpen, setAddColsDialogOpen] = useState(false);
    const [dialogBaseId, setDialogBaseId] = useState<number | null>(null);
    const [dialogBaseColumns, setDialogBaseColumns] = useState<any[]>([]);
    const [dialogNewColsSelection, setDialogNewColsSelection] = useState<string[]>(['ABS']);
    const [dialogAbsSourceColumn, setDialogAbsSourceColumn] = useState<string | null>(null);
    const [dialogInverterSourceColumn, setDialogInverterSourceColumn] = useState<string | null>(null);
    const [dialogAbsTargetName, setDialogAbsTargetName] = useState<string>('');
    const [dialogInverterTargetName, setDialogInverterTargetName] = useState<string>('');
    const [dialogLoading, setDialogLoading] = useState(false);
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
                            <Button variant="ghost" size="icon" onClick={async () => {
                                // open add-columns dialog for this base
                                setDialogBaseId(base.id);
                                setAddColsDialogOpen(true);
                                setDialogNewColsSelection(['ABS']);
                                setDialogAbsSourceColumn(null);
                                setDialogInverterSourceColumn(null);
                                setDialogAbsTargetName('');
                                setDialogInverterTargetName('');
                                try {
                                    const resp = await getBaseColumns(base.id);
                                    setDialogBaseColumns(resp.data.data || []);
                                } catch (err) {
                                    console.error('Failed to load base columns for dialog', err);
                                    setDialogBaseColumns([]);
                                    toast.error('Falha ao carregar colunas da base');
                                }
                            }} aria-label="Adicionar colunas" disabled={disableActions}>
                                <Plus className="h-4 w-4" />
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

    const closeAddColsDialog = () => {
        setAddColsDialogOpen(false);
        setDialogBaseId(null);
        setDialogBaseColumns([]);
        setDialogNewColsSelection(['ABS']);
        setDialogAbsSourceColumn(null);
        setDialogInverterSourceColumn(null);
        setDialogAbsTargetName('');
        setDialogInverterTargetName('');
        setDialogLoading(false);
    };

    const handleCreateAbsColumnDialog = async () => {
        if (!dialogBaseId) return toast.error('Base inválida');
        if (!dialogAbsSourceColumn) return toast.error('Selecione a coluna de origem para ABS');
        try {
            setDialogLoading(true);
            const resp = await createDerivedColumn(dialogBaseId, dialogAbsSourceColumn as string, 'ABS');
            if (resp.data.background) {
                // Background job started - poll for completion
                toast.info(resp.data.message || 'Processamento iniciado em background');
                pollDerivedColumnJob(dialogBaseId, resp.data.jobId, 'ABS');
            } else {
                toast.success(`Coluna ${resp.data.column} criada (${resp.data.rowsUpdated} linhas atualizadas)`);
                await loadBases({ silent: true });
            }
        } catch (e: any) {
            console.error('create ABS failed (dialog)', e);
            toast.error(e?.message || 'Falha ao criar coluna ABS');
        } finally {
            setDialogLoading(false);
        }
    };

    const handleCreateInverterColumnDialog = async () => {
        if (!dialogBaseId) return toast.error('Base inválida');
        if (!dialogInverterSourceColumn) return toast.error('Selecione a coluna de origem para INVERTER');
        try {
            setDialogLoading(true);
            const resp = await createDerivedColumn(dialogBaseId, dialogInverterSourceColumn as string, 'INVERTER');
            if (resp.data.background) {
                // Background job started - poll for completion
                toast.info(resp.data.message || 'Processamento iniciado em background');
                pollDerivedColumnJob(dialogBaseId, resp.data.jobId, 'INVERTER');
            } else {
                toast.success(`Coluna ${resp.data.column} criada (${resp.data.rowsUpdated} linhas atualizadas)`);
                await loadBases({ silent: true });
            }
        } catch (e: any) {
            console.error('create INVERTER failed (dialog)', e);
            toast.error(e?.message || 'Falha ao criar coluna INVERTER');
        } finally {
            setDialogLoading(false);
        }
    };

    const pollDerivedColumnJob = async (baseId: number, jobId: number, op: string) => {
        const pollInterval = 2000;
        let lastProgress = 0;
        const poll = async () => {
            try {
                const resp = await getDerivedColumnJobStatus(baseId, jobId);
                const job = resp.data.job;
                if (job.status === 'DONE') {
                    toast.success(`Coluna ${op} criada com sucesso (${job.processed_rows} linhas)`);
                    await loadBases({ silent: true });
                    return;
                }
                if (job.status === 'FAILED') {
                    toast.error(`Falha ao criar coluna ${op}: ${job.error || 'Erro desconhecido'}`);
                    return;
                }
                // Still running - show progress if changed
                if (job.progress > lastProgress) {
                    lastProgress = job.progress;
                    toast.info(`${op}: ${job.progress}% concluído (${job.processed_rows}/${job.total_rows})`);
                }
                setTimeout(poll, pollInterval);
            } catch (e) {
                console.error('Error polling derived column job', e);
                setTimeout(poll, pollInterval * 2);
            }
        };
        poll();
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
                <AlertDialog open={addColsDialogOpen} onOpenChange={setAddColsDialogOpen}>
                    <AlertDialogContent className="min-w-[50%]">
                        <AlertDialogHeader>
                            <AlertDialogTitle className="flex items-center justify-between w-full">
                                <span className="mr-auto">
                                    Adicionar novas colunas
                                </span>
                                <AlertDialogCancel className="ml-auto" onClick={closeAddColsDialog}>
                                    <X />
                                </AlertDialogCancel>
                            </AlertDialogTitle>
                            <AlertDialogDescription>Adicione colunas derivadas (ABS / INVERTER) para a base selecionada.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <div className="p-4">
                            <div className="space-y-3">
                                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                                    <div className="col-span-12 md:col-span-2 flex items-center">
                                        <label className="flex items-center gap-2">
                                            <Checkbox checked={dialogNewColsSelection.includes('ABS')} onCheckedChange={(v) => {
                                                const checked = v === true;
                                                setDialogNewColsSelection((prev) => {
                                                    if (checked) return Array.from(new Set([...prev, 'ABS']));
                                                    return prev.filter(p => p !== 'ABS');
                                                });
                                            }} />
                                            <span className="text-sm">ABS</span>
                                        </label>
                                    </div>

                                    <div className="col-span-12 md:col-span-6">
                                        {Array.isArray(dialogBaseColumns) && dialogBaseColumns.length > 0 ? (
                                            <Select value={dialogAbsSourceColumn ?? undefined} onValueChange={(v) => setDialogAbsSourceColumn(!v || v === '__none' ? null : v)}>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Coluna origem (ABS)" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {dialogBaseColumns.map((c) => (
                                                        <SelectItem key={c.sqlite_name} value={c.sqlite_name}>{c.excel_name || c.sqlite_name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        ) : (
                                            <div className="text-xs text-muted-foreground">Carregue o preview para listar colunas</div>
                                        )}
                                    </div>

                                    <div className="col-span-12 md:col-span-2 flex items-center gap-2 justify-start">
                                        <Button onClick={handleCreateAbsColumnDialog} disabled={!dialogNewColsSelection.includes('ABS') || !dialogAbsSourceColumn || dialogLoading}>Criar coluna</Button>
                                        <Button variant="outline" onClick={() => { setDialogNewColsSelection((prev) => prev.filter(p => p !== 'ABS')); setDialogAbsSourceColumn(null); setDialogAbsTargetName(''); }}>Limpar</Button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center pt-4">
                                    <div className="col-span-12 md:col-span-2 flex items-center">
                                        <label className="flex items-center gap-2">
                                            <Checkbox checked={dialogNewColsSelection.includes('INVERTER')} onCheckedChange={(v) => {
                                                const checked = v === true;
                                                setDialogNewColsSelection((prev) => {
                                                    if (checked) return Array.from(new Set([...prev, 'INVERTER']));
                                                    return prev.filter(p => p !== 'INVERTER');
                                                });
                                            }} />
                                            <span className="text-sm">INVERTER</span>
                                        </label>
                                    </div>

                                    <div className="col-span-12 md:col-span-6">
                                        {Array.isArray(dialogBaseColumns) && dialogBaseColumns.length > 0 ? (
                                            <Select value={dialogInverterSourceColumn ?? undefined} onValueChange={(v) => setDialogInverterSourceColumn(!v || v === '__none' ? null : v)}>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Coluna origem (INVERTER)" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {dialogBaseColumns.map((c) => (
                                                        <SelectItem key={c.sqlite_name} value={c.sqlite_name}>{c.excel_name || c.sqlite_name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        ) : (
                                            <div className="text-xs text-muted-foreground">Carregue o preview para listar colunas</div>
                                        )}
                                    </div>


                                    <div className="col-span-12 md:col-span-2 flex items-center gap-2 justify-start">
                                        <Button onClick={handleCreateInverterColumnDialog} disabled={!dialogNewColsSelection.includes('INVERTER') || !dialogInverterSourceColumn || dialogLoading}>Criar coluna</Button>
                                        <Button variant="outline" onClick={() => { setDialogNewColsSelection((prev) => prev.filter(p => p !== 'INVERTER')); setDialogInverterSourceColumn(null); setDialogInverterTargetName(''); }}>Limpar</Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </PageSkeletonWrapper>
    );
};

export default Bases;