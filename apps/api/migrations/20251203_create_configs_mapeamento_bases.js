/**
 * Create `configs_mapeamento_bases` and add optional mapping refs to `jobs_conciliacao`.
 */
const { addTimestamps } = require('./helpers/migrationHelpers');

exports.up = async function up(knex) {
    const mappingExists = await knex.schema.hasTable('configs_mapeamento_bases');
    if (!mappingExists) {
        await knex.schema.createTable('configs_mapeamento_bases', (table) => {
            table.increments('id').primary();
            table.string('nome').notNullable();
            table.integer('base_contabil_id').unsigned().notNullable();
            table.integer('base_fiscal_id').unsigned().notNullable();
            table.text('mapeamentos').notNullable().defaultTo('[]');
            addTimestamps(table, knex);
        });
    }

    const jobsExist = await knex.schema.hasTable('jobs_conciliacao');
    if (!jobsExist) return;

    const columnsToEnsure = [
        { name: 'config_mapeamento_id', builder: (t) => t.integer('config_mapeamento_id').unsigned().nullable() },
        { name: 'config_mapeamento_nome', builder: (t) => t.string('config_mapeamento_nome').nullable() }
    ];

    for (const col of columnsToEnsure) {
        // eslint-disable-next-line no-await-in-loop
        const exists = await knex.schema.hasColumn('jobs_conciliacao', col.name);
        if (!exists) {
            // eslint-disable-next-line no-await-in-loop
            await knex.schema.table('jobs_conciliacao', (table) => col.builder(table));
        }
    }
};

exports.down = async function down(knex) {
    const jobsExist = await knex.schema.hasTable('jobs_conciliacao');
    if (jobsExist) {
        const mapIdExists = await knex.schema.hasColumn('jobs_conciliacao', 'config_mapeamento_id');
        const mapNomeExists = await knex.schema.hasColumn('jobs_conciliacao', 'config_mapeamento_nome');
        if (mapIdExists || mapNomeExists) {
            await knex.schema.table('jobs_conciliacao', (table) => {
                if (mapIdExists) table.dropColumn('config_mapeamento_id');
                if (mapNomeExists) table.dropColumn('config_mapeamento_nome');
            });
        }
    }

    const mappingExists = await knex.schema.hasTable('configs_mapeamento_bases');
    if (mappingExists) {
        await knex.schema.dropTableIfExists('configs_mapeamento_bases');
    }
};
