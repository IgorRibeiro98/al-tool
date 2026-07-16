"""Router de atribuições — espelha routes/atribuicoes.ts (create → start → results → export)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Request
from fastapi.responses import FileResponse, JSONResponse

from ...services.atribuicoes import AtribuicaoService

router = APIRouter(prefix="/atribuicoes", tags=["atribuicoes"])


def _svc(request: Request) -> AtribuicaoService:
    return request.app.state.atribuicoes  # type: ignore[no-any-return]


@router.post("/runs")
def create_run(request: Request, body: dict[str, Any] = Body(default={})):  # type: ignore[no-untyped-def]
    try:
        run = _svc(request).create_run(body)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return JSONResponse(status_code=201, content=run)


@router.get("/runs")
def list_runs(
    request: Request, page: int = 1, pageSize: int | None = None,
    limit: int | None = None, status: str | None = None,
) -> dict:
    return _svc(request).list_runs(page=page, page_size=pageSize or limit or 20, status=status)


@router.get("/runs/{run_id:int}")
def get_run(run_id: int, request: Request):  # type: ignore[no-untyped-def]
    run = _svc(request).get_run(run_id)
    if run is None:
        return JSONResponse(status_code=404, content={"error": "run not found"})
    return run


@router.post("/runs/{run_id:int}/start")
def start_run(run_id: int, request: Request):  # type: ignore[no-untyped-def]
    code, payload = _svc(request).start_run(run_id)
    return JSONResponse(status_code=code, content=payload)


@router.get("/runs/{run_id:int}/results")
def results(
    run_id: int, request: Request, page: int = 1, pageSize: int = 50, search: str | None = None
):  # type: ignore[no-untyped-def]
    res = _svc(request).results(run_id, page=page, page_size=pageSize, search=search)
    if res is None:
        return JSONResponse(status_code=404, content={"error": "run not found"})
    return res


@router.get("/runs/{run_id:int}/export")
def export(run_id: int, request: Request):  # type: ignore[no-untyped-def]
    code, payload = _svc(request).export(run_id)
    return JSONResponse(status_code=code, content=payload)


@router.get("/runs/{run_id:int}/download-xlsx")
def download(run_id: int, request: Request):  # type: ignore[no-untyped-def]
    info = _svc(request).download_info(run_id)
    if info is None:
        return JSONResponse(status_code=404, content={"error": "arquivo não encontrado"})
    return FileResponse(info["path"], media_type=info["media_type"], filename=info["filename"])


@router.delete("/runs/{run_id:int}")
def delete(run_id: int, request: Request):  # type: ignore[no-untyped-def]
    code, payload = _svc(request).delete(run_id)
    return JSONResponse(status_code=code, content=payload)
