/**
 * Estorno Worker Helper
 * 
 * Helper para usar o worker pool de estorno de forma transparente.
 * Permite que o EstornoBaseAStep use matching paralelo.
 */

import { workerPools } from '../WorkerPoolManager';
import {
    EstornoMatchInput,
    EstornoMatchOutput,
    EstornoIndexEntry
} from '../pool/types';
import { cpus } from 'os';

const LOG_PREFIX = '[EstornoWorkerHelper]';

// Threshold para usar workers
const WORKER_THRESHOLD = 5000; // entries

/**
 * Verifica se deve usar workers para o volume de dados
 */
export function shouldUseWorkers(entryCount: number): boolean {
    return entryCount >= WORKER_THRESHOLD && cpus().length > 2;
}

/**
 * Executa matching de estorno em paralelo
 * 
 * Para volumes muito grandes, divide o trabalho entre workers.
 * Cada worker processa um subset de listA contra o índice completo de listB.
 */
export async function matchPairsParallel(
    listA: EstornoIndexEntry[],
    listB: EstornoIndexEntry[],
    limiteZero: number
): Promise<EstornoMatchOutput> {
    // Se volume pequeno, processa direto
    if (!shouldUseWorkers(listA.length + listB.length)) {
        return matchPairsSync(listA, listB, limiteZero);
    }

    try {
        const pool = await workerPools.getEstornoPool();

        console.log(`${LOG_PREFIX} Processing ${listA.length} + ${listB.length} entries using workers`);

        // Para estorno, o algoritmo depende de estado global (paired flags)
        // Então não podemos facilmente paralelizar. Usamos worker único.
        const result = await pool.exec<EstornoMatchInput, EstornoMatchOutput>('matchPairs', {
            listA,
            listB,
            limiteZero
        });

        return result;
    } catch (error) {
        console.warn(`${LOG_PREFIX} Worker processing failed, falling back to sync:`, error);
        return matchPairsSync(listA, listB, limiteZero);
    }
}

/**
 * Versão síncrona do matching (fallback)
 * Replica a lógica de matchPairsOptimized do EstornoBaseAStep
 */
function matchPairsSync(
    listA: EstornoIndexEntry[],
    listB: EstornoIndexEntry[],
    limiteZero: number
): EstornoMatchOutput {
    const SOMA_PRECISION = 100;

    const somaToKey = (soma: number): number => Math.round(soma * SOMA_PRECISION);

    const pairs: Array<{ aId: number; bId: number }> = [];
    const pairedAIds: number[] = [];
    const pairedBIds: number[] = [];

    const aPaired = new Set<number>();
    const bPaired = new Set<number>();

    // Build index of listB
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

    const keyTolerance = Math.ceil(limiteZero * SOMA_PRECISION) + 1;

    for (const aItem of listA) {
        if (aPaired.has(aItem.id)) continue;

        const targetSoma = -aItem.soma;
        const targetKey = somaToKey(targetSoma);

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
