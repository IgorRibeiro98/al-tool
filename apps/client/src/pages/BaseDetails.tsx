import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, CheckCircle, Clock, Trash } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from 'react';
import { getBase, fetchBasePreview, getBaseColumns, deleteBase } from '@/services/baseService';
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

const BaseDetails = () => {
    const navigate = useNavigate();
    const { id } = useParams();
    const [base, setBase] = useState<Base | null>(null);
    const [preview, setPreview] = useState<BasePreview | null>(null);
    const [baseColumns, setBaseColumns] = useState<any[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<number | null>(null);

    useEffect(() => {
        let mounted = true;
        if (!id) return;
        const numId = Number(id);
        setLoading(true);
        Promise.all([getBase(numId), fetchBasePreview(numId), getBaseColumns(numId)])
            .then(([baseRes, previewRes, colsRes]) => {
                if (!mounted) return;
                setBase(baseRes.data);
                setPreview(previewRes.data);
                setBaseColumns(colsRes.data.data ?? []);
            })
            .catch((err) => {
                console.error('Failed to load base details', err);
                toast.error('Falha ao carregar detalhes da base');
            })
            .finally(() => { if (mounted) setLoading(false); });

        return () => { mounted = false; };
    }, [id]);

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4 justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate("/bases")}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div className="flex-1">
                        <h1 className="text-3xl font-bold">Detalhes da Base</h1>
                        <p className="text-muted-foreground">Base Contábil Janeiro</p>
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
                <CardContent className="space-y-3">
                    {loading ? (
                        <div>Carregando...</div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div>
                                <p className="text-sm text-muted-foreground">Tipo</p>
                                <Badge>{base?.tipo ?? '-'}</Badge>
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Período</p>
                                <p className="font-medium">{base?.periodo ?? '-'}</p>
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Data Criação</p>
                                <p className="font-medium">{base?.created_at ? new Date(base.created_at).toLocaleDateString('pt-BR') : '-'}</p>
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Status</p>
                                {base?.tabela_sqlite ? (
                                    <div className="flex items-center gap-2 text-success">
                                        <CheckCircle className="h-4 w-4" />
                                        <span className="text-sm font-medium">Ingerida</span>
                                    </div>
                                ) : (
                                    <div className="text-sm text-muted-foreground">Não ingerida</div>
                                )}

                                {/* conversion status */}
                                {base?.conversion_status && base.conversion_status !== 'READY' && (
                                    <div className="mt-2">
                                        {base.conversion_status === 'PENDING' && <span className="text-sm text-yellow-600">Aguardando conversão</span>}
                                        {base.conversion_status === 'RUNNING' && <span className="text-sm text-blue-600">Convertendo</span>}
                                        {base.conversion_status === 'FAILED' && <span className="text-sm text-red-600">Falha na conversão</span>}
                                    </div>
                                )}

                                {/* ingest status */}
                                {base?.ingest_in_progress && (
                                    <div className="mt-2 text-sm text-muted-foreground flex items-center gap-2">
                                        <Clock className="h-4 w-4" />
                                        Ingestão em andamento
                                    </div>
                                )}
                            </div>
                        </div>
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
                    {loading ? (
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
                    ) : (
                        <div>Nenhum preview disponível para essa base.</div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export default BaseDetails;