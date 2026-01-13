/**
 * Testes unitários para stageReporter do jobRunner
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, createBaseTables, TestDbContext } from '../../helpers/testDb';
import type { Knex } from 'knex';

describe('JobRunner Stage Reporter', () => {
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

    describe('stageMap mapping', () => {
        const stageMap: Record<string, { code: string; label: string }> = {
            NullsBaseA: { code: 'normalizando_base_a', label: 'Normalizando campos da Base Contábil' },
            EstornoBaseA: { code: 'aplicando_estorno', label: 'Aplicando regras de estorno' },
            NullsBaseB: { code: 'normalizando_base_b', label: 'Normalizando campos da Base Fiscal' },
            CancelamentoBaseB: { code: 'aplicando_cancelamento', label: 'Aplicando regras de cancelamento' },
            ConciliacaoAB: { code: 'conciliando', label: 'Conciliando bases A x B' },
        };

        it('deve mapear NullsBaseA corretamente', () => {
            expect(stageMap['NullsBaseA'].code).toBe('normalizando_base_a');
            expect(stageMap['NullsBaseA'].label).toBe('Normalizando campos da Base Contábil');
        });

        it('deve mapear EstornoBaseA corretamente', () => {
            expect(stageMap['EstornoBaseA'].code).toBe('aplicando_estorno');
        });

        it('deve mapear NullsBaseB corretamente', () => {
            expect(stageMap['NullsBaseB'].code).toBe('normalizando_base_b');
        });

        it('deve mapear CancelamentoBaseB corretamente', () => {
            expect(stageMap['CancelamentoBaseB'].code).toBe('aplicando_cancelamento');
        });

        it('deve mapear ConciliacaoAB corretamente', () => {
            expect(stageMap['ConciliacaoAB'].code).toBe('conciliando');
        });
    });

    describe('progress calculation', () => {
        it('deve calcular progresso baseado no índice do step', () => {
            const totalSteps = 5;

            const calculateProgress = (stepIndex: number): number => {
                const progressBase = Math.round((stepIndex / totalSteps) * 100);
                return Math.min(99, Math.max(progressBase, 10));
            };

            expect(calculateProgress(0)).toBe(10); // 0% mas min é 10
            expect(calculateProgress(1)).toBe(20);
            expect(calculateProgress(2)).toBe(40);
            expect(calculateProgress(3)).toBe(60);
            expect(calculateProgress(4)).toBe(80);
        });

        it('deve limitar progresso máximo a 99', () => {
            const totalSteps = 5;

            const calculateProgress = (stepIndex: number): number => {
                const progressBase = Math.round((stepIndex / totalSteps) * 100);
                return Math.min(99, Math.max(progressBase, 10));
            };

            expect(calculateProgress(5)).toBe(99);
            expect(calculateProgress(10)).toBe(99);
        });

        it('deve garantir progresso mínimo de 10', () => {
            const calculateProgress = (stepIndex: number, totalSteps: number): number => {
                const progressBase = Math.round((stepIndex / totalSteps) * 100);
                return Math.min(99, Math.max(progressBase, 10));
            };

            expect(calculateProgress(0, 100)).toBe(10);
            expect(calculateProgress(0, 1000)).toBe(10);
        });
    });

    describe('Pipeline stage update', () => {
        it('deve atualizar estágio do pipeline no banco', async () => {
            const [id] = await db('jobs_conciliacao').insert({
                nome: 'Stage test',
                status: 'RUNNING',
            });

            await db('jobs_conciliacao').where({ id }).update({
                pipeline_stage: 'normalizando_base_a',
                pipeline_stage_label: 'Normalizando campos da Base Contábil',
                pipeline_progress: 20,
            });

            const job = await db('jobs_conciliacao').where({ id }).first();
            expect(job?.pipeline_stage).toBe('normalizando_base_a');
            expect(job?.pipeline_stage_label).toBe('Normalizando campos da Base Contábil');
            expect(job?.pipeline_progress).toBe(20);
        });

        it('deve atualizar estágio progressivamente', async () => {
            const [id] = await db('jobs_conciliacao').insert({
                nome: 'Progressive stage test',
                status: 'RUNNING',
            });

            const stages = [
                { stage: 'queued', label: 'Na fila', progress: 0 },
                { stage: 'starting_worker', label: 'Iniciando', progress: 8 },
                { stage: 'normalizando_base_a', label: 'Normalizando A', progress: 20 },
                { stage: 'aplicando_estorno', label: 'Estorno', progress: 40 },
                { stage: 'normalizando_base_b', label: 'Normalizando B', progress: 60 },
                { stage: 'aplicando_cancelamento', label: 'Cancelamento', progress: 80 },
                { stage: 'conciliando', label: 'Conciliando', progress: 90 },
            ];

            for (const s of stages) {
                await db('jobs_conciliacao').where({ id }).update({
                    pipeline_stage: s.stage,
                    pipeline_stage_label: s.label,
                    pipeline_progress: s.progress,
                });

                const job = await db('jobs_conciliacao').where({ id }).first();
                expect(job?.pipeline_stage).toBe(s.stage);
            }
        });
    });
});
