"""Sanitização de nomes de coluna.

Port fiel de sanitizeColumnName em apps/api/src/services/StreamingIngestPipeline.ts:78-80.
Bit-idêntico é obrigatório: nomes divergentes quebram o schema e o oráculo.
"""

from __future__ import annotations

import re

_NON_ALNUM = re.compile(r"[^a-z0-9_]")


def _is_js_falsy(value: object) -> bool:
    """`!value` do JS: false, 0, -0, NaN, "", null, undefined são falsy.

    Atenção: a string "0" é TRUTHY em JS (só o número 0 é falsy).
    """
    if value is None or value is False:
        return True
    if isinstance(value, str):
        return value == ""
    if isinstance(value, (int, float)):
        return value == 0 or value != value  # 0/-0 ou NaN
    return False


def sanitize_column_name(name: object, idx: int) -> str:
    """Reproduz:

        if (!name || String(name).trim() === '') return `col_${idx}`;
        return String(name).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    """
    if _is_js_falsy(name) or str(name).strip() == "":
        return f"col_{idx}"
    return _NON_ALNUM.sub("_", str(name).strip().lower())
