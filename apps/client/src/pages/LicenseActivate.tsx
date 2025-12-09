import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { activateLicense } from '@/services/licenseService';

const REDIRECT_DELAY_MS = 800;

const LicenseActivate: React.FC = () => {
    const [licenseKey, setLicenseKey] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const mountedRef = useRef(true);
    const timeoutRef = useRef<number | null>(null);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    const MESSAGES = useMemo(() => ({
        SUCCESS: 'Licença ativada com sucesso! Redirecionando...',
        INVALID_KEY: 'Informe a chave de licença válida.',
    }), []);

    const extractServerMessage = useCallback((err: any): string => {
        return err?.response?.data?.message || err?.response?.data?.error || err?.response?.data?.detail || err?.message || String(err);
    }, []);

    const handleActivate = useCallback(async (key: string) => {
        setLoading(true);
        setError(null);
        setMessage(null);

        try {
            await activateLicense(key.trim());
            if (!mountedRef.current) return;
            setMessage(MESSAGES.SUCCESS);

            // best-effort refresh of license status cache
            try {
                await queryClient.invalidateQueries({ queryKey: ['licenseStatus'] });
            } catch (_) {
                // ignore invalidate errors
            }

            // navigate after a short delay so the user sees confirmation
            timeoutRef.current = window.setTimeout(() => {
                if (!mountedRef.current) return;
                navigate('/');
            }, REDIRECT_DELAY_MS);
        } catch (err: any) {
            if (!mountedRef.current) return;
            setError(extractServerMessage(err));
        } finally {
            if (!mountedRef.current) return;
            setLoading(false);
        }
    }, [MESSAGES, navigate, queryClient, extractServerMessage]);

    const onSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        const key = licenseKey.trim();
        if (!key) {
            setError(MESSAGES.INVALID_KEY);
            return;
        }
        void handleActivate(key);
    }, [licenseKey, handleActivate, MESSAGES]);

    const onChangeKey = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setLicenseKey(e.target.value);
        setError(null);
    }, []);

    return (
        <div className="p-6 max-w-xl mx-auto">
            <h1 className="text-2xl font-semibold mb-4">Ativação de Licença</h1>
            <form onSubmit={onSubmit}>
                <label className="block mb-2">
                    <span className="text-sm">Chave de licença</span>
                    <input
                        value={licenseKey}
                        onChange={onChangeKey}
                        placeholder="Digite sua license key"
                        className="mt-1 block w-full rounded border px-3 py-2"
                        aria-label="Chave de licença"
                        required
                    />
                </label>

                <div className="flex items-center gap-3">
                    <button
                        type="submit"
                        className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-60"
                        disabled={loading || licenseKey.trim() === ''}
                    >
                        {loading ? 'Ativando...' : 'Ativar'}
                    </button>
                </div>
            </form>

            <div aria-live="polite" className="mt-4">
                {message && <div className="text-green-600">{message}</div>}
                {error && <div className="text-red-600">{error}</div>}
            </div>
        </div>
    );
};

export default LicenseActivate;
