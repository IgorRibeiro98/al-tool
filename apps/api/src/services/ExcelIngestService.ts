import path from 'path';
import fs from 'fs/promises';
import ExcelJS from 'exceljs';
import db from '../db/knex';
import { Knex } from 'knex';

function sanitizeColumnName(name: string, idx: number) {
    if (!name || name.toString().trim() === '') return `col_${idx}`;
    return name.toString().trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

type IngestResult = { tableName: string; rowsInserted: number };

function extractCellValue(cell: any): any {
    if (!cell) return null;
    const v = cell.value;

    // Preserve numeric cells as numbers to keep typing for later math/grouping
    if (typeof v === 'number') return v;

    // Dates: keep user-facing text when available, else ISO string
    if (v instanceof Date) return typeof cell.text === 'string' ? cell.text : v.toISOString();
    if (v && typeof v === 'object' && v.result instanceof Date) {
        return typeof cell.text === 'string' ? cell.text : new Date(v.result).toISOString();
    }

    // Rich text: join text parts
    if (v && typeof v === 'object' && Array.isArray(v.richText)) {
        return v.richText.map((t: any) => t?.text || '').join('');
    }

    // Fallbacks: prefer original text if Excel provided; otherwise raw value untouched
    if (typeof cell.text === 'string' && cell.text.length > 0) return cell.text;
    return v ?? null;
}

export class ExcelIngestService {
    private async applyPragmas(conn: Knex | Knex.Transaction) {
        const pragmas: Array<{ key: string; value: string | number }> = [];
        const env = process.env;
        const envName = env.NODE_ENV || 'development';

        // Some PRAGMAs (journal_mode, synchronous, foreign_keys) cannot be changed inside an open transaction.
        // Detect transaction context and restrict to safe settings to avoid "Safety level may not be changed inside a transaction" errors.
        const isTransaction = Boolean((conn as any).isTransaction || (conn as any).client?.isTransaction);

        const defaultCacheSize = (() => {
            if (envName === 'production') return '-400000';
            if (envName === 'test') return '-50000';
            return '-200000';
        })();

        const defaultBusyTimeout = (() => {
            if (envName === 'production') return '12000';
            if (envName === 'test') return '4000';
            return '8000';
        })();

        const journalMode = env.INGEST_PRAGMA_JOURNAL_MODE || env.SQLITE_JOURNAL_MODE || 'WAL';
        if (!isTransaction && journalMode) pragmas.push({ key: 'journal_mode', value: journalMode });

        const synchronous = env.INGEST_PRAGMA_SYNCHRONOUS || env.SQLITE_SYNCHRONOUS || 'NORMAL';
        if (!isTransaction && synchronous) pragmas.push({ key: 'synchronous', value: synchronous });

        const tempStore = env.INGEST_PRAGMA_TEMP_STORE || env.SQLITE_TEMP_STORE || 'MEMORY';
        if (!isTransaction && tempStore) pragmas.push({ key: 'temp_store', value: tempStore });

        const cacheSize = env.INGEST_PRAGMA_CACHE_SIZE ?? env.SQLITE_CACHE_SIZE ?? defaultCacheSize; // negative = KB
        if (!isTransaction && cacheSize) pragmas.push({ key: 'cache_size', value: cacheSize });

        const mmapSize = env.INGEST_PRAGMA_MMAP_SIZE || env.SQLITE_MMAP_SIZE || '';
        if (!isTransaction && mmapSize) pragmas.push({ key: 'mmap_size', value: mmapSize });

        const busyTimeout = env.INGEST_PRAGMA_BUSY_TIMEOUT ?? env.SQLITE_BUSY_TIMEOUT ?? defaultBusyTimeout;
        if (busyTimeout) pragmas.push({ key: 'busy_timeout', value: busyTimeout });

        const foreignKeys = env.INGEST_PRAGMA_FOREIGN_KEYS ?? env.SQLITE_FOREIGN_KEYS ?? 'ON';
        if (!isTransaction && foreignKeys) pragmas.push({ key: 'foreign_keys', value: foreignKeys });

        for (const p of pragmas) {
            await conn.raw(`PRAGMA ${p.key} = ${p.value}`);
        }
    }

    private async analyzeTable(conn: Knex | Knex.Transaction, tableName: string) {
        try {
            await conn.raw(`ANALYZE ${tableName}`);
        } catch (e) {
            await this.appendIngestLog('Analyze failed', { tableName, error: e && ((e as any).stack || (e as any).message || String(e)) });
        }
    }

    private async appendIngestLog(prefix: string, info: any) {
        try {
            const logsDir = path.resolve(__dirname, '..', '..', 'logs');
            await fs.mkdir(logsDir, { recursive: true });
            const logFile = path.join(logsDir, 'ingest-errors.log');
            const entry = {
                ts: new Date().toISOString(),
                prefix,
                info
            };
            await fs.appendFile(logFile, JSON.stringify(entry) + '\n');
        } catch (e) {
            // last-resort fallback to console
            // eslint-disable-next-line no-console
            console.error('Failed to write ingest log', e);
        }
    }

    private async tryRemoveFileCandidate(baseId: number, relOrAbs: string) {
        if (!relOrAbs) return false;
        const tried: string[] = [];
        try {
            const candidates: string[] = [];
            if (path.isAbsolute(relOrAbs)) {
                candidates.push(relOrAbs);
            } else {
                candidates.push(path.resolve(process.cwd(), relOrAbs));
                candidates.push(path.resolve(process.cwd(), '..', relOrAbs));
                candidates.push(path.resolve(process.cwd(), '..', '..', relOrAbs));
                candidates.push(path.resolve(__dirname, '..', '..', relOrAbs));
                candidates.push(path.join(process.cwd(), 'apps', 'api', relOrAbs));
                candidates.push(path.join(process.cwd(), relOrAbs.replace(/^\/+/, '')));
            }

            for (const c of candidates) {
                if (!c) continue;
                tried.push(c);
                try {
                    // check existence
                    await fs.stat(c as any);
                    // exists, attempt unlink
                    await fs.unlink(c as any);
                    await this.appendIngestLog('Removed ingest file', { baseId, requested: relOrAbs, removedPath: c });
                    return true;
                } catch (err) {
                    // not found or unlink failed — continue
                    continue;
                }
            }
            // final attempt: try relOrAbs as-is
            try {
                await fs.stat(relOrAbs as any);
                await fs.unlink(relOrAbs as any);
                await this.appendIngestLog('Removed ingest file', { baseId, requested: relOrAbs, removedPath: relOrAbs });
                return true;
            } catch (e) {
                // nothing
            }
        } catch (e) {
            await this.appendIngestLog('Error while trying file removal candidates', { baseId, requested: relOrAbs, tried, error: (e as any && ((e as any).stack || (e as any).message)) || String(e) });
        }
        await this.appendIngestLog('Ingest cleanup: file not found', { baseId, requested: relOrAbs, tried });
        return false;
    }

    private async performPostIngestCleanup(baseId: number, base: any) {
        try {
            const toRemove: string[] = [];
            if (base.arquivo_jsonl_path) toRemove.push(base.arquivo_jsonl_path);
            if (base.arquivo_caminho) toRemove.push(base.arquivo_caminho);

            for (const relOrAbs of toRemove) {
                try {
                    if (!relOrAbs) continue;
                    await this.tryRemoveFileCandidate(baseId, relOrAbs);
                } catch (e) {
                    await this.appendIngestLog('Error deleting ingest file', { baseId, file: relOrAbs, error: e && (((e as any).stack) || ((e as any).message) || String(e)) });
                }
            }

            try {
                await db('bases').where({ id: baseId }).update({ arquivo_jsonl_path: null, arquivo_caminho: null });
            } catch (e) {
                await this.appendIngestLog('Error clearing arquivo paths in DB', { baseId, error: e && (((e as any).stack) || ((e as any).message) || String(e)) });
            }
        } catch (e) {
            await this.appendIngestLog('Error in post-ingest cleanup', { baseId, error: e && (((e as any).stack) || ((e as any).message) || String(e)) });
        }
    }

    async ingest(baseId: number): Promise<IngestResult> {
        const base = await db('bases').where({ id: baseId }).first();
        if (!base) throw new Error('Base not found');
        // Prefer JSONL artifact if conversion was done
        let jsonlPath: string | null = base.arquivo_jsonl_path || null;
        let filePath: string;
        if (jsonlPath) {
            if (path.isAbsolute(jsonlPath)) {
                filePath = jsonlPath;
            } else {
                // Try a few candidate locations for relative paths: current cwd (apps/api)
                // and repository root (two levels up from apps/api). This handles
                // converter worker writing to /home/app/storage/ingests while the API
                // resolves relative to /home/app/apps/api.
                const candidates = [
                    path.resolve(process.cwd(), jsonlPath),
                    path.resolve(process.cwd(), '..', '..', jsonlPath),
                    path.resolve(process.cwd(), '..', jsonlPath)
                ];
                let found: string | null = null;
                for (const c of candidates) {
                    try {
                        await fs.access(c as any);
                        found = c;
                        break;
                    } catch (e) {
                        // not found, continue
                    }
                }
                if (!found) {
                    // fallback: resolve relative to cwd (will likely fail later with ENOENT)
                    filePath = path.resolve(process.cwd(), jsonlPath);
                } else {
                    filePath = found;
                }
            }
        } else {
            if (!base.arquivo_caminho) throw new Error('Base has no arquivo_caminho');
            filePath = path.isAbsolute(base.arquivo_caminho)
                ? base.arquivo_caminho
                : path.resolve(process.cwd(), base.arquivo_caminho);
        }

        // determine header start positions from DB (1-based). Defaults to 1.
        const headerLinhaInicial = Number(base.header_linha_inicial || 1);
        const headerColunaInicial = Number(base.header_coluna_inicial || 1);

        // If JSONL exists, consume JSONL; else use exceljs streaming reader to avoid loading entire file into memory
        await fs.access(filePath);
        if (jsonlPath) {
            // single-pass JSONL streaming (no second full read)
            const rl = (await import('readline')).createInterface({ input: (await import('fs')).createReadStream(filePath, { encoding: 'utf8' }) });
            const SAMPLE_ROWS = Number(process.env.INGEST_SAMPLE_ROWS || 1000);
            const BATCH_SIZE = Number(process.env.INGEST_BATCH_SIZE || 200);
            const startColIdx0 = Math.max(0, headerColunaInicial - 1);

            const tableName = `base_${baseId}`;
            let headerSlice: any[] | null = null;
            const sampleRows: any[][] = [];
            const pendingRowArrays: any[][] = [];
            let columns: { name: string; original: any; idxAbs: number }[] = [];
            let colTypes: ('integer' | 'real' | 'text')[] = [];
            let tableReady = false;
            let inserted = 0;
            let dataLineIndex = 0;
            let batch: Record<string, any>[] = [];

            const buildRowObj = (rowArr: any[]): { rowObj: Record<string, any>; allEmpty: boolean } => {
                const obj: Record<string, any> = {};
                let allEmpty = true;
                columns.forEach((c, idx) => {
                    const raw = rowArr ? rowArr[idx] : undefined;
                    const val = raw && raw.__num__ ? raw.__num__ : raw;
                    let finalVal: any = val === undefined ? null : val;
                    if (finalVal === '') finalVal = null;
                    if (finalVal !== null && finalVal !== undefined) allEmpty = false;
                    const t = colTypes[idx];
                    if (finalVal != null && (t === 'integer' || t === 'real')) {
                        const n = Number(finalVal);
                        finalVal = Number.isNaN(n) ? null : n;
                    }
                    obj[c.name] = finalVal;
                });
                return { rowObj: obj, allEmpty };
            };

            const prepareTable = async (trx: Knex.Transaction) => {
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

                colTypes = columns.map((c, colIdx) => {
                    let isInteger = true; let isNumber = true;
                    for (const r of sampleRows) {
                        const v = r ? r[colIdx] : undefined;
                        if (v === null || v === undefined || v === '') continue;
                        const n = Number(v);
                        if (Number.isNaN(n)) { isNumber = false; isInteger = false; break; }
                        if (!Number.isInteger(n)) isInteger = false;
                    }
                    if (isInteger) return 'integer'; if (isNumber) return 'real'; return 'text';
                });

                await this.applyPragmas(trx);

                const exists = await trx.schema.hasTable(tableName);
                if (exists) throw new Error(`Table ${tableName} already exists`);

                await trx.schema.createTable(tableName, (t: Knex.CreateTableBuilder) => {
                    t.increments('id').primary();
                    columns.forEach((c, idx) => {
                        const colType = colTypes[idx];
                        if (colType === 'text') {
                            t.text(c.name).nullable();
                        } else {
                            t.decimal(c.name, 30, 10).nullable();
                        }
                    });
                    t.timestamp('created_at').defaultTo(trx.fn.now()).notNullable();
                });

                try {
                    const mappings = columns.map((c, idx) => ({ base_id: baseId, col_index: startColIdx0 + idx + 1, excel_name: c.original == null ? null : String(c.original), sqlite_name: c.name }));
                    if (mappings.length > 0) await trx('base_columns').insert(mappings);
                } catch (e: any) {
                    await this.appendIngestLog('Error saving base_columns mapping', { baseId, error: e && (e.stack || e.message || String(e)) });
                }

                await trx('bases').where({ id: baseId }).update({ tabela_sqlite: tableName });

                tableReady = true;
            };

            await db.transaction(async trx => {
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
                            await prepareTable(trx);
                            for (const arr of pendingRowArrays) {
                                const { rowObj, allEmpty } = buildRowObj(arr);
                                if (!allEmpty) {
                                    batch.push(rowObj);
                                    if (batch.length >= BATCH_SIZE) {
                                        await trx(tableName).insert(batch);
                                        inserted += batch.length;
                                        batch = [];
                                    }
                                }
                            }
                            pendingRowArrays.length = 0;
                        }
                        continue;
                    }

                    const { rowObj, allEmpty } = buildRowObj(normalizedRowArr);
                    if (!allEmpty) {
                        batch.push(rowObj);
                        if (batch.length >= BATCH_SIZE) {
                            await trx(tableName).insert(batch);
                            inserted += batch.length;
                            batch = [];
                        }
                    }
                }

                if (!tableReady) {
                    await prepareTable(trx);
                    for (const arr of pendingRowArrays) {
                        const { rowObj, allEmpty } = buildRowObj(arr);
                        if (!allEmpty) batch.push(rowObj);
                        if (batch.length >= BATCH_SIZE) {
                            await trx(tableName).insert(batch);
                            inserted += batch.length;
                            batch = [];
                        }
                    }
                }

                if (batch.length > 0) {
                    await trx(tableName).insert(batch);
                    inserted += batch.length;
                    batch = [];
                }
            });

            try { const idxHelpers = await import('../db/indexHelpers'); await idxHelpers.ensureIndicesForBaseFromConfigs(baseId); } catch (e: any) { await this.appendIngestLog('Error ensuring indices for base after ingest', { baseId, error: e && (e.stack || e.message || String(e)) }); }

            try { await this.analyzeTable(db, tableName); } catch (_) { }

            await this.performPostIngestCleanup(baseId, base);

            return { tableName, rowsInserted: inserted };
        }
        const SAMPLE_ROWS = Number(process.env.INGEST_SAMPLE_ROWS || 500);
        const BATCH_SIZE = Number(process.env.INGEST_BATCH_SIZE || 100);

        const headerRowNum = Math.max(1, headerLinhaInicial); // 1-based
        const startColIdx0 = Math.max(0, headerColunaInicial - 1); // zero-based for legacy math
        const startColOne = startColIdx0 + 1; // 1-based for exceljs

        let headerSlice: any[] | null = null;
        const sampleRows: any[][] = [];
        let columnsCount = 0;

        const reader = new (ExcelJS as any).stream.xlsx.WorkbookReader(filePath);
        await this.appendIngestLog('IngestHeaderAttempt', { baseId, headerLinhaInicial, headerColunaInicial, filePath });

        // read first worksheet to capture header and sample rows
        for await (const worksheet of reader) {
            for await (const row of worksheet) {
                if (!headerSlice) {
                    if (row.number < headerRowNum) continue;
                    // build header
                    const h: any[] = [];
                    const vals = row.values as any[];
                    const maxC = Math.max(vals ? vals.length - 1 : startColOne, startColOne);
                    for (let c = startColOne; c <= maxC; c++) {
                        const cell = row.getCell(c);
                        h.push(cell ? (cell.value ?? null) : null);
                    }
                    headerSlice = h;
                    columnsCount = headerSlice.length;
                    await this.appendIngestLog('IngestHeader', { baseId, headerLinhaInicial, headerColunaInicial, header: headerSlice });
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

                // once we have sampleRows capacity, we can stop reading in this pass
                if (sampleRows.length >= SAMPLE_ROWS) break;
            }
            break; // only first worksheet
        }

        if (!headerSlice || headerSlice.length === 0) return { tableName: '', rowsInserted: 0 };

        // produce sanitized names, then ensure uniqueness to avoid SQL duplicate column errors
        // use absolute column index for fallback names so they reflect real sheet columns
        const initialColumns = headerSlice.map((h, i) => ({ name: sanitizeColumnName(h, startColIdx0 + i), original: h, idxAbs: startColIdx0 + i }));
        const seen: Record<string, number> = {};
        const columns = initialColumns.map(col => {
            let base = col.name || `col_${col.idxAbs}`;
            if (!base || base.toString().trim() === '') base = `col_${col.idxAbs}`;
            if (!seen[base]) {
                seen[base] = 1;
                return { name: base, original: col.original };
            }
            seen[base] += 1;
            const uniqueName = `${base}_${seen[base]}`;
            return { name: uniqueName, original: col.original };
        });

        // infer types: integer, real, text using sampled rows
        const colTypes: ('integer' | 'real' | 'text')[] = columns.map((c, colIdx) => {
            let isInteger = true;
            let isNumber = true;
            for (const r of sampleRows) {
                const v = r ? r[colIdx] : undefined;
                if (v === null || v === undefined || v === '') continue;
                const n = Number(v);
                if (Number.isNaN(n)) {
                    isNumber = false;
                    isInteger = false;
                    break;
                }
                if (!Number.isInteger(n)) isInteger = false;
            }
            if (isInteger) return 'integer';
            if (isNumber) return 'real';
            return 'text';
        });

        // log sanitized columns, inferred types and a small sample of data rows for debugging
        try {
            await this.appendIngestLog('IngestColumns', {
                baseId,
                columns: columns.map(c => ({ name: c.name, original: c.original })),
                colTypes,
                sampleRows: sampleRows.slice(0, 10)
            });
        } catch (e) {
            // ignore logging errors
        }

        const tableName = `base_${baseId}`;

        let inserted = 0;

        await db.transaction(async trx => {
            await this.applyPragmas(trx);

            const exists = await trx.schema.hasTable(tableName);
            if (exists) throw new Error(`Table ${tableName} already exists`);

            await trx.schema.createTable(tableName, (t: Knex.CreateTableBuilder) => {
                t.increments('id').primary();
                columns.forEach((c, idx) => {
                    const colType = colTypes[idx];
                    if (colType === 'text') {
                        t.text(c.name).nullable();
                    } else {
                        t.decimal(c.name, 30, 10).nullable();
                    }
                });
                t.timestamp('created_at').defaultTo(trx.fn.now()).notNullable();
            });

            try {
                const mappings = columns.map((c, idx) => ({
                    base_id: baseId,
                    col_index: startColIdx0 + idx + 1,
                    excel_name: c.original == null ? null : String(c.original),
                    sqlite_name: c.name
                }));
                if (mappings.length > 0) {
                    await trx('base_columns').insert(mappings);
                }
            } catch (e) {
                await this.appendIngestLog('Error saving base_columns mapping', { baseId, error: e && (e instanceof Error ? (e.stack || e.message) : String(e)) });
            }

            const insertReader = new (ExcelJS as any).stream.xlsx.WorkbookReader(filePath);
            let batch: Record<string, any>[] = [];
            let processingRows = false;

            for await (const worksheet of insertReader) {
                for await (const row of worksheet) {
                    if (!processingRows) {
                        if (row.number < headerRowNum) continue;
                        if (row.number === headerRowNum) {
                            processingRows = true;
                            continue;
                        }
                    }

                    const rowArr: any[] = [];
                    for (let c = startColOne; c < startColOne + columnsCount; c++) {
                        const cell = row.getCell(c);
                        rowArr.push(extractCellValue(cell));
                    }

                    const allEmpty = rowArr.every(v => v === null || v === undefined || v === '');
                    if (allEmpty) continue;

                    const rowObj: Record<string, any> = {};
                    columns.forEach((c, idx) => {
                        const rawVal = rowArr ? rowArr[idx] : undefined;
                        const t = colTypes[idx];
                        let val: any = rawVal === undefined ? null : rawVal;
                        if (val === '') val = null;
                        if (val != null && (t === 'integer' || t === 'real')) {
                            const n = Number(val);
                            val = Number.isNaN(n) ? null : n;
                        }
                        rowObj[c.name] = val;
                    });

                    batch.push(rowObj);
                    if (batch.length >= BATCH_SIZE) {
                        try {
                            await trx(tableName).insert(batch);
                            inserted += batch.length;
                        } catch (insertErr) {
                            await this.appendIngestLog('Error inserting batch', {
                                table: tableName,
                                batchSize: batch.length,
                                sample: batch.slice(0, 5),
                                error: insertErr && (insertErr instanceof Error ? (insertErr.stack || insertErr.message) : String(insertErr))
                            });
                            throw insertErr;
                        }
                        batch = [];
                    }
                }
                break;
            }

            if (batch.length > 0) {
                try {
                    await trx(tableName).insert(batch);
                    inserted += batch.length;
                } catch (insertErr) {
                    await this.appendIngestLog('Error inserting final batch', {
                        table: tableName,
                        batchSize: batch.length,
                        sample: batch.slice(0, 5),
                        error: insertErr && (insertErr instanceof Error ? (insertErr.stack || insertErr.message) : String(insertErr))
                    });
                    throw insertErr;
                }
            }

            await trx('bases').where({ id: baseId }).update({ tabela_sqlite: tableName });
        });

        try { const idxHelpers = await import('../db/indexHelpers'); await idxHelpers.ensureIndicesForBaseFromConfigs(baseId); } catch (e) { await this.appendIngestLog('Error ensuring indices for base after ingest', { baseId, error: e && (e instanceof Error ? (e.stack || e.message) : String(e)) }); }

        try { await this.analyzeTable(db, tableName); } catch (_) { }

        // Ensure indices based on existing configs that reference this base
        try {
            const idxHelpers = await import('../db/indexHelpers');
            await idxHelpers.ensureIndicesForBaseFromConfigs(baseId);
        } catch (e) {
            await this.appendIngestLog('Error ensuring indices for base after ingest', { baseId, error: e && (e instanceof Error ? (e.stack || e.message) : String(e)) });
        }

        // Perform synchronous post-ingest cleanup (delete files, clear DB fields)
        await this.performPostIngestCleanup(baseId, base);

        return { tableName, rowsInserted: inserted };
    }
}

export default new ExcelIngestService();
