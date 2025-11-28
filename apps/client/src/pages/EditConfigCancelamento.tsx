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
import { useEffect, useState } from 'react';
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
import { getConfigCancelamento, updateConfigCancelamento, deleteConfigCancelamento } from '@/services/configsService';
import * as z from "zod";

const formSchema = z.object({
    nome: z.string().min(1, "Nome é obrigatório"),
    coluna: z.string().min(1, "Coluna é obrigatória"),
    valorCancelado: z.string().min(1, "Valor cancelado é obrigatório"),
    valorNaoCancelado: z.string().min(1, "Valor não cancelado é obrigatório"),
    baseId: z.string().min(1, "Base é obrigatória"),
    ativa: z.boolean().default(true),
});

type FormValues = z.infer<typeof formSchema>;

const EditConfigCancelamento = () => {
    const { id } = useParams();
    const navigate = useNavigate();

    const [bases, setBases] = useState<Array<{ id: string; nome?: string }>>([]);
    const [columns, setColumns] = useState<Array<{ excel: string; sqlite: string; index: string }>>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            nome: "",
            coluna: "",
            valorCancelado: "",
            valorNaoCancelado: "",
            baseId: "",
            ativa: true,
        },
    });

    useEffect(() => {
        let mounted = true;
        fetchBases().then(r => {
            if (!mounted) return;
            setBases((r.data.data || []).map((b: any) => ({ id: String(b.id), nome: b.nome })));
        }).catch(() => setBases([]));
        return () => { mounted = false; };
    }, []);

    // load current config
    useEffect(() => {
        let mounted = true;
        if (!id) return;
        const numId = Number(id);
        if (Number.isNaN(numId)) return;
        setLoading(true);
        getConfigCancelamento(numId).then(res => {
            if (!mounted) return;
            const cfg: ConfigCancelamento = res.data;
            form.reset({
                nome: cfg.nome ?? "",
                coluna: cfg.coluna_indicador ?? "",
                valorCancelado: cfg.valor_cancelado ?? "",
                valorNaoCancelado: cfg.valor_nao_cancelado ?? "",
                baseId: cfg.base_id ? String(cfg.base_id) : "",
                ativa: !!cfg.ativa,
            });
            // if base present, load columns
            if (cfg.base_id) {
                getBaseColumns(cfg.base_id).then(r => {
                    const rows = r.data.data || [];
                    const cols = rows.map((c: any) => ({ excel: c.excel_name, sqlite: c.sqlite_name, index: String(c.col_index) }));
                    setColumns(cols);
                }).catch(() => setColumns([]));
            }
        }).catch(err => {
            console.error('failed to load config', err);
            toast.error('Falha ao carregar configuração');
        }).finally(() => { if (mounted) setLoading(false); });

        return () => { mounted = false; };
    }, [id]);

    // watch base selection to load columns for autocomplete
    useEffect(() => {
        const subscription = form.watch((value, { name }) => {
            if (name === 'baseId') {
                const baseId = Number(form.getValues('baseId'));
                setColumns([]);
                if (!baseId || Number.isNaN(baseId)) return;
                getBaseColumns(baseId).then(r => {
                    const rows = r.data.data || [];
                    const cols = rows.map((c: any) => ({ excel: c.excel_name, sqlite: c.sqlite_name, index: String(c.col_index) }));
                    setColumns(cols);
                }).catch(() => setColumns([]));
            }
        });
        return () => subscription.unsubscribe();
    }, [form]);

    const onSubmit = async (data: FormValues) => {
        if (!id) return;
        try {
            const payload = {
                nome: data.nome,
                coluna_indicador: data.coluna,
                valor_cancelado: data.valorCancelado,
                valor_nao_cancelado: data.valorNaoCancelado,
                base_id: Number(data.baseId),
                ativa: !!data.ativa,
            } as any;
            await updateConfigCancelamento(Number(id), payload);
            toast.success('Configuração atualizada');
            navigate('/configs/cancelamento');
        } catch (err: any) {
            console.error('update failed', err);
            toast.error(err?.response?.data?.error || 'Falha ao atualizar configuração');
        }
    };

    const confirmDelete = () => {
        if (!id) return;
        const numId = Number(id);
        if (Number.isNaN(numId)) return;
        setPendingDeleteId(numId);
        setDeleteDialogOpen(true);
    };

    const handleDelete = async (delId: number | null) => {
        if (!delId) return;
        try {
            await deleteConfigCancelamento(delId);
            toast.success('Configuração excluída');
            navigate('/configs/cancelamento');
        } catch (err: any) {
            console.error('delete failed', err);
            toast.error(err?.response?.data?.error || 'Falha ao excluir configuração');
        } finally {
            setDeleteDialogOpen(false);
            setPendingDeleteId(null);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => navigate('/configs/cancelamento')}>
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <div>
                    <h1 className="text-3xl font-bold">Editar Configuração de Cancelamento</h1>
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
                                            <Input placeholder="Ex: Config Cancelamento Principal" {...field} />
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
                                                        <SelectItem key={base.id} value={base.id}>
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
                                name="coluna"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Coluna Indicadora</FormLabel>
                                        {columns.length > 0 ? (
                                            <FormControl>
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Selecione a coluna" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {columns.map((c) => (
                                                            <SelectItem key={c.index} value={c.sqlite}>
                                                                {c.excel}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </FormControl>
                                        ) : (
                                            <FormControl>
                                                <Input placeholder={"Escolha uma base para carregar colunas"} {...field} />
                                            </FormControl>
                                        )}
                                        <FormDescription>Nome da coluna que indica cancelamento (autocomplete baseado na base selecionada)</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="valorCancelado"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Valor para Cancelado</FormLabel>
                                            <FormControl>
                                                <Input placeholder="Ex: C ou CANCELADO" {...field} />
                                            </FormControl>
                                            <FormDescription>Valor que indica registro cancelado</FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="valorNaoCancelado"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Valor para Não Cancelado</FormLabel>
                                            <FormControl>
                                                <Input placeholder="Ex: A ou ATIVO" {...field} />
                                            </FormControl>
                                            <FormDescription>Valor que indica registro ativo</FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

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
                                    <Button type="button" variant="outline" onClick={() => navigate('/configs/cancelamento')}>Cancelar</Button>
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
    );
};

export default EditConfigCancelamento;
