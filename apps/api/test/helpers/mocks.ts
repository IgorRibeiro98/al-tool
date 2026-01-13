/**
 * Mocks e fixtures comuns para testes
 */
import { vi } from 'vitest';
import type { Knex } from 'knex';

/**
 * Cria um mock de contexto de pipeline
 */
export function createMockPipelineContext(overrides: Partial<{
    jobId: number;
    baseContabilId: number;
    baseFiscalId: number;
    configConciliacaoId: number;
    configEstornoId: number;
    configCancelamentoId: number;
    reportStage: (info: { stepName: string; stepIndex: number; totalSteps: number }) => Promise<void>;
}> = {}) {
    return {
        jobId: 1,
        baseContabilId: 1,
        baseFiscalId: 2,
        configConciliacaoId: 1,
        configEstornoId: undefined,
        configCancelamentoId: undefined,
        reportStage: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

/**
 * Cria um mock de logger
 */
export function createMockLogger() {
    return {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };
}

/**
 * Fixtures de dados para Base Contábil
 */
export const baseContabilFixtures = {
    simple: [
        { documento: 'DOC001', valor: 100.50, empresa: 'EMP1' },
        { documento: 'DOC002', valor: 200.00, empresa: 'EMP1' },
        { documento: 'DOC003', valor: -100.50, empresa: 'EMP1' }, // Para estorno
        { documento: 'DOC004', valor: 300.00, empresa: 'EMP2' },
    ],
    withNulls: [
        { documento: 'DOC001', valor: 100.50, empresa: 'EMP1' },
        { documento: '', valor: null, empresa: '' },
        { documento: 'DOC003', valor: 0, empresa: null },
    ],
    forEstorno: [
        { documento: 'DOC001', valor: 100.00, empresa: 'EMP1' },
        { documento: 'DOC002', valor: -100.00, empresa: 'EMP1' }, // Anula DOC001
        { documento: 'DOC003', valor: 50.00, empresa: 'EMP1' },
        { documento: 'DOC004', valor: 200.00, empresa: 'EMP2' },
    ],
};

/**
 * Fixtures de dados para Base Fiscal
 */
export const baseFiscalFixtures = {
    simple: [
        { nf_numero: 'NF001', valor_nf: 100.50, cancelado: 'N' },
        { nf_numero: 'NF002', valor_nf: 200.00, cancelado: 'N' },
        { nf_numero: 'NF003', valor_nf: 150.00, cancelado: 'S' }, // Cancelada
        { nf_numero: 'NF004', valor_nf: 300.00, cancelado: 'N' },
    ],
    withNulls: [
        { nf_numero: 'NF001', valor_nf: 100.50, cancelado: 'N' },
        { nf_numero: '', valor_nf: null, cancelado: '' },
        { nf_numero: 'NF003', valor_nf: 0, cancelado: null },
    ],
};

/**
 * Fixtures de configurações
 */
export const configFixtures = {
    conciliacao: {
        id: 1,
        nome: 'Config Teste',
        base_contabil_id: 1,
        base_fiscal_id: 2,
        chaves_contabil: JSON.stringify({ CHAVE_1: ['documento'] }),
        chaves_fiscal: JSON.stringify({ CHAVE_1: ['nf_numero'] }),
        coluna_conciliacao_contabil: 'valor',
        coluna_conciliacao_fiscal: 'valor_nf',
        inverter_sinal_fiscal: 0,
        limite_diferenca_imaterial: 0.01,
    },
    estorno: {
        id: 1,
        nome: 'Config Estorno Teste',
        base_id: 1,
        coluna_soma: 'valor',
        limite_zero: 0.01,
    },
    cancelamento: {
        id: 1,
        nome: 'Config Cancelamento Teste',
        base_id: 2,
        coluna_indicador: 'cancelado',
        valor_cancelado: 'S',
    },
};

/**
 * Fixtures de Jobs
 */
export const jobFixtures = {
    pending: {
        nome: 'Job Pendente',
        status: 'PENDING',
        config_conciliacao_id: 1,
    },
    running: {
        nome: 'Job Em Execução',
        status: 'RUNNING',
        config_conciliacao_id: 1,
    },
    done: {
        nome: 'Job Finalizado',
        status: 'DONE',
        config_conciliacao_id: 1,
    },
    failed: {
        nome: 'Job Com Erro',
        status: 'FAILED',
        erro: 'Erro de teste',
        config_conciliacao_id: 1,
    },
};

/**
 * Mock de FileStorage
 */
export function createMockFileStorage() {
    return {
        saveFile: vi.fn().mockResolvedValue('/path/to/file'),
        getFile: vi.fn().mockResolvedValue(Buffer.from('test content')),
        deleteFile: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(true),
        ensureDir: vi.fn().mockResolvedValue(undefined),
    };
}

/**
 * Mock de Express Request
 */
export function createMockRequest(overrides: {
    params?: Record<string, string>;
    query?: Record<string, string>;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
} = {}) {
    return {
        params: {},
        query: {},
        body: {},
        headers: {},
        ...overrides,
    };
}

/**
 * Mock de Express Response
 */
export function createMockResponse() {
    const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
        sendFile: vi.fn().mockReturnThis(),
        download: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        type: vi.fn().mockReturnThis(),
    };
    return res;
}
