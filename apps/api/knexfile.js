/**
 * Knex configuration for SQLite (development)
 * Uses the same env contract as src/config/paths.ts:
 * - DATA_DIR (root for db/uploads/exports)
 * - DB_PATH (full sqlite filename) overrides default <DATA_DIR>/db/dev.sqlite3
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'storage');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'db', 'dev.sqlite3');

const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

module.exports = {
    development: {
        client: 'better-sqlite3',
        connection: {
            filename: DB_PATH,
        },
        useNullAsDefault: true,
        migrations: {
            directory: path.resolve(__dirname, './migrations'),
        },
    },
};
