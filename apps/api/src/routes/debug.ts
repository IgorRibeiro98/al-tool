/**
 * Debug Routes
 * 
 * Rotas para diagnóstico e verificação do sistema.
 * Úteis para debugging e monitoramento.
 */

import { Router } from 'express';
import { workerPools } from '../workers/WorkerPoolManager';
import { workerConfig } from '../workers/config';
import db from '../db/knex';
import { cpus, totalmem, freemem } from 'os';

const router = Router();

/**
 * GET /api/debug/workers
 * Retorna status e estatísticas dos worker pools
 */
router.get('/workers', async (_req, res) => {
    try {
        const config = workerConfig;
        const stats = workerPools.getStats();
        const poolsInitialized = {
            ingest: workerPools.hasPool('ingest'),
            conciliacao: workerPools.hasPool('conciliacao'),
            estorno: workerPools.hasPool('estorno'),
            atribuicao: workerPools.hasPool('atribuicao'),
        };

        res.json({
            enabled: config.enabled,
            config: {
                poolSize: config.poolSize,
                taskTimeout: config.taskTimeout,
                debugLogging: config.debugLogging,
                thresholds: {
                    ingest: config.ingestThreshold,
                    conciliacao: config.conciliacaoThreshold,
                    estorno: config.estornoThreshold,
                    atribuicao: config.atribuicaoThreshold,
                },
                batchSizes: {
                    ingest: config.ingestBatchSize,
                    conciliacao: config.conciliacaoBatchSize,
                    estorno: config.estornoBatchSize,
                    atribuicao: config.atribuicaoBatchSize,
                },
            },
            pools: poolsInitialized,
            stats,
        });
    } catch (error) {
        console.error('[debug/workers] Error:', error);
        res.status(500).json({ error: 'Failed to get worker stats' });
    }
});

/**
 * POST /api/debug/workers/test
 * Testa se os workers estão funcionando executando uma tarefa simples
 */
