"""Sanitização de nomes de coluna (StreamingIngestPipeline.ts:78-80)."""

from __future__ import annotations

import pytest

from altool.domain.columns import sanitize_column_name


@pytest.mark.parametrize(
    "name,idx,expected",
    [
        ("Empresa", 0, "empresa"),
        ("  Número da Nota  ", 1, "n_mero_da_nota"),  # trim + acento vira _
        ("CNPJ/CPF", 2, "cnpj_cpf"),
        ("Valor (R$)", 3, "valor__r__"),
        ("já_ok_123", 4, "j__ok_123"),
        ("A B  C", 5, "a_b__c"),  # espaços múltiplos → múltiplos _
        ("", 7, "col_7"),  # vazio → col_idx
        ("   ", 8, "col_8"),  # só espaços → col_idx
        (None, 9, "col_9"),  # None → col_idx
        (0, 10, "col_10"),  # número 0 é falsy no JS → col_idx
        ("0", 11, "0"),  # string "0" é truthy no JS → mantém
        (123, 12, "123"),  # número não-zero → string
    ],
)
def test_sanitize(name: object, idx: int, expected: str) -> None:
    assert sanitize_column_name(name, idx) == expected
