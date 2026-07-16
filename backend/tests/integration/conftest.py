"""Fixtures de integração — ingere as bases reais UMA vez por sessão."""

from __future__ import annotations

from pathlib import Path

import pytest

from altool.engine.db import connect
from altool.engine.ingest import IngestSpec, ingest_xlsx

REF = Path(__file__).resolve().parents[3] / "storage" / "ref"
RAZAO = REF / "Razão_223_122025.xlsx"
LIVRO = REF / "Livro_Entradas_122025.xlsx"


@pytest.fixture(scope="session")
def real_con():  # type: ignore[no-untyped-def]
    if not (RAZAO.exists() and LIVRO.exists()):
        pytest.skip("planilhas reais ausentes em storage/ref")
    con = connect()
    con.execute("PRAGMA memory_limit='900MB'")  # simula desktop modesto
    ingest_xlsx(con, str(RAZAO), "base_a", IngestSpec(header_row=6, start_col=2))
    ingest_xlsx(con, str(LIVRO), "base_b", IngestSpec(header_row=5, start_col=1))
    yield con
    con.close()
