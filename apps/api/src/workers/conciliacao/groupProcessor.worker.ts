/**
 * Group Processor Worker
 * 
 * Worker para processamento paralelo de grupos na conciliação A×B.
 * Responsável por calcular somas, diferenças e classificar grupos.
 * 
 * Operações:
 * - processGroups: Processa batch de grupos e retorna ResultEntries
 */

import { parentPort, workerData } from 'worker_threads';
import {
    WorkerMessage,
    GroupProcessorInput,
    GroupProcessorOutput,
    GroupData,
    ResultEntry
} from '../pool/types';

const LOG_PREFIX = `[GroupProcessorWorker:${workerData?.workerId ?? '?'}]`;

// ============================================================================
// Constants (copiados de ConciliacaoABStep)
// ============================================================================

const EPSILON = 1e-6;
const STATUS_CONCILIADO = '01_Conciliado';
const STATUS_FOUND_DIFF = '02_Encontrado c/Diferença';
const STATUS_NOT_FOUND = '03_Não Encontrado';
const LABEL_CONCILIADO = 'Conciliado';
const LABEL_DIFF_IMATERIAL = 'Diferença Imaterial';
const LABEL_NOT_FOUND = 'Não encontrado';

// ============================================================================
// Helper Functions
// ============================================================================

function normalizeAmount(value: number): number {
    if (value === 0) return 0;
    return Number(Number(value).toFixed(6));
}

function buildComposite(row: Record<string, unknown> | null | undefined, cols?: string[]): string | null {
    if (!row || !cols || cols.length === 0) return null;
    return cols.map(c => String(row[c] ?? '')).join('_');
}

function serializeRowCompact(
    row: Record<string, unknown> | null | undefined,
    keyCols: string[],
    valueCol?: string
): string {
    if (!row) return '{}';
    const compact: Record<string, unknown> = { id: row.id };
    for (const c of keyCols) {
        if (c && row[c] !== undefined) compact[c] = row[c];
    }
    if (valueCol && row[valueCol] !== undefined) compact[valueCol] = row[valueCol];
    return JSON.stringify(compact);
}

// ============================================================================
// Main Processing Logic
// ============================================================================

function processGroups(input: GroupProcessorInput): GroupProcessorOutput {
    const {
        groups,
        aRows: aRowsInput,
        bRows: bRowsInput,
        colA,
        colB,
        inverter,
        limite,
        keyIdentifiers,
        chavesContabil,
        chavesFiscal,
        allAKeyCols,
        allBKeyCols,
        jobId
    } = input;

    // Convert arrays to Maps if needed (for serialization compatibility)
    const aRows: Map<number, Record<string, unknown>> = Array.isArray(aRowsInput)
        ? new Map(aRowsInput as [number, Record<string, unknown>][])
        : aRowsInput as Map<number, Record<string, unknown>>;

    const bRows: Map<number, Record<string, unknown>> = Array.isArray(bRowsInput)
        ? new Map(bRowsInput as [number, Record<string, unknown>][])
        : bRowsInput as Map<number, Record<string, unknown>>;

    const entries: ResultEntry[] = [];
    const matchedAIds: number[] = [];
    const matchedBIds: number[] = [];

    for (const group of groups) {
        const { keyId, aIds, bIds } = group;
        const hasA = aIds.length > 0;
        const hasB = bIds.length > 0;
        if (!hasA && !hasB) continue;

        let somaA = 0;
        let somaB = 0;

        // Calculate sum A
        for (const aId of aIds) {
            const row = aRows.get(aId);
            if (!row) continue;
            const valueA = colA ? Number(row[colA]) || 0 : 0;
            somaA += valueA;
        }

        // Calculate sum B
        for (const bId of bIds) {
            const row = bRows.get(bId);
            if (!row) continue;
            const rawB = colB ? Number(row[colB]) || 0 : 0;
            const valueB = inverter ? -rawB : rawB;
            somaB += valueB;
        }

        somaA = normalizeAmount(somaA);
        somaB = normalizeAmount(somaB);
        const diffGroup = normalizeAmount(somaA - somaB);
        const absDiff = Math.abs(diffGroup);
        const limiteEfetivo = Math.max(limite, EPSILON);

        let status: string;
        let groupLabel: string;

        if (hasA && hasB) {
            if (absDiff <= EPSILON) {
                status = STATUS_CONCILIADO;
                groupLabel = LABEL_CONCILIADO;
            } else if (limite > 0 && absDiff <= limiteEfetivo) {
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
                job_id: jobId,
                chave: keyId,
                status,
                grupo: groupLabel,
                a_row_id: aId,
                b_row_id: null,
                a_values: serializeRowCompact(row, allAKeyCols, colA),
                b_values: null,
                value_a: somaA,
                value_b: somaB,
                difference: diffGroup
            };

            for (const kid of keyIdentifiers) {
                entry[kid] = buildComposite(row, chavesContabil[kid]);
            }

            entries.push(entry);
            matchedAIds.push(aId);
        }

        // Create entries for B
        for (const bId of bIds) {
            const row = bRows.get(bId);
            if (!row) continue;

            const entry: ResultEntry = {
                job_id: jobId,
                chave: keyId,
                status,
                grupo: groupLabel,
                a_row_id: null,
                b_row_id: bId,
                a_values: null,
                b_values: serializeRowCompact(row, allBKeyCols, colB),
                value_a: somaA,
                value_b: somaB,
                difference: diffGroup
            };

            for (const kid of keyIdentifiers) {
                entry[kid] = buildComposite(row, chavesFiscal[kid]);
            }

            entries.push(entry);
            matchedBIds.push(bId);
        }
    }

    return { entries, matchedAIds, matchedBIds };
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
            case 'processGroups':
                result = processGroups(data as GroupProcessorInput);
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
