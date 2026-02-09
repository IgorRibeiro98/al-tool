#!/usr/bin/env node
/**
 * Convert .xlsx -> Apache Arrow IPC format using exceljs streaming reader.
 * 
 * Apache Arrow IPC format provides 10-100x faster read/write compared to JSONL:
 * - Binary columnar format optimized for analytics
 * - Zero-copy reads with memory-mapping
 * - Native type preservation (integers, floats, strings, dates)
 * - SIMD-friendly data layout
 *
 * Usage: node scripts/xlsx_to_arrow.js input.xlsx output.arrow [sheetIndex] [maxRows] [headerRow] [startCol]
 */

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const Arrow = require('apache-arrow');

// Exit codes
const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_VALIDATION = 3;
const EXIT_RUNTIME = 1;

// Defaults
const DEFAULT_SHEET_INDEX = 1;
const SCHEMA_SAMPLE_ROWS = 1000;
const BATCH_SIZE = 50000;

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
        console.error('Usage: node scripts/xlsx_to_arrow.js input.xlsx output.arrow [sheetIndex] [maxRows] [headerRow] [startCol]');
        process.exit(EXIT_USAGE);
    }

    const input = path.resolve(argv[0]);
    const output = path.resolve(argv[1]);
    const sheetIndex = argv[2] ? Number(argv[2]) : DEFAULT_SHEET_INDEX;
    const maxRows = argv[3] ? Number(argv[3]) : null;
    const headerRow = argv[4] ? Number(argv[4]) : 1;  // 1-based
    const startCol = argv[5] ? Number(argv[5]) : 1;   // 1-based

    if (!Number.isInteger(sheetIndex) || sheetIndex <= 0) {
        console.error('sheetIndex must be a positive integer');
        process.exit(EXIT_VALIDATION);
    }
    if (maxRows !== null && (!Number.isInteger(maxRows) || maxRows <= 0)) {
        console.error('maxRows must be a positive integer when provided');
        process.exit(EXIT_VALIDATION);
    }
    if (!Number.isInteger(headerRow) || headerRow < 1) {
        console.error('headerRow must be a positive integer (1-based)');
        process.exit(EXIT_VALIDATION);
    }
    if (!Number.isInteger(startCol) || startCol < 1) {
        console.error('startCol must be a positive integer (1-based)');
        process.exit(EXIT_VALIDATION);
    }

    return { input, output, sheetIndex, maxRows, headerRow, startCol };
}

/**
 * Normaliza números float para evitar artefatos de precisão Float64.
 * Exemplo: 80.93999999999999 -> 80.94
 * 
 * Isso é necessário porque valores decimais em Excel podem ser
 * representados com pequenos erros de precisão em float.
 */
function normalizeNumericPrecision(value) {
    if (typeof value !== 'number') return value;
    if (!Number.isFinite(value)) return value;
    if (Number.isInteger(value)) return value;

    // Arredonda para 10 casas decimais para eliminar artefatos Float64
    const rounded = Math.round(value * 1e10) / 1e10;

    // Remove zeros à direita convertendo para string e de volta
    return parseFloat(rounded.toString());
}

/** Normalize a single cell value into a primitive. */
function normalizeCellValue(cell) {
    if (!cell || cell.value == null) return null;
    const v = cell.value;

    // Handle dates
    if (v instanceof Date) {
        return v;
    }
    if (typeof v === 'object' && v.result instanceof Date) {
        return v.result;
    }

    // Handle numbers - normalize precision to avoid Float64 artifacts
    if (typeof v === 'number') {
        return normalizeNumericPrecision(v);
    }

    // Handle formula results
    if (v && typeof v === 'object') {
        if (Array.isArray(v.richText)) {
            return v.richText.map(p => p.text || '').join('');
        }
        if ('result' in v) {
            if (v.result instanceof Date) return v.result;
            if (typeof v.result === 'number') return normalizeNumericPrecision(v.result);
            if (typeof v.result === 'string') return v.result;
        }
        try {
            return JSON.stringify(v);
        } catch (err) {
            return String(v);
        }
    }

    return v;
}

/** Infer Arrow type from sample values. */
function inferArrowType(values) {
    let hasFloat = false;
    let hasInt = false;
    let hasString = false;
    let hasDate = false;

    for (const v of values) {
        if (v === null || v === undefined) continue;

        if (v instanceof Date) {
            hasDate = true;
        } else if (typeof v === 'number') {
            if (Number.isInteger(v)) {
                hasInt = true;
            } else {
                hasFloat = true;
            }
        } else if (typeof v === 'string') {
            hasString = true;
        }
    }

    // Priority: if any string, use string (safest for mixed data)
    if (hasString) return new Arrow.Utf8();
    if (hasDate) return new Arrow.TimestampMillisecond();
    if (hasFloat) return new Arrow.Float64();
    if (hasInt) return new Arrow.Float64(); // Use float64 for safety (large ints)

    return new Arrow.Utf8(); // Default to string
}

