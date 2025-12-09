import path from 'path';
import { knex as createKnex } from 'knex';
import { DB_PATH } from './config/paths';
const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');
const KNEX_CLIENT = 'better-sqlite3';

function createKnexInstance(dbPath: string) {
    return createKnex({
        client: KNEX_CLIENT,
        connection: { filename: dbPath },
        useNullAsDefault: true,
        migrations: { directory: MIGRATIONS_DIR },
    });
}

async function runMigrations(): Promise<void> {
    if (!DB_PATH) {
        console.error('[runMigrations] DB_PATH is not set. Set DB_PATH in your env or config.');
        process.exitCode = 2;
        return;
    }

    const knex = createKnexInstance(DB_PATH);
    try {
        const [batchNo, log] = await knex.migrate.latest();
        console.log('[runMigrations] Database migrations completed', { batchNo, log });
    } catch (err) {
        console.error('[runMigrations] Failed to run migrations', err);
        throw err;
    } finally {
        await knex.destroy();
    }
}

void runMigrations().catch((err) => {
    console.error('[runMigrations] Unexpected error', err);
    process.exitCode = 1;
});