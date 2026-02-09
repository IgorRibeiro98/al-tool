import { useCallback, useRef, useState, useEffect } from 'react';
import type { FC } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ShieldX, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const MESSAGES = {
    REFRESH_SUCCESS: 'Status da licença revalidado',
    REFRESH_FAIL: 'Falha ao revalidar status da licença',
} as const;

const LicenseBlocked: FC = () => {
    const queryClient = useQueryClient();
    const [isRefreshing, setIsRefreshing] = useState(false);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const handleRetry = useCallback(async () => {
        if (isRefreshing) return;
        setIsRefreshing(true);
        try {
            await queryClient.invalidateQueries({ queryKey: ['licenseStatus'] });
            if (!mountedRef.current) return;
            toast.success(MESSAGES.REFRESH_SUCCESS);
        } catch (err) {
            console.error('license revalidation failed', err);
            if (!mountedRef.current) return;
            toast.error(MESSAGES.REFRESH_FAIL);
        } finally {
            if (mountedRef.current) setIsRefreshing(false);
        }
    }, [queryClient, isRefreshing]);

    return (
        <div className="flex min-h-screen items-center justify-center bg-muted p-6">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
                        <ShieldX className="h-6 w-6 text-destructive" />
                    </div>
                    <CardTitle className="text-2xl">Aplicativo Bloqueado</CardTitle>
                    <CardDescription>
                        Sua licença está expirada ou foi revogada
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground text-center">
                        Entre em contato com o suporte para renovar sua licença ou clique no botão abaixo para verificar o status novamente.
                    </p>

                    <Button
                        onClick={handleRetry}
                        className="w-full"
                        variant="outline"
                        disabled={isRefreshing}
                    >
                        {isRefreshing ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Verificando...
                            </>
                        ) : (
                            <>
                                <RefreshCw className="mr-2 h-4 w-4" />
                                Verificar Status
                            </>
                        )}
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
};

export default LicenseBlocked;
