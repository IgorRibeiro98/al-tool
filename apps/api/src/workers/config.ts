/**
 * Worker Threads Configuration
 * 
 * Configurações para controlar o comportamento do sistema de Worker Threads.
 * Valores podem ser sobrescritos via variáveis de ambiente.
 * 
 * ## Variáveis de Ambiente Disponíveis:
 * 
 * ### Controle Geral
 * - `WORKER_THREADS_ENABLED` - Habilita/desabilita workers (true/false, padrão: true se CPUs > 2)
 * - `WORKER_POOL_SIZE` - Número de workers por pool (padrão: CPUs - 1)
 * - `WORKER_TASK_TIMEOUT` - Timeout em ms para cada tarefa (padrão: 300000 = 5 min)
 * - `WORKER_DEBUG_LOGGING` - Logs detalhados de workers (true/false, padrão: false)
 * 
 * ### Thresholds por Fluxo (volume mínimo para usar workers)
 * - `WORKER_INGEST_THRESHOLD` - Linhas mínimas para ingestão (padrão: 1000)
 * - `WORKER_CONCILIACAO_THRESHOLD` - Grupos mínimos para conciliação (padrão: 500)
 * - `WORKER_ESTORNO_THRESHOLD` - Entries mínimas para estorno (padrão: 5000)
 * - `WORKER_ATRIBUICAO_THRESHOLD` - Matches mínimos para atribuição (padrão: 100)
 * 
 * ### Pool Size por Fluxo (opcional - sobrescreve WORKER_POOL_SIZE)
 * - `WORKER_INGEST_POOL_SIZE` - Workers dedicados para ingestão
 * - `WORKER_CONCILIACAO_POOL_SIZE` - Workers dedicados para conciliação
 * - `WORKER_ESTORNO_POOL_SIZE` - Workers dedicados para estorno
 * - `WORKER_ATRIBUICAO_POOL_SIZE` - Workers dedicados para atribuição
 * 
 * ### Batch Size por Fluxo (tamanho do lote de dados por tarefa)
 * - `WORKER_INGEST_BATCH_SIZE` - Linhas por batch na ingestão (padrão: 5000)
 * - `WORKER_CONCILIACAO_BATCH_SIZE` - Grupos por batch na conciliação (padrão: 1000)
 * - `WORKER_ESTORNO_BATCH_SIZE` - Entries por batch no estorno (padrão: 10000)
 * - `WORKER_ATRIBUICAO_BATCH_SIZE` - Matches por batch na atribuição (padrão: 500)
 * 
 * ## Exemplos:
 * 
 * ```bash
 * # Modo conservador (menos recursos)
 * WORKER_POOL_SIZE=2 WORKER_INGEST_THRESHOLD=5000 npm start
 * 
 * # Modo agressivo (máximo desempenho em servidor potente)
 * WORKER_POOL_SIZE=8 WORKER_INGEST_THRESHOLD=500 npm start
 * 
 * # Desabilitar workers completamente
 * WORKER_THREADS_ENABLED=false npm start
 * 
 * # Debug detalhado
 * WORKER_DEBUG_LOGGING=true npm start
 * ```
 */

import { cpus, totalmem, freemem } from 'os';

const LOG_PREFIX = '[WorkerConfig]';

// ============================================================================
// Hardware Limits for 8GB RAM / i5 8th Gen / Windows 11 target machines
// ============================================================================

/**
 * Maximum workers based on available RAM (conservative for 8GB target)
 * Each worker uses ~50-100MB depending on workload
 */
const MAX_WORKERS_PER_POOL = 4;  // Maximum workers per pool (8GB RAM)
const MIN_WORKERS_PER_POOL = 1;  // Minimum for parallelism
const RECOMMENDED_RAM_PER_WORKER_MB = 256; // Conservative estimate

/**
 * Calculate safe pool size based on available memory
 */
