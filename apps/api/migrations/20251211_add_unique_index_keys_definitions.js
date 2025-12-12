/**
 * Create unique index on keys_definitions(nome, base_tipo, base_subtipo)
 */
exports.up = async function up(knex) {
  try {
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS "idx_keys_unique_nome_tipo_subtipo" ON "keys_definitions"("nome","base_tipo","base_subtipo")');
  } catch (err) {
    // best-effort
    // eslint-disable-next-line no-console
    console.warn('Could not create unique index for keys_definitions:', err && err.message ? err.message : err);
  }
};

exports.down = async function down(knex) {
  try {
    await knex.raw('DROP INDEX IF EXISTS "idx_keys_unique_nome_tipo_subtipo"');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Could not drop unique index for keys_definitions:', err && err.message ? err.message : err);
  }
};
