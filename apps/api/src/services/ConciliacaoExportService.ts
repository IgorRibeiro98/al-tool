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
    columns: Array<{ sqliteName: string; header: string; sqliteType?: string | null; is_monetary?: number | null }>;
}

async function extractKeyIdentifiers(cfgRow: any): Promise<string[]> {
    const chavesContabil = parseChaves(cfgRow?.chaves_contabil);
    const chavesFiscal = parseChaves(cfgRow?.chaves_fiscal);
    let ids = Array.from(new Set([...Object.keys(chavesContabil || {}), ...Object.keys(chavesFiscal || {})]));

    // If legacy inline chaves are not present, try to load linked keys from configs_conciliacao_keys
    if (!ids || ids.length === 0) {
        try {
            const rows = await db('configs_conciliacao_keys').where({ config_conciliacao_id: cfgRow?.id }).orderBy('ordem', 'asc').select('key_identifier');
            if (rows && rows.length > 0) ids = rows.map((r: any) => String(r.key_identifier));
        } catch (e) {
            // ignore and return whatever we have
            console.warn(`${LOG_PREFIX} could not load linked keys for config ${cfgRow?.id}`, e);
        }
    }

    return ids;
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
    rowColor1: 'FFE8F0FE',
    rowColor2: 'FFE8F0FE',
};

const BASE_B_STYLES = {
    header: 'FF78909C',
    rowColor1: 'FFFFFFFF',
    rowColor2: 'FFFFFFFF',
};

const LOG_PREFIX = '[conciliacao-export]';
const ZIP_COMPRESSION_LEVEL = 9;
const WORKBOOK_OPTIONS = { useStyles: true, useSharedStrings: true } as const;
const EXPORT_CHUNK_SIZE = 1000; // rows per DB fetch when chunking exports

function createWorkbookWriter(filePath: string) {
    return new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, ...WORKBOOK_OPTIONS });
}

function styleHeaderRow(row: ExcelJS.Row, headerColor: string) {
    row.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } } as any;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerColor } } as any;
        cell.alignment = { vertical: 'middle', horizontal: 'center' } as any;
    });
    row.commit();
}

function applyAlternateRowShading(row: ExcelJS.Row, isEven: boolean, colorOdd?: string | null, colorEven?: string | null) {
    const color = isEven ? colorEven : colorOdd;
    if (!color) return;
    const fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } } as any;
    row.eachCell((cell) => { cell.fill = fill; });
}

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

    const keyIdentifiers = await extractKeyIdentifiers(cfgRow);
    const keyHeaders = buildKeyHeaders(keyIdentifiers);

    // stream to an ExcelJS file to avoid loading all rows in memory
    await fs.mkdir(EXPORT_DIR, { recursive: true });
    const filename = `conciliacao_${jobId}.xlsx`;
    const filePath = path.join(EXPORT_DIR, filename);
    const workbook = createWorkbookWriter(filePath);
    const sheet = workbook.addWorksheet('resultado');

    const baseHeaders = ['id', 'chave', 'status', 'grupo', 'a_row_id', 'b_row_id', 'value_a', 'value_b', 'difference', 'a_values', 'b_values', 'created_at'];
    const finalHeaders = baseHeaders.concat(keyHeaders);

    // header styling (use neutral header from Base A colors)
    const headerRow = sheet.addRow(finalHeaders);
    styleHeaderRow(headerRow, BASE_A_STYLES.header);

    // stream rows from DB in chunks to reduce memory / sqlite pressure
    let rowIndex = 2;
    const monetaryFieldNames = ['value_a', 'value_b', 'difference'];
    const monetaryIndexes: number[] = monetaryFieldNames
        .map((n) => finalHeaders.indexOf(n))
        .filter(i => i >= 0)
        .map(i => i + 1);

    try {
        let lastId = 0;
        while (true) {
            const rows: any[] = await db.select(finalHeaders).from(resultTable)
                .where('id', '>', lastId)
                .orderBy('id', 'asc')
                .limit(EXPORT_CHUNK_SIZE);
            if (!rows || rows.length === 0) break;

            for (const r of rows) {
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
                applyAlternateRowShading(excelRow, (rowIndex % 2) === 0, null, 'FFF2F2F2');
                try { applyMonetaryFormattingToRow(excelRow, monetaryIndexes); } catch (e) {}
                excelRow.commit();
                lastId = Number(r.id) || lastId;
                rowIndex += 1;
            }
        }
    } finally {
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
    const keyIds = await extractKeyIdentifiers(cfg);
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
            is_monetary: typeof c.is_monetary === 'undefined' || c.is_monetary === null ? 0 : Number(c.is_monetary),
        })),
    };
}

