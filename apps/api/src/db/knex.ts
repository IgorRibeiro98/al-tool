import { knex as createKnex, Knex } from 'knex';
import { DB_PATH } from '../config/paths';

// Environment and default constants
const NODE_ENV = process.env.NODE_ENV || 'development';
const DEFAULTS = {
    JOURNAL: 'WAL',
    SYNCHRONOUS: 'NORMAL',
    CACHE_PAGES_PROD: -8000,
    CACHE_PAGES_TEST: -1000,
    CACHE_PAGES_DEV: -4000,
    TEMP_STORE: 'MEMORY',
    BUSY_TIMEOUT_PROD: 8000,
    BUSY_TIMEOUT_TEST: 2000,
    BUSY_TIMEOUT_DEV: 5000,
    FOREIGN_KEYS: 'ON',
} as const;

const dbPath = DB_PATH;

const knexConfig: Knex.Config = {
    client: 'better-sqlite3',
    connection: { filename: dbPath },
    useNullAsDefault: true,
    // Single connection simplifies PRAGMA initialization for better-sqlite3
    pool: { min: 1, max: 1 },
};

const db = createKnex(knexConfig);

type Pragmas = {
    journal: string;
    synchronous: string;
    cacheSize: string; // negative value = pages in memory (keeps parity with previous behavior)
    tempStore: string;
    busyTimeoutMs: number;
    foreignKeys: string;
};

function resolveDefaultPragmas(): Pragmas {
    const journal = process.env.SQLITE_JOURNAL_MODE || DEFAULTS.JOURNAL;
    const synchronous = process.env.SQLITE_SYNCHRONOUS || DEFAULTS.SYNCHRONOUS;

    const cacheSizeEnv = process.env.SQLITE_CACHE_SIZE;
    let cacheSize: string;
    if (cacheSizeEnv) {
        cacheSize = String(cacheSizeEnv);
    } else if (NODE_ENV === 'production') {
        cacheSize = String(DEFAULTS.CACHE_PAGES_PROD);
    } else if (NODE_ENV === 'test') {
        cacheSize = String(DEFAULTS.CACHE_PAGES_TEST);
    } else {
        cacheSize = String(DEFAULTS.CACHE_PAGES_DEV);
    }

    const tempStore = process.env.SQLITE_TEMP_STORE || DEFAULTS.TEMP_STORE;

    const busyTimeoutEnv = process.env.SQLITE_BUSY_TIMEOUT;
    let busyTimeoutMs: number;
    if (busyTimeoutEnv) {
        busyTimeoutMs = Number(busyTimeoutEnv) || DEFAULTS.BUSY_TIMEOUT_DEV;
    } else if (NODE_ENV === 'production') {
        busyTimeoutMs = DEFAULTS.BUSY_TIMEOUT_PROD;
    } else if (NODE_ENV === 'test') {
        busyTimeoutMs = DEFAULTS.BUSY_TIMEOUT_TEST;
    } else {
        busyTimeoutMs = DEFAULTS.BUSY_TIMEOUT_DEV;
    }

    const foreignKeys = process.env.SQLITE_FOREIGN_KEYS || DEFAULTS.FOREIGN_KEYS;

    return {
        journal,
        synchronous,
        cacheSize,
        tempStore,
        busyTimeoutMs,
        foreignKeys,
    };
}

async function applyPragmaRaw(sql: string) {
    // central point for running PRAGMA statements; useful for debugging/tracing
    return db.raw(sql);
}

async function applyPragmas(pragmas: Pragmas) {
    // Order matters for some PRAGMAs (e.g., busy_timeout, foreign_keys, journal_mode)
    await applyPragmaRaw(`PRAGMA busy_timeout = ${Number(pragmas.busyTimeoutMs)}`);
    await applyPragmaRaw(`PRAGMA foreign_keys = ${pragmas.foreignKeys}`);
    await applyPragmaRaw(`PRAGMA journal_mode = ${pragmas.journal}`);
    await applyPragmaRaw(`PRAGMA synchronous = ${pragmas.synchronous}`);
    await applyPragmaRaw(`PRAGMA cache_size = ${pragmas.cacheSize}`);
    await applyPragmaRaw(`PRAGMA temp_store = ${pragmas.tempStore}`);
}

// Initialize PRAGMAs asynchronously at startup. Failures are logged but do not crash.
(async () => {
    const pragmas = resolveDefaultPragmas();
    try {
        await applyPragmas(pragmas);
        // Structured log for observability
        // eslint-disable-next-line no-console
        console.info('SQLite PRAGMAs applied', {
            journal_mode: pragmas.journal,
            synchronous: pragmas.synchronous,
            cache_size: pragmas.cacheSize,
            temp_store: pragmas.tempStore,
            busy_timeout_ms: pragmas.busyTimeoutMs,
            foreign_keys: pragmas.foreignKeys,
            node_env: NODE_ENV,
            db_path: dbPath,
        });
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Error applying SQLite PRAGMAs', err);
    }
})();

export default db;