function calculateOptimalPoolSize(numCpus: number): number {
    const totalRamMB = Math.floor(totalmem() / 1024 / 1024);
    const freeRamMB = Math.floor(freemem() / 1024 / 1024);

    // Reserve 2GB for OS + 1GB for main Node process + 500MB for SQLite cache
    const reservedMB = 3500;
    const availableForWorkersMB = Math.max(0, Math.min(totalRamMB, freeRamMB + 1000) - reservedMB);

    // Calculate workers based on RAM (considering all pools share the same resources)
    // Assume 4 potential pools, so divide available RAM by 4
    const maxWorkersFromRam = Math.floor(availableForWorkersMB / 4 / RECOMMENDED_RAM_PER_WORKER_MB);

    // Also consider CPU cores (i5 8th gen = 4 cores / 8 threads typically)
    const maxWorkersFromCpu = Math.max(1, numCpus - 1);

    // Take the minimum to avoid overloading
    const optimal = Math.min(
        maxWorkersFromRam,
        maxWorkersFromCpu,
        MAX_WORKERS_PER_POOL
    );

    return Math.max(MIN_WORKERS_PER_POOL, optimal);
}

/**
 * Configuração de worker threads
 */
export interface WorkerConfig {
    /** Habilita/desabilita uso de worker threads globalmente */
    enabled: boolean;

    /** Número de workers no pool (padrão: CPUs - 1) */
    poolSize: number;

    /** Threshold mínimo de linhas para usar workers na ingestão */
    ingestThreshold: number;

    /** Threshold mínimo de grupos para usar workers na conciliação */
    conciliacaoThreshold: number;

    /** Threshold mínimo de entries para usar workers no estorno */
    estornoThreshold: number;

    /** Threshold mínimo de matches para usar workers na atribuição */
    atribuicaoThreshold: number;

    /** Timeout padrão para tarefas de workers (ms) */
    taskTimeout: number;

    /** Log detalhado de worker threads */
    debugLogging: boolean;

    // Pool sizes por fluxo (sobrescrevem poolSize global)
    /** Pool size específico para ingestão (undefined = usa poolSize global) */
    ingestPoolSize?: number;
    /** Pool size específico para conciliação */
    conciliacaoPoolSize?: number;
    /** Pool size específico para estorno */
    estornoPoolSize?: number;
    /** Pool size específico para atribuição */
    atribuicaoPoolSize?: number;

    // Batch sizes (tamanho de cada lote enviado ao worker)
    /** Linhas por batch na ingestão */
    ingestBatchSize: number;
    /** Grupos por batch na conciliação */
    conciliacaoBatchSize: number;
    /** Entries por batch no estorno */
    estornoBatchSize: number;
    /** Matches por batch na atribuição */
    atribuicaoBatchSize: number;
}

/**
 * Carrega configuração do ambiente
 */
function loadConfig(): WorkerConfig {
    const numCpus = cpus().length;
    const totalRamMB = Math.floor(totalmem() / 1024 / 1024);

    // Parse boolean env var
    const parseBoolean = (val: string | undefined, defaultVal: boolean): boolean => {
        if (val === undefined) return defaultVal;
        return val.toLowerCase() === 'true' || val === '1';
    };

    // Parse number env var
    const parseNumber = (val: string | undefined, defaultVal: number): number => {
        if (val === undefined) return defaultVal;
        const num = parseInt(val, 10);
        return Number.isNaN(num) ? defaultVal : num;
    };

    // Parse optional number (returns undefined if not set)
    const parseOptionalNumber = (val: string | undefined): number | undefined => {
        if (val === undefined) return undefined;
        const num = parseInt(val, 10);
        return Number.isNaN(num) ? undefined : num;
    };

    // Use optimal pool size based on hardware detection
    const defaultPoolSize = calculateOptimalPoolSize(numCpus);

    // Adjust batch sizes based on available RAM (larger batches = fewer I/O operations)
    // For 8GB machines, use moderate batch sizes to balance memory and throughput
    const isLowMemory = totalRamMB < 6000; // Less than 6GB available
    const batchMultiplier = isLowMemory ? 0.5 : 1.0;

    const config: WorkerConfig = {
        // Desabilita workers se tiver <= 2 CPUs ou se explicitamente desabilitado
        enabled: parseBoolean(process.env.WORKER_THREADS_ENABLED, numCpus > 2),

        poolSize: parseNumber(process.env.WORKER_POOL_SIZE, defaultPoolSize),

        // Thresholds - increased slightly to avoid worker overhead for small datasets
        ingestThreshold: parseNumber(process.env.WORKER_INGEST_THRESHOLD, 2000),
        conciliacaoThreshold: parseNumber(process.env.WORKER_CONCILIACAO_THRESHOLD, 1000),
        estornoThreshold: parseNumber(process.env.WORKER_ESTORNO_THRESHOLD, 10000),
        atribuicaoThreshold: parseNumber(process.env.WORKER_ATRIBUICAO_THRESHOLD, 100),

        taskTimeout: parseNumber(process.env.WORKER_TASK_TIMEOUT, 300000), // 5 min

        debugLogging: parseBoolean(process.env.WORKER_DEBUG_LOGGING, false),

        // Pool sizes específicos por fluxo
        ingestPoolSize: parseOptionalNumber(process.env.WORKER_INGEST_POOL_SIZE),
        conciliacaoPoolSize: parseOptionalNumber(process.env.WORKER_CONCILIACAO_POOL_SIZE),
        estornoPoolSize: parseOptionalNumber(process.env.WORKER_ESTORNO_POOL_SIZE),
        atribuicaoPoolSize: parseOptionalNumber(process.env.WORKER_ATRIBUICAO_POOL_SIZE),

        // Batch sizes - adjusted based on RAM availability
        ingestBatchSize: parseNumber(process.env.WORKER_INGEST_BATCH_SIZE, Math.round(5000 * batchMultiplier)),
        conciliacaoBatchSize: parseNumber(process.env.WORKER_CONCILIACAO_BATCH_SIZE, Math.round(1000 * batchMultiplier)),
        estornoBatchSize: parseNumber(process.env.WORKER_ESTORNO_BATCH_SIZE, Math.round(10000 * batchMultiplier)),
        atribuicaoBatchSize: parseNumber(process.env.WORKER_ATRIBUICAO_BATCH_SIZE, Math.round(500 * batchMultiplier)),
    };

    // Log inicial ao carregar configuração com hardware info
    console.log(`${LOG_PREFIX} Workers ${config.enabled ? 'ENABLED' : 'DISABLED'}, poolSize=${config.poolSize}, CPUs=${numCpus}, RAM=${totalRamMB}MB, lowMemMode=${isLowMemory}`);

    if (config.debugLogging) {
        console.log(`${LOG_PREFIX} Full configuration:`, JSON.stringify(config, null, 2));
    }

    return config;
}

