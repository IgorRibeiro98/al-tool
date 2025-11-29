/**
 * Create conciliacao_marks table and index
 */
exports.up = async function (knex) {
    const exists = await knex.schema.hasTable('conciliacao_marks');
    if (!exists) {
        await knex.schema.createTable('conciliacao_marks', (t) => {
            t.increments('id').primary();
            t.integer('base_id').notNullable();
            t.integer('row_id').notNullable();
            t.string('status').notNullable();
            t.string('grupo').nullable();
            t.string('chave').nullable();
            t.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
        });
        // unique index to help idempotency
        await knex.schema.raw('CREATE UNIQUE INDEX IF NOT EXISTS ux_conciliacao_marks_base_row_grupo ON conciliacao_marks (base_id, row_id, grupo)');
    }
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('conciliacao_marks');
};
