import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useEffect, useState } from 'react';
import { fetchBases } from '@/services/baseService';
import { fetchConfigsConciliacao, fetchConfigsEstorno, fetchConfigsCancelamento } from '@/services/configsService';
import { createConciliacao } from '@/services/conciliacaoService';

const NewConciliacao = () => {
    const navigate = useNavigate();

    const [bases, setBases] = useState<Base[]>([]);
    const [configs, setConfigs] = useState<ConfigConciliacao[]>([]);
    const [estornos, setEstornos] = useState<ConfigEstorno[]>([]);
    const [cancelamentos, setCancelamentos] = useState<ConfigCancelamento[]>([]);

    const [nome, setNome] = useState<string>('');
    const [configConciliacaoId, setConfigConciliacaoId] = useState<number | null>(null);
    const [configEstornoId, setConfigEstornoId] = useState<number | null>(null);
    const [configCancelamentoId, setConfigCancelamentoId] = useState<number | null>(null);

    useEffect(() => {
        fetchBases().then(r => setBases(r.data || [])).catch(() => setBases([]));
        fetchConfigsConciliacao().then(r => setConfigs(r.data || [])).catch(() => setConfigs([]));
        fetchConfigsEstorno().then(r => setEstornos(r.data || [])).catch(() => setEstornos([]));
        fetchConfigsCancelamento().then(r => setCancelamentos(r.data || [])).catch(() => setCancelamentos([]));
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!configConciliacaoId) return toast.error('Selecione a configuração de conciliação');
        try {
            await createConciliacao({ nome, configConciliacaoId, configEstornoId: configEstornoId || null, configCancelamentoId: configCancelamentoId || null });
            toast.success('Conciliação criada');
            navigate('/conciliacoes');
        } catch (err: any) {
            console.error('create conciliacao failed', err);
            toast.error(err?.response?.data?.error || 'Falha ao criar conciliação');
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => navigate("/conciliacoes")}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <h1 className="text-3xl font-bold">Nova Conciliação</h1>
                    <p className="text-muted-foreground">Configure um novo job de conciliação</p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Configuração do Job</CardTitle>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor="nome">Nome do Job *</Label>
                            <Input id="nome" placeholder="Ex: Conciliação Janeiro 2024" required value={nome} onChange={(e) => setNome(e.target.value)} />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="config">Configuração de Conciliação *</Label>
                            <Select required value={String(configConciliacaoId ?? '')} onValueChange={(v) => setConfigConciliacaoId(v ? Number(v) : null)}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione a configuração" />
                                </SelectTrigger>
                                <SelectContent>
                                    {configs.map((c) => (
                                        <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="estorno">Configuração de Estorno (Opcional)</Label>
                            <Select value={configEstornoId != null ? String(configEstornoId) : 'none'} onValueChange={(v) => setConfigEstornoId(v === 'none' ? null : Number(v))}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Nenhuma" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">Nenhuma</SelectItem>
                                    {estornos.map((e) => (
                                        <SelectItem key={e.id} value={String(e.id)}>{e.nome}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="cancelamento">Configuração de Cancelamento (Opcional)</Label>
                            <Select value={configCancelamentoId != null ? String(configCancelamentoId) : 'none'} onValueChange={(v) => setConfigCancelamentoId(v === 'none' ? null : Number(v))}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Nenhuma" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">Nenhuma</SelectItem>
                                    {cancelamentos.map((c) => (
                                        <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="flex gap-3 justify-end pt-4">
                            <Button type="button" variant="outline" onClick={() => navigate("/conciliacoes")}>
                                Cancelar
                            </Button>
                            <Button type="submit">
                                Criar Conciliação
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
};

export default NewConciliacao;
