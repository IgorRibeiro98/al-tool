"""Exportação XLSX em escala real (468k linhas)."""

from __future__ import annotations

import openpyxl
import pytest

from altool.engine.conciliacao import KeyDef
from altool.engine.export import export_resultado_xlsx
from altool.engine.pipeline import CancelamentoConfig, run_conciliacao

pytestmark = pytest.mark.integration


def test_export_resultado_real(real_con, tmp_path) -> None:  # type: ignore[no-untyped-def]
    run_conciliacao(
        real_con,
        [KeyDef("CHAVE_1", ["id_origem"], ["id_origem"]),
         KeyDef("CHAVE_2", ["nota_fiscal"], ["nota_fiscal"])],
        value_col_a="mont_emmi", value_col_b="valor_cont_bil",
        cancelamento=CancelamentoConfig(
            coluna="indicador_de_cancelamento", valor_cancelado="S"
        ),
    )
    out = tmp_path / "resultado.xlsx"
    n = export_resultado_xlsx(real_con, "conciliacao_result", str(out))

    assert n == 468135
    assert out.exists() and out.stat().st_size > 0
    # Reabre e confere header + que abriu como xlsx válido (read_only p/ não carregar tudo).
    wb = openpyxl.load_workbook(out, read_only=True)
    ws = wb["resultado"]
    headers = [c.value for c in next(ws.iter_rows(max_row=1))]
    assert headers[0] == "origem" and "status" in headers
    wb.close()
