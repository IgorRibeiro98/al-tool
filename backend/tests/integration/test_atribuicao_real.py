"""Atribuição em escala real (Razão → Livro por nota_fiscal)."""

from __future__ import annotations

import pytest

from altool.engine.atribuicao import (
    MODE_OVERWRITE,
    AtribKey,
    AtribuicaoConfig,
    atribuir,
)

pytestmark = pytest.mark.integration


def test_atribuicao_real(real_con) -> None:  # type: ignore[no-untyped-def]
    cfg = AtribuicaoConfig(
        keys=[AtribKey("CHAVE_1", ["nota_fiscal"], ["nota_fiscal"])],
        selected_columns=["conta", "texto"],
        mode=MODE_OVERWRITE,
    )
    r = atribuir(real_con, cfg, table_origem="base_a", table_destino="base_b")

    assert r.linhas == 42718
    assert r.por_chave == {"CHAVE_1": 42718}
    # toda linha resolvida pela CHAVE_1 e com valores copiados da origem.
    distintas = real_con.execute(
        "SELECT count(DISTINCT matched_key) FROM atribuicao_result"
    ).fetchone()[0]
    assert distintas == 1
    com_conta = real_con.execute(
        "SELECT count(*) FROM atribuicao_result WHERE conta IS NOT NULL AND conta <> 'NULL'"
    ).fetchone()[0]
    assert com_conta > 0
