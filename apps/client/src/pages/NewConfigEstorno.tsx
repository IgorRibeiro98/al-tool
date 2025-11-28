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
import { useEffect, useState } from 'react';

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

    const [bases, setBases] = useState<Array<{ id: string; nome?: string }>>([]);
    const [columns, setColumns] = useState<Array<{ excel: string; sqlite: string; index: string }>>([]);

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
        fetchBases().then(r => {
            if (!mounted) return;
            setBases(r.data.data || []);
        }).catch(err => {
            console.error('failed to fetch bases', err);
            setBases([]);
        });
        return () => { mounted = false; };
    }, []);

    const selectedBaseId = form.watch('baseId');
    useEffect(() => {
        let mounted = true;
        setColumns([]);
        if (!selectedBaseId) return;
        const id = Number(selectedBaseId);
        if (!id || Number.isNaN(id)) return;
        getBaseColumns(id).then(r => {
            if (!mounted) return;
            const rows = r.data.data || [];
            const cols = rows.map((c: any) => {
                return {
                    excel: c.excel_name,
                    sqlite: c.sqlite_name,
                    index: String(c.col_index)
                }
            });
            setColumns(cols);
        }).catch(err => {
            console.error('failed to fetch base columns', err);
            setColumns([]);
        });
        return () => { mounted = false; };
    }, [selectedBaseId]);

    const onSubmit = async (data: FormValues) => {
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
            await createConfigEstorno(payload);
            toast.success("Configuração de estorno criada com sucesso!");
            navigate("/configs/estorno");
        } catch (err: any) {
            console.error('create estorno config failed', err);
            toast.error(err?.response?.data?.error || 'Falha ao criar configuração');
        }
    };

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

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                                                                <SelectItem key={c.excel} value={c.sqlite}>{c.excel}</SelectItem>
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
                            </div>

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
                                <Button type="button" variant="outline" onClick={() => navigate("/configs/estorno")}>
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
