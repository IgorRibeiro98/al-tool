/**
 * Create `conciliacao_marks` table and supporting index.
 */
const { addCreatedAt } = require('./helpers/migrationHelpers');

exports.up = async function up(knex) {
    const exists = await knex.schema.hasTable('conciliacao_marks');
    if (exists) return;

    await knex.schema.createTable('conciliacao_marks', (table) => {
        table.increments('id').primary();
        table.integer('base_id').notNullable();
        table.integer('row_id').notNullable();
        table.string('status').notNullable();
        table.string('grupo').nullable();
        table.string('chave').nullable();
        addCreatedAt(table, knex);
    });

    // unique index to help idempotency and lookups
    await knex.schema.raw(
        'CREATE UNIQUE INDEX IF NOT EXISTS ux_conciliacao_marks_base_row_grupo ON conciliacao_marks (base_id, row_id, grupo)'
    );
};

exports.down = async function down(knex) {
    await knex.schema.dropTableIfExists('conciliacao_marks');
};
