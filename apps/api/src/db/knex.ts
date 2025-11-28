import { knex as createKnex, Knex } from 'knex';
import path from 'path';
import fs from 'fs';

const dbDir = path.resolve(__dirname, '..', '..', 'db');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'dev.sqlite3');

const config: Knex.Config = {
    client: 'better-sqlite3',
    connection: {
        filename: dbPath
    },
    useNullAsDefault: true,
    // Use a single-connection pool for better-sqlite3 (file DB). This simplifies PRAGMA
    // initialization and avoids multiple connections writing to the same file concurrently.
    pool: { min: 1, max: 1 }
};

const db = createKnex(config);

// ---- SQLite PRAGMA tuning ----
// Apply PRAGMAs once at startup to tune performance for batch-heavy workloads.
// These settings balance durability and speed; they can be tuned via environment variables.
// Important: running PRAGMA statements on a connection affects that connection. With a
// single-connection pool (min/max = 1) we run them once here.

/*
 Recommended defaults used below:
 - journal_mode = WAL
     WAL (Write-Ahead Logging) allows concurrent readers with writers and generally
     improves write throughput for bulk inserts. However, it may require additional
     disk space for the WAL file and behavior across network filesystems may differ.

 - synchronous = NORMAL
     Controls flushing behavior. NORMAL offers a good trade-off: faster than FULL
     while still protecting against most corruptions. For highest durability, use FULL.

 - cache_size = negative value (pages)
     A negative cache_size sets the number of pages to keep in memory (e.g., -2000).
     Larger cache reduces disk I/O but increases RAM usage.

 - temp_store = MEMORY
     Store temporary tables and indices in memory instead of on disk. Improves speed
     for sorts and intermediate operations at cost of RAM.

 See environment variables to override defaults: SQLITE_JOURNAL_MODE, SQLITE_SYNCHRONOUS,
 SQLITE_CACHE_SIZE, SQLITE_TEMP_STORE. Adjust based on load and safety requirements.
*/

const pragmaJournal = process.env.SQLITE_JOURNAL_MODE || 'WAL';
const pragmaSynchronous = process.env.SQLITE_SYNCHRONOUS || 'NORMAL';
const pragmaCacheSize = process.env.SQLITE_CACHE_SIZE || '-2000'; // negative -> pages in memory
const pragmaTempStore = process.env.SQLITE_TEMP_STORE || 'MEMORY';
const pragmaBusyTimeout = process.env.SQLITE_BUSY_TIMEOUT || '5000'; // ms

(async () => {
    try {
        // Set busy timeout to avoid SQLITE_BUSY during heavy writes
        await db.raw(`PRAGMA busy_timeout = ${Number(pragmaBusyTimeout)}`);

        // journal_mode should be set and the returned row may contain the final mode
        await db.raw(`PRAGMA journal_mode = ${pragmaJournal}`);

        // synchronous affects durability vs performance
        await db.raw(`PRAGMA synchronous = ${pragmaSynchronous}`);

        // cache size (negative value indicates number of pages)
        await db.raw(`PRAGMA cache_size = ${pragmaCacheSize}`);

        // temp store in memory
        await db.raw(`PRAGMA temp_store = ${pragmaTempStore}`);

        // Optional: other PRAGMAs could be set here (locking_mode, mmap_size, etc.)
        console.log('SQLite PRAGMAs applied:', {
            journal_mode: pragmaJournal,
            synchronous: pragmaSynchronous,
            cache_size: pragmaCacheSize,
            temp_store: pragmaTempStore,
            busy_timeout: pragmaBusyTimeout
        });
    } catch (err) {
        console.error('Error applying SQLite PRAGMAs', err);
    }
})();

export default db;
