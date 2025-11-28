import db from '../db/knex';
import XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { fileStorage } from '../infra/storage/FileStorage';
import * as jobsRepo from '../repos/jobsRepository';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import archiver from 'archiver';

export async function exportJobResultToXlsx(jobId: number) {
    const job = await jobsRepo.getJobById(jobId);
    if (!job) throw new Error('job not found');

    const resultTable = `conciliacao_result_${jobId}`;
    const hasTable = await db.schema.hasTable(resultTable);
    if (!hasTable) throw new Error('result table not found');

    const rows = await db(resultTable).select('*').orderBy('id', 'asc');

    // Prepare rows for sheet: include status, grupo, chave, value_a, value_b, difference, a_values, b_values
    const sheetData = rows.map((r: any) => ({
        id: r.id,
        chave: r.chave,
        status: r.status,
        grupo: r.grupo,
        a_row_id: r.a_row_id,
        b_row_id: r.b_row_id,
        value_a: r.value_a,
        value_b: r.value_b,
        difference: r.difference,
        a_values: typeof r.a_values === 'string' ? r.a_values : JSON.stringify(r.a_values || null),
        b_values: typeof r.b_values === 'string' ? r.b_values : JSON.stringify(r.b_values || null),
        created_at: r.created_at
    }));

    const ws = XLSX.utils.json_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'resultado');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // ensure exports dir exists and save file
    const filename = `conciliacao_${jobId}.xlsx`;
    const relPath = await fileStorage.saveFile(Buffer.from(buffer), filename);

    // update job record with path
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

    const baseAId = cfg.base_contabil_id;
    const baseBId = cfg.base_fiscal_id;

    // helper to build sheet file for a base using ExcelJS streaming writer (writes to disk)
    async function buildSheetFileForBase(baseId: number, side: 'A' | 'B') {
        const base = await db('bases').where({ id: baseId }).first();
        if (!base) throw new Error(`base ${baseId} not found`);
        const tableName = base.tabela_sqlite;
        if (!tableName) throw new Error(`base ${baseId} has no tabela_sqlite`);

        // reconstruct ordered columns
        const cols = await db('base_columns').where({ base_id: baseId }).orderBy('col_index', 'asc');
        if (!cols || cols.length === 0) throw new Error(`no base_columns metadata for base ${baseId}`);
        const sqliteCols = cols.map((c: any) => c.sqlite_name);
        const headers = cols.map((c: any) => (c.excel_name == null ? c.sqlite_name : String(c.excel_name)));

        // prepare file path
        const exportsDirLocal = path.resolve(process.cwd(), 'storage', 'exports');
        await fs.mkdir(exportsDirLocal, { recursive: true });
        const fileName = `${side === 'A' ? 'Base_A' : 'Base_B'}_${jobId}.xlsx`;
        const filePath = path.join(exportsDirLocal, fileName);

        // create streaming workbook writer
        const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath });
        const sheetName = side === 'A' ? 'Base_A' : 'Base_B';
        const ws = workbook.addWorksheet(sheetName);

        // write header
        const finalHeaders = headers.concat(['status', 'chave', 'grupo']);
        ws.addRow(finalHeaders).commit();

        // build select columns and left join to result table
        const selectCols = sqliteCols.map((c: string) => `${tableName}.${c}`);
        const joinCondition = side === 'A' ? `${resultTable}.a_row_id = ${tableName}.id` : `${resultTable}.b_row_id = ${tableName}.id`;

        // use stream to avoid loading all rows in memory
        const query = db.select(selectCols.concat([`${resultTable}.status as _status`, `${resultTable}.chave as _chave`, `${resultTable}.grupo as _grupo`]))
            .from(tableName)
            .leftJoin(resultTable, db.raw(joinCondition))
            .orderBy(`${tableName}.id`, 'asc');

        const stream: any = await (query as any).stream();
        try {
            for await (const r of stream) {
                const rowArr = sqliteCols.map((c: string) => {
                    const v = r[c];
                    return v === undefined ? null : v;
                });
                rowArr.push(r._status ?? null);
                rowArr.push(r._chave ?? null);
                rowArr.push(r._grupo ?? null);
                ws.addRow(rowArr).commit();
            }
        } finally {
            // ensure workbook is finalized even if stream breaks
            await workbook.commit();
            // ensure the stream is destroyed/closed
            try { stream.destroy && stream.destroy(); } catch (e) { }
        }

        return filePath;
    }

    const fileA = await buildSheetFileForBase(baseAId, 'A');
    const fileB = await buildSheetFileForBase(baseBId, 'B');

    // ensure exports dir
    const exportsDir = path.resolve(process.cwd(), 'storage', 'exports');
    await fs.mkdir(exportsDir, { recursive: true });
    const zipFilename = `conciliacao_${jobId}.zip`;
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
        archive.finalize().catch(reject);
    });

    const rel = path.relative(process.cwd(), zipAbs).split(path.sep).join(path.posix.sep);
    await jobsRepo.setJobExportPath(jobId, rel);

    return { path: rel, filename: zipFilename };
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
