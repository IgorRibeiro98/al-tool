import { app, BrowserWindow } from 'electron';
import path from 'path';
import http from 'http';
import fs from 'fs';
import dotenv from 'dotenv';
import { spawn, ChildProcess } from 'child_process';

// ============================================================================
// AL-Tool v2 — o shell Electron faz spawn do SIDECAR Python (FastAPI + DuckDB).
// O backend inteiro (ingestão, conciliação, atribuição, export, licença) vive no
// sidecar; o React é servido/consumido via HTTP em localhost:APP_PORT, como na v1.
// ============================================================================

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const DEFAULT_WINDOW_WIDTH = 1024;
const DEFAULT_WINDOW_HEIGHT = 768;
const HEALTH_RETRIES = 60;
const HEALTH_DELAY_MS = 500;
const HEALTH_TIMEOUT_MS = 2000;

function loadEnvFiles(): void {
    const rootEnvPath = path.resolve(__dirname, '../../../.env');
    const packagedEnvPath = path.join(process.resourcesPath || '', '.env');
    [packagedEnvPath, rootEnvPath].forEach((envPath) => {
        try {
            if (envPath && fs.existsSync(envPath)) dotenv.config({ path: envPath });
        } catch (err) {
            console.warn('[electron] Failed to load env file', envPath, err);
        }
    });
}

loadEnvFiles();

