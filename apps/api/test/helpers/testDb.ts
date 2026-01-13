/**
 * Helper para criar banco de dados SQLite in-memory para testes
 */
import { knex as createKnex, Knex } from 'knex';

export interface TestDbContext {
    db: Knex;
    cleanup: () => Promise<void>;
}

/**
 * Cria uma conexão Knex para um banco SQLite in-memory
 */
export function createTestDb(): TestDbContext {
    const db = createKnex({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
        pool: { min: 1, max: 1 },
    });

    const cleanup = async () => {
        await db.destroy();
    };

    return { db, cleanup };
}

/**
 * Cria as tabelas necessárias para testes de repositório
 */
export async function createBaseTables(db: Knex): Promise<void> {
    // Tabela bases
    await db.schema.createTable('bases', (t) => {
        t.increments('id').primary();
        t.string('nome').notNullable();
        t.string('tipo').notNullable(); // CONTABIL | FISCAL
        t.string('periodo').nullable();
        t.string('tabela_sqlite').nullable();
        t.string('subtype').nullable();
        t.timestamp('created_at').defaultTo(db.fn.now());
        t.timestamp('updated_at').defaultTo(db.fn.now());
    });

    // Tabela base_columns
    await db.schema.createTable('base_columns', (t) => {
        t.increments('id').primary();
        t.integer('base_id').unsigned().notNullable().references('id').inTable('bases');
        t.string('excel_name').notNullable();
        t.string('sqlite_name').notNullable();
        t.integer('col_index').notNullable();
        t.integer('is_monetary').nullable();
        t.timestamp('created_at').defaultTo(db.fn.now());
    });

    // Tabela ingest_jobs
    await db.schema.createTable('ingest_jobs', (t) => {
        t.increments('id').primary();
        t.string('status').notNullable().defaultTo('PENDING');
        t.text('erro').nullable();
        t.integer('base_id').unsigned().nullable();
        t.timestamp('created_at').defaultTo(db.fn.now());
        t.timestamp('updated_at').defaultTo(db.fn.now());
    });

    // Tabela jobs_conciliacao
    await db.schema.createTable('jobs_conciliacao', (t) => {
        t.increments('id').primary();
        t.string('nome').nullable();
        t.string('status').notNullable().defaultTo('PENDING');
        t.text('erro').nullable();
        t.string('arquivo_exportado').nullable();
        t.integer('export_progress').nullable();
        t.string('export_status').nullable();
        t.string('pipeline_stage').nullable();
        t.string('pipeline_stage_label').nullable();
        t.integer('pipeline_progress').nullable();
        t.integer('config_conciliacao_id').unsigned().nullable();
        t.integer('config_estorno_id').unsigned().nullable();
        t.integer('config_cancelamento_id').unsigned().nullable();
        t.integer('config_mapeamento_id').unsigned().nullable();
        t.string('config_mapeamento_nome').nullable();
        t.string('config_estorno_nome').nullable();
        t.string('config_cancelamento_nome').nullable();
        t.integer('base_contabil_id_override').unsigned().nullable();
        t.integer('base_fiscal_id_override').unsigned().nullable();
        t.timestamp('created_at').defaultTo(db.fn.now());
        t.timestamp('updated_at').defaultTo(db.fn.now());
    });

    // Tabela configs_conciliacao
    await db.schema.createTable('configs_conciliacao', (t) => {
        t.increments('id').primary();
        t.string('nome').nullable();
        t.integer('base_contabil_id').unsigned().nullable();
        t.integer('base_fiscal_id').unsigned().nullable();
        t.text('chaves_contabil').nullable();
        t.text('chaves_fiscal').nullable();
        t.string('coluna_conciliacao_contabil').nullable();
        t.string('coluna_conciliacao_fiscal').nullable();
        t.integer('inverter_sinal_fiscal').nullable();
        t.float('limite_diferenca_imaterial').nullable();
        t.timestamp('created_at').defaultTo(db.fn.now());
        t.timestamp('updated_at').defaultTo(db.fn.now());
    });

    // Tabela configs_estorno
    await db.schema.createTable('configs_estorno', (t) => {
        t.increments('id').primary();
        t.string('nome').nullable();
        t.integer('base_id').unsigned().nullable();
        t.string('coluna_a').nullable();
        t.string('coluna_b').nullable();
        t.string('coluna_soma').nullable();
        t.float('limite_zero').nullable();
        t.timestamp('created_at').defaultTo(db.fn.now());
        t.timestamp('updated_at').defaultTo(db.fn.now());
    });

    // Tabela configs_cancelamento
    await db.schema.createTable('configs_cancelamento', (t) => {
        t.increments('id').primary();
        t.string('nome').nullable();
        t.integer('base_id').unsigned().nullable();
        t.string('coluna_indicador').nullable();
        t.string('valor_cancelado').nullable();
        t.timestamp('created_at').defaultTo(db.fn.now());
        t.timestamp('updated_at').defaultTo(db.fn.now());
    });

    // Tabela conciliacao_marks
    await db.schema.createTable('conciliacao_marks', (t) => {
        t.increments('id').primary();
        t.integer('base_id').unsigned().notNullable();
        t.integer('row_id').unsigned().notNullable();
        t.string('status').nullable();
        t.string('grupo').nullable();
        t.string('chave').nullable();
        t.timestamp('created_at').defaultTo(db.fn.now());
        t.unique(['base_id', 'row_id', 'grupo']);
    });

    // Tabela license
    await db.schema.createTable('license', (t) => {
        t.increments('id').primary();
        t.string('status').nullable();
        t.timestamp('expires_at').nullable();
        t.timestamp('last_success_online_validation_at').nullable();
        t.timestamp('created_at').defaultTo(db.fn.now());
    });

    // Tabela keys_definitions
    await db.schema.createTable('keys_definitions', (t) => {
        t.increments('id').primary();
        t.string('nome').notNullable();
        t.integer('base_id').unsigned().nullable();
        t.text('columns').nullable();
        t.timestamp('created_at').defaultTo(db.fn.now());
    });

    // Tabela keys_pairs
    await db.schema.createTable('keys_pairs', (t) => {
        t.increments('id').primary();
        t.string('nome').nullable();
        t.integer('contabil_key_id').unsigned().nullable();
        t.integer('fiscal_key_id').unsigned().nullable();
        t.timestamp('created_at').defaultTo(db.fn.now());
    });

    // Tabela configs_conciliacao_keys
    await db.schema.createTable('configs_conciliacao_keys', (t) => {
        t.increments('id').primary();
        t.integer('config_conciliacao_id').unsigned().notNullable();
        t.string('key_identifier').notNullable();
        t.integer('ordem').notNullable();
        t.integer('keys_pair_id').unsigned().nullable();
        t.integer('contabil_key_id').unsigned().nullable();
        t.integer('fiscal_key_id').unsigned().nullable();
        t.timestamp('created_at').defaultTo(db.fn.now());
    });
}

/**
 * Cria tabela de dados dinâmica para testes (simula base_<id>)
 */
export async function createDynamicBaseTable(
    db: Knex,
    tableName: string,
    columns: Array<{ name: string; type: 'text' | 'real' | 'integer' }>
): Promise<void> {
    await db.schema.createTable(tableName, (t) => {
        t.increments('id').primary();
        for (const col of columns) {
            if (col.type === 'real') {
                t.float(col.name).nullable();
            } else if (col.type === 'integer') {
                t.integer(col.name).nullable();
            } else {
                t.string(col.name).nullable();
            }
        }
        t.timestamp('created_at').defaultTo(db.fn.now());
    });
}

/**
 * Insere dados em uma tabela
 */
export async function insertRows(db: Knex, tableName: string, rows: Record<string, unknown>[]): Promise<number[]> {
    const ids: number[] = [];
    for (const row of rows) {
        const [id] = await db(tableName).insert(row);
        ids.push(id);
    }
    return ids;
}
