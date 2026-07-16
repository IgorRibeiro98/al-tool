"""Contrato mínimo da API (Fase 0): /health responde e valida via Pydantic."""

from __future__ import annotations

from fastapi.testclient import TestClient

from altool.api.app import create_app


def test_health_ok() -> None:
    client = TestClient(create_app())
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["engine"] == "duckdb+polars"
    assert body["duckdb"]  # versão não-vazia
    assert body["version"] == "0.1.0"
