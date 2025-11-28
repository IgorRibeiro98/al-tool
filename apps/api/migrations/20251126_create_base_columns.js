/**
 * Create base_columns table to map original excel header -> sqlite column name
 */
exports.up = function (knex) {
    return knex.schema.createTable('base_columns', function (table) {
        table.increments('id').primary();
        table.integer('base_id').unsigned().notNullable().references('id').inTable('bases').onDelete('CASCADE');
        table.integer('col_index').unsigned().notNullable(); // 1-based index in the excel region
        table.string('excel_name').nullable();
        table.string('sqlite_name').notNullable();
        table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    });
};

exports.down = function (knex) {
    return knex.schema.dropTableIfExists('base_columns');
};
