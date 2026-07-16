"""Atribuição — cópia de colunas de uma base origem para uma destino, por chave.

Substitui `atribuicaoRunner.ts` (558 l) por SQL set-based no DuckDB.

Semântica fiel:
- chaves em ordem de prioridade; cada linha do destino é atribuída por, no máximo, UMA
  chave (a de maior prioridade que casa) — INNER JOIN exato coluna-a-coluna, MIN(orig) vence;
- modos de escrita OVERWRITE (sempre) / ONLY_EMPTY (só se a célula do destino é vazia);
- valor importado = normalizeImportValue (vazio → 'NULL', senão trim).
As regras de vazio/normalização são as funções puras de `domain.atribuicao`, traduzidas
para SQL e cross-checadas nos testes.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import duckdb

MODE_OVERWRITE = "OVERWRITE"
MODE_ONLY_EMPTY = "ONLY_EMPTY"


@dataclass(frozen=True)
class AtribKey:
    key_id: str
    origem_cols: Sequence[str]
    destino_cols: Sequence[str]


@dataclass(frozen=True)
class AtribuicaoConfig:
    keys: Sequence[AtribKey]
    selected_columns: Sequence[str]  # colunas a copiar da origem
    mode: str = MODE_OVERWRITE


@dataclass(frozen=True)
class AtribuicaoResult:
    linhas: int  # linhas do destino atribuídas
    por_chave: dict[str, int]


def _is_empty_sql(expr: str) -> str:
    """isEmptyValue em SQL: NULL | trim='' | lower(trim)='null' | trim='0' | trim='0.00'."""
    return (
        f"({expr} IS NULL OR trim({expr}) = '' OR lower(trim({expr})) = 'null' "
        f"OR trim({expr}) = '0' OR trim({expr}) = '0.00')"
    )


def _import_value_sql(expr: str) -> str:
    """normalizeImportValue em SQL: vazio → 'NULL'; senão trim(expr)."""
    return f"CASE WHEN {_is_empty_sql(expr)} THEN 'NULL' ELSE trim({expr}) END"


def _columns(con: duckdb.DuckDBPyConnection, table: str) -> set[str]:
    return {d[0] for d in con.execute(f'SELECT * FROM "{table}" LIMIT 0').description}


def atribuir(
    con: duckdb.DuckDBPyConnection,
    config: AtribuicaoConfig,
    *,
    table_origem: str = "base_origem",
    table_destino: str = "base_destino",
    result: str = "atribuicao_result",
) -> AtribuicaoResult:
    """Executa a atribuição e materializa `result`. Retorna contagens.

    `result` tem: dest_row_id, orig_row_id, matched_key, + uma coluna por selected_column
    (com o valor resultante após o modo de escrita).
    """
    if config.mode not in (MODE_OVERWRITE, MODE_ONLY_EMPTY):
        raise ValueError(f"modo inválido: {config.mode}")

    cols_o = _columns(con, table_origem)
    cols_d = _columns(con, table_destino)
    sel = list(config.selected_columns)

    # Result table: metadados + colunas selecionadas.
    sel_ddl = ", ".join(f'"{c}" VARCHAR' for c in sel)
    con.execute(f'DROP TABLE IF EXISTS "{result}"')
    con.execute(
        f'CREATE TABLE "{result}"('
        f"dest_row_id BIGINT, orig_row_id BIGINT, matched_key VARCHAR"
        f"{', ' + sel_ddl if sel_ddl else ''})"
    )
    con.execute("DROP TABLE IF EXISTS _atrib_matched")
    con.execute("CREATE TABLE _atrib_matched(rid BIGINT)")

    por_chave: dict[str, int] = {}
    for kd in config.keys:
        if not kd.origem_cols or not kd.destino_cols:
            continue
        n = _atribuir_uma_chave(
            con, kd, config, cols_o, cols_d, sel,
            table_origem=table_origem, table_destino=table_destino, result=result,
        )
        por_chave[kd.key_id] = n

    # Fidelidade de shape (v1): colunas CHAVE_n = chave composta do destino por chave.
    for kd in config.keys:
        col = kd.key_id.replace('"', '""')
        compose = " || '_' || ".join(f'COALESCE("{c}", \'\')' for c in kd.destino_cols)
        con.execute(f'ALTER TABLE "{result}" ADD COLUMN IF NOT EXISTS "{col}" VARCHAR')
        con.execute(
            f'UPDATE "{result}" SET "{col}" = (SELECT {compose} FROM "{table_destino}" '
            f'WHERE rowid = "{result}".dest_row_id)'
        )

    total = con.execute(f'SELECT count(*) FROM "{result}"').fetchone()[0]
    return AtribuicaoResult(linhas=total, por_chave=por_chave)  # type: ignore[arg-type]


def _atribuir_uma_chave(
    con: duckdb.DuckDBPyConnection, kd: AtribKey, config: AtribuicaoConfig,
    cols_o: set[str], cols_d: set[str], sel: list[str], *,
    table_origem: str, table_destino: str, result: str,
) -> int:
    # Condição de junção: coluna-a-coluna exata (raw), como na v1.
    n = min(len(kd.origem_cols), len(kd.destino_cols))
    conds = " AND ".join(
        f'd."{kd.destino_cols[i]}" = o."{kd.origem_cols[i]}"' for i in range(n)
    )
    # Pares casados (destino ainda não atribuído), MIN(orig) vence.
    con.execute("DROP TABLE IF EXISTS _atrib_mg")
    con.execute(
        f"CREATE TABLE _atrib_mg AS "
        f"SELECT d.rowid AS dest_rid, MIN(o.rowid) AS orig_rid "
        f'FROM "{table_destino}" d JOIN "{table_origem}" o ON {conds} '
        f"WHERE d.rowid NOT IN (SELECT rid FROM _atrib_matched) "
        f"GROUP BY d.rowid"
    )

    # Valor resultante por coluna selecionada, conforme modo de escrita.
    val_exprs: list[str] = []
    for c in sel:
        o_expr = f'o."{c}"' if c in cols_o else "NULL"
        imported = _import_value_sql(o_expr)
        if config.mode == MODE_ONLY_EMPTY and c in cols_d:
            d_expr = f'd."{c}"'
            val_exprs.append(
                f"CASE WHEN {_is_empty_sql(d_expr)} THEN {imported} ELSE {d_expr} END"
            )
        else:
            # OVERWRITE, ou coluna nova no destino (destValue vazio → sempre importa).
            val_exprs.append(imported)

    kid = kd.key_id.replace("'", "''")
    select_vals = (", " + ", ".join(val_exprs)) if val_exprs else ""
    con.execute(
        f'INSERT INTO "{result}" '
        f"SELECT mg.dest_rid, mg.orig_rid, '{kid}'{select_vals} "
        f'FROM _atrib_mg mg '
        f'JOIN "{table_destino}" d ON d.rowid = mg.dest_rid '
        f'JOIN "{table_origem}" o ON o.rowid = mg.orig_rid'
    )
    con.execute("INSERT INTO _atrib_matched SELECT dest_rid FROM _atrib_mg")
    return con.execute("SELECT count(*) FROM _atrib_mg").fetchone()[0]  # type: ignore[return-value]
