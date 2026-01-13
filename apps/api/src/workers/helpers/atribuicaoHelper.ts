/**
 * Atribuicao Worker Helper
 * 
 * Helper para usar o worker pool de atribuição de forma transparente.
 * Permite que o atribuicaoRunner processe transformações de linha em paralelo.
 */

import { workerPools } from '../WorkerPoolManager';
import {
    RowTransformInput,
    RowTransformOutput,
    KeyConfig
} from '../pool/types';
import { cpus } from 'os';

const LOG_PREFIX = '[AtribuicaoWorkerHelper]';

// Threshold para usar workers
const WORKER_THRESHOLD = 100; // matches

// Tamanho de chunk
const CHUNK_SIZE = 200;

/**
 * Verifica se deve usar workers para o volume de matches
 */
export function shouldUseWorkers(matchCount: number): boolean {
    return matchCount >= WORKER_THRESHOLD && cpus().length > 2;
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
 * Transforma matches em rows para inserção, em paralelo
 */
export async function transformRowsParallel(
    matches: Array<{ dest_id: number; orig_id: number }>,
    destRows: Map<number, Record<string, unknown>>,
    origRows: Map<number, Record<string, unknown>>,
    options: {
        selectedColumns: string[];
        modeWrite: 'OVERWRITE' | 'ONLY_EMPTY';
        keyConfigs: KeyConfig[];
        chaveColumnNames: string[];
        destinoCols: string[];
        reservedCols: string[];
        resultColsLower: string[];
    }
): Promise<RowTransformOutput> {
    // Se volume pequeno, processa direto
    if (!shouldUseWorkers(matches.length)) {
        return transformRowsSync(matches, destRows, origRows, options);
    }

    try {
        const pool = await workerPools.getAtribuicaoPool();
        const numWorkers = pool.size;

        // Divide matches em chunks
        const chunks = splitIntoChunks(matches, Math.ceil(matches.length / numWorkers));

        console.log(`${LOG_PREFIX} Processing ${matches.length} matches in ${chunks.length} chunks using ${numWorkers} workers`);

        // Converte Maps para arrays serializáveis
        const destRowsArray = Array.from(destRows.entries()) as [number, Record<string, unknown>][];
        const origRowsArray = Array.from(origRows.entries()) as [number, Record<string, unknown>][];

        // Processa chunks em paralelo
        const results = await Promise.all(
            chunks.map(chunk =>
                pool.exec<RowTransformInput, RowTransformOutput>('transformRows', {
                    matches: chunk,
                    destRows: destRowsArray,
                    origRows: origRowsArray,
                    selectedColumns: options.selectedColumns,
                    modeWrite: options.modeWrite,
                    keyConfigs: options.keyConfigs,
                    chaveColumnNames: options.chaveColumnNames,
                    destinoCols: options.destinoCols,
                    reservedCols: options.reservedCols,
                    resultColsLower: options.resultColsLower
                })
            )
        );

        // Combina resultados
        const inserts: Record<string, unknown>[] = [];
        const matchedDestIds: number[] = [];
        const originalBaseUpdates: Array<{ destId: number; updateData: Record<string, unknown> }> = [];

        for (const result of results) {
            inserts.push(...result.inserts);
            matchedDestIds.push(...result.matchedDestIds);
            originalBaseUpdates.push(...result.originalBaseUpdates);
        }

        return { inserts, matchedDestIds, originalBaseUpdates };
    } catch (error) {
        console.warn(`${LOG_PREFIX} Worker processing failed, falling back to sync:`, error);
        return transformRowsSync(matches, destRows, origRows, options);
    }
}

/**
 * Versão síncrona da transformação (fallback)
 */
function transformRowsSync(
    matches: Array<{ dest_id: number; orig_id: number }>,
    destRows: Map<number, Record<string, unknown>>,
    origRows: Map<number, Record<string, unknown>>,
    options: {
        selectedColumns: string[];
        modeWrite: 'OVERWRITE' | 'ONLY_EMPTY';
        keyConfigs: KeyConfig[];
        chaveColumnNames: string[];
        destinoCols: string[];
        reservedCols: string[];
        resultColsLower: string[];
    }
): RowTransformOutput {
    const isEmptyValue = (val: unknown): boolean => {
        if (val === null || val === undefined) return true;
        const str = String(val).trim();
        return str === '' || str.toLowerCase() === 'null' || str === '0' || str === '0.00';
    };

    const normalizeImportValue = (val: unknown): string => {
        if (isEmptyValue(val)) return 'NULL';
        return String(val).trim();
    };

    const normalizeKeyValue = (val: unknown): string => {
        if (val === null || val === undefined) return '';
        const str = String(val).trim();
        if (str.toLowerCase() === 'null') return '';
        return str;
    };

    const reservedColsSet = new Set(options.reservedCols.map(c => c.toLowerCase()));
    const resultColsLowerSet = new Set(options.resultColsLower);

    const inserts: Record<string, unknown>[] = [];
    const matchedDestIds: number[] = [];
    const originalBaseUpdates: Array<{ destId: number; updateData: Record<string, unknown> }> = [];

    for (const match of matches) {
        const destId = match.dest_id;
        const origId = match.orig_id;

        const destRow = destRows.get(destId);
        const origRow = origRows.get(origId);

        if (!destRow || !origRow) continue;

        // Build case-insensitive lookup
        const destRowLookup: Record<string, unknown> = {};
        for (const k of Object.keys(destRow)) {
            destRowLookup[k.toLowerCase()] = destRow[k];
        }

        // Build result row
        const resultRow: Record<string, unknown> = {};

        // Copy destination columns
        for (const col of options.destinoCols) {
            const colLower = col.toLowerCase();
            if (reservedColsSet.has(colLower)) continue;
            resultRow[col] = destRow[col];
        }

        // Apply imported columns
        for (const col of options.selectedColumns) {
            const origValue = origRow[col];
            const destValue = destRow[col];

            if (options.modeWrite === 'ONLY_EMPTY') {
                if (isEmptyValue(destValue)) {
                    resultRow[col] = normalizeImportValue(origValue);
                } else {
                    resultRow[col] = destValue;
                }
            } else {
                resultRow[col] = normalizeImportValue(origValue);
            }
        }

        // Populate CHAVE_n columns
        for (let kIdx = 0; kIdx < options.keyConfigs.length; kIdx++) {
            const kc = options.keyConfigs[kIdx];
            const destColsForKey = kc.destinoCols || [];

            const combined = destColsForKey.map(dc => {
                if (!dc) return '';
                const raw = destRow[dc] ?? destRowLookup[String(dc).toLowerCase()];
                return normalizeKeyValue(raw);
            }).join('_');

            const chaveCol = options.chaveColumnNames[kIdx] || `CHAVE_${kIdx + 1}`;
            resultRow[chaveCol] = combined || null;
        }

        // Add metadata
        resultRow.dest_row_id = destId;
        resultRow.orig_row_id = origId;

        // Filter to existing columns
        const finalRow: Record<string, unknown> = {};
        for (const k of Object.keys(resultRow)) {
            if (resultColsLowerSet.has(k.toLowerCase())) {
                finalRow[k] = resultRow[k];
            }
        }
        inserts.push(finalRow);
        matchedDestIds.push(destId);

        // Prepare update for original base
        const updateData: Record<string, unknown> = {};
        for (const col of options.selectedColumns) {
            const origValue = origRow[col];
            const destValue = destRow[col];

            if (options.modeWrite === 'ONLY_EMPTY') {
                if (isEmptyValue(destValue)) {
                    updateData[col] = normalizeImportValue(origValue);
                }
            } else {
                updateData[col] = normalizeImportValue(origValue);
            }
        }

        if (Object.keys(updateData).length > 0) {
            originalBaseUpdates.push({ destId, updateData });
        }
    }

    return { inserts, matchedDestIds, originalBaseUpdates };
}
