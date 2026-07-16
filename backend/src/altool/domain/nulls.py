"""Normalização de valores vazios/nulos e parsing numérico.

Ports fiéis:
- normalização numérica de ingestão: StreamingIngestPipeline.ts buildRowObject (:152-176)
- regra T52 de nulls: NullsBaseAStep.ts / NullsBaseBStep.ts
"""

from __future__ import annotations

from typing import Any


def parse_numeric(value: Any) -> float | None:
    """Reproduz o parsing de célula 'real' da ingestão (StreamingIngestPipeline.ts:160-170):

        if (v === '' || v === undefined) v = null;
        // para coluna real:
        v = parseFloat(String(v).trim().replace(',', '.'))  → NaN vira null
    """
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        n = float(value)
        return None if n != n else n  # NaN → None
    s = str(value).strip().replace(",", ".")
    try:
        n = float(s)
    except ValueError:
        return None
    return None if n != n else n


def normalize_monetary_empty(value: Any) -> float:
    """Coluna monetária: NULL ou '' → 0.0 (NullsBaseAStep.ts:77).

    Valores não-vazios são retornados como número.
    """
    if value is None or value == "":
        return 0.0
    parsed = parse_numeric(value)
    return 0.0 if parsed is None else parsed


def normalize_nonmonetary_empty(value: Any) -> Any:
    """Coluna não-monetária: '' → NULL; NULL permanece NULL (NullsBaseAStep.ts:100).

    Demais valores permanecem inalterados.
    """
    if value == "":
        return None
    return value
