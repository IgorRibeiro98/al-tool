import path from 'path';
import fs from 'fs/promises';
import ExcelJS from 'exceljs';
import db from '../db/knex';
import baseColumnsService from './baseColumnsService';
import { Knex } from 'knex';

// Constants for sensible defaults - optimized for SQLite WAL mode
// Larger batches significantly reduce transaction overhead
// PERFORMANCE OPTIMIZED: Increased for faster processing on capable machines
const DEFAULT_SAMPLE_ROWS_JSONL = 1000;  // Increased from 500
const DEFAULT_BATCH_SIZE_JSONL = 5000;   // Increased from 2000 - SQLite handles this well with WAL
const DEFAULT_SAMPLE_ROWS_XLSX = 500;    // Increased from 300
const DEFAULT_BATCH_SIZE_XLSX = 3000;    // Increased from 1500 - reduces transaction commits

// Maximum rows per transaction to prevent long locks
// Increased for better throughput on modern SSDs
const MAX_ROWS_PER_TRANSACTION = 100000;  // Increased from 50000

// SQLite has a limit of ~999 SQL variables per statement
// We calculate chunk size dynamically based on column count
const SQLITE_MAX_VARIABLES = 999;

type IngestResult = { tableName: string; rowsInserted: number };

type ColumnDef = { name: string; original: any; idxAbs?: number };

