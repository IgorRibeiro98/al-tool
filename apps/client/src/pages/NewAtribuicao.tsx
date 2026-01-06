import React, { FC, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ArrowRightLeft, ChevronUp, ChevronDown, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import * as atribuicaoService from '@/services/atribuicaoService';
import * as baseService from '@/services/baseService';
import api from '@/services/api';

type Base = {
    id: number;
    nome: string;
    tipo: string;
};

type KeysPair = {
    id: number;
    nome: string;
    contabil_key?: { nome: string } | null;
    fiscal_key?: { nome: string } | null;
};

type BaseColumn = {
    id: number;
    sqlite_name: string;
    excel_name?: string;
    col_name?: string;
    header?: string;
};

const NewAtribuicao: FC = () => {
    const navigate = useNavigate();
    const { toast } = useToast();

    const [nome, setNome] = useState('');
    const [baseOrigemId, setBaseOrigemId] = useState<number | null>(null);
    const [baseDestinoId, setBaseDestinoId] = useState<number | null>(null);
    const [modeWrite, setModeWrite] = useState<'OVERWRITE' | 'ONLY_EMPTY'>('OVERWRITE');
    const [updateOriginalBase, setUpdateOriginalBase] = useState(true);  // default true
    const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
    const [selectedKeys, setSelectedKeys] = useState<Array<{ keysPairId: number; keyIdentifier: string }>>([]);

    const [bases, setBases] = useState<Base[]>([]);
    const [keysPairs, setKeysPairs] = useState<KeysPair[]>([]);
    const [origemColumns, setOrigemColumns] = useState<BaseColumn[]>([]);
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    // Load bases
    useEffect(() => {
        const loadBases = async () => {
            try {
                const res = await baseService.fetchBases();
                const data = res.data?.data || res.data || [];
                setBases(data.filter((b: any) => ['FISCAL', 'CONTABIL'].includes((b.tipo || '').toUpperCase())));
            } catch (err) {
                console.error('Failed to load bases', err);
            }
        };
        loadBases();
    }, []);

    // Load keys pairs
    useEffect(() => {
        const loadKeysPairs = async () => {
            try {
                const res = await api.get('/keys-pairs');
                setKeysPairs(res.data?.data || []);
            } catch (err) {
                console.error('Failed to load keys pairs', err);
            }
        };
        loadKeysPairs();
    }, []);

    // Load origem columns when origem changes
    useEffect(() => {
        if (!baseOrigemId) {
            setOrigemColumns([]);
            return;
        }
        const loadColumns = async () => {
            try {
                const res = await api.get(`/bases/${baseOrigemId}/columns`);
                // API returns { data: cols }
                const cols = res.data?.data || res.data || [];
                setOrigemColumns(Array.isArray(cols) ? cols : []);
            } catch (err) {
                console.error('Failed to load columns', err);
                setOrigemColumns([]);
            }
        };
        loadColumns();
    }, [baseOrigemId]);

    // Validate base types
    const baseOrigem = bases.find(b => b.id === baseOrigemId);
    const baseDestino = bases.find(b => b.id === baseDestinoId);
    const isValidTypes = baseOrigem && baseDestino && baseOrigem.tipo !== baseDestino.tipo;

    const handleAddKey = (keysPairId: number) => {
        if (selectedKeys.some(k => k.keysPairId === keysPairId)) return;
        const idx = selectedKeys.length + 1;
        setSelectedKeys([...selectedKeys, { keysPairId, keyIdentifier: `CHAVE_${idx}` }]);
    };

    const handleRemoveKey = (keysPairId: number) => {
        const updated = selectedKeys.filter(k => k.keysPairId !== keysPairId);
        // Re-index
        setSelectedKeys(updated.map((k, i) => ({ ...k, keyIdentifier: `CHAVE_${i + 1}` })));
    };

    const handleMoveKey = (index: number, direction: 'up' | 'down') => {
        const newIndex = direction === 'up' ? index - 1 : index + 1;
        if (newIndex < 0 || newIndex >= selectedKeys.length) return;
        const updated = [...selectedKeys];
        [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
        // Re-index
        setSelectedKeys(updated.map((k, i) => ({ ...k, keyIdentifier: `CHAVE_${i + 1}` })));
    };

    const toggleColumn = (colName: string) => {
        if (selectedColumns.includes(colName)) {
            setSelectedColumns(selectedColumns.filter(c => c !== colName));
        } else {
            setSelectedColumns([...selectedColumns, colName]);
        }
    };

    const handleSubmit = async () => {
        if (!baseOrigemId || !baseDestinoId) {
            toast({ title: 'Erro', description: 'Selecione origem e destino', variant: 'destructive' });
            return;
        }
        if (!isValidTypes) {
            toast({ title: 'Erro', description: 'Origem e destino devem ser de tipos diferentes', variant: 'destructive' });
            return;
        }
        if (selectedKeys.length === 0) {
            toast({ title: 'Erro', description: 'Selecione pelo menos uma chave', variant: 'destructive' });
            return;
        }
        if (selectedColumns.length === 0) {
            toast({ title: 'Erro', description: 'Selecione pelo menos uma coluna para importar', variant: 'destructive' });
            return;
        }

        setSubmitting(true);
        try {
            const res = await atribuicaoService.createRun({
                nome: nome || undefined,
                baseOrigemId,
                baseDestinoId,
                modeWrite,
                updateOriginalBase,
                selectedColumns,
                keysPairs: selectedKeys.map((k, i) => ({
                    keysPairId: k.keysPairId,
                    keyIdentifier: k.keyIdentifier,
                    ordem: i,
                })),
            });
            toast({ title: 'Sucesso', description: 'Atribuição criada' });
            navigate(`/atribuicoes/${res.data.id}`);
        } catch (err: any) {
            console.error('Failed to create run', err);
            toast({
                title: 'Erro',
                description: err?.response?.data?.error || 'Falha ao criar atribuição',
                variant: 'destructive',
            });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => navigate('/atribuicoes')}>
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <div className="flex items-center gap-3">
                    <ArrowRightLeft className="h-8 w-8 text-primary" />
                    <h1 className="text-2xl font-bold">Nova Atribuição</h1>
                </div>
                {/* Submit */}
                <div className="flex justify-end gap-4 ml-auto">
                    <Button variant="outline" onClick={() => navigate('/atribuicoes')}>
                        Cancelar
                    </Button>
                    <Button onClick={handleSubmit} disabled={submitting || !isValidTypes || selectedKeys.length === 0 || selectedColumns.length === 0}>
                        {submitting ? 'Criando...' : 'Criar Atribuição'}
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Column - Configuration */}
                <div className="space-y-6">
                    {/* Basic Info */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Informações Básicas</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <Label htmlFor="nome">Nome (opcional)</Label>
                                <Input
                                    id="nome"
                                    value={nome}
                                    onChange={(e) => setNome(e.target.value)}
                                    placeholder="Ex: Atribuição Dezembro 2024"
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Bases Selection */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Seleção de Bases</CardTitle>
                            <CardDescription>Selecione a base de origem (dados a importar) e destino (receberá os dados)</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <Label>Base Origem</Label>
                                <Select
                                    value={baseOrigemId?.toString() || ''}
                                    onValueChange={(v) => setBaseOrigemId(Number(v))}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecione a base de origem" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {bases.map((b) => (
                                            <SelectItem
                                                key={b.id}
                                                value={b.id.toString()}
                                                disabled={b.id === baseDestinoId}
                                            >
                                                {b.nome} ({b.tipo})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label>Base Destino</Label>
                                <Select
                                    value={baseDestinoId?.toString() || ''}
                                    onValueChange={(v) => setBaseDestinoId(Number(v))}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecione a base de destino" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {bases.map((b) => (
                                            <SelectItem
                                                key={b.id}
                                                value={b.id.toString()}
                                                disabled={b.id === baseOrigemId}
                                            >
                                                {b.nome} ({b.tipo})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            {baseOrigemId && baseDestinoId && !isValidTypes && (
                                <p className="text-sm text-destructive">
                                    ⚠️ Origem e destino devem ser de tipos diferentes (FISCAL ↔ CONTABIL)
                                </p>
                            )}
                            {isValidTypes && (
                                <p className="text-sm text-green-600">
                                    ✓ {baseOrigem?.tipo} → {baseDestino?.tipo}
                                </p>
                            )}
                        </CardContent>
                    </Card>

                    {/* Write Mode */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Modo de Escrita</CardTitle>
                            <CardDescription>Define como os valores importados serão escritos no destino</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="font-medium">Somente se vazio</p>
                                    <p className="text-sm text-muted-foreground">
                                        {modeWrite === 'ONLY_EMPTY'
                                            ? 'Importa apenas para células vazias no destino'
                                            : 'Sobrescreve todos os valores no destino'}
                                    </p>
                                </div>
                                <Switch
                                    checked={modeWrite === 'ONLY_EMPTY'}
                                    onCheckedChange={(checked) => setModeWrite(checked ? 'ONLY_EMPTY' : 'OVERWRITE')}
                                />
                            </div>
                            <div className="flex items-center justify-between pt-2 border-t">
                                <div>
                                    <p className="font-medium">Alterar base de destino original</p>
                                    <p className="text-sm text-muted-foreground">
                                        {updateOriginalBase
                                            ? 'As colunas selecionadas serão adicionadas/atualizadas diretamente na base de destino'
                                            : 'Apenas a tabela de resultado será criada, a base original não será modificada'}
                                    </p>
                                </div>
                                <Switch
                                    checked={updateOriginalBase}
                                    onCheckedChange={setUpdateOriginalBase}
                                />
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Right Column - Keys and Columns */}
                <div className="space-y-6">
                    {/* Keys Selection */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Chaves de Correspondência</CardTitle>
                            <CardDescription>Selecione e ordene as chaves por prioridade (primeira que corresponder vence)</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Selected keys with ordering */}
                            {selectedKeys.length > 0 && (
                                <div className="space-y-2 mb-4">
                                    <Label>Chaves selecionadas (em ordem de prioridade)</Label>
                                    {selectedKeys.map((sk, idx) => {
                                        const pair = keysPairs.find(kp => kp.id === sk.keysPairId);
                                        return (
                                            <div key={sk.keysPairId} className="flex items-center gap-2 p-2 border rounded-md bg-muted/50">
                                                <Badge variant="outline">{sk.keyIdentifier}</Badge>
                                                <span className="flex-1 text-sm">{pair?.nome || `Par ${sk.keysPairId}`}</span>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleMoveKey(idx, 'up')}
                                                    disabled={idx === 0}
                                                >
                                                    <ChevronUp className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleMoveKey(idx, 'down')}
                                                    disabled={idx === selectedKeys.length - 1}
                                                >
                                                    <ChevronDown className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleRemoveKey(sk.keysPairId)}
                                                >
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Available keys */}
                            <div>
                                <Label>Adicionar chave</Label>
                                <Select onValueChange={(v) => handleAddKey(Number(v))}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecione uma chave para adicionar" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {keysPairs
                                            .filter(kp => !selectedKeys.some(sk => sk.keysPairId === kp.id))
                                            .map((kp) => (
                                                <SelectItem key={kp.id} value={kp.id.toString()}>
                                                    {kp.nome}
                                                </SelectItem>
                                            ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Columns Selection */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Colunas a Importar</CardTitle>
                            <CardDescription>Selecione as colunas da origem que serão importadas para o destino</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {!baseOrigemId ? (
                                <p className="text-sm text-muted-foreground">Selecione a base de origem primeiro</p>
                            ) : origemColumns.length === 0 ? (
                                <p className="text-sm text-muted-foreground">Carregando colunas...</p>
                            ) : (
                                <div className="max-h-64 overflow-y-auto space-y-2">
                                    {origemColumns.map((col, idx) => {
                                        const colKey = col.sqlite_name || col.col_name || `col_${idx}`;
                                        const colLabel = col.excel_name || col.header || col.sqlite_name || colKey;
                                        return (
                                            <div
                                                key={`${idx}-${colKey}`}
                                                className={`flex items-center gap-2 p-2 border rounded-md cursor-pointer transition-colors ${selectedColumns.includes(colKey)
                                                    ? 'bg-primary/10 border-primary'
                                                    : 'hover:bg-muted'
                                                    }`}
                                                onClick={() => toggleColumn(colKey)}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedColumns.includes(colKey)}
                                                    onChange={() => toggleColumn(colKey)}
                                                    className="pointer-events-none"
                                                />
                                                <span className="text-sm">{colLabel}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            {selectedColumns.length > 0 && (
                                <p className="text-sm text-muted-foreground mt-2">
                                    {selectedColumns.length} coluna(s) selecionada(s)
                                </p>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>


        </div>
    );
};

export default NewAtribuicao;
