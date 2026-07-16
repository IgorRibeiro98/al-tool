"""Primitivas de estorno (EstornoBaseAStep.ts:89-91)."""

from __future__ import annotations

import pytest

from altool.domain.estorno import is_estorno_pair, soma_to_key


@pytest.mark.parametrize(
    "soma,expected",
    [
        (1000.00, 100000),
        (1000.004, 100000),  # round half-up de 100000.4
        (1000.005, 100001),  # 100000.5 → 100001 (Math.round half p/ +inf)
        (-1000.005, -100000),  # -100000.5 → floor(-100000.5+0.5)= -100000
        (0.0, 0),
    ],
)
def test_soma_to_key(soma: float, expected: int) -> None:
    assert soma_to_key(soma) == expected


@pytest.mark.parametrize(
    "a,b,expected",
    [
        (1000.00, -1000.00, True),  # par perfeito
        (1000.004, -1000.001, True),  # ambos arredondam p/ ±100000
        (1000.00, -999.00, False),  # não anula
        (500.00, -500.00, True),
        (0.0, 0.0, True),  # soma zero
    ],
)
def test_is_estorno_pair(a: float, b: float, expected: bool) -> None:
    assert is_estorno_pair(a, b) is expected
