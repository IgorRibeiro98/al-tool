import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import PageSkeletonWrapper from '@/components/PageSkeletonWrapper';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { fetchBases, getBaseColumns } from '@/services/baseService';
import { createConfigMapeamento } from '@/services/configsService';
import { MappingState, buildMappingState, serializeMappingState } from '@/lib/mappingUtils';

const schema = z.object({
    nome: z.string().min(1, { message: 'Nome é obrigatório' }),
    baseContabilId: z.number({ invalid_type_error: 'Selecione a base contábil' }).int().positive(),
    baseFiscalId: z.number({ invalid_type_error: 'Selecione a base fiscal' }).int().positive()
}).refine((data) => data.baseContabilId !== data.baseFiscalId, {
    message: 'Selecione bases diferentes',
    path: ['baseFiscalId']
});

type FormValues = z.infer<typeof schema>;

const NewConfigMapeamento = () => {
    const navigate = useNavigate();
    const [bases, setBases] = useState<Base[]>([]);
    const [baseAColumns, setBaseAColumns] = useState<BaseColumn[]>([]);
    const [baseBColumns, setBaseBColumns] = useState<BaseColumn[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingColsA, setLoadingColsA] = useState(false);
    const [loadingColsB, setLoadingColsB] = useState(false);
    const [mappingState, setMappingState] = useState<MappingState>({});

    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: { nome: '', baseContabilId: undefined as any, baseFiscalId: undefined as any },
    });

    const watchBaseA = form.watch('baseContabilId');
    const watchBaseB = form.watch('baseFiscalId');

    useEffect(() => {
        fetchBases()
            .then((res) => {
                const list = res.data?.data || res.data || [];
                setBases(list as Base[]);
            })
            .catch(() => {
                setBases([]);
                toast.error('Falha ao carregar bases');
            });
    }, []);

    useEffect(() => {
        if (!watchBaseA) {
            setBaseAColumns([]);
            setMappingState({});
            return;
        }
        setLoadingColsA(true);
        getBaseColumns(watchBaseA)
            .then((res) => {
                const cols = res.data?.data || res.data || [];
                setBaseAColumns(cols as BaseColumn[]);
            })
            .catch(() => {
                setBaseAColumns([]);
                toast.error('Falha ao carregar colunas contábeis');
            })
            .finally(() => setLoadingColsA(false));
    }, [watchBaseA]);

    useEffect(() => {
        if (!watchBaseB) {
            setBaseBColumns([]);
            setMappingState({});
            return;
        }
        setLoadingColsB(true);
        getBaseColumns(watchBaseB)
            .then((res) => {
                const cols = res.data?.data || res.data || [];
                setBaseBColumns(cols as BaseColumn[]);
            })
            .catch(() => {
                setBaseBColumns([]);
                toast.error('Falha ao carregar colunas fiscais');
            })
            .finally(() => setLoadingColsB(false));
    }, [watchBaseB]);

    useEffect(() => {
        if (!watchBaseA || !watchBaseB) {
            setMappingState({});
            return;
        }
        if (baseAColumns.length === 0 || baseBColumns.length === 0) return;
        setMappingState(buildMappingState(baseAColumns, baseBColumns));
    }, [watchBaseA, watchBaseB, baseAColumns, baseBColumns]);

    const contabilBases = useMemo(() => bases.filter((b) => b.tipo === 'CONTABIL'), [bases]);
    const fiscalBases = useMemo(() => bases.filter((b) => b.tipo === 'FISCAL'), [bases]);

    const handleMappingChange = (column: string, target: string | null) => {
        setMappingState((prev) => ({ ...prev, [column]: target }));
    };

    const onSubmit = async (values: FormValues) => {
        const { nome, baseContabilId, baseFiscalId } = values;
        if (!baseContabilId || !baseFiscalId) return;
        const serialized = serializeMappingState(mappingState);
        if (serialized.length === 0) {
            toast.error('Defina ao menos um mapeamento');
            return;
        }
        setLoading(true);
        try {
            await createConfigMapeamento({
                nome,
                base_contabil_id: baseContabilId,
                base_fiscal_id: baseFiscalId,
                mapeamentos: serialized,
            });
            toast.success('Configuração criada');
            navigate('/configs/mapeamento');
        } catch (err: any) {
            console.error('create mapping config failed', err);
            toast.error(err?.response?.data?.error || 'Falha ao criar configuração');
        } finally {
            setLoading(false);
        }
    };

    const mappingEntries = Object.entries(mappingState);
    const mappingEnabled = baseAColumns.length > 0 && baseBColumns.length > 0;

    return (
        <PageSkeletonWrapper loading={loading}>
            <div className="space-y-6">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate('/configs/mapeamento')}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div>
                        <h1 className="text-3xl font-bold">Nova Configuração de Mapeamento</h1>
                        <p className="text-muted-foreground">Relacione as colunas contábeis e fiscais</p>
                    </div>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Dados da Configuração</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                                <FormField
                                    control={form.control}
                                    name="nome"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Nome *</FormLabel>
                                            <FormControl><Input placeholder="Ex: Mapeamento Padrão" {...field} /></FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <div className="grid gap-6 md:grid-cols-2">
                                    <FormField
                                        control={form.control}
                                        name="baseContabilId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Base Contábil *</FormLabel>
                                                <FormControl>
                                                    <Select value={field.value ? String(field.value) : ''} onValueChange={(val) => field.onChange(val ? Number(val) : undefined)}>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Selecione a base contábil" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {contabilBases.map((base) => (
                                                                <SelectItem key={base.id} value={String(base.id)}>{base.nome ?? `Base ${base.id}`}</SelectItem>
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
                                                <FormLabel>Base Fiscal *</FormLabel>
                                                <FormControl>
                                                    <Select value={field.value ? String(field.value) : ''} onValueChange={(val) => field.onChange(val ? Number(val) : undefined)}>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Selecione a base fiscal" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {fiscalBases.map((base) => (
                                                                <SelectItem key={base.id} value={String(base.id)}>{base.nome ?? `Base ${base.id}`}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                <div className="border rounded-lg p-4 space-y-4">
                                    <div>
                                        <h2 className="text-lg font-semibold">Mapeamento de Colunas</h2>
                                        <p className="text-sm text-muted-foreground">Selecione as colunas fiscais correspondentes para cada coluna contábil.</p>
                                    </div>
                                    {!watchBaseA || !watchBaseB ? (
                                        <p className="text-sm text-muted-foreground">Selecione as bases contábil e fiscal para configurar os mapeamentos.</p>
                                    ) : loadingColsA || loadingColsB ? (
                                        <p className="text-sm text-muted-foreground">Carregando colunas...</p>
                                    ) : !mappingEnabled ? (
                                        <p className="text-sm text-muted-foreground">Não foi possível carregar as colunas selecionadas.</p>
                                    ) : (
                                        <div className="space-y-3">
                                            {mappingEntries.map(([column, target]) => {
                                                const colInfo = baseAColumns.find((c) => c.sqlite_name === column);
                                                if (!colInfo) return null;
                                                return (
                                                    <div key={column} className="grid gap-2 md:grid-cols-3 items-center">
                                                        <div>
                                                            <p className="text-sm font-medium">{colInfo.excel_name || colInfo.sqlite_name}</p>
                                                            <p className="text-xs text-muted-foreground">{colInfo.sqlite_name}</p>
                                                        </div>
                                                        <div className="md:col-span-2">
                                                            <Select
                                                                value={target ? String(target) : 'none'}
                                                                onValueChange={(val) => handleMappingChange(column, val === 'none' ? null : val)}
                                                            >
                                                                <SelectTrigger>
                                                                    <SelectValue placeholder="Selecione a coluna fiscal" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="none">Sem correspondência</SelectItem>
                                                                    {baseBColumns.map((col) => (
                                                                        <SelectItem key={col.sqlite_name} value={col.sqlite_name}>
                                                                            {col.excel_name || col.sqlite_name}
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                <div className="flex justify-end gap-3">
                                    <Button type="button" variant="outline" onClick={() => navigate('/configs/mapeamento')}>Cancelar</Button>
                                    <Button type="submit" disabled={!mappingEnabled}>Salvar Configuração</Button>
                                </div>
                            </form>
                        </Form>
                    </CardContent>
                </Card>
            </div>
        </PageSkeletonWrapper>
    );
};

export default NewConfigMapeamento;
