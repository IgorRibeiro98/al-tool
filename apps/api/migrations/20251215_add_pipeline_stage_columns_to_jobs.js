/**
 * Add pipeline stage tracking columns to `jobs_conciliacao`.
 */
const COLUMNS = [
    { name: 'pipeline_stage', builder: (t) => t.string('pipeline_stage').nullable() },
    { name: 'pipeline_stage_label', builder: (t) => t.string('pipeline_stage_label').nullable() },
    { name: 'pipeline_progress', builder: (t) => t.integer('pipeline_progress').nullable() }
];

exports.up = async function up(knex) {
    const tableExists = await knex.schema.hasTable('jobs_conciliacao');
    if (!tableExists) return;

    for (const col of COLUMNS) {
        // eslint-disable-next-line no-await-in-loop
        const exists = await knex.schema.hasColumn('jobs_conciliacao', col.name);
        if (!exists) {
            // eslint-disable-next-line no-await-in-loop
            await knex.schema.table('jobs_conciliacao', (table) => col.builder(table));
        }
    }
};

exports.down = async function down(knex) {
    const tableExists = await knex.schema.hasTable('jobs_conciliacao');
    if (!tableExists) return;

    await knex.schema.table('jobs_conciliacao', (table) => {
        for (const col of COLUMNS) table.dropColumn(col.name);
    });
};
