import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Upload, Eye, CheckCircle, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from 'react';
import { fetchBases, ingestBase } from '@/services/baseService';

const Bases = () => {
    const navigate = useNavigate();
    const [bases, setBases] = useState<Base[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [ingesting, setIngesting] = useState<Record<number, boolean>>({});

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

    return (
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
                                        <span className="text-sm text-muted-foreground">{base.created_at ? new Date(base.created_at).toLocaleString() : '-'}</span>
                                        <div className="flex gap-2">
                                            {!base.tabela_sqlite && base.conversion_status === 'READY' && (
                                                <Button variant="outline" size="sm" onClick={() => handleIngest(base.id)} disabled={!!ingesting[base.id]}>
                                                    <Upload className="mr-2 h-4 w-4" />
                                                    {ingesting[base.id] ? 'Ingerindo...' : 'Ingerir'}
                                                </Button>
                                            )}
                                            <Button variant="ghost" size="sm" onClick={() => navigate(`/bases/${base.id}`)}>
                                                <Eye className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default Bases;