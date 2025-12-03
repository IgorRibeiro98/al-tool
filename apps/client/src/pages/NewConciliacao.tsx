import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useEffect, useMemo, useState } from 'react';
import PageSkeletonWrapper from '@/components/PageSkeletonWrapper';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { fetchBases } from '@/services/baseService';
import { fetchConfigsConciliacao, fetchConfigsEstorno, fetchConfigsCancelamento, fetchConfigsMapeamento } from '@/services/configsService';
import { createConciliacao } from '@/services/conciliacaoService';

const NewConciliacao = () => {
    const navigate = useNavigate();

    const [bases, setBases] = useState<Base[]>([]);
    const [configs, setConfigs] = useState<ConfigConciliacao[]>([]);
    const [estornos, setEstornos] = useState<ConfigEstorno[]>([]);
    const [cancelamentos, setCancelamentos] = useState<ConfigCancelamento[]>([]);
    const [mapConfigs, setMapConfigs] = useState<ConfigMapeamento[]>([]);

    const [loading, setLoading] = useState(false);

    const schema = z.object({
        nome: z.string().min(1, { message: 'Nome é obrigatório' }),
        configConciliacaoId: z.number({ message: 'Configuração é obrigatória', invalid_type_error: 'Configuração é obrigatória' }).int().positive(),
        configEstornoId: z.number().int().positive().nullable().optional(),
        configCancelamentoId: z.number().int().positive().nullable().optional(),
        configMapeamentoId: z.number().int().positive().nullable().optional(),
        baseContabilId: z.number().int().positive().nullable().optional(),
        baseFiscalId: z.number().int().positive().nullable().optional(),
    }).refine((data) => {
        if (!data.baseContabilId || !data.baseFiscalId) return true;
        return data.baseContabilId !== data.baseFiscalId;
    }, {
        message: 'Bases contábil e fiscal devem ser diferentes',
        path: ['baseFiscalId'],
    });

    type FormValues = z.infer<typeof schema>;

    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            nome: '',
            configConciliacaoId: undefined as any,
            configEstornoId: null,
            configCancelamentoId: null,
            configMapeamentoId: null,
            baseContabilId: null,
            baseFiscalId: null,
        },
    });

    const { control, watch } = form;
    const watchConciliacaoId = watch('configConciliacaoId');
    const watchMapeamentoId = watch('configMapeamentoId');
    const watchBaseContabilId = watch('baseContabilId');
    const watchBaseFiscalId = watch('baseFiscalId');

    const selectedConciliacao = useMemo(() => configs.find((cfg) => cfg.id === watchConciliacaoId), [configs, watchConciliacaoId]);
    const contabilBases = useMemo(() => bases.filter((b) => b.tipo === 'CONTABIL'), [bases]);
    const fiscalBases = useMemo(() => bases.filter((b) => b.tipo === 'FISCAL'), [bases]);

    const effectiveBaseContabilId = watchBaseContabilId ?? selectedConciliacao?.base_contabil_id ?? null;
    const effectiveBaseFiscalId = watchBaseFiscalId ?? selectedConciliacao?.base_fiscal_id ?? null;

    const availableMapConfigs = useMemo(() => {
        if (!effectiveBaseContabilId || !effectiveBaseFiscalId) return [];
        return mapConfigs.filter((cfg) => (
            cfg.base_contabil_id === effectiveBaseContabilId &&
            cfg.base_fiscal_id === effectiveBaseFiscalId
        ));
    }, [mapConfigs, effectiveBaseContabilId, effectiveBaseFiscalId]);

    const configBaseContabil = useMemo(() => {
        if (!selectedConciliacao) return null;
        return bases.find((b) => b.id === selectedConciliacao.base_contabil_id) || null;
    }, [bases, selectedConciliacao]);

    const configBaseFiscal = useMemo(() => {
        if (!selectedConciliacao) return null;
        return bases.find((b) => b.id === selectedConciliacao.base_fiscal_id) || null;
    }, [bases, selectedConciliacao]);

    useEffect(() => {
        form.setValue('baseContabilId', null);
        form.setValue('baseFiscalId', null);
        form.setValue('configMapeamentoId', null);
    }, [watchConciliacaoId, form]);

    useEffect(() => {
        if (!watchMapeamentoId) return;
        const selectedMap = mapConfigs.find((cfg) => cfg.id === watchMapeamentoId);
        if (!selectedMap) {
            form.setValue('configMapeamentoId', null);
            return;
        }
        if (selectedMap.base_contabil_id !== effectiveBaseContabilId || selectedMap.base_fiscal_id !== effectiveBaseFiscalId) {
            form.setValue('configMapeamentoId', null);
        }
    }, [watchMapeamentoId, effectiveBaseContabilId, effectiveBaseFiscalId, mapConfigs, form]);

    useEffect(() => {
        fetchBases({ pageSize: 200 }).then(r => {
            const payload = Array.isArray(r.data) ? r.data : r.data?.data ?? [];
            setBases(payload);
        }).catch(() => setBases([]));
        fetchConfigsConciliacao().then(r => setConfigs(r.data || [])).catch(() => setConfigs([]));
        fetchConfigsEstorno().then(r => setEstornos(r.data || [])).catch(() => setEstornos([]));
        fetchConfigsCancelamento().then(r => setCancelamentos(r.data || [])).catch(() => setCancelamentos([]));
        fetchConfigsMapeamento().then(r => setMapConfigs(r.data || [])).catch(() => setMapConfigs([]));
    }, []);

    const formatBaseLabel = (base?: Base | null) => {
        if (!base) return '';
        const nome = base.nome && base.nome.trim().length > 0 ? base.nome.trim() : `Base ${base.id}`;
        return base.periodo ? `${nome} (${base.periodo})` : nome;
    };

    const onSubmit = async (data: any) => {
        setLoading(true);
        try {
            await createConciliacao({
                nome: data.nome,
                configConciliacaoId: Number(data.configConciliacaoId),
                configEstornoId: data.configEstornoId ? Number(data.configEstornoId) : null,
                configCancelamentoId: data.configCancelamentoId ? Number(data.configCancelamentoId) : null,
                configMapeamentoId: data.configMapeamentoId ? Number(data.configMapeamentoId) : null,
                baseContabilId: data.baseContabilId ? Number(data.baseContabilId) : null,
                baseFiscalId: data.baseFiscalId ? Number(data.baseFiscalId) : null,
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
        <PageSkeletonWrapper loading={loading}>
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

                                <FormField
                                    control={control}
                                    name="configMapeamentoId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Configuração de Mapeamento (Opcional)</FormLabel>
                                            <FormControl>
                                                <Select value={field.value != null ? String(field.value) : 'none'} onValueChange={(v) => field.onChange(v === 'none' ? null : Number(v))}>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder={effectiveBaseContabilId && effectiveBaseFiscalId ? 'Selecione o mapeamento' : 'Selecione as bases primeiro'} />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="none">Nenhuma</SelectItem>
                                                        {mapConfigs.map((cfg) => (
                                                            <SelectItem key={cfg.id} value={String(cfg.id)}>{cfg.nome}</SelectItem>
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
                                    name="baseContabilId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Base Contábil (opcional)</FormLabel>
                                            <FormDescription>Selecione outra base contábil para reaproveitar esta configuração.</FormDescription>
                                            <FormControl>
                                                <Select value={field.value != null ? String(field.value) : 'config'} onValueChange={(v) => field.onChange(v === 'config' ? null : Number(v))} disabled={!selectedConciliacao}>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Selecione uma base contábil" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="config" disabled={!selectedConciliacao}>
                                                            {configBaseContabil ? `Usar ${formatBaseLabel(configBaseContabil)} (configuração)` : 'Selecione uma configuração primeiro'}
                                                        </SelectItem>
                                                        {contabilBases.map((base) => (
                                                            <SelectItem key={base.id} value={String(base.id)}>{formatBaseLabel(base)}</SelectItem>
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
                                    name="baseFiscalId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Base Fiscal (opcional)</FormLabel>
                                            <FormDescription>Troque a base fiscal utilizada neste job se necessário.</FormDescription>
                                            <FormControl>
                                                <Select value={field.value != null ? String(field.value) : 'config'} onValueChange={(v) => field.onChange(v === 'config' ? null : Number(v))} disabled={!selectedConciliacao}>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Selecione uma base fiscal" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="config" disabled={!selectedConciliacao}>
                                                            {configBaseFiscal ? `Usar ${formatBaseLabel(configBaseFiscal)} (configuração)` : 'Selecione uma configuração primeiro'}
                                                        </SelectItem>
                                                        {fiscalBases.map((base) => (
                                                            <SelectItem key={base.id} value={String(base.id)}>{formatBaseLabel(base)}</SelectItem>
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
        </PageSkeletonWrapper>
    );
};

export default NewConciliacao;
