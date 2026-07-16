"""Fidelidade de shape (v1): CHAVE_n + a_values/b_values na conciliação; CHAVE_n na atribuição."""

from __future__ import annotations

import json

import duckdb

from altool.engine.atribuicao import AtribKey, AtribuicaoConfig, atribuir
from altool.engine.conciliacao import KeyDef, conciliar_multichave


def test_conciliacao_chave_n_e_a_values() -> None:
    con = duckdb.connect()
    con.execute("CREATE TABLE base_a(k1 VARCHAR, k2 VARCHAR, valor VARCHAR)")
    con.execute("CREATE TABLE base_b(k1 VARCHAR, k2 VARCHAR, valor VARCHAR)")
    con.executemany("INSERT INTO base_a VALUES (?,?,?)", [("A1", "P", "100")])
    con.executemany("INSERT INTO base_b VALUES (?,?,?)", [("A1", "Q", "100")])
    conciliar_multichave(
        con,
        [KeyDef("CHAVE_1", ["k1"], ["k1"]), KeyDef("CHAVE_2", ["k2"], ["k2"])],
        value_col_a="valor", value_col_b="valor",
    )
    cols = [d[0] for d in con.execute("SELECT * FROM conciliacao_result LIMIT 0").description]
    assert "CHAVE_1" in cols and "CHAVE_2" in cols
    assert "a_values" in cols and "b_values" in cols

    a = con.execute(
        "SELECT \"CHAVE_1\", \"CHAVE_2\", a_values, b_values FROM conciliacao_result WHERE origem='A'"
    ).fetchone()
    assert a[0] == "A1" and a[1] == "P"          # composta por chave
    assert json.loads(a[2]) == {"k1": "A1", "k2": "P", "valor": "100"}  # a_values JSON
    assert a[3] is None                          # b_values null em linha A

    b = con.execute(
        "SELECT \"CHAVE_1\", b_values, a_values FROM conciliacao_result WHERE origem='B'"
    ).fetchone()
    assert b[0] == "A1" and json.loads(b[1])["k2"] == "Q" and b[2] is None


def test_atribuicao_chave_n() -> None:
    con = duckdb.connect()
    con.execute("CREATE TABLE base_origem(k1 VARCHAR, nome VARCHAR)")
    con.execute("CREATE TABLE base_destino(k1 VARCHAR, nome VARCHAR)")
    con.executemany("INSERT INTO base_origem VALUES (?,?)", [("K1", "ORIG")])
    con.executemany("INSERT INTO base_destino VALUES (?,?)", [("K1", "")])
    atribuir(
        con,
        AtribuicaoConfig(keys=[AtribKey("CHAVE_1", ["k1"], ["k1"])],
                         selected_columns=["nome"], mode="OVERWRITE"),
        table_origem="base_origem", table_destino="base_destino",
    )
    row = con.execute('SELECT "CHAVE_1", nome FROM atribuicao_result').fetchone()
    assert row == ("K1", "ORIG")  # CHAVE_1 = chave composta do destino + valor copiado
