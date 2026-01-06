/* eslint-disable camelcase */
// Add update_original_base column to atribuicao_runs table
// When true (default), the runner will also update the original destination base table
exports.up = async function (knex) {
    const exists = await knex.schema.hasTable('atribuicao_runs');
    if (!exists) return;

    const hasColumn = await knex.schema.hasColumn('atribuicao_runs', 'update_original_base');
    if (hasColumn) return;

    await knex.schema.alterTable('atribuicao_runs', (t) => {
        // Default to 1 (true) - update original base is the default behavior
        t.integer('update_original_base').notNullable().defaultTo(1);
    });
};

exports.down = async function (knex) {
    const exists = await knex.schema.hasTable('atribuicao_runs');
    if (!exists) return;

    const hasColumn = await knex.schema.hasColumn('atribuicao_runs', 'update_original_base');
    if (!hasColumn) return;

    await knex.schema.alterTable('atribuicao_runs', (t) => {
        t.dropColumn('update_original_base');
    });
};
