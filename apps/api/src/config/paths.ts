import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Carrega variáveis de ambiente (apps/api/.env e raiz) antes de determinar caminhos
const envFiles = [
    path.resolve(__dirname, '..', '..', '.env'), // apps/api/.env
    path.resolve(__dirname, '..', '..', '..', '..', '.env') // raiz do monorepo
];
for (const file of envFiles) {
    if (fs.existsSync(file)) {
        dotenv.config({ path: file, override: false });
    }
}

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

function resolveDataDir(raw?: string) {
    if (!raw || raw.trim() === '') {
        return path.join(repoRoot, 'storage');
    }
    return path.isAbsolute(raw) ? raw : path.resolve(repoRoot, raw);
}

// Raiz lógica de dados da aplicação (pode ser sobrescrita por APP_DATA_DIR)
export const DATA_DIR = resolveDataDir(process.env.APP_DATA_DIR);

export const DB_PATH = path.join(DATA_DIR, 'db', 'dev.sqlite3');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const EXPORT_DIR = path.join(DATA_DIR, 'exports');
export const INGEST_DIR = path.join(DATA_DIR, 'ingests');

export function ensureDataDirs() {
    const dirs = [
        path.dirname(DB_PATH),
        UPLOAD_DIR,
        EXPORT_DIR,
        INGEST_DIR,
    ];

    for (const dir of dirs) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
}
