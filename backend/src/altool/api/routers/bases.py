"""Router de bases — espelha routes/bases.ts (fatia central: list, get, columns, preview,
upload multipart, ingest assíncrono, delete)."""

from __future__ import annotations

import os
import shutil
import uuid
from pathlib import Path

from typing import Any

from fastapi import APIRouter, Body, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse

from ...services.bases import BasesService

router = APIRouter(prefix="/bases", tags=["bases"])


def _svc(request: Request) -> BasesService:
    return request.app.state.bases  # type: ignore[no-any-return]


# ---- subtypes (antes de /{base_id}; 'subtypes' não casa com {base_id:int}) ----
@router.get("/subtypes")
def list_subtypes(request: Request) -> dict:
    return {"data": _svc(request).list_subtypes()}


@router.post("/subtypes")
def create_subtype(request: Request, body: dict[str, Any] = Body(default={})):  # type: ignore[no-untyped-def]
    if not body.get("name"):
        return JSONResponse(status_code=400, content={"error": "name é obrigatório"})
    return JSONResponse(status_code=201, content={"data": _svc(request).create_subtype(body["name"])})


@router.get("/subtypes/{sub_id:int}")
def get_subtype(sub_id: int, request: Request):  # type: ignore[no-untyped-def]
    s = _svc(request).get_subtype(sub_id)
    return {"data": s} if s else JSONResponse(status_code=404, content={"error": "not found"})


@router.put("/subtypes/{sub_id:int}")
def update_subtype(sub_id: int, request: Request, body: dict[str, Any] = Body(default={})):  # type: ignore[no-untyped-def]
    s = _svc(request).update_subtype(sub_id, body.get("name"))
    return {"data": s} if s else JSONResponse(status_code=404, content={"error": "not found"})


@router.delete("/subtypes/{sub_id:int}")
def delete_subtype(sub_id: int, request: Request) -> dict:
    return _svc(request).delete_subtype(sub_id)


def _upload_dir() -> Path:
    d = Path(os.environ.get("UPLOAD_DIR") or (Path(os.environ.get("DATA_DIR", ".")) / "uploads"))
    d.mkdir(parents=True, exist_ok=True)
    return d


@router.get("")
def list_bases(
    request: Request, page: int = 1, pageSize: int | None = None,
    limit: int | None = None, tipo: str | None = None,
    periodo: str | None = None, subtype: str | None = None,
) -> dict:
    size = pageSize or limit or 20
    return _svc(request).list_bases(
        page=page, page_size=size, tipo=tipo, periodo=periodo, subtype=subtype
    )


@router.get("/{base_id:int}")
def get_base(base_id: int, request: Request):  # type: ignore[no-untyped-def]
    base = _svc(request).get_base(base_id)
    if base is None:
        return JSONResponse(status_code=404, content={"error": "Base not found"})
    return base


@router.get("/{base_id:int}/columns")
def get_columns(base_id: int, request: Request) -> dict:
    return {"data": _svc(request).get_columns(base_id)}


@router.get("/{base_id:int}/preview")
def preview(base_id: int, request: Request):  # type: ignore[no-untyped-def]
    try:
        result = _svc(request).preview(base_id)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    if result is None:
        return JSONResponse(status_code=404, content={"error": "Base not found"})
    return result


@router.post("/{base_id:int}/ingest")
def ingest_base(base_id: int, request: Request):  # type: ignore[no-untyped-def]
    result = _svc(request).enqueue_ingest(base_id)
    return JSONResponse(status_code=202, content=result)


@router.patch("/{base_id:int}")
def patch_base(base_id: int, request: Request, body: dict[str, Any] = Body(default={})):  # type: ignore[no-untyped-def]
    b = _svc(request).patch_base(base_id, body)
    return {"data": b} if b else JSONResponse(status_code=404, content={"error": "Base not found"})


@router.patch("/{base_id:int}/columns/{col_id:int}")
def patch_column(base_id: int, col_id: int, request: Request, body: dict[str, Any] = Body(default={})):  # type: ignore[no-untyped-def]
    c = _svc(request).patch_column(base_id, col_id, body.get("is_monetary"))
    if c is None:
        return JSONResponse(status_code=404, content={"error": "column not found"})
    return {"success": True, "data": c}


@router.post("/{base_id:int}/reuse-monetary")
def reuse_monetary(base_id: int, request: Request, body: dict[str, Any] = Body(default={})):  # type: ignore[no-untyped-def]
    return _svc(request).reuse_monetary(base_id, body)


@router.post("/{base_id:int}/columns/derived")
def create_derived(base_id: int, request: Request, body: dict[str, Any] = Body(default={})):  # type: ignore[no-untyped-def]
    try:
        result = _svc(request).create_derived(base_id, body.get("sourceColumn"), body.get("op", ""))
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return JSONResponse(status_code=202 if result.get("background") else 201, content=result)


@router.get("/{base_id:int}/columns/derived/jobs")
def list_derived_jobs(base_id: int, request: Request) -> dict:
    return {"jobs": _svc(request).list_derived_jobs(base_id)}


@router.get("/{base_id:int}/columns/derived/jobs/{job_id:int}")
def get_derived_job(base_id: int, job_id: int, request: Request):  # type: ignore[no-untyped-def]
    j = _svc(request).get_derived_job(job_id)
    return {"job": j} if j else JSONResponse(status_code=404, content={"error": "job not found"})


@router.delete("/{base_id:int}")
def delete_base(base_id: int, request: Request) -> dict:
    return _svc(request).delete_base(base_id)


@router.post("")
async def create_bases(  # type: ignore[no-untyped-def]
    request: Request,
    arquivo: list[UploadFile] = File(...),
    tipo: str = Form(...),
    subtype: str = Form(...),
    nome: str | None = Form(None),
    periodo: str | None = Form(None),
    header_linha_inicial: int = Form(1),
    header_coluna_inicial: int = Form(1),
    reference_base_id: int | None = Form(None),
):
    updir = _upload_dir()
    items = []
    for f in arquivo:
        safe = f"{uuid.uuid4().hex}_{Path(f.filename or 'arquivo').name}"
        dest = updir / safe
        with dest.open("wb") as out:
            shutil.copyfileobj(f.file, out)
        items.append({
            "tipo": tipo, "subtype": subtype,
            "nome": nome or Path(f.filename or safe).stem,
            "periodo": periodo, "arquivo_caminho": str(dest),
            "header_linha_inicial": header_linha_inicial,
            "header_coluna_inicial": header_coluna_inicial,
            "reference_base_id": reference_base_id,
        })
    bases = _svc(request).create_bases(items)
    return JSONResponse(status_code=201, content={"data": bases})
