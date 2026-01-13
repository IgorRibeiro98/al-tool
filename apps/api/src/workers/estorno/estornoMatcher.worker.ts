/**
 * Estorno Matcher Worker
 * 
 * Worker para processamento paralelo do matching de estornos.
 * Implementa o algoritmo O(n) de matching soma-indexed para encontrar pares A×B que se anulam.
 * 
 * Operações:
 * - matchPairs: Encontra pares de estorno usando lookup soma-indexed
 * - buildIndex: Constrói índice soma → entries (para paralelização futura)
 */

import { parentPort, workerData } from 'worker_threads';
import {
    WorkerMessage,
    EstornoMatchInput,
    EstornoMatchOutput,
    EstornoIndexEntry
} from '../pool/types';

const LOG_PREFIX = `[EstornoMatcherWorker:${workerData?.workerId ?? '?'}]`;

// ============================================================================
// Constants
// ============================================================================

const SOMA_PRECISION = 100; // 2 decimal places for indexing

// ============================================================================
// Matching Logic (migrado de EstornoBaseAStep)
// ============================================================================

/**
 * Round soma to integer key for indexing (handles floating point comparison)
 */
function somaToKey(soma: number): number {
    return Math.round(soma * SOMA_PRECISION);
}

/**
 * O(n) matching algorithm using soma-indexed lookup.
 * For each item in listA, look up items in listB whose soma is approximately -soma.
 */
function matchPairs(input: EstornoMatchInput): EstornoMatchOutput {
    const { listA, listB, limiteZero } = input;
    const pairs: Array<{ aId: number; bId: number }> = [];
    const pairedAIds: number[] = [];
    const pairedBIds: number[] = [];

    // Track which items are paired (mutable copy since we can't modify input)
    const aPaired = new Set<number>();
    const bPaired = new Set<number>();

    // Build index of listB by rounded soma value
    // Map from somaKey -> list of entries with that soma
    const bBySoma = new Map<number, EstornoIndexEntry[]>();
    for (const bItem of listB) {
        const key = somaToKey(bItem.soma);
        let arr = bBySoma.get(key);
        if (!arr) {
            arr = [];
            bBySoma.set(key, arr);
        }
        arr.push(bItem);
    }

    // For each item in A, find matching B items
    // We need to check the target key and neighboring keys due to limiteZero tolerance
    const keyTolerance = Math.ceil(limiteZero * SOMA_PRECISION) + 1;

    for (const aItem of listA) {
        if (aPaired.has(aItem.id)) continue;

        const targetSoma = -aItem.soma;
        const targetKey = somaToKey(targetSoma);

        // Check keys in range [targetKey - keyTolerance, targetKey + keyTolerance]
        let found = false;
        for (let k = targetKey - keyTolerance; k <= targetKey + keyTolerance && !found; k++) {
            const candidates = bBySoma.get(k);
            if (!candidates) continue;

            for (const bItem of candidates) {
                if (bPaired.has(bItem.id)) continue;
                if (aItem.id === bItem.id) continue;

                const sum = aItem.soma + bItem.soma;
                if (Math.abs(sum) <= limiteZero) {
                    aPaired.add(aItem.id);
                    bPaired.add(bItem.id);
                    pairs.push({ aId: aItem.id, bId: bItem.id });
                    pairedAIds.push(aItem.id);
                    pairedBIds.push(bItem.id);
                    found = true;
                    break;
                }
            }
        }
    }

    return { pairs, pairedAIds, pairedBIds };
}

/**
 * Build soma index for a list of entries.
 * Returns a Map serializable as array of tuples.
 */
function buildSomaIndex(entries: EstornoIndexEntry[]): [number, EstornoIndexEntry[]][] {
    const index = new Map<number, EstornoIndexEntry[]>();

    for (const entry of entries) {
        const key = somaToKey(entry.soma);
        let arr = index.get(key);
        if (!arr) {
            arr = [];
            index.set(key, arr);
        }
        arr.push(entry);
    }

    return Array.from(index.entries());
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
            case 'matchPairs':
                result = matchPairs(data as EstornoMatchInput);
                break;
            case 'buildIndex':
                result = buildSomaIndex(data as EstornoIndexEntry[]);
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
