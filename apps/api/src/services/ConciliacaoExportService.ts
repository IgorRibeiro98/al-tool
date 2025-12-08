import db from '../db/knex';
// removed SheetJS in favor of ExcelJS streaming for styled exports
import ExcelJS from 'exceljs';
import { fileStorage } from '../infra/storage/FileStorage';
import * as jobsRepo from '../repos/jobsRepository';
import path from 'path';
import { EXPORT_DIR } from '../config/paths';
import fs from 'fs/promises';
import fsSync from 'fs';
import archiver from 'archiver';

type MappingPair = { coluna_contabil: string; coluna_fiscal: string };

interface BaseSheetMetadata {
    baseId: number;
    tableName: string;
    columns: Array<{ sqliteName: string; header: string; sqliteType?: string | null }>;
}

function extractKeyIdentifiers(cfgRow: any): string[] {
    const chavesContabil = parseChaves(cfgRow?.chaves_contabil);
    const chavesFiscal = parseChaves(cfgRow?.chaves_fiscal);
    return Array.from(new Set([...Object.keys(chavesContabil || {}), ...Object.keys(chavesFiscal || {})]));
}

function buildKeyHeaders(keyIds: string[]): string[] {
    return keyIds.map((key) => key.replace('_', ' '));
}

interface StreamRowPayload {
    baseValues: Record<string, any>;
    keyValues: Record<string, any>;
    status: any;
    chave: any;
    grupo: any;
}

const EXTRA_FINAL_HEADERS = ['status', 'chave', 'grupo'];

// Color definitions for Base A and Base B (ARGB format with full opacity)
const BASE_A_STYLES = {
    header: 'FF3C78D8',
    rowColor1: 'FFFFFFFF',
    rowColor2: 'FFE8F0FE',
};

const BASE_B_STYLES = {
    header: 'FF78909C',
    rowColor1: 'FFEBEFF1',
    rowColor2: 'FFD9D9D9',
};

function parseChaves(raw: any): Record<string, string[]> {
    try {
        const parsed = raw ? JSON.parse(raw) : {};
        if (Array.isArray(parsed)) return { CHAVE_1: parsed } as Record<string, string[]>;
        if (parsed && typeof parsed === 'object') return parsed as Record<string, string[]>;
        return {};
    } catch {
        return {};
    }
}

