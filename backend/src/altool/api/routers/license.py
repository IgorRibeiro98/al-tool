"""Router de licença — espelha routes/license.ts (contrato idêntico ao consumido pelo React)."""

from __future__ import annotations

import os

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ...services.licensing import LicenseError, LicensingService

router = APIRouter(prefix="/license", tags=["license"])

# v2 não tem autenticação por enquanto. Com licenciamento DESLIGADO (default), /status
# sempre responde 'active' — o LicenseGate do React libera o app sem pedir chave. O
# LicensingService (e seus testes) fica intacto para reativar via ALTOOL_LICENSE_ENABLED=1.
def _licensing_enabled() -> bool:
    return os.environ.get("ALTOOL_LICENSE_ENABLED") == "1"


class ActivateBody(BaseModel):
    licenseKey: str | None = None


def _service(request: Request) -> LicensingService:
    return request.app.state.licensing  # type: ignore[no-any-return]


@router.get("/status")
def status(request: Request) -> dict:
    if not _licensing_enabled():
        return {"status": "active", "expiresAt": None}
    try:
        return _service(request).get_status()
    except Exception:
        return JSONResponse(status_code=500, content={"error": "internal_error"})  # type: ignore[return-value]


@router.post("/activate")
def activate(body: ActivateBody, request: Request):  # type: ignore[no-untyped-def]
    if not _licensing_enabled():
        return {"success": True}  # no-op: licenciamento desligado na v2
    try:
        return _service(request).activate(body.licenseKey)
    except LicenseError as e:
        return JSONResponse(status_code=e.status_code, content={"error": e.code})
    except Exception as e:  # falha externa → 400 { error: mensagem } (igual à v1)
        return JSONResponse(status_code=400, content={"error": str(e) or "internal_error"})