/**
 * Apply Brazilian-style monetary formatting to specified 1-based column indexes on an ExcelJS Row.
 * - Attempts to coerce cell values to Number when possible and sets numFmt to '#,##0.00'.
 */
function applyMonetaryFormattingToRow(row: ExcelJS.Row, monetaryIndexes: number[]) {
    if (!monetaryIndexes || monetaryIndexes.length === 0) return;
    for (const idx of monetaryIndexes) {
        try {
            const cell = row.getCell(idx);
            if (!cell) continue;
            let raw = cell.value as any;

            // Normalize strings like "12.345,67" or "12345,67" to parse as number
            if (typeof raw === 'string') {
                const trimmed = raw.trim();
                if (trimmed === '' || trimmed.toUpperCase() === 'NULL') {
                    // keep as null/empty
                    cell.value = null;
                    continue;
                }
                // Replace thousand separators and unify decimal separator to dot
                const onlyDigits = trimmed.replace(/\./g, '').replace(/,/g, '.');
                const n = Number(onlyDigits);
                if (Number.isFinite(n)) {
                    cell.value = n;
                    cell.numFmt = '#,##0.00';
                    continue;
                }
            }

            // If already numeric, apply format
            if (typeof raw === 'number' && Number.isFinite(raw)) {
                cell.value = raw;
                cell.numFmt = '#,##0.00';
                continue;
            }

            // If value is Date or other, skip formatting
        } catch (e) {
            // tolerate formatting errors and continue
            // eslint-disable-next-line no-console
            console.warn(`${LOG_PREFIX} applyMonetaryFormattingToRow failed for idx=${idx}`, e);
        }
    }
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
    const workbook = createWorkbookWriter(filePath);
    const sheet = workbook.addWorksheet(side === 'A' ? 'Base_A' : 'Base_B');
    const baseHeaders = meta.columns.map((col) => col.header);
    const finalHeaders = baseHeaders.concat(keyHeaders, EXTRA_FINAL_HEADERS);

    // Add styled header row (stream-safe): style before commit
    const headerRow = sheet.addRow(finalHeaders);
    const styles = side === 'A' ? BASE_A_STYLES : BASE_B_STYLES;
    styleHeaderRow(headerRow, styles.header);

    let rowIndex = 2; // starting after header
    // precompute monetary indexes for this base sheet
    const baseMonetaryIndexes = meta.columns
        .map((c, i) => ({ c, i }))
        .filter(x => Number(x.c.is_monetary) === 1)
        .map(x => x.i + 1);

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
                const isEven = (rowIndex % 2) === 0;
                applyAlternateRowShading(excelRow, isEven, styles.rowColor1, styles.rowColor2);
                try { applyMonetaryFormattingToRow(excelRow, baseMonetaryIndexes); } catch (e) { }
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
    const workbook = createWorkbookWriter(filePath);
    const sheetResultado = workbook.addWorksheet('Resultado');
    const baseHeaders = metaA.columns.map((col) => col.header);
    const finalHeaders = baseHeaders.concat(keyHeaders, EXTRA_FINAL_HEADERS);

    // styled header row for combined sheet (use Base A header color)
    const headerRow = sheetResultado.addRow(finalHeaders);
    styleHeaderRow(headerRow, BASE_A_STYLES.header);

    let rowIndex = 2;
    // precompute monetary indexes for metaA (applies to both A rows and mapped B rows)
    const monetaryIndexesA = metaA.columns
        .map((c, i) => ({ c, i }))
        .filter(x => Number(x.c.is_monetary) === 1)
        .map(x => x.i + 1);

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
                applyAlternateRowShading(excelRow, (rowIndex % 2) === 0, BASE_A_STYLES.rowColor1, BASE_A_STYLES.rowColor2);
                try { applyMonetaryFormattingToRow(excelRow, monetaryIndexesA); } catch (e) {}
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
                applyAlternateRowShading(excelRow, (rowIndex % 2) === 0, BASE_B_STYLES.rowColor1, BASE_B_STYLES.rowColor2);
                try { applyMonetaryFormattingToRow(excelRow, monetaryIndexesA); } catch (e) {}
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
