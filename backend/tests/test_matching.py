"""Conciliação A×B — cobertura exaustiva das bordas (conciliacaoHelper.ts:204-230)."""

from __future__ import annotations

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
from altool.domain.matching import (
    classify_group,
    compose_key,
    normalize_amount,
    sum_column,
)


# --- normalize_amount (toFixed(6), half-up) ---


@pytest.mark.parametrize(
    "value,expected",
    [
        (0, 0.0),
        (0.0, 0.0),
        (1000.0, 1000.0),
        (80.9399999, 80.94),  # normalização de precisão crítica p/ chave
        (0.0000004, 0.0),  # < 1e-6 → arredonda p/ 0
        (0.0000006, 0.000001),  # half-up
        (-1234.5678901, -1234.56789),
    ],
)
def test_normalize_amount(value: float, expected: float) -> None:
    assert normalize_amount(value) == expected


# --- classify_group: os 5+ cenários e as bordas exatas ---


def test_conciliado_diferenca_zero() -> None:
    r = classify_group(1000.0, 1000.0, has_a=True, has_b=True, inverter=False, limite=0)
    assert (r.status, r.grupo) == (STATUS_CONCILIADO, LABEL_CONCILIADO)
    assert r.difference == 0.0


def test_conciliado_dentro_do_epsilon() -> None:
    # diff exatamente no limite do epsilon ainda concilia.
    r = classify_group(1000.0000005, 1000.0, has_a=True, has_b=True, inverter=False, limite=0)
    assert r.status == STATUS_CONCILIADO


def test_diferenca_imaterial_dentro_do_limite() -> None:
    r = classify_group(1010.0, 1000.0, has_a=True, has_b=True, inverter=False, limite=50)
    assert (r.status, r.grupo) == (STATUS_FOUND_DIFF, LABEL_DIFF_IMATERIAL)


def test_diferenca_base_a_maior() -> None:
    r = classify_group(2000.0, 1000.0, has_a=True, has_b=True, inverter=False, limite=0)
    assert (r.status, r.grupo) == (STATUS_FOUND_DIFF, LABEL_BASE_A_MAIOR)
    assert r.difference == 1000.0


def test_diferenca_base_b_maior() -> None:
    r = classify_group(1000.0, 2000.0, has_a=True, has_b=True, inverter=False, limite=0)
    assert (r.status, r.grupo) == (STATUS_FOUND_DIFF, LABEL_BASE_B_MAIOR)
    assert r.difference == -1000.0


def test_limite_zero_nao_ativa_imaterial() -> None:
    # limite=0 → diferença material mesmo que pequena (limite>0 é condição na v1).
    r = classify_group(1000.5, 1000.0, has_a=True, has_b=True, inverter=False, limite=0)
    assert r.grupo == LABEL_BASE_A_MAIOR


def test_borda_exatamente_no_limite_e_imaterial() -> None:
    r = classify_group(1050.0, 1000.0, has_a=True, has_b=True, inverter=False, limite=50)
    assert r.grupo == LABEL_DIFF_IMATERIAL  # absDiff (50) <= limiteEfetivo (50)


def test_borda_um_centavo_acima_do_limite_e_material() -> None:
    r = classify_group(1050.01, 1000.0, has_a=True, has_b=True, inverter=False, limite=50)
    assert r.grupo == LABEL_BASE_A_MAIOR


def test_inversao_de_sinal_fiscal() -> None:
    # B com sinal invertido: somaB bruta -1000 vira +1000, concilia com A=1000.
    r = classify_group(1000.0, -1000.0, has_a=True, has_b=True, inverter=True, limite=0)
    assert r.status == STATUS_CONCILIADO
    assert r.soma_b == 1000.0


def test_apenas_a() -> None:
    r = classify_group(1000.0, 0.0, has_a=True, has_b=False, inverter=False, limite=0)
    assert (r.status, r.grupo) == (STATUS_NOT_FOUND, LABEL_NOT_FOUND)


def test_apenas_b() -> None:
    r = classify_group(0.0, 1000.0, has_a=False, has_b=True, inverter=False, limite=0)
    assert (r.status, r.grupo) == (STATUS_NOT_FOUND, LABEL_NOT_FOUND)


# --- compose_key ---


@pytest.mark.parametrize(
    "row,cols,expected",
    [
        ({"a": "001", "b": "X"}, ["a", "b"], "001_X"),
        ({"a": None, "b": "X"}, ["a", "b"], "_X"),  # None → ''
        ({"a": 1, "b": 2}, ["a", "b"], "1_2"),  # números viram string
        ({"a": "x"}, [], None),  # sem colunas → None
        ({"a": "x"}, None, None),
        (None, ["a"], None),
    ],
)
def test_compose_key(row: dict | None, cols: list | None, expected: str | None) -> None:
    assert compose_key(row, cols) == expected


# --- sum_column ---


def test_sum_column_ignora_nao_numericos() -> None:
    rows = [{"v": 100}, {"v": "50"}, {"v": None}, {"v": ""}, {"v": "abc"}]
    assert sum_column(rows, "v") == 150.0


def test_sum_column_sem_coluna() -> None:
    assert sum_column([{"v": 1}], None) == 0.0
