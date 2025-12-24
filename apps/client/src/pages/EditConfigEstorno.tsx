import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useEffect, useState, useCallback, useMemo } from 'react';
import PageSkeletonWrapper from '@/components/PageSkeletonWrapper';
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
import { fetchBases, getBaseColumns } from '@/services/baseService';
import { getConfigEstorno, updateConfigEstorno, deleteConfigEstorno } from '@/services/configsService';
import * as z from "zod";

const formSchema = z.object({
    nome: z.string().min(1, "Nome é obrigatório"),
    colunaA: z.string().min(1, "Coluna A é obrigatória"),
    colunaB: z.string().min(1, "Coluna B é obrigatória"),
    colunaSoma: z.string().min(1, "Coluna Soma é obrigatória"),
    limiteZero: z.boolean().default(false),
    baseId: z.string().min(1, "Base é obrigatória"),
    ativa: z.boolean().default(true),
});

// Using centralized types from `src/types/global.d.ts`: `ConfigEstorno`, `Base`, `Column`


type FormValues = z.infer<typeof formSchema>;

const EditConfigEstorno = () => {
    const { id } = useParams();
    const navigate = useNavigate();

    const [bases, setBases] = useState<Base[]>([]);
    const [columns, setColumns] = useState<Column[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

    const MSG = useMemo(() => ({
        LOAD_FAIL: 'Falha ao carregar configuração',
        SAVE_SUCCESS: 'Configuração atualizada',
        SAVE_FAIL: 'Falha ao atualizar configuração',
        DELETE_SUCCESS: 'Configuração excluída',
        DELETE_FAIL: 'Falha ao excluir configuração',
    }), []);

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            nome: "",
            colunaA: "",
            colunaB: "",
            colunaSoma: "",
            limiteZero: false,
            baseId: "",
            ativa: true,
        },
    });

    useEffect(() => {
        let mounted = true;
        fetchBases()
            .then(r => { if (!mounted) return; setBases((r.data?.data || r.data || []) as Base[]); })
            .catch(() => setBases([]))
        ;
        return () => { mounted = false; };
    }, []);

    const mapColumns = useCallback((rows: any[]): Column[] => {
        return (rows || []).map((c: any) => ({ excel: c.excel_name, sqlite: c.sqlite_name, index: String(c.col_index) }));
    }, []);

    const loadColumnsForBase = useCallback(async (baseId: string | number | undefined) => {
        const idNum = baseId ? Number(baseId) : NaN;
        if (!idNum || Number.isNaN(idNum)) return setColumns([]);
        try {
            const res = await getBaseColumns(idNum);
            const rows = res.data?.data || [];
            setColumns(mapColumns(rows));
        } catch {
            setColumns([]);
        }
    }, [mapColumns]);

    useEffect(() => {
        let mounted = true;
        if (!id) return;
        const numId = Number(id);
        if (Number.isNaN(numId)) return;
        setLoading(true);
        getConfigEstorno(numId).then(res => {
            if (!mounted) return;
            const cfg: ConfigEstorno = res.data;
            form.reset({
                nome: cfg.nome ?? "",
                colunaA: cfg.coluna_a ?? "",
                colunaB: cfg.coluna_b ?? "",
                colunaSoma: cfg.coluna_soma ?? "",
                limiteZero: !!cfg.limite_zero,
                baseId: cfg.base_id ? String(cfg.base_id) : "",
                ativa: !!cfg.ativa,
            });
            if (cfg.base_id) loadColumnsForBase(cfg.base_id);
        }).catch(err => {
            console.error('failed to load config', err);
            toast.error(MSG.LOAD_FAIL);
        }).finally(() => { if (mounted) setLoading(false); });

        return () => { mounted = false; };
    }, [id, form, loadColumnsForBase, MSG]);

    // watch base selection to load columns for autocomplete
    useEffect(() => {
        const subscription = form.watch((_, { name }) => {
            if (name === 'baseId') {
                loadColumnsForBase(form.getValues('baseId'));
            }
        });
        return () => subscription.unsubscribe();
    }, [form, loadColumnsForBase]);

    const onSubmit = useCallback(async (data: FormValues) => {
        if (!id) return;
        try {
            const payload = {
                nome: data.nome,
                coluna_a: data.colunaA,
                coluna_b: data.colunaB,
                coluna_soma: data.colunaSoma,
                limite_zero: data.limiteZero ? 1 : 0,
                base_id: Number(data.baseId),
                ativa: !!data.ativa,
            } as any;
            await updateConfigEstorno(Number(id), payload);
            toast.success(MSG.SAVE_SUCCESS);
            navigate('/configs/estorno');
        } catch (err: any) {
            console.error('update failed', err);
            toast.error(err?.response?.data?.error || MSG.SAVE_FAIL);
        }
    }, [id, navigate, MSG]);

    const confirmDelete = useCallback(() => {
        if (!id) return;
        const numId = Number(id);
        if (Number.isNaN(numId)) return;
        setPendingDeleteId(numId);
        setDeleteDialogOpen(true);
    }, [id]);

    const handleDelete = useCallback(async (delId: number | null) => {
        if (!delId) return;
        try {
            await deleteConfigEstorno(delId);
            toast.success(MSG.DELETE_SUCCESS);
            navigate('/configs/estorno');
        } catch (err: any) {
            console.error('delete failed', err);
            toast.error(err?.response?.data?.error || MSG.DELETE_FAIL);
        } finally {
            setDeleteDialogOpen(false);
            setPendingDeleteId(null);
        }
    }, [MSG, navigate]);

    return (
        <PageSkeletonWrapper loading={loading}>
            <div className="space-y-6">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate('/configs/estorno')}>
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <h1 className="text-3xl font-bold">Editar Configuração de Estorno</h1>
                        <p className="text-muted-foreground">Altere os parâmetros da configuração</p>
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
                                                <Input placeholder="Ex: Config Estorno Principal" {...field} />
                                            </FormControl>
                                            <FormDescription>Nome identificador da configuração</FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="baseId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Base Associada</FormLabel>
                                            <FormControl>
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Selecione a base" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {bases.map((base) => (
                                                            <SelectItem key={String(base.id)} value={String((base as any).id)}>
                                                                {base.nome}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </FormControl>
                                            <FormDescription>Base onde a configuração será aplicada</FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="colunaA"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Coluna A</FormLabel>
                                            {columns.length > 0 ? (
                                                <FormControl>
                                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Selecione a coluna A" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {columns.map((c) => (
                                                                <SelectItem key={c.index} value={c.sqlite}>{c.excel}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl>
                                            ) : (
                                                <FormControl>
                                                    <Input placeholder="Ex: VALOR_A" {...field} />
                                                </FormControl>
                                            )}
                                            <FormDescription>Primeira coluna para soma</FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="colunaB"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Coluna B</FormLabel>
                                            {columns.length > 0 ? (
                                                <FormControl>
                                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Selecione a coluna B" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {columns.map((c) => (
                                                                <SelectItem key={c.index} value={c.sqlite}>{c.excel}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl>
                                            ) : (
                                                <FormControl>
                                                    <Input placeholder="Ex: VALOR_B" {...field} />
                                                </FormControl>
                                            )}
                                            <FormDescription>Segunda coluna para soma</FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="colunaSoma"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Coluna Soma</FormLabel>
                                            {columns.length > 0 ? (
                                                <FormControl>
                                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Selecione a coluna Soma" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {columns.map((c) => (
                                                                <SelectItem key={c.index} value={c.sqlite}>{c.excel}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl>
                                            ) : (
                                                <FormControl>
                                                    <Input placeholder="Ex: TOTAL" {...field} />
                                                </FormControl>
                                            )}
                                            <FormDescription>Coluna com resultado da soma</FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="limiteZero"
                                    render={({ field }) => (
                                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                            <div className="space-y-0.5">
                                                <FormLabel className="text-base">Limite Zero</FormLabel>
                                                <FormDescription>
                                                    Considerar apenas valores com soma igual a zero
                                                </FormDescription>
                                            </div>
                                            <FormControl>
                                                <Switch checked={field.value} onCheckedChange={field.onChange} />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="ativa"
                                    render={({ field }) => (
                                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                            <div className="space-y-0.5">
                                                <FormLabel className="text-base">Configuração Ativa</FormLabel>
                                                <FormDescription>
                                                    Ativar esta configuração imediatamente após criação
                                                </FormDescription>
                                            </div>
                                            <FormControl>
                                                <Switch checked={field.value} onCheckedChange={field.onChange} />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />

                                <div className="flex gap-4 justify-between">
                                    <div className="flex gap-2">
                                        <Button type="submit">Salvar Alterações</Button>
                                        <Button type="button" variant="outline" onClick={() => navigate('/configs/estorno')}>Cancelar</Button>
                                    </div>
                                    <Button type="button" variant="destructive" onClick={confirmDelete}>
                                        <Trash2 className="mr-2 h-4 w-4" />Excluir
                                    </Button>
                                </div>
                            </form>
                        </Form>
                    </CardContent>
                </Card>
                <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Confirmação de Exclusão</AlertDialogTitle>
                            <AlertDialogDescription>Tem certeza que deseja excluir esta configuração? Esta ação não pode ser desfeita.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel onClick={() => { setDeleteDialogOpen(false); setPendingDeleteId(null); }}>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(pendingDeleteId)}>Excluir</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </PageSkeletonWrapper>
    );
};

export default EditConfigEstorno;
