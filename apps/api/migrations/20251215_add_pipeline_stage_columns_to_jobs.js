/**
 * Add pipeline stage tracking columns to jobs_conciliacao
 */
exports.up = async function up(knex) {
    const hasTable = await knex.schema.hasTable('jobs_conciliacao');
    if (!hasTable) return;

    const ensureColumn = async (columnName, builderFn) => {
        const exists = await knex.schema.hasColumn('jobs_conciliacao', columnName);
        if (!exists) {
            await knex.schema.table('jobs_conciliacao', (table) => {
                builderFn(table);
            });
        }
    };

    await ensureColumn('pipeline_stage', (table) => {
        table.string('pipeline_stage').nullable();
    });

    await ensureColumn('pipeline_stage_label', (table) => {
        table.string('pipeline_stage_label').nullable();
    });

    await ensureColumn('pipeline_progress', (table) => {
        table.integer('pipeline_progress').nullable();
    });
};

exports.down = async function down(knex) {
    const hasTable = await knex.schema.hasTable('jobs_conciliacao');
    if (!hasTable) return;

    await knex.schema.table('jobs_conciliacao', (table) => {
        table.dropColumn('pipeline_stage');
        table.dropColumn('pipeline_stage_label');
        table.dropColumn('pipeline_progress');
    });
};
