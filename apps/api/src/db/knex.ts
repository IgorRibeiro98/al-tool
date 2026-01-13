import { knex as createKnex, Knex } from 'knex';
import { DB_PATH } from '../config/paths';

// Environment - always treated as production for performance
const NODE_ENV = process.env.NODE_ENV || 'production';

const DEFAULTS = Object.freeze({
    JOURNAL: 'WAL',
    SYNCHRONOUS: 'NORMAL',
    // Negative values = pages in memory. Each page is typically 4KB.
    // -100000 = ~400MB cache (balanced for 8GB RAM machines)
    CACHE_PAGES: -100000,
    // For tests only - smaller cache
    CACHE_PAGES_TEST: -10000,
    TEMP_STORE: 'MEMORY',
    // 60s timeout for large operations
    BUSY_TIMEOUT: 60000,
    BUSY_TIMEOUT_TEST: 5000,
    FOREIGN_KEYS: 'ON',
    // Memory-mapped I/O size in bytes (512MB - balanced for 8GB RAM)
    MMAP_SIZE: 536870912,
    MMAP_SIZE_TEST: 0,
    // Page size (4KB is default)
    PAGE_SIZE: 4096,
});

const dbPath = DB_PATH;

const knexConfig: Knex.Config = {
    client: 'better-sqlite3',
    connection: { filename: dbPath },
    useNullAsDefault: true,
    // Single connection simplifies PRAGMA initialization for better-sqlite3
    pool: { min: 1, max: 1 },
};

const db = createKnex(knexConfig);

interface Pragmas {
    readonly journal: string;
    readonly synchronous: string;
    readonly cacheSize: number; // negative value = pages in memory
    readonly tempStore: string;
    readonly busyTimeoutMs: number;
    readonly foreignKeys: string;
    readonly mmapSize: number; // memory-mapped I/O size in bytes
}

function resolveDefaultPragmas(): Pragmas {
    const journal = process.env.SQLITE_JOURNAL_MODE || DEFAULTS.JOURNAL;
    const synchronous = process.env.SQLITE_SYNCHRONOUS || DEFAULTS.SYNCHRONOUS;

    const cacheSizeEnv = process.env.SQLITE_CACHE_SIZE;
    let cacheSize: number;
    if (cacheSizeEnv) {
        cacheSize = parseInt(cacheSizeEnv, 10) || DEFAULTS.CACHE_PAGES;
    } else if (NODE_ENV === 'test') {
        cacheSize = DEFAULTS.CACHE_PAGES_TEST;
    } else {
        // Always use production-level cache (no dev/prod distinction)
        cacheSize = DEFAULTS.CACHE_PAGES;
    }

    const tempStore = process.env.SQLITE_TEMP_STORE || DEFAULTS.TEMP_STORE;

    const busyTimeoutEnv = process.env.SQLITE_BUSY_TIMEOUT;
    let busyTimeoutMs: number;
    if (busyTimeoutEnv) {
        busyTimeoutMs = parseInt(busyTimeoutEnv, 10) || DEFAULTS.BUSY_TIMEOUT;
    } else if (NODE_ENV === 'test') {
        busyTimeoutMs = DEFAULTS.BUSY_TIMEOUT_TEST;
    } else {
        // Always use production-level timeout (no dev/prod distinction)
        busyTimeoutMs = DEFAULTS.BUSY_TIMEOUT;
    }

    const foreignKeys = process.env.SQLITE_FOREIGN_KEYS || DEFAULTS.FOREIGN_KEYS;

    // Memory-mapped I/O - significantly speeds up read-heavy workloads
    const mmapSizeEnv = process.env.SQLITE_MMAP_SIZE;
    let mmapSize: number;
    if (mmapSizeEnv) {
        mmapSize = parseInt(mmapSizeEnv, 10) || DEFAULTS.MMAP_SIZE;
    } else if (NODE_ENV === 'test') {
        mmapSize = DEFAULTS.MMAP_SIZE_TEST;
    } else {
        // Always use production-level mmap (no dev/prod distinction)
        mmapSize = DEFAULTS.MMAP_SIZE;
    }

    return Object.freeze({
        journal,
        synchronous,
        cacheSize,
        tempStore,
        busyTimeoutMs,
        foreignKeys,
        mmapSize,
    });
}

async function applyPragmaRaw(sql: string) {
    // central point for running PRAGMA statements; useful for debugging/tracing
    return db.raw(sql);
}

async function applyPragmas(pragmas: Pragmas): Promise<void> {
    // Order matters for some PRAGMAs (e.g., busy_timeout, foreign_keys, journal_mode)
    await applyPragmaRaw(`PRAGMA busy_timeout = ${pragmas.busyTimeoutMs}`);
    await applyPragmaRaw(`PRAGMA foreign_keys = ${pragmas.foreignKeys}`);
    await applyPragmaRaw(`PRAGMA journal_mode = ${pragmas.journal}`);
    await applyPragmaRaw(`PRAGMA synchronous = ${pragmas.synchronous}`);
    await applyPragmaRaw(`PRAGMA cache_size = ${pragmas.cacheSize}`);
    await applyPragmaRaw(`PRAGMA temp_store = ${pragmas.tempStore}`);
    // Memory-mapped I/O for faster reads (especially beneficial on Windows/SSDs)
    if (pragmas.mmapSize > 0) {
        await applyPragmaRaw(`PRAGMA mmap_size = ${pragmas.mmapSize}`);
    }
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
            cache_size_mb: Math.abs(pragmas.cacheSize) * 4 / 1024, // Approx MB
            temp_store: pragmas.tempStore,
            busy_timeout_ms: pragmas.busyTimeoutMs,
            foreign_keys: pragmas.foreignKeys,
            mmap_size: pragmas.mmapSize,
            mmap_size_mb: Math.round(pragmas.mmapSize / 1024 / 1024),
            node_env: NODE_ENV,
            db_path: dbPath,
        });
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Error applying SQLite PRAGMAs', err);
    }
})();

export default db;
