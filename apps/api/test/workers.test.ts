/**
 * Worker Pool Tests
 * 
 * Testes unitários para o sistema de Worker Threads.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { WorkerPool } from '../src/workers/pool/WorkerPool';
import { RowParserInput, RowParserOutput, ColumnDef, ColumnType } from '../src/workers/pool/types';

describe('WorkerPool', () => {
    describe('Basic functionality', () => {
        let pool: WorkerPool;

        beforeAll(async () => {
            // Use o rowParser worker como teste
            const workerPath = path.join(__dirname, '..', 'dist', 'workers', 'ingest', 'rowParser.worker.js');
            pool = new WorkerPool(workerPath, { poolSize: 2, name: 'TestPool' });
            await pool.initialize();
        });

        afterAll(async () => {
            if (pool) {
                await pool.shutdown();
            }
        });

        it('should initialize with correct pool size', () => {
            expect(pool.size).toBe(2);
        });

        it('should report idle when no tasks', () => {
            expect(pool.isIdle()).toBe(true);
        });

        it('should return stats', () => {
            const stats = pool.getStats();
            expect(stats).toHaveProperty('totalTasks');
            expect(stats).toHaveProperty('completedTasks');
            expect(stats).toHaveProperty('failedTasks');
            expect(stats).toHaveProperty('activeWorkers');
            expect(stats).toHaveProperty('queuedTasks');
        });
    });

    describe('Real worker execution', () => {
        let pool: WorkerPool;

        beforeAll(async () => {
            const workerPath = path.join(__dirname, '..', 'dist', 'workers', 'ingest', 'rowParser.worker.js');
            pool = new WorkerPool(workerPath, { poolSize: 2, name: 'ExecutionTest' });
            await pool.initialize();
        });

        afterAll(async () => {
            if (pool) {
                await pool.shutdown();
            }
        });

        it('should parse rows via worker', async () => {
            const input: RowParserInput = {
                rows: [
                    ['123.45', 'text1'],
                    ['67,89', 'text2'],  // Vírgula como separador decimal
                ],
                columns: [
                    { name: 'valor', original: 'Valor' },
                    { name: 'texto', original: 'Texto' }
                ],
                colTypes: ['real', 'text'],
                startIndex: 0
            };

            const result = await pool.exec<RowParserInput, RowParserOutput>('parseRows', input);

            expect(result.parsedRows).toHaveLength(2);
            expect(result.parsedRows[0].valor).toBe(123.45);
            expect(result.parsedRows[0].texto).toBe('text1');
            expect(result.parsedRows[1].valor).toBe(67.89);
            expect(result.parsedRows[1].texto).toBe('text2');
            expect(result.emptyRowIndices).toHaveLength(0);
        });

        it('should skip empty rows', async () => {
            const input: RowParserInput = {
                rows: [
                    ['123', 'a'],
                    [null, null],  // Empty row
                    ['', ''],      // Empty row
                    ['456', 'b'],
                ],
                columns: [
                    { name: 'num', original: 'Num' },
                    { name: 'str', original: 'Str' }
                ],
                colTypes: ['integer', 'text'],
                startIndex: 0
            };

            const result = await pool.exec<RowParserInput, RowParserOutput>('parseRows', input);

            expect(result.parsedRows).toHaveLength(2);
            expect(result.emptyRowIndices).toHaveLength(2);
        });

        it('should handle parallel execution', async () => {
            // Executa 10 tarefas em paralelo
            const inputs: RowParserInput[] = Array.from({ length: 10 }, (_, i) => ({
                rows: [[`${i * 10}`, `item-${i}`]],
                columns: [
                    { name: 'num', original: 'Num' },
                    { name: 'str', original: 'Str' }
                ],
                colTypes: ['real', 'text'] as ColumnType[],
                startIndex: 0
            }));

            const results = await Promise.all(
                inputs.map(input => pool.exec<RowParserInput, RowParserOutput>('parseRows', input))
            );

            expect(results).toHaveLength(10);
            results.forEach((result, i) => {
                expect(result.parsedRows).toHaveLength(1);
                expect(result.parsedRows[0].num).toBe(i * 10);
                expect(result.parsedRows[0].str).toBe(`item-${i}`);
            });
        });
    });
});

describe('Row Parser Worker Logic', () => {
    // Teste da lógica de parsing sem usar workers reais

    it('should parse numeric columns correctly', () => {
        const columns: ColumnDef[] = [
            { name: 'valor', original: 'Valor' },
            { name: 'texto', original: 'Texto' }
        ];
        const colTypes: ColumnType[] = ['real', 'text'];
        const rows = [
            ['123.45', 'abc'],
            ['67,89', 'def'],  // Vírgula como separador decimal
            [{ __num__: '100.5' }, 'ghi'],  // Wrapper __num__
        ];

        // Simula a lógica do worker
        const parseRow = (rowArr: unknown[]): Record<string, unknown> => {
            const obj: Record<string, unknown> = {};
            columns.forEach((c, idx) => {
                const raw = rowArr[idx];
                const valRaw = raw && typeof raw === 'object' && (raw as any).__num__
                    ? (raw as any).__num__
                    : raw;
                let v: unknown = valRaw === undefined ? null : valRaw;
                if (v === '') v = null;

                const t = colTypes[idx];
                if (v != null && t === 'real') {
                    if (typeof v === 'string') {
                        const normalized = v.trim().replace(',', '.');
                        const numVal = parseFloat(normalized);
                        v = Number.isNaN(numVal) ? null : numVal;
                    }
                }
                obj[c.name] = v;
            });
            return obj;
        };

        const parsed = rows.map(parseRow);

        expect(parsed[0].valor).toBe(123.45);
        expect(parsed[0].texto).toBe('abc');

        expect(parsed[1].valor).toBe(67.89);  // Vírgula convertida
        expect(parsed[1].texto).toBe('def');

        expect(parsed[2].valor).toBe(100.5);  // __num__ extraído
        expect(parsed[2].texto).toBe('ghi');
    });

    it('should detect empty rows', () => {
        const columns: ColumnDef[] = [
            { name: 'a', original: 'A' },
            { name: 'b', original: 'B' }
        ];
        const colTypes: ColumnType[] = ['text', 'text'];

        const rows = [
            ['value1', 'value2'],
            [null, null],
            ['', ''],
            [null, ''],
        ];

        const checkEmpty = (rowArr: unknown[]): boolean => {
            return rowArr.every(v => v === null || v === undefined || v === '');
        };

        expect(checkEmpty(rows[0])).toBe(false);
        expect(checkEmpty(rows[1])).toBe(true);
        expect(checkEmpty(rows[2])).toBe(true);
        expect(checkEmpty(rows[3])).toBe(true);
    });
});

describe('SQL Builder Logic', () => {
    it('should escape string values correctly', () => {
        const escapeSqlValue = (val: unknown): string => {
            if (val === null || val === undefined) return 'NULL';
            if (typeof val === 'number') {
                if (Number.isNaN(val) || !Number.isFinite(val)) return 'NULL';
                if (Number.isInteger(val)) return `CAST(${val} AS INTEGER)`;
                // Use precision that avoids floating point artifacts
                const str = val.toPrecision(15).replace(/\.?0+$/, '');
                return str;
            }
            if (typeof val === 'string') {
                return `'${val.replace(/'/g, "''")}'`;
            }
            return `'${String(val).replace(/'/g, "''")}'`;
        };

        expect(escapeSqlValue(null)).toBe('NULL');
        expect(escapeSqlValue(undefined)).toBe('NULL');
        expect(escapeSqlValue(123)).toBe('CAST(123 AS INTEGER)');
        // Float check - verify it parses to the same value
        const floatResult = escapeSqlValue(123.45);
        expect(parseFloat(floatResult)).toBe(123.45);
        expect(escapeSqlValue('hello')).toBe("'hello'");
        expect(escapeSqlValue("it's")).toBe("'it''s'");  // Escape single quote
        expect(escapeSqlValue(NaN)).toBe('NULL');
        expect(escapeSqlValue(Infinity)).toBe('NULL');
    });
});

describe('Worker Configuration', () => {
    it('should have default config values', async () => {
        const { workerConfig, getPoolSize, getThreshold, getBatchSize, splitIntoBatches } = await import('../src/workers/config');

        // Config should be loaded
        expect(workerConfig).toBeDefined();
        expect(typeof workerConfig.enabled).toBe('boolean');
        expect(typeof workerConfig.poolSize).toBe('number');
        expect(workerConfig.poolSize).toBeGreaterThan(0);
    });

    it('should return correct pool sizes per flow', async () => {
        const { getPoolSize, workerConfig } = await import('../src/workers/config');

        // Without specific overrides, all flows should use global poolSize
        expect(getPoolSize('ingest')).toBe(workerConfig.ingestPoolSize ?? workerConfig.poolSize);
        expect(getPoolSize('conciliacao')).toBe(workerConfig.conciliacaoPoolSize ?? workerConfig.poolSize);
        expect(getPoolSize('estorno')).toBe(workerConfig.estornoPoolSize ?? workerConfig.poolSize);
        expect(getPoolSize('atribuicao')).toBe(workerConfig.atribuicaoPoolSize ?? workerConfig.poolSize);
    });

    it('should return correct thresholds per flow', async () => {
        const { getThreshold, workerConfig } = await import('../src/workers/config');

        expect(getThreshold('ingest')).toBe(workerConfig.ingestThreshold);
        expect(getThreshold('conciliacao')).toBe(workerConfig.conciliacaoThreshold);
        expect(getThreshold('estorno')).toBe(workerConfig.estornoThreshold);
        expect(getThreshold('atribuicao')).toBe(workerConfig.atribuicaoThreshold);
    });

    it('should return correct batch sizes per flow', async () => {
        const { getBatchSize, workerConfig } = await import('../src/workers/config');

        expect(getBatchSize('ingest')).toBe(workerConfig.ingestBatchSize);
        expect(getBatchSize('conciliacao')).toBe(workerConfig.conciliacaoBatchSize);
        expect(getBatchSize('estorno')).toBe(workerConfig.estornoBatchSize);
        expect(getBatchSize('atribuicao')).toBe(workerConfig.atribuicaoBatchSize);
    });

    it('should split arrays into batches correctly', async () => {
        const { splitIntoBatches } = await import('../src/workers/config');

        const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

        const batches3 = splitIntoBatches(items, 3);
        expect(batches3).toHaveLength(4);
        expect(batches3[0]).toEqual([1, 2, 3]);
        expect(batches3[1]).toEqual([4, 5, 6]);
        expect(batches3[2]).toEqual([7, 8, 9]);
        expect(batches3[3]).toEqual([10]);

        const batches5 = splitIntoBatches(items, 5);
        expect(batches5).toHaveLength(2);
        expect(batches5[0]).toEqual([1, 2, 3, 4, 5]);
        expect(batches5[1]).toEqual([6, 7, 8, 9, 10]);

        // Edge cases
        const emptyBatches = splitIntoBatches([], 3);
        expect(emptyBatches).toHaveLength(0);

        const singleBatch = splitIntoBatches([1], 10);
        expect(singleBatch).toHaveLength(1);
        expect(singleBatch[0]).toEqual([1]);
    });

    it('should correctly determine when to use workers', async () => {
        const { shouldUseWorkers, workerConfig } = await import('../src/workers/config');

        if (workerConfig.enabled) {
            // Below threshold - don't use workers
            expect(shouldUseWorkers(500, 1000)).toBe(false);

            // At threshold - use workers
            expect(shouldUseWorkers(1000, 1000)).toBe(true);

            // Above threshold - use workers
            expect(shouldUseWorkers(5000, 1000)).toBe(true);
        } else {
            // Workers disabled - never use
            expect(shouldUseWorkers(5000, 1000)).toBe(false);
        }
    });
});
