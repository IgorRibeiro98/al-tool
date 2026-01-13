/**
 * Worker Pool Manager
 * 
 * Gerenciador singleton para pools de workers reutilizáveis.
 * Evita criar/destruir workers repetidamente, mantendo pools vivos durante a execução da API.
 * 
 * Uso:
 * ```
 * import { workerPools } from './workers';
 * 
 * // Obtém ou cria um pool
 * const ingestPool = await workerPools.getIngestPool();
 * 
 * // Usa o pool
 * const result = await ingestPool.exec('parseRows', data);
 * 
 * // Ao finalizar a API, chamar shutdown
 * await workerPools.shutdownAll();
 * ```
 */

import path from 'path';
import { WorkerPool } from './pool/WorkerPool';
import { WorkerPoolOptions } from './pool/types';
import { workerConfig, getPoolSize } from './config';

const LOG_PREFIX = '[WorkerPoolManager]';

// Configurações padrão para cada tipo de pool (timeouts específicos)
const POOL_TIMEOUTS = {
    ingest: 600000,     // 10 min para arquivos grandes
    conciliacao: 300000, // 5 min
    estorno: 180000,     // 3 min
    atribuicao: 300000,  // 5 min
};

class WorkerPoolManager {
    private pools: Map<string, WorkerPool> = new Map();
    private initPromises: Map<string, Promise<WorkerPool>> = new Map();
    private isShuttingDown = false;

    /**
     * Obtém ou cria o pool de ingestão
     */
    async getIngestPool(): Promise<WorkerPool> {
        return this.getOrCreatePool(
            'ingest',
            path.join(__dirname, 'ingest', 'rowParser.worker.js'),
            {
                name: 'IngestPool',
                poolSize: getPoolSize('ingest'),
                taskTimeout: POOL_TIMEOUTS.ingest,
            }
        );
    }

    /**
     * Obtém ou cria o pool de conciliação
     */
    async getConciliacaoPool(): Promise<WorkerPool> {
        return this.getOrCreatePool(
            'conciliacao',
            path.join(__dirname, 'conciliacao', 'groupProcessor.worker.js'),
            {
                name: 'ConciliacaoPool',
                poolSize: getPoolSize('conciliacao'),
                taskTimeout: POOL_TIMEOUTS.conciliacao,
            }
        );
    }

    /**
     * Obtém ou cria o pool de estorno
     */
    async getEstornoPool(): Promise<WorkerPool> {
        return this.getOrCreatePool(
            'estorno',
            path.join(__dirname, 'estorno', 'estornoMatcher.worker.js'),
            {
                name: 'EstornoPool',
                poolSize: getPoolSize('estorno'),
                taskTimeout: POOL_TIMEOUTS.estorno,
            }
        );
    }

    /**
     * Obtém ou cria o pool de atribuição
     */
    async getAtribuicaoPool(): Promise<WorkerPool> {
        return this.getOrCreatePool(
            'atribuicao',
            path.join(__dirname, 'atribuicao', 'rowTransformer.worker.js'),
            {
                name: 'AtribuicaoPool',
                poolSize: getPoolSize('atribuicao'),
                taskTimeout: POOL_TIMEOUTS.atribuicao,
            }
        );
    }

    /**
     * Obtém um pool existente ou cria um novo
     */
    private async getOrCreatePool(
        name: string,
        workerPath: string,
        options: WorkerPoolOptions
    ): Promise<WorkerPool> {
        if (this.isShuttingDown) {
            throw new Error('WorkerPoolManager is shutting down');
        }

        // Check if pool already exists
        const existingPool = this.pools.get(name);
        if (existingPool) {
            return existingPool;
        }

        // Check if initialization is in progress
        const existingPromise = this.initPromises.get(name);
        if (existingPromise) {
            return existingPromise;
        }

        // Create new pool
        const initPromise = this.createPool(name, workerPath, options);
        this.initPromises.set(name, initPromise);

        try {
            const pool = await initPromise;
            this.pools.set(name, pool);
            return pool;
        } finally {
            this.initPromises.delete(name);
        }
    }

    private async createPool(
        name: string,
        workerPath: string,
        options: WorkerPoolOptions
    ): Promise<WorkerPool> {
        console.log(`${LOG_PREFIX} Creating pool: ${name}`);

        const pool = new WorkerPool(workerPath, options);
        await pool.initialize();

        console.log(`${LOG_PREFIX} Pool ${name} created with ${pool.size} workers`);
        return pool;
    }

    /**
     * Verifica se um pool específico está inicializado
     */
    hasPool(name: string): boolean {
        return this.pools.has(name);
    }

    /**
     * Obtém estatísticas de todos os pools
     */
    getStats(): Record<string, any> {
        const stats: Record<string, any> = {};

        for (const [name, pool] of this.pools.entries()) {
            stats[name] = pool.getStats();
        }

        return stats;
    }

    /**
     * Encerra um pool específico
     */
    async shutdownPool(name: string): Promise<void> {
        const pool = this.pools.get(name);
        if (pool) {
            console.log(`${LOG_PREFIX} Shutting down pool: ${name}`);
            await pool.shutdown();
            this.pools.delete(name);
        }
    }

    /**
     * Encerra todos os pools
     */
    async shutdownAll(): Promise<void> {
        if (this.isShuttingDown) return;

        this.isShuttingDown = true;
        console.log(`${LOG_PREFIX} Shutting down all pools...`);

        const shutdownPromises = Array.from(this.pools.entries()).map(
            async ([name, pool]) => {
                try {
                    console.log(`${LOG_PREFIX} Shutting down ${name}...`);
                    await pool.shutdown();
                    this.pools.delete(name);
                } catch (error) {
                    console.error(`${LOG_PREFIX} Error shutting down ${name}:`, error);
                }
            }
        );

        await Promise.all(shutdownPromises);
        console.log(`${LOG_PREFIX} All pools shut down`);
    }
}

// Singleton instance
export const workerPools = new WorkerPoolManager();

// Graceful shutdown on process exit
process.on('SIGTERM', async () => {
    console.log(`${LOG_PREFIX} SIGTERM received, shutting down pools...`);
    await workerPools.shutdownAll();
});

process.on('SIGINT', async () => {
    console.log(`${LOG_PREFIX} SIGINT received, shutting down pools...`);
    await workerPools.shutdownAll();
});

export default workerPools;
