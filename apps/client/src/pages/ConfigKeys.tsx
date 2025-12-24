import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FC } from 'react';
import { useWatch } from 'react-hook-form';
import PageSkeletonWrapper from '@/components/PageSkeletonWrapper';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
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
import { Form, FormItem, FormLabel, FormControl } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { fetchBaseSubtypes, fetchBases, getBaseColumns } from '@/services/baseService';
import { fetchKeys, createKey, updateKey, deleteKey } from '@/services/keysService';
import type { KeyItem as KeyItemType, Base, BaseColumn } from '@/types/keys';

type KeyItem = KeyItemType;

const SCOPE = 'ConfigKeys';

const KeyRowInner: FC<{ item: KeyItem; onEdit: (it: KeyItem) => void; onRequestDelete: (id?: number) => void }> = ({ item, onEdit, onRequestDelete }) => {
    return (
        <div className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50 transition-colors">
            <div>
                <p className="font-medium">{item.nome}</p>
                <div className="text-sm text-muted-foreground">{item.base_tipo} {item.base_subtipo ? ` / ${item.base_subtipo}` : ''}</div>
                <div className="flex gap-2 mt-2 flex-wrap">
                    {(item.columns || []).map((c) => (
                        <span key={c} className="px-2 py-0.5 rounded bg-muted text-xs font-mono">{c}</span>
                    ))}
                </div>
            </div>

            <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" aria-label={`Editar ${item.nome}`} onClick={() => onEdit(item)}>
                    <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" aria-label={`Remover ${item.nome}`} onClick={() => onRequestDelete(item.id)}>
                    <Trash2 className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
};

const KeyRow = React.memo(KeyRowInner);

const ConfigKeys: FC = () => {
    const navigate = useNavigate();

    const [items, setItems] = useState<KeyItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [deletePending, setDeletePending] = useState<number | null>(null);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

    // dialog/form state
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<KeyItem | null>(null);

    const [subtypes, setSubtypes] = useState<{ id: number; name: string }[]>([]);
    const [bases, setBases] = useState<Base[]>([]);
    const [selectedBaseId, setSelectedBaseId] = useState<number | null>(null);
    const [baseColumnsItems, setBaseColumnsItems] = useState<BaseColumn[]>([]);
    const [colsSelectOpen, setColsSelectOpen] = useState(false);
    const baseColsCache = useRef(new Map<number, BaseColumn[]>());

    useEffect(() => {
        let mounted = true;
        (async () => {
            if (!selectedBaseId) {
                setBaseColumnsItems([]);
                return;
            }
            if (baseColsCache.current.has(selectedBaseId)) {
                setBaseColumnsItems(baseColsCache.current.get(selectedBaseId)!);
                return;
            }
            try {
                const r = await getBaseColumns(selectedBaseId);
                if (!mounted) return;
                const cols = (r.data.data ?? []).map((c: any) => ({ sqlite_name: String(c.sqlite_name), excel_name: (c.excel_name ?? c.sqlite_name) }));
                const filtered = cols.filter((x: any) => x.sqlite_name);
                baseColsCache.current.set(selectedBaseId, filtered);
                setBaseColumnsItems(filtered);
            } catch (e) {
                if (!mounted) return;
                setBaseColumnsItems([]);
            }
        })();
        return () => { mounted = false; };
    }, [selectedBaseId]);

    const form = useForm<KeyItem>({ defaultValues: { nome: '', descricao: '', base_id: undefined, base_tipo: 'CONTABIL', base_subtipo: null, columns: [] } });
    const watchedColumns = useWatch({ control: form.control, name: 'columns' }) as string[] | undefined;
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [keysRes, subRes, basesRes] = await Promise.all([fetchKeys(), fetchBaseSubtypes(), fetchBases()]);
            const rows = keysRes.data.data ?? [];
            setItems(rows as KeyItem[]);
            const subs = (subRes.data?.data ?? []) as any[];
            setSubtypes(subs.map(s => ({ id: s.id, name: s.name })));
            const baseRows = basesRes.data?.data ?? [];
            setBases(baseRows);
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`${SCOPE} - failed to load`, err);
            toast.error('Falha ao carregar chaves');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const openCreateDialog = useCallback(() => { setEditing(null); form.reset({ nome: '', descricao: '', base_tipo: null, base_subtipo: null, base_id: undefined, columns: [] }); setSelectedBaseId(null); setBaseColumnsItems([]); setDialogOpen(true); }, [form]);
    const openEditDialog = useCallback((it: KeyItem) => {
        setEditing(it);
        // try to find a base that matches tipo/subtipo
        const match = bases.find(b => (b.tipo === it.base_tipo) && (String(b.subtype || '') === String(it.base_subtipo || '')));
        const baseId = match ? match.id : undefined;
        form.reset({ nome: it.nome, descricao: it.descricao ?? '', base_tipo: it.base_tipo ?? null, base_subtipo: it.base_subtipo ?? null, base_id: baseId, columns: it.columns ?? [] });
        setSelectedBaseId(baseId ?? null);
        // columns will be loaded by the effect that watches `selectedBaseId`
        if (!baseId) setBaseColumnsItems((it.columns ?? []).map((c: any) => ({ sqlite_name: String(c), excel_name: String(c) })));
        setDialogOpen(true);
    }, [form, bases]);

    const handleSubmit = useCallback(async (values: KeyItem) => {
        setSaving(true);
        try {
            // Validate that a base is selected and all columns belong to that base
            if (!selectedBaseId) {
                toast.error('Selecione uma base antes de salvar a chave');
                return;
            }
            const cols = Array.isArray(values.columns) ? values.columns : [];
            const invalid = cols.some((c) => !baseColumnsItems.some((b) => b.sqlite_name === c));
            if (invalid) {
                toast.error('Todas as colunas devem pertencer à base selecionada');
                return;
            }

            if (editing && editing.id) {
                const resp = await updateKey(editing.id, values);
                const updated = resp.data?.data ?? resp.data;
                if (updated) setItems((cur) => cur.map((c) => (c.id === updated.id ? updated : c)));
                toast.success('Chave atualizada');
            } else {
                const resp = await createKey(values);
                const created = resp.data?.data ?? resp.data;
                if (created) setItems((cur) => [created, ...cur]);
                toast.success('Chave criada');
            }
            setDialogOpen(false);
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`${SCOPE} - save failed`, err);
            toast.error('Falha ao salvar chave');
        } finally {
            setSaving(false);
        }
    }, [editing, selectedBaseId, baseColumnsItems]);

    const requestDelete = useCallback((id?: number) => {
        setDeletePending(id ?? null);
        setDeleteDialogOpen(true);
    }, []);

    const confirmDelete = useCallback(async () => {
        const id = deletePending;
        if (!id) return;
        try {
            await deleteKey(id);
            setItems((cur) => cur.filter((c) => c.id !== id));
            toast.success('Chave removida');
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`${SCOPE} - delete failed`, err);
            toast.error('Falha ao remover chave');
        } finally {
            setDeletePending(null);
            setDeleteDialogOpen(false);
        }
    }, [deletePending]);

    return (
        <PageSkeletonWrapper loading={loading}>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold">Chaves (Bases)</h1>
                        <p className="text-muted-foreground">Gerencie chaves reutilizáveis por tipo/subtipo de base</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button onClick={openCreateDialog}><Plus className="mr-2 h-4 w-4" /> Nova Chave</Button>
                        <Button variant="outline" onClick={() => navigate('/configs')}>Voltar</Button>
                    </div>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Chaves Cadastradas</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                            {items.map((it) => (
                                <KeyRow key={it.id} item={it} onEdit={openEditDialog} onRequestDelete={requestDelete} />
                            ))}
                            {!items.length && !loading && <div className="text-sm text-muted-foreground">Nenhuma chave cadastrada</div>}
                        </div>
                    </CardContent>
                </Card>

                <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Confirmação de Exclusão</AlertDialogTitle>
                            <AlertDialogDescription>
                                Deseja realmente deletar esta chave? Esta ação não pode ser desfeita.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel
                                onClick={() => {
                                    setDeleteDialogOpen(false);
                                    setDeletePending(null);
                                }}
                            >
                                Cancelar
                            </AlertDialogCancel>
                            <AlertDialogAction onClick={confirmDelete}>Excluir</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                {/* Create/Edit dialog */}
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{editing ? 'Editar Chave' : 'Nova Chave'}</DialogTitle>
                        </DialogHeader>

                        <Form {...form}>
                            <form onSubmit={form.handleSubmit((values) => handleSubmit(values as KeyItem))} className="space-y-4">
                                <FormItem>
                                    <FormLabel>Nome</FormLabel>
                                    <FormControl>
                                        <Input {...form.register('nome', { required: true })} placeholder="Nome da chave" />
                                    </FormControl>
                                </FormItem>

                                <FormItem>
                                    <FormLabel>Descrição</FormLabel>
                                    <FormControl>
                                        <Input {...form.register('descricao')} placeholder="Descrição (opcional)" />
                                    </FormControl>
                                </FormItem>

                                <FormItem>
                                    <FormLabel>Base (definirá Tipo / Subtipo)</FormLabel>
                                    <FormControl>
                                        <Select value={selectedBaseId === null || selectedBaseId === undefined ? '__NONE__' : String(selectedBaseId)} onValueChange={(v) => {
                                            const id = v === '__NONE__' ? undefined : Number(v);
                                            const normalized = id === undefined ? undefined : Number(id);
                                            setSelectedBaseId(normalized ?? null);
                                            form.setValue('base_id', normalized);
                                            if (normalized) {
                                                const b = bases.find(x => x.id === normalized);
                                                if (b) {
                                                    form.setValue('base_tipo', b.tipo);
                                                    form.setValue('base_subtipo', b.subtype || null);
                                                }
                                            } else {
                                                form.setValue('base_tipo', null);
                                                form.setValue('base_subtipo', null);
                                            }
                                        }}>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Selecionar base" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem key="__NONE__" value="__NONE__">Nenhuma</SelectItem>
                                                {bases.map((b) => <SelectItem key={b.id} value={String(b.id)}>{`${b.nome} — ${b.tipo}${b.subtype ? ` / ${b.subtype}` : ''}`}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </FormControl>
                                </FormItem>

                                <FormItem>
                                    <FormLabel>Colunas (componentes da chave)</FormLabel>
                                    <FormControl>
                                        <Select
                                            value={Array.isArray(form.getValues('columns')) && form.getValues('columns').length > 0 ? '__MULTI__' : '__NONE__'}
                                            open={colsSelectOpen}
                                            onOpenChange={setColsSelectOpen}
                                        >
                                            <SelectTrigger>
                                                <div className="min-h-[2.5rem] flex flex-wrap items-center gap-2 w-full">
                                                            {Array.isArray(watchedColumns) && watchedColumns.length > 0 ? (
                                                                (watchedColumns as string[]).map((c) => {
                                                                    const found = baseColumnsItems.find(b => b.sqlite_name === c);
                                                                    const label = found ? found.excel_name : String(c);
                                                                    return (<Badge key={c} variant="secondary" className="font-mono text-xs">{label}</Badge>);
                                                                })
                                                            ) : (
                                                                <span className="text-muted-foreground">{selectedBaseId ? 'Selecionar colunas' : 'Selecione uma base primeiro'}</span>
                                                            )}
                                                        </div>
                                            </SelectTrigger>
                                                    <SelectContent searchable={true}>
                                                        {baseColumnsItems.length === 0 ? (
                                                            <SelectItem value="__NONE__">Sem colunas</SelectItem>
                                                        ) : (
                                                            baseColumnsItems.map((col) => {
                                                                const cur = Array.isArray(form.getValues('columns')) ? (form.getValues('columns') as string[]) : [];
                                                                const checked = cur.includes(col.sqlite_name);
                                                                return (
                                                                    <SelectItem
                                                                        key={col.sqlite_name}
                                                                        value={col.sqlite_name}
                                                                        onMouseDown={(e: any) => {
                                                                                // prevent the Radix select from performing the single-select behavior
                                                                                e.preventDefault();
                                                                                e.stopPropagation();
                                                                                const now = Array.isArray(form.getValues('columns')) ? (form.getValues('columns') as string[]) : [];
                                                                                if (now.includes(col.sqlite_name)) {
                                                                                    form.setValue('columns', now.filter((x) => x !== col.sqlite_name));
                                                                                } else {
                                                                                    form.setValue('columns', Array.from(new Set([...now, col.sqlite_name])));
                                                                                }
                                                                                // keep the select open by not toggling `colsSelectOpen` here
                                                                            }}
                                                                    >
                                                                        <div className="flex items-center gap-2">
                                                                            <input type="checkbox" readOnly checked={checked} className="h-4 w-4" onClick={(ev) => ev.stopPropagation()} />
                                                                            <span className="font-mono text-sm">{col.excel_name}</span>
                                                                        </div>
                                                                    </SelectItem>
                                                                );
                                                            })
                                                        )}
                                                    </SelectContent>
                                        </Select>
                                    </FormControl>
                                </FormItem>

                                <DialogFooter>
                                    <div className="flex gap-2">
                                        <Button variant="outline" type="button" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                                        <Button type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
                                    </div>
                                </DialogFooter>
                            </form>
                        </Form>
                    </DialogContent>
                </Dialog>
            </div>
        </PageSkeletonWrapper>
    );
};

export default ConfigKeys;
