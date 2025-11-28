import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, CheckCircle } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from 'react';
import { getBase, fetchBasePreview } from '@/services/baseService';
import { toast } from 'sonner';

const BaseDetails = () => {
    const navigate = useNavigate();
    const { id } = useParams();
    const [base, setBase] = useState<Base | null>(null);
    const [preview, setPreview] = useState<BasePreview | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let mounted = true;
        if (!id) return;
        const numId = Number(id);
        setLoading(true);
        Promise.all([getBase(numId), fetchBasePreview(numId)])
            .then(([baseRes, previewRes]) => {
                if (!mounted) return;
                setBase(baseRes.data);
                setPreview(previewRes.data);
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
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => navigate("/bases")}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="flex-1">
                    <h1 className="text-3xl font-bold">Detalhes da Base</h1>
                    <p className="text-muted-foreground">Base Contábil Janeiro</p>
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
                                <p className="font-medium">{base?.created_at ? new Date(base.created_at).toLocaleString() : '-'}</p>
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
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

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
                                        {preview.columns.map((col) => (
                                            <th key={col} className="px-4 py-3 text-left font-medium">{col}</th>
                                        ))}
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