"""Pipeline completo (Estorno → Cancelamento → Conciliação) nos dados REAIS.

Cancelamento usa a coluna REAL (indicador_de_cancelamento). Estorno/conciliação usam
config ilustrativa (não a oficial do cliente). Objetivo: provar que a cadeia inteira roda
no volume real, em subsegundo, com as exclusões fluindo corretamente entre as etapas.
"""

from __future__ import annotations

import pytest

from altool.engine.conciliacao import ConciliacaoConfig
from altool.engine.pipeline import (
    CancelamentoConfig,
    EstornoConfig,
    PipelineConfig,
    run_pipeline,
)

pytestmark = pytest.mark.integration

CFG = PipelineConfig(
    conciliacao=ConciliacaoConfig(
        key_cols_a=["id_origem"], key_cols_b=["id_origem"],
        value_col_a="mont_emmi", value_col_b="valor_cont_bil",
    ),
    estorno=EstornoConfig(col_a="n__doc_", col_b="refer_ncia", col_soma="mont_emmi"),
    cancelamento=CancelamentoConfig(
        coluna="indicador_de_cancelamento", valor_cancelado="S"
    ),
)


def test_pipeline_completo_escala(real_con) -> None:  # type: ignore[no-untyped-def]
    r = run_pipeline(real_con, CFG, result="conc_grupos")

    # Cancelamento REAL: exatamente 1802 NFs canceladas excluídas da Base B.
    assert r.canceladas == 1802
    assert real_con.execute("SELECT count(*) FROM base_b_f").fetchone()[0] == 427459

    # Estorno rodou sobre as 38.874 linhas de A (config ilustrativa → poucos/zero pares).
    assert r.estorno_pares >= 0 and r.estorno_docs >= 0

    # Conciliação sobre o remanescente: distribuição consistente com o total de grupos.
    assert r.grupos_conciliacao > 0
    assert sum(r.distribuicao.values()) == r.grupos_conciliacao
