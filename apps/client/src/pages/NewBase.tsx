import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Plus, Trash2, Upload } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { createBases } from '@/services/baseService';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const baseSchema = z.object({
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
    header_coluna_inicial_letter: z.string().min(1).default('A'),
});

const schema = z.object({
    bases: z.array(baseSchema).min(1, { message: 'Adicione pelo menos uma base' }),
});

type FormValues = z.infer<typeof schema>;

const NewBase = () => {
    const navigate = useNavigate();
    const [submitting, setSubmitting] = useState(false);
    const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            bases: [{
                tipo: undefined as any,
                nome: '',
                periodo: '',
                arquivo: undefined as any,
                header_linha_inicial: 1,
                header_coluna_inicial_letter: 'A',
            }],
        },
    });

    const { control, watch } = form;
    const { fields, append, remove } = useFieldArray({ name: 'bases', control });
    const baseValues = watch('bases');

    const selectedFiles = baseValues?.map((base) => base?.arquivo) ?? [];

    const acceptMime = useMemo(() => ['.xlsx', '.xls', '.csv', '.xlsb'], []);

    const addBaseRow = () => {
        append({
            tipo: undefined as any,
            nome: '',
            periodo: '',
            arquivo: undefined as any,
            header_linha_inicial: 1,
            header_coluna_inicial_letter: 'A',
        });
    };

    const onSubmit = async (values: FormValues) => {
        const fd = new FormData();
        const letterToNumber = (l: string) => {
            const base = 'A'.charCodeAt(0);
            const c = l.toUpperCase().charCodeAt(0);
            if (Number.isNaN(c)) return 1;
            if (c < base) return 1;
            if (c > 'Z'.charCodeAt(0)) return 1;
            return c - base + 1;
        };

        values.bases.forEach((base) => {
            fd.append('tipo', base.tipo);
            fd.append('nome', base.nome);
            fd.append('periodo', base.periodo || '');
            fd.append('arquivo', base.arquivo as File);
            fd.append('header_linha_inicial', String(base.header_linha_inicial ?? 1));
            fd.append('header_coluna_inicial', String(letterToNumber(base.header_coluna_inicial_letter || 'A')));
        });

        setSubmitting(true);
        try {
            const resp = await createBases(fd);
            const createdList: Base[] = resp?.data?.data ?? resp?.data ?? [];
            const total = Array.isArray(createdList) ? createdList.length : 1;
            toast.success(`${total} base(s) cadastrada(s) com sucesso!`);
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
                    <CardTitle>Informações das Bases</CardTitle>
                </CardHeader>
                <CardContent>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                            {fields.map((field, index) => (
                                <div key={field.id} className="rounded-lg border p-4 space-y-4">
                                    <div className="flex items-center justify-between">
                                        <h3 className="font-semibold">Base #{index + 1}</h3>
                                        {fields.length > 1 && (
                                            <Button type="button" variant="ghost" size="sm" onClick={() => remove(index)}>
                                                <Trash2 className="h-4 w-4 mr-1" /> Remover
                                            </Button>
                                        )}
                                    </div>

                                    <FormField
                                        control={control}
                                        name={`bases.${index}.tipo` as const}
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
                                        name={`bases.${index}.nome` as const}
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
                                        name={`bases.${index}.periodo` as const}
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
                                        name={`bases.${index}.arquivo` as const}
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Arquivo *</FormLabel>
                                                <FormControl>
                                                    <div
                                                        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${draggingIndex === index ? 'border-primary bg-primary/5' : 'hover:border-primary'}`}
                                                        onDragOver={(e) => { e.preventDefault(); setDraggingIndex(index); }}
                                                        onDragLeave={() => setDraggingIndex((prev) => (prev === index ? null : prev))}
                                                        onDrop={(e) => {
                                                            e.preventDefault();
                                                            setDraggingIndex(null);
                                                            const f = e.dataTransfer?.files?.[0];
                                                            if (f) {
                                                                field.onChange(f);
                                                            }
                                                        }}
                                                    >
                                                        <input
                                                            type="file"
                                                            id={`arquivo-${index}`}
                                                            className="hidden"
                                                            onChange={(e) => {
                                                                const f = e.target.files && e.target.files[0];
                                                                if (f) field.onChange(f);
                                                            }}
                                                            accept={acceptMime.join(',')}
                                                        />
                                                        <label htmlFor={`arquivo-${index}`} className="cursor-pointer">
                                                            <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                                                            {(() => {
                                                                const currentFile = selectedFiles[index] as File | undefined;
                                                                if (currentFile) {
                                                                    return <p className="text-sm font-medium">{currentFile.name}</p>;
                                                                }
                                                                return (
                                                                    <>
                                                                        <p className="text-sm font-medium">Clique ou arraste um arquivo</p>
                                                                        <p className="text-xs text-muted-foreground mt-1">Formatos aceitos: .xlsx, .xls, .csv</p>
                                                                    </>
                                                                );
                                                            })()}
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
                                                name={`bases.${index}.header_coluna_inicial_letter` as const}
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
                                        <div>
                                            <FormField
                                                control={control}
                                                name={`bases.${index}.header_linha_inicial` as const}
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>Linha inicial do cabeçalho</FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                type="text"
                                                                value={field.value == null ? '' : String(field.value)}
                                                                onFocus={(e) => {
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
                                    </div>
                                </div>
                            ))}

                            <Button type="button" variant="secondary" onClick={addBaseRow} className="w-full" disabled={submitting}>
                                <Plus className="h-4 w-4 mr-2" /> Adicionar outra base
                            </Button>

                            <div className="flex gap-3 justify-end">
                                <Button type="button" variant="outline" onClick={() => navigate("/bases")}>
                                    Cancelar
                                </Button>
                                <Button type="submit" disabled={submitting}>
                                    {submitting ? 'Enviando...' : 'Salvar Bases'}
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