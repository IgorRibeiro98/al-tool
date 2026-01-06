import path from 'path';
import dotenv from 'dotenv';

// Load apps/api/.env to ensure API-specific variables are available regardless of CWD
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Constants
const DEFAULT_PORT = 3000;
const DEFAULT_NODE_ENV = 'development';

// Helper parsers and mappers
function parseIntEnv(name: string, fallback: number): number {
    const v = process.env[name];
    if (!v) return fallback;
    const parsed = parseInt(v, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
}

function firstDefined<T>(...vals: ReadonlyArray<T | undefined | null>): T | undefined {
    for (const v of vals) {
        if (v !== undefined && v !== null) return v;
    }
    return undefined;
}

// Harmonize legacy variable names and provide safe defaults when possible
const DEFAULT_DATA_DIR = path.resolve(__dirname, '..', '..', 'storage');

const DATA_DIR = process.env.DATA_DIR || process.env.APP_DATA_DIR || DEFAULT_DATA_DIR;
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'db', 'dev.sqlite3');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(DATA_DIR, 'uploads');
const EXPORT_DIR = process.env.EXPORT_DIR || path.join(DATA_DIR, 'exports');

const APP_PORT = parseIntEnv('APP_PORT', parseIntEnv('PORT', DEFAULT_PORT));
const NODE_ENV = process.env.NODE_ENV || DEFAULT_NODE_ENV;

export interface EnvConfig {
    readonly nodeEnv: string;
    readonly port: number;
    readonly dataDir: string;
    readonly dbPath: string;
    readonly uploadDir: string;
    readonly exportDir: string;
    readonly raw: NodeJS.ProcessEnv;
    get(key: string, fallback?: string): string | undefined;
}

export const env: EnvConfig = {
    nodeEnv: NODE_ENV,
    port: APP_PORT,
    dataDir: DATA_DIR,
    dbPath: DB_PATH,
    uploadDir: UPLOAD_DIR,
    exportDir: EXPORT_DIR,
    raw: process.env,
    get: (key: string, fallback?: string) => firstDefined(process.env[key], fallback)
};

export default env;
