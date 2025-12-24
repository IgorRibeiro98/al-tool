/**
 * Create unique index on keys_pairs(contabil_key_id, fiscal_key_id)
 */
exports.up = async function up(knex) {
  try {
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS "idx_keys_pairs_contabil_fiscal" ON "keys_pairs"("contabil_key_id","fiscal_key_id")');
  } catch (err) {
    // best-effort
    // eslint-disable-next-line no-console
    console.warn('Could not create unique index for keys_pairs:', err && err.message ? err.message : err);
  }
};

exports.down = async function down(knex) {
  try {
    await knex.raw('DROP INDEX IF EXISTS "idx_keys_pairs_contabil_fiscal"');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Could not drop unique index for keys_pairs:', err && err.message ? err.message : err);
  }
};
