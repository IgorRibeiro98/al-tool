/**
 * Initial migration creating metadata tables for the reconciliation system
 */
exports.up = function (knex) {
    return Promise.resolve()
        .then(() => {
            return knex.schema.createTable('bases', function (table) {
                table.increments('id').primary();
                table.string('tipo').notNullable(); // CONTABIL or FISCAL
                table.string('nome').notNullable();
                table.string('periodo').nullable();
                table.string('arquivo_caminho').nullable();
                table.string('tabela_sqlite').nullable();
                table.integer('header_linha_inicial').unsigned().notNullable().defaultTo(1);
                table.integer('header_coluna_inicial').unsigned().notNullable().defaultTo(1);
                table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
            });
        })
        .then(() => {
            return knex.schema.createTable('configs_cancelamento', function (table) {
                table.increments('id').primary();
                table.integer('base_id').unsigned().nullable();
                table.string('nome').notNullable();
                table.string('coluna_indicador').notNullable();
                table.string('valor_cancelado').notNullable();
                table.string('valor_nao_cancelado').notNullable();
                table.boolean('ativa').defaultTo(true);
                table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
                table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
            });
        })
        .then(() => {
            return knex.schema.createTable('configs_estorno', function (table) {
                table.increments('id').primary();
                table.integer('base_id').unsigned().nullable();
                table.string('nome').notNullable();
                table.string('coluna_a').notNullable();
                table.string('coluna_b').notNullable();
                table.string('coluna_soma').notNullable();
                table.decimal('limite_zero', 14, 4).defaultTo(0);
                table.boolean('ativa').defaultTo(true);
                table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
                table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
            });
        })
        .then(() => {
            return knex.schema.createTable('configs_conciliacao', function (table) {
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
                table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
                table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
            });
        })
        .then(() => {
            return knex.schema.createTable('jobs_conciliacao', function (table) {
                table.increments('id').primary();
                table.string('nome').notNullable();
                table.integer('config_conciliacao_id').unsigned().notNullable();
                table.integer('config_estorno_id').unsigned().nullable();
                table.integer('config_cancelamento_id').unsigned().nullable();
                table.string('status').notNullable().defaultTo('PENDING');
                table.text('erro').nullable();
                table.string('arquivo_exportado').nullable();
                table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
                table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
            });
        });
};

exports.down = function (knex) {
    return Promise.resolve()
        .then(() => knex.schema.dropTableIfExists('jobs_conciliacao'))
        .then(() => knex.schema.dropTableIfExists('configs_conciliacao'))
        .then(() => knex.schema.dropTableIfExists('configs_estorno'))
        .then(() => knex.schema.dropTableIfExists('configs_cancelamento'))
        .then(() => knex.schema.dropTableIfExists('bases'));
};
