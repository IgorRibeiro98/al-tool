/**
 * Conciliacao Worker Helper
 * 
 * Helper para usar o worker pool de conciliação de forma transparente.
 * Permite que o ConciliacaoABStep processe grupos em paralelo.
 */

import { workerPools } from '../WorkerPoolManager';
import {
    GroupProcessorInput,
    GroupProcessorOutput,
    GroupData,
    ResultEntry
} from '../pool/types';
import { cpus } from 'os';

const LOG_PREFIX = '[ConciliacaoWorkerHelper]';

// Threshold para usar workers
const WORKER_THRESHOLD = 500; // grupos

// Tamanho de chunk para dividir grupos entre workers
const CHUNK_SIZE = 200;

/**
 * Verifica se deve usar workers para o volume de grupos
 */
export function shouldUseWorkers(groupCount: number): boolean {
    return groupCount >= WORKER_THRESHOLD && cpus().length > 2;
}

/**
 * Divide array em chunks
 */
function splitIntoChunks<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

/**
 * Processa grupos em paralelo usando workers
 */
export async function processGroupsParallel(
    groups: Map<string, { keyId: string; chaveValor: string | null; aIds: Set<number>; bIds: Set<number> }>,
    aRows: Map<number, Record<string, unknown>>,
    bRows: Map<number, Record<string, unknown>>,
    options: {
        colA?: string;
        colB?: string;
        inverter: boolean;
        limite: number;
        keyIdentifiers: string[];
        chavesContabil: Record<string, string[]>;
        chavesFiscal: Record<string, string[]>;
        allAKeyCols: string[];
        allBKeyCols: string[];
        jobId: number;
    }
): Promise<GroupProcessorOutput> {
    const groupArray = Array.from(groups.values());

    // Se volume pequeno, processa direto
    if (!shouldUseWorkers(groupArray.length)) {
        return processGroupsSync(groupArray, aRows, bRows, options);
    }

    try {
        const pool = await workerPools.getConciliacaoPool();
        const numWorkers = pool.size;

        // Divide grupos em chunks
        const chunks = splitIntoChunks(groupArray, Math.ceil(groupArray.length / numWorkers));

        console.log(`${LOG_PREFIX} Processing ${groupArray.length} groups in ${chunks.length} chunks using ${numWorkers} workers`);

        // Converte Maps para arrays serializáveis
        const aRowsArray = Array.from(aRows.entries()) as [number, Record<string, unknown>][];
        const bRowsArray = Array.from(bRows.entries()) as [number, Record<string, unknown>][];

        // Processa chunks em paralelo
        const results = await Promise.all(
            chunks.map(chunk => {
                // Converte GroupData para formato serializável
                const serializedGroups: GroupData[] = chunk.map(g => ({
                    keyId: g.keyId,
                    chaveValor: g.chaveValor,
                    aIds: Array.from(g.aIds),
                    bIds: Array.from(g.bIds)
                }));

                return pool.exec<GroupProcessorInput, GroupProcessorOutput>('processGroups', {
                    groups: serializedGroups,
                    aRows: aRowsArray,
                    bRows: bRowsArray,
                    colA: options.colA,
                    colB: options.colB,
                    inverter: options.inverter,
                    limite: options.limite,
                    keyIdentifiers: options.keyIdentifiers,
                    chavesContabil: options.chavesContabil,
                    chavesFiscal: options.chavesFiscal,
                    allAKeyCols: options.allAKeyCols,
                    allBKeyCols: options.allBKeyCols,
                    jobId: options.jobId
                });
            })
        );

        // Combina resultados
        const entries: ResultEntry[] = [];
        const matchedAIds: number[] = [];
        const matchedBIds: number[] = [];

        for (const result of results) {
            entries.push(...result.entries);
            matchedAIds.push(...result.matchedAIds);
            matchedBIds.push(...result.matchedBIds);
        }

        return { entries, matchedAIds, matchedBIds };
    } catch (error) {
        console.warn(`${LOG_PREFIX} Worker processing failed, falling back to sync:`, error);
        return processGroupsSync(groupArray, aRows, bRows, options);
    }
}

/**
 * Versão síncrona do processamento de grupos (fallback)
 */
