"""Pipeline de conciliação encadeado: Estorno(A) → Cancelamento(B) → Conciliação(A×B).

Ordem fiel à v1 (integration.ts): NullsA → EstornoA → NullsB → CancelamentoB → ConciliaçãoAB.
Aqui os **nulls (T52) são aplicados inline** em todo compute (ver nota em conciliacao._num /
matching.compose_key), então as etapas que alteram a composição de linhas são estorno e
cancelamento (ambas excluem linhas do A×B) seguidas da conciliação sobre o que sobrou.

- Estorno: port fiel do algoritmo guloso O(n) de EstornoBaseAStep.ts (pareamento com estado).
- Cancelamento: SQL (marca linhas da Base B cuja coluna indicadora == valor cancelado).

Nota de performance do estorno: o pareamento é O(bucket²) DENTRO de cada chave (col_a/col_b).
Assume cardinalidade razoável dessas colunas (números de documento). Uma coluna de baixa
cardinalidade (ex.: todas as linhas com o mesmo valor) degrada para O(n²) — igual à v1.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Sequence

import duckdb

from ..domain.constants import (
    GROUP_ESTORNO,
    SOMA_PRECISION,
    STATUS_CONCILIADO,
    STATUS_NAO_AVALIADO,
)
from ..domain.estorno import soma_to_key
from .conciliacao import (
    ConciliacaoConfig,
    KeyDef,
    conciliar_grupos,
    conciliar_multichave,
    distribuicao_status,
)

GROUP_DOC_ESTORNADOS = "Documentos estornados"
GROUP_NF_CANCELADA = "NF Cancelada"


@dataclass(frozen=True)
class EstornoConfig:
    col_a: str  # coluna de agrupamento A (ex.: documento)
    col_b: str  # coluna de agrupamento B (ex.: referência de estorno)
    col_soma: str  # coluna de valor
    limite_zero: float = 0.0


@dataclass(frozen=True)
class CancelamentoConfig:
    coluna: str
    valor_cancelado: str = "S"


@dataclass(frozen=True)
class PipelineConfig:
    conciliacao: ConciliacaoConfig
    estorno: EstornoConfig | None = None
    cancelamento: CancelamentoConfig | None = None


# ------------------------------------------------------------------ estorno

class _Entry:
    __slots__ = ("id", "soma", "paired")

    def __init__(self, id_: int, soma: float) -> None:
        self.id = id_
        self.soma = soma
        self.paired = False


def _to_number(value: object) -> float:
    """Number(x) || 0 (igual à v1)."""
    if value is None or value == "":
        return 0.0
    try:
        n = float(str(value).replace(",", "."))
    except ValueError:
        return 0.0
    return 0.0 if n != n else n


def _match_pairs(
    list_a: list[_Entry], list_b: list[_Entry], limite_zero: float
) -> list[tuple[int, int]]:
    """Port fiel de matchPairsOptimized (EstornoBaseAStep.ts:123-176)."""
    b_by_soma: dict[int, list[_Entry]] = {}
    for b in list_b:
        b_by_soma.setdefault(soma_to_key(b.soma), []).append(b)

    key_tol = math.ceil(limite_zero * SOMA_PRECISION) + 1
    pairs: list[tuple[int, int]] = []
    for a in list_a:
        if a.paired:
            continue
        target_key = soma_to_key(-a.soma)
        found = False
        k = target_key - key_tol
        while k <= target_key + key_tol and not found:
            for b in b_by_soma.get(k, []):
                if b.paired or a.id == b.id:
                    continue
                if abs(a.soma + b.soma) <= limite_zero:
                    a.paired = b.paired = True
                    pairs.append((a.id, b.id))
                    found = True
                    break
            k += 1
    return pairs


def estorno_marks(
    rows: Iterable[tuple[int, object, object, object]], cfg: EstornoConfig
) -> dict[int, tuple[str, str]]:
    """Marca linhas da Base A. rows = (row_id, val_col_a, val_col_b, val_col_soma).

    Retorna {row_id: (status, grupo)}. Pareados → Conciliado_Estorno (vencem);
    não-pareados em chaves com contraparte → Documentos estornados.
    Port fiel de EstornoBaseAStep.execute (:287-344).
    """
    map_a: dict[str, list[_Entry]] = {}
    map_b: dict[str, list[_Entry]] = {}
    for row_id, va, vb, vs in rows:
        key_a = "" if va is None else str(va)
        key_b = "" if vb is None else str(vb)
        soma = _to_number(vs)
        if key_a:  # v1: `if (keyA)` — string vazia é falsy → pulada
            map_a.setdefault(key_a, []).append(_Entry(row_id, soma))
        if key_b:
            map_b.setdefault(key_b, []).append(_Entry(row_id, soma))

    paired_ids: set[int] = set()
    unpaired_ids: set[int] = set()
    for key, list_a in map_a.items():
        list_b = map_b.get(key)
        if not list_b:
            continue
        for a_id, b_id in _match_pairs(list_a, list_b, cfg.limite_zero):
            paired_ids.add(a_id)
            paired_ids.add(b_id)
        for e in list_a:
            if not e.paired:
                unpaired_ids.add(e.id)
        for e in list_b:
            if not e.paired:
                unpaired_ids.add(e.id)

    marks: dict[int, tuple[str, str]] = {}
    for rid in unpaired_ids:
        marks[rid] = (STATUS_NAO_AVALIADO, GROUP_DOC_ESTORNADOS)
    for rid in paired_ids:  # pareamento vence
        marks[rid] = (STATUS_CONCILIADO, GROUP_ESTORNO)
    return marks


def _write_marks(
    con: duckdb.DuckDBPyConnection, table: str, marks: dict[int, tuple[str, str]]
) -> None:
    con.execute(f'DROP TABLE IF EXISTS "{table}"')
    con.execute(f'CREATE TABLE "{table}"(rid BIGINT, status VARCHAR, grupo VARCHAR)')
    if marks:
        con.executemany(
            f'INSERT INTO "{table}" VALUES (?,?,?)',
            [(rid, s, g) for rid, (s, g) in marks.items()],
        )


# -------------------------------------------------------------- cancelamento

def cancelamento_marks(
    con: duckdb.DuckDBPyConnection, cfg: CancelamentoConfig, *, table_b: str, out: str
) -> int:
    """Marca (em `out`) as linhas canceladas da Base B. Retorna a quantidade."""
    con.execute(f'DROP TABLE IF EXISTS "{out}"')
    con.execute(
        f'CREATE TABLE "{out}" AS '
        f"SELECT rowid AS rid, '{STATUS_NAO_AVALIADO}' AS status, "
        f"'{GROUP_NF_CANCELADA}' AS grupo "
        f'FROM "{table_b}" WHERE "{cfg.coluna}" = ?',
        [cfg.valor_cancelado],
    )
    return con.execute(f'SELECT count(*) FROM "{out}"').fetchone()[0]  # type: ignore[index]


def cancelamento_marks_dict(
    con: duckdb.DuckDBPyConnection, cfg: CancelamentoConfig, *, table_b: str
) -> dict[int, tuple[str, str]]:
    """Row ids das NFs canceladas → (04_Não Avaliado, NF Cancelada)."""
    rows = con.execute(
        f'SELECT rowid FROM "{table_b}" WHERE "{cfg.coluna}" = ?', [cfg.valor_cancelado]
    ).fetchall()
    return {r[0]: (STATUS_NAO_AVALIADO, GROUP_NF_CANCELADA) for r in rows}


# ---------------------------------------------------------------- orquestração

@dataclass(frozen=True)
class PipelineResult:
    estorno_pares: int
    estorno_docs: int
    canceladas: int
    grupos_conciliacao: int
    distribuicao: dict[str, int]


def run_pipeline(
    con: duckdb.DuckDBPyConnection,
    config: PipelineConfig,
    *,
    table_a: str = "base_a",
    table_b: str = "base_b",
    result: str = "conc_grupos",
) -> PipelineResult:
    """Executa Estorno(A) → Cancelamento(B) → Conciliação(A×B) sobre o que sobrou."""
    estorno_pares = estorno_docs = 0
    a_source = table_a
    if config.estorno is not None:
        e = config.estorno
        rows = con.execute(
            f'SELECT rowid, "{e.col_a}", "{e.col_b}", "{e.col_soma}" FROM "{table_a}"'
        ).fetchall()
        marks = estorno_marks(rows, e)
        estorno_pares = sum(1 for v in marks.values() if v[1] == GROUP_ESTORNO)
        estorno_docs = sum(1 for v in marks.values() if v[1] == GROUP_DOC_ESTORNADOS)
        _write_marks(con, "pl_estorno", marks)
        con.execute(
            f'CREATE OR REPLACE VIEW base_a_f AS SELECT * FROM "{table_a}" '
            f"WHERE rowid NOT IN (SELECT rid FROM pl_estorno)"
        )
        a_source = "base_a_f"

    canceladas = 0
    b_source = table_b
    if config.cancelamento is not None:
        canceladas = cancelamento_marks(con, config.cancelamento, table_b=table_b, out="pl_cancel")
        con.execute(
            f'CREATE OR REPLACE VIEW base_b_f AS SELECT * FROM "{table_b}" '
            f"WHERE rowid NOT IN (SELECT rid FROM pl_cancel)"
        )
        b_source = "base_b_f"

    grupos = conciliar_grupos(
        con, config.conciliacao, table_a=a_source, table_b=b_source, result=result
    )
    return PipelineResult(
        estorno_pares=estorno_pares,
        estorno_docs=estorno_docs,
        canceladas=canceladas,
        grupos_conciliacao=grupos,
        distribuicao=distribuicao_status(con, result),
    )


# ------------------------------------------------ orquestração completa (multi-chave, nível-linha)

@dataclass(frozen=True)
class ConciliacaoResult:
    linhas: int  # total de linhas no resultado
    estorno_pares: int
    estorno_docs: int
    canceladas: int
    distribuicao: dict[str, int]  # por status


def run_conciliacao(
    con: duckdb.DuckDBPyConnection,
    keys: Sequence[KeyDef],
    *,
    value_col_a: str,
    value_col_b: str,
    inverter: bool = False,
    limite: float = 0.0,
    estorno: EstornoConfig | None = None,
    cancelamento: CancelamentoConfig | None = None,
    table_a: str = "base_a",
    table_b: str = "base_b",
    result: str = "conciliacao_result",
) -> ConciliacaoResult:
    """Pipeline completo → resultado NÍVEL-LINHA com multi-chave priorizada.

    Estorno(A) e Cancelamento(B) entram como marcas pré-casadas; a conciliação
    multi-chave roda sobre o remanescente. É a saída que alimenta export/API.
    """
    marks_a: dict[int, tuple[str, str]] = {}
    estorno_pares = estorno_docs = 0
    if estorno is not None:
        rows = con.execute(
            f'SELECT rowid, "{estorno.col_a}", "{estorno.col_b}", "{estorno.col_soma}" '
            f'FROM "{table_a}"'
        ).fetchall()
        marks_a = estorno_marks(rows, estorno)
        estorno_pares = sum(1 for v in marks_a.values() if v[1] == GROUP_ESTORNO)
        estorno_docs = sum(1 for v in marks_a.values() if v[1] == GROUP_DOC_ESTORNADOS)

    marks_b: dict[int, tuple[str, str]] = {}
    if cancelamento is not None:
        marks_b = cancelamento_marks_dict(con, cancelamento, table_b=table_b)

    linhas = conciliar_multichave(
        con, keys, value_col_a=value_col_a, value_col_b=value_col_b,
        inverter=inverter, limite=limite, table_a=table_a, table_b=table_b,
        marks_a=marks_a, marks_b=marks_b, result=result,
    )
    return ConciliacaoResult(
        linhas=linhas,
        estorno_pares=estorno_pares,
        estorno_docs=estorno_docs,
        canceladas=len(marks_b),
        distribuicao=distribuicao_status(con, result),
    )
