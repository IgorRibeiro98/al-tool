import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { fetchBases } from '@/services/baseService';
import { fetchConfigsConciliacao, fetchConfigsEstorno, fetchConfigsCancelamento } from '@/services/configsService';
import { createConciliacao } from '@/services/conciliacaoService';

const NewConciliacao = () => {
    const navigate = useNavigate();

    const [bases, setBases] = useState<Base[]>([]);
    const [configs, setConfigs] = useState<ConfigConciliacao[]>([]);
    const [estornos, setEstornos] = useState<ConfigEstorno[]>([]);
    const [cancelamentos, setCancelamentos] = useState<ConfigCancelamento[]>([]);

    const [loading, setLoading] = useState(false);

    const schema = z.object({
        nome: z.string().min(1, { message: 'Nome é obrigatório' }),
        configConciliacaoId: z.number({ message: 'Configuração é obrigatória', invalid_type_error: 'Configuração é obrigatória' }).int().positive(),
        configEstornoId: z.number().int().positive().nullable().optional(),
        configCancelamentoId: z.number().int().positive().nullable().optional(),
    });

    type FormValues = z.infer<typeof schema>;

    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            nome: '',
            configConciliacaoId: undefined as any,
            configEstornoId: null,
            configCancelamentoId: null,
        },
    });

    const { control, watch } = form;

    useEffect(() => {
        fetchBases().then(r => setBases(r.data || [])).catch(() => setBases([]));
        fetchConfigsConciliacao().then(r => setConfigs(r.data || [])).catch(() => setConfigs([]));
        fetchConfigsEstorno().then(r => setEstornos(r.data || [])).catch(() => setEstornos([]));
        fetchConfigsCancelamento().then(r => setCancelamentos(r.data || [])).catch(() => setCancelamentos([]));
    }, []);

    const onSubmit = async (data: any) => {
        setLoading(true);
        try {
            await createConciliacao({
                nome: data.nome,
                configConciliacaoId: Number(data.configConciliacaoId),
                configEstornoId: data.configEstornoId ? Number(data.configEstornoId) : null,
                configCancelamentoId: data.configCancelamentoId ? Number(data.configCancelamentoId) : null,
            });
            toast.success('Conciliação criada');
            navigate('/conciliacoes');
        } catch (err: any) {
            console.error('create conciliacao failed', err);
            toast.error(err?.response?.data?.error || 'Falha ao criar conciliação');
        } finally {
            setLoading(false);
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
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                            <FormField
                                control={control}
                                name="nome"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Nome do Job *</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Ex: Conciliação Janeiro 2024" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={control}
                                name="configConciliacaoId"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Configuração de Conciliação *</FormLabel>
                                        <FormControl>
                                            <Select value={field.value ? String(field.value) : ''} onValueChange={(v) => field.onChange(v ? Number(v) : undefined)}>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Selecione a configuração" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {configs.map((c) => (
                                                        <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={control}
                                name="configEstornoId"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Configuração de Estorno (Opcional)</FormLabel>
                                        <FormControl>
                                            <Select value={field.value != null ? String(field.value) : 'none'} onValueChange={(v) => field.onChange(v === 'none' ? null : Number(v))}>
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
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={control}
                                name="configCancelamentoId"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Configuração de Cancelamento (Opcional)</FormLabel>
                                        <FormControl>
                                            <Select value={field.value != null ? String(field.value) : 'none'} onValueChange={(v) => field.onChange(v === 'none' ? null : Number(v))}>
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
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <div className="flex gap-3 justify-end pt-4">
                                <Button type="button" variant="outline" onClick={() => navigate("/conciliacoes")}>
                                    Cancelar
                                </Button>
                                <Button type="submit">
                                    Criar Conciliação
                                </Button>
                            </div>
                        </form>
                    </Form>
                </CardContent>
            </Card>
        </div>
    );
};

export default NewConciliacao;
