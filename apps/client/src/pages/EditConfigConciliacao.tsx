import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trash2 } from 'lucide-react';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

import { fetchBases, getBaseColumns } from '@/services/baseService';
import { fetchKeys } from '@/services/keysService';
import { fetchKeysPairs } from '@/services/keysPairsService';
import { getConfigConciliacao, updateConfigConciliacao, deleteConfigConciliacao } from '@/services/configsService';
import type { Base, Column, KeyDefinition, KeyPair, KeyRow as KeyRowType } from '@/types/configs';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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

    // Using centralized types from `src/types/global.d.ts`:
    // - `Base` (interface)
    // - `Column` (type alias for BaseColumn)
    // - `KeyRow` (type for configured keys)

    const [bases, setBases] = useState<Base[]>([]);
    const [colsContabeis, setColsContabeis] = useState<Column[]>([]);
    const [colsFiscais, setColsFiscais] = useState<Column[]>([]);
    const [basesLoading, setBasesLoading] = useState<boolean>(true);
    const [configLoading, setConfigLoading] = useState<boolean>(true);
    const [chaves, setChaves] = useState<KeyRowType[]>([]);
    const [keysDefs, setKeysDefs] = useState<KeyDefinition[]>([]);
    const [keysPairs, setKeysPairs] = useState<KeyPair[]>([]);
    const baseColsCache = useRef<Map<number, Column[]>>(new Map());
    const [saving, setSaving] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deleting, setDeleting] = useState(false);

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

    const mapColumns = useCallback((rows: any[]): Column[] => {
        return (rows || []).map((c: any) => ({ excel: c.excel_name, sqlite: c.sqlite_name, index: String(c.col_index) }));
    }, []);

    const loadColumnsForBase = useCallback(async (baseId: string | number | undefined, setter: React.Dispatch<React.SetStateAction<Column[]>>) => {
        const idNum = baseId ? Number(baseId) : NaN;
        if (!idNum || Number.isNaN(idNum)) return setter([]);
        // cache
        if (baseColsCache.current.has(idNum)) {
            setter(baseColsCache.current.get(idNum)!);
            return;
        }
        try {
            const res = await getBaseColumns(idNum);
            const rows = res.data?.data || [];
            const mapped = mapColumns(rows);
            baseColsCache.current.set(idNum, mapped);
            setter(mapped);
        } catch {
            setter([]);
        }
    }, [mapColumns]);

    const baseContabilId = useWatch({ control: form.control, name: 'baseContabilId' });
    const baseFiscalId = useWatch({ control: form.control, name: 'baseFiscalId' });

    useEffect(() => {
        let cancelled = false;
        const id = baseContabilId ? Number(baseContabilId) : NaN;
        if (!id || Number.isNaN(id)) { setColsContabeis([]); return; }
        if (baseColsCache.current.has(id)) { setColsContabeis(baseColsCache.current.get(id)!); return; }
        (async () => {
            try {
                const res = await getBaseColumns(id);
                if (cancelled) return;
                const mapped = mapColumns(res.data?.data || []);
                baseColsCache.current.set(id, mapped);
                setColsContabeis(mapped);
            } catch (e) {
                if (cancelled) return;
                setColsContabeis([]);
            }
        })();
        return () => { cancelled = true; };
    }, [baseContabilId, mapColumns]);

    useEffect(() => {
        let cancelled = false;
        const id = baseFiscalId ? Number(baseFiscalId) : NaN;
        if (!id || Number.isNaN(id)) { setColsFiscais([]); return; }
        if (baseColsCache.current.has(id)) { setColsFiscais(baseColsCache.current.get(id)!); return; }
        (async () => {
            try {
                const res = await getBaseColumns(id);
                if (cancelled) return;
                const mapped = mapColumns(res.data?.data || []);
                baseColsCache.current.set(id, mapped);
                setColsFiscais(mapped);
            } catch (e) {
                if (cancelled) return;
                setColsFiscais([]);
            }
        })();
        return () => { cancelled = true; };
    }, [baseFiscalId, mapColumns]);

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

                // normalize chaves: prefer new `keys` contract, fallback to legacy chaves_contabil/chaves_fiscal
                if (Array.isArray(cfg.keys) && cfg.keys.length > 0) {
                    const rows: KeyRowType[] = cfg.keys.map((k: any, i: number) => ({
                        id: k.id ? String(k.id) : `KEY_${i + 1}`,
                        key_identifier: k.key_identifier || `CHAVE_${i + 1}`,
                        mode: k.keys_pair_id ? 'pair' : 'separate',
                        keys_pair_id: k.keys_pair_id ?? null,
                        contabil_key_id: k.contabil_key_id ?? null,
                        fiscal_key_id: k.fiscal_key_id ?? null,
                        ordem: k.ordem ?? (i + 1),
                    }));
                    setChaves(rows);
                } else {
                    // legacy: build placeholder KeyRows from legacy column maps (no mapping to central keys)
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
                    const rows: KeyRowType[] = keys.map((k, i) => ({ id: k, key_identifier: k, mode: 'separate', keys_pair_id: null, contabil_key_id: null, fiscal_key_id: null, ordem: i + 1 }));
                    if (rows.length === 0) rows.push({ id: 'KEY_1', key_identifier: 'CHAVE_1', mode: 'pair', keys_pair_id: null, contabil_key_id: null, fiscal_key_id: null, ordem: 1 });
                    setChaves(rows);
                }

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
        setSaving(true);
        try {
            if (!chaves || chaves.length === 0) throw new Error('Adicione ao menos uma chave');
            // validate and build keys payload
            const keysPayload = chaves.map((c, idx) => {
                const ordem = c.ordem ?? (idx + 1);
                const key_identifier = c.key_identifier || `CHAVE_${idx + 1}`;
                if (c.mode === 'pair') {
                    if (!c.keys_pair_id) throw new Error(`Chave ${key_identifier}: selecione um par de chaves`);
                    return { ordem, key_identifier, keys_pair_id: Number(c.keys_pair_id) } as any;
                }
                // separate
                if (!c.contabil_key_id || !c.fiscal_key_id) throw new Error(`Chave ${key_identifier}: selecione ambas as chaves (contábil e fiscal)`);
                return { ordem, key_identifier, contabil_key_id: Number(c.contabil_key_id), fiscal_key_id: Number(c.fiscal_key_id) } as any;
            });

            const payload = {
                nome: values.nome,
                base_contabil_id: Number(values.baseContabilId) || null,
                base_fiscal_id: Number(values.baseFiscalId) || null,
                keys: keysPayload,
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
        } finally {
            setSaving(false);
        }
    }, [chaves, id, navigate, MSG]);

    const handleDelete = useCallback(() => {
        setDeleteDialogOpen(true);
    }, []);

    const confirmDelete = useCallback(async () => {
        if (!id) return;
        setDeleting(true);
        try {
            await deleteConfigConciliacao(Number(id));
            toast.success(MSG.DELETE_SUCCESS);
            navigate('/configs/conciliacao');
        } catch (err: any) {
            console.error('delete failed', err);
            toast.error(err?.response?.data?.error || MSG.DELETE_FAIL);
        } finally {
            setDeleting(false);
            setDeleteDialogOpen(false);
        }
    }, [id, navigate, MSG]);

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

    const getKeyDefColumns = useCallback((def: any) => {
        if (!def) return [] as string[];
        const cols = def.columns;
        if (!cols) return [];
        if (typeof cols === 'string') {
            try { return JSON.parse(cols); } catch { return []; }
        }
        return Array.isArray(cols) ? cols : [];
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
                                                        <Input value={c.ordem ?? idx + 1} onChange={(e) => updateChave(c.id, { ordem: Number(e.target.value) })} className="w-20" />
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
                                                                {/* Show summary of columns for the selected pair, read-only */}
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

                                                                {/* show readonly summaries */}
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
                                <Button type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Salvar Alterações'}</Button>
                                <Button type="button" variant="destructive" onClick={handleDelete}><Trash2 className="mr-2 h-4 w-4" />Excluir</Button>
                                <Button type="button" variant="outline" onClick={() => navigate('/configs/conciliacao')}>Cancelar</Button>
                            </div>
                        </form>
                    </Form>
                </CardContent>
            </Card>
        </div>
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Confirmação de Exclusão</AlertDialogTitle>
                        <AlertDialogDescription>Deseja realmente excluir esta configuração? Esta ação não pode ser desfeita.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setDeleteDialogOpen(false)}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} disabled={deleting}>{deleting ? 'Excluindo...' : 'Excluir'}</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </PageSkeletonWrapper>
    );
};

export default EditConfigConciliacao;
