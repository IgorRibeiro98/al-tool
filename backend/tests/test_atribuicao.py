"""Atribuição: regras puras (domain) + engine set-based (modos de escrita, prioridade)."""

from __future__ import annotations

import duckdb
import pytest

from altool.domain.atribuicao import (
    is_empty_value,
    normalize_import_value,
    normalize_key_value,
)
from altool.engine.atribuicao import (
    MODE_ONLY_EMPTY,
    MODE_OVERWRITE,
    AtribKey,
    AtribuicaoConfig,
    atribuir,
)

# --------------------------------------------------------------- domain puro


@pytest.mark.parametrize(
    "val,expected",
    [
        (None, True), ("", True), ("   ", True),
        ("null", True), ("NULL", True), ("Null", True),
        ("0", True), ("0.00", True), (0, True),
        ("0.0", False), ("x", False), ("5", False), ("100,50", False),
    ],
)
def test_is_empty_value(val: object, expected: bool) -> None:
    assert is_empty_value(val) is expected


@pytest.mark.parametrize(
    "val,expected",
    [("", "NULL"), ("null", "NULL"), ("0", "NULL"), ("  x  ", "x"), ("5", "5")],
)
def test_normalize_import_value(val: object, expected: str) -> None:
    assert normalize_import_value(val) == expected


@pytest.mark.parametrize(
    "val,expected",
    [(None, ""), ("null", ""), ("NULL", ""), ("  x  ", "x"), ("5", "5"), ("0", "0")],
)
def test_normalize_key_value(val: object, expected: str) -> None:
    assert normalize_key_value(val) == expected


# --------------------------------------------------------------- engine


def _con(origem, destino):  # type: ignore[no-untyped-def]
    con = duckdb.connect()
    con.execute("CREATE TABLE base_origem(k1 VARCHAR, k2 VARCHAR, nome VARCHAR, valor VARCHAR)")
    con.execute("CREATE TABLE base_destino(k1 VARCHAR, k2 VARCHAR, nome VARCHAR, valor VARCHAR)")
    con.executemany("INSERT INTO base_origem VALUES (?,?,?,?)", origem)
    con.executemany("INSERT INTO base_destino VALUES (?,?,?,?)", destino)
    return con


K1 = AtribKey("CHAVE_1", ["k1"], ["k1"])


def test_overwrite() -> None:
    con = _con(
        origem=[("A", "", "ORIG", "100")],
        destino=[("A", "", "DEST", "")],
    )
    r = atribuir(
        con,
        AtribuicaoConfig(keys=[K1], selected_columns=["nome", "valor"], mode=MODE_OVERWRITE),
    )
    assert r.linhas == 1
    row = con.execute("SELECT nome, valor FROM atribuicao_result").fetchone()
    assert row == ("ORIG", "100")  # ambos sobrescritos


def test_only_empty() -> None:
    con = _con(
        origem=[("A", "", "ORIG", "100")],
        destino=[("A", "", "DEST", "")],  # nome não-vazio, valor vazio
    )
    r = atribuir(
        con,
        AtribuicaoConfig(keys=[K1], selected_columns=["nome", "valor"], mode=MODE_ONLY_EMPTY),
    )
    row = con.execute("SELECT nome, valor FROM atribuicao_result").fetchone()
    assert row == ("DEST", "100")  # nome mantido, valor preenchido


def test_only_empty_trata_zero_como_vazio() -> None:
    # '0' e '0.00' contam como vazio (isEmptyValue).
    con = _con(origem=[("A", "", "X", "999")], destino=[("A", "", "0", "0.00")])
    atribuir(
        con,
        AtribuicaoConfig(keys=[K1], selected_columns=["nome", "valor"], mode=MODE_ONLY_EMPTY),
    )
    assert con.execute("SELECT nome, valor FROM atribuicao_result").fetchone() == ("X", "999")


def test_valor_origem_vazio_vira_NULL() -> None:
    con = _con(origem=[("A", "", "", "100")], destino=[("A", "", "DEST", "")])
    atribuir(
        con,
        AtribuicaoConfig(keys=[K1], selected_columns=["nome"], mode=MODE_OVERWRITE),
    )
    # nome de origem vazio → 'NULL' (normalizeImportValue).
    assert con.execute("SELECT nome FROM atribuicao_result").fetchone()[0] == "NULL"


def test_prioridade_uma_atribuicao_por_destino() -> None:
    # D0 casa na CHAVE_1 (k1=A) com O0; NÃO deve ser re-atribuído pela CHAVE_2 (k2=M) com O1.
    con = _con(
        origem=[("A", "Z", "VIA_K1", "10"), ("Q", "M", "VIA_K2", "20")],
        destino=[("A", "M", "DEST", "")],
    )
    keys = [AtribKey("CHAVE_1", ["k1"], ["k1"]), AtribKey("CHAVE_2", ["k2"], ["k2"])]
    r = atribuir(
        con,
        AtribuicaoConfig(keys=keys, selected_columns=["nome"], mode=MODE_OVERWRITE),
    )
    rows = con.execute("SELECT matched_key, nome FROM atribuicao_result").fetchall()
    assert len(rows) == 1
    assert rows[0] == ("CHAVE_1", "VIA_K1")  # resolvido pela prioridade


def test_min_origem_vence_em_multiplos_matches() -> None:
    # Dois origens casam a mesma chave; MIN(rowid) (o primeiro inserido) vence.
    con = _con(
        origem=[("A", "", "PRIMEIRO", "1"), ("A", "", "SEGUNDO", "2")],
        destino=[("A", "", "DEST", "")],
    )
    atribuir(
        con,
        AtribuicaoConfig(keys=[K1], selected_columns=["nome"], mode=MODE_OVERWRITE),
    )
    assert con.execute("SELECT nome FROM atribuicao_result").fetchone()[0] == "PRIMEIRO"
