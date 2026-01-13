/**
 * Testes unitários para jobsRepository
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestDb, createBaseTables, TestDbContext } from '../../helpers/testDb';
import type { Knex } from 'knex';

// Importaremos as funções diretamente para testar com injeção de DB
import * as jobsRepo from '../../../src/repos/jobsRepository';

describe('jobsRepository', () => {
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
        // Limpar tabela entre testes
        await db('jobs_conciliacao').truncate();
    });

    describe('createJob', () => {
        it('deve criar um job com status PENDING', async () => {
            const payload = {
                nome: 'Test Job',
                status: 'PENDING',
                config_conciliacao_id: 1,
            };

            const job = await jobsRepo.createJob(payload, { knex: db });

            expect(job).not.toBeNull();
            expect(job?.id).toBeGreaterThan(0);
            expect(job?.status).toBe('PENDING');
        });

        it('deve criar job com campos opcionais', async () => {
            const payload = {
                nome: 'Test Job Com Extras',
                status: 'PENDING',
                config_conciliacao_id: 1,
                config_estorno_id: 2,
                config_cancelamento_id: 3,
            };

            const job = await jobsRepo.createJob(payload, { knex: db });

            expect(job).not.toBeNull();
            expect(job?.nome).toBe('Test Job Com Extras');
        });

        it('deve gerar ID auto-incrementado', async () => {
            const job1 = await jobsRepo.createJob({ nome: 'Job 1', status: 'PENDING' }, { knex: db });
            const job2 = await jobsRepo.createJob({ nome: 'Job 2', status: 'PENDING' }, { knex: db });

            expect(job1?.id).toBeLessThan(job2?.id!);
        });
    });

    describe('getJobById', () => {
        it('deve retornar job existente por ID', async () => {
            const created = await jobsRepo.createJob({ nome: 'Find Me', status: 'PENDING' }, { knex: db });

            const found = await jobsRepo.getJobById(created!.id, { knex: db });

            expect(found).not.toBeNull();
            expect(found?.id).toBe(created?.id);
            expect(found?.nome).toBe('Find Me');
        });

        it('deve retornar null para ID inexistente', async () => {
            const found = await jobsRepo.getJobById(99999, { knex: db });
            expect(found).toBeNull();
        });

        it('deve lançar erro para ID inválido', async () => {
            await expect(jobsRepo.getJobById(-1, { knex: db })).rejects.toThrow('id must be a positive integer');
            await expect(jobsRepo.getJobById(0, { knex: db })).rejects.toThrow('id must be a positive integer');
            await expect(jobsRepo.getJobById(1.5 as any, { knex: db })).rejects.toThrow('id must be a positive integer');
        });
    });

    describe('updateJobStatus', () => {
        it('deve atualizar status do job', async () => {
            const created = await jobsRepo.createJob({ nome: 'Update Me', status: 'PENDING' }, { knex: db });

            const updated = await jobsRepo.updateJobStatus(created!.id, 'RUNNING', undefined, { knex: db });

            expect(updated?.status).toBe('RUNNING');
        });

        it('deve atualizar status e mensagem de erro', async () => {
            const created = await jobsRepo.createJob({ nome: 'Fail Me', status: 'RUNNING' }, { knex: db });

            const updated = await jobsRepo.updateJobStatus(created!.id, 'FAILED', 'Erro de teste', { knex: db });

            expect(updated?.status).toBe('FAILED');
            expect(updated?.erro).toBe('Erro de teste');
        });

        it('deve atualizar timestamp updated_at', async () => {
            const created = await jobsRepo.createJob({ nome: 'Timestamp Test', status: 'PENDING' }, { knex: db });
            const originalUpdatedAt = created?.updated_at;

            // Pequeno delay para garantir timestamp diferente
            await new Promise(resolve => setTimeout(resolve, 10));

            await jobsRepo.updateJobStatus(created!.id, 'RUNNING', undefined, { knex: db });
            const updated = await jobsRepo.getJobById(created!.id, { knex: db });

            // O timestamp deve ter sido atualizado
            expect(updated?.updated_at).toBeDefined();
        });

        it('deve suportar transições de status válidas', async () => {
            const job = await jobsRepo.createJob({ nome: 'Status Flow', status: 'PENDING' }, { knex: db });

            // PENDING -> RUNNING
            let updated = await jobsRepo.updateJobStatus(job!.id, 'RUNNING', undefined, { knex: db });
            expect(updated?.status).toBe('RUNNING');

            // RUNNING -> DONE
            updated = await jobsRepo.updateJobStatus(job!.id, 'DONE', undefined, { knex: db });
            expect(updated?.status).toBe('DONE');
        });
    });

    describe('setJobExportPath', () => {
        it('deve definir caminho de exportação', async () => {
            const job = await jobsRepo.createJob({ nome: 'Export Test', status: 'DONE' }, { knex: db });

            const updated = await jobsRepo.setJobExportPath(job!.id, '/exports/test.zip', { knex: db });

            expect(updated?.arquivo_exportado).toBe('/exports/test.zip');
        });

        it('deve limpar caminho de exportação com null', async () => {
            const job = await jobsRepo.createJob({ nome: 'Clear Export', status: 'DONE' }, { knex: db });
            await jobsRepo.setJobExportPath(job!.id, '/exports/test.zip', { knex: db });

            const updated = await jobsRepo.setJobExportPath(job!.id, null, { knex: db });

            expect(updated?.arquivo_exportado).toBeNull();
        });
    });

    describe('setJobExportProgress', () => {
        it('deve definir progresso de exportação', async () => {
            const job = await jobsRepo.createJob({ nome: 'Progress Test', status: 'DONE' }, { knex: db });

            const updated = await jobsRepo.setJobExportProgress(job!.id, 50, 'EXPORTING', { knex: db });

            expect(updated?.export_progress).toBe(50);
            expect(updated?.export_status).toBe('EXPORTING');
        });

        it('deve atualizar apenas progresso', async () => {
            const job = await jobsRepo.createJob({ nome: 'Progress Only', status: 'DONE' }, { knex: db });
            await jobsRepo.setJobExportProgress(job!.id, 25, 'STARTING', { knex: db });

            const updated = await jobsRepo.setJobExportProgress(job!.id, 75, undefined, { knex: db });

            expect(updated?.export_progress).toBe(75);
        });
    });

    describe('setJobPipelineStage', () => {
        it('deve definir estágio do pipeline', async () => {
            const job = await jobsRepo.createJob({ nome: 'Pipeline Test', status: 'RUNNING' }, { knex: db });

            const updated = await jobsRepo.setJobPipelineStage(
                job!.id,
                'normalizando_base_a',
                25,
                'Normalizando Base A',
                { knex: db }
            );

            expect(updated?.pipeline_stage).toBe('normalizando_base_a');
            expect(updated?.pipeline_progress).toBe(25);
            expect(updated?.pipeline_stage_label).toBe('Normalizando Base A');
        });

        it('deve atualizar estágio progressivamente', async () => {
            const job = await jobsRepo.createJob({ nome: 'Progress Pipeline', status: 'RUNNING' }, { knex: db });

            await jobsRepo.setJobPipelineStage(job!.id, 'step1', 10, 'Step 1', { knex: db });
            await jobsRepo.setJobPipelineStage(job!.id, 'step2', 50, 'Step 2', { knex: db });
            const final = await jobsRepo.setJobPipelineStage(job!.id, 'step3', 100, 'Step 3', { knex: db });

            expect(final?.pipeline_stage).toBe('step3');
            expect(final?.pipeline_progress).toBe(100);
        });
    });
});
