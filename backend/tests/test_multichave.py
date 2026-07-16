"""Conciliação multi-chave priorizada + resultado nível-linha.

Cobre: prioridade (casa na CHAVE_1 mesmo com CHAVE_2 diferente), carry-forward
(não-casado na CHAVE_1 casa na CHAVE_2), remanescentes → 03, e marcas pré-casadas.
"""

from __future__ import annotations

import duckdb

from altool.domain.constants import (
    STATUS_CONCILIADO,
    STATUS_NAO_AVALIADO,
    STATUS_NOT_FOUND,
)
from altool.engine.conciliacao import KeyDef, conciliar_multichave


def _con(a_rows, b_rows):  # type: ignore[no-untyped-def]
    con = duckdb.connect()
    con.execute("CREATE TABLE base_a(k1 VARCHAR, k2 VARCHAR, valor VARCHAR)")
    con.execute("CREATE TABLE base_b(k1 VARCHAR, k2 VARCHAR, valor VARCHAR)")
    con.executemany("INSERT INTO base_a VALUES (?,?,?)", a_rows)
    con.executemany("INSERT INTO base_b VALUES (?,?,?)", b_rows)
    return con


KEYS = [
    KeyDef("CHAVE_1", ["k1"], ["k1"]),
    KeyDef("CHAVE_2", ["k2"], ["k2"]),
]


def _result(con):  # type: ignore[no-untyped-def]
    conciliar_multichave(con, KEYS, value_col_a="valor", value_col_b="valor")
    return {
        (r[0], r[1]): (r[2], r[3])  # (origem, row_id) -> (key_id, status)
        for r in con.execute(
            "SELECT origem, row_id, key_id, status FROM conciliacao_result"
        ).fetchall()
    }


def test_prioridade_e_carry_forward() -> None:
    con = _con(
        a_rows=[
            ("X", "P", "100"),  # A0: casa na CHAVE_1 (k1=X) apesar de k2 diferente
            ("Y", "M", "50"),   # A1: não casa k1 (Y≠Z), casa na CHAVE_2 (k2=M)
            ("W", "N", "30"),   # A2: nunca casa → 03
        ],
        b_rows=[
            ("X", "Q", "100"),  # B0: casa com A0 na CHAVE_1
            ("Z", "M", "50"),   # B1: casa com A1 na CHAVE_2
            ("V", "R", "20"),   # B2: nunca casa → 03
        ],
    )
    res = _result(con)
    # A0/B0 resolvidos pela CHAVE_1
    assert res[("A", 0)] == ("CHAVE_1", STATUS_CONCILIADO)
    assert res[("B", 0)] == ("CHAVE_1", STATUS_CONCILIADO)
    # A1/B1 resolvidos pela CHAVE_2 (carry-forward)
    assert res[("A", 1)] == ("CHAVE_2", STATUS_CONCILIADO)
    assert res[("B", 1)] == ("CHAVE_2", STATUS_CONCILIADO)
    # A2/B2 sem par → 03 (key_id None)
    assert res[("A", 2)] == (None, STATUS_NOT_FOUND)
    assert res[("B", 2)] == (None, STATUS_NOT_FOUND)


def test_prioridade_nao_reprocessa_linha_ja_casada() -> None:
    # A0 casa na CHAVE_1 com B0. Mesmo que k2 de A0 também bata com B1, A0 já está casado.
    con = _con(
        a_rows=[("X", "M", "100")],
        b_rows=[("X", "Z", "100"), ("Q", "M", "999")],
    )
    conciliar_multichave(con, KEYS, value_col_a="valor", value_col_b="valor")
    rows = con.execute(
        "SELECT origem, row_id, key_id FROM conciliacao_result WHERE origem='A'"
    ).fetchall()
    assert len(rows) == 1  # A0 aparece uma vez só
    assert rows[0][2] == "CHAVE_1"


def test_nivel_linha_valores_do_grupo() -> None:
    # Grupo com 2 linhas em A (600+400) casando com 1 em B (1000) → Conciliado; value_a=1000.
    con = _con(
        a_rows=[("X", "", "600"), ("X", "", "400")],
        b_rows=[("X", "", "1000")],
    )
    conciliar_multichave(con, KEYS, value_col_a="valor", value_col_b="valor")
    a_entries = con.execute(
        "SELECT value_a, value_b, status FROM conciliacao_result WHERE origem='A'"
    ).fetchall()
    assert len(a_entries) == 2  # uma entrada por linha de A
    for value_a, value_b, status in a_entries:
        assert value_a == 1000.0 and value_b == 1000.0
        assert status == STATUS_CONCILIADO


def test_marcas_precasadas() -> None:
    # A0 marcado como estorno (04) não deve entrar na conciliação por chave.
    con = _con(a_rows=[("X", "", "100")], b_rows=[("X", "", "100")])
    conciliar_multichave(
        con, KEYS, value_col_a="valor", value_col_b="valor",
        marks_a={0: (STATUS_NAO_AVALIADO, "Documentos estornados")},
    )
    a = con.execute(
        "SELECT key_id, status, grupo FROM conciliacao_result WHERE origem='A'"
    ).fetchall()
    assert len(a) == 1
    assert a[0] == (None, STATUS_NAO_AVALIADO, "Documentos estornados")
    # B0 fica sem par (A0 excluído) → 03.
    b = con.execute("SELECT status FROM conciliacao_result WHERE origem='B'").fetchone()
    assert b[0] == STATUS_NOT_FOUND
