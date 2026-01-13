/**
 * Row Parser Worker
 * 
 * Worker para processamento paralelo de parsing de linhas durante a ingestão.
 * Responsável por converter arrays de células em objetos tipados para inserção no SQLite.
 * 
 * Operações:
 * - parseRows: Converte batch de linhas brutas em objetos para DB
 * - buildSql: Gera SQL de INSERT otimizado
 */

import { parentPort, workerData } from 'worker_threads';
import {
    WorkerMessage,
    RowParserInput,
    RowParserOutput,
    SqlBuilderInput,
    SqlBuilderOutput,
    ColumnDef,
    ColumnType
} from '../pool/types';

const LOG_PREFIX = `[RowParserWorker:${workerData?.workerId ?? '?'}]`;

// ============================================================================
// Parsing Logic (migrado de ExcelIngestService)
// ============================================================================

/**
 * Converte um array de valores de célula em um objeto para inserção no DB.
 * Replica a lógica de buildRowObject do ExcelIngestService.
 */
function buildRowObject(
    rowArr: unknown[],
    columns: ColumnDef[],
    colTypes: ColumnType[]
): { rowObj: Record<string, unknown>; allEmpty: boolean } {
    const obj: Record<string, unknown> = {};
    let allEmpty = true;

    columns.forEach((c, idx) => {
        const raw = rowArr ? rowArr[idx] : undefined;
        // Extract the original string representation if available (__num__ from JSONL)
        const valRaw = raw && typeof raw === 'object' && (raw as any).__num__
            ? (raw as any).__num__
            : raw;
        let v: unknown = valRaw === undefined ? null : valRaw;
        if (v === '') v = null;
        if (v !== null && v !== undefined) allEmpty = false;

        const t = colTypes[idx];
        if (v != null && t === 'real') {
            // Parse as number
            if (typeof v === 'string') {
                const trimmed = v.trim();
                // Replace comma with dot for decimal parsing (Excel uses comma in pt-BR locale)
                const normalized = trimmed.replace(',', '.');
                const numVal = parseFloat(normalized);
                if (Number.isNaN(numVal)) {
                    v = null;
                } else {
                    v = numVal;
                }
            } else if (typeof v === 'number') {
                // Already a number, keep as is
            } else {
                const numVal = Number(v);
                if (Number.isNaN(numVal)) v = null;
                else v = numVal;
            }
        }
        obj[c.name] = v;
    });

    return { rowObj: obj, allEmpty };
}

/**
 * Processa um batch de linhas e retorna objetos parseados
 */
function parseRows(input: RowParserInput): RowParserOutput {
    const { rows, columns, colTypes, startIndex } = input;
    const parsedRows: Record<string, unknown>[] = [];
    const emptyRowIndices: number[] = [];

    for (let i = 0; i < rows.length; i++) {
        const rowArr = rows[i];
        const { rowObj, allEmpty } = buildRowObject(rowArr, columns, colTypes);

        if (allEmpty) {
            emptyRowIndices.push(startIndex + i);
        } else {
            parsedRows.push(rowObj);
        }
    }

    return { parsedRows, emptyRowIndices };
}

// ============================================================================
// SQL Builder Logic
// ============================================================================

/**
 * Escapa valor para SQL
 */
function escapeSqlValue(val: unknown): string {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'number') {
        if (Number.isNaN(val) || !Number.isFinite(val)) return 'NULL';
        if (Number.isInteger(val)) {
            return `CAST(${val} AS INTEGER)`;
        }
        // Use precision that avoids floating point artifacts
        return val.toPrecision(15).replace(/\.?0+$/, '');
    }
    if (typeof val === 'string') {
        return `'${val.replace(/'/g, "''")}'`;
    }
    return `'${String(val).replace(/'/g, "''")}'`;
}

/**
 * Gera SQL de INSERT em batch
 */
function buildBulkInsertSql(input: SqlBuilderInput): SqlBuilderOutput {
    const { tableName, rows, columns } = input;

    if (rows.length === 0) {
        return { sql: '', rowCount: 0 };
    }

    const valueSets = rows.map(row => {
        const values = columns.map(col => escapeSqlValue(row[col]));
        return `(${values.join(', ')})`;
    }).join(', ');

    const colNames = columns.map(c => `\`${c}\``).join(', ');
    const sql = `INSERT INTO \`${tableName}\` (${colNames}) VALUES ${valueSets}`;

    return { sql, rowCount: rows.length };
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
            case 'parseRows':
                result = parseRows(data as RowParserInput);
                break;
            case 'buildSql':
                result = buildBulkInsertSql(data as SqlBuilderInput);
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
