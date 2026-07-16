"""Exportação do resultado de conciliação para XLSX.

Port do essencial de ConciliacaoExportService.ts: aba estilizada + formatação monetária
BR (#,##0.00). Usa xlsxwriter em modo `constant_memory` (streaming), equivalente ao
WorkbookWriter streaming da v1 — importante para exportar centenas de milhares de linhas
sem estourar RAM.
"""

from __future__ import annotations

from pathlib import Path
from typing import Sequence

import duckdb

# Cores da v1 (ConciliacaoExportService.ts:56,62).
HEADER_COLOR_A = "#3C78D8"  # azul (Base A / neutro)
HEADER_COLOR_B = "#78909C"  # cinza (Base B)
MONEY_FMT = "#,##0.00"  # formatação monetária brasileira

# Colunas monetárias padrão do conciliacao_result.
DEFAULT_MONETARY = ("value_a", "value_b", "difference")

_FETCH_CHUNK = 10_000


def export_resultado_xlsx(
    con: duckdb.DuckDBPyConnection,
    result_table: str,
    out_path: str,
    *,
    monetary_cols: Sequence[str] = DEFAULT_MONETARY,
    header_color: str = HEADER_COLOR_A,
    sheet_name: str = "resultado",
) -> int:
    """Escreve `result_table` em `out_path` (.xlsx). Retorna o nº de linhas de dados.

    Header estilizado (fundo colorido, fonte branca bold); colunas monetárias com
    numFmt BR. Streaming: linhas puxadas do DuckDB em blocos e escritas incrementalmente.
    """
    import xlsxwriter

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    columns = [d[0] for d in con.execute(
        f'SELECT * FROM "{result_table}" LIMIT 0'
    ).description]
    money_idx = {i for i, c in enumerate(columns) if c in set(monetary_cols)}

    wb = xlsxwriter.Workbook(out_path, {"constant_memory": True})
    try:
        ws = wb.add_worksheet(sheet_name)
        header_fmt = wb.add_format(
            {"bold": True, "font_color": "#FFFFFF", "bg_color": header_color}
        )
        money_fmt = wb.add_format({"num_format": MONEY_FMT})

        for col, name in enumerate(columns):
            ws.write(0, col, name, header_fmt)

        cur = con.execute(f'SELECT * FROM "{result_table}"')
        row_idx = 0
        while True:
            batch = cur.fetchmany(_FETCH_CHUNK)
            if not batch:
                break
            for record in batch:
                row_idx += 1
                for col, value in enumerate(record):
                    if col in money_idx:
                        num = _as_number(value)
                        if num is None:
                            ws.write(row_idx, col, value)
                        else:
                            ws.write_number(row_idx, col, num, money_fmt)
                    else:
                        ws.write(row_idx, col, value)
        return row_idx
    finally:
        wb.close()


def _as_number(value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).replace(",", "."))
    except ValueError:
        return None
