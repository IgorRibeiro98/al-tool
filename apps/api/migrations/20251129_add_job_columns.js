/**
 * Add denormalized columns to `jobs_conciliacao`.
 */
const NEW_COLUMNS = [
    { name: 'arquivo_exportado', builder: (t) => t.string('arquivo_exportado').nullable() },
    { name: 'config_estorno_nome', builder: (t) => t.string('config_estorno_nome').nullable() },
    { name: 'config_cancelamento_nome', builder: (t) => t.string('config_cancelamento_nome').nullable() }
];

exports.up = async function up(knex) {
    const tableExists = await knex.schema.hasTable('jobs_conciliacao');
    if (!tableExists) return;

    for (const col of NEW_COLUMNS) {
        // eslint-disable-next-line no-await-in-loop
        const exists = await knex.schema.hasColumn('jobs_conciliacao', col.name);
        if (!exists) {
            // eslint-disable-next-line no-await-in-loop
            await knex.schema.table('jobs_conciliacao', (t) => col.builder(t));
        }
    }
};

exports.down = async function down(knex) {
    const tableExists = await knex.schema.hasTable('jobs_conciliacao');
    if (!tableExists) return;

    await knex.schema.table('jobs_conciliacao', (t) => {
        for (const col of NEW_COLUMNS) {
            t.dropColumn(col.name);
        }
    });
};
