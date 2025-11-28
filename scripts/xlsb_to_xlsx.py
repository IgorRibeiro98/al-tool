#!/usr/bin/env python3
"""
Simple streaming converter: .xlsb -> .xlsx
- Uses pyxlsb to iterate rows streaming (low memory)
- Writes an .xlsx using openpyxl write_only workbook

Usage:
  python scripts/xlsb_to_xlsx.py input.xlsb output.xlsx

Options:
  --sheet INDEX   # 1-based sheet index to convert (default: 1)
  --jsonl         # instead of writing .xlsx, emit JSONL with Decimal strings

Notes:
- This script preserves numeric values by reading them and converting to Decimal for
  a stable string representation when --jsonl is used. When writing .xlsx, numeric
  cells are written as floats (openpyxl writes Python numbers into numeric cells).
- Install requirements: pip install pyxlsb openpyxl
"""

import argparse
import json
import sys
from decimal import Decimal
import datetime as _dt
from pyxlsb import open_workbook
from openpyxl import Workbook
from openpyxl import load_workbook


def _normalize_value_for_json(v):
    """Normalize cell values to JSON-serializable primitives.
    - numbers -> {"__num__": "<decimal>"}
    - dates/datetimes -> ISO string
    - Decimal -> decimal string object
    - others: leave if JSON serializable, else str(v)
    """
    if v is None:
        return None
    if isinstance(v, (int, float)):
        d = Decimal(str(v))
        return {"__num__": format(d, 'f')}
    if isinstance(v, Decimal):
        return {"__num__": format(v, 'f')}
    if isinstance(v, (_dt.datetime, _dt.date)):
        return v.isoformat()
    if isinstance(v, bool):
        return v
    # try json-serializable as-is
    try:
        json.dumps(v)
        return v
    except TypeError:
        return str(v)


def convert_xlsb_to_xlsx(inpath: str, outpath: str, sheet_index: int = 1):
    wb_out = Workbook(write_only=True)
    # We'll create a single sheet corresponding to sheet_index
    ws_out = wb_out.create_sheet(title=f"Sheet{sheet_index}")

    with open_workbook(inpath) as wb:
        # pyxlsb sheets are 1-based by index
        sheet_names = list(wb.sheets)
        if sheet_index < 1 or sheet_index > len(sheet_names):
            raise ValueError(f"sheet_index {sheet_index} out of range (1..{len(sheet_names)})")
        sheet_name = sheet_names[sheet_index - 1]
        with wb.get_sheet(sheet_name) as sheet:
            for row in sheet.rows():
                # row is a sequence of pyxlsb.Cell or None
                out_row = []
                for cell in row:
                    if cell is None or cell.v is None:
                        out_row.append(None)
                    else:
                        v = cell.v
                        # For numbers, keep Python numeric type (int/float)
                        # For other types, keep as-is
                        out_row.append(v)
                ws_out.append(out_row)

    wb_out.save(outpath)


def convert_xlsb_to_jsonl(inpath: str, outpath: str, sheet_index: int = 1):
    # JSONL format: each line is a JSON array representing the row values
    # Numeric values are emitted as {"__num__": "<decimal-string>"} to preserve exact decimal representation
    with open(outpath, 'w', encoding='utf-8') as fout:
        with open_workbook(inpath) as wb:
            sheet_names = list(wb.sheets)
            if sheet_index < 1 or sheet_index > len(sheet_names):
                raise ValueError(f"sheet_index {sheet_index} out of range (1..{len(sheet_names)})")
            sheet_name = sheet_names[sheet_index - 1]
            with wb.get_sheet(sheet_name) as sheet:
                for row in sheet.rows():
                    out_row = []
                    for cell in row:
                        if cell is None or cell.v is None:
                            out_row.append(None)
                            continue
                        v = cell.v
                        out_row.append(_normalize_value_for_json(v))
                    fout.write(json.dumps(out_row, ensure_ascii=False) + '\n')


def convert_xlsx_to_jsonl(inpath: str, outpath: str, sheet_index: int = 1):
    # Use openpyxl in read_only mode to stream rows and write JSONL
    with open(outpath, 'w', encoding='utf-8') as fout:
        wb = load_workbook(filename=inpath, read_only=True, data_only=True)
        sheets = wb.sheetnames
        if sheet_index < 1 or sheet_index > len(sheets):
            raise ValueError(f"sheet_index {sheet_index} out of range (1..{len(sheets)})")
        sheet = wb[sheets[sheet_index - 1]]
        for row in sheet.iter_rows(values_only=True):
            out_row = []
            for v in row:
                out_row.append(_normalize_value_for_json(v))
            fout.write(json.dumps(out_row, ensure_ascii=False) + '\n')


def main(argv):
    p = argparse.ArgumentParser(description='Convert .xlsb to .xlsx or JSONL (streaming)')
    p.add_argument('infile')
    p.add_argument('outfile')
    p.add_argument('--sheet', type=int, default=1, help='1-based sheet index to convert')
    p.add_argument('--jsonl', action='store_true', help='emit JSONL instead of XLSX (preserves numeric as Decimal strings)')
    args = p.parse_args(argv[1:])

    infile_lower = args.infile.lower()
    if args.jsonl:
        if infile_lower.endswith('.xlsb'):
            convert_xlsb_to_jsonl(args.infile, args.outfile, sheet_index=args.sheet)
        elif infile_lower.endswith('.xlsx') or infile_lower.endswith('.xls'):
            convert_xlsx_to_jsonl(args.infile, args.outfile, sheet_index=args.sheet)
        else:
            # fallback: try xlsb reader first, else attempt openpyxl
            try:
                convert_xlsb_to_jsonl(args.infile, args.outfile, sheet_index=args.sheet)
            except Exception:
                convert_xlsx_to_jsonl(args.infile, args.outfile, sheet_index=args.sheet)
    else:
        # default behavior: only support xlsb -> xlsx
        convert_xlsb_to_xlsx(args.infile, args.outfile, sheet_index=args.sheet)


if __name__ == '__main__':
    main(sys.argv)
