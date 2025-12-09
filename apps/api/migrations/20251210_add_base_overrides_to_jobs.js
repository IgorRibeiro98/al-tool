/**
 * Allow jobs to override base IDs used during execution.
 */
const COLUMNS = [
    { name: 'base_contabil_id_override', builder: (t) => t.integer('base_contabil_id_override').unsigned().nullable() },
    { name: 'base_fiscal_id_override', builder: (t) => t.integer('base_fiscal_id_override').unsigned().nullable() }
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
        for (const col of COLUMNS) {
            table.dropColumn(col.name);
        }
    });
};
