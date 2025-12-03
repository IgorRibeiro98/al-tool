import path from 'path';
import { knex as createKnex } from 'knex';
import { DB_PATH } from './config/paths';

async function run() {
    const migrationsDir = path.resolve(__dirname, '../migrations');
    const db = createKnex({
        client: 'better-sqlite3',
        connection: {
            filename: DB_PATH,
        },
        useNullAsDefault: true,
        migrations: {
            directory: migrationsDir,
        },
    });

    try {
        const [batchNo, log] = await db.migrate.latest();
        console.log('Database migrations completed', { batchNo, log });
    } finally {
        await db.destroy();
    }
}

run().catch((err) => {
    console.error('Failed to run migrations', err);
    process.exitCode = 1;
});