function parseMappingPairs(raw: any): MappingPair[] {
    let source = raw;
    if (typeof raw === 'string') {
        try {
            source = JSON.parse(raw);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(source)) return [];
    return source
        .map((item: any) => {
            const coluna_contabil = typeof item?.coluna_contabil === 'string' ? item.coluna_contabil.trim() : '';
            const coluna_fiscal = typeof item?.coluna_fiscal === 'string' ? item.coluna_fiscal.trim() : '';
            return { coluna_contabil, coluna_fiscal };
        })
        .filter((item: MappingPair) => item.coluna_contabil.length > 0 && item.coluna_fiscal.length > 0);
}
    
export async function exportJobResultToXlsx(jobId: number) {
    const job = await jobsRepo.getJobById(jobId);
    if (!job) throw new Error('job not found');

    const resultTable = `conciliacao_result_${jobId}`;
    const hasTable = await db.schema.hasTable(resultTable);
    if (!hasTable) throw new Error('result table not found');

    const cfgRow = await db('configs_conciliacao').where({ id: job.config_conciliacao_id }).first();
    if (!cfgRow) throw new Error('config conciliacao not found for job');

    const keyIdentifiers = extractKeyIdentifiers(cfgRow);
    const keyHeaders = buildKeyHeaders(keyIdentifiers);

    // stream to an ExcelJS file to avoid loading all rows in memory
    await fs.mkdir(EXPORT_DIR, { recursive: true });
    const filename = `conciliacao_${jobId}.xlsx`;
    const filePath = path.join(EXPORT_DIR, filename);
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useStyles: true, useSharedStrings: true });
    const sheet = workbook.addWorksheet('resultado');

    const baseHeaders = ['id', 'chave', 'status', 'grupo', 'a_row_id', 'b_row_id', 'value_a', 'value_b', 'difference', 'a_values', 'b_values', 'created_at'];
    const finalHeaders = baseHeaders.concat(keyHeaders);

    // header styling (use neutral header from Base A colors)
    const headerRow = sheet.addRow(finalHeaders);
    headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: BASE_A_STYLES.header === undefined ? 'FFFFFFFF' : 'FFFFFFFF' } } as any;
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: BASE_A_STYLES.header },
        } as any;
        cell.alignment = { vertical: 'middle', horizontal: 'center' } as any;
    });
    headerRow.commit();

    // stream rows from DB
    const query = db.select('*').from(resultTable).orderBy('id', 'asc');
    const stream: any = await (query as any).stream();
    let rowIndex = 2;
    try {
        for await (const r of stream) {
            const rowArr: any[] = [];
            rowArr.push(r.id);
            rowArr.push(r.chave ?? null);
            rowArr.push(r.status ?? null);
            rowArr.push(r.grupo ?? null);
            rowArr.push(r.a_row_id ?? null);
            rowArr.push(r.b_row_id ?? null);
            rowArr.push(r.value_a ?? null);
            rowArr.push(r.value_b ?? null);
            rowArr.push(r.difference ?? null);
            rowArr.push(typeof r.a_values === 'string' ? r.a_values : JSON.stringify(r.a_values || null));
            rowArr.push(typeof r.b_values === 'string' ? r.b_values : JSON.stringify(r.b_values || null));
            rowArr.push(formatIfDateLike(r.created_at ?? null));
            for (const kid of keyIdentifiers) rowArr.push(r[kid] ?? null);

            const excelRow = sheet.addRow(rowArr);
            if ((rowIndex % 2) === 0) {
                excelRow.eachCell((cell) => {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFF2F2F2' },
                    } as any;
                });
            }
            excelRow.commit();
            rowIndex += 1;
        }
    } finally {
        try { stream.destroy && stream.destroy(); } catch (err) { }
        (sheet as any).commit?.();
        await workbook.commit();
    }

    const relPath = path.relative(process.cwd(), filePath).split(path.sep).join(path.posix.sep);
    await jobsRepo.setJobExportPath(jobId, relPath);

    return { path: relPath, filename };
}

/**
 * Export conciliation job as a ZIP containing two XLSX files: Base_A.xlsx and Base_B.xlsx
 * - Reconstructs original column order using `base_columns` metadata
 * - Adds final columns: status, chave, grupo
 * - Persists ZIP to storage/exports and updates job.arquivo_exportado with the relative path
 *
 * Mapping logic:
 * - For Base A: left join `conciliacao_result_{jobId}` on a_row_id to obtain status/chave/grupo for each A row.
 * - For Base B: left join `conciliacao_result_{jobId}` on b_row_id to obtain status/chave/grupo for each B row.
 *
 * Column order preservation:
 * - We read `base_columns` ordered by `col_index` for each base to reconstruct the exact column order and header names
 */
