import React, { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

const LicenseBlocked: React.FC = () => {
    const queryClient = useQueryClient();
    const [isRefreshing, setIsRefreshing] = useState(false);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const MESSAGES = useMemo(() => ({
        REFRESH_SUCCESS: 'Status da licença revalidado',
        REFRESH_FAIL: 'Falha ao revalidar status da licença',
    }), []);

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
    }, [queryClient, isRefreshing, MESSAGES]);

    return (
        <div className="p-6 max-w-xl mx-auto">
            <h1 className="text-2xl font-semibold mb-4">Aplicativo Bloqueado</h1>
            <p className="mb-4">Sua licença está expirada ou bloqueada. Entre em contato com o suporte ou tente revalidar.</p>
            <div className="flex items-center gap-3">
                <button
                    onClick={handleRetry}
                    className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-60"
                    disabled={isRefreshing}
                >
                    {isRefreshing ? 'Revalidando...' : 'Revalidar status'}
                </button>
            </div>
        </div>
    );
};

export default LicenseBlocked;
