"""Ingestão multi-formato: csv/txt (read_csv) e o code path do calamine (xlsb/xlsx).

O calamine é testado via sample.xlsx — é o MESMO code path usado para .xlsb (calamine lê
ambos), então cobre a ingestão de xlsb sem precisar de um arquivo .xlsb.
"""

from __future__ import annotations

from pathlib import Path

from altool.engine.db import connect
from altool.engine.ingest import (
    IngestSpec,
    ingest,
    ingest_calamine,
    ingest_csv,
    numeric_sql,
)

FX = Path(__file__).resolve().parent / "fixtures"
COLS = ["empresa", "nota_fiscal", "valor_cont_bil"]


def test_ingest_csv() -> None:
    con = connect()
    n = ingest_csv(con, str(FX / "sample.csv"), "t", IngestSpec(header_row=1, start_col=1))
    assert n == 3
    assert [c[0] for c in con.execute("SELECT * FROM t LIMIT 0").description] == COLS
    # valor com vírgula decimal preservado como texto e normalizável.
    assert con.execute('SELECT valor_cont_bil FROM t LIMIT 1').fetchone()[0] == "1000,50"
    total = con.execute(f'SELECT round(sum({numeric_sql("valor_cont_bil")}),2) FROM t').fetchone()[0]
    assert total == 2250.49  # 1000.50 + 250.00 + 999.99


def test_ingest_calamine_xlsb_codepath() -> None:
    # sample.xlsx: header na linha 3, col inicial A — mesmo caminho que .xlsb usa.
    con = connect()
    n = ingest_calamine(con, str(FX / "sample.xlsx"), "t", IngestSpec(header_row=3, start_col=1))
    assert n == 3
    assert [c[0] for c in con.execute("SELECT * FROM t LIMIT 0").description] == COLS
    assert con.execute("SELECT empresa FROM t").fetchall() == [("TBRA",), ("TBRA",), ("ACME",)]


def test_dispatcher_formatos_convergem() -> None:
    con = connect()
    ingest(con, str(FX / "sample.csv"), "a", IngestSpec(header_row=1, start_col=1))
    ingest(con, str(FX / "sample.xlsx"), "b", IngestSpec(header_row=3, start_col=1))
    # csv (header linha 1) e xlsx (header linha 3) produzem os mesmos dados.
    a = con.execute("SELECT * FROM a ORDER BY nota_fiscal").fetchall()
    b = con.execute("SELECT * FROM b ORDER BY nota_fiscal").fetchall()
    assert a == b


def test_dispatcher_formato_nao_suportado() -> None:
    con = connect()
    try:
        ingest(con, "/tmp/x.parquet", "t", IngestSpec(header_row=1))
        raise AssertionError("deveria ter falhado")
    except ValueError as e:
        assert "não suportado" in str(e)
