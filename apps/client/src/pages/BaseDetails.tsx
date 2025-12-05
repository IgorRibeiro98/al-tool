import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Trash } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useCallback, useEffect, useRef, useState } from 'react';
import PageSkeletonWrapper from '@/components/PageSkeletonWrapper';
import { getBase, fetchBasePreview, getBaseColumns, deleteBase } from '@/services/baseService';
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

const truncate = (value?: string | null, maxLength = 200) => {
    if (!value) return null;
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
};

const BaseDetails = () => {
    const navigate = useNavigate();
    const { id } = useParams();
    const [base, setBase] = useState<Base | null>(null);
    const [preview, setPreview] = useState<BasePreview | null>(null);
    const [baseColumns, setBaseColumns] = useState<any[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<number | null>(null);
    const pollRef = useRef<number | null>(null);
    const lastBaseRef = useRef<Base | null>(null);

    const loadPreviewAndColumns = useCallback(async (baseId: number) => {
        setPreviewLoading(true);
        try {
            const [previewRes, colsRes] = await Promise.all([
                fetchBasePreview(baseId),
                getBaseColumns(baseId)
            ]);
            setPreview(previewRes.data);
            setBaseColumns(colsRes.data.data ?? []);
        } catch (err) {
            console.error('Failed to refresh base preview', err);
            toast.error('Falha ao atualizar preview da base');
        } finally {
            setPreviewLoading(false);
        }
    }, []);

    const loadBaseData = useCallback(async (options?: { includePreview?: boolean; silentError?: boolean }) => {
        if (!id) return null;
        const numId = Number(id);
        const { includePreview = false, silentError = false } = options || {};
        if (includePreview) setLoading(true);
        try {
            if (includePreview) {
                const baseRes = await getBase(numId);
                setBase(baseRes.data);
                lastBaseRef.current = baseRes.data;

                if (baseRes.data.tabela_sqlite) {
                    const [previewRes, colsRes] = await Promise.all([
                        fetchBasePreview(numId),
                        getBaseColumns(numId)
                    ]);
                    setPreview(previewRes.data);
                    setBaseColumns(colsRes.data.data ?? []);
                } else {
                    setPreview(null);
                    setBaseColumns([]);
                }

                return baseRes.data;
            }

            const baseRes = await getBase(numId);
            const previous = lastBaseRef.current;
            setBase(baseRes.data);
            lastBaseRef.current = baseRes.data;
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
    }, [id, loadPreviewAndColumns]);

    useEffect(() => {
        loadBaseData({ includePreview: true });
    }, [loadBaseData]);

    const shouldPoll = !!base && (isConversionStatusActive(base.conversion_status) || isIngestStatusActive(base));

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
        }, 5000);
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

    return (
        <PageSkeletonWrapper loading={loading}>
            <div className="space-y-6">
                <div className="flex items-center gap-4 justify-between">
                    <div className="flex items-center gap-4">
                        <Button variant="ghost" size="icon" onClick={() => navigate("/bases")}>
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                        <div className="flex-1">
                            <h1 className="text-3xl font-bold">Detalhes da Base</h1>
                            <p className="text-muted-foreground">{base?.nome || 'Base cadastrada'}</p>
                        </div>
                    </div>
                    <div>
                        <Button variant="destructive" size="icon" onClick={() => {
                            if (!id) return;
                            setPendingDelete(Number(id));
                            setDeleteDialogOpen(true);
                        }} aria-label="Deletar base">
                            <Trash className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Informações da Base</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {loading ? (
                            <div>Carregando...</div>
                        ) : (
                            <>
                                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                    <div className="rounded-lg border p-3 flex flex-col gap-2 bg-muted/20">
                                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Tipo</p>
                                        <div className="flex items-center gap-2">
                                            <Badge>{base?.tipo ?? '-'}</Badge>
                                        </div>
                                    </div>
                                    <div className="rounded-lg border p-3 flex flex-col gap-2 bg-muted/20">
                                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Período</p>
                                        <p className="font-medium text-base">{base?.periodo ?? '-'}</p>
                                    </div>
                                    <div className="rounded-lg border p-3 flex flex-col gap-2 bg-muted/20">
                                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Data de criação</p>
                                        <p className="font-medium text-base">{base?.created_at ? new Date(base.created_at).toLocaleDateString('pt-BR') : '-'}</p>
                                    </div>
                                    <div className="rounded-lg border p-3 flex flex-col gap-2 bg-muted/20">
                                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Tabela SQLite</p>
                                        <p className="font-medium text-base">{base?.tabela_sqlite || '-'}</p>
                                    </div>
                                </div>
                                <div className="grid gap-4 md:grid-cols-2">
                                    <div className="rounded-lg border p-4 bg-muted/20 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <p className="text-sm text-muted-foreground">Status da conversão</p>
                                        </div>
                                        <StatusChip status={conversionMeta.chip} label={conversionMeta.label} />
                                        {conversionError && <p className="text-xs text-destructive break-words">{conversionError}</p>}
                                    </div>
                                    <div className="rounded-lg border p-4 bg-muted/20 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <p className="text-sm text-muted-foreground">Status da ingestão</p>
                                        </div>
                                        <StatusChip status={ingestMeta.chip} label={ingestMeta.label} />
                                        {ingestError && <p className="text-xs text-destructive break-words">{ingestError}</p>}
                                        {base?.tabela_sqlite && (
                                            <p className="text-xs text-muted-foreground">Tabela SQLite: {base.tabela_sqlite}</p>
                                        )}
                                    </div>
                                </div>
                            </>
                        )}
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
                            <AlertDialogAction onClick={async () => {
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
                            }}>Excluir</AlertDialogAction>
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
                            <div className="rounded-md border overflow-auto" style={{ maxHeight: '48vh', maxWidth: '80vw' }}>
                                <table className="min-w-max text-sm">
                                    <thead className="border-b bg-muted/50">
                                        <tr>
                                            {preview.columns.map((col) => {
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
                                            // row may be object with column keys or array
                                            return (
                                                <tr key={idx} className="border-b hover:bg-muted/50 transition-colors">
                                                    {Array.isArray(row) ? (
                                                        row.map((cell: any, i: number) => (
                                                            <td key={i} className="px-4 py-3">{String(cell ?? '')}</td>
                                                        ))
                                                    ) : (
                                                        preview.columns.map((col) => (
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
            </div>
        </PageSkeletonWrapper>
    );
};

export default BaseDetails;