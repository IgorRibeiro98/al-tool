/* eslint-disable camelcase */
// Create atribuicao_runs table for Data Attribution runs
exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('atribuicao_runs');
  if (exists) return;

  await knex.schema.createTable('atribuicao_runs', (t) => {
    t.increments('id').primary();
    t.string('nome').nullable();
    t.integer('base_origem_id').unsigned().notNullable();
    t.integer('base_destino_id').unsigned().notNullable();
    t.string('mode_write').notNullable().defaultTo('OVERWRITE'); // OVERWRITE | ONLY_EMPTY
    t.text('selected_columns').nullable(); // JSON array of column names
    t.text('selected_columns_json').nullable();
    t.string('status').notNullable().defaultTo('PENDING'); // PENDING | RUNNING | DONE | FAILED
    t.string('pipeline_stage').nullable();
    t.integer('pipeline_progress').nullable();
    t.string('pipeline_stage_label').nullable();
    t.text('erro').nullable();
    t.string('result_table_name').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    // Foreign keys
    t.foreign('base_origem_id').references('id').inTable('bases').onDelete('RESTRICT');
    t.foreign('base_destino_id').references('id').inTable('bases').onDelete('RESTRICT');
  });
};

exports.down = async function (knex) {
  const exists = await knex.schema.hasTable('atribuicao_runs');
  if (exists) await knex.schema.dropTableIfExists('atribuicao_runs');
};
