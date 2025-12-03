/**
 * Allow jobs to override base IDs used during execução.
 */
exports.up = async function up(knex) {
    const hasTable = await knex.schema.hasTable('jobs_conciliacao');
    if (!hasTable) return;

    const hasBaseContabil = await knex.schema.hasColumn('jobs_conciliacao', 'base_contabil_id_override');
    if (!hasBaseContabil) {
        await knex.schema.table('jobs_conciliacao', (table) => {
            table.integer('base_contabil_id_override').unsigned().nullable();
        });
    }

    const hasBaseFiscal = await knex.schema.hasColumn('jobs_conciliacao', 'base_fiscal_id_override');
    if (!hasBaseFiscal) {
        await knex.schema.table('jobs_conciliacao', (table) => {
            table.integer('base_fiscal_id_override').unsigned().nullable();
        });
    }
};

exports.down = async function down(knex) {
    const hasTable = await knex.schema.hasTable('jobs_conciliacao');
    if (!hasTable) return;

    const tasks = [];
    const hasBaseContabil = await knex.schema.hasColumn('jobs_conciliacao', 'base_contabil_id_override');
    if (hasBaseContabil) {
        tasks.push(knex.schema.table('jobs_conciliacao', (table) => {
            table.dropColumn('base_contabil_id_override');
        }));
    }

    const hasBaseFiscal = await knex.schema.hasColumn('jobs_conciliacao', 'base_fiscal_id_override');
    if (hasBaseFiscal) {
        tasks.push(knex.schema.table('jobs_conciliacao', (table) => {
            table.dropColumn('base_fiscal_id_override');
        }));
    }

    await Promise.all(tasks);
};
