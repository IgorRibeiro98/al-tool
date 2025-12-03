/**
 * Create configs_mapeamento_bases table and add optional mapping references to jobs_conciliacao
 */
exports.up = async function (knex) {
    const hasMappingTable = await knex.schema.hasTable('configs_mapeamento_bases');
    if (!hasMappingTable) {
        await knex.schema.createTable('configs_mapeamento_bases', (table) => {
            table.increments('id').primary();
            table.string('nome').notNullable();
            table.integer('base_contabil_id').unsigned().notNullable();
            table.integer('base_fiscal_id').unsigned().notNullable();
            table.text('mapeamentos').notNullable().defaultTo('[]');
            table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
            table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
        });
    }

    const hasJobsTable = await knex.schema.hasTable('jobs_conciliacao');
    if (!hasJobsTable) return;

    const hasMapId = await knex.schema.hasColumn('jobs_conciliacao', 'config_mapeamento_id');
    const hasMapNome = await knex.schema.hasColumn('jobs_conciliacao', 'config_mapeamento_nome');

    if (!hasMapId || !hasMapNome) {
        await knex.schema.table('jobs_conciliacao', (table) => {
            if (!hasMapId) table.integer('config_mapeamento_id').unsigned().nullable();
            if (!hasMapNome) table.string('config_mapeamento_nome').nullable();
        });
    }
};

exports.down = async function (knex) {
    const hasJobsTable = await knex.schema.hasTable('jobs_conciliacao');
    if (hasJobsTable) {
        const hasMapId = await knex.schema.hasColumn('jobs_conciliacao', 'config_mapeamento_id');
        const hasMapNome = await knex.schema.hasColumn('jobs_conciliacao', 'config_mapeamento_nome');
        if (hasMapId || hasMapNome) {
            await knex.schema.table('jobs_conciliacao', (table) => {
                if (hasMapId) table.dropColumn('config_mapeamento_id');
                if (hasMapNome) table.dropColumn('config_mapeamento_nome');
            });
        }
    }

    const hasMappingTable = await knex.schema.hasTable('configs_mapeamento_bases');
    if (hasMappingTable) {
        await knex.schema.dropTableIfExists('configs_mapeamento_bases');
    }
};
