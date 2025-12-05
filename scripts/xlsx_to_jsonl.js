#!/usr/bin/env node
/**
 * Convert .xlsx -> JSONL using exceljs streaming reader
 * Usage: node scripts/xlsx_to_jsonl.js input.xlsx output.jsonl [sheetIndex]
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

function parseArgs() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.error('Usage: node scripts/xlsx_to_jsonl.js input.xlsx output.jsonl [sheetIndex] [maxRows] [columnsCsv]');
        process.exit(2);
    }
    const input = path.resolve(args[0]);
    const output = path.resolve(args[1]);
    const sheetIndex = args[2] ? Number(args[2]) : 1;
    const maxRows = args[3] ? Number(args[3]) : null;
    const columns = args[4] ? String(args[4]).split(',').map(s => s.trim()).filter(Boolean) : null;

    if (!Number.isInteger(sheetIndex) || sheetIndex <= 0) {
        console.error('sheetIndex must be a positive integer');
        process.exit(3);
    }
    if (maxRows !== null && (!Number.isInteger(maxRows) || maxRows <= 0)) {
        console.error('maxRows must be a positive integer when provided');
        process.exit(4);
    }

    return { input, output, sheetIndex, maxRows, columns };
}

async function convert({ input, output, sheetIndex = 1, maxRows = null, columns = null }) {
    const started = Date.now();
    const outStream = fs.createWriteStream(output, { encoding: 'utf8' });
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(input, { entries: 'emit', sharedStrings: 'cache', styles: 'cache' });
    let written = 0;
    let sheetCounter = 0;

    for await (const worksheet of reader) {
        sheetCounter += 1;
        if (sheetCounter < sheetIndex) {
            continue;
        }
        if (sheetCounter > sheetIndex) {
            break; // already processed requested sheet
        }

        // Validate sheet exists
        if (!worksheet || !worksheet.name) {
            throw new Error(`Sheet index ${sheetIndex} not found`);
        }

        for await (const row of worksheet) {
            if (maxRows !== null && written >= maxRows) {
                break;
            }

            const arr = [];
            // If columns filter provided, only read those indices (1-based), else read all cells present
            const max = columns ? Math.max(...columns.map(c => Number(c)).filter(n => Number.isInteger(n) && n > 0)) : (row.actualCellCount || row.cellCount || 0);
            for (let c = 1; c <= max; c++) {
                if (columns && !columns.includes(String(c)) && !columns.includes(c)) {
                    // skip columns not requested
                    continue;
                }
                const cell = row.getCell(c);
                if (!cell || cell.value == null) {
                    arr.push(null);
                    continue;
                }
                const v = cell.value;
                if (v instanceof Date || (v && typeof v === 'object' && v.result instanceof Date)) {
                    const text = typeof cell.text === 'string' ? cell.text : null;
                    if (text !== null) {
                        arr.push(text);
                    } else if (v instanceof Date) {
                        arr.push(v.toISOString());
                    } else {
                        arr.push(new Date(v.result).toISOString());
                    }
                    continue;
                }
                if (typeof v === 'number') {
                    // emit numeric as marked object with decimal string
                    arr.push({ __num__: String(v) });
                } else if (v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, 'richText')) {
                    // rich text -> join
                    const text = (v.richText || []).map(t => t.text || '').join('');
                    arr.push(text);
                } else {
                    arr.push(v);
                }
            }

            outStream.write(JSON.stringify(arr) + '\n');
            written++;
        }
        break; // only the selected worksheet
    }
    outStream.end();
    const durationMs = Date.now() - started;
    return { written, durationMs };
}

async function main() {
    const { input, output, sheetIndex, maxRows, columns } = parseArgs();
    const meta = { input, output, sheetIndex, maxRows, columns };
    try {
        const { written, durationMs } = await convert({ input, output, sheetIndex, maxRows, columns });
        const stats = { ...meta, written, durationMs, bytes: fs.existsSync(output) ? fs.statSync(output).size : null };
        console.log(JSON.stringify({ status: 'ok', ...stats }));
        process.exit(0);
    } catch (e) {
        console.error(JSON.stringify({ status: 'error', ...meta, error: e && e.message ? e.message : String(e) }));
        process.exit(1);
    }
}

main();
