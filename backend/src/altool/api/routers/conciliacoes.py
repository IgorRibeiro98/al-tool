"""Router de conciliações — espelha routes/conciliacoes.ts (create → polling → resultado)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Request
from fastapi.responses import FileResponse, JSONResponse

from ...services.conciliacoes import ConciliacaoService

router = APIRouter(prefix="/conciliacoes", tags=["conciliacoes"])


def _svc(request: Request) -> ConciliacaoService:
    return request.app.state.conciliacoes  # type: ignore[no-any-return]


@router.post("")
def create(request: Request, body: dict[str, Any] = Body(default={})):  # type: ignore[no-untyped-def]
    try:
        job = _svc(request).create_job(body)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return JSONResponse(status_code=201, content=job)


@router.get("")
def list_jobs(
    request: Request, page: int = 1, pageSize: int | None = None,
    limit: int | None = None, status: str | None = None,
) -> dict:
    return _svc(request).list_jobs(page=page, page_size=pageSize or limit or 20, status=status)


@router.get("/{job_id:int}")
def get_job(job_id: int, request: Request):  # type: ignore[no-untyped-def]
    res = _svc(request).get_with_metrics(job_id)
    if res is None:
        return JSONResponse(status_code=404, content={"error": "job not found"})
    return res


@router.get("/{job_id:int}/resultado")
def resultado(
    job_id: int, request: Request, page: int = 1, pageSize: int = 50,
    status: str | None = None, search: str | None = None, searchColumn: str | None = None,
):  # type: ignore[no-untyped-def]
    res = _svc(request).resultado(
        job_id, page=page, page_size=pageSize, status=status,
        search=search, search_column=searchColumn,
    )
    if res is None:
        return JSONResponse(status_code=404, content={"error": "job not found"})
    return res


@router.post("/{job_id:int}/exportar")
def exportar(job_id: int, request: Request):  # type: ignore[no-untyped-def]
    code, payload = _svc(request).exportar(job_id)
    return JSONResponse(status_code=code, content=payload)


@router.get("/{job_id:int}/export-status")
def export_status(job_id: int, request: Request):  # type: ignore[no-untyped-def]
    res = _svc(request).export_status(job_id)
    if res is None:
        return JSONResponse(status_code=404, content={"error": "job not found"})
    return res


@router.get("/{job_id:int}/download")
def download(job_id: int, request: Request):  # type: ignore[no-untyped-def]
    info = _svc(request).download_info(job_id)
    if info is None:
        return JSONResponse(status_code=404, content={"error": "arquivo não encontrado"})
    return FileResponse(info["path"], media_type=info["media_type"], filename=info["filename"])


@router.delete("/{job_id:int}")
def delete(job_id: int, request: Request) -> dict:
    return _svc(request).delete(job_id)
