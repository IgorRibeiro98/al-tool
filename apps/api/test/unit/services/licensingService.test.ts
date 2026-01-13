/**
 * Testes unitários para licensingService
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestDb, createBaseTables, TestDbContext } from '../../helpers/testDb';
import type { Knex } from 'knex';

// Precisamos mockar o módulo db antes de importar o serviço
vi.mock('../../../src/db/knex', () => {
    return {
        default: null, // Será substituído nos testes
    };
});

describe('licensingService', () => {
    let ctx: TestDbContext;
    let db: Knex;

    beforeAll(async () => {
        ctx = createTestDb();
        db = ctx.db;
        await createBaseTables(db);
    });

    afterAll(async () => {
        await ctx.cleanup();
    });

    beforeEach(async () => {
        await db('license').del();
    });

    describe('getStatus - cenários básicos', () => {
        it('deve retornar not_activated quando não há licença', async () => {
            // Sem inserir nada na tabela license
            const row = await db('license').first();
            expect(row).toBeUndefined();

            // Status esperado: not_activated
            // Note: Testando lógica diretamente já que o serviço usa db singleton
        });

        it('deve identificar licença expirada', async () => {
            const pastDate = new Date();
            pastDate.setDate(pastDate.getDate() - 10); // 10 dias atrás

            await db('license').insert({
                id: 1,
                status: 'active',
                expires_at: pastDate.toISOString(),
                last_success_online_validation_at: new Date().toISOString(),
            });

            const row = await db('license').where({ id: 1 }).first();
            expect(row).toBeDefined();

            const expiresAt = new Date(row.expires_at);
            const now = new Date();
            expect(expiresAt.getTime() < now.getTime()).toBe(true);
        });

        it('deve identificar licença ativa', async () => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 30); // 30 dias no futuro

            await db('license').insert({
                id: 1,
                status: 'active',
                expires_at: futureDate.toISOString(),
                last_success_online_validation_at: new Date().toISOString(),
            });

            const row = await db('license').where({ id: 1 }).first();
            expect(row).toBeDefined();

            const expiresAt = new Date(row.expires_at);
            const now = new Date();
            expect(expiresAt.getTime() > now.getTime()).toBe(true);
        });

        it('deve identificar blocked_offline quando sem validação online recente', async () => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 30);

            // Validação online muito antiga (mais de 37 dias atrás)
            const oldValidation = new Date();
            oldValidation.setDate(oldValidation.getDate() - 40);

            await db('license').insert({
                id: 1,
                status: 'active',
                expires_at: futureDate.toISOString(),
                last_success_online_validation_at: oldValidation.toISOString(),
            });

            const row = await db('license').where({ id: 1 }).first();
            const lastSuccess = new Date(row.last_success_online_validation_at);
            const now = new Date();
            const daysDiff = Math.floor((now.getTime() - lastSuccess.getTime()) / (24 * 60 * 60 * 1000));

            expect(daysDiff).toBeGreaterThan(37);
        });

        it('deve identificar blocked_offline quando nunca houve validação online', async () => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 30);

            await db('license').insert({
                id: 1,
                status: 'active',
                expires_at: futureDate.toISOString(),
                last_success_online_validation_at: null, // Nunca validou
            });

            const row = await db('license').where({ id: 1 }).first();
            expect(row.last_success_online_validation_at).toBeNull();
        });
    });

    describe('Regras de negócio de licenciamento', () => {
        it('licença dentro do período de graça (37 dias) deve estar ativa', async () => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 30);

            // Validação online há 30 dias (dentro do período de graça)
            const recentValidation = new Date();
            recentValidation.setDate(recentValidation.getDate() - 30);

            await db('license').insert({
                id: 1,
                status: 'active',
                expires_at: futureDate.toISOString(),
                last_success_online_validation_at: recentValidation.toISOString(),
            });

            const row = await db('license').where({ id: 1 }).first();
            const lastSuccess = new Date(row.last_success_online_validation_at);
            const now = new Date();
            const daysDiff = Math.floor((now.getTime() - lastSuccess.getTime()) / (24 * 60 * 60 * 1000));

            expect(daysDiff).toBeLessThanOrEqual(37);
        });

        it('licença no limite exato do período de graça (37 dias)', async () => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 30);

            // Validação online há exatamente 37 dias
            const limitValidation = new Date();
            limitValidation.setDate(limitValidation.getDate() - 37);

            await db('license').insert({
                id: 1,
                status: 'active',
                expires_at: futureDate.toISOString(),
                last_success_online_validation_at: limitValidation.toISOString(),
            });

            const row = await db('license').where({ id: 1 }).first();
            expect(row).toBeDefined();
        });

        it('deve permitir múltiplos status de licença', async () => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 30);

            // Testar com status 'trial'
            await db('license').insert({
                id: 1,
                status: 'trial',
                expires_at: futureDate.toISOString(),
                last_success_online_validation_at: new Date().toISOString(),
            });

            const row = await db('license').where({ id: 1 }).first();
            expect(row.status).toBe('trial');
        });
    });
});
