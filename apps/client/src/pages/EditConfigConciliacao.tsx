import React, { useEffect, useState, useCallback, useMemo } from 'react';
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
import PageSkeletonWrapper from '@/components/PageSkeletonWrapper';

const schema = z.object({
    nome: z.string().min(1),
    baseContabilId: z.string().nullable(),
    baseFiscalId: z.string().nullable(),
    // chaves agora serão gerenciadas como combinações separadas
    colunaConciliacaoContabil: z.string().optional(),
    colunaConciliacaoFiscal: z.string().optional(),
    diferencaImaterial: z.number().nullable().optional(),
    inverterSinal: z.boolean().optional(),
});

type FormValues = z.infer<typeof schema>;

const EditConfigConciliacao: React.FC = () => {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();

    type Base = { id: number; nome: string; tipo: 'CONTABIL' | 'FISCAL' | string };
    type Column = { excel?: string; sqlite?: string; index?: string };
    type ChaveCombination = { id: string; label: string; colunasContabil: string[]; colunasFiscal: string[] };

    const [bases, setBases] = useState<Base[]>([]);
    const [colsContabeis, setColsContabeis] = useState<Column[]>([]);
    const [colsFiscais, setColsFiscais] = useState<Column[]>([]);
    const [basesLoading, setBasesLoading] = useState<boolean>(true);
    const [configLoading, setConfigLoading] = useState<boolean>(true);
    const [chaves, setChaves] = useState<ChaveCombination[]>([]);

    const MSG = useMemo(() => ({
        LOAD_CONFIG_FAIL: 'Falha ao carregar configuração',
        SAVE_SUCCESS: 'Configuração atualizada',
        SAVE_FAIL: 'Erro ao salvar configuração',
        DELETE_SUCCESS: 'Configuração excluída',
        DELETE_FAIL: 'Falha ao excluir configuração',
    }), []);

    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            nome: '',
            baseContabilId: '',
            baseFiscalId: '',
            colunaConciliacaoContabil: '',
            colunaConciliacaoFiscal: '',
            diferencaImaterial: null,
            inverterSinal: false,
        },
    });

    useEffect(() => {
        let mounted = true;
        setBasesLoading(true);
        fetchBases()
            .then((r: any) => {
                if (!mounted) return;
                setBases((r.data?.data || r.data || []) as Base[]);
            })
            .catch(() => setBases([]))
            .finally(() => { if (mounted) setBasesLoading(false); });
        return () => { mounted = false; };
    }, []);

    const mapColumns = useCallback((rows: any[]): Column[] => {
        return (rows || []).map((c: any) => ({ excel: c.excel_name, sqlite: c.sqlite_name, index: String(c.col_index) }));
    }, []);

    const loadColumnsForBase = useCallback(async (baseId: string | number | undefined, setter: React.Dispatch<React.SetStateAction<Column[]>>) => {
        const idNum = baseId ? Number(baseId) : NaN;
        if (!idNum || Number.isNaN(idNum)) return setter([]);
        try {
            const res = await getBaseColumns(idNum);
            const rows = res.data?.data || [];
            setter(mapColumns(rows));
        } catch {
            setter([]);
        }
    }, [mapColumns]);

    useEffect(() => {
        // subscribe to base selection changes and load columns accordingly
        const sub = form.watch((_, { name }) => {
            if (name === 'baseContabilId') loadColumnsForBase(form.getValues('baseContabilId'), setColsContabeis);
            if (name === 'baseFiscalId') loadColumnsForBase(form.getValues('baseFiscalId'), setColsFiscais);
        });
        return () => sub.unsubscribe();
    }, [form, loadColumnsForBase]);

    useEffect(() => {
        let mounted = true;
        if (!id) return;
        const numId = Number(id);
        if (Number.isNaN(numId)) { setConfigLoading(false); return; }
        getConfigConciliacao(numId)
            .then((res: any) => {
                if (!mounted) return;
                const cfg = res.data?.data || res.data || {};
                const baseCont = cfg.base_contabil_id ? String(cfg.base_contabil_id) : '';
                const baseFisc = cfg.base_fiscal_id ? String(cfg.base_fiscal_id) : '';

                form.reset({
                    nome: cfg.nome || '',
                    baseContabilId: baseCont,
                    baseFiscalId: baseFisc,
                    colunaConciliacaoContabil: cfg.coluna_conciliacao_contabil ? String(cfg.coluna_conciliacao_contabil) : '',
                    colunaConciliacaoFiscal: cfg.coluna_conciliacao_fiscal ? String(cfg.coluna_conciliacao_fiscal) : '',
                    diferencaImaterial: cfg.limite_diferenca_imaterial ?? null,
                    inverterSinal: !!cfg.inverter_sinal_fiscal,
                });

                // ensure Selects show the saved bases and trigger watchers
                form.setValue('baseContabilId', baseCont, { shouldDirty: false, shouldTouch: false, shouldValidate: false });
                form.setValue('baseFiscalId', baseFisc, { shouldDirty: false, shouldTouch: false, shouldValidate: false });

                // normalize chaves into combinations (support legacy arrays)
                const parseChaves = (raw: any): Record<string, string[]> => {
                    try {
                        const p = raw || {};
                        if (Array.isArray(p)) return { CHAVE_1: p } as Record<string, string[]>;
                        if (p && typeof p === 'object') return p as Record<string, string[]>;
                        return {};
                    } catch { return {}; }
                };
                const chCont = parseChaves(cfg.chaves_contabil);
                const chFisc = parseChaves(cfg.chaves_fiscal);
                const keys = Array.from(new Set([...Object.keys(chCont || {}), ...Object.keys(chFisc || {})]));
                const combos: ChaveCombination[] = keys.map((k, i) => ({ id: k, label: `Chave ${i + 1}`, colunasContabil: chCont[k] || [], colunasFiscal: chFisc[k] || [] }));
                if (combos.length === 0) combos.push({ id: 'CHAVE_1', label: 'Chave 1', colunasContabil: [], colunasFiscal: [] });
                setChaves(combos);

                // load columns for bases referenced by the config
                if (cfg.base_contabil_id) loadColumnsForBase(cfg.base_contabil_id, setColsContabeis);
                if (cfg.base_fiscal_id) loadColumnsForBase(cfg.base_fiscal_id, setColsFiscais);
            })
            .catch(() => toast.error(MSG.LOAD_CONFIG_FAIL))
            .finally(() => { if (mounted) setConfigLoading(false); });

        return () => { mounted = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    const onSubmit = useCallback(async (values: FormValues) => {
        if (!id) return;
        try {
            // build chaves maps from combinations
            if (!chaves || chaves.length === 0) throw new Error('Adicione ao menos uma combinação de chaves');
            const hasValid = chaves.some(c => (c.colunasContabil?.length || 0) > 0 && (c.colunasFiscal?.length || 0) > 0);
            if (!hasValid) throw new Error('Pelo menos uma combinação deve ter colunas contábeis e fiscais');
            const chaves_contabil: Record<string, string[]> = {};
            const chaves_fiscal: Record<string, string[]> = {};
            chaves.forEach((c, idx) => {
                const idk = c.id || `CHAVE_${idx + 1}`;
                chaves_contabil[idk] = c.colunasContabil || [];
                chaves_fiscal[idk] = c.colunasFiscal || [];
            });

            const payload = {
                nome: values.nome,
                base_contabil_id: Number(values.baseContabilId),
                base_fiscal_id: Number(values.baseFiscalId),
                chaves_contabil,
                chaves_fiscal,
                coluna_conciliacao_contabil: values.colunaConciliacaoContabil || null,
                coluna_conciliacao_fiscal: values.colunaConciliacaoFiscal || null,
                inverter_sinal_fiscal: !!values.inverterSinal,
                limite_diferenca_imaterial: values.diferencaImaterial ?? null,
            } as any;
            await updateConfigConciliacao(Number(id), payload);
            toast.success(MSG.SAVE_SUCCESS);
            navigate('/configs/conciliacao');
        } catch (err: any) {
            console.error('update failed', err);
            toast.error(err?.response?.data?.error || MSG.SAVE_FAIL);
        }
    }, [chaves, id, navigate, MSG]);

    const handleDelete = useCallback(async () => {
        if (!id) return;
        try {
            await deleteConfigConciliacao(Number(id));
            toast.success(MSG.DELETE_SUCCESS);
            navigate('/configs/conciliacao');
        } catch (err: any) {
            console.error('delete failed', err);
            toast.error(err?.response?.data?.error || MSG.DELETE_FAIL);
        }
    }, [id, navigate, MSG]);

    const nextChaveLabel = useCallback((list: ChaveCombination[]) => `Chave ${list.length + 1}`, []);

    const addChave = useCallback(() => {
        setChaves(prev => {
            const id = `CHAVE_${prev.length + 1}`;
            return [...prev, { id, label: nextChaveLabel(prev), colunasContabil: [], colunasFiscal: [] }];
        });
    }, [nextChaveLabel]);

    const removeChave = useCallback((chaveId: string) => {
        setChaves(prev => prev.filter(c => c.id !== chaveId));
    }, []);

    const addColumnToChave = useCallback((chaveId: string, columnValue: string, side: 'contabil' | 'fiscal') => {
        setChaves(prev => prev.map(ch => {
            if (ch.id !== chaveId) return ch;
            const key = side === 'contabil' ? 'colunasContabil' : 'colunasFiscal';
            const existing = ch[key] || [];
            if (existing.includes(columnValue)) return ch;
            return { ...ch, [key]: [...existing, columnValue] } as ChaveCombination;
        }));
    }, []);

    const removeColumnFromChave = useCallback((chaveId: string, columnValue: string, side: 'contabil' | 'fiscal') => {
        setChaves(prev => prev.map(ch => {
            if (ch.id !== chaveId) return ch;
            const key = side === 'contabil' ? 'colunasContabil' : 'colunasFiscal';
            return { ...ch, [key]: (ch[key] || []).filter(v => v !== columnValue) } as ChaveCombination;
        }));
    }, []);

    return (
        <PageSkeletonWrapper loading={basesLoading || configLoading}>
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

                            {/* Combinações de chaves (edição) */}
                            <div>
                                <div className="mb-2 flex items-center justify-between">
                                    <div>
                                        <FormLabel className="text-base">Combinações de Chaves</FormLabel>
                                        <FormDescription>Defina uma ou mais combinações de colunas entre Base A e Base B</FormDescription>
                                    </div>
                                    <div>
                                        <Button type="button" onClick={addChave}>Adicionar combinação de chave</Button>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    {chaves.map((c, idx) => (
                                        <Card key={c.id}>
                                            <CardHeader>
                                                <div className="flex items-center justify-between w-full">
                                                    <CardTitle>{c.label}</CardTitle>
                                                    <div className="flex gap-2">
                                                        {chaves.length > 1 && (
                                                            <Button variant="destructive" size="sm" onClick={() => removeChave(c.id)}>Remover</Button>
                                                        )}
                                                    </div>
                                                </div>
                                            </CardHeader>
                                            <CardContent>
                                                <div className="grid md:grid-cols-2 gap-4">
                                                    <div>
                                                        <FormLabel>Colunas contábeis (Base A)</FormLabel>
                                                        <div className="flex flex-wrap gap-2 my-2">
                                                            {(c.colunasContabil || []).map(v => {
                                                                const item = colsContabeis.find(x => (x.sqlite || x.excel || x.index) === v);
                                                                const label = item?.excel || item?.sqlite || v;
                                                                return (
                                                                    <Badge key={v} variant="secondary" className="flex items-center gap-2">
                                                                        <span className="font-mono text-xs">{label}</span>
                                                                        <button type="button" className="p-1" onClick={() => removeColumnFromChave(c.id, v, 'contabil')}>
                                                                            <X className="h-3 w-3" />
                                                                        </button>
                                                                    </Badge>
                                                                );
                                                            })}
                                                        </div>
                                                        {colsContabeis.length > 0 ? (
                                                            <Select onValueChange={(val) => addColumnToChave(c.id, val, 'contabil')}>
                                                                <SelectTrigger>
                                                                    <SelectValue placeholder="Selecione colunas" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {colsContabeis.map((col) => (
                                                                        <SelectItem key={col.index} value={col.sqlite || col.excel || col.index}>{col.excel || col.sqlite || col.index}</SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        ) : (
                                                            <Input placeholder="Escolha a base para carregar colunas" />
                                                        )}
                                                    </div>

                                                    <div>
                                                        <FormLabel>Colunas fiscais (Base B)</FormLabel>
                                                        <div className="flex flex-wrap gap-2 my-2">
                                                            {(c.colunasFiscal || []).map(v => {
                                                                const item = colsFiscais.find(x => (x.sqlite || x.excel || x.index) === v);
                                                                const label = item?.excel || item?.sqlite || v;
                                                                return (
                                                                    <Badge key={v} variant="secondary" className="flex items-center gap-2">
                                                                        <span className="font-mono text-xs">{label}</span>
                                                                        <button type="button" className="p-1" onClick={() => removeColumnFromChave(c.id, v, 'fiscal')}>
                                                                            <X className="h-3 w-3" />
                                                                        </button>
                                                                    </Badge>
                                                                );
                                                            })}
                                                        </div>
                                                        {colsFiscais.length > 0 ? (
                                                            <Select onValueChange={(val) => addColumnToChave(c.id, val, 'fiscal')}>
                                                                <SelectTrigger>
                                                                    <SelectValue placeholder="Selecione colunas" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {colsFiscais.map((col) => (
                                                                        <SelectItem key={col.index} value={col.sqlite || col.excel || col.index}>{col.excel || col.sqlite || col.index}</SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        ) : (
                                                            <Input placeholder="Escolha a base para carregar colunas" />
                                                        )}
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    ))}
                                </div>
                            </div>

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
        </PageSkeletonWrapper>
    );
};

export default EditConfigConciliacao;
