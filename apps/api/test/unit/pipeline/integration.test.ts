/**
 * Testes unitários para createConciliacaoPipeline (integration.ts)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockLogger } from '../../helpers/mocks';
import type { Knex } from 'knex';

// Mock do módulo db
vi.mock('../../../src/db/knex', () => ({
    default: {},
}));

// Importar após mock
import { createConciliacaoPipeline } from '../../../src/pipeline/integration';

describe('createConciliacaoPipeline', () => {
    let mockDb: Partial<Knex>;
    let mockLogger: ReturnType<typeof createMockLogger>;

    beforeEach(() => {
        mockDb = {
            raw: vi.fn(),
            schema: {
                hasTable: vi.fn().mockResolvedValue(true),
            } as any,
        };
        mockLogger = createMockLogger();
    });

    it('deve criar pipeline com steps padrão', () => {
        const pipeline = createConciliacaoPipeline({ db: mockDb as Knex, logger: mockLogger });

        const stepNames = pipeline.getStepNames();
        expect(stepNames).toContain('NullsBaseA');
        expect(stepNames).toContain('EstornoBaseA');
        expect(stepNames).toContain('NullsBaseB');
        expect(stepNames).toContain('CancelamentoBaseB');
        expect(stepNames).toContain('ConciliacaoAB');
    });

    it('deve criar pipeline com 5 steps', () => {
        const pipeline = createConciliacaoPipeline({ db: mockDb as Knex, logger: mockLogger });

        expect(pipeline.getStepNames()).toHaveLength(5);
    });

    it('deve logar criação do pipeline', () => {
        createConciliacaoPipeline({ db: mockDb as Knex, logger: mockLogger });

        expect(mockLogger.info).toHaveBeenCalled();
    });

    it('deve ordenar steps corretamente', () => {
        const pipeline = createConciliacaoPipeline({ db: mockDb as Knex, logger: mockLogger });

        const stepNames = pipeline.getStepNames();

        // Ordem esperada do fluxo
        expect(stepNames[0]).toBe('NullsBaseA');
        expect(stepNames[1]).toBe('EstornoBaseA');
        expect(stepNames[2]).toBe('NullsBaseB');
        expect(stepNames[3]).toBe('CancelamentoBaseB');
        expect(stepNames[4]).toBe('ConciliacaoAB');
    });
});

describe('Pipeline steps order', () => {
    it('deve seguir a ordem correta do fluxo de conciliação', () => {
        const expectedOrder = [
            'NullsBaseA',      // 1. Normalizar campos da Base A
            'EstornoBaseA',    // 2. Aplicar regras de estorno na Base A
            'NullsBaseB',      // 3. Normalizar campos da Base B
            'CancelamentoBaseB', // 4. Aplicar cancelamentos na Base B
            'ConciliacaoAB',   // 5. Conciliar A x B
        ];

        const mockDb = { raw: vi.fn(), schema: { hasTable: vi.fn().mockResolvedValue(true) } } as any;
        const pipeline = createConciliacaoPipeline({ db: mockDb });

        expect(pipeline.getStepNames()).toEqual(expectedOrder);
    });
});