export async function exportJobResultToZip(jobId: number) {
    const job = await jobsRepo.getJobById(jobId);
    if (!job) throw new Error('job not found');
    if (job.status !== 'DONE') throw new Error('job not completed');

    const resultTable = `conciliacao_result_${jobId}`;
    const hasTable = await db.schema.hasTable(resultTable);
    if (!hasTable) throw new Error('result table not found');

    // fetch config conciliacao to know base ids
    const cfg = await db('configs_conciliacao').where({ id: job.config_conciliacao_id }).first();
    if (!cfg) throw new Error('config conciliacao not found for job');

    const baseAId = job.base_contabil_id_override || cfg.base_contabil_id;
    const baseBId = job.base_fiscal_id_override || cfg.base_fiscal_id;
    if (!baseAId || !baseBId) throw new Error('Bases não configuradas para este job');
    const keyIds = extractKeyIdentifiers(cfg);
    const keyHeaders = buildKeyHeaders(keyIds);

    const [metaA, metaB] = await Promise.all([
        getBaseSheetMetadata(baseAId),
        getBaseSheetMetadata(baseBId)
    ]);

    let mappingPairs: MappingPair[] = [];
    if (job.config_mapeamento_id) {
        const mapRow = await db('configs_mapeamento_bases').where({ id: job.config_mapeamento_id }).first();
        if (!mapRow) {
            console.warn(`Mapping config ${job.config_mapeamento_id} not found for job ${jobId}; fallback to default column matching.`);
        } else if (mapRow.base_contabil_id !== baseAId || mapRow.base_fiscal_id !== baseBId) {
            console.warn(`Mapping config ${job.config_mapeamento_id} bases do not match job ${jobId}; fallback to default column matching.`);
        } else {
            mappingPairs = parseMappingPairs(mapRow.mapeamentos);
        }
    }

    try { await jobsRepo.setJobExportProgress(jobId, 5, 'EXPORT_BUILDING_A'); } catch (e) { }
    const fileA = await buildSheetFileForBase({ jobId, side: 'A', meta: metaA, resultTable, keyIds, keyHeaders });
    try { await jobsRepo.setJobExportProgress(jobId, 40, 'EXPORT_BUILT_A'); } catch (e) { }

    try { await jobsRepo.setJobExportProgress(jobId, 45, 'EXPORT_BUILDING_B'); } catch (e) { }
    const fileB = await buildSheetFileForBase({ jobId, side: 'B', meta: metaB, resultTable, keyIds, keyHeaders });
    try { await jobsRepo.setJobExportProgress(jobId, 70, 'EXPORT_BUILT_B'); } catch (e) { }

    try { await jobsRepo.setJobExportProgress(jobId, 75, 'EXPORT_BUILDING_COMBINED'); } catch (e) { }
    const fileCombined = await buildCombinedWorkbook({ jobId, metaA, metaB, resultTable, keyIds, keyHeaders, mappingPairs });
    try { await jobsRepo.setJobExportProgress(jobId, 85, 'EXPORT_BUILT_COMBINED'); } catch (e) { }

    // ensure exports dir
    const exportsDir = EXPORT_DIR;
    await fs.mkdir(exportsDir, { recursive: true });
    // Use the job name as the zip filename (sanitized). Fallback to conciliacao_{jobId}.
    const rawBaseName = (job.nome && String(job.nome).trim()) ? String(job.nome).trim() : `conciliacao_${jobId}`;
    // normalize and remove diacritics, then remove unsafe chars and replace spaces with underscore
    let safeBase = rawBaseName;
    try {
        safeBase = rawBaseName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    } catch (e) {
        // ignore normalization errors and use rawBaseName
        safeBase = rawBaseName;
    }
    // remove any character that's not alphanumeric, dash, underscore, dot or space; then collapse spaces to underscore
    const sanitized = (safeBase || rawBaseName).replace(/[^a-zA-Z0-9\-_. ]+/g, '').replace(/\s+/g, '_');
    const zipFilename = `${sanitized}.zip`;
    const zipAbs = path.join(exportsDir, zipFilename);

    // create zip using archiver and write to disk
    await new Promise<void>((resolve, reject) => {
        const output = fsSync.createWriteStream(zipAbs);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => resolve());
        output.on('end', () => resolve());
        archive.on('warning', (err: any) => { if (err.code === 'ENOENT') console.warn(err); else reject(err); });
        archive.on('error', (err: any) => reject(err));

        archive.pipe(output);
        archive.file(fileA, { name: 'Base_A.xlsx' });
        archive.file(fileB, { name: 'Base_B.xlsx' });
        archive.file(fileCombined, { name: 'Base_Comparativo.xlsx' });
        archive.finalize().catch(reject);
    });

    const rel = path.relative(process.cwd(), zipAbs).split(path.sep).join(path.posix.sep);
    await jobsRepo.setJobExportPath(jobId, rel);
    try { await jobsRepo.setJobExportProgress(jobId, 95, 'EXPORT_ZIPPED'); } catch (e) { }

    // final update to mark as done is handled by caller (route wrapper), but ensure progress 100 here too
    try { await jobsRepo.setJobExportProgress(jobId, 100, 'EXPORT_DONE'); } catch (e) { }

    return { path: rel, filename: zipFilename };
}

