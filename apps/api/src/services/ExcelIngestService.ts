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

export class ExcelIngestService {
    private async appendIngestLog(prefix: string, info: any) {
        try {
            const logsDir = process.env.LOGS_DIR
                ? path.resolve(process.env.LOGS_DIR)
                : path.resolve(__dirname, '..', '..', 'logs');
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
                const baseIngestDir = process.env.UPLOAD_DIR
                    ? path.resolve(process.env.UPLOAD_DIR)
                    : path.resolve(process.cwd());

                candidates.push(path.resolve(baseIngestDir, relOrAbs));
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
            // process JSONL streaming
            const rl = (await import('readline')).createInterface({ input: (await import('fs')).createReadStream(filePath, { encoding: 'utf8' }) });
            const SAMPLE_ROWS = Number(process.env.INGEST_SAMPLE_ROWS || 1000);
            const BATCH_SIZE = Number(process.env.INGEST_BATCH_SIZE || 200);
            const headerLinhaInicial = Number(base.header_linha_inicial || 1);
            const headerColunaInicial = Number(base.header_coluna_inicial || 1);

            let headerSlice: any[] | null = null;
            const sampleRows: any[][] = [];
            let columnsCount = 0;
            let rawLineIndex = 0;
            let dataLineIndex = 0; // counts only non-empty, non-meta lines

            try {
                for await (const line of rl) {
                    rawLineIndex += 1;
                    if (!line || !line.trim()) continue; // skip blank lines, do not count
                    const parsed = JSON.parse(line);
                    // handle meta line optionally (do not count as data line)
                    if (parsed && parsed.meta && !headerSlice) {
                        headerSlice = parsed.meta.headers || null;
                        if (headerSlice) {
                            columnsCount = headerSlice.length - (headerColunaInicial - 1);
                            continue;
                        }
                    }

                    // this is a meaningful data row
                    dataLineIndex += 1;

                    // apply header_linha_inicial: skip until header row found (counting data rows)
                    if (!headerSlice) {
                        if (dataLineIndex < headerLinhaInicial) continue;
                        headerSlice = Array.isArray(parsed) ? parsed.slice(headerColunaInicial - 1) : Object.keys(parsed).slice(headerColunaInicial - 1);
                        columnsCount = headerSlice.length;
                        continue;
                    }

                    if (sampleRows.length < SAMPLE_ROWS) {
                        const rowArr = Array.isArray(parsed) ? parsed.slice(headerColunaInicial - 1) : Object.values(parsed).slice(headerColunaInicial - 1);
                        // normalize marked numbers
                        sampleRows.push(rowArr.map(v => v && v.__num__ ? v.__num__ : v));
                        if (sampleRows.length < SAMPLE_ROWS) continue;
                    }

                    if (sampleRows.length >= SAMPLE_ROWS) break;
                }
            } finally {
                rl.close();
            }

            if (!headerSlice || headerSlice.length === 0) return { tableName: '', rowsInserted: 0 };

            // sanitized column names
            const startColIdx0 = Math.max(0, headerColunaInicial - 1);
            const initialColumns = headerSlice.map((h: any, i: number) => ({ name: sanitizeColumnName(h, startColIdx0 + i), original: h, idxAbs: startColIdx0 + i }));
            const seen: Record<string, number> = {};
            const columns = initialColumns.map(col => {
                let baseName = col.name || `col_${col.idxAbs}`;
                if (!baseName || baseName.toString().trim() === '') baseName = `col_${col.idxAbs}`;
                if (!seen[baseName]) { seen[baseName] = 1; return { name: baseName, original: col.original }; }
                seen[baseName] += 1;
                return { name: `${baseName}_${seen[baseName]}`, original: col.original };
            });

            // infer types from sampleRows
            const colTypes: ('integer' | 'real' | 'text')[] = columns.map((c, colIdx) => {
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

            // log columns
            try { await this.appendIngestLog('IngestColumns', { baseId, columns: columns.map(c => ({ name: c.name, original: c.original })), colTypes, sampleRows: sampleRows.slice(0, 10) }); } catch (e) { }

            const tableName = `base_${baseId}`;
            const exists = await db.schema.hasTable(tableName);
            if (exists) throw new Error(`Table ${tableName} already exists`);
            await db.schema.createTable(tableName, (t: Knex.CreateTableBuilder) => { t.increments('id').primary(); columns.forEach((c, idx) => { const colType = colTypes[idx]; if (colType === 'integer') t.integer(c.name).nullable(); else if (colType === 'real') t.float(c.name).nullable(); else t.text(c.name).nullable(); }); t.timestamp('created_at').defaultTo(db.fn.now()).notNullable(); });

            // save base_columns mapping
            try {
                const mappings = columns.map((c, idx) => ({ base_id: baseId, col_index: startColIdx0 + idx + 1, excel_name: c.original == null ? null : String(c.original), sqlite_name: c.name }));
                if (mappings.length > 0) await db('base_columns').insert(mappings);
            } catch (e: any) { await this.appendIngestLog('Error saving base_columns mapping', { baseId, error: e && (e.stack || e.message || String(e)) }); }

            // now re-open JSONL and stream inserts
            let inserted = 0;
            const fsMod = await import('fs');
            const rl2 = (await import('readline')).createInterface({ input: fsMod.createReadStream(filePath, { encoding: 'utf8' }) });
            let batches: Record<string, any>[] = [];
            let rawLineNum = 0;
            let dataLineNum = 0; // counts only non-empty, non-meta lines
            try {
                for await (const line of rl2) {
                    rawLineNum += 1;
                    if (!line || !line.trim()) continue; // skip blank lines
                    const parsed = JSON.parse(line);
                    if (parsed && parsed.meta) continue; // skip meta
                    // meaningful data row
                    dataLineNum += 1;
                    // determine header row using dataLineNum
                    if (dataLineNum <= headerLinhaInicial) {
                        if (dataLineNum === headerLinhaInicial) continue; // header row itself
                        continue;
                    }
                    const rowArr = Array.isArray(parsed) ? parsed.slice(startColIdx0) : Object.values(parsed).slice(startColIdx0);
                    const rowObj: Record<string, any> = {};
                    let allEmpty = true;
                    columns.forEach((c, idx) => {
                        const raw = rowArr ? rowArr[idx] : undefined;
                        const val = raw && raw.__num__ ? raw.__num__ : raw;
                        let finalVal: any = val === undefined ? null : val;
                        if (finalVal === '') finalVal = null;
                        if (finalVal !== null && finalVal !== undefined) allEmpty = false;
                        const t = colTypes[idx];
                        if (finalVal != null) {
                            if (t === 'integer') {
                                const n = Number(finalVal);
                                finalVal = Number.isNaN(n) ? null : Math.trunc(n);
                            } else if (t === 'real') {
                                const n = Number(finalVal);
                                finalVal = Number.isNaN(n) ? null : n;
                            }
                        }
                        rowObj[c.name] = finalVal;
                    });

                    if (!allEmpty) batches.push(rowObj);
                    if (batches.length >= BATCH_SIZE) {
                        try { await db(tableName).insert(batches); inserted += batches.length; } catch (err: any) { await this.appendIngestLog('Error inserting batch', { table: tableName, batchSize: batches.length, sample: batches.slice(0, 5), error: err && (err.stack || err.message || String(err)) }); throw err; }
                        batches = [];
                    }
                }
            } finally {
                rl2.close();
            }
            if (batches.length > 0) { try { await db(tableName).insert(batches); inserted += batches.length; } catch (err: any) { await this.appendIngestLog('Error inserting final batch', { table: tableName, batchSize: batches.length, sample: batches.slice(0, 5), error: err && (err.stack || err.message || String(err)) }); throw err; } }

            // update bases.tabela_sqlite
            await db('bases').where({ id: baseId }).update({ tabela_sqlite: tableName });

            try { const idxHelpers = await import('../db/indexHelpers'); await idxHelpers.ensureIndicesForBaseFromConfigs(baseId); } catch (e: any) { await this.appendIngestLog('Error ensuring indices for base after ingest', { baseId, error: e && (e.stack || e.message || String(e)) }); }

            // Perform synchronous post-ingest cleanup (delete files, clear DB fields)
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
                        rowArr.push(cell ? (cell.value ?? null) : null);
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

        const exists = await db.schema.hasTable(tableName);
        if (exists) throw new Error(`Table ${tableName} already exists`);

        // create table
        await db.schema.createTable(tableName, (t: Knex.CreateTableBuilder) => {
            t.increments('id').primary();
            columns.forEach((c, idx) => {
                const colType = colTypes[idx];
                if (colType === 'integer') t.integer(c.name).nullable();
                else if (colType === 'real') t.float(c.name).nullable();
                else t.text(c.name).nullable();
            });
            t.timestamp('created_at').defaultTo(db.fn.now()).notNullable();
        });

        // save mapping between original excel header and sqlite column name
        try {
            const mappings = columns.map((c, idx) => ({
                base_id: baseId,
                col_index: startColIdx0 + idx + 1, // 1-based absolute column index
                excel_name: c.original == null ? null : String(c.original),
                sqlite_name: c.name
            }));
            if (mappings.length > 0) {
                await db('base_columns').insert(mappings);
            }
        } catch (e) {
            await this.appendIngestLog('Error saving base_columns mapping', { baseId, error: e && (e instanceof Error ? (e.stack || e.message) : String(e)) });
        }

        // Streamed insertion pass: re-open reader and insert in batches
        let inserted = 0;
        await db.transaction(async trx => {
            const insertReader = new (ExcelJS as any).stream.xlsx.WorkbookReader(filePath);
            let batch: Record<string, any>[] = [];
            let processingRows = false;

            for await (const worksheet of insertReader) {
                for await (const row of worksheet) {
                    if (!processingRows) {
                        if (row.number < headerRowNum) continue;
                        if (row.number === headerRowNum) {
                            processingRows = true;
                            continue; // skip header
                        }
                    }

                    const rowArr: any[] = [];
                    for (let c = startColOne; c < startColOne + columnsCount; c++) {
                        const cell = row.getCell(c);
                        rowArr.push(cell ? (cell.value ?? null) : null);
                    }

                    const allEmpty = rowArr.every(v => v === null || v === undefined || v === '');
                    if (allEmpty) continue;

                    const rowObj: Record<string, any> = {};
                    columns.forEach((c, idx) => {
                        const rawVal = rowArr ? rowArr[idx] : undefined;
                        const t = colTypes[idx];
                        let val: any = rawVal === undefined ? null : rawVal;
                        if (val === '') val = null;
                        if (val != null) {
                            if (t === 'integer') {
                                const n = Number(val);
                                val = Number.isNaN(n) ? null : Math.trunc(n);
                            } else if (t === 'real') {
                                const n = Number(val);
                                val = Number.isNaN(n) ? null : n;
                            }
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
                break; // only first worksheet
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
                batch = [];
            }
        });

        // update bases.tabela_sqlite
        await db('bases').where({ id: baseId }).update({ tabela_sqlite: tableName, });

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
