"""Pipeline encadeado Estorno(A) → Cancelamento(B) → Conciliação(A×B) — fixture sintética."""

from __future__ import annotations

import duckdb

from altool.domain.constants import (
    GROUP_ESTORNO,
    STATUS_CONCILIADO,
    STATUS_FOUND_DIFF,
    STATUS_NAO_AVALIADO,
)
from altool.engine.conciliacao import ConciliacaoConfig
from altool.engine.pipeline import (
    CancelamentoConfig,
    EstornoConfig,
    GROUP_DOC_ESTORNADOS,
    PipelineConfig,
    estorno_marks,
    run_pipeline,
)


def _con():  # type: ignore[no-untyped-def]
    con = duckdb.connect()
    con.execute("CREATE TABLE base_a(chave VARCHAR, doc VARCHAR, ref VARCHAR, valor VARCHAR)")
    con.execute("CREATE TABLE base_b(chave VARCHAR, indicador VARCHAR, valor VARCHAR)")
    con.executemany(
        "INSERT INTO base_a VALUES (?,?,?,?)",
        [
            ("K1", "D1", "", "1000"),   # rowid 0 — original
            ("K1", "", "D1", "-1000"),  # rowid 1 — estorno de D1 (pareia com o de cima)
            ("K2", "", "", "500"),      # rowid 2 — vai p/ conciliação
            ("K3", "", "", "1000"),     # rowid 3 — vai p/ conciliação
        ],
    )
    con.executemany(
        "INSERT INTO base_b VALUES (?,?,?)",
        [
            ("K2", "N", "500"),   # concilia com K2
            ("K4", "S", "999"),   # CANCELADA → excluída
            ("K3", "N", "1500"),  # K3: A=1000, B=1500 → Base B maior
        ],
    )
    return con


CFG = PipelineConfig(
    conciliacao=ConciliacaoConfig(
        key_cols_a=["chave"], key_cols_b=["chave"],
        value_col_a="valor", value_col_b="valor",
    ),
    estorno=EstornoConfig(col_a="doc", col_b="ref", col_soma="valor"),
    cancelamento=CancelamentoConfig(coluna="indicador", valor_cancelado="S"),
)


def test_pipeline_completo() -> None:
    con = _con()
    r = run_pipeline(con, CFG)

    # Estorno: A1+A2 pareados (Conciliado_Estorno) e excluídos do A×B.
    assert r.estorno_pares == 2
    assert r.estorno_docs == 0
    # Cancelamento: B da K4 excluído.
    assert r.canceladas == 1

    # Conciliação sobre o que sobrou: K2 concilia, K3 fica Base B maior.
    assert r.grupos_conciliacao == 2
    assert r.distribuicao.get(STATUS_CONCILIADO) == 1
    assert r.distribuicao.get(STATUS_FOUND_DIFF) == 1

    # K1 (estorno) e K4 (cancelada) não aparecem na conciliação.
    chaves = {row[0] for row in con.execute("SELECT chave FROM conc_grupos").fetchall()}
    assert chaves == {"K2", "K3"}


def test_estorno_documentos_nao_pareados() -> None:
    # Mesma chave nos dois lados, mas somas não anulam → ambos viram Documentos estornados.
    marks = estorno_marks(
        rows=[
            (0, "D1", "", "1000"),
            (1, "", "D1", "-700"),  # não anula 1000
        ],
        cfg=EstornoConfig(col_a="doc", col_b="ref", col_soma="valor"),
    )
    assert marks[0] == (STATUS_NAO_AVALIADO, GROUP_DOC_ESTORNADOS)
    assert marks[1] == (STATUS_NAO_AVALIADO, GROUP_DOC_ESTORNADOS)


def test_estorno_com_limite_zero() -> None:
    # limite_zero tolera pequena diferença: 1000 e -1000.4 anulam se limite_zero>=0.4.
    marks = estorno_marks(
        rows=[(0, "D1", "", "1000"), (1, "", "D1", "-1000.4")],
        cfg=EstornoConfig(col_a="doc", col_b="ref", col_soma="valor", limite_zero=0.5),
    )
    assert marks[0] == (STATUS_CONCILIADO, GROUP_ESTORNO)
    assert marks[1] == (STATUS_CONCILIADO, GROUP_ESTORNO)


def test_sem_config_opcional_roda_so_conciliacao() -> None:
    con = _con()
    r = run_pipeline(con, PipelineConfig(conciliacao=CFG.conciliacao))
    assert r.estorno_pares == 0 and r.canceladas == 0
    # Sem exclusões: K1 entra na conciliação (A1+A2 somam 0, sem B → Não Encontrado).
    assert r.grupos_conciliacao >= 3
