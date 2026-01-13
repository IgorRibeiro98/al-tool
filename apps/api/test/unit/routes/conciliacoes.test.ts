/**
 * Testes unitários para lógica de negócio das rotas de conciliações
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestDb, createBaseTables, TestDbContext } from '../../helpers/testDb';
import type { Knex } from 'knex';

describe('Conciliacoes Route Logic', () => {
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
        await db('jobs_conciliacao').del();
        await db('configs_conciliacao').del();
        await db('bases').del();
    });

    describe('POST /conciliacoes - criação de job', () => {
        it('deve criar job com config válida', async () => {
            // Setup
            const [baseAId] = await db('bases').insert({ nome: 'Base A', tipo: 'CONTABIL' });
            const [baseBId] = await db('bases').insert({ nome: 'Base B', tipo: 'FISCAL' });
            const [configId] = await db('configs_conciliacao').insert({
                nome: 'Config Test',
                base_contabil_id: baseAId,
                base_fiscal_id: baseBId,
            });

            // Create job
            const [jobId] = await db('jobs_conciliacao').insert({
                nome: 'Job Test',
                status: 'PENDING',
                config_conciliacao_id: configId,
            });

            const job = await db('jobs_conciliacao').where({ id: jobId }).first();
            expect(job?.status).toBe('PENDING');
            expect(job?.config_conciliacao_id).toBe(configId);
        });

        it('deve validar que configConciliacaoId é obrigatório', () => {
            // Simulação da validação
            const validateConfig = (body: { configConciliacaoId?: number }) => {
                const cfgId = Number(body.configConciliacaoId);
                if (!cfgId || Number.isNaN(cfgId)) {
                    return { valid: false, error: 'configConciliacaoId is required and must be a number' };
                }
                return { valid: true };
            };

            expect(validateConfig({}).valid).toBe(false);
            expect(validateConfig({ configConciliacaoId: undefined }).valid).toBe(false);
            expect(validateConfig({ configConciliacaoId: 0 }).valid).toBe(false);
            expect(validateConfig({ configConciliacaoId: 1 }).valid).toBe(true);
        });

        it('deve validar que bases são diferentes', async () => {
            const [baseId] = await db('bases').insert({ nome: 'Base Única', tipo: 'CONTABIL' });

            const validateDifferentBases = (baseContabilId: number, baseFiscalId: number) => {
                if (baseContabilId === baseFiscalId) {
                    return { valid: false, error: 'Base contábil e base fiscal devem ser diferentes.' };
                }
                return { valid: true };
            };

            expect(validateDifferentBases(baseId, baseId).valid).toBe(false);
            expect(validateDifferentBases(1, 2).valid).toBe(true);
        });

        it('deve suportar override de bases', async () => {
            const [baseAId] = await db('bases').insert({ nome: 'Base A Original', tipo: 'CONTABIL' });
            const [baseBId] = await db('bases').insert({ nome: 'Base B Original', tipo: 'FISCAL' });
            const [baseAOverrideId] = await db('bases').insert({ nome: 'Base A Override', tipo: 'CONTABIL' });

            const [configId] = await db('configs_conciliacao').insert({
                nome: 'Config',
                base_contabil_id: baseAId,
                base_fiscal_id: baseBId,
            });

            const [jobId] = await db('jobs_conciliacao').insert({
                nome: 'Job com Override',
                status: 'PENDING',
                config_conciliacao_id: configId,
                base_contabil_id_override: baseAOverrideId,
            });

            const job = await db('jobs_conciliacao').where({ id: jobId }).first();
            expect(job?.base_contabil_id_override).toBe(baseAOverrideId);
        });
    });

    describe('GET /conciliacoes - listagem', () => {
        it('deve listar jobs ordenados por id desc', async () => {
            await db('jobs_conciliacao').insert({ nome: 'Job 1', status: 'DONE' });
            await db('jobs_conciliacao').insert({ nome: 'Job 2', status: 'PENDING' });

            const jobs = await db('jobs_conciliacao')
                .select('*')
                .orderBy('id', 'desc');

            expect(jobs[0].nome).toBe('Job 2');
        });

        it('deve filtrar por status', async () => {
            await db('jobs_conciliacao').insert([
                { nome: 'Pending 1', status: 'PENDING' },
                { nome: 'Running 1', status: 'RUNNING' },
                { nome: 'Done 1', status: 'DONE' },
            ]);

            const pending = await db('jobs_conciliacao').where({ status: 'PENDING' }).select('*');
            expect(pending).toHaveLength(1);
        });

        it('deve suportar paginação', async () => {
            // Inserir 25 jobs
            for (let i = 1; i <= 25; i++) {
                await db('jobs_conciliacao').insert({ nome: `Job ${i}`, status: 'DONE' });
            }

            const page1 = await db('jobs_conciliacao')
                .select('*')
                .orderBy('id', 'asc')
                .limit(10)
                .offset(0);

            const page2 = await db('jobs_conciliacao')
                .select('*')
                .orderBy('id', 'asc')
                .limit(10)
                .offset(10);

            expect(page1).toHaveLength(10);
            expect(page2).toHaveLength(10);
            expect(page1[0].id).not.toBe(page2[0].id);
        });
    });

    describe('GET /conciliacoes/:id - detalhes', () => {
        it('deve retornar job com todos os campos', async () => {
            const [id] = await db('jobs_conciliacao').insert({
                nome: 'Job Detalhado',
                status: 'RUNNING',
                pipeline_stage: 'conciliando',
                pipeline_progress: 75,
            });

            const job = await db('jobs_conciliacao').where({ id }).first();

            expect(job?.nome).toBe('Job Detalhado');
            expect(job?.status).toBe('RUNNING');
            expect(job?.pipeline_stage).toBe('conciliando');
            expect(job?.pipeline_progress).toBe(75);
        });
    });

    describe('GET /conciliacoes/:id/result - resultados', () => {
        it('deve verificar existência de tabela de resultado', async () => {
            const jobId = 999;
            const resultTableName = `conciliacao_result_${jobId}`;

            const exists = await db.schema.hasTable(resultTableName);
            expect(exists).toBe(false);
        });

        it('deve criar tabela de resultado dinamicamente', async () => {
            const jobId = 1;
            const resultTableName = `conciliacao_result_${jobId}`;

            await db.schema.createTable(resultTableName, (t) => {
                t.increments('id').primary();
                t.integer('job_id').notNullable();
                t.string('chave').nullable();
                t.string('status').nullable();
            });

            const exists = await db.schema.hasTable(resultTableName);
            expect(exists).toBe(true);

            // Cleanup
            await db.schema.dropTableIfExists(resultTableName);
        });
    });

    describe('DELETE /conciliacoes/:id', () => {
        it('deve deletar job e tabela de resultado', async () => {
            const [id] = await db('jobs_conciliacao').insert({
                nome: 'To Delete',
                status: 'DONE',
            });

            // Criar tabela de resultado
            const resultTableName = `conciliacao_result_${id}`;
            await db.schema.createTable(resultTableName, (t) => {
                t.increments('id').primary();
            });

            // Deletar
            await db('jobs_conciliacao').where({ id }).del();
            await db.schema.dropTableIfExists(resultTableName);

            const job = await db('jobs_conciliacao').where({ id }).first();
            const tableExists = await db.schema.hasTable(resultTableName);

            expect(job).toBeUndefined();
            expect(tableExists).toBe(false);
        });
    });
});

describe('Job Status Polling Logic', () => {
    describe('shouldPollJob', () => {
        const shouldPollJob = (job: { status: string }) => {
            return job.status === 'PENDING' || job.status === 'RUNNING';
        };

        it('deve poll quando PENDING', () => {
            expect(shouldPollJob({ status: 'PENDING' })).toBe(true);
        });

        it('deve poll quando RUNNING', () => {
            expect(shouldPollJob({ status: 'RUNNING' })).toBe(true);
        });

        it('não deve poll quando DONE', () => {
            expect(shouldPollJob({ status: 'DONE' })).toBe(false);
        });

        it('não deve poll quando FAILED', () => {
            expect(shouldPollJob({ status: 'FAILED' })).toBe(false);
        });
    });

    describe('isJobExporting', () => {
        const isJobExporting = (job: { export_status?: string | null }): boolean => {
            const status = job.export_status;
            return Boolean(status && status !== 'EXPORT_DONE' && status !== 'FAILED');
        };

        it('deve retornar true quando exportando', () => {
            expect(isJobExporting({ export_status: 'EXPORT_BUILDING_A' })).toBe(true);
            expect(isJobExporting({ export_status: 'EXPORT_ZIPPING' })).toBe(true);
        });

        it('deve retornar false quando export concluído', () => {
            expect(isJobExporting({ export_status: 'EXPORT_DONE' })).toBe(false);
        });

        it('deve retornar false quando export falhou', () => {
            expect(isJobExporting({ export_status: 'FAILED' })).toBe(false);
        });

        it('deve retornar false quando sem export_status', () => {
            expect(isJobExporting({ export_status: null })).toBe(false);
            expect(isJobExporting({})).toBe(false);
        });
    });
});
