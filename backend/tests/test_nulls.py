"""Normalização de nulos/numéricos (StreamingIngestPipeline + NullsBaseAStep)."""

from __future__ import annotations

import pytest

from altool.domain.nulls import (
    normalize_monetary_empty,
    normalize_nonmonetary_empty,
    parse_numeric,
)


@pytest.mark.parametrize(
    "value,expected",
    [
        ("", None),
        (None, None),
        ("1234.56", 1234.56),
        ("1234,56", 1234.56),  # vírgula decimal → ponto
        ("  99,90  ", 99.90),  # trim
        ("abc", None),  # NaN → None
        (42, 42.0),
        (3.14, 3.14),
    ],
)
def test_parse_numeric(value: object, expected: float | None) -> None:
    assert parse_numeric(value) == expected


@pytest.mark.parametrize(
    "value,expected",
    [
        ("", 0.0),  # monetário vazio → 0.0
        (None, 0.0),  # NULL → 0.0
        ("100,50", 100.50),
        (250, 250.0),
        ("abc", 0.0),  # não parseável → 0.0
    ],
)
def test_normalize_monetary_empty(value: object, expected: float) -> None:
    assert normalize_monetary_empty(value) == expected


@pytest.mark.parametrize(
    "value,expected",
    [
        ("", None),  # texto vazio → NULL
        (None, None),  # NULL permanece NULL
        ("ABC", "ABC"),  # valor mantido
        (0, 0),  # zero numérico não é vazio → mantido
        ("0", "0"),
    ],
)
def test_normalize_nonmonetary_empty(value: object, expected: object) -> None:
    assert normalize_nonmonetary_empty(value) == expected
