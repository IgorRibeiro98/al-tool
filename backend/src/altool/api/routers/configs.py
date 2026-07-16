"""Routers de configs — conciliação/estorno/cancelamento/mapeamento.

Convenções do contrato: GET lista = **array puro** (sem envelope); create = **201**;
delete = **204 sem corpo**.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Request, Response
from fastapi.responses import JSONResponse

from ...services.configs import ConfigNotFound, ConfigsService

conciliacao_router = APIRouter(prefix="/configs/conciliacao", tags=["configs"])
estorno_router = APIRouter(prefix="/configs/estorno", tags=["configs"])
cancelamento_router = APIRouter(prefix="/configs/cancelamento", tags=["configs"])
mapeamento_router = APIRouter(prefix="/configs/mapeamento", tags=["configs"])


def _svc(request: Request) -> ConfigsService:
    return request.app.state.configs  # type: ignore[no-any-return]


def _not_found(msg: str = "Not found"):  # type: ignore[no-untyped-def]
    return JSONResponse(status_code=404, content={"error": msg})


# ---------------------------------------------------------------- conciliação
@conciliacao_router.get("")
def list_conciliacao(request: Request) -> list:
    return _svc(request).list_conciliacao()


@conciliacao_router.get("/{config_id:int}")
def get_conciliacao(config_id: int, request: Request):  # type: ignore[no-untyped-def]
    cfg = _svc(request).get_conciliacao(config_id)
    return cfg if cfg is not None else _not_found()


@conciliacao_router.post("")
def create_conciliacao(request: Request, body: dict[str, Any] = Body(default={})):  # type: ignore[no-untyped-def]
    try:
        cfg = _svc(request).create_conciliacao_from_body(body)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return JSONResponse(status_code=201, content=cfg)


@conciliacao_router.put("/{config_id:int}")
def update_conciliacao(config_id: int, request: Request, body: dict[str, Any] = Body(default={})):  # type: ignore[no-untyped-def]
    try:
        return _svc(request).update_conciliacao(config_id, body)
    except ConfigNotFound:
        return _not_found()
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})


@conciliacao_router.delete("/{config_id:int}", status_code=204)
def delete_conciliacao(config_id: int, request: Request) -> Response:
    _svc(request).delete_conciliacao(config_id)
    return Response(status_code=204)


# ---------------------------------------------------------------- estorno
@estorno_router.get("")
def list_estorno(request: Request) -> list:
    return _svc(request).list_estorno()


@estorno_router.get("/{config_id:int}")
def get_estorno(config_id: int, request: Request):  # type: ignore[no-untyped-def]
    cfg = _svc(request).get_estorno(config_id)
    return cfg if cfg is not None else _not_found()


@estorno_router.post("")
def create_estorno(request: Request, body: dict[str, Any] = Body(default={})):  # type: ignore[no-untyped-def]
    cfg = _svc(request).create_estorno(
        nome=body.get("nome"), coluna_a=body.get("coluna_a"), coluna_b=body.get("coluna_b"),
        coluna_soma=body.get("coluna_soma"), base_id=body.get("base_id"),
        limite_zero=float(body.get("limite_zero") or 0), ativa=body.get("ativa", True),
    )
    return JSONResponse(status_code=201, content=cfg)


@estorno_router.put("/{config_id:int}")
def update_estorno(config_id: int, request: Request, body: dict[str, Any] = Body(default={})):  # type: ignore[no-untyped-def]
    try:
        return _svc(request).update_estorno(config_id, body)
    except ConfigNotFound:
        return _not_found()


@estorno_router.delete("/{config_id:int}", status_code=204)
def delete_estorno(config_id: int, request: Request) -> Response:
    _svc(request).delete_estorno(config_id)
    return Response(status_code=204)


# ---------------------------------------------------------------- cancelamento
@cancelamento_router.get("")
def list_cancelamento(request: Request) -> list:
    return _svc(request).list_cancelamento()


@cancelamento_router.get("/{config_id:int}")
def get_cancelamento(config_id: int, request: Request):  # type: ignore[no-untyped-def]
    cfg = _svc(request).get_cancelamento(config_id)
    return cfg if cfg is not None else _not_found()


@cancelamento_router.post("")
def create_cancelamento(request: Request, body: dict[str, Any] = Body(default={})):  # type: ignore[no-untyped-def]
    cfg = _svc(request).create_cancelamento(
        nome=body.get("nome"), coluna_indicador=body.get("coluna_indicador"),
        valor_cancelado=body.get("valor_cancelado"),
        valor_nao_cancelado=body.get("valor_nao_cancelado", "N"),
        base_id=body.get("base_id"), ativa=body.get("ativa", True),
    )
    return JSONResponse(status_code=201, content=cfg)


@cancelamento_router.put("/{config_id:int}")
def update_cancelamento(config_id: int, request: Request, body: dict[str, Any] = Body(default={})):  # type: ignore[no-untyped-def]
    try:
        return _svc(request).update_cancelamento(config_id, body)
    except ConfigNotFound:
        return _not_found()


@cancelamento_router.delete("/{config_id:int}", status_code=204)
def delete_cancelamento(config_id: int, request: Request) -> Response:
    _svc(request).delete_cancelamento(config_id)
    return Response(status_code=204)


# ---------------------------------------------------------------- mapeamento
@mapeamento_router.get("")
def list_mapeamento(request: Request) -> list:
    return _svc(request).list_mapeamento()


@mapeamento_router.get("/{config_id:int}")
def get_mapeamento(config_id: int, request: Request):  # type: ignore[no-untyped-def]
    cfg = _svc(request).get_mapeamento(config_id)
    return cfg if cfg is not None else _not_found("Configuração não encontrada")


@mapeamento_router.post("")
def create_mapeamento(request: Request, body: dict[str, Any] = Body(default={})):  # type: ignore[no-untyped-def]
    cfg = _svc(request).create_mapeamento(
        nome=body.get("nome"), base_contabil_id=body.get("base_contabil_id"),
        base_fiscal_id=body.get("base_fiscal_id"), mapeamentos=body.get("mapeamentos"),
    )
    return JSONResponse(status_code=201, content=cfg)


@mapeamento_router.put("/{config_id:int}")
def update_mapeamento(config_id: int, request: Request, body: dict[str, Any] = Body(default={})):  # type: ignore[no-untyped-def]
    try:
        return _svc(request).update_mapeamento(config_id, body)
    except ConfigNotFound:
        return _not_found("Configuração não encontrada")


@mapeamento_router.delete("/{config_id:int}", status_code=204)
def delete_mapeamento(config_id: int, request: Request) -> Response:
    _svc(request).delete_mapeamento(config_id)
    return Response(status_code=204)


ALL_CONFIG_ROUTERS = (conciliacao_router, estorno_router, cancelamento_router, mapeamento_router)
