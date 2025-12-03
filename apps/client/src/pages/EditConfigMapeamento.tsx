import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import { getConfigMapeamento, updateConfigMapeamento } from '@/services/configsService';
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

const EditConfigMapeamento = () => {
    const navigate = useNavigate();
    const { id } = useParams();
    const numericId = id ? Number(id) : NaN;

    const [bases, setBases] = useState<Base[]>([]);
    const [baseAColumns, setBaseAColumns] = useState<BaseColumn[]>([]);
    const [baseBColumns, setBaseBColumns] = useState<BaseColumn[]>([]);
    const [pairsForBuild, setPairsForBuild] = useState<Array<{ coluna_contabil: string; coluna_fiscal: string }>>([]);
    const [mappingState, setMappingState] = useState<MappingState>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [loadingColsA, setLoadingColsA] = useState(false);
    const [loadingColsB, setLoadingColsB] = useState(false);
    const [loadedConfig, setLoadedConfig] = useState<ConfigMapeamento | null>(null);

    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: { nome: '', baseContabilId: undefined as any, baseFiscalId: undefined as any },
    });

    const watchBaseA = form.watch('baseContabilId');
    const watchBaseB = form.watch('baseFiscalId');

    useEffect(() => {
        let mounted = true;
        if (!numericId) {
            toast.error('Configuração inválida');
            navigate('/configs/mapeamento');
            return;
        }
        setLoading(true);
        Promise.all([fetchBases(), getConfigMapeamento(numericId)])
            .then(([basesRes, configRes]) => {
                if (!mounted) return;
                const basesList = basesRes.data?.data || basesRes.data || [];
                setBases(basesList as Base[]);
                const config = configRes.data as ConfigMapeamento;
                setLoadedConfig(config);
                form.reset({
                    nome: config.nome ?? '',
                    baseContabilId: config.base_contabil_id,
                    baseFiscalId: config.base_fiscal_id,
                });
                setPairsForBuild(config.mapeamentos || []);
            })
            .catch((err) => {
                console.error('failed to load mapping config', err);
                toast.error('Falha ao carregar configuração');
                navigate('/configs/mapeamento');
            })
            .finally(() => { if (mounted) setLoading(false); });
        return () => { mounted = false; };
    }, [numericId, form, navigate]);

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
                toast.error('Falha ao carregar colunas contábeis');
                setBaseAColumns([]);
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
                toast.error('Falha ao carregar colunas fiscais');
                setBaseBColumns([]);
            })
            .finally(() => setLoadingColsB(false));
    }, [watchBaseB]);

    useEffect(() => {
        if (!watchBaseA || !watchBaseB) {
            setMappingState({});
            return;
        }
        if (baseAColumns.length === 0 || baseBColumns.length === 0) return;
        setMappingState(buildMappingState(baseAColumns, baseBColumns, pairsForBuild));
    }, [watchBaseA, watchBaseB, baseAColumns, baseBColumns, pairsForBuild]);

    useEffect(() => {
        if (!loadedConfig) return;
        if (!watchBaseA || !watchBaseB) {
            setPairsForBuild((prev) => (prev.length === 0 ? prev : []));
            return;
        }
        const isOriginal = watchBaseA === loadedConfig.base_contabil_id && watchBaseB === loadedConfig.base_fiscal_id;
        if (isOriginal) {
            const target = loadedConfig.mapeamentos || [];
            setPairsForBuild((prev) => (prev === target ? prev : target));
        } else {
            setPairsForBuild((prev) => (prev.length === 0 ? prev : []));
        }
    }, [watchBaseA, watchBaseB, loadedConfig]);

    const contabilBases = useMemo(() => bases.filter((b) => b.tipo === 'CONTABIL'), [bases]);
    const fiscalBases = useMemo(() => bases.filter((b) => b.tipo === 'FISCAL'), [bases]);

    const handleMappingChange = (column: string, target: string | null) => {
        setMappingState((prev) => ({ ...prev, [column]: target }));
    };

    const onSubmit = async (values: FormValues) => {
        if (!numericId) return;
        const serialized = serializeMappingState(mappingState);
        if (serialized.length === 0) {
            toast.error('Defina ao menos um mapeamento');
            return;
        }
        setSaving(true);
        try {
            await updateConfigMapeamento(numericId, {
                nome: values.nome,
                base_contabil_id: values.baseContabilId,
                base_fiscal_id: values.baseFiscalId,
                mapeamentos: serialized,
            });
            toast.success('Configuração atualizada');
            navigate('/configs/mapeamento');
        } catch (err: any) {
            console.error('update mapping config failed', err);
            toast.error(err?.response?.data?.error || 'Falha ao atualizar configuração');
        } finally {
            setSaving(false);
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
                        <h1 className="text-3xl font-bold">Editar Configuração de Mapeamento</h1>
                        <p className="text-muted-foreground">Atualize o relacionamento entre colunas</p>
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
                                            <FormControl><Input placeholder="Nome do mapeamento" {...field} /></FormControl>
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
                                        <p className="text-sm text-muted-foreground">Selecione a coluna fiscal correspondente para cada coluna contábil.</p>
                                    </div>
                                    {!watchBaseA || !watchBaseB ? (
                                        <p className="text-sm text-muted-foreground">Selecione as bases para visualizar os mapeamentos.</p>
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
                                                            <Select value={target ? String(target) : 'none'} onValueChange={(val) => handleMappingChange(column, val === 'none' ? null : val)}>
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
                                    <Button type="submit" disabled={!mappingEnabled || saving}>{saving ? 'Salvando...' : 'Salvar Alterações'}</Button>
                                </div>
                            </form>
                        </Form>
                    </CardContent>
                </Card>
            </div>
        </PageSkeletonWrapper>
    );
};

export default EditConfigMapeamento;
