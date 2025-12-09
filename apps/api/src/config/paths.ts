import path from 'path';
import fs from 'fs';

// Named subdirectories under DATA_DIR
const SUBDIR_DB = 'db';
const SUBDIR_UPLOADS = 'uploads';
const SUBDIR_INGESTS = 'ingests';
const SUBDIR_EXPORTS = 'exports';

function logPath(name: string, value: string) {
    // Keep logs concise and consistent; can be replaced by a proper logger later.
    // Avoid logging sensitive information.
    // eslint-disable-next-line no-console
    console.log(`[paths] ${name} -> ${value}`);
}

function ensureDirectoryExists(dirPath: string): string {
    const normalized = path.resolve(dirPath);
    try {
        if (!fs.existsSync(normalized)) {
            fs.mkdirSync(normalized, { recursive: true });
        }
    } catch (err) {
        const message = `Failed to create directory ${normalized}: ${err instanceof Error ? err.message : String(err)}`;
        // throw an Error so process startup fails loudly and operator can fix permissions
        throw new Error(message);
    }
    return normalized;
}

function resolveDir(envVar: string | undefined, fallbackPath: string, name: string): string {
    const raw = envVar || fallbackPath;
    const dir = ensureDirectoryExists(raw);
    logPath(name, dir);
    return dir;
}

// Base data directory (root for DB, uploads, exports)
export const DATA_DIR = (() => {
    const defaultStorage = path.resolve(process.cwd(), 'storage');
    return resolveDir(process.env.DATA_DIR, defaultStorage, 'DATA_DIR');
})();

// SQLite database file (path to file). If DB_PATH is provided, use it; otherwise use DATA_DIR/db/dev.sqlite3
export const DB_PATH = (() => {
    const fallbackFile = path.join(DATA_DIR, SUBDIR_DB, 'dev.sqlite3');
    const explicit = process.env.DB_PATH;
    const resolvedFile = path.resolve(explicit || fallbackFile);
    // Ensure directory for the DB file exists
    ensureDirectoryExists(path.dirname(resolvedFile));
    logPath('DB_PATH', resolvedFile);
    return resolvedFile;
})();

// Uploads directory
export const UPLOAD_DIR = (() => {
    const fallback = path.join(DATA_DIR, SUBDIR_UPLOADS);
    return resolveDir(process.env.UPLOAD_DIR, fallback, 'UPLOAD_DIR');
})();

// Ingest artifacts directory (JSONL files generated from uploads)
export const INGESTS_DIR = (() => {
    const fallback = path.join(DATA_DIR, SUBDIR_INGESTS);
    return resolveDir(process.env.INGESTS_DIR, fallback, 'INGESTS_DIR');
})();

// Exports directory
export const EXPORT_DIR = (() => {
    const fallback = path.join(DATA_DIR, SUBDIR_EXPORTS);
    return resolveDir(process.env.EXPORT_DIR, fallback, 'EXPORT_DIR');
})();

export default { DATA_DIR, DB_PATH, UPLOAD_DIR, EXPORT_DIR, INGESTS_DIR };
