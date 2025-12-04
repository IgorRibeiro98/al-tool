import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { activateLicense } from '@/services/licenseService';

const LicenseActivate: React.FC = () => {
    const [licenseKey, setLicenseKey] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setMessage(null);
        try {
            const res = await activateLicense(licenseKey);
            // axios responses usually contain `data` with server payload
            const body = res?.data ?? {};

            setMessage('Licença ativada com sucesso! Redirecionando...');
            // refresh license status so the router can react without full reload
            try {
                await queryClient.invalidateQueries({ queryKey: ['licenseStatus'] });
            } catch (e) {
                // ignore invalidation errors
            }
            // small delay so user sees message
            setTimeout(() => navigate('/'), 800);
        } catch (err: any) {
            // axios error handling: prefer server-provided message when available
            const serverMsg = err?.response?.data?.message || err?.response?.data?.error || err?.response?.data?.detail;
            setError(serverMsg || err?.message || String(err));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-6 max-w-xl mx-auto">
            <h1 className="text-2xl font-semibold mb-4">Ativação de Licença</h1>
            <form onSubmit={onSubmit}>
                <label className="block mb-2">
                    <span className="text-sm">Chave de licença</span>
                    <input
                        value={licenseKey}
                        onChange={(e) => setLicenseKey(e.target.value)}
                        placeholder="Digite sua license key"
                        className="mt-1 block w-full rounded border px-3 py-2"
                        required
                    />
                </label>

                <div className="flex items-center gap-3">
                    <button
                        type="submit"
                        className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-60"
                        disabled={loading}
                    >
                        {loading ? 'Ativando...' : 'Ativar'}
                    </button>
                </div>
            </form>

            {message && <div className="mt-4 text-green-600">{message}</div>}
            {error && <div className="mt-4 text-red-600">{error}</div>}
        </div>
    );
};

export default LicenseActivate;
