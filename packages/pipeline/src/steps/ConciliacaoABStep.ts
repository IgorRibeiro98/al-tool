import { PipelineStep, PipelineContext } from '../index';
import { Knex } from 'knex';

/**
 * PipelineStep that performs reconciliation between BASE A and BASE B.
 *
 * Creates a result table `conciliacao_result_{jobId}` with columns:
 * - id INTEGER PRIMARY KEY
 * - job_id INTEGER
 * - chave TEXT               -> identificador da chave usada (ex: "CHAVE_1")
 * - status TEXT
 * - grupo TEXT
 * - a_row_id INTEGER         -> id da linha na BASE A (ou null)
 * - b_row_id INTEGER         -> id da linha na BASE B (ou null)
 * - a_values TEXT (JSON)     -> linha completa da BASE A
 * - b_values TEXT (JSON)     -> linha completa da BASE B
 * - value_a REAL             -> valor de conciliação do GRUPO (soma de A)
 * - value_b REAL             -> valor de conciliação do GRUPO (soma de B, já invertido se aplicável)
 * - difference REAL          -> value_a - value_b (diferença do GRUPO)
 * - created_at TIMESTAMP
 *
 * Conciliação por GRUPO DE CHAVE:
 * - Agrupa linhas de A e B pela mesma chave composta (para cada keyIdentifier, ex: "CHAVE_1").
 * - Soma os valores de conciliação de A e de B.
 * - Classifica o cenário com base nas somas (Conciliado, Diferença, A maior, B maior).
 * - Aplica o mesmo status/grupo/chave/difference para TODAS as linhas do grupo
 *   (cada linha de A e cada linha de B recebe esse resultado).
 *
 * Linhas marcadas em `conciliacao_marks` (estorno, NF cancelada, etc.) são tratadas antes
 * e não participam da conciliação A x B.
 */
export class ConciliacaoABStep implements PipelineStep {
    name = 'ConciliacaoAB';

    constructor(private db: Knex) {}

    private wrapIdentifier(value: string) {
        return `"${value.replace(/"/g, '""')}"`;
    }

    private buildCompositeExpr(alias: string, cols?: string[]) {
        if (!cols || cols.length === 0) return 'NULL';
        const nullCheck = cols
            .map(col => `${alias}.${this.wrapIdentifier(col)} IS NULL`)
            .join(' OR ');
        const parts = cols.map(col => `COALESCE(${alias}.${this.wrapIdentifier(col)}, '')`).join(` || '_' || `);
        return `CASE WHEN ${nullCheck} THEN NULL ELSE ${parts} END`;
    }

