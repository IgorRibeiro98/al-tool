"""Pipeline completo multi-chave + nível-linha nos dados REAIS.

Config ilustrativa (não a oficial). Objetivo: escala + o invariante de que cada linha
de A e de B aparece exatamente uma vez no resultado nível-linha.
"""

from __future__ import annotations

import time

import pytest

from altool.engine.conciliacao import KeyDef
from altool.engine.pipeline import CancelamentoConfig, EstornoConfig, run_conciliacao

pytestmark = pytest.mark.integration

KEYS = [
    KeyDef("CHAVE_1", ["id_origem"], ["id_origem"]),
    KeyDef("CHAVE_2", ["nota_fiscal"], ["nota_fiscal"]),
]


def test_multichave_nivel_linha_escala(real_con) -> None:  # type: ignore[no-untyped-def]
    n_a = real_con.execute("SELECT count(*) FROM base_a").fetchone()[0]
    n_b = real_con.execute("SELECT count(*) FROM base_b").fetchone()[0]

    t = time.time()
    r = run_conciliacao(
        real_con, KEYS,
        value_col_a="mont_emmi", value_col_b="valor_cont_bil",
        estorno=EstornoConfig(col_a="n__doc_", col_b="refer_ncia", col_soma="mont_emmi"),
        cancelamento=CancelamentoConfig(
            coluna="indicador_de_cancelamento", valor_cancelado="S"
        ),
    )
    elapsed = time.time() - t

    # Invariante: cada linha de A e de B aparece exatamente uma vez.
    assert r.linhas == n_a + n_b  # 38874 + 429261 = 468135
    assert real_con.execute(
        "SELECT count(*) FROM conciliacao_result WHERE origem='A'"
    ).fetchone()[0] == n_a
    assert real_con.execute(
        "SELECT count(*) FROM conciliacao_result WHERE origem='B'"
    ).fetchone()[0] == n_b

    # Cancelamento real refletido no resultado.
    assert r.canceladas == 1802
    assert real_con.execute(
        "SELECT count(*) FROM conciliacao_result WHERE grupo='NF Cancelada'"
    ).fetchone()[0] == 1802

    # Distribuição soma o total; roda em poucos segundos.
    assert sum(r.distribuicao.values()) == r.linhas
    assert elapsed < 30