/** Create Arrow schema from header and sample rows. */
function createSchema(header, sampleRows) {
    const numCols = header.length;
    const columnValues = Array.from({ length: numCols }, () => []);

    for (const row of sampleRows) {
        for (let i = 0; i < numCols; i++) {
            columnValues[i].push(row[i]);
        }
    }

    const fields = header.map((name, i) => {
        const safeName = (name && String(name).trim()) || `col_${i}`;
        const type = inferArrowType(columnValues[i]);
        return new Arrow.Field(safeName, type, true);
    });

    return new Arrow.Schema(fields);
}

/** Convert values to match Arrow schema types. */
function convertToTyped(row, schema) {
    return schema.fields.map((field, i) => {
        const v = row[i];
        if (v === null || v === undefined) return null;

        if (Arrow.DataType.isUtf8(field.type)) {
            return String(v);
        }
        if (Arrow.DataType.isFloat(field.type)) {
            const n = Number(v);
            return isNaN(n) ? null : n;
        }
        if (Arrow.DataType.isTimestamp(field.type)) {
            if (v instanceof Date) return v.getTime();
            return null;
        }
        return v;
    });
}

/** Build Arrow Table from rows. */
function buildTable(schema, rows) {
    const numCols = schema.fields.length;
    const columns = Array.from({ length: numCols }, () => []);

    for (const row of rows) {
        const typed = convertToTyped(row, schema);
        for (let i = 0; i < numCols; i++) {
            columns[i].push(typed[i]);
        }
    }

    // Create Arrow vectors
    const vectors = schema.fields.map((field, i) => {
        const data = columns[i];

        if (Arrow.DataType.isUtf8(field.type)) {
            return Arrow.vectorFromArray(data.map(v => v === null ? null : String(v)), new Arrow.Utf8());
        }
        if (Arrow.DataType.isFloat(field.type)) {
            return Arrow.vectorFromArray(data, new Arrow.Float64());
        }
        if (Arrow.DataType.isTimestamp(field.type)) {
            return Arrow.vectorFromArray(data, new Arrow.TimestampMillisecond());
        }
        // Default to string
        return Arrow.vectorFromArray(data.map(v => v === null ? null : String(v)), new Arrow.Utf8());
    });

    return new Arrow.Table(schema, vectors);
}

/** Convert the specified sheet (1-based index) from an XLSX file to Arrow IPC. */
async function convertXlsxToArrow({ input, output, sheetIndex = DEFAULT_SHEET_INDEX, maxRows = null, headerRow = 1, startCol = 1 }) {
    ensureParentDir(output);

    let header = null;
    const sampleRows = [];
    const allRows = [];
    let written = 0;
    // Convert 1-based startCol to 1-based for ExcelJS (which is 1-based)
    const startColOne = Math.max(1, startCol);

    const reader = new ExcelJS.stream.xlsx.WorkbookReader(input, {
        entries: 'emit',
        sharedStrings: 'cache',
        styles: 'cache'
    });

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

            // Skip rows before the header row (row.number is 1-based)
            if (row.number < headerRow) continue;

            // Read cells starting from startCol
            const rowArray = [];
            const maxIndex = row.actualCellCount || row.cellCount || 0;
            const maxC = Math.max(maxIndex, startColOne);

            for (let c = startColOne; c <= maxC; c++) {
                const cell = row.getCell(c);
                rowArray.push(normalizeCellValue(cell));
            }

            // Header row
            if (!header) {
                header = rowArray.map((v, i) => (v && String(v).trim()) || `col_${i}`);
                continue;
            }

            // Pad row to match header length
            while (rowArray.length < header.length) {
                rowArray.push(null);
            }

            // Collect for schema inference and data
            if (sampleRows.length < SCHEMA_SAMPLE_ROWS) {
                sampleRows.push(rowArray);
            }
            allRows.push(rowArray);
            written += 1;
        }
        break; // only process the requested sheet
    }

    if (!header || header.length === 0) {
        throw new Error('No header row found');
    }

    // Create schema from sample rows
    const schema = createSchema(header, sampleRows);

    // Build table and write to Arrow IPC file
    const table = buildTable(schema, allRows);

    // Serialize to IPC stream format
    const writer = Arrow.RecordBatchStreamWriter.writeAll(table);
    const buffer = writer.toUint8Array();

    fs.writeFileSync(output, Buffer.from(buffer));

    return { written, format: 'arrow_ipc' };
}

/** Entry point. Parses args and runs conversion, writing a JSON status to stdout. */
async function main() {
    const opts = parseArgsOrExit();
    const meta = {
        input: opts.input,
        output: opts.output,
        sheetIndex: opts.sheetIndex,
        maxRows: opts.maxRows
    };

    try {
        const start = Date.now();
        const { written, format } = await convertXlsxToArrow(opts);
        const durationMs = Date.now() - start;
        const bytes = fs.existsSync(opts.output) ? fs.statSync(opts.output).size : null;
        console.log(JSON.stringify({
            status: 'ok',
            ...meta,
            written,
            durationMs,
            bytes,
            format
        }));
        process.exit(EXIT_OK);
    } catch (err) {
        console.error(JSON.stringify({
            status: 'error',
            ...meta,
            error: err && err.message ? err.message : String(err)
        }));
        process.exit(EXIT_RUNTIME);
    }
}

if (require.main === module) {
    main();
}

module.exports = { convertXlsxToArrow };
