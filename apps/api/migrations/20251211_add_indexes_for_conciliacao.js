/**
 * Add indexes to speed up conciliation queries.
 *
 * - Create indexes on columns referenced as "coluna_conciliacao_*" across base tables
 * - Create indexes on configs and keys linking tables
 * - Create composite index on conciliacao_marks(base_id, row_id)
 */
exports.up = async function up(knex) {
    // gather conciliation columns from configs
    const configsExist = await knex.schema.hasTable('configs_conciliacao');
    const basesExist = await knex.schema.hasTable('bases');

    const concCols = new Set();
    if (configsExist) {
        const rows = await knex('configs_conciliacao').select('coluna_conciliacao_contabil', 'coluna_conciliacao_fiscal');
        for (const r of rows) {
            if (r && r.coluna_conciliacao_contabil) concCols.add(String(r.coluna_conciliacao_contabil).trim());
            if (r && r.coluna_conciliacao_fiscal) concCols.add(String(r.coluna_conciliacao_fiscal).trim());
        }
    }

    // For each base table, try to create indexes for these columns if they exist
    if (basesExist && concCols.size > 0) {
        const bases = await knex('bases').select('tabela_sqlite');
        for (const b of bases) {
            const tableName = b && b.tabela_sqlite ? String(b.tabela_sqlite) : null;
            if (!tableName) continue;
            for (const col of Array.from(concCols)) {
                // sanitize index name
                const idxName = `idx_${tableName}_${col}`.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
                try {
                    // only create if column exists
                    // knex.schema.hasColumn works across adapters
                    // eslint-disable-next-line no-await-in-loop
                    const hasCol = await knex.schema.hasColumn(tableName, col);
                    if (hasCol) {
                        // sqlite supports IF NOT EXISTS
                        // eslint-disable-next-line no-await-in-loop
                        await knex.raw(`CREATE INDEX IF NOT EXISTS "${idxName}" ON "${tableName}"("${col}")`);
                    }
                } catch (err) {
                    // best-effort: ignore and continue
                    // eslint-disable-next-line no-console
                    console.warn(`Could not create index ${idxName} on ${tableName}(${col}):`, err && err.message ? err.message : err);
                }
            }
        }
    }

    // create useful indexes on metadata tables
    try {
        if (configsExist) {
            await knex.raw('CREATE INDEX IF NOT EXISTS "idx_configs_conciliacao_base_contabil_id" ON "configs_conciliacao"("base_contabil_id")');
            await knex.raw('CREATE INDEX IF NOT EXISTS "idx_configs_conciliacao_base_fiscal_id" ON "configs_conciliacao"("base_fiscal_id")');
        }

        const cfgKeysExist = await knex.schema.hasTable('configs_conciliacao_keys');
        if (cfgKeysExist) {
            await knex.raw('CREATE INDEX IF NOT EXISTS "idx_configs_conciliacao_keys_config_id" ON "configs_conciliacao_keys"("config_conciliacao_id")');
            await knex.raw('CREATE INDEX IF NOT EXISTS "idx_configs_conciliacao_keys_pair_id" ON "configs_conciliacao_keys"("keys_pair_id")');
            await knex.raw('CREATE INDEX IF NOT EXISTS "idx_configs_conciliacao_keys_contabil_key_id" ON "configs_conciliacao_keys"("contabil_key_id")');
            await knex.raw('CREATE INDEX IF NOT EXISTS "idx_configs_conciliacao_keys_fiscal_key_id" ON "configs_conciliacao_keys"("fiscal_key_id")');
        }

        const pairsExist = await knex.schema.hasTable('keys_pairs');
        if (pairsExist) {
            await knex.raw('CREATE INDEX IF NOT EXISTS "idx_keys_pairs_contabil_key_id" ON "keys_pairs"("contabil_key_id")');
            await knex.raw('CREATE INDEX IF NOT EXISTS "idx_keys_pairs_fiscal_key_id" ON "keys_pairs"("fiscal_key_id")');
        }

        const defsExist = await knex.schema.hasTable('keys_definitions');
        if (defsExist) {
            await knex.raw('CREATE INDEX IF NOT EXISTS "idx_keys_definitions_base_tipo" ON "keys_definitions"("base_tipo")');
            await knex.raw('CREATE INDEX IF NOT EXISTS "idx_keys_definitions_subtype" ON "keys_definitions"("base_subtipo")');
        }

        const marksExist = await knex.schema.hasTable('conciliacao_marks');
        if (marksExist) {
            await knex.raw('CREATE INDEX IF NOT EXISTS "idx_conciliacao_marks_base_row" ON "conciliacao_marks"("base_id","row_id")');
        }
    } catch (err) {
        // best-effort
        // eslint-disable-next-line no-console
        console.warn('Error creating metadata indexes:', err && err.message ? err.message : err);
    }
};

exports.down = async function down(knex) {
    // reverse indexes created above
    try {
        const configsExist = await knex.schema.hasTable('configs_conciliacao');
        const basesExist = await knex.schema.hasTable('bases');

        const concCols = new Set();
        if (configsExist) {
            const rows = await knex('configs_conciliacao').select('coluna_conciliacao_contabil', 'coluna_conciliacao_fiscal');
            for (const r of rows) {
                if (r && r.coluna_conciliacao_contabil) concCols.add(String(r.coluna_conciliacao_contabil).trim());
                if (r && r.coluna_conciliacao_fiscal) concCols.add(String(r.coluna_conciliacao_fiscal).trim());
            }
        }

        if (basesExist && concCols.size > 0) {
            const bases = await knex('bases').select('tabela_sqlite');
            for (const b of bases) {
                const tableName = b && b.tabela_sqlite ? String(b.tabela_sqlite) : null;
                if (!tableName) continue;
                for (const col of Array.from(concCols)) {
                    const idxName = `idx_${tableName}_${col}`.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
                    try {
                        // eslint-disable-next-line no-await-in-loop
                        await knex.raw(`DROP INDEX IF EXISTS "${idxName}"`);
                    } catch (err) {
                        // ignore
                    }
                }
            }
        }

        // drop metadata indexes
        await knex.raw('DROP INDEX IF EXISTS "idx_configs_conciliacao_base_contabil_id"');
        await knex.raw('DROP INDEX IF EXISTS "idx_configs_conciliacao_base_fiscal_id"');
        await knex.raw('DROP INDEX IF EXISTS "idx_configs_conciliacao_keys_config_id"');
        await knex.raw('DROP INDEX IF EXISTS "idx_configs_conciliacao_keys_pair_id"');
        await knex.raw('DROP INDEX IF EXISTS "idx_configs_conciliacao_keys_contabil_key_id"');
        await knex.raw('DROP INDEX IF EXISTS "idx_configs_conciliacao_keys_fiscal_key_id"');
        await knex.raw('DROP INDEX IF EXISTS "idx_keys_pairs_contabil_key_id"');
        await knex.raw('DROP INDEX IF EXISTS "idx_keys_pairs_fiscal_key_id"');
        await knex.raw('DROP INDEX IF EXISTS "idx_keys_definitions_base_tipo"');
        await knex.raw('DROP INDEX IF EXISTS "idx_keys_definitions_subtype"');
        await knex.raw('DROP INDEX IF EXISTS "idx_conciliacao_marks_base_row"');
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('Error dropping indexes:', err && err.message ? err.message : err);
    }
};
