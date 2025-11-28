#!/usr/bin/env node
/**
 * Convert .xlsx -> JSONL using exceljs streaming reader
 * Usage: node scripts/xlsx_to_jsonl.js input.xlsx output.jsonl [sheetIndex]
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

async function convert(input, output, sheetIndex = 1) {
    const outStream = fs.createWriteStream(output, { encoding: 'utf8' });
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(input);
    let written = 0;
    for await (const worksheet of reader) {
        // only process requested sheet (1-based index)
        if (worksheet.id != null) {
            // exceljs worksheet.id may be string or number; use counter instead
        }
        // we assume order of reader yields worksheets in file order; decrement index
        if (sheetIndex > 1) {
            sheetIndex -= 1;
            continue;
        }
        for await (const row of worksheet) {
            const arr = [];
            // row.getCell is 1-based
            const max = row.actualCellCount || row.cellCount || 0;
            for (let c = 1; c <= max; c++) {
                const cell = row.getCell(c);
                if (!cell || cell.value == null) {
                    arr.push(null);
                    continue;
                }
                const v = cell.value;
                if (typeof v === 'number') {
                    // emit numeric as marked object with decimal string
                    arr.push({ __num__: String(v) });
                } else if (v && typeof v === 'object' && v.hasOwnProperty('richText')) {
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
        break; // only first (or selected) worksheet
    }
    outStream.end();
    return written;
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.error('Usage: node scripts/xlsx_to_jsonl.js input.xlsx output.jsonl [sheetIndex]');
        process.exit(2);
    }
    const input = path.resolve(args[0]);
    const output = path.resolve(args[1]);
    const sheetIndex = args[2] ? Number(args[2]) : 1;
    try {
        const count = await convert(input, output, sheetIndex);
        console.log('written', count);
        process.exit(0);
    } catch (e) {
        console.error(e && e.stack ? e.stack : e);
        process.exit(1);
    }
}

main();
