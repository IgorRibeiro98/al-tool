"""Conciliação A×B nos dados REAIS: escala + fidelidade em escala.

Config ILUSTRATIVA (id_origem / mont_emmi × valor_cont_bil) — não é a conciliação
oficial do cliente (que depende da config real + oráculo). Objetivo: provar que a engine
processa o volume real e que a classificação SQL bate com o Python em TODOS os grupos reais.
"""

from __future__ import annotations

import pytest

from altool.domain.matching import classify_group
from altool.engine.conciliacao import (
    ConciliacaoConfig,
    conciliar_grupos,
    distribuicao_status,
)

pytestmark = pytest.mark.integration

CFG = ConciliacaoConfig(
    key_cols_a=["id_origem"],
    key_cols_b=["id_origem"],
    value_col_a="mont_emmi",
    value_col_b="valor_cont_bil",
    inverter=False,
    limite=0.0,
)


def test_conciliacao_escala_e_distribuicao(real_con) -> None:  # type: ignore[no-untyped-def]
    n = conciliar_grupos(real_con, CFG, result="conc_grupos")
    assert n == 83344
    dist = distribuicao_status(real_con, "conc_grupos")
    # soma da distribuição == total de grupos
    assert sum(dist.values()) == n
    # há grupos casados (id_origem em comum) e não-encontrados
    assert dist["03_Não Encontrado"] > 0
    assert dist["02_Encontrado c/Diferença"] > 0


def test_sql_bate_com_python_em_todos_os_grupos_reais(real_con) -> None:  # type: ignore[no-untyped-def]
    """Fidelidade em escala: para cada um dos ~83k grupos reais, o status SQL da engine
    deve ser idêntico ao classify_group (Python) recomputado a partir das mesmas somas.
    """
    conciliar_grupos(real_con, CFG, result="conc_grupos")
    rows = real_con.execute(
        "SELECT soma_a, soma_b, has_a, has_b, status, grupo FROM conc_grupos"
    ).fetchall()
    assert len(rows) == 83344

    divergencias = 0
    for soma_a, soma_b, has_a, has_b, sql_status, sql_grupo in rows:
        # soma_b já vem SEM inversão na tabela? Não: a engine grava soma_b já invertida.
        # Aqui recomputamos com inverter=False porque soma_b da tabela já é o valor final.
        expected = classify_group(
            soma_a, soma_b, has_a=has_a, has_b=has_b, inverter=False, limite=CFG.limite
        )
        if (sql_status, sql_grupo) != (expected.status, expected.grupo):
            divergencias += 1
    assert divergencias == 0
