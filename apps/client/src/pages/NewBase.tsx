import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Upload } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { toast } from "sonner";
import { createBase } from '@/services/baseService';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

type TipoOption = 'CONTABIL' | 'FISCAL';

const schema = z.object({
    tipo: z.enum(['CONTABIL', 'FISCAL'], { required_error: 'Tipo é obrigatório' }),
    nome: z.string().min(1, { message: 'Nome é obrigatório' }),
    periodo: z.string().min(1, { message: 'Período é obrigatório' }),
    arquivo: z.instanceof(File, { message: 'Arquivo é obrigatório' }),
    header_linha_inicial: z.preprocess((val) => {
        if (typeof val === 'string') {
            const s = val.trim();
            if (s === '') return undefined;
            const n = Number(s);
            return Number.isNaN(n) ? val : n;
        }
        return val;
    }, z.number().min(1).default(1)),
    header_coluna_inicial_letter: z.string().min(1).optional().default('A'),
});

type FormValues = z.infer<typeof schema>;

const NewBase = () => {
    const navigate = useNavigate();
    const [submitting, setSubmitting] = useState(false);

    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            tipo: undefined as any,
            nome: '',
            periodo: '',
            arquivo: undefined as any,
            header_linha_inicial: 1,
            header_coluna_inicial_letter: 'A',
        },
    });

    const { control, watch } = form;

    const selectedFile = watch('arquivo');

    const onSubmit = async (values: FormValues) => {
        // values validated by zod
        const fd = new FormData();
        fd.append('tipo', values.tipo);
        fd.append('nome', values.nome);
        fd.append('periodo', values.periodo || '');
        fd.append('arquivo', values.arquivo as File);
        fd.append('header_linha_inicial', String(values.header_linha_inicial ?? 1));

        // convert column letter (A-Z) to 1-based index
        const letter = (values.header_coluna_inicial_letter || 'A').toUpperCase();
        const letterToNumber = (l: string) => {
            const base = 'A'.charCodeAt(0);
            const c = l.charCodeAt(0);
            if (isNaN(c)) return 1;
            if (c < base) return 1;
            if (c > 'Z'.charCodeAt(0)) return 1;
            return c - base + 1;
        };
        fd.append('header_coluna_inicial', String(letterToNumber(letter)));

        setSubmitting(true);
        try {
            const resp = await createBase(fd);
            toast.success('Base cadastrada com sucesso!');
            const created: Base = resp.data;
            navigate('/bases');
        } catch (err: any) {
            console.error('create base failed', err);
            const msg = err?.response?.data?.error || err?.message || 'Erro ao cadastrar base';
            toast.error(msg);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => navigate("/bases")}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <h1 className="text-3xl font-bold">Nova Base</h1>
                    <p className="text-muted-foreground">Adicione uma nova base contábil ou fiscal</p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Informações da Base</CardTitle>
                </CardHeader>
                <CardContent>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                            <FormField
                                control={control}
                                name="tipo"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Tipo *</FormLabel>
                                        <FormControl>
                                            <Select value={field.value ?? ''} onValueChange={(v) => field.onChange(v || undefined)}>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Selecione o tipo" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="CONTABIL">CONTÁBIL</SelectItem>
                                                    <SelectItem value="FISCAL">FISCAL</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={control}
                                name="nome"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Nome *</FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="Ex: Base Contábil Janeiro"
                                                value={field.value ?? ''}
                                                onChange={(e) => field.onChange(e.target.value)}
                                            />
                                        </FormControl>
                                        <FormDescription>Nome identificador da base</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={control}
                                name="periodo"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Período *</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Ex: 01/2024" value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value)} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={control}
                                name="arquivo"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Arquivo *</FormLabel>
                                        <FormControl>
                                            <div className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary transition-colors cursor-pointer">
                                                <input
                                                    type="file"
                                                    id="arquivo"
                                                    className="hidden"
                                                    onChange={(e) => {
                                                        const f = e.target.files && e.target.files[0];
                                                        if (f) field.onChange(f);
                                                    }}
                                                    accept=".xlsx,.xls,.csv,.xlsb"
                                                />
                                                <label htmlFor="arquivo" className="cursor-pointer">
                                                    <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                                                    {selectedFile ? (
                                                        <p className="text-sm font-medium">{(selectedFile as File).name}</p>
                                                    ) : (
                                                        <>
                                                            <p className="text-sm font-medium">Clique ou arraste um arquivo</p>
                                                            <p className="text-xs text-muted-foreground mt-1">Formatos aceitos: .xlsx, .xls, .csv</p>
                                                        </>
                                                    )}
                                                </label>
                                            </div>
                                        </FormControl>
                                        <FormDescription>Formate o arquivo em Excel ou CSV</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <FormField
                                        control={control}
                                        name="header_linha_inicial"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Linha inicial do cabeçalho</FormLabel>
                                                <FormControl>
                                                    <Input
                                                        type="text"
                                                        value={field.value == null ? '' : String(field.value)}
                                                        onFocus={(e) => {
                                                            // clear the field for easy typing and select all
                                                            (field.onChange as any)('');
                                                            (e.target as HTMLInputElement).select();
                                                        }}
                                                        onChange={(e) => {
                                                            (field.onChange as any)(e.target.value);
                                                        }}
                                                        onBlur={() => {
                                                            const v = field.value as unknown;
                                                            if (v == null || String(v).trim() === '') {
                                                                (field.onChange as any)('1');
                                                            }
                                                        }}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                                <div>
                                    <FormField
                                        control={control}
                                        name="header_coluna_inicial_letter"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Coluna inicial do cabeçalho</FormLabel>
                                                <FormControl>
                                                    <Select value={field.value ?? ''} onValueChange={(v) => field.onChange(v || undefined)}>
                                                        <SelectTrigger>
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {Array.from({ length: 26 }).map((_, i) => {
                                                                const letter = String.fromCharCode('A'.charCodeAt(0) + i);
                                                                return <SelectItem key={letter} value={letter}>{letter}</SelectItem>;
                                                            })}
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </div>

                            <div className="flex gap-3 justify-end">
                                <Button type="button" variant="outline" onClick={() => navigate("/bases")}>
                                    Cancelar
                                </Button>
                                <Button type="submit" disabled={submitting}>
                                    {submitting ? 'Enviando...' : 'Salvar Base'}
                                </Button>
                            </div>
                        </form>
                    </Form>
                </CardContent>
            </Card>
        </div>
    );
};

export default NewBase;