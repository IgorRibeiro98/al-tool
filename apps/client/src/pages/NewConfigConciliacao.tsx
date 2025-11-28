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
import { useEffect, useState } from 'react';

const formSchema = z.object({
    nome: z.string().min(1, "Nome é obrigatório"),
    baseContabilId: z.string().min(1, "Base contábil é obrigatória"),
    baseFiscalId: z.string().min(1, "Base fiscal é obrigatória"),
    chavesContabeis: z.array(z.string()).min(1, "Selecione ao menos uma chave contábil"),
    chavesFiscais: z.array(z.string()).min(1, "Selecione ao menos uma chave fiscal"),
    colunaConciliacaoContabil: z.string().min(1, "Coluna de conciliação contábil é obrigatória"),
    colunaConciliacaoFiscal: z.string().min(1, "Coluna de conciliação fiscal é obrigatória"),
    inverterSinal: z.boolean().default(false),
    diferencaImaterial: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

const NewConfigConciliacao = () => {
    const navigate = useNavigate();

    const [bases, setBases] = useState<Base[]>([]);
    const [colsContabeis, setColsContabeis] = useState<Array<{ excel?: string; sqlite?: string; index: string }>>([]);
    const [colsFiscais, setColsFiscais] = useState<Array<{ excel?: string; sqlite?: string; index: string }>>([]);

    // Note: using Select for column autocomplete (like NewConfigEstorno)

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            nome: "",
            baseContabilId: "",
            baseFiscalId: "",
            chavesContabeis: [],
            chavesFiscais: [],
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

    // load columns when base selections change
    useEffect(() => {
        const bCont = Number(form.getValues('baseContabilId'));
        if (bCont && !Number.isNaN(bCont)) {
            getBaseColumns(bCont).then(r => {
                const rows = r.data.data || [];
                const cols = rows.map((c: any) => {
                    return {
                        excel: c.excel_name,
                        sqlite: c.sqlite_name,
                        index: String(c.col_index),
                    };
                });
                setColsContabeis(cols);
            }).catch(() => setColsContabeis([]));
        } else {
            setColsContabeis([]);
        }

        const bFisc = Number(form.getValues('baseFiscalId'));
        if (bFisc && !Number.isNaN(bFisc)) {
            getBaseColumns(bFisc).then(r => {
                const rows = r.data.data || [];
                const cols = rows.map((c: any) => {
                    return {
                        excel: c.excel_name,
                        sqlite: c.sqlite_name,
                        index: String(c.col_index),
                    };
                });
                setColsFiscais(cols);
            }).catch(() => setColsFiscais([]));
        } else {
            setColsFiscais([]);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form.watch('baseContabilId'), form.watch('baseFiscalId')]);

    const onSubmit = async (data: FormValues) => {
        try {
            const payload = {
                nome: data.nome,
                base_contabil_id: Number(data.baseContabilId),
                base_fiscal_id: Number(data.baseFiscalId),
                chaves_contabil: data.chavesContabeis,
                chaves_fiscal: data.chavesFiscais,
                coluna_conciliacao_contabil: data.colunaConciliacaoContabil,
                coluna_conciliacao_fiscal: data.colunaConciliacaoFiscal,
                inverter_sinal_fiscal: !!data.inverterSinal,
                limite_diferenca_imaterial: data.diferencaImaterial ? Number(data.diferencaImaterial) : null,
            } as any;
            await createConfigConciliacao(payload);
            toast.success("Configuração de conciliação criada com sucesso!");
            navigate("/configs/conciliacao");
        } catch (err: any) {
            console.error('create conciliacao failed', err);
            toast.error(err?.response?.data?.error || 'Falha ao criar configuração');
        }
    };

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

                            <FormField
                                control={form.control}
                                name="chavesContabeis"
                                render={({ field }) => (
                                    <FormItem>
                                        <div className="mb-4">
                                            <FormLabel className="text-base">Chaves Contábeis</FormLabel>
                                            <FormDescription>
                                                Selecione as colunas que serão usadas como chave na base contábil
                                            </FormDescription>
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2 flex-wrap mb-2">
                                                {(field.value || []).map((val: string) => {
                                                    const item = colsContabeis.find(c => (c.sqlite || c.excel || c.index) === val);
                                                    const label = item?.excel || item?.sqlite || val;
                                                    return (
                                                        <Badge key={val} variant="secondary" className="flex items-center gap-2">
                                                            <span className="font-mono text-xs">{label}</span>
                                                            <button type="button" className="p-1" onClick={() => field.onChange((field.value || []).filter((v: string) => v !== val))}>
                                                                <X className="h-3 w-3" />
                                                            </button>
                                                        </Badge>
                                                    );
                                                })}
                                            </div>

                                            <div>
                                                {colsContabeis.length > 0 ? (
                                                    <FormControl>
                                                        <Select onValueChange={(val) => {
                                                            if (!(field.value || []).includes(val)) {
                                                                field.onChange([...(field.value || []), val]);
                                                            }
                                                        }}>
                                                            <SelectTrigger>
                                                                <span>{(field.value || []).length > 0 ? `${(field.value || []).length} selecionadas` : 'Selecione colunas'}</span>
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
                                                        <Input placeholder="Escolha uma base para carregar colunas" />
                                                    </FormControl>
                                                )}
                                            </div>
                                        </div>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="chavesFiscais"
                                render={({ field }) => (
                                    <FormItem>
                                        <div className="mb-4">
                                            <FormLabel className="text-base">Chaves Fiscais</FormLabel>
                                            <FormDescription>
                                                Selecione as colunas que serão usadas como chave na base fiscal
                                            </FormDescription>
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2 flex-wrap mb-2">
                                                {(field.value || []).map((val: string) => {
                                                    const item = colsFiscais.find(c => (c.sqlite || c.excel || c.index) === val);
                                                    const label = item?.excel || item?.sqlite || val;
                                                    return (
                                                        <Badge key={val} variant="secondary" className="flex items-center gap-2">
                                                            <span className="font-mono text-xs">{label}</span>
                                                            <button type="button" className="p-1" onClick={() => field.onChange((field.value || []).filter((v: string) => v !== val))}>
                                                                <X className="h-3 w-3" />
                                                            </button>
                                                        </Badge>
                                                    );
                                                })}
                                            </div>

                                            <div>
                                                {colsFiscais.length > 0 ? (
                                                    <FormControl>
                                                        <Select onValueChange={(val) => {
                                                            if (!(field.value || []).includes(val)) {
                                                                field.onChange([...(field.value || []), val]);
                                                            }
                                                        }}>
                                                            <SelectTrigger>
                                                                <span>{(field.value || []).length > 0 ? `${(field.value || []).length} selecionadas` : 'Selecione colunas'}</span>
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
                                                        <Input placeholder="Escolha uma base para carregar colunas" />
                                                    </FormControl>
                                                )}
                                            </div>
                                        </div>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

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
