import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Trash } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import PageSkeletonWrapper from '@/components/PageSkeletonWrapper';
import {
    getBase,
    fetchBasePreview,
    getBaseColumns,
    deleteBase,
    createDerivedColumn,
    getDerivedColumnJobStatus,
    reuseMonetaryFlags,
    fetchBases,
    updateBase,
    setBaseColumnMonetary,
} from '@/services/baseService';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { StatusChip } from '@/components/StatusChip';
import {
    getConversionStatusMeta,
    getIngestStatusMeta,
    isConversionStatusActive,
    isIngestStatusActive,
} from '@/lib/baseStatus';
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
const PREVIEW_CONTAINER_MAX_HEIGHT = '48vh';
const PREVIEW_CONTAINER_MAX_WIDTH = '80vw';

const truncate = (value?: string | null, maxLength = 200): string | null => {
    if (!value) return null;
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
};

function formatDateOrDash(date?: string | null): string {
    if (!date) return '-';
    try {
        return new Date(date).toLocaleDateString('pt-BR');
    } catch {
        return '-';
    }
}

const BaseDetails = () => {
    const navigate = useNavigate();
    const { id } = useParams();
    const [base, setBase] = useState<any | null>(null);
    const [preview, setPreview] = useState<any | null>(null);
    const [baseColumns, setBaseColumns] = useState<any[] | null>(null);
    const [newColsSelection, setNewColsSelection] = useState<string[]>(['ABS']);
    const [absSourceColumn, setAbsSourceColumn] = useState<string | null>(null);
    const [inverterSourceColumn, setInverterSourceColumn] = useState<string | null>(null);
    const [absTargetName, setAbsTargetName] = useState<string>('');
    const [inverterTargetName, setInverterTargetName] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<number | null>(null);
    const [referenceCandidates, setReferenceCandidates] = useState<any[]>([]);
    const [selectedReference, setSelectedReference] = useState<number | null>(null);
    const [reuseLoading, setReuseLoading] = useState(false);
    const pollRef = useRef<number | null>(null);
    const lastBaseRef = useRef<any | null>(null);

    const loadPreviewAndColumns = useCallback(async (baseId: number) => {
        setPreviewLoading(true);
        try {
            const [previewRes, colsRes] = await Promise.all([fetchBasePreview(baseId), getBaseColumns(baseId)]);
            setPreview(previewRes.data);
            setBaseColumns(colsRes.data.data ?? []);
        } catch (err) {
            console.error('Failed to refresh base preview', err);
            toast.error('Falha ao atualizar preview da base');
        } finally {
            setPreviewLoading(false);
        }
    }, []);

    const loadReferenceCandidates = useCallback(async (b: any | null) => {
        if (!b) return setReferenceCandidates([]);
        try {
            const params: any = { tipo: b.tipo };
            if (b.subtype) params.subtype = b.subtype;
            const resp = await fetchBases(params);
            const candidates = (resp.data.data || []).filter((r: any) => r.id !== b.id && r.tabela_sqlite);
            setReferenceCandidates(candidates);
            setSelectedReference(b.reference_base_id ?? null);
        } catch (e) {
            console.error('Failed to load reference candidates', e);
            setReferenceCandidates([]);
        }
    }, []);

    const loadBaseData = useCallback(
        async (options?: { includePreview?: boolean; silentError?: boolean }) => {
            if (!id) return null;
            const numId = Number(id);
            const { includePreview = false, silentError = false } = options || {};
            if (includePreview) setLoading(true);

            try {
                const baseRes = await getBase(numId);
                const previous = lastBaseRef.current;
                setBase(baseRes.data);
                lastBaseRef.current = baseRes.data;

                if (includePreview && baseRes.data.tabela_sqlite) {
                    await loadPreviewAndColumns(numId);
                } else if (includePreview) {
                    setPreview(null);
                    setBaseColumns([]);
                }

                if (!previous?.tabela_sqlite && baseRes.data.tabela_sqlite) {
                    toast.success('Ingestão concluída. Atualizando preview...');
                    await loadPreviewAndColumns(numId);
                }

                return baseRes.data;
            } catch (err) {
                console.error('Failed to load base details', err);
                if (!silentError) toast.error('Falha ao carregar detalhes da base');
                return null;
            } finally {
                if (includePreview) setLoading(false);
            }
        },
        [id, loadPreviewAndColumns]
    );

    useEffect(() => {
        loadBaseData({ includePreview: true });
    }, [loadBaseData]);

    useEffect(() => {
        loadReferenceCandidates(base);
    }, [base, loadReferenceCandidates]);

    const shouldPoll = !!base && (isConversionStatusActive(base?.conversion_status) || isIngestStatusActive(base));

    useEffect(() => {
        if (!id) return;
        if (!shouldPoll) {
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
            return;
        }

        const interval = window.setInterval(() => {
            loadBaseData({ silentError: true });
        }, POLL_INTERVAL_MS);
        pollRef.current = interval;

        return () => {
            clearInterval(interval);
            pollRef.current = null;
        };
    }, [id, shouldPoll, loadBaseData]);

    const conversionMeta = getConversionStatusMeta(base?.conversion_status);
    const ingestMeta = getIngestStatusMeta(base ?? undefined);
    const conversionError = base?.conversion_status === 'FAILED' ? truncate(base?.conversion_error) : null;
    const ingestError = base?.ingest_status === 'FAILED' ? truncate(base?.ingest_job?.erro) : null;

    const handleDelete = useCallback(async () => {
        if (!pendingDelete) return;
        try {
            await deleteBase(pendingDelete);
            toast.success('Base deletada');
            navigate('/bases');
        } catch (e) {
            console.error('Delete base failed', e);
            toast.error('Falha ao deletar base');
        } finally {
            setDeleteDialogOpen(false);
            setPendingDelete(null);
        }
    }, [pendingDelete, navigate]);

    const handleSaveReference = async () => {
        if (!id) return toast.error('Base inválida');
        try {
            setLoading(true);
            await updateBase(Number(id), { reference_base_id: selectedReference });
            toast.success('Base atualizada');
            if (selectedReference) {
                try {
                    setReuseLoading(true);
                    await reuseMonetaryFlags(selectedReference, { targetBaseIds: [Number(id)], matchBy: 'excel_name', override: true });
                    toast.success('Flags do modelo aplicadas automaticamente');
                } catch (rfErr: any) {
                    console.error('Auto-apply reference flags failed', rfErr);
                    const serverMsg = rfErr?.response?.data?.error || rfErr?.response?.data || rfErr?.message || 'Falha ao aplicar flags do modelo automaticamente';
                    toast.error(String(serverMsg));
                } finally {
                    setReuseLoading(false);
                }
            }
            await loadBaseData({ includePreview: true });
        } catch (e) {
            console.error('Failed to update base reference', e);
            toast.error('Falha ao atualizar referência');
        } finally {
            setLoading(false);
        }
    };

    const handleApplyReferenceFlags = async () => {
        if (!selectedReference) return toast.error('Selecione uma base de referência');
        if (!id) return toast.error('Base inválida');
        try {
            setReuseLoading(true);
            await reuseMonetaryFlags(selectedReference, { targetBaseIds: [Number(id)], matchBy: 'excel_name', override: false });
            toast.success('Flags aplicadas a partir do modelo');
            await loadBaseData({ includePreview: true });
        } catch (e) {
            console.error('Failed to apply reference flags', e);
            toast.error('Falha ao aplicar flags do modelo');
        } finally {
            setReuseLoading(false);
        }
    };

    const pollDerivedColumnJob = useCallback(async (baseId: number, jobId: number, op: string) => {
        const pollInterval = 2000;
        let lastProgress = 0;
        const poll = async () => {
            try {
                const resp = await getDerivedColumnJobStatus(baseId, jobId);
                const job = resp.data.job;
                if (job.status === 'DONE') {
                    toast.success(`Coluna ${op} criada com sucesso (${job.processed_rows} linhas)`);
                    await loadBaseData({ includePreview: true });
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
    }, [loadBaseData]);

    const handleCreateAbsColumn = useCallback(async () => {
        if (!id) return toast.error('Base inválida');
        if (!absSourceColumn) return toast.error('Selecione a coluna de origem para ABS');
        const numId = Number(id);
        try {
            setLoading(true);
            const resp = await createDerivedColumn(numId, absSourceColumn as string, 'ABS');
            if (resp.data.background) {
                // Background job started - poll for completion
                toast.info(resp.data.message || 'Processamento iniciado em background');
                pollDerivedColumnJob(numId, resp.data.jobId, 'ABS');
            } else {
                toast.success(`Coluna ${resp.data.column} criada (${resp.data.rowsUpdated} linhas atualizadas)`);
                await loadBaseData({ includePreview: true });
            }
        } catch (e: any) {
            console.error('create ABS failed', e);
            toast.error(e?.message || 'Falha ao criar coluna ABS');
        } finally {
            setLoading(false);
        }
    }, [id, absSourceColumn, loadBaseData, pollDerivedColumnJob]);

    const handleCreateInverterColumn = useCallback(async () => {
        if (!id) return toast.error('Base inválida');
        if (!inverterSourceColumn) return toast.error('Selecione a coluna de origem para INVERTER');
        const numId = Number(id);
        try {
            setLoading(true);
            const resp = await createDerivedColumn(numId, inverterSourceColumn as string, 'INVERTER');
            if (resp.data.background) {
                // Background job started - poll for completion
                toast.info(resp.data.message || 'Processamento iniciado em background');
                pollDerivedColumnJob(numId, resp.data.jobId, 'INVERTER');
            } else {
                toast.success(`Coluna ${resp.data.column} criada (${resp.data.rowsUpdated} linhas atualizadas)`);
                await loadBaseData({ includePreview: true });
            }
        } catch (e: any) {
            console.error('create INVERTER failed', e);
            toast.error(e?.message || 'Falha ao criar coluna INVERTER');
        } finally {
            setLoading(false);
        }
    }, [id, inverterSourceColumn, loadBaseData, pollDerivedColumnJob]);

    return (
        <PageSkeletonWrapper loading={loading}>
            <div className="space-y-4">
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <CardTitle>Informações da Base</CardTitle>
                            <div className="flex items-center gap-2">
                                <Button variant="ghost" size="sm" onClick={() => navigate('/bases')}><ArrowLeft size={16} /> Voltar</Button>
                                <Button variant="destructive" size="sm" onClick={() => { setPendingDelete(Number(id)); setDeleteDialogOpen(true); }}><Trash size={16} /></Button>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="grid gap-4 md:grid-cols-4 mb-4">
                            <div className="rounded-lg border p-3 flex flex-col gap-2 bg-muted/20">
                                <p className="text-xs uppercase tracking-wide text-muted-foreground">Tipo</p>
                                <p className="font-medium text-base">{base?.tipo ?? '-'}</p>
                            </div>
                            <div className="rounded-lg border p-3 flex flex-col gap-2 bg-muted/20">
                                <p className="text-xs uppercase tracking-wide text-muted-foreground">Período</p>
                                <p className="font-medium text-base">{base?.periodo ?? '-'}</p>
                            </div>
                            <div className="rounded-lg border p-3 flex flex-col gap-2 bg-muted/20">
                                <p className="text-xs uppercase tracking-wide text-muted-foreground">Data de criação</p>
                                <p className="font-medium text-base">{formatDateOrDash(base?.created_at)}</p>
                            </div>
                            <div className="rounded-lg border p-3 flex flex-col gap-2 bg-muted/20">
                                <p className="text-xs uppercase tracking-wide text-muted-foreground">Tabela SQLite</p>
                                <p className="font-medium text-base">{base?.tabela_sqlite || '-'}</p>
                            </div>
                        </div>
                        <div className="flex flex-col md:flex-row gap-4">
                            <div className="flex-1 rounded-lg border p-4 bg-muted/20">
                                <p className="text-sm text-muted-foreground">Status</p>
                                <div className="mt-2 flex flex-wrap items-center gap-4">
                                    <div className="flex items-center gap-3">
                                        <div className="text-xs text-muted-foreground">Conversão</div>
                                        <StatusChip status={conversionMeta.chip} label={conversionMeta.label} />
                                    </div>

                                    <div className="flex items-center gap-3">
                                        <div className="text-xs text-muted-foreground">Ingestão</div>
                                        <StatusChip status={ingestMeta.chip} label={ingestMeta.label} />
                                    </div>

                                    {conversionError && <p className="w-full text-xs text-destructive break-words mt-2">{conversionError}</p>}
                                    {ingestError && <p className="w-full text-xs text-destructive break-words mt-2">{ingestError}</p>}
                                </div>
                            </div>

                            <div className="w-full md:w-2/4 rounded-lg border p-4 bg-muted/20">
                                {/* <p className="text-sm text-muted-foreground mb-2">Ações</p> */}
                                <p className="text-sm text-muted-foreground mb-2">Modelo de referência (mesmo subtipo)</p>
                                {base?.tabela_sqlite ? (
                                    <div className="flex items-start md:items-center gap-3">
                                        <div className="flex-1 min-w-0">
                                            {/* <p className="text-xs text-muted-foreground">Modelo de referência (mesmo subtype)</p> */}
                                            <div className=" w-full">
                                                <Select value={selectedReference ? String(selectedReference) : '__none'} onValueChange={(v) => setSelectedReference(v && v !== '__none' ? Number(v) : null)}>
                                                    <SelectTrigger>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="__none">Nenhuma</SelectItem>
                                                        {referenceCandidates.map((r) => (
                                                            <SelectItem key={r.id} value={String(r.id)}>{`${r.nome} (${r.periodo || 'sem período'})`}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>

                                        <div className="flex-shrink-0">
                                            <Button size="sm" onClick={handleSaveReference} disabled={loading || reuseLoading}>{loading ? 'Salvando...' : 'Salvar'}</Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-xs text-muted-foreground">Ações de referência disponíveis após ingestão.</div>
                                )}
                            </div>
                        </div>


                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Adicionar novas colunas</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            <p className="text-sm text-muted-foreground">Selecione as colunas derivadas que deseja adicionar</p>
                            {/* Checkboxes moved inline with each derived-column row for better alignment */}

                            {true && (
                                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                                    <div className="col-span-12 md:col-span-1 flex items-center">
                                        <label className="flex items-center gap-2">
                                            <Checkbox checked={newColsSelection.includes('ABS')} onCheckedChange={(v) => {
                                                const checked = v === true;
                                                setNewColsSelection((prev) => {
                                                    if (checked) return Array.from(new Set([...prev, 'ABS']));
                                                    return prev.filter(p => p !== 'ABS');
                                                });
                                            }} />
                                            <span className="text-sm">ABS</span>
                                        </label>
                                    </div>

                                    <div className="col-span-12 md:col-span-6">
                                        {Array.isArray(baseColumns) && baseColumns.length > 0 ? (
                                            <Select value={absSourceColumn ?? undefined} onValueChange={(v) => setAbsSourceColumn(!v || v === '__none' ? null : v)}>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Coluna origem (ABS)" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {baseColumns.map((c) => (
                                                        <SelectItem key={c.sqlite_name} value={c.sqlite_name}>{c.excel_name || c.sqlite_name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        ) : (
                                            <div className="text-xs text-muted-foreground">Carregue o preview para listar colunas</div>
                                        )}
                                    </div>



                                    <div className="col-span-12 md:col-span-3 flex items-center gap-2 justify-start">
                                        <Button onClick={handleCreateAbsColumn} disabled={!newColsSelection.includes('ABS') || !absSourceColumn || loading}>Criar coluna</Button>
                                        <Button variant="outline" onClick={() => { setNewColsSelection((prev) => prev.filter(p => p !== 'ABS')); setAbsSourceColumn(null); setAbsTargetName(''); }}>Limpar</Button>
                                    </div>
                                </div>
                            )}

                            {true && (
                                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center pt-4">
                                    <div className="col-span-12 md:col-span-1 flex items-center">
                                        <label className="flex items-center gap-2">
                                            <Checkbox checked={newColsSelection.includes('INVERTER')} onCheckedChange={(v) => {
                                                const checked = v === true;
                                                setNewColsSelection((prev) => {
                                                    if (checked) return Array.from(new Set([...prev, 'INVERTER']));
                                                    return prev.filter(p => p !== 'INVERTER');
                                                });
                                            }} />
                                            <span className="text-sm">INVERTER</span>
                                        </label>
                                    </div>

                                    <div className="col-span-12 md:col-span-6">
                                        {Array.isArray(baseColumns) && baseColumns.length > 0 ? (
                                            <Select value={inverterSourceColumn ?? undefined} onValueChange={(v) => setInverterSourceColumn(!v || v === '__none' ? null : v)}>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Coluna origem (INVERTER)" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {baseColumns.map((c) => (
                                                        <SelectItem key={c.sqlite_name} value={c.sqlite_name}>{c.excel_name || c.sqlite_name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        ) : (
                                            <div className="text-xs text-muted-foreground">Carregue o preview para listar colunas</div>
                                        )}
                                    </div>



                                    <div className="col-span-12 md:col-span-3 flex items-center gap-2 justify-start">
                                        <Button onClick={handleCreateInverterColumn} disabled={!newColsSelection.includes('INVERTER') || !inverterSourceColumn || loading}>Criar coluna</Button>
                                        <Button variant="outline" onClick={() => { setNewColsSelection((prev) => prev.filter(p => p !== 'INVERTER')); setInverterSourceColumn(null); setInverterTargetName(''); }}>Limpar</Button>
                                    </div>
                                </div>
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
                            <AlertDialogCancel onClick={() => { setDeleteDialogOpen(false); setPendingDelete(null); }}>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDelete}>Excluir</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                <Card>
                    <CardHeader>
                        <CardTitle>Preview dos Dados (50 primeiras linhas)</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {loading || previewLoading ? (
                            <div>Carregando preview...</div>
                        ) : preview ? (
                            <div className="rounded-md border overflow-auto" style={{ maxHeight: PREVIEW_CONTAINER_MAX_HEIGHT, maxWidth: PREVIEW_CONTAINER_MAX_WIDTH }}>
                                <table className="min-w-max text-sm">
                                    <thead className="border-b bg-muted/50">
                                        <tr>
                                            {preview.columns.map((col: string) => {
                                                const found = baseColumns?.find(bc => bc.sqlite_name === col);
                                                const label = found ? (found.excel_name || col) : col;
                                                return (<th key={col} className="px-4 py-3 text-left font-medium">{label}</th>);
                                            })}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {Array.isArray(preview.rows) && preview.rows.length === 0 && (
                                            <tr><td className="p-4">Nenhuma linha</td></tr>
                                        )}
                                        {preview.rows.map((row: any, idx: number) => {
                                            return (
                                                <tr key={idx} className="border-b hover:bg-muted/50 transition-colors">
                                                    {Array.isArray(row) ? (
                                                        row.map((cell: any, i: number) => (
                                                            <td key={i} className="px-4 py-3">{String(cell ?? '')}</td>
                                                        ))
                                                    ) : (
                                                        preview.columns.map((col: string) => (
                                                            <td key={col} className="px-4 py-3">{String(row[col] ?? '')}</td>
                                                        ))
                                                    )}
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        ) : base?.tabela_sqlite ? (
                            <div>Nenhum preview disponível para essa base.</div>
                        ) : (
                            <div className="text-sm text-muted-foreground">O preview será exibido assim que a ingestão terminar.</div>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Colunas da Base</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {Array.isArray(baseColumns) && baseColumns.length > 0 ? (
                            <div className="space-y-2">
                                {baseColumns.map((c) => (
                                    <div key={c.id} className="flex items-center justify-between border rounded p-2">
                                        <div>
                                            <div className="font-medium">{c.excel_name || c.sqlite_name}</div>
                                            <div className="text-xs text-muted-foreground">{c.sqlite_name} — index {c.col_index}</div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <label className="flex items-center gap-2 text-sm">
                                                <Checkbox checked={Number((c as any).is_monetary) === 1} onCheckedChange={async (v) => {
                                                    if (!id) return;
                                                    const bid = Number(id);
                                                    const checked = v === true;
                                                    try {
                                                        setLoading(true);
                                                        const resp = await setBaseColumnMonetary(bid, c.id, checked ? 1 : 0);
                                                        setBaseColumns((prev) => (prev || []).map(p => p.id === c.id ? { ...p, ...(resp.data.data || {}) } : p));
                                                        toast.success('Atualizado');
                                                    } catch (err) {
                                                        console.error('Failed to update column monetary flag', err);
                                                        toast.error('Falha ao atualizar coluna');
                                                    } finally { setLoading(false); }
                                                }} />
                                                <span>Monetário</span>
                                            </label>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-sm text-muted-foreground">Nenhuma coluna registrada para essa base.</div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </PageSkeletonWrapper>
    );
};

export default BaseDetails;