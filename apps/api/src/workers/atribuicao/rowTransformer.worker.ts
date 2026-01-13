/**
 * Row Transformer Worker
 * 
 * Worker para processamento paralelo de transformação de linhas na atribuição.
 * Responsável por construir resultRows com colunas importadas, normalização e CHAVE_n.
 * 
 * Operações:
 * - transformRows: Transforma matches em inserts para a tabela de resultado
 */

import { parentPort, workerData } from 'worker_threads';
import {
    WorkerMessage,
    RowTransformInput,
    RowTransformOutput
} from '../pool/types';

const LOG_PREFIX = `[RowTransformerWorker:${workerData?.workerId ?? '?'}]`;

// ============================================================================
// Helper Functions (migradas de atribuicaoRunner)
// ============================================================================

/**
 * Empty values as per business rules: NULL, '', 'NULL', '0', '0.00'
 */
function isEmptyValue(val: unknown): boolean {
    if (val === null || val === undefined) return true;
    const str = String(val).trim();
    return str === '' || str.toLowerCase() === 'null' || str === '0' || str === '0.00';
}

/**
 * Normalize import value
 */
function normalizeImportValue(val: unknown): string {
    if (isEmptyValue(val)) return 'NULL';
    return String(val).trim();
}

/**
 * Normalize a value for key comparison.
 * - Numbers are converted to text preserving their exact representation (no rounding)
 * - NULL/empty values become empty string for consistent concatenation
 * - Trims whitespace
 */
function normalizeKeyValue(val: unknown): string {
    if (val === null || val === undefined) return '';
    const str = String(val).trim();
    if (str.toLowerCase() === 'null') return '';
    return str;
}

// ============================================================================
// Transform Logic
// ============================================================================

function transformRows(input: RowTransformInput): RowTransformOutput {
    const {
        matches,
        destRows: destRowsArr,
        origRows: origRowsArr,
        selectedColumns,
        modeWrite,
        keyConfigs,
        chaveColumnNames,
        destinoCols,
        reservedCols,
        resultColsLower
    } = input;

    // Convert arrays to Maps
    const destRows = new Map<number, Record<string, unknown>>(destRowsArr);
    const origRows = new Map<number, Record<string, unknown>>(origRowsArr);

    const reservedColsSet = new Set(reservedCols.map(c => c.toLowerCase()));
    const resultColsLowerSet = new Set(resultColsLower);

    const inserts: Record<string, unknown>[] = [];
    const matchedDestIds: number[] = [];
    const originalBaseUpdates: Array<{ destId: number; updateData: Record<string, unknown> }> = [];

    for (const match of matches) {
        const destId = match.dest_id;
        const origId = match.orig_id;

        const destRow = destRows.get(destId);
        const origRow = origRows.get(origId);

        if (!destRow || !origRow) continue;

        // Build case-insensitive lookup for destRow
        const destRowLookup: Record<string, unknown> = {};
        for (const k of Object.keys(destRow)) {
            destRowLookup[k.toLowerCase()] = destRow[k];
        }

        // Build result row
        const resultRow: Record<string, unknown> = {};

        // Copy destination columns (skip reserved names)
        for (const col of destinoCols) {
            const colLower = col.toLowerCase();
            if (reservedColsSet.has(colLower)) continue;
            resultRow[col] = destRow[col];
        }

        // Apply imported columns based on write mode
        for (const col of selectedColumns) {
            const origValue = origRow[col];
            const destValue = destRow[col];

            if (modeWrite === 'ONLY_EMPTY') {
                if (isEmptyValue(destValue)) {
                    resultRow[col] = normalizeImportValue(origValue);
                } else {
                    resultRow[col] = destValue;
                }
            } else {
                // OVERWRITE mode
                resultRow[col] = normalizeImportValue(origValue);
            }
        }

        // Populate CHAVE_1..CHAVE_N columns
        for (let kIdx = 0; kIdx < keyConfigs.length; kIdx++) {
            const kc = keyConfigs[kIdx];
            const destColsForKey = kc.destinoCols || [];

            const combined = destColsForKey.map(dc => {
                if (!dc) return '';
                const raw = destRow[dc] ?? destRowLookup[String(dc).toLowerCase()];
                return normalizeKeyValue(raw);
            }).join('_');

            const chaveCol = chaveColumnNames[kIdx] || `CHAVE_${kIdx + 1}`;
            resultRow[chaveCol] = combined || null;
        }

        // Add metadata
        resultRow.dest_row_id = destId;
        resultRow.orig_row_id = origId;
        // matched_key_identifier will be added by the caller

        // Filter resultRow to include only columns that actually exist in the result table
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
        for (const col of selectedColumns) {
            const origValue = origRow[col];
            const destValue = destRow[col];

            if (modeWrite === 'ONLY_EMPTY') {
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

// ============================================================================
// Message Handler
// ============================================================================

function handleMessage(message: WorkerMessage): void {
    if (message.type === 'shutdown') {
        process.exit(0);
    }

    if (message.type !== 'task') return;

    const taskId = message.taskId!;
    const { type, data } = message.data as { type: string; data: unknown };

    try {
        let result: unknown;

        switch (type) {
            case 'transformRows':
                result = transformRows(data as RowTransformInput);
                break;
            default:
                throw new Error(`Unknown task type: ${type}`);
        }

        const response: WorkerMessage = {
            type: 'result',
            taskId,
            data: result
        };
        parentPort?.postMessage(response);
    } catch (error) {
        const response: WorkerMessage = {
            type: 'error',
            taskId,
            error: error instanceof Error ? error.message : String(error)
        };
        parentPort?.postMessage(response);
    }
}

// ============================================================================
// Worker Initialization
// ============================================================================

if (parentPort) {
    parentPort.on('message', handleMessage);

    // Signal ready
    const readyMessage: WorkerMessage = { type: 'ready' };
    parentPort.postMessage(readyMessage);

    console.log(`${LOG_PREFIX} Ready`);
} else {
    console.error(`${LOG_PREFIX} No parentPort - this file must be run as a worker thread`);
    process.exit(1);
}
