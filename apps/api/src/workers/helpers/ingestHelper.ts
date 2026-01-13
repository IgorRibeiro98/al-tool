/**
 * Ingest Worker Helper
 * 
 * Helper para usar o worker pool de ingestão de forma transparente.
 * Permite que o ExcelIngestService use processamento paralelo sem mudanças significativas.
 */

import { workerPools } from '../WorkerPoolManager';
import {
    RowParserInput,
    RowParserOutput,
    SqlBuilderInput,
    SqlBuilderOutput,
    ColumnDef,
    ColumnType
} from '../pool/types';
import { cpus } from 'os';

const LOG_PREFIX = '[IngestWorkerHelper]';

// Threshold para usar workers (linhas)
const WORKER_THRESHOLD = 1000;

// Tamanho de chunk para dividir trabalho entre workers
const CHUNK_SIZE = 2000;

/**
 * Verifica se deve usar workers para o volume de dados
 */
export function shouldUseWorkers(rowCount: number): boolean {
    // Só usa workers se tiver volume suficiente para compensar o overhead
    return rowCount >= WORKER_THRESHOLD && cpus().length > 2;
}

/**
 * Processa linhas em paralelo usando workers
 */
export async function parseRowsParallel(
    rows: unknown[][],
    columns: ColumnDef[],
    colTypes: ColumnType[]
): Promise<RowParserOutput> {
    // Se volume pequeno, processa direto
    if (!shouldUseWorkers(rows.length)) {
        return parseRowsSync(rows, columns, colTypes);
    }

    try {
        const pool = await workerPools.getIngestPool();
        const numWorkers = pool.size;

        // Divide em chunks
        const chunks: Array<{ rows: unknown[][]; startIndex: number }> = [];
        for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
            chunks.push({
                rows: rows.slice(i, i + CHUNK_SIZE),
                startIndex: i
            });
        }

        console.log(`${LOG_PREFIX} Processing ${rows.length} rows in ${chunks.length} chunks using ${numWorkers} workers`);

        // Processa chunks em paralelo
        const results = await Promise.all(
            chunks.map(chunk =>
                pool.exec<RowParserInput, RowParserOutput>('parseRows', {
                    rows: chunk.rows,
                    columns,
                    colTypes,
                    startIndex: chunk.startIndex
                })
            )
        );

        // Combina resultados
        const parsedRows: Record<string, unknown>[] = [];
        const emptyRowIndices: number[] = [];

        for (const result of results) {
            parsedRows.push(...result.parsedRows);
            emptyRowIndices.push(...result.emptyRowIndices);
        }

        return { parsedRows, emptyRowIndices };
    } catch (error) {
        console.warn(`${LOG_PREFIX} Worker processing failed, falling back to sync:`, error);
        return parseRowsSync(rows, columns, colTypes);
    }
}

/**
 * Versão síncrona do parsing (fallback)
 */
function parseRowsSync(
    rows: unknown[][],
    columns: ColumnDef[],
    colTypes: ColumnType[]
): RowParserOutput {
    const parsedRows: Record<string, unknown>[] = [];
    const emptyRowIndices: number[] = [];

    for (let i = 0; i < rows.length; i++) {
        const rowArr = rows[i];
        const obj: Record<string, unknown> = {};
        let allEmpty = true;

        columns.forEach((c, idx) => {
            const raw = rowArr ? rowArr[idx] : undefined;
            const valRaw = raw && typeof raw === 'object' && (raw as any).__num__
                ? (raw as any).__num__
                : raw;
            let v: unknown = valRaw === undefined ? null : valRaw;
            if (v === '') v = null;
            if (v !== null && v !== undefined) allEmpty = false;

            const t = colTypes[idx];
            if (v != null && t === 'real') {
                if (typeof v === 'string') {
                    const normalized = v.trim().replace(',', '.');
                    const numVal = parseFloat(normalized);
                    v = Number.isNaN(numVal) ? null : numVal;
                } else if (typeof v !== 'number') {
                    const numVal = Number(v);
                    v = Number.isNaN(numVal) ? null : numVal;
                }
            }
            obj[c.name] = v;
        });

        if (allEmpty) {
            emptyRowIndices.push(i);
        } else {
            parsedRows.push(obj);
        }
    }

    return { parsedRows, emptyRowIndices };
}

/**
 * Gera SQL de INSERT em paralelo (para batches muito grandes)
 */
export async function buildSqlParallel(
    tableName: string,
    rows: Record<string, unknown>[],
    columns: string[]
): Promise<SqlBuilderOutput> {
    // SQL building é geralmente rápido, só usa worker para volumes grandes
    if (rows.length < 5000) {
        return buildSqlSync(tableName, rows, columns);
    }

    try {
        const pool = await workerPools.getIngestPool();

        return pool.exec<SqlBuilderInput, SqlBuilderOutput>('buildSql', {
            tableName,
            rows,
            columns
        });
    } catch (error) {
        console.warn(`${LOG_PREFIX} Worker SQL building failed, falling back to sync:`, error);
        return buildSqlSync(tableName, rows, columns);
    }
}

/**
 * Versão síncrona do SQL building (fallback)
 */
function buildSqlSync(
    tableName: string,
    rows: Record<string, unknown>[],
    columns: string[]
): SqlBuilderOutput {
    if (rows.length === 0) {
        return { sql: '', rowCount: 0 };
    }

    const escapeSqlValue = (val: unknown): string => {
        if (val === null || val === undefined) return 'NULL';
        if (typeof val === 'number') {
            if (Number.isNaN(val) || !Number.isFinite(val)) return 'NULL';
            if (Number.isInteger(val)) return `CAST(${val} AS INTEGER)`;
            return val.toFixed(20).replace(/\.?0+$/, '');
        }
        if (typeof val === 'string') {
            return `'${val.replace(/'/g, "''")}'`;
        }
        return `'${String(val).replace(/'/g, "''")}'`;
    };

    const valueSets = rows.map(row => {
        const values = columns.map(col => escapeSqlValue(row[col]));
        return `(${values.join(', ')})`;
    }).join(', ');

    const colNames = columns.map(c => `\`${c}\``).join(', ');
    const sql = `INSERT INTO \`${tableName}\` (${colNames}) VALUES ${valueSets}`;

    return { sql, rowCount: rows.length };
}
