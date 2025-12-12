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
import { fetchKeys } from '@/services/keysService';
import { fetchKeysPairs } from '@/services/keysPairsService';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useWatch } from 'react-hook-form';
import type { Base, Column, KeyPair, KeyRow, KeyDefinition } from '@/types/configs';

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
    const [colsContabeis, setColsContabeis] = useState<Column[]>([]);
    const [colsFiscais, setColsFiscais] = useState<Column[]>([]);
    // Using centralized `Base`, `Column` and `KeyRow` types from `src/types/global.d.ts`
    const [chaves, setChaves] = useState<KeyRow[]>([{ id: 'KEY_1', key_identifier: 'CHAVE_1', mode: 'pair', keys_pair_id: null, contabil_key_id: null, fiscal_key_id: null, ordem: 1 }]);
    const [keysDefs, setKeysDefs] = useState<KeyDefinition[]>([]);
    const [keysPairs, setKeysPairs] = useState<KeyPair[]>([]);
    const baseColsCache = useRef<Map<number, Column[]>>(new Map());
    const [saving, setSaving] = useState(false);

    const mountedRef = useRef(true);
    useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

    const MSG = useMemo(() => ({
        LOAD_BASES_FAIL: 'Falha ao carregar bases',
        LOAD_COLS_FAIL: 'Falha ao carregar colunas',
        SAVE_SUCCESS: 'Configuração de conciliação criada com sucesso!',
        SAVE_FAIL: 'Falha ao criar configuração',
    }), []);

    const mapColumns = useCallback((rows: any[]): Column[] => (rows || []).map((c: any) => ({ excel: c.excel_name, sqlite: c.sqlite_name, index: String(c.col_index) })), []);

    const loadColumnsForBase = useCallback(async (baseId: string | number | undefined, setter: React.Dispatch<React.SetStateAction<Column[]>>) => {
        const id = baseId ? Number(baseId) : NaN;
        if (!id || Number.isNaN(id)) return setter([]);
        // return cached if available
        if (baseColsCache.current.has(id)) {
            setter(baseColsCache.current.get(id)!);
            return;
        }
        try {
            const res = await getBaseColumns(id);
            const rows = res.data?.data || res.data || [];
            const mapped = mapColumns(rows);
            if (mountedRef.current) {
                baseColsCache.current.set(id, mapped);
                setter(mapped);
            }
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

    useEffect(() => {
        let mounted = true;
        fetchKeys()
            .then((r: any) => { if (!mounted) return; setKeysDefs(r.data?.data || r.data || []); })
            .catch(() => { if (!mounted) return; setKeysDefs([]); });
        fetchKeysPairs()
            .then((r: any) => { if (!mounted) return; setKeysPairs(r.data?.data || r.data || []); })
            .catch(() => { if (!mounted) return; setKeysPairs([]); });
        return () => { mounted = false; };
    }, []);

    const contabilKeys = useMemo(() => keysDefs.filter(k => (k.base_tipo || '').toUpperCase() === 'CONTABIL'), [keysDefs]);
    const fiscalKeys = useMemo(() => keysDefs.filter(k => (k.base_tipo || '').toUpperCase() === 'FISCAL'), [keysDefs]);

    const getKeyDefColumns = useCallback((def: any) => {
        if (!def) return [] as string[];
        const cols = def.columns;
        if (!cols) return [];
        if (typeof cols === 'string') {
            try { return JSON.parse(cols); } catch { return []; }
        }
        return Array.isArray(cols) ? cols : [];
    }, []);

    const resolvedChaves = useMemo(() => chaves.map((c) => {
        const pair = keysPairs.find((p) => Number(p.id) === Number(c.keys_pair_id));
        const contDef = keysDefs.find(k => Number(k.id) === Number(pair?.contabil_key_id ?? c.contabil_key_id));
        const fiscDef = keysDefs.find(k => Number(k.id) === Number(pair?.fiscal_key_id ?? c.fiscal_key_id));
        const contCols = getKeyDefColumns(contDef as any);
        const fiscCols = getKeyDefColumns(fiscDef as any);
        return { ...c, pair, contDef, fiscDef, contCols, fiscCols };
    }), [chaves, keysDefs, keysPairs]);

    // load columns when base selections change
    const watchBaseCont = useWatch({ control: form.control, name: 'baseContabilId' });
    const watchBaseFisc = useWatch({ control: form.control, name: 'baseFiscalId' });

    useEffect(() => {
        void loadColumnsForBase(watchBaseCont, setColsContabeis);
    }, [watchBaseCont, loadColumnsForBase]);

    useEffect(() => {
        void loadColumnsForBase(watchBaseFisc, setColsFiscais);
    }, [watchBaseFisc, loadColumnsForBase]);

    const nextKeyIdentifier = useCallback((list: KeyRow[]) => `CHAVE_${list.length + 1}`, []);

    const addChave = useCallback(() => {
        setChaves(prev => {
            const id = `KEY_${prev.length + 1}`;
            const identifier = nextKeyIdentifier(prev);
            return [...prev, { id, key_identifier: identifier, mode: 'pair', keys_pair_id: null, contabil_key_id: null, fiscal_key_id: null, ordem: prev.length + 1 }];
        });
    }, [nextKeyIdentifier]);

    const removeChave = useCallback((chaveId: string) => {
        setChaves(prev => prev.filter(c => c.id !== chaveId));
    }, []);

    const updateChave = useCallback((chaveId: string, patch: Partial<KeyRow>) => {
        setChaves(prev => prev.map(c => c.id === chaveId ? { ...c, ...patch } : c));
    }, []);

    const onSubmit = useCallback(async (data: FormValues) => {
        setSaving(true);
        try {
            if (!chaves || chaves.length === 0) throw new Error('Adicione ao menos uma chave');
            const keysPayload = chaves.map((c, idx) => {
                const ordem = c.ordem ?? (idx + 1);
                const key_identifier = c.key_identifier || `CHAVE_${idx + 1}`;
                if (c.mode === 'pair') {
                    if (!c.keys_pair_id) throw new Error(`Chave ${key_identifier}: selecione um par de chaves`);
                    return { ordem, key_identifier, keys_pair_id: Number(c.keys_pair_id) } as any;
                }
                if (!c.contabil_key_id || !c.fiscal_key_id) throw new Error(`Chave ${key_identifier}: selecione ambas as chaves (contábil e fiscal)`);
                return { ordem, key_identifier, contabil_key_id: Number(c.contabil_key_id), fiscal_key_id: Number(c.fiscal_key_id) } as any;
            });

            const payload = {
                nome: data.nome,
                base_contabil_id: Number(data.baseContabilId) || null,
                base_fiscal_id: Number(data.baseFiscalId) || null,
                keys: keysPayload,
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
        } finally {
            setSaving(false);
        }
    }, [chaves, navigate, MSG]);

    

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

                            {/* Chaves da Conciliação (seleção de chaves centrais ou pares) */}
                            <div>
                                <div className="mb-2 flex items-center justify-between">
                                    <div>
                                        <FormLabel className="text-base">Chaves da Conciliação</FormLabel>
                                        <FormDescription>Selecione chaves centrais ou pares de chaves para usar na conciliação</FormDescription>
                                    </div>
                                    <div>
                                        <Button type="button" onClick={addChave}>Adicionar chave</Button>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    {chaves.map((c, idx) => (
                                        <Card key={c.id}>
                                            <CardHeader>
                                                <div className="flex items-center justify-between w-full">
                                                    <CardTitle>{c.key_identifier || `CHAVE_${idx + 1}`}</CardTitle>
                                                    <div className="flex gap-2">
                                                        <Input value={String(c.ordem ?? (idx + 1))} onChange={(e) => updateChave(c.id, { ordem: Number(e.target.value) })} className="w-20" />
                                                        {chaves.length > 1 && (
                                                            <Button variant="destructive" size="sm" onClick={() => removeChave(c.id)}>Remover</Button>
                                                        )}
                                                    </div>
                                                </div>
                                            </CardHeader>
                                            <CardContent>
                                                <div className="grid md:grid-cols-3 gap-4">
                                                    <div>
                                                        <FormLabel>Identificador</FormLabel>
                                                        <Input value={c.key_identifier} onChange={(e) => updateChave(c.id, { key_identifier: e.target.value })} />
                                                    </div>

                                                    <div>
                                                        <FormLabel>Modo</FormLabel>
                                                        <Select onValueChange={(val) => updateChave(c.id, { mode: val as any })} value={c.mode}>
                                                            <SelectTrigger>
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="pair">Par de chaves</SelectItem>
                                                                <SelectItem value="separate">Chaves separadas</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>

                                                    <div>
                                                        <FormLabel>Seleção</FormLabel>
                                                        {c.mode === 'pair' ? (
                                                            <div className="space-y-2">
                                                                <Select onValueChange={(val) => updateChave(c.id, { keys_pair_id: val ? Number(val) : null })} value={c.keys_pair_id ? String(c.keys_pair_id) : ''}>
                                                                    <SelectTrigger>
                                                                        <SelectValue placeholder="Selecione um par de chaves" />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {keysPairs.map((kp: any) => (
                                                                            <SelectItem key={String(kp.id)} value={String(kp.id)}>{kp.nome || `Par ${kp.id}`}</SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>
                                                                {c.keys_pair_id && (() => {
                                                                    const pair = keysPairs.find((p: any) => Number(p.id) === Number(c.keys_pair_id));
                                                                    const contDef = keysDefs.find(k => Number(k.id) === Number(pair?.contabil_key_id));
                                                                    const fiscDef = keysDefs.find(k => Number(k.id) === Number(pair?.fiscal_key_id));
                                                                    const contCols = getKeyDefColumns(contDef);
                                                                    const fiscCols = getKeyDefColumns(fiscDef);
                                                                    return (
                                                                        <div>
                                                                            <div className="text-xs text-muted-foreground">Contábil: {contCols.join(', ') || '—'}</div>
                                                                            <div className="text-xs text-muted-foreground">Fiscal: {fiscCols.join(', ') || '—'}</div>
                                                                        </div>
                                                                    );
                                                                })()}
                                                            </div>
                                                        ) : (
                                                            <div className="space-y-2">
                                                                <Select onValueChange={(val) => updateChave(c.id, { contabil_key_id: val ? Number(val) : null })} value={c.contabil_key_id ? String(c.contabil_key_id) : ''}>
                                                                    <SelectTrigger>
                                                                        <SelectValue placeholder="Selecione chave contábil" />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {keysDefs.filter(k => (k.base_tipo || '').toUpperCase() === 'CONTABIL').map((k: any) => (
                                                                            <SelectItem key={String(k.id)} value={String(k.id)}>{k.key_identifier || k.nome || `Key ${k.id}`}</SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>

                                                                <Select onValueChange={(val) => updateChave(c.id, { fiscal_key_id: val ? Number(val) : null })} value={c.fiscal_key_id ? String(c.fiscal_key_id) : ''}>
                                                                    <SelectTrigger>
                                                                        <SelectValue placeholder="Selecione chave fiscal" />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {keysDefs.filter(k => (k.base_tipo || '').toUpperCase() === 'FISCAL').map((k: any) => (
                                                                            <SelectItem key={String(k.id)} value={String(k.id)}>{k.key_identifier || k.nome || `Key ${k.id}`}</SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>

                                                                {(() => {
                                                                    const contDef = keysDefs.find(k => Number(k.id) === Number(c.contabil_key_id));
                                                                    const fiscDef = keysDefs.find(k => Number(k.id) === Number(c.fiscal_key_id));
                                                                    const contCols = getKeyDefColumns(contDef);
                                                                    const fiscCols = getKeyDefColumns(fiscDef);
                                                                    return (
                                                                        <div>
                                                                            <div className="text-xs text-muted-foreground">Contábil: {contCols.join(', ') || '—'}</div>
                                                                            <div className="text-xs text-muted-foreground">Fiscal: {fiscCols.join(', ') || '—'}</div>
                                                                        </div>
                                                                    );
                                                                })()}
                                                            </div>
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
