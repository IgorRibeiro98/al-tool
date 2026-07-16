"""Serviço de licenciamento — port fiel de licensingService.ts + rota license.ts.

get_status: mesma lógica offline (not_activated / expired / blocked_offline com grace de
37 dias / active). activate: registra a licença após validação no servidor externo (única
exceção online do app). O POST externo é injetável para testes offline.
"""

from __future__ import annotations

import json
import os
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Callable

from ..domain.fingerprint import machine_fingerprint
from ..metadata.store import MetadataStore

OFFLINE_GRACE_DAYS = 37
DEFAULT_VALIDATION_DAYS = 30
ACTIVATION_PATH = "/api/licenses/activate"

HttpPost = Callable[[str, dict, str], dict]


class LicenseError(Exception):
    """Erro de ativação com código para a resposta HTTP (status_code opcional)."""

    def __init__(self, code: str, status_code: int = 400) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_date(value: object) -> datetime | None:
    if value is None or value == "":
        return None
    try:
        s = str(value).replace("Z", "+00:00")
        d = datetime.fromisoformat(s)
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _iso_z(d: datetime | None) -> str | None:
    """Serializa como o toISOString() do JS (…Z, milissegundos)."""
    if d is None:
        return None
    d = d.astimezone(timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"


def _default_http_post(url: str, body: dict, api_key: str) -> dict:
    payload = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url, data=payload, method="POST",
        headers={"Content-Type": "application/json", "x-license-api-key": api_key or ""},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310 (URL vem de env)
        raw = resp.read().decode("utf-8")
    return json.loads(raw) if raw else {}


class LicensingService:
    def __init__(
        self,
        store: MetadataStore,
        *,
        fingerprint_fn: Callable[[], str] = machine_fingerprint,
        http_post: HttpPost = _default_http_post,
    ) -> None:
        self._store = store
        self._fingerprint = fingerprint_fn
        self._http_post = http_post

    def get_status(self) -> dict:
        """Mesma árvore de decisão de licensingService.ts:48-72."""
        try:
            row = self._store.query_one("SELECT * FROM license WHERE id = 1")
            if row is None:
                return {"status": "not_activated"}

            now = _now()
            expires_at = _parse_date(row["expires_at"])
            last_success = _parse_date(row["last_success_online_validation_at"])

            if expires_at is not None and expires_at < now:
                return {"status": "expired", "expiresAt": _iso_z(expires_at)}
            if last_success is None:
                return {"status": "blocked_offline", "expiresAt": _iso_z(expires_at)}
            if last_success + timedelta(days=OFFLINE_GRACE_DAYS) < now:
                return {"status": "blocked_offline", "expiresAt": _iso_z(expires_at)}

            status = row["status"] if row["status"] else "active"
            return {"status": status, "expiresAt": _iso_z(expires_at)}
        except Exception:
            return {"status": "not_activated"}

    def activate(self, license_key: str | None) -> dict:
        """Ativa a licença. Lança LicenseError em falha. Retorna {'success': True}."""
        if not license_key or not isinstance(license_key, str):
            raise LicenseError("missing_license_key")

        base = os.environ.get("LICENSE_API_BASE_URL") or os.environ.get("LICENSE_SERVER_BASE_URL")
        if not base:
            raise LicenseError("LICENSE_API_BASE_URL not configured", status_code=500)

        fingerprint = self._fingerprint()
        app_version = os.environ.get("APP_VERSION", "0.0.0")
        url = base.rstrip("/") + ACTIVATION_PATH
        api_key = os.environ.get("LICENSE_API_SECRET", "")

        response = self._http_post(
            url, {"licenseKey": license_key, "machineFingerprint": fingerprint,
                  "appVersion": app_version}, api_key,
        )
        token = response.get("activation_token") or response.get("token") or response.get("activationToken")
        expires_at = response.get("expires_at") or response.get("expiresAt") or response.get("expires")
        if not token:
            raise LicenseError("activation_response_missing_token")

        self._upsert(license_key, token, fingerprint, expires_at)
        return {"success": True}

    def _upsert(
        self, license_key: str, token: str, fingerprint: str, expires_at: str | None
    ) -> None:
        now = _now()
        nxt = now + timedelta(days=DEFAULT_VALIDATION_DAYS)
        with self._store.tx() as con:
            con.execute(
                """
                INSERT INTO license (id, license_key, activation_token, machine_fingerprint,
                    status, expires_at, last_success_online_validation_at,
                    next_online_validation_at, last_error)
                VALUES (1, ?, ?, ?, 'active', ?, ?, ?, NULL)
                ON CONFLICT(id) DO UPDATE SET
                    license_key=excluded.license_key,
                    activation_token=excluded.activation_token,
                    machine_fingerprint=excluded.machine_fingerprint,
                    status='active',
                    expires_at=excluded.expires_at,
                    last_success_online_validation_at=excluded.last_success_online_validation_at,
                    next_online_validation_at=excluded.next_online_validation_at,
                    last_error=NULL
                """,
                (license_key, token, fingerprint, expires_at or _iso_z(now),
                 _iso_z(now), _iso_z(nxt)),
            )
