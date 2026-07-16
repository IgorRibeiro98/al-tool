"""Routers de keys e keys-pairs — envelope {data, meta}; delete = 204 (keys bloqueia se em uso)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Request, Response
from fastapi.responses import JSONResponse

from ...services.keys import KeyInUse, KeysService

keys_router = APIRouter(prefix="/keys", tags=["keys"])
keys_pairs_router = APIRouter(prefix="/keys-pairs", tags=["keys"])


def _svc(request: Request) -> KeysService:
    return request.app.state.keys  # type: ignore[no-any-return]


def _nf():  # type: ignore[no-untyped-def]
    return JSONResponse(status_code=404, content={"error": "Not found"})


# ---------------------------------------------------------------- keys
@keys_router.get("")
def list_keys(
    request: Request, base_tipo: str | None = None, base_subtipo: str | None = None,
    nome: str | None = None, page: int = 1, pageSize: int = 100,
) -> dict:
    return _svc(request).list_keys(
        base_tipo=base_tipo, base_subtipo=base_subtipo, nome=nome,
        page=page, page_size=min(pageSize, 1000),
    )


@keys_router.get("/{key_id:int}")
def get_key(key_id: int, request: Request):  # type: ignore[no-untyped-def]
    k = _svc(request).get_key(key_id)
    return k if k is not None else _nf()


@keys_router.post("")
def create_key(request: Request, body: dict[str, Any] = Body(default={})):  # type: ignore[no-untyped-def]
    cols = body.get("columns") or []
    if not body.get("nome") or not cols:
        return JSONResponse(status_code=400, content={"error": "nome e columns são obrigatórios"})
    k = _svc(request).create_key(
        nome=body["nome"], base_tipo=body.get("base_tipo"), base_subtipo=body.get("base_subtipo"),
        columns=cols, descricao=body.get("descricao"),
    )
    return JSONResponse(status_code=201, content=k)


@keys_router.put("/{key_id:int}")
def update_key(key_id: int, request: Request, body: dict[str, Any] = Body(default={})):  # type: ignore[no-untyped-def]
    k = _svc(request).update_key(key_id, body)
    return k if k is not None else _nf()


@keys_router.delete("/{key_id:int}")
def delete_key(key_id: int, request: Request):  # type: ignore[no-untyped-def]
    try:
        _svc(request).delete_key(key_id)
    except KeyInUse:
        return JSONResponse(status_code=400, content={"error": "key referenciada; não pode remover"})
    return Response(status_code=204)


# ---------------------------------------------------------------- keys-pairs
@keys_pairs_router.get("")
def list_pairs(request: Request, page: int = 1, pageSize: int = 100) -> dict:
    return _svc(request).list_pairs(page=page, page_size=min(pageSize, 1000))


@keys_pairs_router.get("/{pair_id:int}")
def get_pair(pair_id: int, request: Request):  # type: ignore[no-untyped-def]
    p = _svc(request).get_pair(pair_id)
    return p if p is not None else _nf()


@keys_pairs_router.post("")
def create_pair(request: Request, body: dict[str, Any] = Body(default={})):  # type: ignore[no-untyped-def]
    if not body.get("contabil_key_id") or not body.get("fiscal_key_id"):
        return JSONResponse(status_code=400,
                            content={"error": "contabil_key_id e fiscal_key_id são obrigatórios"})
    p = _svc(request).create_pair(
        nome=body.get("nome"), contabil_key_id=body["contabil_key_id"],
        fiscal_key_id=body["fiscal_key_id"], descricao=body.get("descricao"),
    )
    return JSONResponse(status_code=201, content=p)


@keys_pairs_router.put("/{pair_id:int}")
def update_pair(pair_id: int, request: Request, body: dict[str, Any] = Body(default={})):  # type: ignore[no-untyped-def]
    p = _svc(request).update_pair(pair_id, body)
    return p if p is not None else _nf()


@keys_pairs_router.delete("/{pair_id:int}")
def delete_pair(pair_id: int, request: Request) -> Response:
    _svc(request).delete_pair(pair_id)
    return Response(status_code=204)
