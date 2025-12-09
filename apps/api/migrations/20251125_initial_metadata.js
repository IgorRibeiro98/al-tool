/**
 * Initial migration: create core metadata tables for reconciliation.
 * Refactored for clarity and reuse.
 */
const { addTimestamps, addCreatedAt } = require('./helpers/migrationHelpers');

exports.up = async function up(knex) {
    // helper to create the `bases` table
    await knex.schema.createTable('bases', (table) => {
        table.increments('id').primary();
        table.string('tipo').notNullable(); // CONTABIL or FISCAL
        table.string('nome').notNullable();
        table.string('periodo').nullable();
        table.string('arquivo_caminho').nullable();
        table.string('tabela_sqlite').nullable();
        table.integer('header_linha_inicial').unsigned().notNullable().defaultTo(1);
        table.integer('header_coluna_inicial').unsigned().notNullable().defaultTo(1);
        addCreatedAt(table, knex);
    });

    // configs_cancelamento
    await knex.schema.createTable('configs_cancelamento', (table) => {
        table.increments('id').primary();
        table.integer('base_id').unsigned().nullable();
        table.string('nome').notNullable();
        table.string('coluna_indicador').notNullable();
        table.string('valor_cancelado').notNullable();
        table.string('valor_nao_cancelado').notNullable();
        table.boolean('ativa').defaultTo(true);
        addTimestamps(table, knex);
    });

    // configs_estorno
    await knex.schema.createTable('configs_estorno', (table) => {
        table.increments('id').primary();
        table.integer('base_id').unsigned().nullable();
        table.string('nome').notNullable();
        table.string('coluna_a').notNullable();
        table.string('coluna_b').notNullable();
        table.string('coluna_soma').notNullable();
        table.decimal('limite_zero', 14, 4).defaultTo(0);
        table.boolean('ativa').defaultTo(true);
        addTimestamps(table, knex);
    });

    // configs_conciliacao
    await knex.schema.createTable('configs_conciliacao', (table) => {
        table.increments('id').primary();
        table.string('nome').notNullable();
        table.integer('base_contabil_id').unsigned().notNullable();
        table.integer('base_fiscal_id').unsigned().notNullable();
        table.text('chaves_contabil').nullable(); // JSON string
        table.text('chaves_fiscal').nullable(); // JSON string
        table.string('coluna_conciliacao_contabil').nullable();
        table.string('coluna_conciliacao_fiscal').nullable();
        table.boolean('inverter_sinal_fiscal').defaultTo(false);
        table.decimal('limite_diferenca_imaterial', 14, 4).defaultTo(0);
        addTimestamps(table, knex);
    });

    // jobs_conciliacao
    await knex.schema.createTable('jobs_conciliacao', (table) => {
        table.increments('id').primary();
        table.string('nome').notNullable();
        table.integer('config_conciliacao_id').unsigned().notNullable();
        table.integer('config_estorno_id').unsigned().nullable();
        table.integer('config_cancelamento_id').unsigned().nullable();
        table.string('status').notNullable().defaultTo('PENDING');
        table.text('erro').nullable();
        table.string('arquivo_exportado').nullable();
        addTimestamps(table, knex);
    });
};

exports.down = async function down(knex) {
    // drop in reverse order of creation to avoid FK issues
    const tables = [
        'jobs_conciliacao',
        'configs_conciliacao',
        'configs_estorno',
        'configs_cancelamento',
        'bases'
    ];

    for (const name of tables) {
        // use await to ensure sequential drops and clearer errors
        // eslint-disable-next-line no-await-in-loop
        await knex.schema.dropTableIfExists(name);
    }
};
