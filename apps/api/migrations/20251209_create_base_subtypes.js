/**
 * Create `base_subtypes` table.
 */
const { addCreatedAt } = require('./helpers/migrationHelpers');

exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('base_subtypes');
  if (exists) return;

  await knex.schema.createTable('base_subtypes', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.text('description').nullable();
    addCreatedAt(table, knex);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('base_subtypes');
};
