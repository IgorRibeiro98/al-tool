import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import type { FC } from "react";
import PageSkeletonWrapper from "@/components/PageSkeletonWrapper";
import * as React from 'react';
import { useForm } from 'react-hook-form';
import {
    fetchBaseSubtypes,
    createBaseSubtype,
    updateBaseSubtype,
    deleteBaseSubtype,
} from "@/services/baseService";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Form, FormItem, FormLabel, FormControl } from '@/components/ui/form';
import { Input } from '@/components/ui/input';

type SubtypeItem = { id: number; name: string; created_at?: string };

const SCOPE = 'ConfigSubtypes';

const SubtypeRow: FC<{
    item: SubtypeItem;
    onEdit: (it: SubtypeItem) => void;
    onRequestDelete: (id: number) => void;
}> = ({ item, onEdit, onRequestDelete }) => {
    return (
        <div className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50 transition-colors">
            <div>
                <p className="font-medium">{item.name}</p>
            </div>

            <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => onEdit(item)}>
                    <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onRequestDelete(item.id)}>
                    <Trash2 className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
};

const ConfigSubtypes: FC = () => {
    const navigate = useNavigate();

    const [items, setItems] = useState<SubtypeItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [deletePending, setDeletePending] = useState<number | null>(null);

    // dialog/form state
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<SubtypeItem | null>(null);

    const form = useForm<{ name: string }>({
        defaultValues: { name: '' },
    });

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetchBaseSubtypes();
            const rows = res.data?.data ?? [];
            setItems(rows as SubtypeItem[]);
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`${SCOPE} - failed to load`, err);
            toast.error('Falha ao carregar subtipos');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const openCreateDialog = useCallback(() => {
        setEditing(null);
        form.reset({ name: '' });
        setDialogOpen(true);
    }, [form]);

    const openEditDialog = useCallback((it: SubtypeItem) => {
        setEditing(it);
        form.reset({ name: it.name });
        setDialogOpen(true);
    }, [form]);

    const handleSubmit = useCallback(async (values: { name: string }) => {
        try {
            if (editing) {
                const resp = await updateBaseSubtype(editing.id, values);
                const updated = resp.data?.data;
                if (updated) setItems((cur) => cur.map((c) => (c.id === updated.id ? updated : c)));
                toast.success('Subtipo atualizado');
            } else {
                const resp = await createBaseSubtype(values);
                const created = resp.data?.data;
                if (created) setItems((cur) => [created, ...cur]);
                toast.success('Subtipo criado');
            }
            setDialogOpen(false);
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`${SCOPE} - save failed`, err);
            toast.error('Falha ao salvar subtipo');
        }
    }, [editing]);

    const requestDelete = useCallback((id: number) => setDeletePending(id), []);

    const confirmDelete = useCallback(async () => {
        const id = deletePending;
        if (!id) return;
        try {
            await deleteBaseSubtype(id);
            setItems((cur) => cur.filter((c) => c.id !== id));
            toast.success('Subtipo removido');
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`${SCOPE} - delete failed`, err);
            toast.error('Falha ao remover subtipo');
        } finally {
            setDeletePending(null);
        }
    }, [deletePending]);

    return (
        <PageSkeletonWrapper loading={loading}>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold">Subtipos de Base</h1>
                        <p className="text-muted-foreground">Gerencie subtipos que podem ser atribuídos às bases</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button onClick={openCreateDialog}>
                            <Plus className="mr-2 h-4 w-4" /> Novo Subtipo
                        </Button>
                        <Button variant="outline" onClick={() => navigate('/configs')}>Voltar</Button>
                    </div>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Subtipos Cadastrados</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                            {items.map((it) => (
                                <SubtypeRow key={it.id} item={it} onEdit={openEditDialog} onRequestDelete={requestDelete} />
                            ))}
                            {!items.length && !loading && <div className="text-sm text-muted-foreground">Nenhum subtipo cadastrado</div>}
                        </div>
                    </CardContent>
                </Card>

                {deletePending ? (
                    <div className="fixed inset-0 flex items-end md:items-center justify-center p-4 pointer-events-none">
                        <div className="pointer-events-auto bg-background p-4 rounded shadow">
                            <p>Confirma exclusão do subtipo?</p>
                            <div className="flex gap-2 mt-2">
                                <Button variant="outline" onClick={() => setDeletePending(null)}>Cancelar</Button>
                                <Button onClick={confirmDelete}>Confirmar</Button>
                            </div>
                        </div>
                    </div>
                ) : null}
                {/* Create/Edit dialog */}
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{editing ? 'Editar Subtipo' : 'Novo Subtipo'}</DialogTitle>
                        </DialogHeader>

                        <Form {...form}>{/* react-hook-form provider */}
                            <form
                                onSubmit={form.handleSubmit((values) => handleSubmit(values))}
                                className="space-y-4"
                            >
                                <FormItem>
                                    <FormLabel>Nome</FormLabel>
                                    <FormControl>
                                        <Input {...form.register('name', { required: true })} placeholder="Nome do subtipo" />
                                    </FormControl>
                                </FormItem>

                                                {/* 'tipo' removed — subtypes are independent */}

                                <DialogFooter>
                                    <div className="flex gap-2">
                                        <Button variant="outline" type="button" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                                        <Button type="submit">Salvar</Button>
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

export default ConfigSubtypes;