function createWindow(url: string) {
    const win = new BrowserWindow({
        width: DEFAULT_WINDOW_WIDTH,
        height: DEFAULT_WINDOW_HEIGHT,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    win.loadURL(url);
}

async function waitForHealth(port: number): Promise<boolean> {
    const check = (): Promise<boolean> =>
        new Promise((resolve) => {
            const req = http.get(
                { host: '127.0.0.1', port, path: '/health', timeout: HEALTH_TIMEOUT_MS },
                (res) => { const ok = res.statusCode === 200; res.resume(); resolve(ok); },
            );
            req.on('error', () => resolve(false));
            req.on('timeout', () => { req.destroy(); resolve(false); });
        });
    for (let i = 0; i < HEALTH_RETRIES; i++) {
        if (await check()) return true;
        await new Promise((r) => setTimeout(r, HEALTH_DELAY_MS));
    }
    return false;
}

function showErrorWindow(message: string) {
    const win = new BrowserWindow({ width: 720, height: 420 });
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Erro</title>
  <style>body{font-family:system-ui;padding:24px;background:#111;color:#eee}.card{background:#1b1b1b;padding:16px;border-radius:8px}code{background:#222;padding:2px 6px;border-radius:4px}</style>
  </head><body><h2>Não foi possível iniciar o backend</h2>
  <div class="card"><p>${message}</p>
  <p>Verifique <code>logs/sidecar.log</code> em userData.</p></div></body></html>`;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

let hasShownErrorWindow = false;
let backendReady = false;
let sidecar: ChildProcess | null = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        const wins = BrowserWindow.getAllWindows();
        if (wins.length) wins[0].focus();
    });
}

/**
 * Resolve o comando do sidecar:
 * - dev: o Python do venv em backend/.venv rodando `-m altool.main` (PYTHONPATH=backend/src);
 * - packaged: o binário PyInstaller embarcado em resources/altool-sidecar/.
 */
function resolveSidecar(isPackaged: boolean, repoRoot: string): { command: string; args: string[]; extraEnv: Record<string, string> } {
    if (isPackaged) {
        const exe = process.platform === 'win32' ? 'altool-sidecar.exe' : 'altool-sidecar';
        const bin = path.join(process.resourcesPath, 'altool-sidecar', exe);
        return { command: bin, args: [], extraEnv: {} };
    }
    const venvPython = process.platform === 'win32'
        ? path.join(repoRoot, 'backend', '.venv', 'Scripts', 'python.exe')
        : path.join(repoRoot, 'backend', '.venv', 'bin', 'python3');
    return {
        command: venvPython,
        args: ['-m', 'altool.main'],
        extraEnv: { PYTHONPATH: path.join(repoRoot, 'backend', 'src') },
    };
}

function startSidecar(envForApi: Record<string, string | undefined>, logsDir: string, isPackaged: boolean): boolean {
    const repoRoot = path.resolve(__dirname, '../../..');
    const { command, args, extraEnv } = resolveSidecar(isPackaged, repoRoot);
    if (!command || !fs.existsSync(command)) {
        console.error('[electron] sidecar não encontrado:', command);
        return false;
    }
    const env = {
        ...envForApi,
        ...extraEnv,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
    } as NodeJS.ProcessEnv;

    const logStream = fs.createWriteStream(path.join(logsDir, 'sidecar.log'), { flags: 'a' });
    console.log('[electron] Iniciando sidecar:', command, args.join(' '));
    sidecar = spawn(command, args, { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
    sidecar.stdout?.on('data', (c) => { const t = c.toString(); process.stdout.write(`[sidecar] ${t}`); logStream.write(t); });
    sidecar.stderr?.on('data', (c) => { const t = c.toString(); process.stderr.write(`[sidecar] ${t}`); logStream.write(t); });
    sidecar.on('exit', (code, signal) => { logStream.write(`[EXIT] code=${code} signal=${signal}\n`); logStream.end(); sidecar = null; });
    sidecar.on('error', (err) => { console.error('[electron] falha ao spawnar sidecar', err); logStream.write(`[ERROR] ${err?.stack || err}\n`); logStream.end(); });
    return true;
}

app.whenReady().then(async () => {
    const isPackaged = app.isPackaged;
    const userData = app.getPath('userData');
    const dataDir = path.join(userData, 'data');
    const logsDir = path.join(userData, 'logs');
    const selectedPort = Number(process.env.APP_PORT || process.env.PORT || '3000') || 3000;

    const repoRoot = path.resolve(__dirname, '../../..');
    const clientDist = isPackaged
        ? path.join(process.resourcesPath, 'client', 'dist')
        : path.join(repoRoot, 'apps', 'client', 'dist');

    const envForApi: Record<string, string | undefined> = {
        ...process.env,
        APP_PORT: String(selectedPort),
        DATA_DIR: dataDir,
        DB_PATH: path.join(dataDir, 'db', 'altool.duckdb'),          // DuckDB (dados)
        METADATA_DB_PATH: path.join(dataDir, 'db', 'altool.sqlite'), // SQLite (metadados)
        UPLOAD_DIR: path.join(dataDir, 'uploads'),
        EXPORT_DIR: path.join(dataDir, 'exports'),
        INGESTS_DIR: path.join(dataDir, 'ingests'),
        CLIENT_DIST: clientDist,                                     // SPA servido pelo sidecar
    };

    try {
        fs.mkdirSync(path.join(dataDir, 'db'), { recursive: true });
        fs.mkdirSync(envForApi.UPLOAD_DIR!, { recursive: true });
        fs.mkdirSync(envForApi.EXPORT_DIR!, { recursive: true });
        fs.mkdirSync(envForApi.INGESTS_DIR!, { recursive: true });
        fs.mkdirSync(logsDir, { recursive: true });
    } catch (e) {
        console.error('[electron] Failed to create runtime directories:', e);
    }

    console.log('[electron] userData:', userData, '| APP_PORT:', selectedPort);

    if (!startSidecar(envForApi, logsDir, isPackaged)) {
        if (!hasShownErrorWindow) { hasShownErrorWindow = true; showErrorWindow('Sidecar Python não encontrado. Em dev, rode: cd backend && python3 -m venv .venv && pip install -e .'); }
        return;
    }

    const healthy = await waitForHealth(selectedPort);
    backendReady = healthy;
    const targetUrl = `http://localhost:${selectedPort}`;
    if (!healthy) {
        console.warn('[electron] sidecar não respondeu /health; abrindo UI mesmo assim');
    }
    // O LicenseGate do React roteia para /license quando a licença não está ativa.
    createWindow(targetUrl);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0 && backendReady) createWindow(targetUrl);
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
    if (sidecar) { sidecar.kill(); sidecar = null; }
});