// Export singleton config
export const workerConfig = loadConfig();

/**
 * Verifica se workers estão habilitados e se o volume justifica seu uso
 */
export function shouldUseWorkers(volume: number, threshold: number): boolean {
    if (!workerConfig.enabled) return false;
    return volume >= threshold;
}

/**
 * Obtém pool size para um fluxo específico
 */
export function getPoolSize(flow: 'ingest' | 'conciliacao' | 'estorno' | 'atribuicao'): number {
    switch (flow) {
        case 'ingest':
            return workerConfig.ingestPoolSize ?? workerConfig.poolSize;
        case 'conciliacao':
            return workerConfig.conciliacaoPoolSize ?? workerConfig.poolSize;
        case 'estorno':
            return workerConfig.estornoPoolSize ?? workerConfig.poolSize;
        case 'atribuicao':
            return workerConfig.atribuicaoPoolSize ?? workerConfig.poolSize;
        default:
            return workerConfig.poolSize;
    }
}

/**
 * Obtém threshold para um fluxo específico
 */
export function getThreshold(flow: 'ingest' | 'conciliacao' | 'estorno' | 'atribuicao'): number {
    switch (flow) {
        case 'ingest':
            return workerConfig.ingestThreshold;
        case 'conciliacao':
            return workerConfig.conciliacaoThreshold;
        case 'estorno':
            return workerConfig.estornoThreshold;
        case 'atribuicao':
            return workerConfig.atribuicaoThreshold;
        default:
            return 1000;
    }
}

/**
 * Obtém batch size para um fluxo específico
 */
export function getBatchSize(flow: 'ingest' | 'conciliacao' | 'estorno' | 'atribuicao'): number {
    switch (flow) {
        case 'ingest':
            return workerConfig.ingestBatchSize;
        case 'conciliacao':
            return workerConfig.conciliacaoBatchSize;
        case 'estorno':
            return workerConfig.estornoBatchSize;
        case 'atribuicao':
            return workerConfig.atribuicaoBatchSize;
        default:
            return 1000;
    }
}

/**
 * Divide um array em batches do tamanho configurado
 */
export function splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
        batches.push(items.slice(i, i + batchSize));
    }
    return batches;
}

/**
 * Recarrega configuração (útil para testes)
 */
export function reloadConfig(): WorkerConfig {
    Object.assign(workerConfig, loadConfig());
    return workerConfig;
}

export default workerConfig;
