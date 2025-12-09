#!/usr/bin/env node
/**
 * Convert .xlsx -> JSONL using exceljs streaming reader.
 * This refactor focuses on clarity, single-responsibility helpers, input validation,
 * early returns and safe resource handling.
 *
 * Usage: node scripts/xlsx_to_jsonl.js input.xlsx output.jsonl [sheetIndex] [maxRows] [columnsCsv]
 */

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

// Exit codes
const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_VALIDATION = 3;
const EXIT_RUNTIME = 1;

// Defaults
const DEFAULT_SHEET_INDEX = 1;

/** Ensure a directory exists for the given file path. */
function ensureParentDir(filePath) {
    const dir = path.dirname(filePath);
    if (dir && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/** Parse and validate CLI arguments. Returns a normalized options object or exits. */
function parseArgsOrExit() {
    const argv = process.argv.slice(2);
    if (argv.length < 2) {
        console.error('Usage: node scripts/xlsx_to_jsonl.js input.xlsx output.jsonl [sheetIndex] [maxRows] [columnsCsv]');
        process.exit(EXIT_USAGE);
    }

    const input = path.resolve(argv[0]);
    const output = path.resolve(argv[1]);
    const sheetIndex = argv[2] ? Number(argv[2]) : DEFAULT_SHEET_INDEX;
    const maxRows = argv[3] ? Number(argv[3]) : null;
    const columnsCsv = argv[4] ? String(argv[4]).trim() : null;
    const columns = columnsCsv ? columnsCsv.split(',').map(s => s.trim()).filter(Boolean) : null;

    if (!Number.isInteger(sheetIndex) || sheetIndex <= 0) {
        console.error('sheetIndex must be a positive integer');
        process.exit(EXIT_VALIDATION);
    }
    if (maxRows !== null && (!Number.isInteger(maxRows) || maxRows <= 0)) {
        console.error('maxRows must be a positive integer when provided');
        process.exit(EXIT_VALIDATION);
    }

    return { input, output, sheetIndex, maxRows, columns };
}

/** Returns true if the provided value is an Excel date-like value. */
function isDateValue(v) {
    if (!v) return false;
    if (v instanceof Date) return true;
    if (typeof v === 'object' && v.result instanceof Date) return true;
    return false;
}

/** Normalize a single cell value into a JSON-friendly primitive. */
function normalizeCellValue(cell) {
    if (!cell || cell.value == null) return null;
    const v = cell.value;

    if (isDateValue(v)) {
        // Prefer the displayed text when available, else fall back to ISO timestamp
        const text = typeof cell.text === 'string' ? cell.text : null;
        if (text) return text;
        if (v instanceof Date) return v.toISOString();
        return new Date(v.result).toISOString();
    }

    if (typeof v === 'number') {
        // Preserve numeric as object with string to avoid float precision surprises
        return { __num__: String(v) };
    }

    if (v && typeof v === 'object') {
        if (Array.isArray(v.richText)) {
            return v.richText.map(p => p.text || '').join('');
        }
        // Formula result case: pick the result if present and primitive
        if ('result' in v && (typeof v.result === 'string' || typeof v.result === 'number' || v.result instanceof Date)) {
            if (v.result instanceof Date) return v.result.toISOString();
            if (typeof v.result === 'number') return { __num__: String(v.result) };
            return v.result;
        }
        // Fallback to stringifying objects that are not directly JSON serializable
        try {
            JSON.stringify(v);
            return v;
        } catch (err) {
            return String(v);
        }
    }

    // primitives (string, boolean)
    return v;
}

/** Write a JSON line safely to the provided write stream. */
function writeJsonLine(stream, obj) {
    stream.write(JSON.stringify(obj) + '\n');
}

/** Convert the specified sheet (1-based index) from an XLSX file to JSONL. */
async function convertXlsxToJsonl({ input, output, sheetIndex = DEFAULT_SHEET_INDEX, maxRows = null, columns = null }) {
    ensureParentDir(output);
    const outStream = fs.createWriteStream(output, { encoding: 'utf8' });
    let written = 0;
    try {
        const reader = new ExcelJS.stream.xlsx.WorkbookReader(input, { entries: 'emit', sharedStrings: 'cache', styles: 'cache' });
        let currentSheet = 0;
        for await (const worksheet of reader) {
            currentSheet += 1;
            if (currentSheet < sheetIndex) continue;
            if (currentSheet > sheetIndex) break;

            if (!worksheet || !worksheet.name) {
                throw new Error(`Sheet index ${sheetIndex} not found`);
            }

            for await (const row of worksheet) {
                if (maxRows !== null && written >= maxRows) break;

                const rowArray = [];

                // Determine maximum cell index to iterate
                const maxIndex = columns
                    ? Math.max(...columns.map(c => Number(c)).filter(n => Number.isInteger(n) && n > 0))
                    : (row.actualCellCount || row.cellCount || 0);

                for (let c = 1; c <= maxIndex; c++) {
                    if (columns && !columns.includes(String(c)) && !columns.includes(c)) continue;
                    const cell = row.getCell(c);
                    rowArray.push(normalizeCellValue(cell));
                }

                writeJsonLine(outStream, rowArray);
                written += 1;
            }
            break; // only process the requested sheet
        }
    } finally {
        // Ensure stream is closed even on errors
        outStream.end();
    }

    return { written };
}

/** Entry point. Parses args and runs conversion, writing a JSON status to stdout. */
async function main() {
    const opts = parseArgsOrExit();
    const meta = { input: opts.input, output: opts.output, sheetIndex: opts.sheetIndex, maxRows: opts.maxRows, columns: opts.columns };
    try {
        const start = Date.now();
        const { written } = await convertXlsxToJsonl(opts);
        const durationMs = Date.now() - start;
        const bytes = fs.existsSync(opts.output) ? fs.statSync(opts.output).size : null;
        console.log(JSON.stringify({ status: 'ok', ...meta, written, durationMs, bytes }));
        process.exit(EXIT_OK);
    } catch (err) {
        console.error(JSON.stringify({ status: 'error', ...meta, error: err && err.message ? err.message : String(err) }));
        process.exit(EXIT_RUNTIME);
    }
}

if (require.main === module) {
    main();
}
