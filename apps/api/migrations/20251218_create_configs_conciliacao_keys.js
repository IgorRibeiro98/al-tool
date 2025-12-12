/* eslint-disable camelcase */
// Link table between configs_conciliacao and keys (pairs or direct definitions)
exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('configs_conciliacao_keys');
  if (exists) return;

  await knex.schema.createTable('configs_conciliacao_keys', (t) => {
    t.increments('id').primary();
    t.integer('config_conciliacao_id').unsigned().notNullable();
    t.string('key_identifier').notNullable();
    t.integer('keys_pair_id').unsigned().nullable();
    t.integer('contabil_key_id').unsigned().nullable();
    t.integer('fiscal_key_id').unsigned().nullable();
    t.integer('ordem').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.foreign('config_conciliacao_id').references('id').inTable('configs_conciliacao').onDelete('CASCADE');
    t.foreign('keys_pair_id').references('id').inTable('keys_pairs').onDelete('RESTRICT');
    t.foreign('contabil_key_id').references('id').inTable('keys_definitions').onDelete('RESTRICT');
    t.foreign('fiscal_key_id').references('id').inTable('keys_definitions').onDelete('RESTRICT');

    // Ensure either keys_pair_id is set OR (contabil_key_id AND fiscal_key_id) are set
    t.specificType('consistency_check', "integer GENERATED ALWAYS AS (CASE WHEN (keys_pair_id IS NOT NULL) OR (contabil_key_id IS NOT NULL AND fiscal_key_id IS NOT NULL) THEN 1 ELSE 0 END) VIRTUAL");
  });
};

exports.down = async function (knex) {
  const exists = await knex.schema.hasTable('configs_conciliacao_keys');
  if (exists) await knex.schema.dropTableIfExists('configs_conciliacao_keys');
};