async function getBaseSheetMetadata(baseId: number): Promise<BaseSheetMetadata> {
    const base = await db('bases').where({ id: baseId }).first();
    if (!base) throw new Error(`base ${baseId} not found`);
    const tableName = base.tabela_sqlite;
    if (!tableName) throw new Error(`base ${baseId} has no tabela_sqlite`);
    const cols = await db('base_columns').where({ base_id: baseId }).orderBy('col_index', 'asc');
    if (!cols || cols.length === 0) throw new Error(`no base_columns metadata for base ${baseId}`);

    // capture sqlite column types to allow proper defaults when mapping missing columns
    const safeTable = tableName.replace(/"/g, '""');
    const pragma = await db.raw(`PRAGMA table_info("${safeTable}")`).then((r: any) => r && (r[0] ?? r));
    const typeMap = new Map<string, string | null>();
    if (Array.isArray(pragma)) {
        pragma.forEach((row: any) => {
            if (row && row.name) typeMap.set(row.name, row.type || null);
        });
    }

    return {
        baseId,
        tableName,
        columns: cols.map((c: any) => ({
            sqliteName: c.sqlite_name,
            header: c.excel_name == null ? c.sqlite_name : String(c.excel_name),
            sqliteType: typeMap.get(c.sqlite_name) ?? null,
        })),
    };
}

function isNumericType(sqliteType?: string | null) {
    if (!sqliteType || typeof sqliteType !== 'string') return false;
    const t = sqliteType.toUpperCase();
    return /INT|REAL|NUM|DEC|DOUBLE|FLOAT/.test(t);
}

function isDateType(sqliteType?: string | null) {
    if (!sqliteType || typeof sqliteType !== 'string') return false;
    return sqliteType.toUpperCase().includes('DATE');
}

function formatDateForExport(value: any) {
    if (value instanceof Date && !isNaN(value.getTime())) {
        const day = String(value.getDate()).padStart(2, '0');
        const month = String(value.getMonth() + 1).padStart(2, '0');
        const year = value.getFullYear();
        return `${day}/${month}/${year}`;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return trimmed;
        const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (isoMatch) {
            const [, y, m, d] = isoMatch;
            return `${d}/${m}/${y}`;
        }
    }

    return value;
}

function formatIfDateLike(value: any) {
    if (value === null || value === undefined || value === '') return value;
    if (value instanceof Date && !isNaN(value.getTime())) return formatDateForExport(value);
    if (typeof value !== 'string') return value;

    const trimmed = value.trim();
    // Accept pure date (YYYY-MM-DD) or ISO-like with time (YYYY-MM-DDTHH:mm:ss[.SSS][Z])
    const isoLike = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z)?)?$/);
    if (isoLike) {
        const [, y, m, d] = isoLike;
        return `${d}/${m}/${y}`;
    }

    // Already formatted
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return trimmed;

    return value;
}

function coerceValue(value: any, sqliteType?: string | null) {
    const isNullish = value === null || value === undefined || value === '';
    if (isNumericType(sqliteType)) {
        return isNullish ? 0 : value;
    }
    if (isDateType(sqliteType)) {
        if (isNullish) return 'NULL';
        return formatDateForExport(value);
    }
    if (!isNullish) {
        const maybeDate = formatIfDateLike(value);
        if (maybeDate !== value) return maybeDate;
    }
    return isNullish ? 'NULL' : value;
}

function buildColumnMapping(metaA: BaseSheetMetadata, metaB: BaseSheetMetadata, pairs: MappingPair[]): Map<string, string> {
    const mapping = new Map<string, string>();
    const bColumns = new Set(metaB.columns.map((col) => col.sqliteName));
    const validACols = new Set(metaA.columns.map((col) => col.sqliteName));

    // default: identical column names
    for (const col of metaA.columns) {
        if (bColumns.has(col.sqliteName)) mapping.set(col.sqliteName, col.sqliteName);
    }

    for (const pair of pairs) {
        const colA = pair.coluna_contabil;
        const colB = pair.coluna_fiscal;
        if (!validACols.has(colA)) continue;
        if (!bColumns.has(colB)) continue;
        mapping.set(colA, colB);
    }

    return mapping;
}

