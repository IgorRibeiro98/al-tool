"""Conciliação A×B — motor set-based em DuckDB.

Substitui o `ConciliacaoABStep.ts` (978 linhas, loop linha-a-linha em Node/worker pool)
por SQL agregado no DuckDB. A classificação em SQL é uma **tradução fiel** de
`domain.matching.classify_group` — a fidelidade é garantida por cross-check nos testes
(tests/test_conciliacao.py::test_sql_matches_python_classify).

Fluxo (para uma chave):
  1. compose_key nos dois lados (COALESCE(col,'') juntos por '_') — igual à v1
  2. SUM(valor) por chave em cada base (não-numérico → 0, igual a `Number()||0`)
  3. FULL OUTER JOIN por chave → grupos
  4. classifica cada grupo pela árvore exata da v1 (EPSILON, round(6), limite)
  5. expande de volta para nível-linha
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import duckdb

from ..domain.constants import (
    EPSILON,
    LABEL_BASE_A_MAIOR,
    LABEL_BASE_B_MAIOR,
    LABEL_CONCILIADO,
    LABEL_DIFF_IMATERIAL,
    LABEL_NOT_FOUND,
    STATUS_CONCILIADO,
    STATUS_FOUND_DIFF,
    STATUS_NOT_FOUND,
)


@dataclass(frozen=True)
class ConciliacaoConfig:
    key_cols_a: Sequence[str]
    key_cols_b: Sequence[str]
    value_col_a: str
    value_col_b: str
    inverter: bool = False  # inverte sinal da Base B (fiscal)
    limite: float = 0.0  # limite de diferença imaterial


def _key_expr(cols: Sequence[str]) -> str:
    """compose_key em SQL: COALESCE("c1",'') || '_' || COALESCE("c2",'') ..."""
    if not cols:
        raise ValueError("chave precisa de ao menos uma coluna")
    return " || '_' || ".join(f"COALESCE(\"{c}\", '')" for c in cols)


def _num(col: str) -> str:
    """Number(row[col])||0 em SQL: não-parseável e NULL → 0 (vírgula→ponto)."""
    return f"COALESCE(TRY_CAST(replace(trim(\"{col}\"), ',', '.') AS DOUBLE), 0)"


def _classify_sql(limite: float) -> tuple[str, str]:
    """Retorna (status_sql, grupo_sql) — tradução fiel de classify_group.

    Usa as colunas `has_a`, `has_b`, `diff` da CTE de grupos.
    `diff` já está normalizado (round 6) na CTE.
    """
    eps = repr(EPSILON)
    lim = repr(limite)
    lim_efetivo = f"greatest({lim}, {eps})"
    status = f"""
        CASE
          WHEN has_a AND has_b THEN
            CASE
              WHEN abs(diff) <= {eps} THEN '{STATUS_CONCILIADO}'
              ELSE '{STATUS_FOUND_DIFF}'
            END
          ELSE '{STATUS_NOT_FOUND}'
        END"""
    grupo = f"""
        CASE
          WHEN has_a AND has_b THEN
            CASE
              WHEN abs(diff) <= {eps} THEN '{LABEL_CONCILIADO}'
              WHEN {lim} > 0 AND abs(diff) <= {lim_efetivo} THEN '{LABEL_DIFF_IMATERIAL}'
              WHEN diff > 0 THEN '{LABEL_BASE_A_MAIOR}'
              ELSE '{LABEL_BASE_B_MAIOR}'
            END
          ELSE '{LABEL_NOT_FOUND}'
        END"""
    return status, grupo


def _grupos_cte(config: ConciliacaoConfig, table_a: str, table_b: str) -> str:
    """CTE `grp` com um grupo por chave, já com somas normalizadas e diff."""
    inv = "-1 *" if config.inverter else ""
    return f"""
    WITH a_agg AS (
      SELECT {_key_expr(config.key_cols_a)} AS chave,
             round(SUM({_num(config.value_col_a)}), 6) AS soma_a
      FROM "{table_a}" GROUP BY 1
    ),
    b_agg AS (
      SELECT {_key_expr(config.key_cols_b)} AS chave,
             round({inv} SUM({_num(config.value_col_b)}), 6) AS soma_b
      FROM "{table_b}" GROUP BY 1
    ),
    grp AS (
      SELECT COALESCE(a.chave, b.chave) AS chave,
             COALESCE(a.soma_a, 0) AS soma_a,
             COALESCE(b.soma_b, 0) AS soma_b,
             a.chave IS NOT NULL AS has_a,
             b.chave IS NOT NULL AS has_b,
             round(COALESCE(a.soma_a, 0) - COALESCE(b.soma_b, 0), 6) AS diff
      FROM a_agg a FULL OUTER JOIN b_agg b USING (chave)
    )"""


def conciliar_grupos(
    con: duckdb.DuckDBPyConnection,
    config: ConciliacaoConfig,
    *,
    table_a: str = "base_a",
    table_b: str = "base_b",
    result: str = "conc_grupos",
) -> int:
    """Materializa a classificação **por grupo** em `result`. Retorna nº de grupos.

    Colunas: chave, soma_a, soma_b, diff, has_a, has_b, status, grupo.
    """
    status_sql, grupo_sql = _classify_sql(config.limite)
    con.execute(f'DROP TABLE IF EXISTS "{result}"')
    con.execute(
        f'CREATE TABLE "{result}" AS '
        f"{_grupos_cte(config, table_a, table_b)}\n"
        f"SELECT chave, soma_a, soma_b, diff, has_a, has_b,\n"
        f"       {status_sql} AS status,\n"
        f"       {grupo_sql}  AS grupo\n"
        f"FROM grp"
    )
    return con.execute(f'SELECT count(*) FROM "{result}"').fetchone()[0]  # type: ignore[index]


def distribuicao_status(
    con: duckdb.DuckDBPyConnection, result: str = "conc_grupos"
) -> dict[str, int]:
    """Distribuição de grupos por status (para relatório/telemetria)."""
    rows = con.execute(
        f'SELECT status, count(*) FROM "{result}" GROUP BY 1 ORDER BY 2 DESC'
    ).fetchall()
    return {r[0]: r[1] for r in rows}


# =========================================================================
# Multi-chave priorizada + resultado nível-linha
# =========================================================================
#
# Semântica fiel a ConciliacaoABStep.ts:
#   - chaves em ordem de prioridade; para cada chave, INNER JOIN A×B (só casa quem
#     tem par nos dois lados na chave); linhas já casadas (marca ou chave anterior)
#     são puladas nas chaves seguintes;
#   - ao final, o que nunca casou vira 03_Não Encontrado.
# O resultado é NÍVEL-LINHA: uma entrada por linha de A e de B, com value_a/value_b
# = somas do grupo (igual à v1).


@dataclass(frozen=True)
class KeyDef:
    key_id: str  # identificador da chave (ex.: "CHAVE_1")
    cols_a: Sequence[str]  # colunas da chave na Base A
    cols_b: Sequence[str]  # colunas da chave na Base B


def _classify_both(limite: float, diff: str = "diff") -> tuple[str, str]:
    """status/grupo para grupos com A e B presentes (ramo has_a AND has_b)."""
    eps = repr(EPSILON)
    lim = repr(limite)
    lim_ef = f"greatest({lim}, {eps})"
    status = f"CASE WHEN abs({diff}) <= {eps} THEN '{STATUS_CONCILIADO}' ELSE '{STATUS_FOUND_DIFF}' END"
    grupo = (
        f"CASE WHEN abs({diff}) <= {eps} THEN '{LABEL_CONCILIADO}' "
        f"WHEN {lim} > 0 AND abs({diff}) <= {lim_ef} THEN '{LABEL_DIFF_IMATERIAL}' "
        f"WHEN {diff} > 0 THEN '{LABEL_BASE_A_MAIOR}' ELSE '{LABEL_BASE_B_MAIOR}' END"
    )
    return status, grupo


_RESULT_DDL = (
    "origem VARCHAR, row_id BIGINT, key_id VARCHAR, status VARCHAR, "
    "grupo VARCHAR, chave_valor VARCHAR, value_a DOUBLE, value_b DOUBLE, difference DOUBLE"
)


def conciliar_multichave(
    con: duckdb.DuckDBPyConnection,
    keys: Sequence[KeyDef],
    *,
    value_col_a: str,
    value_col_b: str,
    inverter: bool = False,
    limite: float = 0.0,
    table_a: str = "base_a",
    table_b: str = "base_b",
    marks_a: dict[int, tuple[str, str]] | None = None,
    marks_b: dict[int, tuple[str, str]] | None = None,
    result: str = "conciliacao_result",
) -> int:
    """Conciliação multi-chave priorizada, resultado nível-linha em `result`.

    marks_a/marks_b: {row_id: (status, grupo)} de estorno/cancelamento — pré-casados.
    Retorna o total de linhas no resultado.
    """
    inv = "-1 *" if inverter else ""
    status_sql, grupo_sql = _classify_both(limite)

    con.execute(f'DROP TABLE IF EXISTS "{result}"')
    con.execute(f'CREATE TABLE "{result}"({_RESULT_DDL})')
    con.execute("DROP TABLE IF EXISTS _matched_a")
    con.execute("DROP TABLE IF EXISTS _matched_b")
    con.execute("CREATE TABLE _matched_a(rid BIGINT)")
    con.execute("CREATE TABLE _matched_b(rid BIGINT)")

    # 1) Marcas (estorno/cancelamento): entram como pré-casadas com seu status.
    _emit_marks(con, result, table_a, value_col_a, marks_a, origem="A",
                inv="", is_b=False)
    _emit_marks(con, result, table_b, value_col_b, marks_b, origem="B",
                inv=inv, is_b=True)

    # 2) Chaves em ordem de prioridade.
    for kd in keys:
        _conciliar_uma_chave(
            con, kd, result=result, table_a=table_a, table_b=table_b,
            value_col_a=value_col_a, value_col_b=value_col_b, inv=inv,
            status_sql=status_sql, grupo_sql=grupo_sql,
        )

    # 3) Remanescentes → 03_Não Encontrado (nível-linha, value_b/value_a do próprio lado).
    con.execute(
        f'INSERT INTO "{result}" '
        f"SELECT 'A', rowid, NULL, '{STATUS_NOT_FOUND}', '{LABEL_NOT_FOUND}', NULL, "
        f"round({_num(value_col_a)}, 6), 0, round({_num(value_col_a)}, 6) "
        f'FROM "{table_a}" WHERE rowid NOT IN (SELECT rid FROM _matched_a)'
    )
    # value_b = (inverter? -1:1)*num ; difference = 0 - value_b (igual à v1).
    valb = f"({inv} {_num(value_col_b)})" if inv else f"({_num(value_col_b)})"
    con.execute(
        f'INSERT INTO "{result}" '
        f"SELECT 'B', rowid, NULL, '{STATUS_NOT_FOUND}', '{LABEL_NOT_FOUND}', NULL, "
        f"0, round({valb}, 6), round(-1 * {valb}, 6) "
        f'FROM "{table_b}" WHERE rowid NOT IN (SELECT rid FROM _matched_b)'
    )

    # 4) Fidelidade de shape (v1): colunas CHAVE_n + a_values/b_values (JSON da linha).
    _enriquecer_resultado(con, keys, result, value_col_a, value_col_b, table_a, table_b)
    return con.execute(f'SELECT count(*) FROM "{result}"').fetchone()[0]  # type: ignore[index]


def _enriquecer_resultado(
    con: duckdb.DuckDBPyConnection, keys: Sequence[KeyDef], result: str,
    value_col_a: str, value_col_b: str, table_a: str, table_b: str,
) -> None:
    """Adiciona ao resultado as colunas CHAVE_n (composta por chave) e a_values/b_values
    (JSON compacto da linha original) — o shape que a UI da v1 exibe."""
    q = f'"{result}"'
    for kd in keys:
        col = kd.key_id.replace('"', '""')
        con.execute(f'ALTER TABLE {q} ADD COLUMN IF NOT EXISTS "{col}" VARCHAR')
        con.execute(
            f'UPDATE {q} SET "{col}" = (SELECT {_key_expr(kd.cols_a)} FROM "{table_a}" '
            f"WHERE rowid = {q}.row_id) WHERE origem = 'A'"
        )
        con.execute(
            f'UPDATE {q} SET "{col}" = (SELECT {_key_expr(kd.cols_b)} FROM "{table_b}" '
            f"WHERE rowid = {q}.row_id) WHERE origem = 'B'"
        )
    cols_a = list(dict.fromkeys([c for kd in keys for c in kd.cols_a] + [value_col_a]))
    cols_b = list(dict.fromkeys([c for kd in keys for c in kd.cols_b] + [value_col_b]))
    a_json = "struct_pack(" + ", ".join(f'"{c}" := "{c}"' for c in cols_a) + ")"
    b_json = "struct_pack(" + ", ".join(f'"{c}" := "{c}"' for c in cols_b) + ")"
    con.execute(f'ALTER TABLE {q} ADD COLUMN IF NOT EXISTS a_values VARCHAR')
    con.execute(f'ALTER TABLE {q} ADD COLUMN IF NOT EXISTS b_values VARCHAR')
    con.execute(
        f'UPDATE {q} SET a_values = (SELECT to_json({a_json}) FROM "{table_a}" '
        f"WHERE rowid = {q}.row_id) WHERE origem = 'A'"
    )
    con.execute(
        f'UPDATE {q} SET b_values = (SELECT to_json({b_json}) FROM "{table_b}" '
        f"WHERE rowid = {q}.row_id) WHERE origem = 'B'"
    )


def _emit_marks(
    con: duckdb.DuckDBPyConnection, result: str, table: str, value_col: str,
    marks: dict[int, tuple[str, str]] | None, *, origem: str, inv: str, is_b: bool,
) -> None:
    if not marks:
        return
    matched = "_matched_b" if is_b else "_matched_a"
    con.execute("DROP TABLE IF EXISTS _mk")
    con.execute("CREATE TABLE _mk(rid BIGINT, status VARCHAR, grupo VARCHAR)")
    con.executemany(
        "INSERT INTO _mk VALUES (?,?,?)",
        [(rid, s, g) for rid, (s, g) in marks.items()],
    )
    val = f"round({inv} {_num(value_col)}, 6)" if inv else f"round({_num(value_col)}, 6)"
    va, vb = ("0", val) if is_b else (val, "0")
    con.execute(
        f'INSERT INTO "{result}" '
        f"SELECT '{origem}', t.rowid, NULL, mk.status, mk.grupo, NULL, {va}, {vb}, 0 "
        f'FROM "{table}" t JOIN _mk mk ON t.rowid = mk.rid'
    )
    con.execute(f"INSERT INTO {matched} SELECT rid FROM _mk")


def _conciliar_uma_chave(
    con: duckdb.DuckDBPyConnection, kd: KeyDef, *, result: str, table_a: str,
    table_b: str, value_col_a: str, value_col_b: str, inv: str,
    status_sql: str, grupo_sql: str,
) -> None:
    """Uma passada de chave: INNER JOIN sobre remanescentes, emite nível-linha, marca."""
    ka, kb = _key_expr(kd.cols_a), _key_expr(kd.cols_b)
    # Grupos casados nesta chave (presentes em A e B remanescentes).
    con.execute("DROP TABLE IF EXISTS _mg")
    con.execute(
        f'CREATE TABLE _mg AS '
        f"WITH ra AS (SELECT rowid rid, {ka} chave, {_num(value_col_a)} val "
        f'  FROM "{table_a}" WHERE rowid NOT IN (SELECT rid FROM _matched_a)), '
        f"rb AS (SELECT rowid rid, {kb} chave, {_num(value_col_b)} val "
        f'  FROM "{table_b}" WHERE rowid NOT IN (SELECT rid FROM _matched_b)), '
        f"aa AS (SELECT chave, round(sum(val),6) somaA FROM ra GROUP BY chave), "
        f"bb AS (SELECT chave, round({inv} sum(val),6) somaB FROM rb GROUP BY chave) "
        f"SELECT aa.chave, aa.somaA, bb.somaB, round(aa.somaA-bb.somaB,6) diff "
        f"FROM aa JOIN bb USING(chave)"
    )
    kid = kd.key_id.replace("'", "''")
    # Emite linhas de A nos grupos casados + marca.
    con.execute(
        f'INSERT INTO "{result}" '
        f"SELECT 'A', ra.rid, '{kid}', {status_sql}, {grupo_sql}, mg.chave, "
        f"mg.somaA, mg.somaB, mg.diff "
        f'FROM (SELECT rowid rid, {ka} chave FROM "{table_a}" '
        f"       WHERE rowid NOT IN (SELECT rid FROM _matched_a)) ra "
        f"JOIN _mg mg ON ra.chave = mg.chave"
    )
    con.execute(
        f"INSERT INTO _matched_a SELECT ra.rid FROM "
        f'(SELECT rowid rid, {ka} chave FROM "{table_a}" '
        f" WHERE rowid NOT IN (SELECT rid FROM _matched_a)) ra JOIN _mg mg ON ra.chave = mg.chave"
    )
    # Emite linhas de B nos grupos casados + marca.
    con.execute(
        f'INSERT INTO "{result}" '
        f"SELECT 'B', rb.rid, '{kid}', {status_sql}, {grupo_sql}, mg.chave, "
        f"mg.somaA, mg.somaB, mg.diff "
        f'FROM (SELECT rowid rid, {kb} chave FROM "{table_b}" '
        f"       WHERE rowid NOT IN (SELECT rid FROM _matched_b)) rb "
        f"JOIN _mg mg ON rb.chave = mg.chave"
    )
    con.execute(
        f"INSERT INTO _matched_b SELECT rb.rid FROM "
        f'(SELECT rowid rid, {kb} chave FROM "{table_b}" '
        f" WHERE rowid NOT IN (SELECT rid FROM _matched_b)) rb JOIN _mg mg ON rb.chave = mg.chave"
    )
