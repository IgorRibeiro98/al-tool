import React from 'react';
import { useQueryClient } from '@tanstack/react-query';

const LicenseBlocked: React.FC = () => {
    const queryClient = useQueryClient();

    const onRetry = async () => {
        try {
            await queryClient.invalidateQueries({ queryKey: ['licenseStatus'] });
        } catch (e) {
            // ignore
        }
    };

    return (
        <div className="p-6 max-w-xl mx-auto">
            <h1 className="text-2xl font-semibold mb-4">Aplicativo Bloqueado</h1>
            <p className="mb-4">Sua licença está expirada ou bloqueada. Entre em contato com o suporte ou tente revalidar.</p>
            <div className="flex items-center gap-3">
                <button
                    onClick={onRetry}
                    className="bg-blue-600 text-white px-4 py-2 rounded"
                >
                    Revalidar status
                </button>
            </div>
        </div>
    );
};

export default LicenseBlocked;