function processGroupsSync(
    groups: Array<{ keyId: string; chaveValor: string | null; aIds: Set<number>; bIds: Set<number> }>,
    aRows: Map<number, Record<string, unknown>>,
    bRows: Map<number, Record<string, unknown>>,
    options: {
        colA?: string;
        colB?: string;
        inverter: boolean;
        limite: number;
        keyIdentifiers: string[];
        chavesContabil: Record<string, string[]>;
        chavesFiscal: Record<string, string[]>;
        allAKeyCols: string[];
        allBKeyCols: string[];
        jobId: number;
    }
): GroupProcessorOutput {
    const EPSILON = 1e-6;
    const STATUS_CONCILIADO = '01_Conciliado';
    const STATUS_FOUND_DIFF = '02_Encontrado c/Diferença';
    const STATUS_NOT_FOUND = '03_Não Encontrado';
    const LABEL_CONCILIADO = 'Conciliado';
    const LABEL_DIFF_IMATERIAL = 'Diferença Imaterial';
    const LABEL_NOT_FOUND = 'Não encontrado';

    const normalizeAmount = (value: number): number => {
        if (value === 0) return 0;
        return Number(Number(value).toFixed(6));
    };

    const buildComposite = (row: Record<string, unknown> | null | undefined, cols?: string[]): string | null => {
        if (!row || !cols || cols.length === 0) return null;
        return cols.map(c => String(row[c] ?? '')).join('_');
    };

    const serializeRowCompact = (row: Record<string, unknown> | null | undefined, keyCols: string[], valueCol?: string): string => {
        if (!row) return '{}';
        const compact: Record<string, unknown> = { id: row.id };
        for (const c of keyCols) {
            if (c && row[c] !== undefined) compact[c] = row[c];
        }
        if (valueCol && row[valueCol] !== undefined) compact[valueCol] = row[valueCol];
        return JSON.stringify(compact);
    };

    const entries: ResultEntry[] = [];
    const matchedAIds: number[] = [];
    const matchedBIds: number[] = [];

    for (const group of groups) {
        const { keyId, aIds, bIds } = group;
        const hasA = aIds.size > 0;
        const hasB = bIds.size > 0;
        if (!hasA && !hasB) continue;

        let somaA = 0;
        let somaB = 0;

        for (const aId of aIds) {
            const row = aRows.get(aId);
            if (!row) continue;
            somaA += options.colA ? Number(row[options.colA]) || 0 : 0;
        }

        for (const bId of bIds) {
            const row = bRows.get(bId);
            if (!row) continue;
            const rawB = options.colB ? Number(row[options.colB]) || 0 : 0;
            somaB += options.inverter ? -rawB : rawB;
        }

        somaA = normalizeAmount(somaA);
        somaB = normalizeAmount(somaB);
        const diffGroup = normalizeAmount(somaA - somaB);
        const absDiff = Math.abs(diffGroup);
        const limiteEfetivo = Math.max(options.limite, EPSILON);

        let status: string;
        let groupLabel: string;

        if (hasA && hasB) {
            if (absDiff <= EPSILON) {
                status = STATUS_CONCILIADO;
                groupLabel = LABEL_CONCILIADO;
            } else if (options.limite > 0 && absDiff <= limiteEfetivo) {
                status = STATUS_FOUND_DIFF;
                groupLabel = LABEL_DIFF_IMATERIAL;
            } else if (diffGroup > 0) {
                status = STATUS_FOUND_DIFF;
                groupLabel = 'Encontrado com diferença, BASE A MAIOR';
            } else {
                status = STATUS_FOUND_DIFF;
                groupLabel = 'Encontrado com diferença, BASE B MAIOR';
            }
        } else {
            status = STATUS_NOT_FOUND;
            groupLabel = LABEL_NOT_FOUND;
        }

        // Create entries for A
        for (const aId of aIds) {
            const row = aRows.get(aId);
            if (!row) continue;

            const entry: ResultEntry = {
                job_id: options.jobId,
                chave: keyId,
                status,
                grupo: groupLabel,
                a_row_id: aId,
                b_row_id: null,
                a_values: serializeRowCompact(row, options.allAKeyCols, options.colA),
                b_values: null,
                value_a: somaA,
                value_b: somaB,
                difference: diffGroup
            };

            for (const kid of options.keyIdentifiers) {
                entry[kid] = buildComposite(row, options.chavesContabil[kid]);
            }

            entries.push(entry);
            matchedAIds.push(aId);
        }

        // Create entries for B
        for (const bId of bIds) {
            const row = bRows.get(bId);
            if (!row) continue;

            const entry: ResultEntry = {
                job_id: options.jobId,
                chave: keyId,
                status,
                grupo: groupLabel,
                a_row_id: null,
                b_row_id: bId,
                a_values: null,
                b_values: serializeRowCompact(row, options.allBKeyCols, options.colB),
                value_a: somaA,
                value_b: somaB,
                difference: diffGroup
            };

            for (const kid of options.keyIdentifiers) {
                entry[kid] = buildComposite(row, options.chavesFiscal[kid]);
            }

            entries.push(entry);
            matchedBIds.push(bId);
        }
    }

    return { entries, matchedAIds, matchedBIds };
}
