import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Upload, Eye, CheckCircle, Clock, Trash } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from 'react';
import PageSkeletonWrapper from '@/components/PageSkeletonWrapper';
import { fetchBases, ingestBase, deleteBase } from '@/services/baseService';
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

const Bases = () => {
    const navigate = useNavigate();
    const [bases, setBases] = useState<Base[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [ingesting, setIngesting] = useState<Record<number, boolean>>({});
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

    useEffect(() => {
        let mounted = true;
        setLoading(true);
        fetchBases().then(res => {
            if (!mounted) return;
            setBases(res.data.data || []);
        }).catch(err => {
            console.error('Failed to fetch bases', err);
        }).finally(() => { if (mounted) setLoading(false); });

        return () => { mounted = false; };
    }, []);

    const handleIngest = async (id: number) => {
        setIngesting(prev => ({ ...prev, [id]: true }));
        try {
            await ingestBase(id);
            // refresh list
            const res = await fetchBases();
            setBases(res.data?.data || res.data || []);
        } catch (e) {
            console.error('Ingest failed', e);
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
            const res = await fetchBases();
            setBases(res.data?.data || res.data || []);
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
                                bases.map((base) => (
                                    <div
                                        key={base.id}
                                        className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50 transition-colors"
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
                                        <div className="flex items-center gap-4">
                                            {base.tabela_sqlite ? (
                                                <div className="flex items-center gap-2 text-success">
                                                    <CheckCircle className="h-4 w-4" />
                                                    <span className="text-sm">Ingerida</span>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2 text-muted-foreground">
                                                    <Clock className="h-4 w-4" />
                                                    <span className="text-sm">Não ingerida</span>
                                                </div>
                                            )}
                                            {/* conversion status display */}
                                            {base.conversion_status && base.conversion_status !== 'READY' && (
                                                <div className="ml-4">
                                                    {base.conversion_status === 'PENDING' && <span className="text-sm text-yellow-600">Aguardando conversão</span>}
                                                    {base.conversion_status === 'RUNNING' && <span className="text-sm text-blue-600">Convertendo</span>}
                                                    {base.conversion_status === 'FAILED' && <span className="text-sm text-red-600">Falha na conversão</span>}
                                                </div>
                                            )}
                                            <span className="text-sm text-muted-foreground">{base.created_at ? new Date(base.created_at).toLocaleDateString('pt-BR') : '-'}</span>
                                            <div className="flex gap-2">
                                                {/* show ingest button only when not ingested, conversion ready and no ingest job in progress */}
                                                {!base.tabela_sqlite && base.conversion_status === 'READY' && !base.ingest_in_progress && (
                                                    <Button variant="outline" size="sm" onClick={() => handleIngest(base.id)} disabled={!!ingesting[base.id]}>
                                                        <Upload className="mr-2 h-4 w-4" />
                                                        {ingesting[base.id] ? 'Ingerindo...' : 'Ingerir'}
                                                    </Button>
                                                )}
                                                {base.ingest_in_progress && (
                                                    <div className="text-sm text-muted-foreground flex items-center gap-2">
                                                        <Clock className="h-4 w-4" />
                                                        Ingestão em andamento
                                                    </div>
                                                )}
                                                <div className="ml-2">
                                                    <Button variant="ghost" size="icon" onClick={() => navigate(`/bases/${base.id}`)} aria-label="Ver base">
                                                        <Eye className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                                <div className="ml-2">
                                                    <Button variant="destructive" size="icon" onClick={() => confirmDelete(base.id)} aria-label="Deletar base">
                                                        <Trash className="h-4 w-4" />
                                                    </Button>
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