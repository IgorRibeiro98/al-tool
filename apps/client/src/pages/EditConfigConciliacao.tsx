import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { X, Trash2 } from 'lucide-react';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

import { fetchBases, getBaseColumns } from '@/services/baseService';
import { getConfigConciliacao, updateConfigConciliacao, deleteConfigConciliacao } from '@/services/configsService';

const schema = z.object({
    nome: z.string().min(1),
    baseContabilId: z.string().nullable(),
    baseFiscalId: z.string().nullable(),
    chavesContabeis: z.array(z.string()).optional(),
    chavesFiscais: z.array(z.string()).optional(),
    colunaConciliacaoContabil: z.string().optional(),
    colunaConciliacaoFiscal: z.string().optional(),
    diferencaImaterial: z.number().nullable().optional(),
    inverterSinal: z.boolean().optional(),
});

type FormValues = z.infer<typeof schema>;

const EditConfigConciliacao: React.FC = () => {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();

    const [bases, setBases] = useState<any[]>([]);
    const [colsContabeis, setColsContabeis] = useState<any[]>([]);
    const [colsFiscais, setColsFiscais] = useState<any[]>([]);

    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            nome: '',
            baseContabilId: '',
            baseFiscalId: '',
            chavesContabeis: [],
            chavesFiscais: [],
            colunaConciliacaoContabil: '',
            colunaConciliacaoFiscal: '',
            diferencaImaterial: null,
            inverterSinal: false,
        },
    });

    useEffect(() => {
        let mounted = true;
        fetchBases()
            .then((r: any) => {
                if (!mounted) return;
                setBases(r.data?.data || r.data || []);
            })
            .catch(() => setBases([]));
        return () => { mounted = false; };
    }, []);

    useEffect(() => {
        // watch base selections and load columns (use same mapping as NewConfigConciliacao)
        const sub = form.watch((_, { name }) => {
            if (name === 'baseContabilId') {
                const bCont = Number(form.getValues('baseContabilId'));
                if (bCont && !Number.isNaN(bCont)) {
                    getBaseColumns(bCont).then((r: any) => {
                        const rows = r.data?.data || [];
                        const cols = rows.map((c: any) => ({
                            excel: c.excel_name,
                            sqlite: c.sqlite_name,
                            index: String(c.col_index),
                        }));
                        setColsContabeis(cols);
                    }).catch(() => setColsContabeis([]));
                } else {
                    setColsContabeis([]);
                }
            }

            if (name === 'baseFiscalId') {
                const bFisc = Number(form.getValues('baseFiscalId'));
                if (bFisc && !Number.isNaN(bFisc)) {
                    getBaseColumns(bFisc).then((r: any) => {
                        const rows = r.data?.data || [];
                        const cols = rows.map((c: any) => ({
                            excel: c.excel_name,
                            sqlite: c.sqlite_name,
                            index: String(c.col_index),
                        }));
                        setColsFiscais(cols);
                    }).catch(() => setColsFiscais([]));
                } else {
                    setColsFiscais([]);
                }
            }
        });
        return () => sub.unsubscribe();
    }, [form]);

    useEffect(() => {
        let mounted = true;
        if (!id) return;
        const numId = Number(id);
        if (Number.isNaN(numId)) return;
        getConfigConciliacao(numId)
            .then((res: any) => {
                if (!mounted) return;
                const cfg = res.data?.data || res.data || {};
                form.reset({
                    nome: cfg.nome || '',
                    baseContabilId: cfg.base_contabil_id ? String(cfg.base_contabil_id) : '',
                    baseFiscalId: cfg.base_fiscal_id ? String(cfg.base_fiscal_id) : '',
                    chavesContabeis: cfg.chaves_contabil || [],
                    chavesFiscais: cfg.chaves_fiscal || [],
                    colunaConciliacaoContabil: cfg.coluna_conciliacao_contabil ? String(cfg.coluna_conciliacao_contabil) : '',
                    colunaConciliacaoFiscal: cfg.coluna_conciliacao_fiscal ? String(cfg.coluna_conciliacao_fiscal) : '',
                    diferencaImaterial: cfg.limite_diferenca_imaterial ?? null,
                    inverterSinal: !!cfg.inverter_sinal_fiscal,
                });

                // load columns for bases referenced by the config
                if (cfg.base_contabil_id) {
                    getBaseColumns(cfg.base_contabil_id).then((r: any) => {
                        const rows = r.data?.data || [];
                        const cols = rows.map((c: any) => ({ excel: c.excel_name, sqlite: c.sqlite_name, index: String(c.col_index) }));
                        setColsContabeis(cols);
                    }).catch(() => setColsContabeis([]));
                }

                if (cfg.base_fiscal_id) {
                    getBaseColumns(cfg.base_fiscal_id).then((r: any) => {
                        const rows = r.data?.data || [];
                        const cols = rows.map((c: any) => ({ excel: c.excel_name, sqlite: c.sqlite_name, index: String(c.col_index) }));
                        setColsFiscais(cols);
                    }).catch(() => setColsFiscais([]));
                }
            })
            .catch(() => toast.error('Falha ao carregar configuração'));

        return () => { mounted = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    const onSubmit = async (values: FormValues) => {
        if (!id) return;
        try {
            const payload = {
                nome: values.nome,
                base_contabil_id: Number(values.baseContabilId),
                base_fiscal_id: Number(values.baseFiscalId),
                chaves_contabil: values.chavesContabeis || [],
                chaves_fiscal: values.chavesFiscais || [],
                coluna_conciliacao_contabil: values.colunaConciliacaoContabil || null,
                coluna_conciliacao_fiscal: values.colunaConciliacaoFiscal || null,
                inverter_sinal_fiscal: !!values.inverterSinal,
                limite_diferenca_imaterial: values.diferencaImaterial ?? null,
            } as any;
            await updateConfigConciliacao(Number(id), payload);
            toast.success('Configuração atualizada');
            navigate('/configs/conciliacao');
        } catch (err: any) {
            console.error('update failed', err);
            toast.error(err?.response?.data?.error || 'Erro ao salvar configuração');
        }
    };

    const handleDelete = async () => {
        if (!id) return;
        try {
            await deleteConfigConciliacao(Number(id));
            toast.success('Configuração excluída');
            navigate('/configs/conciliacao');
        } catch (err: any) {
            console.error('delete failed', err);
            toast.error(err?.response?.data?.error || 'Falha ao excluir configuração');
        }
    };

    return (
        <div className="p-4">
            <Card>
                <CardHeader>
                    <CardTitle>Editar Configuração de Conciliação</CardTitle>
                </CardHeader>
                <CardContent>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                            <FormField
                                control={form.control}
                                name="nome"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Nome da Configuração</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Ex: Conciliação Principal" {...field} />
                                        </FormControl>
                                        <FormDescription>Nome identificador da configuração</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="baseContabilId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Base Contábil</FormLabel>
                                            <FormControl>
                                                <Select onValueChange={field.onChange} value={field.value ?? ''}>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Selecione a base contábil" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {bases.filter((b: any) => b.tipo === 'CONTABIL').map((base: any) => (
                                                            <SelectItem key={String(base.id)} value={String(base.id)}>
                                                                {base.nome}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="baseFiscalId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Base Fiscal</FormLabel>
                                            <FormControl>
                                                <Select onValueChange={field.onChange} value={field.value ?? ''}>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Selecione a base fiscal" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {bases.filter((b: any) => b.tipo === 'FISCAL').map((base: any) => (
                                                            <SelectItem key={String(base.id)} value={String(base.id)}>
                                                                {base.nome}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            <FormField
                                control={form.control}
                                name="chavesContabeis"
                                render={({ field }) => (
                                    <FormItem>
                                        <div className="mb-4">
                                            <FormLabel className="text-base">Chaves Contábeis</FormLabel>
                                            <FormDescription>Selecione as colunas que serão usadas como chave na base contábil</FormDescription>
                                        </div>

                                        <div className="flex items-center gap-2 flex-wrap mb-2">
                                            {(field.value || []).map((val: string) => {
                                                const item = colsContabeis.find((c: any) => (c.sqlite || c.excel || c.index) === val);
                                                const label = item?.excel || item?.sqlite || val;
                                                return (
                                                    <Badge key={val} variant="secondary" className="flex items-center gap-2">
                                                        <span className="font-mono text-xs">{label}</span>
                                                        <button type="button" className="p-1" onClick={() => field.onChange((field.value || []).filter((v: string) => v !== val))}>
                                                            <X className="h-3 w-3" />
                                                        </button>
                                                    </Badge>
                                                );
                                            })}
                                        </div>

                                        <div>
                                            {colsContabeis.length > 0 ? (
                                                <FormControl>
                                                    <Select onValueChange={(val: string) => {
                                                        if (!(field.value || []).includes(val)) field.onChange([...(field.value || []), val]);
                                                    }}>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Selecione colunas" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {colsContabeis.map((c: any) => (
                                                                <SelectItem key={c.index} value={c.sqlite || c.excel || c.index}>{c.excel || c.sqlite || c.index}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl>
                                            ) : (
                                                <FormControl>
                                                    <Input placeholder="Escolha uma base para carregar colunas" />
                                                </FormControl>
                                            )}
                                        </div>

                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="chavesFiscais"
                                render={({ field }) => (
                                    <FormItem>
                                        <div className="mb-4">
                                            <FormLabel className="text-base">Chaves Fiscais</FormLabel>
                                            <FormDescription>Selecione as colunas que serão usadas como chave na base fiscal</FormDescription>
                                        </div>

                                        <div className="flex items-center gap-2 flex-wrap mb-2">
                                            {(field.value || []).map((val: string) => {
                                                const item = colsFiscais.find((c: any) => (c.sqlite || c.excel || c.index) === val);
                                                const label = item?.excel || item?.sqlite || val;
                                                return (
                                                    <Badge key={val} variant="secondary" className="flex items-center gap-2">
                                                        <span className="font-mono text-xs">{label}</span>
                                                        <button type="button" className="p-1" onClick={() => field.onChange((field.value || []).filter((v: string) => v !== val))}>
                                                            <X className="h-3 w-3" />
                                                        </button>
                                                    </Badge>
                                                );
                                            })}
                                        </div>

                                        <div>
                                            {colsFiscais.length > 0 ? (
                                                <FormControl>
                                                    <Select onValueChange={(val: string) => {
                                                        if (!(field.value || []).includes(val)) field.onChange([...(field.value || []), val]);
                                                    }}>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Selecione colunas" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {colsFiscais.map((c: any) => (
                                                                <SelectItem key={c.index} value={c.sqlite || c.excel || c.index}>{c.excel || c.sqlite || c.index}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl>
                                            ) : (
                                                <FormControl>
                                                    <Input placeholder="Escolha uma base para carregar colunas" />
                                                </FormControl>
                                            )}
                                        </div>

                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="colunaConciliacaoContabil"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Coluna de Conciliação (Contábil)</FormLabel>
                                        <FormDescription>Coluna usada para comparar valores na base contábil</FormDescription>
                                        <FormControl>
                                            {colsContabeis.length > 0 ? (
                                                <Select onValueChange={field.onChange} value={field.value ?? ''}>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Selecione a coluna contábil" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {colsContabeis.map((c: any) => (
                                                            <SelectItem key={c.index} value={c.sqlite || c.excel || c.index}>{c.excel || c.sqlite || c.index}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            ) : (
                                                <Input placeholder="Escolha uma base contábil para carregar colunas" />
                                            )}
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="colunaConciliacaoFiscal"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Coluna de Conciliação (Fiscal)</FormLabel>
                                        <FormDescription>Coluna usada para comparar valores na base fiscal</FormDescription>
                                        <FormControl>
                                            {colsFiscais.length > 0 ? (
                                                <Select onValueChange={field.onChange} value={field.value ?? ''}>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Selecione a coluna fiscal" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {colsFiscais.map((c: any) => (
                                                            <SelectItem key={c.index} value={c.sqlite || c.excel || c.index}>{c.excel || c.sqlite || c.index}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            ) : (
                                                <Input placeholder="Escolha uma base fiscal para carregar colunas" />
                                            )}
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="diferencaImaterial"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Diferença Imaterial (opcional)</FormLabel>
                                        <FormControl>
                                            <Input type="number" step="0.01" placeholder="Ex: 0.01" value={field.value === null || field.value === undefined ? '' : String(field.value)} onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))} />
                                        </FormControl>
                                        <FormDescription>Diferenças abaixo deste valor serão consideradas imateriais</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="inverterSinal"
                                render={({ field }) => (
                                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                        <div className="space-y-0.5">
                                            <FormLabel className="text-base">Inverter Sinal</FormLabel>
                                            <FormDescription>Inverter o sinal dos valores da base fiscal durante a conciliação</FormDescription>
                                        </div>
                                        <FormControl>
                                            <Switch checked={!!field.value} onCheckedChange={field.onChange as any} />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />

                            <div className="flex gap-4">
                                <Button type="submit">Salvar Alterações</Button>
                                <Button type="button" variant="destructive" onClick={handleDelete}><Trash2 className="mr-2 h-4 w-4" />Excluir</Button>
                                <Button type="button" variant="outline" onClick={() => navigate('/configs/conciliacao')}>Cancelar</Button>
                            </div>
                        </form>
                    </Form>
                </CardContent>
            </Card>
        </div>
    );
};

export default EditConfigConciliacao;
