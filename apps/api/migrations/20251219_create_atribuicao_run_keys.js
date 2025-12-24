/* eslint-disable camelcase */
// Create atribuicao_run_keys linking table for prioritized keys
exports.up = async function (knex) {
    const exists = await knex.schema.hasTable('atribuicao_run_keys');
    if (exists) return;

    await knex.schema.createTable('atribuicao_run_keys', (t) => {
        t.increments('id').primary();
        t.integer('atribuicao_run_id').unsigned().notNullable();
        t.integer('keys_pair_id').unsigned().notNullable();
        t.string('key_identifier').notNullable(); // e.g., CHAVE_1, CHAVE_2
        t.integer('ordem').notNullable().defaultTo(0); // Priority order (lower = higher priority)
        t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

        // Foreign keys
        t.foreign('atribuicao_run_id').references('id').inTable('atribuicao_runs').onDelete('CASCADE');
        t.foreign('keys_pair_id').references('id').inTable('keys_pairs').onDelete('RESTRICT');

        // Index for efficient lookups
        t.index(['atribuicao_run_id', 'ordem']);
    });
};

exports.down = async function (knex) {
    const exists = await knex.schema.hasTable('atribuicao_run_keys');
    if (exists) await knex.schema.dropTableIfExists('atribuicao_run_keys');
};
