#!/usr/bin/env python3
"""Diff de dois mapas {chave: status} (v1 vs v2). Uso: compare.py v1.json v2.json"""

import collections
import json
import sys


def main() -> int:
    v1 = json.load(open(sys.argv[1]))
    v2 = json.load(open(sys.argv[2]))
    k1, k2 = set(v1), set(v2)
    print(f"v1: {len(k1)} chaves {dict(collections.Counter(v1.values()))}")
    print(f"v2: {len(k2)} chaves {dict(collections.Counter(v2.values()))}")
    print(f"só em v1: {len(k1 - k2)} | só em v2: {len(k2 - k1)}")
    diffs = [(k, v1[k], v2[k]) for k in (k1 & k2) if v1[k] != v2[k]]
    print(f"divergências de status: {len(diffs)}")
    for k, a, b in diffs[:20]:
        print(f"  {k!r}: v1={a} v2={b}")
    ok = not (k1 ^ k2) and not diffs
    print("\n✅ IDÊNTICOS" if ok else "\n⚠️ DIVERGEM")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
