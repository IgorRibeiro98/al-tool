/**
 * Testes unitários para ConciliacaoPipeline core
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConciliacaoPipeline, PipelineContext, PipelineStep } from '../../../src/pipeline/core';
import { createMockLogger, createMockPipelineContext } from '../../helpers/mocks';

describe('ConciliacaoPipeline', () => {
    let mockLogger: ReturnType<typeof createMockLogger>;

    beforeEach(() => {
        mockLogger = createMockLogger();
    });

    describe('constructor', () => {
        it('deve criar pipeline sem steps', () => {
            const pipeline = new ConciliacaoPipeline([], mockLogger);
            expect(pipeline.getStepNames()).toEqual([]);
        });

        it('deve criar pipeline com steps válidos', () => {
            const steps: PipelineStep[] = [
                { name: 'Step1', execute: vi.fn() },
                { name: 'Step2', execute: vi.fn() },
            ];

            const pipeline = new ConciliacaoPipeline(steps, mockLogger);
            expect(pipeline.getStepNames()).toEqual(['Step1', 'Step2']);
        });

        it('deve lançar erro para step inválido', () => {
            const invalidSteps = [
                { name: 'Valid', execute: vi.fn() },
                { invalid: true } as any,
            ];

            expect(() => new ConciliacaoPipeline(invalidSteps, mockLogger)).toThrow(
                'Invalid pipeline step provided at index 1'
            );
        });

        it('deve lançar erro para step sem name', () => {
            const invalidSteps = [
                { execute: vi.fn() } as any,
            ];

            expect(() => new ConciliacaoPipeline(invalidSteps, mockLogger)).toThrow();
        });

        it('deve lançar erro para step sem execute', () => {
            const invalidSteps = [
                { name: 'NoExecute' } as any,
            ];

            expect(() => new ConciliacaoPipeline(invalidSteps, mockLogger)).toThrow();
        });

        it('deve criar cópia dos steps (imutabilidade)', () => {
            const steps: PipelineStep[] = [
                { name: 'Step1', execute: vi.fn() },
            ];

            const pipeline = new ConciliacaoPipeline(steps, mockLogger);
            steps.push({ name: 'Step2', execute: vi.fn() });

            expect(pipeline.getStepNames()).toEqual(['Step1']);
        });
    });

    describe('run', () => {
        it('deve executar todos os steps em ordem', async () => {
            const executionOrder: string[] = [];

            const steps: PipelineStep[] = [
                {
                    name: 'Step1',
                    execute: vi.fn().mockImplementation(async () => {
                        executionOrder.push('Step1');
                    }),
                },
                {
                    name: 'Step2',
                    execute: vi.fn().mockImplementation(async () => {
                        executionOrder.push('Step2');
                    }),
                },
                {
                    name: 'Step3',
                    execute: vi.fn().mockImplementation(async () => {
                        executionOrder.push('Step3');
                    }),
                },
            ];

            const pipeline = new ConciliacaoPipeline(steps, mockLogger);
            const ctx = createMockPipelineContext();

            await pipeline.run(ctx);

            expect(executionOrder).toEqual(['Step1', 'Step2', 'Step3']);
        });

        it('deve passar contexto para cada step', async () => {
            const ctx = createMockPipelineContext({ jobId: 42 });

            const steps: PipelineStep[] = [
                {
                    name: 'CtxChecker',
                    execute: vi.fn().mockImplementation(async (passedCtx: PipelineContext) => {
                        expect(passedCtx.jobId).toBe(42);
                    }),
                },
            ];

            const pipeline = new ConciliacaoPipeline(steps, mockLogger);
            await pipeline.run(ctx);

            expect(steps[0].execute).toHaveBeenCalledWith(ctx);
        });

        it('deve chamar reportStage antes de cada step', async () => {
            const reportStage = vi.fn().mockResolvedValue(undefined);
            const ctx = createMockPipelineContext({ reportStage });

            const steps: PipelineStep[] = [
                { name: 'Step1', execute: vi.fn() },
                { name: 'Step2', execute: vi.fn() },
            ];

            const pipeline = new ConciliacaoPipeline(steps, mockLogger);
            await pipeline.run(ctx);

            expect(reportStage).toHaveBeenCalledTimes(2);
            expect(reportStage).toHaveBeenNthCalledWith(1, {
                stepName: 'Step1',
                stepIndex: 0,
                totalSteps: 2,
            });
            expect(reportStage).toHaveBeenNthCalledWith(2, {
                stepName: 'Step2',
                stepIndex: 1,
                totalSteps: 2,
            });
        });

        it('deve continuar mesmo se reportStage falhar', async () => {
            const reportStage = vi.fn().mockRejectedValue(new Error('Report failed'));
            const ctx = createMockPipelineContext({ reportStage });

            const executeStub = vi.fn().mockResolvedValue(undefined);
            const steps: PipelineStep[] = [
                { name: 'Step1', execute: executeStub },
            ];

            const pipeline = new ConciliacaoPipeline(steps, mockLogger);
            await pipeline.run(ctx);

            expect(executeStub).toHaveBeenCalled();
            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('deve propagar erro de step e parar execução', async () => {
            const error = new Error('Step failed');
            const steps: PipelineStep[] = [
                { name: 'Step1', execute: vi.fn().mockResolvedValue(undefined) },
                { name: 'Step2', execute: vi.fn().mockRejectedValue(error) },
                { name: 'Step3', execute: vi.fn().mockResolvedValue(undefined) },
            ];

            const pipeline = new ConciliacaoPipeline(steps, mockLogger);
            const ctx = createMockPipelineContext();

            await expect(pipeline.run(ctx)).rejects.toThrow('Step failed');

            expect(steps[0].execute).toHaveBeenCalled();
            expect(steps[1].execute).toHaveBeenCalled();
            expect(steps[2].execute).not.toHaveBeenCalled();
        });

        it('deve logar erro quando step falha', async () => {
            const error = new Error('Step error');
            const steps: PipelineStep[] = [
                { name: 'FailStep', execute: vi.fn().mockRejectedValue(error) },
            ];

            const pipeline = new ConciliacaoPipeline(steps, mockLogger);
            const ctx = createMockPipelineContext({ jobId: 123 });

            await expect(pipeline.run(ctx)).rejects.toThrow();

            expect(mockLogger.error).toHaveBeenCalled();
        });

        it('deve completar sem erros para pipeline vazio', async () => {
            const pipeline = new ConciliacaoPipeline([], mockLogger);
            const ctx = createMockPipelineContext();

            await expect(pipeline.run(ctx)).resolves.toBeUndefined();
        });
    });

    describe('getStepNames', () => {
        it('deve retornar array vazio para pipeline sem steps', () => {
            const pipeline = new ConciliacaoPipeline([], mockLogger);
            expect(pipeline.getStepNames()).toEqual([]);
        });

        it('deve retornar nomes de todos os steps', () => {
            const steps: PipelineStep[] = [
                { name: 'NullsBaseA', execute: vi.fn() },
                { name: 'EstornoBaseA', execute: vi.fn() },
                { name: 'ConciliacaoAB', execute: vi.fn() },
            ];

            const pipeline = new ConciliacaoPipeline(steps, mockLogger);
            expect(pipeline.getStepNames()).toEqual(['NullsBaseA', 'EstornoBaseA', 'ConciliacaoAB']);
        });
    });
});

describe('PipelineContext', () => {
    it('deve ter todos os campos obrigatórios', () => {
        const ctx: PipelineContext = {
            jobId: 1,
            baseContabilId: 2,
            baseFiscalId: 3,
            configConciliacaoId: 4,
        };

        expect(ctx.jobId).toBe(1);
        expect(ctx.baseContabilId).toBe(2);
        expect(ctx.baseFiscalId).toBe(3);
        expect(ctx.configConciliacaoId).toBe(4);
    });

    it('deve suportar campos opcionais', () => {
        const ctx: PipelineContext = {
            jobId: 1,
            baseContabilId: 2,
            baseFiscalId: 3,
            configConciliacaoId: 4,
            configEstornoId: 5,
            configCancelamentoId: 6,
            reportStage: async () => { },
        };

        expect(ctx.configEstornoId).toBe(5);
        expect(ctx.configCancelamentoId).toBe(6);
        expect(ctx.reportStage).toBeDefined();
    });
});
