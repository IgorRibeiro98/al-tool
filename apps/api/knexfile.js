/**
 * Knex configuration for SQLite (development)
 * Garante que migrations e runtime usem o mesmo diretório de dados (storage/db por padrão).
 */
const fs = require('fs');
const path = require('path');

// Carrega variáveis de ambiente (apps/api/.env e raiz, se existirem)
const localEnv = path.resolve(__dirname, '.env');
if (fs.existsSync(localEnv)) {
    require('dotenv').config({ path: localEnv });
}
const rootEnv = path.resolve(__dirname, '..', '..', '.env');
if (fs.existsSync(rootEnv)) {
    require('dotenv').config({ path: rootEnv });
}

// APP_DATA_DIR aponta para a raiz dos dados (padrão: ../../storage)
const dataDir = process.env.APP_DATA_DIR
    ? path.resolve(__dirname, process.env.APP_DATA_DIR)
    : path.resolve(__dirname, '..', '..', 'storage');
const dbDir = path.join(dataDir, 'db');

if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

module.exports = {
    development: {
        client: 'better-sqlite3',
        connection: {
            filename: path.join(dbDir, 'dev.sqlite3')
        },
        useNullAsDefault: true,
        migrations: {
            // project keeps migrations under src/migrations — point knex there
            directory: path.resolve(__dirname, './migrations')
        }
    }
};
