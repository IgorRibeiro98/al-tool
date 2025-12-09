/**
 * Create `base_columns` to map original header -> sqlite column name.
 */
const { addCreatedAt } = require('./helpers/migrationHelpers');

exports.up = async function up(knex) {
    const exists = await knex.schema.hasTable('base_columns');
    if (exists) return;

    await knex.schema.createTable('base_columns', (table) => {
        table.increments('id').primary();
        table
            .integer('base_id')
            .unsigned()
            .notNullable()
            .references('id')
            .inTable('bases')
            .onDelete('CASCADE');
        table.integer('col_index').unsigned().notNullable(); // 1-based index in the excel region
        table.string('excel_name').nullable();
        table.string('sqlite_name').notNullable();
        addCreatedAt(table, knex);
    });
};

exports.down = async function down(knex) {
    await knex.schema.dropTableIfExists('base_columns');
};
