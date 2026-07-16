"""Router de maintenance — cleanup de storage e resultados."""

from __future__ import annotations

from fastapi import APIRouter, Request

from ...services.maintenance import MaintenanceService

router = APIRouter(prefix="/maintenance", tags=["maintenance"])


def _svc(request: Request) -> MaintenanceService:
    return request.app.state.maintenance  # type: ignore[no-any-return]


@router.post("/cleanup")
def cleanup(request: Request) -> dict:
    return _svc(request).cleanup()


@router.post("/cleanup/storage")
def cleanup_storage(request: Request) -> dict:
    return _svc(request).cleanup_storage()


@router.post("/cleanup/results")
def cleanup_results(request: Request) -> dict:
    return _svc(request).cleanup_results()


# Alias para o path que o service do frontend chama (bug de contrato da v1: cleanup-results).
@router.post("/cleanup-results")
def cleanup_results_alias(request: Request) -> dict:
    return _svc(request).cleanup_results()
