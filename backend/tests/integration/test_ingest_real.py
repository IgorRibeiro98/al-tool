"""Ingestão validada contra as planilhas REAIS em storage/ref.

Lento (~13s para ingerir o Livro de 148MB, feito uma vez no fixture `real_con`).
Rodar com:  pytest -m integration
"""

from __future__ import annotations

import pytest

from altool.engine.ingest import numeric_sql

pytestmark = pytest.mark.integration


def test_base_a_razao(real_con) -> None:  # type: ignore[no-untyped-def]
    n = real_con.execute("SELECT count(*) FROM base_a").fetchone()[0]
    assert n == 38874
    cols = [c[0] for c in real_con.execute("SELECT * FROM base_a LIMIT 0").description]
    assert "indice" in cols
    assert "per_odo" in cols  # "Período" — acento vira '_' (sanitização fiel à v1)
    assert "nota_fiscal" in cols


def test_base_b_livro_grande_volume(real_con) -> None:  # type: ignore[no-untyped-def]
    n = real_con.execute("SELECT count(*) FROM base_b").fetchone()[0]
    assert n == 429261

    # Regra de cancelamento (§5) sobre dados reais.
    canc = dict(
        real_con.execute(
            "SELECT indicador_de_cancelamento, count(*) FROM base_b GROUP BY 1"
        ).fetchall()
    )
    assert canc["N"] == 427459
    assert canc["S"] == 1802

    # Normalização numérica: 'valor_cont_bil' tem vírgula decimal ("2790022,95").
    total = real_con.execute(
        f'SELECT round(sum({numeric_sql("valor_cont_bil")}), 2) FROM base_b'
    ).fetchone()[0]
    assert total is not None and total > 0
