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
import * as z from "zod";
import { fetchBases, getBaseColumns } from '@/services/baseService';
import { createConfigEstorno } from '@/services/configsService';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';

const formSchema = z.object({
    nome: z.string().min(1, "Nome é obrigatório"),
    colunaA: z.string().min(1, "Coluna A é obrigatória"),
    colunaB: z.string().min(1, "Coluna B é obrigatória"),
    colunaSoma: z.string().min(1, "Coluna Soma é obrigatória"),
    limiteZero: z.boolean().default(false),
    baseId: z.string().min(1, "Base é obrigatória"),
    ativa: z.boolean().default(true),
});

type FormValues = z.infer<typeof formSchema>;

const NewConfigEstorno = () => {
    const navigate = useNavigate();

    type Base = { id: string; nome?: string };
    type Column = { excel: string; sqlite: string; index: string };

    const [bases, setBases] = useState<Base[]>([]);
    const [columns, setColumns] = useState<Column[]>([]);

    const mountedRef = useRef(true);
    useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

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

    const MSG = useMemo(() => ({
        LOAD_BASES_FAIL: 'Falha ao carregar as bases',
        LOAD_COLUMNS_FAIL: 'Falha ao carregar colunas da base',
        CREATE_SUCCESS: 'Configuração de estorno criada com sucesso!',
        CREATE_FAIL: 'Falha ao criar configuração',
    }), []);

    const mapColumns = useCallback((rows: any[]): Column[] => (rows || []).map((c: any) => ({ excel: c.excel_name, sqlite: c.sqlite_name, index: String(c.col_index) })), []);

    const loadBases = useCallback(async () => {
        try {
            const res = await fetchBases();
            if (!mountedRef.current) return;
            setBases(res.data?.data || []);
        } catch (err) {
            console.error('fetchBases failed', err);
            toast.error(MSG.LOAD_BASES_FAIL);
            if (mountedRef.current) setBases([]);
        }
    }, [MSG]);

    useEffect(() => { void loadBases(); }, [loadBases]);

    const selectedBaseId = form.watch('baseId');
    const loadColumns = useCallback(async (baseId?: string) => {
        setColumns([]);
        if (!baseId) return;
        const id = Number(baseId);
        if (!id || Number.isNaN(id)) return;
        try {
            const res = await getBaseColumns(id);
            if (!mountedRef.current) return;
            const rows = res.data?.data || [];
            setColumns(mapColumns(rows));
        } catch (err) {
            console.error('getBaseColumns failed', err);
            toast.error(MSG.LOAD_COLUMNS_FAIL);
            if (mountedRef.current) setColumns([]);
        }
    }, [mapColumns, MSG]);

    useEffect(() => { void loadColumns(selectedBaseId); }, [selectedBaseId, loadColumns]);

    const ROUTES = useMemo(() => ({
        LIST: '/configs/estorno',
    }), []);

    const onSubmit = useCallback(async (data: FormValues) => {
        const payload = {
            nome: data.nome,
            coluna_a: data.colunaA,
            coluna_b: data.colunaB,
            coluna_soma: data.colunaSoma,
            limite_zero: data.limiteZero ? 1 : 0,
            base_id: Number(data.baseId),
            ativa: !!data.ativa,
        } as any;

        try {
            await createConfigEstorno(payload);
            toast.success(MSG.CREATE_SUCCESS);
            navigate(ROUTES.LIST);
        } catch (err: any) {
            console.error('createConfigEstorno failed', err);
            toast.error(err?.response?.data?.error || MSG.CREATE_FAIL);
        }
    }, [MSG, navigate, ROUTES]);

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => navigate("/configs/estorno")}>
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <div>
                    <h1 className="text-3xl font-bold">Nova Configuração de Estorno</h1>
                    <p className="text-muted-foreground">Defina as regras para identificação de estorno</p>
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

                            {/* Columns: A, B and Soma share the same rendering logic; extract to reduce duplication */}
                            {(() => {
                                const ColumnFieldRenderer = ({ name, label, placeholder, description }: { name: 'colunaA' | 'colunaB' | 'colunaSoma'; label: string; placeholder: string; description: string }) => (
                                    <FormField
                                        control={form.control}
                                        name={name}
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>{label}</FormLabel>
                                                {columns.length > 0 ? (
                                                    <FormControl>
                                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                            <SelectTrigger>
                                                                <SelectValue placeholder={`Selecione a ${label}`} />
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
                                                        <Input placeholder={placeholder} {...field} />
                                                    </FormControl>
                                                )}
                                                <FormDescription>{description}</FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                );

                                return (
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <ColumnFieldRenderer name="colunaA" label="Coluna A" placeholder="Ex: VALOR_A" description="Primeira coluna para soma" />
                                        <ColumnFieldRenderer name="colunaB" label="Coluna B" placeholder="Ex: VALOR_B" description="Segunda coluna para soma" />
                                        <ColumnFieldRenderer name="colunaSoma" label="Coluna Soma" placeholder="Ex: TOTAL" description="Coluna com resultado da soma" />
                                    </div>
                                );
                            })()}

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

                            <div className="flex gap-4">
                                <Button type="submit">Criar Configuração</Button>
                                <Button type="button" variant="outline" onClick={() => navigate(ROUTES.LIST)}>
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

export default NewConfigEstorno;
