import path from 'path';
import fs from 'fs';

// Base data directory (root for DB, uploads, exports)
export const DATA_DIR = (() => {
    const dir = process.env.DATA_DIR || path.resolve(process.cwd(), 'storage');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    console.log('[paths] DATA_DIR resolved to', dir);
    return dir;
})();

// SQLite database file
export const DB_PATH = (() => {
    const explicit = process.env.DB_PATH;
    const fallback = path.join(DATA_DIR, 'db', 'dev.sqlite3');
    const dir = path.dirname(explicit || fallback);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    console.log('[paths] DB_PATH resolved to', explicit || fallback);
    return explicit || fallback;
})();

// Uploads directory
export const UPLOAD_DIR = (() => {
    const dir = process.env.UPLOAD_DIR || path.join(DATA_DIR, 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    console.log('[paths] UPLOAD_DIR resolved to', dir);
    return dir;
})();

// Ingest artifacts directory (JSONL files generated from uploads)
export const INGESTS_DIR = (() => {
    const dir = process.env.INGESTS_DIR || path.join(DATA_DIR, 'ingests');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    console.log('[paths] INGESTS_DIR resolved to', dir);
    return dir;
})();

// Exports directory
export const EXPORT_DIR = (() => {
    const dir = process.env.EXPORT_DIR || path.join(DATA_DIR, 'exports');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    console.log('[paths] EXPORT_DIR resolved to', dir);
    return dir;
})();

export default { DATA_DIR, DB_PATH, UPLOAD_DIR, EXPORT_DIR, INGESTS_DIR };