async function streamBaseRows(params: {
    meta: BaseSheetMetadata;
    side: 'A' | 'B';
    resultTable: string;
    keyIds: string[];
    onRow: (row: StreamRowPayload) => void | Promise<void>;
}) {
    const { meta, side, resultTable, keyIds, onRow } = params;
    const sqliteCols = meta.columns.map((col) => col.sqliteName);
    const selectCols = sqliteCols.map((col) => `${meta.tableName}.${col}`);
    const joinCondition = side === 'A'
        ? `${resultTable}.a_row_id = ${meta.tableName}.id`
        : `${resultTable}.b_row_id = ${meta.tableName}.id`;

    const keyAlias = (key: string) => `__key_${key}`;
    const keySelects = keyIds.map((key) => db.raw('??.?? as ??', [resultTable, key, keyAlias(key)]));
    const statusAlias = '__status';
    const chaveAlias = '__chave';
    const grupoAlias = '__grupo';

    const selectPieces: any[] = [
        ...selectCols,
        ...keySelects,
        db.raw('??.?? as ??', [resultTable, 'status', statusAlias]),
        db.raw('??.?? as ??', [resultTable, 'chave', chaveAlias]),
        db.raw('??.?? as ??', [resultTable, 'grupo', grupoAlias]),
    ];

    const query = db.select(selectPieces)
        .from(meta.tableName)
        .leftJoin(resultTable, db.raw(joinCondition))
        .orderBy(`${meta.tableName}.id`, 'asc');

    const stream: any = await (query as any).stream();
    try {
        for await (const row of stream) {
            const baseValues: Record<string, any> = {};
            for (const col of sqliteCols) baseValues[col] = row[col];
            const keyValues: Record<string, any> = {};
            for (const key of keyIds) keyValues[key] = row[keyAlias(key)] ?? null;
            await onRow({
                baseValues,
                keyValues,
                status: row[statusAlias] ?? null,
                chave: row[chaveAlias] ?? null,
                grupo: row[grupoAlias] ?? null,
            });
        }
    } finally {
        try { stream.destroy && stream.destroy(); } catch (err) { }
    }
}

async function buildSheetFileForBase(params: {
    jobId: number;
    side: 'A' | 'B';
    meta: BaseSheetMetadata;
    resultTable: string;
    keyIds: string[];
    keyHeaders: string[];
}): Promise<string> {
    const { jobId, side, meta, resultTable, keyIds, keyHeaders } = params;
    await fs.mkdir(EXPORT_DIR, { recursive: true });
    const fileName = `${side === 'A' ? 'Base_A' : 'Base_B'}_${jobId}.xlsx`;
    const filePath = path.join(EXPORT_DIR, fileName);
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useStyles: true, useSharedStrings: true });
    const sheet = workbook.addWorksheet(side === 'A' ? 'Base_A' : 'Base_B');
    const baseHeaders = meta.columns.map((col) => col.header);
    const finalHeaders = baseHeaders.concat(keyHeaders, EXTRA_FINAL_HEADERS);

    // Add styled header row (stream-safe): style before commit
    const headerRow = sheet.addRow(finalHeaders);
    const styles = side === 'A' ? BASE_A_STYLES : BASE_B_STYLES;
    headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } } as any;
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: styles.header },
        } as any;
        cell.alignment = { vertical: 'middle', horizontal: 'center' } as any;
    });
    headerRow.commit();

    let rowIndex = 2; // starting after header
    try {
        await streamBaseRows({
            meta,
            side,
            resultTable,
            keyIds,
            onRow: (row) => {
                const rowArr = meta.columns.map((col) => {
                    const value = row.baseValues[col.sqliteName];
                    return coerceValue(value, col.sqliteType);
                });
                for (const key of keyIds) rowArr.push(row.keyValues[key] ?? null);
                rowArr.push(row.status ?? null);
                rowArr.push(row.chave ?? null);
                rowArr.push(row.grupo ?? null);

                const excelRow = sheet.addRow(rowArr);
                // alternating row shading: even rows get a light fill specific to the base
                const isEven = (rowIndex % 2) === 0;
                if (isEven) {
                    const rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: styles.rowColor2 } } as any;
                    excelRow.eachCell((cell) => { cell.fill = rowFill; });
                }
                excelRow.commit();
                rowIndex += 1;
            }
        });
    } finally {
        (sheet as any).commit?.();
        await workbook.commit();
    }

    return filePath;
}

