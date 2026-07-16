"""Ingestão de planilhas → DuckDB.

Substitui o pipeline manual da v1 (StreamingIngestPipeline.ts + conversion_worker.py +
arquivos Arrow) por `read_xlsx` nativo do DuckDB: streaming, spill-to-disk, baixa RAM.

Validado nos dados reais (storage/ref): 429k linhas × 73 colunas / 148MB → ~12s, pico ~508MB
sob PRAGMA memory_limit='900MB' (ver tests/integration/test_ingest_real.py).

Lemos tudo como texto (all_varchar) — fiel à planilha, sem cast lossy no ingest. A tipagem
(monetário/numérico) é aplicada nas etapas de compute via os helpers de nulls.py, reproduzindo
a normalização vírgula→ponto que os dados reais exigem (ex.: "2790022,95").
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import duckdb

from ..domain.columns import sanitize_column_name

# Linha máxima do formato xlsx (limite do Excel).
_XLSX_MAX_ROW = 1_048_576


def col_letter(n: int) -> str:
    """Índice de coluna 1-based → letra do Excel (1→A, 26→Z, 27→AA, 73→BU)."""
    if n < 1:
        raise ValueError(f"coluna deve ser >= 1, recebido {n}")
    s = ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


@dataclass(frozen=True)
class IngestSpec:
    """Configuração de leitura por base (a v1 chama de header/coluna inicial)."""

    header_row: int  # linha do cabeçalho, 1-based (Razão=6, Livro=5)
    start_col: int = 1  # coluna inicial, 1-based (Razão=2/'B', Livro=1/'A')
    sheet: str | None = None  # None → primeira planilha
    max_scan_cols: int = 512  # largura máx. para detectar fim das colunas


def read_header(
    con: duckdb.DuckDBPyConnection, path: str, spec: IngestSpec
) -> tuple[list[str], list[str]]:
    """Lê a linha de cabeçalho e devolve (nomes_originais, nomes_sanitizados).

    Nomes sanitizados seguem sanitize_column_name (fiel à v1), com desduplicação por
    sufixo _2, _3… quando colidem.
    """
    far_col = col_letter(spec.start_col + spec.max_scan_cols - 1)
    rng = f"{col_letter(spec.start_col)}{spec.header_row}:{far_col}{spec.header_row}"
    sheet = f", sheet='{spec.sheet}'" if spec.sheet else ""
    row = con.execute(
        f"SELECT * FROM read_xlsx('{_esc(path)}', header=false, all_varchar=true, "
        f"stop_at_empty=false, range='{rng}'{sheet})"
    ).fetchone()
    if row is None:
        raise ValueError(f"cabeçalho vazio em {path} range={rng}")

    # Corta as colunas vazias do final (trailing).
    values = list(row)
    while values and (values[-1] is None or str(values[-1]).strip() == ""):
        values.pop()
    if not values:
        raise ValueError(f"nenhuma coluna detectada em {path} range={rng}")

    originals = [("" if v is None else str(v)) for v in values]
    sanitized: list[str] = []
    seen: dict[str, int] = {}
    for i, name in enumerate(originals):
        base = sanitize_column_name(name, (spec.start_col - 1) + i)
        if base in seen:
            seen[base] += 1
            base = f"{base}_{seen[base]}"
        else:
            seen[base] = 1
        sanitized.append(base)
    return originals, sanitized


def ingest_xlsx(
    con: duckdb.DuckDBPyConnection, path: str, table: str, spec: IngestSpec
) -> int:
    """Ingere a planilha na tabela `table` do DuckDB. Retorna o número de linhas.

    Colunas viram nomes sanitizados; todos os valores como VARCHAR (fiéis à origem).
    """
    _, sanitized = read_header(con, path, spec)
    n_cols = len(sanitized)
    end_col = col_letter(spec.start_col + n_cols - 1)
    data_range = f"{col_letter(spec.start_col)}{spec.header_row}:{end_col}{_XLSX_MAX_ROW}"
    sheet = f", sheet='{spec.sheet}'" if spec.sheet else ""

    reader = (
        f"read_xlsx('{_esc(path)}', header=true, all_varchar=true, "
        f"stop_at_empty=true, range='{data_range}'{sheet})"
    )
    # DuckDB nomeia as colunas pela linha de cabeçalho (com dedup próprio); referenciamos
    # posicionalmente via #1..#N para aplicar NOSSOS nomes sanitizados sem colisão.
    select_list = ", ".join(f'#{i + 1} AS "{name}"' for i, name in enumerate(sanitized))
    con.execute(f'DROP TABLE IF EXISTS "{table}"')
    con.execute(f'CREATE TABLE "{table}" AS SELECT {select_list} FROM {reader}')
    return con.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]  # type: ignore[index]


def ingest_csv(
    con: duckdb.DuckDBPyConnection, path: str, table: str, spec: IngestSpec
) -> int:
    """Ingere .csv/.txt via read_csv nativo do DuckDB (all_varchar, delimitador auto).

    `header_row` vira `skip` (linhas antes do cabeçalho); `start_col` recorta colunas iniciais.
    """
    skip = spec.header_row - 1
    reader = (
        f"read_csv('{_esc(path)}', header=true, all_varchar=true, skip={skip}, "
        f"auto_detect=true, null_padding=true, ignore_errors=false)"
    )
    orig = [d[0] for d in con.execute(f"SELECT * FROM {reader} LIMIT 0").description]
    sel = orig[spec.start_col - 1 :]
    if not sel:
        raise ValueError(f"nenhuma coluna a partir de start_col={spec.start_col} em {path}")
    sanitized = _sanitize_unique(sel, spec.start_col)
    select_list = ", ".join(
        f'#{spec.start_col + i} AS "{name}"' for i, name in enumerate(sanitized)
    )
    con.execute(f'DROP TABLE IF EXISTS "{table}"')
    con.execute(f'CREATE TABLE "{table}" AS SELECT {select_list} FROM {reader}')
    return con.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]  # type: ignore[index]


def ingest_calamine(
    con: duckdb.DuckDBPyConnection, path: str, table: str, spec: IngestSpec
) -> int:
    """Ingere .xlsb/.xls/.xlsx via calamine (todos os valores como texto).

    Mesmo code path para xlsb e xlsx — calamine lê ambos. É o caminho para .xlsb
    (a v1 usa pyxlsb pelo mesmo motivo). Fidelidade de formatação de float em células
    numéricas de xlsb é questão de oráculo (Fase 4).
    """
    import pyarrow as pa
    import python_calamine as pc

    wb = pc.load_workbook(path)
    sheet = wb.get_sheet_by_name(spec.sheet) if spec.sheet else wb.get_sheet_by_index(0)
    data = sheet.to_python()
    hidx = spec.header_row - 1
    sidx = spec.start_col - 1
    if hidx >= len(data):
        raise ValueError(f"header_row {spec.header_row} além do fim da planilha ({path})")

    header = data[hidx][sidx:]
    while header and _cell_str(header[-1]) in (None, ""):
        header.pop()
    if not header:
        raise ValueError(f"nenhuma coluna detectada no cabeçalho ({path})")
    n_cols = len(header)
    sanitized = _sanitize_unique([_cell_str(h) or "" for h in header], spec.start_col)

    columns: list[list[str | None]] = [[] for _ in range(n_cols)]
    for row in data[hidx + 1 :]:
        window = row[sidx : sidx + n_cols]
        for i in range(n_cols):
            cell = window[i] if i < len(window) else None
            columns[i].append(_cell_str(cell))

    arrow = pa.table(
        {name: pa.array(columns[i], type=pa.string()) for i, name in enumerate(sanitized)}
    )
    con.execute(f'DROP TABLE IF EXISTS "{table}"')
    con.register("_ingest_arrow", arrow)
    con.execute(f'CREATE TABLE "{table}" AS SELECT * FROM _ingest_arrow')
    con.unregister("_ingest_arrow")
    return con.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]  # type: ignore[index]


def ingest(con: duckdb.DuckDBPyConnection, path: str, table: str, spec: IngestSpec) -> int:
    """Dispatcher por extensão: .xlsx→read_xlsx, .xlsb/.xls→calamine, .csv/.txt→read_csv."""
    ext = Path(path).suffix.lower()
    if ext == ".xlsx":
        return ingest_xlsx(con, path, table, spec)
    if ext in (".xlsb", ".xls"):
        return ingest_calamine(con, path, table, spec)
    if ext in (".csv", ".txt"):
        return ingest_csv(con, path, table, spec)
    raise ValueError(f"formato não suportado: {ext} ({path})")


def column_mapping(
    con: duckdb.DuckDBPyConnection, path: str, spec: IngestSpec
) -> list[tuple[str, str]]:
    """Retorna [(excel_name, sqlite_name)] do cabeçalho, por formato — alimenta base_columns."""
    ext = Path(path).suffix.lower()
    if ext == ".xlsx":
        originals, sanitized = read_header(con, path, spec)
        return list(zip(originals, sanitized))
    if ext in (".csv", ".txt"):
        skip = spec.header_row - 1
        reader = (
            f"read_csv('{_esc(path)}', header=false, all_varchar=true, skip={skip}, "
            f"auto_detect=true, null_padding=true)"
        )
        row = con.execute(f"SELECT * FROM {reader} LIMIT 1").fetchone()
        vals = list(row)[spec.start_col - 1 :] if row else []
        originals = [("" if v is None else str(v)) for v in vals]
        return list(zip(originals, _sanitize_unique(list(originals), spec.start_col)))
    if ext in (".xlsb", ".xls"):
        import python_calamine as pc

        wb = pc.load_workbook(path)
        sheet = wb.get_sheet_by_name(spec.sheet) if spec.sheet else wb.get_sheet_by_index(0)
        data = sheet.to_python()
        header = data[spec.header_row - 1][spec.start_col - 1 :]
        while header and _cell_str(header[-1]) in (None, ""):
            header.pop()
        originals = [_cell_str(h) or "" for h in header]
        return list(zip(originals, _sanitize_unique(list(originals), spec.start_col)))
    raise ValueError(f"formato não suportado: {ext} ({path})")


def _cell_str(value: object) -> str | None:
    """Converte célula do calamine em texto (all_varchar). None permanece NULL."""
    if value is None:
        return None
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() else repr(value)
    return str(value)


def _sanitize_unique(names: list[str | None], start_col: int) -> list[str]:
    """Sanitiza (fiel à v1) com desduplicação por sufixo _2, _3…"""
    out: list[str] = []
    seen: dict[str, int] = {}
    for i, name in enumerate(names):
        base = sanitize_column_name(name, (start_col - 1) + i)
        if base in seen:
            seen[base] += 1
            base = f"{base}_{seen[base]}"
        else:
            seen[base] = 1
        out.append(base)
    return out


def numeric_sql(col: str) -> str:
    """SQL que normaliza uma coluna VARCHAR para DOUBLE reproduzindo a regra da v1:
    trim → vírgula vira ponto → parse; não-parseável vira NULL (TRY_CAST).
    """
    q = f'"{col}"'
    return f"TRY_CAST(replace(trim({q}), ',', '.') AS DOUBLE)"


def _esc(path: str) -> str:
    """Escapa aspa simples em caminho para interpolar em SQL literal."""
    return path.replace("'", "''")
