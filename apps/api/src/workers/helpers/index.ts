/**
 * Workers Helpers Index
 * 
 * Exporta todos os helpers de integração com worker pools.
 * 
 * Cada helper é exportado com nomes específicos para evitar conflitos.
 */

// Ingest helpers
export {
    parseRowsParallel,
    buildSqlParallel,
    shouldUseWorkers as shouldUseIngestWorkers
} from './ingestHelper';

// Conciliacao helpers
export {
    processGroupsParallel,
    shouldUseWorkers as shouldUseConciliacaoWorkers
} from './conciliacaoHelper';

// Estorno helpers
export {
    matchPairsParallel,
    shouldUseWorkers as shouldUseEstornoWorkers
} from './estornoHelper';

// Atribuicao helpers
export {
    transformRowsParallel,
    shouldUseWorkers as shouldUseAtribuicaoWorkers
} from './atribuicaoHelper';
