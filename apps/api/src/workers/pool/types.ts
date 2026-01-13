/**
 * Worker Pool Types
 * 
 * Tipos compartilhados entre o Worker Pool e os workers individuais.
 * Segue os princípios de código limpo e modular conforme diretrizes do projeto.
 */

import { Knex } from 'knex';

// ============================================================================
// Core Worker Pool Types
// ============================================================================

export interface WorkerPoolOptions {
    /** Número de workers no pool (padrão: cpus - 1) */
    poolSize?: number;
    /** Timeout para tarefas em ms (padrão: 300000 = 5 min) */
    taskTimeout?: number;
    /** Nome do pool para logs */
    name?: string;
}

export interface WorkerTask<TInput = unknown, TOutput = unknown> {
    id: string;
    type: string;
    data: TInput;
    resolve: (result: TOutput) => void;
    reject: (error: Error) => void;
    startTime: number;
}

export interface WorkerMessage<T = unknown> {
    type: 'task' | 'result' | 'error' | 'ready' | 'shutdown';
    taskId?: string;
    data?: T;
    error?: string;
}

export interface WorkerStats {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    avgProcessingTime: number;
    activeWorkers: number;
    queuedTasks: number;
}

// ============================================================================
// Ingest Worker Types
// ============================================================================

export interface RowParserInput {
    rows: unknown[][];
    columns: ColumnDef[];
    colTypes: ColumnType[];
    startIndex: number;
}

export interface RowParserOutput {
    parsedRows: Record<string, unknown>[];
    emptyRowIndices: number[];
}

export interface ColumnDef {
    name: string;
    original: unknown;
    idxAbs?: number;
}

export type ColumnType = 'real' | 'text';

export interface SqlBuilderInput {
    tableName: string;
    rows: Record<string, unknown>[];
    columns: string[];
}

export interface SqlBuilderOutput {
    sql: string;
    rowCount: number;
}

// ============================================================================
// Conciliacao Worker Types
// ============================================================================

export interface GroupData {
    keyId: string;
    chaveValor: string | null;
    aIds: number[];
    bIds: number[];
}

export interface GroupProcessorInput {
    groups: GroupData[];
    aRows: Map<number, Record<string, unknown>> | [number, Record<string, unknown>][];
    bRows: Map<number, Record<string, unknown>> | [number, Record<string, unknown>][];
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

export interface GroupProcessorOutput {
    entries: ResultEntry[];
    matchedAIds: number[];
    matchedBIds: number[];
}

export interface ResultEntry {
    job_id: number;
    chave: string | null;
    status: string | null | undefined;
    grupo: string | null | undefined;
    a_row_id: number | null;
    b_row_id: number | null;
    a_values: string | null;
    b_values: string | null;
    value_a: number;
    value_b: number;
    difference: number;
    [key: string]: unknown;
}

// ============================================================================
// Estorno Worker Types
// ============================================================================

export interface EstornoMatchInput {
    listA: EstornoIndexEntry[];
    listB: EstornoIndexEntry[];
    limiteZero: number;
}

export interface EstornoIndexEntry {
    id: number;
    soma: number;
    paired: boolean;
}

export interface EstornoMatchOutput {
    pairs: Array<{ aId: number; bId: number }>;
    pairedAIds: number[];
    pairedBIds: number[];
}

// ============================================================================
// Atribuicao Worker Types
// ============================================================================

export interface RowTransformInput {
    matches: Array<{ dest_id: number; orig_id: number }>;
    destRows: [number, Record<string, unknown>][];
    origRows: [number, Record<string, unknown>][];
    selectedColumns: string[];
    modeWrite: 'OVERWRITE' | 'ONLY_EMPTY';
    keyConfigs: KeyConfig[];
    chaveColumnNames: string[];
    destinoCols: string[];
    reservedCols: string[];
    resultColsLower: string[];
}

export interface KeyConfig {
    keyIdentifier: string;
    origemCols: string[];
    destinoCols: string[];
}

export interface RowTransformOutput {
    inserts: Record<string, unknown>[];
    matchedDestIds: number[];
    originalBaseUpdates: Array<{ destId: number; updateData: Record<string, unknown> }>;
}

// ============================================================================
// Conversion Worker Types (xlsx_to_jsonl)
// ============================================================================

export interface CellNormalizerInput {
    cells: unknown[];
}

export interface CellNormalizerOutput {
    normalized: unknown[];
}