    private buildJsonObjectExpr(alias: string, cols: string[]) {
        if (!cols || cols.length === 0) return 'NULL';
        const pieces: string[] = [];
        for (const col of cols) {
            const key = col.replace(/'/g, "''");
            pieces.push(`'${key}'`);
            pieces.push(`${alias}.${this.wrapIdentifier(col)}`);
        }
        return `json_object(${pieces.join(', ')})`;
    }

    private buildIndexName(table: string, col: string) {
        const safeTable = table.replace(/[^a-zA-Z0-9_]/g, '_');
        const safeCol = col.replace(/[^a-zA-Z0-9_]/g, '_');
        return `idx_${safeTable}_${safeCol}`;
    }

    private async ensureIndexes(resultTable: string, keyIdentifiers: string[]) {
        const baseIndexedCols = ['job_id', 'chave', 'status', 'grupo', 'a_row_id', 'b_row_id'];
        const colsToIndex = [...baseIndexedCols, ...keyIdentifiers];

        for (const col of colsToIndex) {
            const idxName = this.buildIndexName(resultTable, col);
            const sql = `CREATE INDEX IF NOT EXISTS ${this.wrapIdentifier(idxName)} ON ${this.wrapIdentifier(resultTable)} (${this.wrapIdentifier(col)})`;
            await this.db.raw(sql);
        }
    }

    private async ensureResultTable(jobId: number) {
        const tableName = `conciliacao_result_${jobId}`;
        const exists = await this.db.schema.hasTable(tableName);
        if (!exists) {
            await this.db.schema.createTable(tableName, table => {
                table.increments('id').primary();
                table.integer('job_id').notNullable();
                table.string('chave').nullable();
                table.string('status').nullable();
                table.string('grupo').nullable();
                table.integer('a_row_id').nullable();
                table.integer('b_row_id').nullable();
                table.text('a_values').nullable();
                table.text('b_values').nullable();
                table.float('value_a').nullable();
                table.float('value_b').nullable();
                table.float('difference').nullable();
                table.timestamp('created_at').defaultTo(this.db.fn.now()).notNullable();
            });
        }
        return tableName;
    }

    private async ensureKeyColumns(resultTable: string, keyIdentifiers: string[]) {
        const exists = await this.db.schema.hasTable(resultTable);
        if (!exists) return;

        for (const k of keyIdentifiers) {
            const has = await this.db.schema.hasColumn(resultTable, k);
            if (!has) {
                await this.db.schema.alterTable(resultTable, t => {
                    t.text(k).nullable();
                });
            }
        }
    }

    async execute(ctx: PipelineContext): Promise<void> {
        const cfgId = ctx.configConciliacaoId;
        if (!cfgId) return;

        const cfg = ctx.getConfigConciliacao ? await ctx.getConfigConciliacao(cfgId) : await this.db('configs_conciliacao').where({ id: cfgId }).first();
        if (!cfg) return;

        const baseAId = ctx.baseContabilId ?? cfg.base_contabil_id;
        const baseBId = ctx.baseFiscalId ?? cfg.base_fiscal_id;
        if (!baseAId || !baseBId) return;

        const baseA = ctx.getBaseMeta ? await ctx.getBaseMeta(baseAId) : await this.db('bases').where({ id: baseAId }).first();
        const baseB = ctx.getBaseMeta ? await ctx.getBaseMeta(baseBId) : await this.db('bases').where({ id: baseBId }).first();
        if (!baseA || !baseA.tabela_sqlite || !baseB || !baseB.tabela_sqlite) return;

        const tableA = baseA.tabela_sqlite;
        const tableB = baseB.tabela_sqlite;

        const parseChaves = (raw: any) => {
            try {
                const p = raw ? JSON.parse(raw) : {};
                if (Array.isArray(p)) return { CHAVE_1: p } as Record<string, string[]>;
                if (p && typeof p === 'object') return p as Record<string, string[]>;
                return {} as Record<string, string[]>;
            } catch {
                return {} as Record<string, string[]>;
            }
        };

        const chavesContabil = parseChaves(cfg.chaves_contabil);
        const chavesFiscal = parseChaves(cfg.chaves_fiscal);

        const keyIdentifiers = Array.from(
            new Set([
                ...Object.keys(chavesContabil || {}),
                ...Object.keys(chavesFiscal || {})
            ])
        );

        const colA = cfg.coluna_conciliacao_contabil;
        const colB = cfg.coluna_conciliacao_fiscal;
        const inverter = !!cfg.inverter_sinal_fiscal;
        const limite = Number(cfg.limite_diferenca_imaterial || 0);
        const epsilon = 1e-6;
        const effectiveLimit = Math.max(limite, epsilon);
        const hasLimit = limite > 0;

        const jobId = ctx.jobId;
        const resultTable = await this.ensureResultTable(jobId);
        await this.ensureKeyColumns(resultTable, keyIdentifiers);
        await this.ensureIndexes(resultTable, keyIdentifiers);

        const resultTableIdent = this.wrapIdentifier(resultTable);
        const tableAIdent = this.wrapIdentifier(tableA);
        const tableBIdent = this.wrapIdentifier(tableB);
        const keyColumnsClause = keyIdentifiers.length
            ? `, ${keyIdentifiers.map(k => this.wrapIdentifier(k)).join(', ')}`
            : '';
        const marksKeyValuesClause = keyIdentifiers.length
            ? `, ${keyIdentifiers.map(() => 'm.grupo').join(', ')}`
            : '';
        const defaultKey = keyIdentifiers.length ? keyIdentifiers[0] : null;

        await this.db.transaction(async trx => {
            const aColumns = Object.keys(await trx(tableA).columnInfo());
            const bColumns = Object.keys(await trx(tableB).columnInfo());
            const aJsonExpr = this.buildJsonObjectExpr('a', aColumns);
            const bJsonExpr = this.buildJsonObjectExpr('b', bColumns);

            const valueAExpr = colA
                ? `CAST(COALESCE(a.${this.wrapIdentifier(colA)}, 0) AS REAL)`
                : '0';
            const valueBExpr = colB
                ? `${inverter ? '-' : ''}CAST(COALESCE(b.${this.wrapIdentifier(colB)}, 0) AS REAL)`
                : '0';

            await trx.raw('CREATE TEMP TABLE IF NOT EXISTS temp_matched_a (id INTEGER PRIMARY KEY)');
            await trx.raw('CREATE TEMP TABLE IF NOT EXISTS temp_matched_b (id INTEGER PRIMARY KEY)');
            await trx.raw('DELETE FROM temp_matched_a');
            await trx.raw('DELETE FROM temp_matched_b');

            const insertMarksA = `
                INSERT INTO ${resultTableIdent}
                (job_id, chave, status, grupo, a_row_id, b_row_id, a_values, b_values, value_a, value_b, difference, created_at${keyColumnsClause})
                SELECT ?, m.grupo, m.status, m.grupo, a.id, NULL, ${aJsonExpr}, NULL,
                       ${valueAExpr}, 0, ${valueAExpr}, CURRENT_TIMESTAMP${
                           marksKeyValuesClause ? marksKeyValuesClause : ''
                       }
                FROM ${tableAIdent} a
                JOIN conciliacao_marks m ON m.row_id = a.id AND m.base_id = ?
            `;

            const insertMarksB = `
                INSERT INTO ${resultTableIdent}
                (job_id, chave, status, grupo, a_row_id, b_row_id, a_values, b_values, value_a, value_b, difference, created_at${keyColumnsClause})
                SELECT ?, m.grupo, m.status, m.grupo, NULL, b.id, NULL, ${bJsonExpr},
                       0, ${valueBExpr}, -${valueBExpr}, CURRENT_TIMESTAMP${
                           marksKeyValuesClause ? marksKeyValuesClause : ''
                       }
                FROM ${tableBIdent} b
                JOIN conciliacao_marks m ON m.row_id = b.id AND m.base_id = ?
            `;

            await trx.raw(insertMarksA, [jobId, baseAId]);
            await trx.raw(insertMarksB, [jobId, baseBId]);

            const refreshMatched = async () => {
                await trx.raw(
                    `INSERT OR IGNORE INTO temp_matched_a (id) SELECT DISTINCT a_row_id FROM ${resultTableIdent} WHERE job_id = ? AND a_row_id IS NOT NULL`,
                    [jobId]
                );
                await trx.raw(
                    `INSERT OR IGNORE INTO temp_matched_b (id) SELECT DISTINCT b_row_id FROM ${resultTableIdent} WHERE job_id = ? AND b_row_id IS NOT NULL`,
                    [jobId]
                );
            };

            await refreshMatched();

            for (const keyId of keyIdentifiers) {
                const aKeyCols = chavesContabil[keyId] || [];
                const bKeyCols = chavesFiscal[keyId] || [];
                if (!aKeyCols.length || !bKeyCols.length) continue;

                const compositeA = this.buildCompositeExpr('a', aKeyCols);
                const compositeB = this.buildCompositeExpr('b', bKeyCols);
                if (compositeA === 'NULL' || compositeB === 'NULL') continue;

                const keyValuesA = keyIdentifiers
                    .map(k => `COALESCE(${this.buildCompositeExpr('a', chavesContabil[k])}, '')`)
                    .join(', ');
                const keyValuesB = keyIdentifiers
                    .map(k => `COALESCE(${this.buildCompositeExpr('b', chavesFiscal[k])}, '')`)
                    .join(', ');

                const matchSql = `
                    WITH eligible_a AS (
                        SELECT a.id AS a_id,
                               ${compositeA} AS composite_key,
                               ${valueAExpr} AS value_a,
                               ${aJsonExpr} AS a_json
                        FROM ${tableAIdent} a
                        WHERE NOT EXISTS (SELECT 1 FROM temp_matched_a ma WHERE ma.id = a.id)
                    ),
                    eligible_b AS (
                        SELECT b.id AS b_id,
                               ${compositeB} AS composite_key,
                               ${valueBExpr} AS value_b,
                               ${bJsonExpr} AS b_json
                        FROM ${tableBIdent} b
                        WHERE NOT EXISTS (SELECT 1 FROM temp_matched_b mb WHERE mb.id = b.id)
                    ),
                    match_keys AS (
                        SELECT DISTINCT ea.composite_key AS composite_key
                        FROM eligible_a ea
                        JOIN eligible_b eb ON ea.composite_key IS NOT NULL AND eb.composite_key IS NOT NULL AND ea.composite_key = eb.composite_key
                    ),
                    group_a AS (
                        SELECT ea.a_id, mk.composite_key, ea.value_a, ea.a_json
                        FROM eligible_a ea
                        JOIN match_keys mk ON mk.composite_key = ea.composite_key
                    ),
                    group_b AS (
                        SELECT eb.b_id, mk.composite_key, eb.value_b, eb.b_json
                        FROM eligible_b eb
                        JOIN match_keys mk ON mk.composite_key = eb.composite_key
                    ),
                    summary AS (
                        SELECT
                            ? AS chave_label,
                            mk.composite_key,
                            COALESCE(SUM(ga.value_a), 0) AS somaA,
                            COALESCE(SUM(gb.value_b), 0) AS somaB,
                            COALESCE(SUM(ga.value_a), 0) - COALESCE(SUM(gb.value_b), 0) AS diff
                        FROM match_keys mk
                        LEFT JOIN group_a ga ON ga.composite_key = mk.composite_key
                        LEFT JOIN group_b gb ON gb.composite_key = mk.composite_key
                        GROUP BY mk.composite_key
                    ),
                    classified AS (
                        SELECT
                            chave_label,
                            composite_key,
                            somaA,
                            somaB,
                            diff,
                            CASE
                                WHEN ABS(diff) <= ? THEN '01_Conciliado'
                                WHEN ? = 1 AND ABS(diff) <= ? THEN '02_Encontrado c/Diferença'
                                WHEN diff > 0 THEN '02_Encontrado c/Diferença'
                                ELSE '02_Encontrado c/Diferença'
                            END AS status,
                            CASE
                                WHEN ABS(diff) <= ? THEN 'Conciliado'
                                WHEN ? = 1 AND ABS(diff) <= ? THEN 'Diferença Imaterial'
                                WHEN diff > 0 THEN 'Encontrado com diferença, BASE A MAIOR'
                                ELSE 'Encontrado com diferença, BASE B MAIOR'
                            END AS grupo
                        FROM summary
                    )
                    INSERT INTO ${resultTableIdent}
                    (job_id, chave, status, grupo, a_row_id, b_row_id, a_values, b_values, value_a, value_b, difference, created_at${keyColumnsClause})
                    SELECT ?, c.chave_label, c.status, c.grupo,
                           ga.a_id, NULL, ga.a_json, NULL,
                           c.somaA, c.somaB, c.diff, CURRENT_TIMESTAMP${
                               keyValuesA ? `, ${keyValuesA}` : ''
                           }
                    FROM group_a ga
                    JOIN classified c ON c.composite_key = ga.composite_key
                    UNION ALL
                    SELECT ?, c.chave_label, c.status, c.grupo,
                           NULL, gb.b_id, NULL, gb.b_json,
                           c.somaA, c.somaB, c.diff, CURRENT_TIMESTAMP${
                               keyValuesB ? `, ${keyValuesB}` : ''
                           }
                    FROM group_b gb
                    JOIN classified c ON c.composite_key = gb.composite_key
                `;

                await trx.raw(matchSql, [keyId, epsilon, hasLimit ? 1 : 0, effectiveLimit, epsilon, hasLimit ? 1 : 0, effectiveLimit, jobId, jobId]);
                await refreshMatched();
            }

            await refreshMatched();

            const keyValuesAForUnmatched = keyIdentifiers
                .map(k => `COALESCE(${this.buildCompositeExpr('a', chavesContabil[k])}, '')`)
                .join(', ');
            const keyValuesBForUnmatched = keyIdentifiers
                .map(k => `COALESCE(${this.buildCompositeExpr('b', chavesFiscal[k])}, '')`)
                .join(', ');

            const unmatchedASql = `
                INSERT INTO ${resultTableIdent}
                (job_id, chave, status, grupo, a_row_id, b_row_id, a_values, b_values, value_a, value_b, difference, created_at${keyColumnsClause})
                SELECT ?, ${defaultKey ? '?' : 'NULL'}, '03_Não Encontrado', 'Não encontrado', a.id, NULL, ${aJsonExpr}, NULL,
                       ${valueAExpr}, 0, ${valueAExpr}, CURRENT_TIMESTAMP${
                           keyValuesAForUnmatched ? `, ${keyValuesAForUnmatched}` : ''
                       }
                FROM ${tableAIdent} a
                WHERE NOT EXISTS (SELECT 1 FROM temp_matched_a ma WHERE ma.id = a.id)
            `;

            const unmatchedBSql = `
                INSERT INTO ${resultTableIdent}
                (job_id, chave, status, grupo, a_row_id, b_row_id, a_values, b_values, value_a, value_b, difference, created_at${keyColumnsClause})
                SELECT ?, ${defaultKey ? '?' : 'NULL'}, '03_Não Encontrado', 'Não encontrado', NULL, b.id, NULL, ${bJsonExpr},
                       0, ${valueBExpr}, -${valueBExpr}, CURRENT_TIMESTAMP${
                           keyValuesBForUnmatched ? `, ${keyValuesBForUnmatched}` : ''
                       }
                FROM ${tableBIdent} b
                WHERE NOT EXISTS (SELECT 1 FROM temp_matched_b mb WHERE mb.id = b.id)
            `;

            const unmatchedABindings = defaultKey ? [jobId, defaultKey] : [jobId];
            const unmatchedBBindings = defaultKey ? [jobId, defaultKey] : [jobId];

            await trx.raw(unmatchedASql, unmatchedABindings);
            await trx.raw(unmatchedBSql, unmatchedBBindings);
        });
    }
}

export default ConciliacaoABStep;
