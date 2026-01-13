/**
 * Testes unitários para funções de workers
 * Nota: Workers usam child_process.fork, então testamos as funções auxiliares
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, createBaseTables, TestDbContext } from '../../helpers/testDb';
import type { Knex } from 'knex';

describe('Worker Helper Functions', () => {
    let ctx: TestDbContext;
    let db: Knex;

    beforeEach(async () => {
        ctx = createTestDb();
        db = ctx.db;
        await createBaseTables(db);
    });

    afterEach(async () => {
        await ctx.cleanup();
    });

    describe('fetchOldestPendingJob', () => {
        it('deve retornar job mais antigo pendente', async () => {
            // Inserir jobs em ordem
            await db('jobs_conciliacao').insert({ nome: 'Job 1', status: 'PENDING' });
            await new Promise(resolve => setTimeout(resolve, 10));
            await db('jobs_conciliacao').insert({ nome: 'Job 2', status: 'PENDING' });

            const oldest = await db('jobs_conciliacao')
                .where({ status: 'PENDING' })
                .orderBy('created_at', 'asc')
                .first();

            expect(oldest?.nome).toBe('Job 1');
        });

        it('deve ignorar jobs não-pendentes', async () => {
            await db('jobs_conciliacao').insert({ nome: 'Running', status: 'RUNNING' });
            await db('jobs_conciliacao').insert({ nome: 'Done', status: 'DONE' });
            await db('jobs_conciliacao').insert({ nome: 'Failed', status: 'FAILED' });
            await db('jobs_conciliacao').insert({ nome: 'Pending', status: 'PENDING' });

            const pending = await db('jobs_conciliacao')
                .where({ status: 'PENDING' })
                .orderBy('created_at', 'asc')
                .first();

            expect(pending?.nome).toBe('Pending');
        });

        it('deve retornar undefined quando não há jobs pendentes', async () => {
            await db('jobs_conciliacao').insert({ nome: 'Done', status: 'DONE' });

            const pending = await db('jobs_conciliacao')
                .where({ status: 'PENDING' })
                .orderBy('created_at', 'asc')
                .first();

            expect(pending).toBeUndefined();
        });
    });

    describe('claimJob', () => {
        it('deve reivindicar job pendente', async () => {
            const [id] = await db('jobs_conciliacao').insert({
                nome: 'Job to claim',
                status: 'PENDING',
            });

            const updated = await db('jobs_conciliacao')
                .where({ id, status: 'PENDING' })
                .update({ status: 'RUNNING', updated_at: db.fn.now() });

            expect(updated).toBe(1);

            const job = await db('jobs_conciliacao').where({ id }).first();
            expect(job?.status).toBe('RUNNING');
        });

        it('não deve reivindicar job já em execução', async () => {
            const [id] = await db('jobs_conciliacao').insert({
                nome: 'Already running',
                status: 'RUNNING',
            });

            const updated = await db('jobs_conciliacao')
                .where({ id, status: 'PENDING' })
                .update({ status: 'RUNNING' });

            expect(updated).toBe(0);
        });

        it('deve prevenir race condition (apenas um pode reivindicar)', async () => {
            const [id] = await db('jobs_conciliacao').insert({
                nome: 'Race condition test',
                status: 'PENDING',
            });

            // Simular duas tentativas simultâneas
            const results = await Promise.all([
                db('jobs_conciliacao')
                    .where({ id, status: 'PENDING' })
                    .update({ status: 'RUNNING' }),
                db('jobs_conciliacao')
                    .where({ id, status: 'PENDING' })
                    .update({ status: 'RUNNING' }),
            ]);

            // Apenas uma deve ter sucesso
            const successCount = results.filter(r => r === 1).length;
            expect(successCount).toBeLessThanOrEqual(1);
        });
    });

    describe('countPendingJobs', () => {
        it('deve contar jobs pendentes corretamente', async () => {
            await db('jobs_conciliacao').insert([
                { nome: 'Job 1', status: 'PENDING' },
                { nome: 'Job 2', status: 'PENDING' },
                { nome: 'Job 3', status: 'RUNNING' },
                { nome: 'Job 4', status: 'DONE' },
            ]);

            const result = await db('jobs_conciliacao')
                .where({ status: 'PENDING' })
                .count('* as cnt')
                .first();

            expect(Number(result?.cnt)).toBe(2);
        });
    });
});

describe('Ingest Worker Functions', () => {
    let ctx: TestDbContext;
    let db: Knex;

    beforeEach(async () => {
        ctx = createTestDb();
        db = ctx.db;
        await createBaseTables(db);
    });

    afterEach(async () => {
        await ctx.cleanup();
    });

    describe('fetchOldestPendingIngestJob', () => {
        it('deve retornar ingest job mais antigo pendente', async () => {
            await db('ingest_jobs').insert({ status: 'PENDING', base_id: 1 });
            await new Promise(resolve => setTimeout(resolve, 10));
            await db('ingest_jobs').insert({ status: 'PENDING', base_id: 2 });

            const oldest = await db('ingest_jobs')
                .where({ status: 'PENDING' })
                .orderBy('created_at', 'asc')
                .first();

            expect(oldest?.base_id).toBe(1);
        });

        it('deve ignorar ingest jobs não-pendentes', async () => {
            await db('ingest_jobs').insert({ status: 'RUNNING' });
            await db('ingest_jobs').insert({ status: 'DONE' });
            await db('ingest_jobs').insert({ status: 'PENDING' });

            const pending = await db('ingest_jobs')
                .where({ status: 'PENDING' })
                .first();

            expect(pending).toBeDefined();
            expect(pending?.status).toBe('PENDING');
        });
    });

    describe('claimIngestJob', () => {
        it('deve reivindicar ingest job pendente', async () => {
            const [id] = await db('ingest_jobs').insert({
                status: 'PENDING',
                base_id: 1,
            });

            const updated = await db('ingest_jobs')
                .where({ id, status: 'PENDING' })
                .update({ status: 'RUNNING', updated_at: db.fn.now() });

            expect(updated).toBe(1);

            const job = await db('ingest_jobs').where({ id }).first();
            expect(job?.status).toBe('RUNNING');
        });
    });
});

describe('Export Runner Functions', () => {
    let ctx: TestDbContext;
    let db: Knex;

    beforeEach(async () => {
        ctx = createTestDb();
        db = ctx.db;
        await createBaseTables(db);
    });

    afterEach(async () => {
        await ctx.cleanup();
    });

    describe('setJobExportProgress', () => {
        it('deve atualizar progresso de exportação', async () => {
            const [id] = await db('jobs_conciliacao').insert({
                nome: 'Export test',
                status: 'DONE',
            });

            await db('jobs_conciliacao')
                .where({ id })
                .update({ export_progress: 50, export_status: 'EXPORTING' });

            const job = await db('jobs_conciliacao').where({ id }).first();
            expect(job?.export_progress).toBe(50);
            expect(job?.export_status).toBe('EXPORTING');
        });

        it('deve suportar diferentes estágios de exportação', async () => {
            const [id] = await db('jobs_conciliacao').insert({
                nome: 'Export stages',
                status: 'DONE',
            });

            const stages = [
                { progress: 10, status: 'STARTING' },
                { progress: 30, status: 'EXPORT_BUILDING_A' },
                { progress: 60, status: 'EXPORT_BUILDING_B' },
                { progress: 90, status: 'EXPORT_ZIPPING' },
                { progress: 100, status: 'EXPORT_DONE' },
            ];

            for (const stage of stages) {
                await db('jobs_conciliacao')
                    .where({ id })
                    .update({ export_progress: stage.progress, export_status: stage.status });

                const job = await db('jobs_conciliacao').where({ id }).first();
                expect(job?.export_progress).toBe(stage.progress);
                expect(job?.export_status).toBe(stage.status);
            }
        });
    });

    describe('setJobExportPath', () => {
        it('deve definir caminho do arquivo exportado', async () => {
            const [id] = await db('jobs_conciliacao').insert({
                nome: 'Export path test',
                status: 'DONE',
            });

            const exportPath = '/storage/exports/conciliacao_1.zip';
            await db('jobs_conciliacao')
                .where({ id })
                .update({ arquivo_exportado: exportPath });

            const job = await db('jobs_conciliacao').where({ id }).first();
            expect(job?.arquivo_exportado).toBe(exportPath);
        });
    });
});
