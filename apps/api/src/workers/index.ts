/**
 * Workers Module Index
 * 
 * Exporta componentes do sistema de Worker Threads para processamento paralelo.
 * 
 * Uso básico:
 * ```
 * import { workerPools, parseRowsParallel, processGroupsParallel } from '../workers';
 * 
 * // Para ingestão
 * const result = await parseRowsParallel(rows, columns, colTypes);
 * 
 * // Para conciliação
 * const output = await processGroupsParallel(groups, aRows, bRows, options);
 * ```
 */

export { WorkerPool } from './pool/WorkerPool';
export { workerPools } from './WorkerPoolManager';
export * from './pool/types';

// Export helpers for easy integration
export * from './helpers';

// Export configuration
export {
    workerConfig,
    shouldUseWorkers,
    getPoolSize,
    getThreshold,
    getBatchSize,
    splitIntoBatches,
    reloadConfig,
    type WorkerConfig,
} from './config';

// Re-export worker file paths for external spawning if needed
export const WORKER_PATHS = {
    ingest: {
        rowParser: 'workers/ingest/rowParser.worker.js',
    },
    conciliacao: {
        groupProcessor: 'workers/conciliacao/groupProcessor.worker.js',
    },
    estorno: {
        estornoMatcher: 'workers/estorno/estornoMatcher.worker.js',
    },
    atribuicao: {
        rowTransformer: 'workers/atribuicao/rowTransformer.worker.js',
    },
};
