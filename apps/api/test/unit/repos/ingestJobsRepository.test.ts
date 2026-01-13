/**
 * Testes unitários para ingestJobsRepository
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestDb, createBaseTables, TestDbContext } from '../../helpers/testDb';
import type { Knex } from 'knex';

import * as ingestJobsRepo from '../../../src/repos/ingestJobsRepository';

describe('ingestJobsRepository', () => {
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
        await db('ingest_jobs').truncate();
    });

    describe('createJob', () => {
        it('deve criar job de ingestão com status PENDING', async () => {
            const payload = {
                status: 'PENDING',
                base_id: 1,
            };

            const job = await ingestJobsRepo.createJob(payload, { knex: db });

            expect(job).not.toBeNull();
            expect(job?.id).toBeGreaterThan(0);
            expect(job?.status).toBe('PENDING');
            expect(job?.base_id).toBe(1);
        });

        it('deve criar job sem base_id', async () => {
            const job = await ingestJobsRepo.createJob({ status: 'PENDING' }, { knex: db });

            expect(job).not.toBeNull();
            expect(job?.base_id).toBeNull();
        });

        it('deve gerar IDs auto-incrementados', async () => {
            const job1 = await ingestJobsRepo.createJob({ status: 'PENDING' }, { knex: db });
            const job2 = await ingestJobsRepo.createJob({ status: 'PENDING' }, { knex: db });

            expect(job1?.id).toBeLessThan(job2?.id!);
        });
    });

    describe('getJobById', () => {
        it('deve retornar job existente', async () => {
            const created = await ingestJobsRepo.createJob({ status: 'PENDING', base_id: 5 }, { knex: db });

            const found = await ingestJobsRepo.getJobById(created!.id, { knex: db });

            expect(found).not.toBeNull();
            expect(found?.id).toBe(created?.id);
            expect(found?.base_id).toBe(5);
        });

        it('deve retornar null para ID inexistente', async () => {
            const found = await ingestJobsRepo.getJobById(99999, { knex: db });
            expect(found).toBeNull();
        });

        it('deve lançar erro para ID inválido', async () => {
            await expect(ingestJobsRepo.getJobById(-1, { knex: db })).rejects.toThrow('id must be a positive integer');
            await expect(ingestJobsRepo.getJobById(0, { knex: db })).rejects.toThrow('id must be a positive integer');
        });
    });

    describe('updateJobStatus', () => {
        it('deve atualizar status para RUNNING', async () => {
            const job = await ingestJobsRepo.createJob({ status: 'PENDING' }, { knex: db });

            const updated = await ingestJobsRepo.updateJobStatus(job!.id, 'RUNNING', undefined, { knex: db });

            expect(updated?.status).toBe('RUNNING');
        });

        it('deve atualizar status para DONE', async () => {
            const job = await ingestJobsRepo.createJob({ status: 'RUNNING' }, { knex: db });

            const updated = await ingestJobsRepo.updateJobStatus(job!.id, 'DONE', undefined, { knex: db });

            expect(updated?.status).toBe('DONE');
        });

        it('deve atualizar status para FAILED com mensagem de erro', async () => {
            const job = await ingestJobsRepo.createJob({ status: 'RUNNING' }, { knex: db });

            const updated = await ingestJobsRepo.updateJobStatus(
                job!.id,
                'FAILED',
                'Falha na conversão do arquivo',
                { knex: db }
            );

            expect(updated?.status).toBe('FAILED');
            expect(updated?.erro).toBe('Falha na conversão do arquivo');
        });

        it('deve atualizar timestamp', async () => {
            const job = await ingestJobsRepo.createJob({ status: 'PENDING' }, { knex: db });

            await new Promise(resolve => setTimeout(resolve, 10));

            const updated = await ingestJobsRepo.updateJobStatus(job!.id, 'RUNNING', undefined, { knex: db });

            expect(updated?.updated_at).toBeDefined();
        });

        it('deve suportar fluxo completo de status', async () => {
            const job = await ingestJobsRepo.createJob({ status: 'PENDING' }, { knex: db });

            // PENDING -> RUNNING
            let updated = await ingestJobsRepo.updateJobStatus(job!.id, 'RUNNING', undefined, { knex: db });
            expect(updated?.status).toBe('RUNNING');

            // RUNNING -> DONE
            updated = await ingestJobsRepo.updateJobStatus(job!.id, 'DONE', undefined, { knex: db });
            expect(updated?.status).toBe('DONE');
        });
    });

    describe('cenários de erro', () => {
        it('deve validar ID em updateJobStatus', async () => {
            await expect(
                ingestJobsRepo.updateJobStatus(-1, 'RUNNING', undefined, { knex: db })
            ).rejects.toThrow('id must be a positive integer');
        });

        it('deve lidar com atualização de job inexistente', async () => {
            const updated = await ingestJobsRepo.updateJobStatus(99999, 'RUNNING', undefined, { knex: db });
            expect(updated).toBeNull();
        });
    });
});
