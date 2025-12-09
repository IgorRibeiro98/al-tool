import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft } from "lucide-react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useWatch } from 'react-hook-form';
import { fetchBases, getBaseColumns } from '@/services/baseService';
import { createConfigCancelamento } from '@/services/configsService';
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



const NewConfigCancelamento = () => {
    const navigate = useNavigate();
    const [bases, setBases] = useState<Array<{ id: string; nome?: string }>>([]);

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
    const [columns, setColumns] = useState<Array<{ excel: string; sqlite: string; index: string }>>([]);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const MSG = useMemo(() => ({
        LOAD_BASES_FAIL: 'Falha ao carregar bases',
        LOAD_COLS_FAIL: 'Falha ao carregar colunas da base',
        CREATE_SUCCESS: 'Configuração de cancelamento criada com sucesso!',
        CREATE_FAIL: 'Falha ao criar configuração',
    }), []);

    useEffect(() => {
        let active = true;
        fetchBases().then(r => {
            if (!active) return;
            const payload = (r.data?.data || r.data || []).map((b: any) => ({ id: String(b.id), nome: b.nome }));
            setBases(payload);
        }).catch(err => {
            console.error('failed to fetch bases', err);
            toast.error(MSG.LOAD_BASES_FAIL);
            setBases([]);
        });
        return () => { active = false; };
    }, [MSG]);

    // watch base selection to load columns for autocomplete
    const selectedBaseId = useWatch({ control: form.control, name: 'baseId' });

    const loadColumnsForBase = useCallback(async (baseId?: string) => {
        setColumns([]);
        if (!baseId) return;
        const id = Number(baseId);
        if (!id || Number.isNaN(id)) return;
        try {
            const r = await getBaseColumns(id);
            const rows = r.data?.data || r.data || [];
            const cols = rows.map((c: any) => ({ excel: c.excel_name, sqlite: c.sqlite_name, index: String(c.col_index) }));
            if (mountedRef.current) setColumns(cols);
        } catch (err) {
            console.error('failed to fetch base preview', err);
            toast.error(MSG.LOAD_COLS_FAIL);
            if (mountedRef.current) setColumns([]);
        }
    }, [MSG]);

    useEffect(() => { void loadColumnsForBase(selectedBaseId); }, [selectedBaseId, loadColumnsForBase]);

    const onSubmit = useCallback(async (data: FormValues) => {
        try {
            const payload = {
                nome: data.nome,
                coluna_indicador: data.coluna,
                valor_cancelado: data.valorCancelado,
                valor_nao_cancelado: data.valorNaoCancelado,
                base_id: Number(data.baseId),
                ativa: !!data.ativa,
            };
            await createConfigCancelamento(payload);
            toast.success(MSG.CREATE_SUCCESS);
            navigate("/configs/cancelamento");
        } catch (err: any) {
            console.error('create config cancelamento failed', err);
            toast.error(err?.response?.data?.error || MSG.CREATE_FAIL);
        }
    }, [navigate, MSG]);

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => navigate("/configs/cancelamento")}>
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <div>
                    <h1 className="text-3xl font-bold">Nova Configuração de Cancelamento</h1>
                    <p className="text-muted-foreground">Defina as regras para identificação de cancelamento</p>
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

                            <div className="flex gap-4">
                                <Button type="submit">Criar Configuração</Button>
                                <Button type="button" variant="outline" onClick={() => navigate("/configs/cancelamento")}>
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

export default NewConfigCancelamento;
