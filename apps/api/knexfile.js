const fs = require('fs');
const path = require('path');

// Defaults and constants
const DEFAULT_DATA_DIR = path.resolve(process.cwd(), 'storage');
const DEFAULT_DB_RELATIVE = path.join('db', 'dev.sqlite3');
const MIGRATIONS_DIR = path.resolve(__dirname, './migrations');
const SQLITE_CLIENT = 'better-sqlite3';

function resolveDataDir() {
    return process.env.DATA_DIR || DEFAULT_DATA_DIR;
}

function resolveDbPath() {
    const dataDir = resolveDataDir();
    return process.env.DB_PATH || path.join(dataDir, DEFAULT_DB_RELATIVE);
}

function ensureDirectoryExists(filePath) {
    const dir = path.dirname(filePath);
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    } catch (err) {
        // Surface a clear error to help debugging environment issues
        console.error(`[knexfile] Failed to ensure directory exists: ${dir}`, err);
        throw err;
    }
}

function buildSqliteConfig(dbPath) {
    return {
        client: SQLITE_CLIENT,
        connection: { filename: dbPath },
        useNullAsDefault: true,
        migrations: { directory: MIGRATIONS_DIR },
    };
}

const DB_PATH = resolveDbPath();
ensureDirectoryExists(DB_PATH);

module.exports = {
    development: buildSqliteConfig(DB_PATH),
    // keep a minimal production config placeholder so tools expecting multiple envs behave
    production: buildSqliteConfig(DB_PATH),
    // Allow knex CLI to use NODE_ENV=test when running tests
    test: buildSqliteConfig(DB_PATH),
};
