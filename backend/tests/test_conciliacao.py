"""Conciliação A×B (engine set-based DuckDB).

- Fixture sintética: 5+ cenários com entrada→saída conhecida (correção).
- Cross-check: a classificação SQL deve bater com domain.matching.classify_group (fidelidade).
"""

from __future__ import annotations

import duckdb
import pytest

from altool.domain.constants import (
    LABEL_BASE_A_MAIOR,
    LABEL_BASE_B_MAIOR,
    LABEL_CONCILIADO,
    LABEL_DIFF_IMATERIAL,
    LABEL_NOT_FOUND,
    STATUS_CONCILIADO,
    STATUS_FOUND_DIFF,
    STATUS_NOT_FOUND,
)
from altool.domain.matching import classify_group
from altool.engine.conciliacao import (
    ConciliacaoConfig,
    conciliar_grupos,
    distribuicao_status,
)


def _con_with(a_rows: list[tuple[str, str]], b_rows: list[tuple[str, str]]):  # type: ignore[no-untyped-def]
    """base_a/base_b sintéticas (chave, valor) como VARCHAR (igual ao ingest all_varchar)."""
    con = duckdb.connect()
    con.execute("CREATE TABLE base_a(chave VARCHAR, valor VARCHAR)")
    con.execute("CREATE TABLE base_b(chave VARCHAR, valor VARCHAR)")
    con.executemany("INSERT INTO base_a VALUES (?,?)", a_rows)
    con.executemany("INSERT INTO base_b VALUES (?,?)", b_rows)
    return con


CFG = ConciliacaoConfig(
    key_cols_a=["chave"], key_cols_b=["chave"], value_col_a="valor", value_col_b="valor"
)


def _grupos(con):  # type: ignore[no-untyped-def]
    conciliar_grupos(con, CFG)
    return {
        r[0]: (r[1], r[2])  # chave -> (status, grupo)
        for r in con.execute("SELECT chave, status, grupo FROM conc_grupos").fetchall()
    }


def test_cinco_cenarios() -> None:
    con = _con_with(
        a_rows=[
            ("K1", "600"), ("K1", "400"),   # soma 1000 (multi-linha)
            ("K2", "2000"),                 # A maior
            ("K3", "1000"),                 # B maior
            ("K4", "1000"),                 # só A
        ],
        b_rows=[
            ("K1", "1000"),                 # concilia com K1
            ("K2", "1000"),
            ("K3", "2000"),
            ("K5", "500"),                  # só B
        ],
    )
    g = _grupos(con)
    assert g["K1"] == (STATUS_CONCILIADO, LABEL_CONCILIADO)
    assert g["K2"] == (STATUS_FOUND_DIFF, LABEL_BASE_A_MAIOR)
    assert g["K3"] == (STATUS_FOUND_DIFF, LABEL_BASE_B_MAIOR)
    assert g["K4"] == (STATUS_NOT_FOUND, LABEL_NOT_FOUND)
    assert g["K5"] == (STATUS_NOT_FOUND, LABEL_NOT_FOUND)


def test_diferenca_imaterial_com_limite() -> None:
    con = _con_with([("K1", "1010")], [("K1", "1000")])
    cfg = ConciliacaoConfig(
        key_cols_a=["chave"], key_cols_b=["chave"],
        value_col_a="valor", value_col_b="valor", limite=50,
    )
    conciliar_grupos(con, cfg)
    row = con.execute("SELECT status, grupo FROM conc_grupos").fetchone()
    assert row == (STATUS_FOUND_DIFF, LABEL_DIFF_IMATERIAL)


def test_inversao_de_sinal() -> None:
    # B com -1000; inverter → +1000 concilia com A=1000.
    con = _con_with([("K1", "1000")], [("K1", "-1000")])
    cfg = ConciliacaoConfig(
        key_cols_a=["chave"], key_cols_b=["chave"],
        value_col_a="valor", value_col_b="valor", inverter=True,
    )
    conciliar_grupos(con, cfg)
    assert con.execute("SELECT status FROM conc_grupos").fetchone()[0] == STATUS_CONCILIADO


def test_valor_com_virgula_decimal() -> None:
    # dados reais têm vírgula decimal; deve somar corretamente.
    con = _con_with([("K1", "2790022,95")], [("K1", "2790022,95")])
    conciliar_grupos(con, CFG)
    assert con.execute("SELECT status FROM conc_grupos").fetchone()[0] == STATUS_CONCILIADO


def test_distribuicao_status() -> None:
    con = _con_with([("K1", "10")], [("K1", "10"), ("K2", "5")])
    conciliar_grupos(con, CFG)
    dist = distribuicao_status(con)
    assert dist[STATUS_CONCILIADO] == 1  # K1
    assert dist[STATUS_NOT_FOUND] == 1  # K2 (só B)


@pytest.mark.parametrize(
    "soma_a,soma_b,inverter,limite",
    [
        (1000.0, 1000.0, False, 0),
        (2000.0, 1000.0, False, 0),
        (1000.0, 2000.0, False, 0),
        (1010.0, 1000.0, False, 50),
        (1050.0, 1000.0, False, 50),   # borda exata do limite
        (1050.01, 1000.0, False, 50),  # 1 centavo acima
        (1000.0, -1000.0, True, 0),
        (1000.0000005, 1000.0, False, 0),  # borda epsilon
        (12345.67, 12300.0, False, 100),
    ],
)
def test_sql_matches_python_classify(
    soma_a: float, soma_b: float, inverter: bool, limite: float
) -> None:
    """A classificação SQL da engine deve ser idêntica ao classify_group (Python)."""
    con = _con_with([("K1", repr(soma_a))], [("K1", repr(soma_b))])
    cfg = ConciliacaoConfig(
        key_cols_a=["chave"], key_cols_b=["chave"],
        value_col_a="valor", value_col_b="valor",
        inverter=inverter, limite=limite,
    )
    conciliar_grupos(con, cfg)
    sql_status, sql_grupo = con.execute("SELECT status, grupo FROM conc_grupos").fetchone()

    expected = classify_group(
        soma_a, soma_b, has_a=True, has_b=True, inverter=inverter, limite=limite
    )
    assert (sql_status, sql_grupo) == (expected.status, expected.grupo)
