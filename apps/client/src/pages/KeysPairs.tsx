import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import PageSkeletonWrapper from '@/components/PageSkeletonWrapper';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Form, FormItem, FormLabel, FormControl } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogAction,
    AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fetchKeys } from '@/services/keysService';
import { fetchKeysPairs, createKeysPair, updateKeysPair, deleteKeysPair } from '@/services/keysPairsService';
import type { KeyItem } from '@/types/keys';
import type { KeyPair } from '@/types/configs';

type PairItem = KeyPair & { contabil_key?: KeyItem | null; fiscal_key?: KeyItem | null };

const KeysPairs: FC = () => {
    const [items, setItems] = useState<PairItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<PairItem | null>(null);
    const [keys, setKeys] = useState<KeyItem[]>([]);
    const [saving, setSaving] = useState(false);
    const [toDeleteId, setToDeleteId] = useState<number | null>(null);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const form = useForm<PairItem>({ defaultValues: { nome: '', descricao: '', contabil_key_id: undefined, fiscal_key_id: undefined } });
    const watchedContabil = useWatch({ control: form.control, name: 'contabil_key_id' }) as number | undefined;
    const watchedFiscal = useWatch({ control: form.control, name: 'fiscal_key_id' }) as number | undefined;

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [pairsRes, keysRes] = await Promise.all([fetchKeysPairs(), fetchKeys()]);
            setItems(pairsRes.data?.data ?? pairsRes.data ?? []);
            setKeys(keysRes.data?.data ?? keysRes.data ?? []);
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error('KeysPairs - load failed', err);
            toast.error('Falha ao carregar pares de chaves');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const openCreate = useCallback(() => { setEditing(null); form.reset({ nome: '', descricao: '', contabil_key_id: undefined, fiscal_key_id: undefined }); setDialogOpen(true); }, [form]);
    const openEdit = useCallback((it: PairItem) => { setEditing(it); form.reset({ nome: it.nome, descricao: it.descricao ?? '', contabil_key_id: it.contabil_key_id, fiscal_key_id: it.fiscal_key_id }); setDialogOpen(true); }, [form]);

    const handleSubmit = useCallback(async (vals: PairItem) => {
        setSaving(true);
        try {
            if (editing && editing.id) {
                const res = await updateKeysPair(editing.id, vals);
                const updated = res.data?.data ?? res.data;
                if (updated) setItems((cur) => cur.map((c) => (c.id === updated.id ? updated : c)));
                toast.success('Par atualizado');
            } else {
                const res = await createKeysPair(vals);
                const created = res.data?.data ?? res.data;
                if (created) setItems((cur) => [created, ...cur]);
                toast.success('Par criado');
            }
            setDialogOpen(false);
        } catch (err: any) {
            // eslint-disable-next-line no-console
            console.error('KeysPairs - save failed', err);
            toast.error(err?.response?.data?.error || 'Falha ao salvar par de chaves');
        } finally {
            setSaving(false);
        }
    }, [editing]);

    const requestDelete = useCallback((id?: number) => {
        if (!id) return;
        setToDeleteId(id);
        setDeleteDialogOpen(true);
    }, []);

    const confirmDelete = useCallback(async () => {
        if (!toDeleteId) return;
        setDeleting(true);
        try {
            await deleteKeysPair(toDeleteId);
            setItems((cur) => cur.filter((c) => c.id !== toDeleteId));
            toast.success('Par removido');
        } catch (err: any) {
            // eslint-disable-next-line no-console
            console.error('KeysPairs - delete failed', err);
            toast.error(err?.response?.data?.error || 'Falha ao remover par');
        } finally {
            setDeleting(false);
            setDeleteDialogOpen(false);
            setToDeleteId(null);
        }
    }, [toDeleteId]);

    const contabilKeys = useMemo(() => keys.filter(k => (k.base_tipo || '').toUpperCase() === 'CONTABIL'), [keys]);
    const fiscalKeys = useMemo(() => keys.filter(k => (k.base_tipo || '').toUpperCase() === 'FISCAL'), [keys]);

    const resolvedItems = useMemo(() => items.map(it => ({
        ...it,
        contabil_key: keys.find(k => Number(k.id) === Number(it.contabil_key_id)) ?? null,
        fiscal_key: keys.find(k => Number(k.id) === Number(it.fiscal_key_id)) ?? null,
    })), [items, keys]);

    return (
        <PageSkeletonWrapper loading={loading}>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold">Pares de Chaves (Conciliação)</h1>
                        <p className="text-muted-foreground">Gerencie pares contábil ↔ fiscal para uso em conciliações</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" /> Novo Par</Button>
                    </div>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Pares Cadastrados</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                            {resolvedItems.map((it) => (
                                <div key={it.id} className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50">
                                    <div>
                                        <div className="font-medium">{it.nome}</div>
                                        <div className="text-sm text-muted-foreground">{it.descricao}</div>
                                        <div className="text-sm mt-2">
                                            <div><strong>Contábil:</strong> {it.contabil_key ? `${it.contabil_key.nome} — ${it.contabil_key.base_tipo}${it.contabil_key.base_subtipo ? ` / ${it.contabil_key.base_subtipo}` : ''}` : it.contabil_key_id}</div>
                                            <div><strong>Fiscal:</strong> {it.fiscal_key ? `${it.fiscal_key.nome} — ${it.fiscal_key.base_tipo}${it.fiscal_key.base_subtipo ? ` / ${it.fiscal_key.base_subtipo}` : ''}` : it.fiscal_key_id}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button variant="ghost" size="sm" aria-label={`Editar ${it.nome}`} onClick={() => openEdit(it)}><Pencil className="h-4 w-4" /></Button>
                                        <Button variant="ghost" size="sm" aria-label={`Remover ${it.nome}`} onClick={() => requestDelete(it.id)}><Trash2 className="h-4 w-4" /></Button>
                                    </div>
                                </div>
                            ))}
                            {!items.length && !loading && <div className="text-sm text-muted-foreground">Nenhum par cadastrado</div>}
                        </div>
                    </CardContent>
                </Card>

                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{editing ? 'Editar Par' : 'Novo Par'}</DialogTitle>
                        </DialogHeader>
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit((v) => handleSubmit(v as PairItem))} className="space-y-4">
                                <FormItem>
                                    <FormLabel>Nome</FormLabel>
                                    <FormControl>
                                        <Input {...form.register('nome', { required: true })} placeholder="Nome do par" />
                                    </FormControl>
                                </FormItem>

                                <FormItem>
                                    <FormLabel>Descrição</FormLabel>
                                    <FormControl>
                                        <Input {...form.register('descricao')} placeholder="Descrição (opcional)" />
                                    </FormControl>
                                </FormItem>

                                <FormItem>
                                    <FormLabel>Chave Contábil</FormLabel>
                                    <FormControl>
                                        <Select value={watchedContabil ? String(watchedContabil) : '__NONE__'} onValueChange={(v) => form.setValue('contabil_key_id', v && v !== '__NONE__' ? Number(v) : undefined)}>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Selecione chave contábil" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="__NONE__">Nenhuma</SelectItem>
                                                {contabilKeys.map((k) => (
                                                    <SelectItem key={k.id} value={String(k.id)}>{`${k.nome} — ${k.base_tipo}${k.base_subtipo ? ` / ${k.base_subtipo}` : ''}`}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </FormControl>
                                </FormItem>

                                <FormItem>
                                    <FormLabel>Chave Fiscal</FormLabel>
                                    <FormControl>
                                        <Select value={watchedFiscal ? String(watchedFiscal) : '__NONE__'} onValueChange={(v) => form.setValue('fiscal_key_id', v && v !== '__NONE__' ? Number(v) : undefined)}>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Selecione chave fiscal" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="__NONE__">Nenhuma</SelectItem>
                                                {fiscalKeys.map((k) => (
                                                    <SelectItem key={k.id} value={String(k.id)}>{`${k.nome} — ${k.base_tipo}${k.base_subtipo ? ` / ${k.base_subtipo}` : ''}`}</SelectItem>
                                                ))}
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

                <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Confirmação de Exclusão</AlertDialogTitle>
                            <AlertDialogDescription>
                                Deseja realmente deletar este par de chaves? Esta ação não pode ser desfeita.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel
                                onClick={() => {
                                    setDeleteDialogOpen(false);
                                    setToDeleteId(null);
                                }}
                            >
                                Cancelar
                            </AlertDialogCancel>
                            <AlertDialogAction onClick={confirmDelete} disabled={deleting}>
                                {deleting ? 'Excluindo...' : 'Excluir'}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </PageSkeletonWrapper>
    );
};

export default KeysPairs;
