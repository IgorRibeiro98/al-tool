"""Regras puras de conciliação A×B.

Port fiel de apps/api/src/workers/helpers/conciliacaoHelper.ts (processGroupsSync).
Determinístico, sem I/O. É o núcleo auditável — qualquer divergência aqui quebra o oráculo.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from .constants import (
    AMOUNT_DECIMALS,
    EPSILON,
    LABEL_BASE_A_MAIOR,
    LABEL_BASE_B_MAIOR,
    LABEL_CONCILIADO,
    LABEL_DIFF_IMATERIAL,
    LABEL_NOT_FOUND,
    STATUS_CONCILIADO,
    STATUS_FOUND_DIFF,
    STATUS_NOT_FOUND,
)


def normalize_amount(value: float) -> float:
    """Equivalente a `Number(Number(value).toFixed(6))` da v1 (conciliacaoHelper.ts:158-161).

    JS `toFixed` usa arredondamento half-away-from-zero em casos exatos; Python `round`
    usa banker's rounding. Para bater byte-a-byte usamos formatação decimal explícita.
    """
    if value == 0:
        return 0.0
    # toFixed(6): 6 casas, half-up. `%.*f` do C (usado pelo Python) arredonda half-even,
    # então normalizamos via Decimal para reproduzir o comportamento do JS.
    from decimal import ROUND_HALF_UP, Decimal

    quant = Decimal(1).scaleb(-AMOUNT_DECIMALS)  # 1e-6
    return float(Decimal(repr(value)).quantize(quant, rounding=ROUND_HALF_UP))


def _to_number(value: Any) -> float:
    """Equivalente a `Number(x) || 0` da v1 para colunas de valor."""
    if value is None or value == "":
        return 0.0
    try:
        n = float(value)
    except (TypeError, ValueError):
        return 0.0
    if n != n:  # NaN
        return 0.0
    return n


def compose_key(row: Mapping[str, Any] | None, cols: Sequence[str] | None) -> str | None:
    """Chave composta: `cols.map(c => String(row[c] ?? '')).join('_')` (conciliacaoHelper.ts:163-166)."""
    if not row or not cols:
        return None
    parts: list[str] = []
    for c in cols:
        v = row.get(c)
        parts.append("" if v is None else str(v))
    return "_".join(parts)


@dataclass(frozen=True)
class GroupClassification:
    status: str
    grupo: str
    soma_a: float
    soma_b: float
    difference: float


def classify_group(
    soma_a_raw: float,
    soma_b_raw: float,
    *,
    has_a: bool,
    has_b: bool,
    inverter: bool,
    limite: float,
) -> GroupClassification:
    """Classifica um grupo (A×B) segundo a árvore exata da v1 (conciliacaoHelper.ts:204-230).

    Args:
        soma_a_raw: soma da coluna de valor da Base A (antes de normalizar).
        soma_b_raw: soma bruta da coluna de valor da Base B (antes da inversão de sinal).
        has_a/has_b: se o grupo tem linhas em A / B.
        inverter: se inverte o sinal da Base B (fiscal).
        limite: limite de diferença imaterial configurado.
    """
    soma_a = normalize_amount(soma_a_raw)
    soma_b = normalize_amount(-soma_b_raw if inverter else soma_b_raw)
    diff = normalize_amount(soma_a - soma_b)
    abs_diff = abs(diff)
    limite_efetivo = max(limite, EPSILON)

    if has_a and has_b:
        if abs_diff <= EPSILON:
            return GroupClassification(STATUS_CONCILIADO, LABEL_CONCILIADO, soma_a, soma_b, diff)
        if limite > 0 and abs_diff <= limite_efetivo:
            return GroupClassification(
                STATUS_FOUND_DIFF, LABEL_DIFF_IMATERIAL, soma_a, soma_b, diff
            )
        if diff > 0:
            return GroupClassification(STATUS_FOUND_DIFF, LABEL_BASE_A_MAIOR, soma_a, soma_b, diff)
        return GroupClassification(STATUS_FOUND_DIFF, LABEL_BASE_B_MAIOR, soma_a, soma_b, diff)

    return GroupClassification(STATUS_NOT_FOUND, LABEL_NOT_FOUND, soma_a, soma_b, diff)


def sum_column(rows: Sequence[Mapping[str, Any]], col: str | None) -> float:
    """Soma `Number(row[col]) || 0` sobre as linhas (conciliacaoHelper.ts:191-201)."""
    if not col:
        return 0.0
    return sum(_to_number(row.get(col)) for row in rows)
