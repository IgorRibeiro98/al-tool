import path from 'path';
import dotenv from 'dotenv';

// Carrega sempre o apps/api/.env independentemente do cwd (dist -> ../.env)
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Harmoniza variáveis legadas do .env raiz
// Causa raiz: .env usa APP_DATA_DIR, enquanto a API lê DATA_DIR.
// Solução: mapear APP_* para nomes esperados quando não definidos.
if (!process.env.DATA_DIR && process.env.APP_DATA_DIR) {
    process.env.DATA_DIR = process.env.APP_DATA_DIR;
}
if (!process.env.DB_PATH && process.env.DB_PATH) {
    // DB_PATH já existe no .env raiz; manter
}
if (!process.env.UPLOAD_DIR && process.env.UPLOAD_DIR) {
    // UPLOAD_DIR já existe no .env raiz; manter
}
if (!process.env.EXPORT_DIR && process.env.EXPORT_DIR) {
    // EXPORT_DIR já existe no .env raiz; manter
}

// Também harmoniza porta
if (!process.env.APP_PORT && process.env.PORT) {
    process.env.APP_PORT = process.env.PORT;
}

export { };
