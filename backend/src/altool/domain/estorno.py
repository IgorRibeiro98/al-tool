"""Regras puras de estorno (Base A × Base A).

Port das primitivas de apps/api/src/pipeline/core/steps/EstornoBaseAStep.ts.
Identifica pares na mesma base contábil cuja soma ≈ 0 (documento estornado).
O algoritmo O(n) completo (pareamento por índice de soma) vive no engine (Fase 2);
aqui ficam as funções puras que ele usa.
"""

from __future__ import annotations

from .constants import SOMA_PRECISION


def soma_to_key(soma: float) -> int:
    """Chave inteira de indexação da soma (EstornoBaseAStep.ts:89-91):

        Math.round(soma * SOMA_PRECISION)   # SOMA_PRECISION = 100 → 2 casas

    JS `Math.round` arredonda half-up (para +∞); Python `round` é half-even.
    Reproduzimos half-up explicitamente.
    """
    scaled = soma * SOMA_PRECISION
    return _js_round(scaled)


def is_estorno_pair(soma_a: float, soma_b: float) -> bool:
    """Dois lançamentos formam par de estorno se suas somas se anulam ao nível da
    precisão de indexação: round(a*100) + round(b*100) == 0.
    """
    return soma_to_key(soma_a) + soma_to_key(soma_b) == 0


def _js_round(x: float) -> int:
    """Math.round do JS: floor(x + 0.5) (half para +∞, inclusive negativos)."""
    import math

    return math.floor(x + 0.5)
