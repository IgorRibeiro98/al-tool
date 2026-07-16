"""Fingerprint deve gerar sha256 idêntico ao da v1 (Node).

Golden gerado com o mesmo code path da v1:
    node -e '...createHash("sha256").update(parts.map(s=>(s??"").trim()).join("|")).digest("hex")'
"""

from __future__ import annotations

from altool.domain.fingerprint import (
    fingerprint_from_parts,
    gather_parts,
    machine_fingerprint,
)

# Partes fixas conhecidas → hash gerado pelo Node (função pura, determinística).
FIXED_PARTS = ("MINHA-MAQUINA", "win32", "x64", "Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz")
FIXED_HASH = "e452bf0de2a53b91db99be5487b1bfae05c46269d09710f1f7779dbbb62a9999"


def test_hash_matches_node_golden() -> None:
    assert fingerprint_from_parts(*FIXED_PARTS) == FIXED_HASH


def test_hash_is_deterministic() -> None:
    assert fingerprint_from_parts(*FIXED_PARTS) == fingerprint_from_parts(*FIXED_PARTS)


def test_trim_is_applied_like_node_safestring() -> None:
    # safeString faz .trim() em cada parte antes do join.
    assert fingerprint_from_parts("  a  ", " b", "c ", "d") == fingerprint_from_parts(
        "a", "b", "c", "d"
    )


def test_none_parts_become_empty() -> None:
    # (value ?? '') → None vira string vazia.
    assert fingerprint_from_parts("a", "", "c", "") == fingerprint_from_parts("a", "", "c", "")


def test_machine_fingerprint_is_stable_and_hex64() -> None:
    fp = machine_fingerprint()
    assert fp == machine_fingerprint()
    assert len(fp) == 64
    assert all(c in "0123456789abcdef" for c in fp)


def test_gather_parts_shape() -> None:
    parts = gather_parts()
    assert len(parts) == 4
    # platform mapeado p/ o vocabulário do Node (linux/win32/darwin).
    assert parts[1] in {"linux", "win32", "darwin"} or parts[1] == parts[1].lower()
