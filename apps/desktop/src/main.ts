import { app, BrowserWindow } from 'electron';
import path from 'path';
import http from 'http';
import fs from 'fs';

function createWindow(url: string) {
    const win = new BrowserWindow({
        width: 1024,
        height: 768,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    win.loadURL(url);
}

async function waitForHealth(port: number, retries = 40, delayMs = 500): Promise<boolean> {
    function check(): Promise<boolean> {
        return new Promise((resolve) => {
            const req = http.get({ host: 'localhost', port, path: '/health', timeout: 2000 }, (res) => {
                const ok = res.statusCode === 200;
                res.resume();
                resolve(ok);
            });
            req.on('error', () => resolve(false));
            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });
        });
    }
    for (let i = 0; i < retries; i++) {
        const ok = await check();
        if (ok) return true;
        await new Promise((r) => setTimeout(r, delayMs));
    }
    return false;
}

function showErrorWindow(message: string) {
    const win = new BrowserWindow({ width: 720, height: 420 });
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Erro</title>
  <style>body{font-family:system-ui;padding:24px;background:#111;color:#eee} .card{background:#1b1b1b;padding:16px;border-radius:8px} code{background:#222;padding:2px 6px;border-radius:4px}</style>
  </head><body>
  <h2>Não foi possível iniciar o backend</h2>
  <div class="card">
    <p>${message}</p>
    <p>Verifique os logs do backend no console desta janela (prefixo <code>[api]</code>) e tente novamente.</p>
  </div>
  </body></html>`;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

let hasShownErrorWindow = false;
let backendReady = false;

// Ensure single instance to avoid multiple windows
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        const wins = BrowserWindow.getAllWindows();
        if (wins.length) wins[0].focus();
    });
}

app.whenReady().then(async () => {
    const isPackaged = app.isPackaged;

    const userData = app.getPath('userData');
    const dataDir = path.join(userData, 'data');
    const logsDir = path.join(userData, 'logs');

    // Fixed port (simplifies dev + packaged) per acceptance criteria
    const selectedPort = Number(process.env.APP_PORT || process.env.PORT || '3000') || 3000;

    const envForApi = {
        ...process.env,
        NODE_ENV: 'production',
        APP_PORT: String(selectedPort),
        DATA_DIR: dataDir,
        DB_PATH: path.join(dataDir, 'db', 'dev.sqlite3'),
        UPLOAD_DIR: path.join(dataDir, 'uploads'),
        EXPORT_DIR: path.join(dataDir, 'exports'),
    };

    console.log('[electron] userData:', userData);
    console.log('[electron] DATA_DIR:', dataDir);
    console.log('[electron] logsDir:', logsDir);
    console.log('[electron] APP_PORT:', envForApi.APP_PORT);
    console.log('[electron] envForApi (subset):', {
        APP_PORT: envForApi.APP_PORT,
        DATA_DIR: envForApi.DATA_DIR,
        DB_PATH: envForApi.DB_PATH,
    });

    // Ensure required directories exist before migrations/backend start
    try {
        fs.mkdirSync(dataDir, { recursive: true });
        fs.mkdirSync(path.dirname(envForApi.DB_PATH), { recursive: true });
        fs.mkdirSync(envForApi.UPLOAD_DIR, { recursive: true });
        fs.mkdirSync(envForApi.EXPORT_DIR, { recursive: true });
        fs.mkdirSync(logsDir, { recursive: true });
        // Write boot diagnostics
        const bootDiag = {
            when: new Date().toISOString(),
            selectedPort,
            userData,
            dataDir,
            logsDir,
            envForApi,
        };
        fs.writeFileSync(path.join(logsDir, 'backend-env.json'), JSON.stringify(bootDiag, null, 2));
    } catch (e) {
        console.error('[electron] Failed to create runtime directories:', e);
    }
    async function startBackendAndMigrations() {
        // Ensure env variables visible to imported modules
        Object.assign(process.env, envForApi);
        const baseApiPath = isPackaged
            ? path.join(process.resourcesPath, 'api', 'dist')
            : path.resolve(__dirname, '../../../apps/api/dist');
        const migrationsEntry = path.join(baseApiPath, 'runMigrations.js');
        const backendEntry = path.join(baseApiPath, 'server.js');
        console.log('[electron] Using migrations entry:', migrationsEntry);
        console.log('[electron] Using backend entry:', backendEntry);
        try {
            console.log('[electron] migrations starting...');
            await import(migrationsEntry); // file runs immediately
            console.log('[electron] migrations finished');
        } catch (err) {
            console.error('[electron] migrations failed', err);
            throw err;
        }
        try {
            console.log('[electron] backend starting...');
            await import(backendEntry);
            console.log('[electron] backend module loaded');
        } catch (err) {
            console.error('[electron] backend failed to start', err);
            throw err;
        }
    }

    try {
        await startBackendAndMigrations();
    } catch (err) {
        if (!hasShownErrorWindow) {
            hasShownErrorWindow = true;
            showErrorWindow('Falha ao iniciar backend/migrations. Verifique os logs.');
        }
        return;
    }

    // Quick health probe before opening window (optional)
    function probe(): Promise<boolean> {
        return new Promise((resolve) => {
            const req = http.get({ host: 'localhost', port: selectedPort, path: '/health', timeout: 1500 }, (res) => {
                res.resume();
                resolve(res.statusCode === 200);
            });
            req.on('error', () => resolve(false));
            req.on('timeout', () => { req.destroy(); resolve(false); });
        });
    }
    const healthy = await probe();
    backendReady = healthy;
    const targetUrl = `http://localhost:${selectedPort}`;
    if (healthy) {
        console.log('[electron] Backend healthy, opening UI at', targetUrl);
        createWindow(targetUrl);
    } else {
        console.warn('[electron] Health probe failed, opening UI anyway:', targetUrl);
        createWindow(targetUrl);
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0 && backendReady) {
            const url = `http://localhost:${selectedPort}`;
            createWindow(url);
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
