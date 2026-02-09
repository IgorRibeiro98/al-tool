import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Key, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { activateLicense } from '@/services/licenseService';

const REDIRECT_DELAY_MS = 800;

const MESSAGES = {
    SUCCESS: 'Licença ativada com sucesso!',
    INVALID_KEY: 'Informe uma chave de licença válida.',
    REDIRECT: 'Redirecionando para a página inicial...',
} as const;

const extractServerMessage = (err: unknown): string => {
    const e = err as { response?: { data?: { message?: string; error?: string; detail?: string } }; message?: string };
    return e?.response?.data?.message || e?.response?.data?.error || e?.response?.data?.detail || e?.message || String(err);
};

const LicenseActivate: FC = () => {
    const [licenseKey, setLicenseKey] = useState('');
    const [loading, setLoading] = useState(false);

    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const mountedRef = useRef(true);
    const timeoutRef = useRef<number | null>(null);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, []);

    const handleActivate = useCallback(async (key: string) => {
        setLoading(true);

        try {
            await activateLicense(key.trim());
            if (!mountedRef.current) return;

            toast.success(MESSAGES.SUCCESS, { description: MESSAGES.REDIRECT });

            // Refresh license status cache
            try {
                await queryClient.invalidateQueries({ queryKey: ['licenseStatus'] });
            } catch {
                // ignore invalidate errors
            }

            // Navigate after a short delay so the user sees confirmation
            timeoutRef.current = window.setTimeout(() => {
                if (!mountedRef.current) return;
                navigate('/');
            }, REDIRECT_DELAY_MS);
        } catch (err: unknown) {
            if (!mountedRef.current) return;
            toast.error('Falha na ativação', { description: extractServerMessage(err) });
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, [navigate, queryClient]);

    const onSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        const key = licenseKey.trim();
        if (!key) {
            toast.error(MESSAGES.INVALID_KEY);
            return;
        }
        void handleActivate(key);
    }, [licenseKey, handleActivate]);

    const onChangeKey = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setLicenseKey(e.target.value);
    }, []);

    const isSubmitDisabled = loading || licenseKey.trim() === '';

    return (
        <div className="flex min-h-screen items-center justify-center bg-muted p-6">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                        <Key className="h-6 w-6 text-primary" />
                    </div>
                    <CardTitle className="text-2xl">Ativação de Licença</CardTitle>
                    <CardDescription>
                        Insira sua chave de licença para ativar o aplicativo
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={onSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="license-key">Chave de licença</Label>
                            <Input
                                id="license-key"
                                value={licenseKey}
                                onChange={onChangeKey}
                                placeholder="XXXX-XXXX-XXXX-XXXX"
                                aria-label="Chave de licença"
                                disabled={loading}
                            />
                        </div>

                        <Button
                            type="submit"
                            className="w-full"
                            disabled={isSubmitDisabled}
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Ativando...
                                </>
                            ) : (
                                'Ativar Licença'
                            )}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
};

export default LicenseActivate;
