/**
 * Setup global para testes - roda antes de cada arquivo de teste
 */
import { beforeAll, afterAll, afterEach, vi } from 'vitest';

// Configurar NODE_ENV para testes
process.env.NODE_ENV = 'test';

// Configurar variáveis de ambiente de teste
process.env.SQLITE_JOURNAL_MODE = 'MEMORY';
process.env.SQLITE_SYNCHRONOUS = 'OFF';
process.env.SQLITE_CACHE_SIZE = '-10000';
process.env.SQLITE_BUSY_TIMEOUT = '5000';

// Suprimir logs durante os testes (exceto erros)
const originalConsoleLog = console.log;
const originalConsoleInfo = console.info;
const originalConsoleWarn = console.warn;

beforeAll(() => {
    // Suprime logs verbosos durante testes
    if (process.env.VITEST_VERBOSE !== 'true') {
        console.log = vi.fn();
        console.info = vi.fn();
        console.warn = vi.fn();
    }
});

afterAll(() => {
    // Restaura console original
    console.log = originalConsoleLog;
    console.info = originalConsoleInfo;
    console.warn = originalConsoleWarn;
});

afterEach(() => {
    // Limpa todos os mocks após cada teste
    vi.clearAllMocks();
});
