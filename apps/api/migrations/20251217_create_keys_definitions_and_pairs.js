/* eslint-disable camelcase */
exports.up = async function (knex) {
  const hasKeys = await knex.schema.hasTable('keys_definitions');
  if (!hasKeys) {
    await knex.schema.createTable('keys_definitions', (t) => {
      t.increments('id').primary();
      t.string('nome').notNullable();
      t.text('descricao').nullable();
      // base_tipo constrained to CONTABIL or FISCAL
      t.specificType('base_tipo', "varchar(50) CHECK (base_tipo IN ('CONTABIL','FISCAL'))").notNullable();
      t.string('base_subtipo').nullable();
      // columns stored as JSON text
      t.text('columns').nullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  const hasPairs = await knex.schema.hasTable('keys_pairs');
  if (!hasPairs) {
    await knex.schema.createTable('keys_pairs', (t) => {
      t.increments('id').primary();
      t.string('nome').notNullable();
      t.text('descricao').nullable();
      t.integer('contabil_key_id').unsigned().notNullable();
      t.integer('fiscal_key_id').unsigned().notNullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

      t.foreign('contabil_key_id').references('id').inTable('keys_definitions').onDelete('RESTRICT');
      t.foreign('fiscal_key_id').references('id').inTable('keys_definitions').onDelete('RESTRICT');
    });
  }
};

exports.down = async function (knex) {
  const hasPairs = await knex.schema.hasTable('keys_pairs');
  if (hasPairs) {
    await knex.schema.dropTableIfExists('keys_pairs');
  }

  const hasKeys = await knex.schema.hasTable('keys_definitions');
  if (hasKeys) {
    await knex.schema.dropTableIfExists('keys_definitions');
  }
};
