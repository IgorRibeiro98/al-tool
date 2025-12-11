/* eslint-disable camelcase */
exports.up = async function (knex) {
  const has = await knex.schema.hasTable('base_columns');
  if (!has) return;
  const existsIsMonetary = await knex.schema.hasColumn('base_columns', 'is_monetary');
  if (!existsIsMonetary) {
    await knex.schema.alterTable('base_columns', (t) => {
      t.integer('is_monetary').notNullable().defaultTo(0);
    });
  }
};

exports.down = async function (knex) {
  const has = await knex.schema.hasTable('base_columns');
  if (!has) return;
  const existsIsMonetary = await knex.schema.hasColumn('base_columns', 'is_monetary');
    if (existsIsMonetary) {
      await knex.schema.alterTable('base_columns', (t) => {
        t.dropColumn('is_monetary');
      });
    }
};
