/**
 * Testes unitários para lógica de manutenção do banco de dados
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestDb, createBaseTables, TestDbContext } from '../../helpers/testDb';
import type { Knex } from 'knex';

describe('Maintenance Logic', () => {
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
        // Desabilitar foreign keys temporariamente para limpar dados
        await db.raw('PRAGMA foreign_keys = OFF');
        await db('jobs_conciliacao').del();
        await db('ingest_jobs').del();
        await db('base_columns').del();
        await db('bases').del();
        await db.raw('PRAGMA foreign_keys = ON');
    });

    describe('VACUUM operation', () => {
        it('deve executar VACUUM sem erros', async () => {
            // Inserir e deletar dados para criar fragmentação
            for (let i = 0; i < 10; i++) {
                await db('bases').insert({ nome: `Base ${i}`, tipo: 'CONTABIL' });
            }
            await db('bases').del();

            // Executar VACUUM
            await expect(db.raw('VACUUM')).resolves.not.toThrow();
        });
    });

    describe('Orphan Cleanup', () => {
        it('deve identificar bases órfãs (sem colunas e sem dados)', async () => {
            // Base sem colunas
            const [orphanId] = await db('bases').insert({
                nome: 'Orphan Base',
                tipo: 'CONTABIL',
                tabela_sqlite: null,
            });

            // Base com colunas
            const [validId] = await db('bases').insert({
                nome: 'Valid Base',
                tipo: 'CONTABIL',
            });
            await db('base_columns').insert({
                base_id: validId,
                excel_name: 'Col1',
                sqlite_name: 'col1',
                col_index: 0,
            });

            // Identificar órfãs
            const orphans = await db('bases')
                .leftJoin('base_columns', 'bases.id', 'base_columns.base_id')
                .whereNull('base_columns.id')
                .whereNull('bases.tabela_sqlite')
                .select('bases.id', 'bases.nome');

            expect(orphans).toHaveLength(1);
            expect(orphans[0].id).toBe(orphanId);
        });

        it('deve identificar jobs órfãos (referenciando config deletada)', async () => {
            // Criar job com config_id que não existe
            const [jobId] = await db('jobs_conciliacao').insert({
                nome: 'Orphan Job',
                status: 'FAILED',
                config_conciliacao_id: 99999, // Não existe
            });

            // Buscar jobs com config inexistente
            const orphanJobs = await db('jobs_conciliacao')
                .leftJoin(
                    'configs_conciliacao',
                    'jobs_conciliacao.config_conciliacao_id',
                    'configs_conciliacao.id'
                )
                .whereNotNull('jobs_conciliacao.config_conciliacao_id')
                .whereNull('configs_conciliacao.id')
                .select('jobs_conciliacao.id', 'jobs_conciliacao.nome');

            expect(orphanJobs).toHaveLength(1);
            expect(orphanJobs[0].id).toBe(jobId);
        });
    });

    describe('Stale Job Cleanup', () => {
        it('deve identificar jobs travados (RUNNING por muito tempo)', async () => {
            // Job "travado" - updated_at muito antigo
            const staleDate = new Date();
            staleDate.setHours(staleDate.getHours() - 2); // 2 horas atrás

            await db('jobs_conciliacao').insert({
                nome: 'Stale Job',
                status: 'RUNNING',
                updated_at: staleDate.toISOString(),
            });

            // Job recente
            await db('jobs_conciliacao').insert({
                nome: 'Recent Job',
                status: 'RUNNING',
                updated_at: new Date().toISOString(),
            });

            // Identificar jobs travados (> 1 hora)
            const oneHourAgo = new Date();
            oneHourAgo.setHours(oneHourAgo.getHours() - 1);

            const staleJobs = await db('jobs_conciliacao')
                .where({ status: 'RUNNING' })
                .where('updated_at', '<', oneHourAgo.toISOString())
                .select('*');

            expect(staleJobs).toHaveLength(1);
            expect(staleJobs[0].nome).toBe('Stale Job');
        });

        it('deve permitir reset de jobs travados', async () => {
            const [jobId] = await db('jobs_conciliacao').insert({
                nome: 'Stuck Job',
                status: 'RUNNING',
            });

            // Reset para PENDING
            await db('jobs_conciliacao')
                .where({ id: jobId })
                .update({ status: 'PENDING', updated_at: new Date().toISOString() });

            const job = await db('jobs_conciliacao').where({ id: jobId }).first();
            expect(job?.status).toBe('PENDING');
        });
    });

    describe('Database Statistics', () => {
        it('deve calcular estatísticas do banco', async () => {
            // Setup
            await db('bases').insert([
                { nome: 'Base 1', tipo: 'CONTABIL' },
                { nome: 'Base 2', tipo: 'FISCAL' },
            ]);
            await db('jobs_conciliacao').insert([
                { nome: 'Job 1', status: 'DONE' },
                { nome: 'Job 2', status: 'DONE' },
                { nome: 'Job 3', status: 'PENDING' },
            ]);

            // Coletar estatísticas
            const stats = {
                totalBases: await db('bases').count('* as count').first().then(r => r?.count || 0),
                totalJobs: await db('jobs_conciliacao').count('* as count').first().then(r => r?.count || 0),
                jobsByStatus: await db('jobs_conciliacao')
                    .select('status')
                    .count('* as count')
                    .groupBy('status'),
            };

            expect(stats.totalBases).toBe(2);
            expect(stats.totalJobs).toBe(3);
            expect(stats.jobsByStatus).toContainEqual({ status: 'DONE', count: 2 });
            expect(stats.jobsByStatus).toContainEqual({ status: 'PENDING', count: 1 });
        });
    });

    describe('Data Integrity Checks', () => {
        it('deve validar integridade referencial', async () => {
            // Criar base e colunas válidas
            const [baseId] = await db('bases').insert({
                nome: 'Valid Base',
                tipo: 'CONTABIL',
            });

            await db('base_columns').insert({
                base_id: baseId,
                excel_name: 'Col',
                sqlite_name: 'col',
                col_index: 0,
            });

            // Verificar que todas as colunas têm base válida
            const orphanColumns = await db('base_columns')
                .leftJoin('bases', 'base_columns.base_id', 'bases.id')
                .whereNull('bases.id')
                .select('base_columns.id');

            expect(orphanColumns).toHaveLength(0);
        });
    });
});

describe('Cleanup Utilities', () => {
    describe('Dynamic Table Cleanup', () => {
        const isValidDynamicTableName = (name: string): boolean => {
            // Padrões válidos: base_N, conciliacao_result_N
            return /^(base_\d+|conciliacao_result_\d+)$/.test(name);
        };

        it('deve reconhecer tabelas dinâmicas válidas', () => {
            expect(isValidDynamicTableName('base_123')).toBe(true);
            expect(isValidDynamicTableName('conciliacao_result_456')).toBe(true);
        });

        it('deve rejeitar nomes inválidos', () => {
            expect(isValidDynamicTableName('bases')).toBe(false);
            expect(isValidDynamicTableName('users')).toBe(false);
            expect(isValidDynamicTableName('base_abc')).toBe(false);
        });
    });

    describe('Date-based Cleanup Policy', () => {
        const isOlderThan = (date: string | Date, days: number): boolean => {
            const itemDate = new Date(date);
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - days);
            return itemDate < cutoff;
        };

        it('deve identificar itens antigos', () => {
            const oldDate = new Date();
            oldDate.setDate(oldDate.getDate() - 40);

            expect(isOlderThan(oldDate, 30)).toBe(true);
        });

        it('deve manter itens recentes', () => {
            const recentDate = new Date();
            recentDate.setDate(recentDate.getDate() - 10);

            expect(isOlderThan(recentDate, 30)).toBe(false);
        });
    });
});