function sanitizeColumnName(name: any, idx: number): string {
    if (!name || String(name).trim() === '') return `col_${idx}`;
    return String(name).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

function extractCellValue(cell: any): any {
    if (!cell) return null;
    const v = cell.value;
    // For numbers, preserve precision by using string representation when available
    // This mimics the __num__ pattern used in JSONL conversion
    if (typeof v === 'number') {
        // Return as object with string representation to preserve precision
        // The buildRowObject function will handle this format
        return { __num__: String(v) };
    }
    if (v instanceof Date) return typeof cell.text === 'string' ? cell.text : v.toISOString();
    if (v && typeof v === 'object' && v.result instanceof Date) return typeof cell.text === 'string' ? cell.text : new Date(v.result).toISOString();
    if (v && typeof v === 'object' && typeof v.result === 'number') {
        // Formula result that is a number - preserve precision
        return { __num__: String(v.result) };
    }
    if (v && typeof v === 'object' && Array.isArray(v.richText)) return v.richText.map((t: any) => t?.text || '').join('');
    if (typeof cell.text === 'string' && cell.text.length > 0) return cell.text;
    return v ?? null;
}

export class ExcelIngestService {
    // Apply PRAGMA optimizations; safe to call inside/outside transactions
    private async applyPragmas(conn: Knex | Knex.Transaction) {
        const env = process.env;
        const envName = env.NODE_ENV || 'production';

        const isTransaction = Boolean((conn as any).isTransaction || (conn as any).client?.isTransaction);

        // PERFORMANCE: No dev/prod distinction - always use optimized values
        // For tests only, use smaller values
        const isTest = envName === 'test';
        // -200000 pages = ~800MB cache (balanced for 8GB RAM machines)
        const defaultCacheSize = isTest ? '-50000' : '-200000';
        const defaultBusyTimeout = isTest ? '4000' : '60000';
        // 512MB mmap for faster I/O during ingest (balanced for 8GB RAM)
        const defaultMmapSize = isTest ? '0' : '536870912';

        const pragmas: Array<{ key: string; value: string | number }> = [];
        if (!isTransaction) pragmas.push({ key: 'journal_mode', value: env.INGEST_PRAGMA_JOURNAL_MODE || env.SQLITE_JOURNAL_MODE || 'WAL' });
        if (!isTransaction) pragmas.push({ key: 'synchronous', value: env.INGEST_PRAGMA_SYNCHRONOUS || env.SQLITE_SYNCHRONOUS || 'NORMAL' });
        if (!isTransaction) pragmas.push({ key: 'temp_store', value: env.INGEST_PRAGMA_TEMP_STORE || env.SQLITE_TEMP_STORE || 'MEMORY' });
        if (!isTransaction) pragmas.push({ key: 'cache_size', value: env.INGEST_PRAGMA_CACHE_SIZE ?? env.SQLITE_CACHE_SIZE ?? defaultCacheSize });
        if (!isTransaction) pragmas.push({ key: 'mmap_size', value: env.INGEST_PRAGMA_MMAP_SIZE || env.SQLITE_MMAP_SIZE || defaultMmapSize });
        pragmas.push({ key: 'busy_timeout', value: env.INGEST_PRAGMA_BUSY_TIMEOUT ?? env.SQLITE_BUSY_TIMEOUT ?? defaultBusyTimeout });
        if (!isTransaction) pragmas.push({ key: 'foreign_keys', value: env.INGEST_PRAGMA_FOREIGN_KEYS ?? env.SQLITE_FOREIGN_KEYS ?? 'ON' });

        for (const p of pragmas) {
            if (!p.value && p.value !== 0) continue;
            try {
                await conn.raw(`PRAGMA ${p.key} = ${p.value}`);
            } catch (e) {
                // Non-fatal: log and continue
                await this.appendIngestLog('PragmaSetFailed', { pragma: p.key, value: p.value, error: e && (e instanceof Error ? (e.stack || e.message) : String(e)) });
            }
        }
    }

    private async analyzeTable(conn: Knex | Knex.Transaction, tableName: string) {
        try {
            await conn.raw(`ANALYZE ${tableName}`);
        } catch (e) {
            await this.appendIngestLog('AnalyzeFailed', { tableName, error: e && (e instanceof Error ? (e.stack || e.message) : String(e)) });
        }
    }

    /**
     * Optimized bulk insert that chunks data to avoid SQLite variable limits
     * Uses raw SQL with proper type casting to preserve INTEGER vs REAL storage
     */
    private async bulkInsert(conn: Knex | Knex.Transaction, tableName: string, rows: Record<string, any>[]): Promise<number> {
        if (!rows.length) return 0;

        let inserted = 0;
        const columns = Object.keys(rows[0]);
        const columnCount = columns.length;
        const safeChunkSize = Math.max(1, Math.floor(SQLITE_MAX_VARIABLES / Math.max(1, columnCount)));

        for (let i = 0; i < rows.length; i += safeChunkSize) {
            const chunk = rows.slice(i, i + safeChunkSize);

            // Build INSERT with explicit CAST for integers, proper formatting for decimals
            const valueSets = chunk.map(row => {
                const values = columns.map(col => {
                    const val = row[col];
                    if (val === null || val === undefined) return 'NULL';
                    if (typeof val === 'number') {
                        // Ensure number is valid
                        if (Number.isNaN(val) || !Number.isFinite(val)) return 'NULL';
                        // If integer, cast to INTEGER to preserve storage class
                        if (Number.isInteger(val)) {
                            return `CAST(${val} AS INTEGER)`;
                        }
                        // For decimals, format with full precision - ensure no scientific notation
                        const strVal = val.toFixed(20).replace(/\.?0+$/, '');
                        return strVal;
                    }
                    if (typeof val === 'string') {
                        // Escape single quotes
                        return `'${val.replace(/'/g, "''")}'`;
                    }
                    // For other types, convert to string and escape
                    return `'${String(val).replace(/'/g, "''")}'`;
                });
                return `(${values.join(', ')})`;
            }).join(', ');

            const colNames = columns.map(c => `\`${c}\``).join(', ');
            const sql = `INSERT INTO \`${tableName}\` (${colNames}) VALUES ${valueSets}`;

            // Log first insert of each batch for debugging
            if (i === 0) {
                await this.appendIngestLog('BulkInsertSQL', {
                    tableName,
                    sqlPreview: sql.substring(0, 500),
                    firstRow: rows[0]
                });
            }

            try {
                await conn.raw(sql);
                inserted += chunk.length;
            } catch (err) {
                await this.appendIngestLog('BulkInsertError', {
                    tableName,
                    error: err instanceof Error ? err.message : String(err),
                    sqlPreview: sql.substring(0, 500),
                    sampleRow: chunk[0]
                });
                throw err;
            }
        }

        return inserted;
    }

    // Automatic monetary detection removed: columns are initialized as non-monetary at ingest time

    private async appendIngestLog(prefix: string, info: any) {
        try {
            const logsDir = path.resolve(__dirname, '..', '..', 'logs');
            await fs.mkdir(logsDir, { recursive: true });
            const file = path.join(logsDir, 'ingest-errors.log');
            await fs.appendFile(file, JSON.stringify({ ts: new Date().toISOString(), prefix, info }) + '\n');
        } catch (e) {
            // Best-effort logging; avoid throwing from logger
            // eslint-disable-next-line no-console
            console.error('appendIngestLog failed', e);
        }
    }

    // Try a set of likely candidate paths and remove the first existing file
    private async tryRemoveFileCandidate(baseId: number, relOrAbs: string) {
        if (!relOrAbs) return false;
        const tried: string[] = [];
        const candidates = path.isAbsolute(relOrAbs)
            ? [relOrAbs]
            : [
                path.resolve(process.cwd(), relOrAbs),
                path.resolve(process.cwd(), '..', relOrAbs),
                path.resolve(process.cwd(), '..', '..', relOrAbs),
                path.resolve(__dirname, '..', '..', relOrAbs),
                path.join(process.cwd(), 'apps', 'api', relOrAbs),
                path.join(process.cwd(), relOrAbs.replace(/^\/+/, ''))
            ];

        for (const c of candidates) {
            if (!c) continue;
            tried.push(c);
            try {
                await fs.stat(c as any);
                await fs.unlink(c as any);
                await this.appendIngestLog('RemovedIngestFile', { baseId, requested: relOrAbs, removedPath: c });
                return true;
            } catch (_) {
                // ignore and continue
            }
        }

        // final attempt: try as provided
        try {
            await fs.stat(relOrAbs as any);
            await fs.unlink(relOrAbs as any);
            await this.appendIngestLog('RemovedIngestFile', { baseId, requested: relOrAbs, removedPath: relOrAbs });
            return true;
        } catch (_) {
            await this.appendIngestLog('IngestCleanupNotFound', { baseId, requested: relOrAbs, tried });
            return false;
        }
    }

    private async performPostIngestCleanup(baseId: number, base: any) {
        try {
            const toRemove = [base?.arquivo_jsonl_path, base?.arquivo_caminho].filter(Boolean) as string[];
            for (const p of toRemove) {
                try {
                    await this.tryRemoveFileCandidate(baseId, p);
                } catch (e) {
                    await this.appendIngestLog('ErrorDeletingIngestFile', { baseId, file: p, error: e && (e instanceof Error ? (e.stack || e.message) : String(e)) });
                }
            }

            try {
                await db('bases').where({ id: baseId }).update({ arquivo_jsonl_path: null, arquivo_caminho: null });
            } catch (e) {
                await this.appendIngestLog('ErrorClearingArquivoPaths', { baseId, error: e && (e instanceof Error ? (e.stack || e.message) : String(e)) });
            }
            // If this base references a model base, attempt to copy monetary flags from the reference
            try {
                const refId = base && (base.reference_base_id || base.reference_base_id === 0 ? Number(base.reference_base_id) : null);
                if (refId && Number.isInteger(refId) && refId > 0) {
                    try {
                        // force override=true so monetary flags from the reference base
                        // overwrite the newly created columns' default value (which is 0)
                        await baseColumnsService.applyMonetaryFlagsFromReference(refId, baseId, { override: true }).catch(async (err) => {
                            await this.appendIngestLog('ApplyMonetaryFlagsFailed', { baseId, reference_base_id: refId, error: err && (err instanceof Error ? (err.stack || err.message) : String(err)) });
                        });
                    } catch (innerErr) {
                        await this.appendIngestLog('ApplyMonetaryFlagsException', { baseId, reference_base_id: refId, error: innerErr && (innerErr instanceof Error ? (innerErr.stack || innerErr.message) : String(innerErr)) });
                    }
                }
            } catch (e) {
                await this.appendIngestLog('ApplyMonetaryFlagsOuterError', { baseId, error: e && (e instanceof Error ? (e.stack || e.message) : String(e)) });
            }
        } catch (e) {
            await this.appendIngestLog('PostIngestCleanupFailed', { baseId, error: e && (e instanceof Error ? (e.stack || e.message) : String(e)) });
        }
    }

    private resolveFilePathFromBase(base: any): { filePath: string; isJsonl: boolean } {
        const jsonlPath = base.arquivo_jsonl_path || null;
        if (jsonlPath) {
            if (path.isAbsolute(jsonlPath)) return { filePath: jsonlPath, isJsonl: true };
            const candidates = [path.resolve(process.cwd(), jsonlPath), path.resolve(process.cwd(), '..', '..', jsonlPath), path.resolve(process.cwd(), '..', jsonlPath)];
            for (const c of candidates) {
                try {
                    // Use synchronous check is unsafe here; prefer to return candidate and let caller access
                    // We'll return first candidate; caller will verify via fs.access
                    return { filePath: c, isJsonl: true };
                } catch (_) {
                    /* continue */
                }
            }
            return { filePath: path.resolve(process.cwd(), jsonlPath), isJsonl: true };
        }

        if (!base.arquivo_caminho) throw new Error('Base has no arquivo_caminho');
        return { filePath: path.isAbsolute(base.arquivo_caminho) ? base.arquivo_caminho : path.resolve(process.cwd(), base.arquivo_caminho), isJsonl: false };
    }

    // Returns 'real' for any numeric column, 'text' otherwise.
    // We intentionally avoid 'integer' type to prevent precision loss when
    // a column starts with integer-like values (e.g., zeros) but later contains decimals.
    private inferColumnTypes(sampleRows: any[][]): ('real' | 'text')[] {
        const columns = (sampleRows[0] || []).length;
        const result: ('real' | 'text')[] = [];
        for (let colIdx = 0; colIdx < columns; colIdx++) {
            let isNumber = true;
            for (const r of sampleRows) {
                let v = r ? r[colIdx] : undefined;
                // Extract value from __num__ wrapper if present
                if (v && typeof v === 'object' && v.__num__ !== undefined) {
                    v = v.__num__;
                }
                if (v === null || v === undefined || v === '') continue;
                const n = Number(v);
                if (Number.isNaN(n)) {
                    isNumber = false;
                    break;
                }
            }
            if (isNumber) result.push('real');
            else result.push('text');
        }
        return result;
    }

    private createSqliteTableFromColumns = async (trx: Knex.Transaction, tableName: string, columns: ColumnDef[], colTypes: ('real' | 'text')[], baseId: number, startColIdx0: number) => {
        const exists = await trx.schema.hasTable(tableName);
        if (exists) throw new Error(`Table ${tableName} already exists`);

        // Build CREATE TABLE with NUMERIC affinity for numbers (preserves integers as integers)
        const columnDefs = columns.map((c, idx) => {
            const colType = colTypes[idx];
            if (colType === 'text') return `\`${c.name}\` TEXT`;
            else return `\`${c.name}\` NUMERIC`;
        }).join(', ');

        const createTableSQL = `
            CREATE TABLE \`${tableName}\` (
                \`id\` INTEGER PRIMARY KEY AUTOINCREMENT,
                ${columnDefs},
                \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `;

        await trx.raw(createTableSQL);

        try {
            const mappings = columns.map((c, idx) => ({ base_id: baseId, col_index: startColIdx0 + idx + 1, excel_name: c.original == null ? null : String(c.original), sqlite_name: c.name, is_monetary: 0 }));
            if (mappings.length > 0) await trx('base_columns').insert(mappings);
        } catch (e) {
            await this.appendIngestLog('ErrorSavingBaseColumns', { baseId, error: e && (e instanceof Error ? (e.stack || e.message) : String(e)) });
        }

        await trx('bases').where({ id: baseId }).update({ tabela_sqlite: tableName });
    };

    // Build row object for DB from raw array and column defs/types
    // For NUMERIC columns in SQLite, we pass integers as integers and decimals as numbers/strings.
    // SQLite's NUMERIC affinity preserves the storage class (INTEGER vs REAL).
    private buildRowObject(rowArr: any[], columns: ColumnDef[], colTypes: ('real' | 'text')[]) {
        const obj: Record<string, any> = {};
        let allEmpty = true;
        columns.forEach((c, idx) => {
            const raw = rowArr ? rowArr[idx] : undefined;
            // Extract the original string representation if available (__num__ from JSONL)
            const valRaw = raw && raw.__num__ ? raw.__num__ : raw;
            let v: any = valRaw === undefined ? null : valRaw;
            if (v === '') v = null;
            if (v !== null && v !== undefined) allEmpty = false;
            const t = colTypes[idx];
            if (v != null && t === 'real') {
                // Parse as number - SQLite NUMERIC will store integers as INTEGER, decimals as REAL
                if (typeof v === 'string') {
                    const trimmed = v.trim();
                    // Replace comma with dot for decimal parsing (Excel uses comma in pt-BR locale)
                    const normalized = trimmed.replace(',', '.');
                    const numVal = parseFloat(normalized);
                    if (Number.isNaN(numVal)) {
                        v = null;
                    } else {
                        // Keep as JavaScript Number - SQLite will handle storage class
                        v = numVal;
                    }
                } else if (typeof v === 'number') {
                    // Already a number, keep as is
                    v = v;
                } else {
                    // Try to convert
                    const numVal = Number(v);
                    if (Number.isNaN(numVal)) v = null;
                    else v = numVal;
                }
            }
            obj[c.name] = v;
        });
        return { rowObj: obj, allEmpty };
    }

    // Process JSONL: infer header from meta or first rows, then insert in chunks
    // Optimized: uses smaller transactions to prevent long locks
    private async ingestFromJsonl(baseId: number, base: any, filePath: string, headerLinhaInicial: number, headerColunaInicial: number): Promise<IngestResult> {
        const rl = (await import('readline')).createInterface({ input: (await import('fs')).createReadStream(filePath, { encoding: 'utf8' }) });
        const SAMPLE_ROWS = Number(process.env.INGEST_SAMPLE_ROWS || DEFAULT_SAMPLE_ROWS_JSONL);
        const BATCH_SIZE = Number(process.env.INGEST_BATCH_SIZE || DEFAULT_BATCH_SIZE_JSONL);
        const startColIdx0 = Math.max(0, headerColunaInicial - 1);

        const tableName = `base_${baseId}`;
        let headerSlice: any[] | null = null;
        const sampleRows: any[][] = [];
        const pendingRowArrays: any[][] = [];
        let columns: ColumnDef[] = [];
        let colTypes: ('real' | 'text')[] = [];
        let tableReady = false;
        let inserted = 0;
        let dataLineIndex = 0;
        let batch: Record<string, any>[] = [];
        let rowsInCurrentTransaction = 0;

        const prepareTable = async () => {
            if (tableReady) return;
            if (!headerSlice || headerSlice.length === 0) return;

            const initialColumns = headerSlice.map((h: any, i: number) => ({ name: sanitizeColumnName(h, startColIdx0 + i), original: h, idxAbs: startColIdx0 + i }));
            const seen: Record<string, number> = {};
            columns = initialColumns.map(col => {
                let baseName = col.name || `col_${col.idxAbs}`;
                if (!baseName || baseName.toString().trim() === '') baseName = `col_${col.idxAbs}`;
                if (!seen[baseName]) { seen[baseName] = 1; return { name: baseName, original: col.original, idxAbs: col.idxAbs }; }
                seen[baseName] += 1;
                return { name: `${baseName}_${seen[baseName]}`, original: col.original, idxAbs: col.idxAbs };
            });

            colTypes = this.inferColumnTypes(sampleRows);

            // Create table in its own transaction (quick)
            await db.transaction(async trx => {
                await this.applyPragmas(trx);
                await this.createSqliteTableFromColumns(trx, tableName, columns, colTypes, baseId, startColIdx0);
            });
            tableReady = true;
        };

        const flushBatch = async () => {
            if (batch.length === 0) return;

            // Use chunked bulk insert in a transaction
            await db.transaction(async trx => {
                inserted += await this.bulkInsert(trx, tableName, batch);
            });

            rowsInCurrentTransaction = 0;
            batch = [];
        };

        // First pass: collect sample rows and determine schema
        for await (const line of rl) {
            if (!line || !line.trim()) continue;
            const parsed = JSON.parse(line);
            if (parsed && parsed.meta && !headerSlice) {
                headerSlice = parsed.meta.headers || null;
                continue;
            }
            if (!headerSlice) {
                dataLineIndex += 1;
                if (dataLineIndex < headerLinhaInicial) continue;
                headerSlice = Array.isArray(parsed) ? parsed.slice(headerColunaInicial - 1) : Object.keys(parsed).slice(headerColunaInicial - 1);
                continue;
            }

            dataLineIndex += 1;
            if (dataLineIndex <= headerLinhaInicial) continue; // header row itself

            const rowArr = Array.isArray(parsed) ? parsed.slice(startColIdx0) : Object.values(parsed).slice(startColIdx0);
            const normalizedRowArr = rowArr.map(v => (v && v.__num__ ? v.__num__ : v));

            if (!tableReady) {
                sampleRows.push(normalizedRowArr);
                pendingRowArrays.push(normalizedRowArr);
                if (sampleRows.length >= SAMPLE_ROWS) {
                    await prepareTable();
                    // Process pending rows
                    for (const arr of pendingRowArrays) {
                        const { rowObj, allEmpty } = this.buildRowObject(arr, columns, colTypes);
                        if (!allEmpty) {
                            batch.push(rowObj);
                            rowsInCurrentTransaction++;
                        }
                    }
                    pendingRowArrays.length = 0;

                    // Flush if batch is large
                    if (batch.length >= BATCH_SIZE) {
                        await flushBatch();
                    }
                }
                continue;
            }

            const { rowObj, allEmpty } = this.buildRowObject(normalizedRowArr, columns, colTypes);
            if (!allEmpty) {
                batch.push(rowObj);
                rowsInCurrentTransaction++;

                // Flush when batch is full or transaction is too large
                if (batch.length >= BATCH_SIZE || rowsInCurrentTransaction >= MAX_ROWS_PER_TRANSACTION) {
                    await flushBatch();
                }
            }
        }

        // Handle case where we never reached SAMPLE_ROWS
        if (!tableReady && (headerSlice || pendingRowArrays.length > 0)) {
            await prepareTable();
            for (const arr of pendingRowArrays) {
                const { rowObj, allEmpty } = this.buildRowObject(arr, columns, colTypes);
                if (!allEmpty) batch.push(rowObj);
            }
        }

        // Final flush
        await flushBatch();

        try { const idxHelpers = await import('../db/indexHelpers'); await idxHelpers.ensureIndicesForBaseFromConfigs(baseId); } catch (e: any) { await this.appendIngestLog('IndexEnsureFailed', { baseId, error: e && (e instanceof Error ? (e.stack || e.message) : String(e)) }); }
        try { await this.analyzeTable(db, tableName); } catch (_) { }

        // Automatic monetary detection removed; metadata initialization is handled during column persistence

        await this.performPostIngestCleanup(baseId, base);
        return { tableName, rowsInserted: inserted };
    }

    // Process XLSX using streaming reader
    private async ingestFromXlsx(baseId: number, base: any, filePath: string, headerLinhaInicial: number, headerColunaInicial: number): Promise<IngestResult> {
        const SAMPLE_ROWS = Number(process.env.INGEST_SAMPLE_ROWS || DEFAULT_SAMPLE_ROWS_XLSX);
        const BATCH_SIZE = Number(process.env.INGEST_BATCH_SIZE || DEFAULT_BATCH_SIZE_XLSX);

        const headerRowNum = Math.max(1, headerLinhaInicial);
        const startColIdx0 = Math.max(0, headerColunaInicial - 1);
        const startColOne = startColIdx0 + 1;

        let headerSlice: any[] | null = null;
        const sampleRows: any[][] = [];
        let columnsCount = 0;

        await this.appendIngestLog('IngestHeaderAttempt', { baseId, headerLinhaInicial, headerColunaInicial, filePath });

        // First pass: read header and sample rows for type inference
        const reader = new (ExcelJS as any).stream.xlsx.WorkbookReader(filePath);
        for await (const worksheet of reader) {
            for await (const row of worksheet) {
                if (!headerSlice) {
                    if (row.number < headerRowNum) continue;
                    const h: any[] = [];
                    const vals = row.values as any[];
                    const maxC = Math.max(vals ? vals.length - 1 : startColOne, startColOne);
                    for (let c = startColOne; c <= maxC; c++) {
                        const cell = row.getCell(c);
                        h.push(cell ? (cell.value ?? null) : null);
                    }
                    headerSlice = h;
                    columnsCount = headerSlice.length;
                    await this.appendIngestLog('IngestHeader', { baseId, header: headerSlice });
                    continue;
                }

                if (sampleRows.length < SAMPLE_ROWS) {
                    const rowArr: any[] = [];
                    for (let c = startColOne; c < startColOne + columnsCount; c++) {
                        const cell = row.getCell(c);
                        rowArr.push(extractCellValue(cell));
                    }
                    sampleRows.push(rowArr);
                    if (sampleRows.length < SAMPLE_ROWS) continue;
                }

                if (sampleRows.length >= SAMPLE_ROWS) break;
            }
            break; // only first worksheet
        }

        if (!headerSlice || headerSlice.length === 0) return { tableName: '', rowsInserted: 0 };

        const startColIdx = startColIdx0;
        const initialColumns = headerSlice.map((h, i) => ({ name: sanitizeColumnName(h, startColIdx + i), original: h, idxAbs: startColIdx + i }));
        const seen: Record<string, number> = {};
        const columns = initialColumns.map(col => {
            let base = col.name || `col_${col.idxAbs}`;
            if (!base || base.toString().trim() === '') base = `col_${col.idxAbs}`;
            if (!seen[base]) { seen[base] = 1; return { name: base, original: col.original }; }
            seen[base] += 1;
            return { name: `${base}_${seen[base]}`, original: col.original };
        });

        const colTypes = this.inferColumnTypes(sampleRows);

        try {
            await this.appendIngestLog('IngestColumns', { baseId, columns: columns.map(c => ({ name: c.name, original: c.original })), colTypes, sampleRows: sampleRows.slice(0, 10) });
        } catch (_) { /* ignore */ }

        const tableName = `base_${baseId}`;
        let inserted = 0;

        // Create table in its own quick transaction
        await db.transaction(async trx => {
            await this.applyPragmas(trx);
            await this.createSqliteTableFromColumns(trx, tableName, columns, colTypes, baseId, startColIdx);
        });

        // Second pass: insert data with smaller transactions
        const insertReader = new (ExcelJS as any).stream.xlsx.WorkbookReader(filePath);
        let batch: Record<string, any>[] = [];
        let processingRows = false;
        let rowsInCurrentTransaction = 0;

        const flushBatch = async () => {
            if (batch.length === 0) return;
            try {
                await db.transaction(async trx => {
                    inserted += await this.bulkInsert(trx, tableName, batch);
                });
            } catch (insertErr) {
                await this.appendIngestLog('ErrorInsertingBatch', { table: tableName, batchSize: batch.length, sample: batch.slice(0, 5), error: insertErr && (insertErr instanceof Error ? (insertErr.stack || insertErr.message) : String(insertErr)) });
                throw insertErr;
            }
            rowsInCurrentTransaction = 0;
            batch = [];
        };

        for await (const worksheet of insertReader) {
            for await (const row of worksheet) {
                if (!processingRows) {
                    if (row.number < headerRowNum) continue;
                    if (row.number === headerRowNum) { processingRows = true; continue; }
                }

                const rowArr: any[] = [];
                for (let c = startColOne; c < startColOne + columnsCount; c++) {
                    const cell = row.getCell(c);
                    rowArr.push(extractCellValue(cell));
                }

                const allEmpty = rowArr.every(v => v === null || v === undefined || v === '');
                if (allEmpty) continue;

                const { rowObj } = this.buildRowObject(rowArr, columns, colTypes);
                batch.push(rowObj);
                rowsInCurrentTransaction++;

                // Flush when batch is full or transaction is too large
                if (batch.length >= BATCH_SIZE || rowsInCurrentTransaction >= MAX_ROWS_PER_TRANSACTION) {
                    await flushBatch();
                }
            }
            break;
        }

        // Final flush
        await flushBatch();

        try { const idxHelpers = await import('../db/indexHelpers'); await idxHelpers.ensureIndicesForBaseFromConfigs(baseId); } catch (e) { await this.appendIngestLog('IndexEnsureFailed', { baseId, error: e && (e instanceof Error ? (e.stack || e.message) : String(e)) }); }
        try { await this.analyzeTable(db, tableName); } catch (_) { }
        // Automatic monetary detection removed; metadata initialization is handled during column persistence

        await this.performPostIngestCleanup(baseId, base);

        return { tableName, rowsInserted: inserted };
    }

    // Public entry point
    async ingest(baseId: number): Promise<IngestResult> {
        const base = await db('bases').where({ id: baseId }).first();
        if (!base) throw new Error('Base not found');

        const headerLinhaInicial = Number(base.header_linha_inicial || 1);
        const headerColunaInicial = Number(base.header_coluna_inicial || 1);

        const { filePath, isJsonl } = this.resolveFilePathFromBase(base);
        try {
            await fs.access(filePath);
        } catch (e) {
            throw new Error(`Ingest file not accessible: ${filePath}`);
        }

        if (isJsonl) return this.ingestFromJsonl(baseId, base, filePath, headerLinhaInicial, headerColunaInicial);
        return this.ingestFromXlsx(baseId, base, filePath, headerLinhaInicial, headerColunaInicial);
    }
}

export default new ExcelIngestService();
