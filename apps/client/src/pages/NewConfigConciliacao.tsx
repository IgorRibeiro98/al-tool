import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft } from "lucide-react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import * as z from "zod";
import { fetchBases, getBaseColumns } from '@/services/baseService';
import { createConfigConciliacao } from '@/services/configsService';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';

const formSchema = z.object({
    nome: z.string().min(1, "Nome é obrigatório"),
    baseContabilId: z.string().min(1, "Base contábil é obrigatória"),
    baseFiscalId: z.string().min(1, "Base fiscal é obrigatória"),
    colunaConciliacaoContabil: z.string().min(1, "Coluna de conciliação contábil é obrigatória"),
    colunaConciliacaoFiscal: z.string().min(1, "Coluna de conciliação fiscal é obrigatória"),
    inverterSinal: z.boolean().default(false),
    diferencaImaterial: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

const NewConfigConciliacao = () => {
    const navigate = useNavigate();

    const [bases, setBases] = useState<Base[]>([]);
    const [colsContabeis, setColsContabeis] = useState<Array<{ excel?: string; sqlite?: string; index: string }>>([]);
    const [colsFiscais, setColsFiscais] = useState<Array<{ excel?: string; sqlite?: string; index: string }>>([]);
    type ChaveCombination = { id: string; label: string; colunasContabil: string[]; colunasFiscal: string[] };
    const [chaves, setChaves] = useState<ChaveCombination[]>([{ id: 'CHAVE_1', label: 'Chave 1', colunasContabil: [], colunasFiscal: [] }]);

    const mountedRef = useRef(true);
    useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

    const MSG = useMemo(() => ({
        LOAD_BASES_FAIL: 'Falha ao carregar bases',
        LOAD_COLS_FAIL: 'Falha ao carregar colunas',
        SAVE_SUCCESS: 'Configuração de conciliação criada com sucesso!',
        SAVE_FAIL: 'Falha ao criar configuração',
    }), []);

    const mapColumns = useCallback((rows: any[]) => (rows || []).map((c: any) => ({ excel: c.excel_name, sqlite: c.sqlite_name, index: String(c.col_index) })), []);

    const loadColumnsForBase = useCallback(async (baseId: string | number | undefined, setter: React.Dispatch<React.SetStateAction<any[]>>) => {
        const id = baseId ? Number(baseId) : NaN;
        if (!id || Number.isNaN(id)) return setter([]);
        try {
            const res = await getBaseColumns(id);
            const rows = res.data?.data || res.data || [];
            if (mountedRef.current) setter(mapColumns(rows));
        } catch (err) {
            console.error('failed to load columns', err);
            toast.error(MSG.LOAD_COLS_FAIL);
            if (mountedRef.current) setter([]);
        }
    }, [mapColumns, MSG]);

    // Note: using Select for column autocomplete (like NewConfigEstorno)

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            nome: "",
            baseContabilId: "",
            baseFiscalId: "",
            colunaConciliacaoContabil: "",
            colunaConciliacaoFiscal: "",
            inverterSinal: false,
            diferencaImaterial: "",
        },
    });

    useEffect(() => {
        let mounted = true;
        fetchBases().then(r => {
            if (!mounted) return;
            setBases(r.data.data || []);
        }).catch(err => { console.error('failed to fetch bases', err); setBases([]); });
        return () => { mounted = false; };
    }, []);

    // load columns when base selections change
    const watchBaseCont = form.watch('baseContabilId');
    const watchBaseFisc = form.watch('baseFiscalId');

    useEffect(() => {
        void loadColumnsForBase(watchBaseCont, setColsContabeis);
    }, [watchBaseCont, loadColumnsForBase]);

    useEffect(() => {
        void loadColumnsForBase(watchBaseFisc, setColsFiscais);
    }, [watchBaseFisc, loadColumnsForBase]);

    const onSubmit = useCallback(async (data: FormValues) => {
        try {
            // validate chaves combinations
            if (!chaves || chaves.length === 0) throw new Error('Adicione ao menos uma combinação de chaves');
            const hasValid = chaves.some(c => (c.colunasContabil?.length || 0) > 0 && (c.colunasFiscal?.length || 0) > 0);
            if (!hasValid) throw new Error('Pelo menos uma combinação deve ter colunas contábeis e fiscais');

            const chaves_contabil: Record<string, string[]> = {};
            const chaves_fiscal: Record<string, string[]> = {};
            chaves.forEach((c, idx) => {
                const id = c.id || `CHAVE_${idx + 1}`;
                chaves_contabil[id] = c.colunasContabil || [];
                chaves_fiscal[id] = c.colunasFiscal || [];
            });

            const payload = {
                nome: data.nome,
                base_contabil_id: Number(data.baseContabilId),
                base_fiscal_id: Number(data.baseFiscalId),
                chaves_contabil,
                chaves_fiscal,
                coluna_conciliacao_contabil: data.colunaConciliacaoContabil,
                coluna_conciliacao_fiscal: data.colunaConciliacaoFiscal,
                inverter_sinal_fiscal: !!data.inverterSinal,
                limite_diferenca_imaterial: data.diferencaImaterial ? Number(data.diferencaImaterial) : null,
            } as any;
            await createConfigConciliacao(payload);
            toast.success(MSG.SAVE_SUCCESS);
            navigate("/configs/conciliacao");
        } catch (err: any) {
            console.error('create conciliacao failed', err);
            toast.error(err?.response?.data?.error || MSG.SAVE_FAIL);
        }
    }, [chaves, navigate, MSG]);

    const nextChaveLabel = useCallback((list: ChaveCombination[]) => `Chave ${list.length + 1}`, []);

    const addChave = useCallback(() => {
        setChaves(prev => {
            const id = `CHAVE_${prev.length + 1}`;
            return [...prev, { id, label: nextChaveLabel(prev), colunasContabil: [], colunasFiscal: [] }];
        });
    }, [nextChaveLabel]);

    const removeChave = useCallback((id: string) => setChaves(prev => prev.filter(c => c.id !== id)), []);

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
        setChaves(prev => prev.map(ch => ch.id === chaveId ? { ...ch, [side === 'contabil' ? 'colunasContabil' : 'colunasFiscal']: (ch[side === 'contabil' ? 'colunasContabil' : 'colunasFiscal'] || []).filter(v => v !== columnValue) } as ChaveCombination : ch));
    }, []);

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => navigate("/configs/conciliacao")}>
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <div>
                    <h1 className="text-3xl font-bold">Nova Configuração de Conciliação</h1>
                    <p className="text-muted-foreground">Defina as regras para conciliação entre bases</p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Informações da Configuração</CardTitle>
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
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Selecione a base contábil" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {bases
                                                            .filter((b) => b.tipo === "CONTABIL")
                                                            .map((base) => (
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
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Selecione a base fiscal" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {bases
                                                            .filter((b) => b.tipo === "FISCAL")
                                                            .map((base) => (
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

                            {/* Combinações de chaves: uma lista de combinações (CHAVE_1, CHAVE_2, ...) */}
                            <div>
                                <div className="mb-2 flex items-center justify-between">
                                    <div>
                                        <FormLabel className="text-base">Combinações de Chaves</FormLabel>
                                        <FormDescription>Defina uma ou mais combinações de colunas entre Base A e Base B</FormDescription>
                                    </div>
                                    <div>
                                        <Button type="button" onClick={() => {
                                            const next = chaves.length + 1;
                                            setChaves([...chaves, { id: `CHAVE_${next}`, label: `Chave ${next}`, colunasContabil: [], colunasFiscal: [] }]);
                                        }}>Adicionar combinação de chave</Button>
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
                                                            <Button variant="destructive" size="sm" onClick={() => setChaves(chaves.filter(x => x.id !== c.id))}>Remover</Button>
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
                                                                        <button type="button" className="p-1" onClick={() => setChaves(chaves.map(ch => ch.id === c.id ? { ...ch, colunasContabil: (ch.colunasContabil || []).filter(x => x !== v) } : ch))}>
                                                                            <X className="h-3 w-3" />
                                                                        </button>
                                                                    </Badge>
                                                                );
                                                            })}
                                                        </div>
                                                        {colsContabeis.length > 0 ? (
                                                            <Select onValueChange={(val) => {
                                                                setChaves(chaves.map(ch => ch.id === c.id ? { ...ch, colunasContabil: (ch.colunasContabil || []).includes(val) ? ch.colunasContabil : [...(ch.colunasContabil || []), val] } : ch));
                                                            }}>
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
                                                                        <button type="button" className="p-1" onClick={() => setChaves(chaves.map(ch => ch.id === c.id ? { ...ch, colunasFiscal: (ch.colunasFiscal || []).filter(x => x !== v) } : ch))}>
                                                                            <X className="h-3 w-3" />
                                                                        </button>
                                                                    </Badge>
                                                                );
                                                            })}
                                                        </div>
                                                        {colsFiscais.length > 0 ? (
                                                            <Select onValueChange={(val) => {
                                                                setChaves(chaves.map(ch => ch.id === c.id ? { ...ch, colunasFiscal: (ch.colunasFiscal || []).includes(val) ? ch.colunasFiscal : [...(ch.colunasFiscal || []), val] } : ch));
                                                            }}>
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

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="colunaConciliacaoContabil"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Coluna de Conciliação (Contábil)</FormLabel>
                                            {colsContabeis.length > 0 ? (
                                                <FormControl>
                                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Selecione a coluna de conciliação" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {colsContabeis.map((c) => (
                                                                <SelectItem key={c.index} value={c.sqlite || c.excel || c.index}>{c.excel || c.sqlite || c.index}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl>
                                            ) : (
                                                <FormControl>
                                                    <Input placeholder="Escolha uma base para carregar colunas" {...field} />
                                                </FormControl>
                                            )}
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
                                            {colsFiscais.length > 0 ? (
                                                <FormControl>
                                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Selecione a coluna de conciliação" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {colsFiscais.map((c) => (
                                                                <SelectItem key={c.index} value={c.sqlite || c.excel || c.index}>{c.excel || c.sqlite || c.index}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl>
                                            ) : (
                                                <FormControl>
                                                    <Input placeholder="Escolha uma base para carregar colunas" {...field} />
                                                </FormControl>
                                            )}
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            <FormField
                                control={form.control}
                                name="diferencaImaterial"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Diferença Imaterial (opcional)</FormLabel>
                                        <FormControl>
                                            <Input type="number" step="0.01" placeholder="Ex: 0.01" {...field} />
                                        </FormControl>
                                        <FormDescription>
                                            Diferenças abaixo deste valor serão consideradas imateriais
                                        </FormDescription>
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
                                            <FormDescription>
                                                Inverter o sinal dos valores da base fiscal durante a conciliação
                                            </FormDescription>
                                        </div>
                                        <FormControl>
                                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />

                            <div className="flex gap-4">
                                <Button type="submit">Criar Configuração</Button>
                                <Button type="button" variant="outline" onClick={() => navigate("/configs/conciliacao")}>
                                    Cancelar
                                </Button>
                            </div>
                        </form>
                    </Form>
                </CardContent>
            </Card>
        </div>
    );
};

export default NewConfigConciliacao;
