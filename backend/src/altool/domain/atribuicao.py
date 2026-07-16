"""Regras puras de atribuição (cópia de colunas entre bases por chave).

Ports fiéis de apps/api/src/worker/atribuicaoRunner.ts:15-39.
"""

from __future__ import annotations


def is_empty_value(val: object) -> bool:
    """isEmptyValue (atribuicaoRunner.ts:15-19):

        null/undefined → true; senão str=trim(val); '' | 'null'(ci) | '0' | '0.00' → true
    """
    if val is None:
        return True
    s = str(val).strip()
    return s == "" or s.lower() == "null" or s == "0" or s == "0.00"


def normalize_import_value(val: object) -> str:
    """normalizeImportValue (atribuicaoRunner.ts:21-24): vazio → 'NULL'; senão trim(val)."""
    if is_empty_value(val):
        return "NULL"
    return str(val).strip()


def normalize_key_value(val: object) -> str:
    """normalizeKeyValue (atribuicaoRunner.ts:32-39): null→''; 'null'(ci)→''; senão trim(val)."""
    if val is None:
        return ""
    s = str(val).strip()
    if s.lower() == "null":
        return ""
    return s