router.post('/workers/test', async (req, res) => {
    try {
        const { pool: poolName = 'ingest' } = req.body;
        const results: Record<string, any> = {};

        // Test based on pool name
        if (poolName === 'ingest' || poolName === 'all') {
            try {
                const pool = await workerPools.getIngestPool();
                const startTime = Date.now();

                // Simple test: parse a few rows
                const testData = {
                    rows: [
                        { col1: '123', col2: 'test', col3: '45.67' },
                        { col1: '456', col2: 'test2', col3: '89.01' },
                    ],
                    columnTypes: { col1: 'INTEGER', col2: 'TEXT', col3: 'REAL' },
                    startIndex: 0,
                };

                const result = await pool.exec('parseRows', testData);
                const elapsed = Date.now() - startTime;

                results.ingest = {
                    success: true,
                    elapsed,
                    result: Array.isArray(result) ? `${result.length} rows parsed` : result,
                };
            } catch (error: any) {
                results.ingest = { success: false, error: error.message };
            }
        }

        if (poolName === 'conciliacao' || poolName === 'all') {
            try {
                const pool = await workerPools.getConciliacaoPool();
                const startTime = Date.now();

                // Simple test: process a group
                const testData = {
                    groups: [
                        { key: 'test-key', rowsA: [1, 2], rowsB: [3, 4] }
                    ],
                    tolerance: 0.01,
                };

                const result = await pool.exec('processGroups', testData);
                const elapsed = Date.now() - startTime;

                results.conciliacao = {
                    success: true,
                    elapsed,
                    result: typeof result === 'object' ? 'Groups processed' : result,
                };
            } catch (error: any) {
                results.conciliacao = { success: false, error: error.message };
            }
        }

        if (poolName === 'estorno' || poolName === 'all') {
            try {
                const pool = await workerPools.getEstornoPool();
                const startTime = Date.now();

                // Simple test: match estornos
                const testData = {
                    entries: [
                        { id: 1, valor: 100 },
                        { id: 2, valor: -100 },
                    ],
                };

                const result = await pool.exec('matchEstornos', testData);
                const elapsed = Date.now() - startTime;

                results.estorno = {
                    success: true,
                    elapsed,
                    result: typeof result === 'object' ? 'Estornos matched' : result,
                };
            } catch (error: any) {
                results.estorno = { success: false, error: error.message };
            }
        }

        if (poolName === 'atribuicao' || poolName === 'all') {
            try {
                const pool = await workerPools.getAtribuicaoPool();
                const startTime = Date.now();

                // Simple test: transform rows
                const testData = {
                    matches: [
                        { rowA: { id: 1, valor: 100 }, rowB: { id: 2, valor: 100 } }
                    ],
                };

                const result = await pool.exec('transformRows', testData);
                const elapsed = Date.now() - startTime;

                results.atribuicao = {
                    success: true,
                    elapsed,
                    result: typeof result === 'object' ? 'Rows transformed' : result,
                };
            } catch (error: any) {
                results.atribuicao = { success: false, error: error.message };
            }
        }

        const allSuccess = Object.values(results).every((r: any) => r.success);

        res.json({
            success: allSuccess,
            testedPools: Object.keys(results),
            results,
        });
    } catch (error: any) {
        console.error('[debug/workers/test] Error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/debug/system
 * Retorna informações do sistema
 */
router.get('/system', async (_req, res) => {
    try {
        const totalMem = totalmem();
        const freeMem = freemem();
        const usedMem = totalMem - freeMem;

        res.json({
            nodejs: {
                version: process.version,
                platform: process.platform,
                arch: process.arch,
                pid: process.pid,
                uptime: process.uptime(),
                memoryUsage: process.memoryUsage(),
            },
            os: {
                cpus: cpus().length,
                cpuModel: cpus()[0]?.model,
                totalMemory: totalMem,
                freeMemory: freeMem,
                usedMemory: usedMem,
                memoryUsagePercent: ((usedMem / totalMem) * 100).toFixed(1),
            },
            env: {
                NODE_ENV: process.env.NODE_ENV,
                WORKER_THREADS_ENABLED: process.env.WORKER_THREADS_ENABLED,
                WORKER_POOL_SIZE: process.env.WORKER_POOL_SIZE,
            },
        });
    } catch (error) {
        console.error('[debug/system] Error:', error);
        res.status(500).json({ error: 'Failed to get system info' });
    }
});

/**
 * GET /api/debug/db
 * Retorna informações do banco de dados
 */
router.get('/db', async (_req, res) => {
    try {
        // Get SQLite pragmas
        const pragmas = await Promise.all([
            db.raw('PRAGMA journal_mode'),
            db.raw('PRAGMA synchronous'),
            db.raw('PRAGMA cache_size'),
            db.raw('PRAGMA mmap_size'),
            db.raw('PRAGMA busy_timeout'),
        ]);

        // Count tables and rows
        const tables = await db.raw(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'base_%'"
        );
        const tableNames = tables.map((t: any) => t.name);

        const tableCounts: Record<string, number> = {};
        for (const name of tableNames.slice(0, 10)) { // Limit to 10 tables
            const countResult = await db(name).count('* as cnt').first();
            tableCounts[name] = Number(countResult?.cnt ?? 0);
        }

        res.json({
            pragmas: {
                journal_mode: pragmas[0]?.[0]?.journal_mode,
                synchronous: pragmas[1]?.[0]?.synchronous,
                cache_size: pragmas[2]?.[0]?.cache_size,
                mmap_size: pragmas[3]?.[0]?.mmap_size,
                busy_timeout: pragmas[4]?.[0]?.busy_timeout,
            },
            tables: {
                count: tableNames.length,
                samples: tableCounts,
            },
        });
    } catch (error) {
        console.error('[debug/db] Error:', error);
        res.status(500).json({ error: 'Failed to get db info' });
    }
});

export default router;
