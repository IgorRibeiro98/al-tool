/**
 * Testes unitários para lógica de licenciamento nas rotas
 */
import { describe, it, expect } from 'vitest';

describe('License Route Logic', () => {
    describe('License Status Calculation', () => {
        interface LicenseRecord {
            id: number;
            license_key: string;
            status: string;
            valid_until: string | null;
            machine_id: string | null;
            last_online_validation: string | null;
            offline_grace_days: number;
        }

        const calculateLicenseStatus = (
            license: LicenseRecord | undefined,
            currentDate: Date
        ): { isActive: boolean; status: string; daysRemaining?: number } => {
            if (!license) {
                return { isActive: false, status: 'not_activated' };
            }

            if (license.status === 'expired' || license.status === 'revoked') {
                return { isActive: false, status: license.status };
            }

            if (license.valid_until) {
                const expiry = new Date(license.valid_until);
                if (currentDate > expiry) {
                    return { isActive: false, status: 'expired' };
                }
                const daysRemaining = Math.ceil((expiry.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));
                return { isActive: true, status: 'active', daysRemaining };
            }

            return { isActive: true, status: 'active' };
        };

        it('deve retornar not_activated quando não há licença', () => {
            const result = calculateLicenseStatus(undefined, new Date());
            expect(result.isActive).toBe(false);
            expect(result.status).toBe('not_activated');
        });

        it('deve retornar expired para licença expirada', () => {
            const license: LicenseRecord = {
                id: 1,
                license_key: 'TEST-KEY',
                status: 'active',
                valid_until: '2024-01-01',
                machine_id: 'machine-1',
                last_online_validation: null,
                offline_grace_days: 7,
            };

            const result = calculateLicenseStatus(license, new Date('2024-06-01'));
            expect(result.isActive).toBe(false);
            expect(result.status).toBe('expired');
        });

        it('deve retornar active com dias restantes', () => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 30);

            const license: LicenseRecord = {
                id: 1,
                license_key: 'TEST-KEY',
                status: 'active',
                valid_until: futureDate.toISOString(),
                machine_id: 'machine-1',
                last_online_validation: null,
                offline_grace_days: 7,
            };

            const result = calculateLicenseStatus(license, new Date());
            expect(result.isActive).toBe(true);
            expect(result.status).toBe('active');
            expect(result.daysRemaining).toBeGreaterThanOrEqual(29);
        });

        it('deve respeitar status revoked', () => {
            const license: LicenseRecord = {
                id: 1,
                license_key: 'TEST-KEY',
                status: 'revoked',
                valid_until: '2030-01-01',
                machine_id: 'machine-1',
                last_online_validation: null,
                offline_grace_days: 7,
            };

            const result = calculateLicenseStatus(license, new Date());
            expect(result.isActive).toBe(false);
            expect(result.status).toBe('revoked');
        });
    });

    describe('Offline Grace Period Logic', () => {
        const isWithinGracePeriod = (
            lastOnlineValidation: string | null,
            graceDays: number,
            currentDate: Date
        ): boolean => {
            if (!lastOnlineValidation) return false;

            const lastOnline = new Date(lastOnlineValidation);
            const diffMs = currentDate.getTime() - lastOnline.getTime();
            const diffDays = diffMs / (1000 * 60 * 60 * 24);

            return diffDays <= graceDays;
        };

        it('deve retornar false quando não há última validação', () => {
            expect(isWithinGracePeriod(null, 7, new Date())).toBe(false);
        });

        it('deve retornar true dentro do período de graça', () => {
            const threeDaysAgo = new Date();
            threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

            expect(isWithinGracePeriod(threeDaysAgo.toISOString(), 7, new Date())).toBe(true);
        });

        it('deve retornar false fora do período de graça', () => {
            const tenDaysAgo = new Date();
            tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

            expect(isWithinGracePeriod(tenDaysAgo.toISOString(), 7, new Date())).toBe(false);
        });

        it('deve retornar true no limite exato', () => {
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

            expect(isWithinGracePeriod(sevenDaysAgo.toISOString(), 7, new Date())).toBe(true);
        });
    });

    describe('License Key Format Validation', () => {
        // Formato esperado: XXXX-XXXX-XXXX-XXXX
        const isValidKeyFormat = (key: string): boolean => {
            if (!key || typeof key !== 'string') return false;
            const pattern = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
            return pattern.test(key.toUpperCase());
        };

        it('deve aceitar formato válido', () => {
            expect(isValidKeyFormat('ABCD-1234-EFGH-5678')).toBe(true);
        });

        it('deve aceitar lowercase (converte para uppercase)', () => {
            expect(isValidKeyFormat('abcd-1234-efgh-5678')).toBe(true);
        });

        it('deve rejeitar formato inválido', () => {
            expect(isValidKeyFormat('INVALID')).toBe(false);
            expect(isValidKeyFormat('ABCD12345678EFGH')).toBe(false);
            expect(isValidKeyFormat('')).toBe(false);
        });

        it('deve rejeitar caracteres especiais', () => {
            expect(isValidKeyFormat('ABCD-1234-EF@H-5678')).toBe(false);
        });
    });

    describe('Machine ID Binding', () => {
        const isMachineIdMatching = (
            storedMachineId: string | null,
            currentMachineId: string
        ): boolean => {
            // Primeira ativação - não há machine_id armazenado
            if (!storedMachineId) return true;
            return storedMachineId === currentMachineId;
        };

        it('deve permitir primeira ativação', () => {
            expect(isMachineIdMatching(null, 'new-machine-id')).toBe(true);
        });

        it('deve permitir mesma máquina', () => {
            expect(isMachineIdMatching('machine-123', 'machine-123')).toBe(true);
        });

        it('deve rejeitar máquina diferente', () => {
            expect(isMachineIdMatching('machine-123', 'machine-456')).toBe(false);
        });
    });
});
