"""Fingerprint de máquina — DEVE gerar o mesmo sha256 da v1 (apps/desktop/src/main/machineFingerprint.ts).

v1 (Node):
    parts = [os.hostname(), os.platform(), os.arch(), cpus()[0].model].map(s => (s ?? '').trim())
    raw   = parts.join('|')
    hash  = sha256(raw, 'utf8').hex()

Design: a função de HASH (`fingerprint_from_parts`) é pura e determinística — testada
byte-a-byte contra um golden hash gerado pelo Node. A COLETA dos valores da máquina
(`gather_parts`) é best-effort e precisa ser reconciliada por SO na Fase 4, porque
`os.platform()`/`os.arch()`/`cpus()[0].model` do Node não têm equivalente idêntico
trivial em Python (ver ARMADILHA §7.1 do remake-v2-python.md).
"""

from __future__ import annotations

import hashlib
import platform
import socket


def _safe(value: str | None) -> str:
    """Equivalente a safeString: (value ?? '').trim()."""
    return (value or "").strip()


def fingerprint_from_parts(hostname: str, os_platform: str, arch: str, cpu_model: str) -> str:
    """Função PURA: reproduz exatamente o hash da v1. Testável contra golden do Node."""
    raw = "|".join(_safe(p) for p in (hostname, os_platform, arch, cpu_model))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# --- Coleta best-effort (reconciliar por SO na Fase 4) ---

# Node os.platform() → valor fixo por SO. Python platform.system() difere → mapear.
_NODE_PLATFORM = {"Linux": "linux", "Windows": "win32", "Darwin": "darwin"}

# Node os.arch() usa nomenclatura própria; mapear de platform.machine().
_NODE_ARCH = {
    "x86_64": "x64",
    "AMD64": "x64",
    "aarch64": "arm64",
    "arm64": "arm64",
    "i386": "ia32",
    "i686": "ia32",
}


def _node_platform() -> str:
    return _NODE_PLATFORM.get(platform.system(), platform.system().lower())


def _node_arch() -> str:
    return _NODE_ARCH.get(platform.machine(), platform.machine())


def _cpu_model() -> str:
    """Aproximação de cpus()[0].model. NÃO garantidamente idêntico ao Node —
    reconciliar na Fase 4 (ex.: ler /proc/cpuinfo no Linux, registry/WMI no Windows).
    """
    return platform.processor() or ""


def gather_parts() -> tuple[str, str, str, str]:
    return (socket.gethostname(), _node_platform(), _node_arch(), _cpu_model())


def machine_fingerprint() -> str:
    """Fingerprint da máquina atual (best-effort até reconciliação da Fase 4)."""
    return fingerprint_from_parts(*gather_parts())
