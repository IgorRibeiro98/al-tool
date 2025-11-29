/**
 * Add denormalized columns to jobs_conciliacao
 */
exports.up = async function (knex) {
    const has = await knex.schema.hasTable('jobs_conciliacao');
    if (!has) return;

    const hasArquivo = await knex.schema.hasColumn('jobs_conciliacao', 'arquivo_exportado');
    if (!hasArquivo) {
        await knex.schema.table('jobs_conciliacao', (t) => {
            t.string('arquivo_exportado').nullable();
        });
    }

    const hasEstornoNome = await knex.schema.hasColumn('jobs_conciliacao', 'config_estorno_nome');
    if (!hasEstornoNome) {
        await knex.schema.table('jobs_conciliacao', (t) => {
            t.string('config_estorno_nome').nullable();
        });
    }

    const hasCancelNome = await knex.schema.hasColumn('jobs_conciliacao', 'config_cancelamento_nome');
    if (!hasCancelNome) {
        await knex.schema.table('jobs_conciliacao', (t) => {
            t.string('config_cancelamento_nome').nullable();
        });
    }
};

exports.down = async function (knex) {
    const has = await knex.schema.hasTable('jobs_conciliacao');
    if (!has) return;
    await knex.schema.table('jobs_conciliacao', (t) => {
        t.dropColumn('arquivo_exportado');
        t.dropColumn('config_estorno_nome');
        t.dropColumn('config_cancelamento_nome');
    });
};