async function buildCombinedWorkbook(params: {
    jobId: number;
    metaA: BaseSheetMetadata;
    metaB: BaseSheetMetadata;
    resultTable: string;
    keyIds: string[];
    keyHeaders: string[];
    mappingPairs: MappingPair[];
}): Promise<string> {
    const { jobId, metaA, metaB, resultTable, keyIds, keyHeaders, mappingPairs } = params;
    await fs.mkdir(EXPORT_DIR, { recursive: true });
    const fileName = `Base_Comparativo_${jobId}.xlsx`;
    const filePath = path.join(EXPORT_DIR, fileName);
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useStyles: true, useSharedStrings: true });
    const sheetResultado = workbook.addWorksheet('Resultado');
    const baseHeaders = metaA.columns.map((col) => col.header);
    const finalHeaders = baseHeaders.concat(keyHeaders, EXTRA_FINAL_HEADERS);

    // styled header row for combined sheet (use Base A header color)
    const headerRow = sheetResultado.addRow(finalHeaders);
    headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } } as any;
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: BASE_A_STYLES.header },
        } as any;
        cell.alignment = { vertical: 'middle', horizontal: 'center' } as any;
    });
    headerRow.commit();

    let rowIndex = 2;
    try {
        await streamBaseRows({
            meta: metaA,
            side: 'A',
            resultTable,
            keyIds,
            onRow: (row) => {
                const rowArr = metaA.columns.map((col) => {
                    const value = row.baseValues[col.sqliteName];
                    return coerceValue(value, col.sqliteType);
                });
                for (const key of keyIds) rowArr.push(row.keyValues[key] ?? null);
                rowArr.push(row.status ?? null);
                rowArr.push(row.chave ?? null);
                rowArr.push(row.grupo ?? null);

                const excelRow = sheetResultado.addRow(rowArr);
                // apply Base A alternating shading
                if ((rowIndex % 2) === 0) {
                    const rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BASE_A_STYLES.rowColor2 } } as any;
                    excelRow.eachCell((cell) => { cell.fill = rowFill; });
                }
                excelRow.commit();
                rowIndex += 1;
            }
        });

        const mapping = buildColumnMapping(metaA, metaB, mappingPairs);

        await streamBaseRows({
            meta: metaB,
            side: 'B',
            resultTable,
            keyIds,
            onRow: (row) => {
                const rowArr = metaA.columns.map((col) => {
                    const mappedCol = mapping.get(col.sqliteName);
                    if (!mappedCol) {
                        return coerceValue(null, col.sqliteType);
                    }
                    const value = row.baseValues[mappedCol];
                    return coerceValue(value, col.sqliteType);
                });
                for (const key of keyIds) rowArr.push(row.keyValues[key] ?? null);
                rowArr.push(row.status ?? null);
                rowArr.push(row.chave ?? null);
                rowArr.push(row.grupo ?? null);

                const excelRow = sheetResultado.addRow(rowArr);
                // apply Base B alternating shading
                if ((rowIndex % 2) === 0) {
                    const rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BASE_B_STYLES.rowColor2 } } as any;
                    excelRow.eachCell((cell) => { cell.fill = rowFill; });
                }
                excelRow.commit();
                rowIndex += 1;
            }
        });
    } finally {
        (sheetResultado as any).commit?.();
        await workbook.commit();
    }

    return filePath;
}

export async function getExportFilePathForJob(jobId: number) {
    const job = await jobsRepo.getJobById(jobId);
    if (!job) throw new Error('job not found');
    return job.arquivo_exportado || null;
}

export async function ensureExportExists(jobId: number) {
    const existing = await getExportFilePathForJob(jobId);
    if (existing) {
        const abs = path.resolve(process.cwd(), existing);
        try {
            await fs.access(abs);
            return { path: existing, filename: path.basename(abs) };
        } catch (e) {
            // file missing, regenerate
        }
    }
    // Prefer ZIP export with both Base_A and Base_B
    return await exportJobResultToZip(jobId);
}

export default { exportJobResultToXlsx, getExportFilePathForJob, ensureExportExists };
