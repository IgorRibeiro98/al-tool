import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Upload } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { toast } from "sonner";
import { createBase } from '@/services/baseService';

type TipoOption = 'CONTABIL' | 'FISCAL';

const NewBase = () => {
    const navigate = useNavigate();
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [tipo, setTipo] = useState<TipoOption | ''>('');
    const [nome, setNome] = useState('');
    const [periodo, setPeriodo] = useState('');
    const [headerLinhaInicial, setHeaderLinhaInicial] = useState<number>(1);
    // column as letter A-Z for the UI; will be converted to number before submit
    const [headerColunaInicialLetter, setHeaderColunaInicialLetter] = useState<string>('A');
    const [submitting, setSubmitting] = useState(false);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setSelectedFile(e.target.files[0]);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!tipo || !nome || !selectedFile) {
            toast.error('Preencha tipo, nome e selecione um arquivo.');
            return;
        }

        const fd = new FormData();
        fd.append('tipo', tipo);
        fd.append('nome', nome);
        fd.append('periodo', periodo || '');
        fd.append('arquivo', selectedFile);
        fd.append('header_linha_inicial', String(headerLinhaInicial));
        // convert column letter (A-Z) to 1-based index
        const letter = (headerColunaInicialLetter || 'A').toUpperCase();
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
            // navigate to bases list or the created base detail
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
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor="tipo">Tipo *</Label>
                            <Select required value={tipo} onValueChange={(v) => setTipo(v as TipoOption)}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione o tipo" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="CONTABIL">CONTÁBIL</SelectItem>
                                    <SelectItem value="FISCAL">FISCAL</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="nome">Nome *</Label>
                            <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Base Contábil Janeiro" required />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="periodo">Período *</Label>
                            <Input id="periodo" value={periodo} onChange={(e) => setPeriodo(e.target.value)} placeholder="Ex: 01/2024" required />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="arquivo">Arquivo *</Label>
                            <div className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary transition-colors cursor-pointer">
                                <input
                                    type="file"
                                    id="arquivo"
                                    className="hidden"
                                    onChange={handleFileChange}
                                    accept=".xlsx,.xls,.csv,.xlsb"
                                />
                                <label htmlFor="arquivo" className="cursor-pointer">
                                    <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                                    {selectedFile ? (
                                        <p className="text-sm font-medium">{selectedFile.name}</p>
                                    ) : (
                                        <>
                                            <p className="text-sm font-medium">Clique ou arraste um arquivo</p>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                Formatos aceitos: .xlsx, .xls, .csv
                                            </p>
                                        </>
                                    )}
                                </label>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label htmlFor="headerLinha">Linha inicial do cabeçalho</Label>
                                <Input id="headerLinha" type="number" value={headerLinhaInicial} min={1} onChange={(e) => setHeaderLinhaInicial(Number(e.target.value || 1))} />
                            </div>
                            <div>
                                <Label htmlFor="headerCol">Coluna inicial do cabeçalho</Label>
                                <Select value={headerColunaInicialLetter} onValueChange={(v) => setHeaderColunaInicialLetter(v)}>
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
                </CardContent>
            </Card>
        </div>
    );
};

export default NewBase;