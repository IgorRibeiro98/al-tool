exports.up = async function(knex) {
  // add subtype and reference_base_id to bases
  const has = await knex.schema.hasColumn('bases', 'subtype');
  if (!has) {
    await knex.schema.alterTable('bases', (t) => {
      t.string('subtype').nullable();
      t.integer('reference_base_id').nullable().unsigned();
    });
  }

  // create base_subtypes table for user-managed subtypes
  const exists = await knex.schema.hasTable('base_subtypes');
  if (!exists) {
    await knex.schema.createTable('base_subtypes', (t) => {
      t.increments('id').primary();
      t.string('tipo').notNullable(); // CONTABIL | FISCAL
      t.string('name').notNullable(); // subtype name (free)
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }
};

exports.down = async function(knex) {
  const has = await knex.schema.hasColumn('bases', 'subtype');
  if (has) {
    await knex.schema.alterTable('bases', (t) => {
      t.dropColumn('subtype');
      t.dropColumn('reference_base_id');
    });
  }

  const exists = await knex.schema.hasTable('base_subtypes');
  if (exists) {
    await knex.schema.dropTable('base_subtypes');
  }
};
