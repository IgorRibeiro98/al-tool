import { app, BrowserWindow } from 'electron';
import path from 'path';
import http from 'http';
import fs from 'fs';
import dotenv from 'dotenv';
import { spawn, ChildProcess } from 'child_process';
import Module from 'module';
import { createLicensingService } from './main/services/licensingService';

// Load .env from both dev (repo root) and packaged (resources) locations so licensing variables exist in prod
const rootEnvPath = path.resolve(__dirname, '../../.env');
const packagedEnvPath = path.join(process.resourcesPath || '', '.env');
const envCandidates = [packagedEnvPath, rootEnvPath];
envCandidates.forEach((envPath) => {
    try {
        if (envPath && fs.existsSync(envPath)) {
            dotenv.config({ path: envPath });
        }
    } catch (err) {
        console.warn('[electron] Failed to load env file', envPath, err);
    }
});

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
let pythonWorker: ChildProcess | null = null;

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

    const envForApi: Record<string, string | undefined> = {
        ...process.env,
        NODE_ENV: 'production',
        APP_PORT: String(selectedPort),
        DATA_DIR: dataDir,
        DB_PATH: path.join(dataDir, 'db', 'dev.sqlite3'),
        UPLOAD_DIR: path.join(dataDir, 'uploads'),
        EXPORT_DIR: path.join(dataDir, 'exports'),
        INGESTS_DIR: path.join(dataDir, 'ingests'),
    };

    const licensingService = createLicensingService(envForApi.DB_PATH);

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
        fs.mkdirSync(path.dirname(envForApi.DB_PATH!), { recursive: true });
        fs.mkdirSync(envForApi.UPLOAD_DIR!, { recursive: true });
        fs.mkdirSync(envForApi.EXPORT_DIR!, { recursive: true });
        fs.mkdirSync(envForApi.INGESTS_DIR!, { recursive: true });
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
        const apiNodeModules = path.join(baseApiPath, 'node_modules');
        const apiRootNodeModules = path.join(process.resourcesPath, 'api', 'node_modules');
        const resourcesNodeModules = path.join(process.resourcesPath, 'node_modules');
        const asarNodeModules = path.join(process.resourcesPath, 'app.asar', 'node_modules');
        const nodePathEntries = [apiNodeModules, apiRootNodeModules, resourcesNodeModules, asarNodeModules, process.env.NODE_PATH || '']
            .filter(Boolean);
        process.env.NODE_PATH = nodePathEntries.join(path.delimiter);
        // Recompute module resolution paths after updating NODE_PATH so API dist can resolve deps like knex
        (Module as any)._initPaths();
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

    startPythonConversionWorker({
        isPackaged,
        envForApi,
        logsDir,
    });

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
        console.log('[electron] Backend healthy, running license validation');
        try {
            // Ensure local validation/refresh runs before showing UI
            await licensingService.validateIfNeeded();
        } catch (err) {
            console.warn('[electron] Licensing validateIfNeeded failed', err);
        }

        // Read status and choose which UI route to open
        try {
            const status = await licensingService.getStatus();
            const isActive = (status && (status as any).status === 'active');
            if (isActive) {
                console.log('[electron] License active, opening main UI at', targetUrl);
                createWindow(targetUrl);
            } else {
                const licenseUrl = `${targetUrl}/license`;
                console.log('[electron] License not active, opening license UI at', licenseUrl);
                createWindow(licenseUrl);
            }
        } catch (err) {
            console.error('[electron] Failed to determine license status, opening main UI', err);
            createWindow(targetUrl);
        }
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

app.on('before-quit', () => {
    if (pythonWorker) {
        pythonWorker.kill();
        pythonWorker = null;
    }
});

function startPythonConversionWorker({ isPackaged, envForApi, logsDir }: { isPackaged: boolean; envForApi: Record<string, string | undefined>; logsDir: string; }) {
    const repoRoot = path.resolve(__dirname, '../../..');
    const scriptsDir = isPackaged
        ? path.join(process.resourcesPath, 'scripts')
        : path.join(repoRoot, 'scripts');
    const workerScript = path.join(scriptsDir, 'conversion_worker.py');
    if (!fs.existsSync(workerScript)) {
        console.warn('[electron] conversion_worker.py não encontrado em', workerScript);
        return;
    }

    const devPythonBase = process.platform === 'win32'
        ? path.join(repoRoot, 'apps', 'desktop', 'python-runtime')
        : path.join(repoRoot, 'apps', 'desktop', 'python-runtime');
    const pythonBaseDir = isPackaged
        ? path.join(process.resourcesPath, process.platform === 'win32' ? 'python' : 'python')
        : devPythonBase;
    const pythonExec = resolvePythonExecutable(isPackaged, pythonBaseDir);
    if (!pythonExec) {
        console.error('[electron] Python executable not found; conversion worker will not start');
        console.error('[electron] On Windows packaged builds, bundle python-runtime-win (Python embeddable + deps) under apps/desktop/python-runtime-win');
        console.error('[electron] Alternatively set ALLOW_SYSTEM_PYTHON=1 and ensure python.exe is on PATH');
        return;
    }
    const pollSeconds = process.env.WORKER_POLL_SECONDS || '5';
    const sitePackages = pythonBaseDir ? findEmbeddedSitePackages(pythonBaseDir) : undefined;
    const pythonEnv = {
        ...envForApi,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
        POLL_INTERVAL: pollSeconds,
        INGESTS_DIR: envForApi.INGESTS_DIR,
        REPO_ROOT: repoRoot,
        PYTHON_EXECUTABLE: pythonExec,
    } as NodeJS.ProcessEnv;

    if (pythonBaseDir && fs.existsSync(pythonBaseDir)) {
        pythonEnv.VIRTUAL_ENV = pythonBaseDir;
        const binDir = process.platform === 'win32' ? 'Scripts' : 'bin';
        pythonEnv.PATH = [path.join(pythonBaseDir, binDir), process.env.PATH || ''].filter(Boolean).join(path.delimiter);
    }
    if (sitePackages) {
        pythonEnv.PYTHONPATH = [sitePackages, process.env.PYTHONPATH || '', pythonEnv.PYTHONPATH || ''].filter(Boolean).join(path.delimiter);
    }

    const cwd = isPackaged ? process.resourcesPath : repoRoot;
    const logPath = path.join(logsDir, 'conversion-worker.log');
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });

    console.log('[electron] Starting Python conversion worker using', pythonExec, 'script', workerScript);
    pythonWorker = spawn(pythonExec, [workerScript], {
        cwd,
        env: pythonEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    pythonWorker.stdout?.on('data', (chunk) => {
        const text = chunk.toString();
        process.stdout.write(`[py-conversion] ${text}`);
        logStream.write(`[STDOUT] ${text}`);
    });
    pythonWorker.stderr?.on('data', (chunk) => {
        const text = chunk.toString();
        process.stderr.write(`[py-conversion] ${text}`);
        logStream.write(`[STDERR] ${text}`);
    });
    pythonWorker.on('exit', (code, signal) => {
        logStream.write(`[EXIT] code=${code} signal=${signal}\n`);
        logStream.end();
        pythonWorker = null;
        console.log('[electron] Python conversion worker exited', { code, signal });
    });
    pythonWorker.on('error', (err) => {
        logStream.write(`[ERROR] ${err?.stack || err}\n`);
        console.error('[electron] Failed to start python worker', err);
        logStream.end();
    });
}

function resolvePythonExecutable(isPackaged: boolean, pythonBaseDir?: string): string {
    const candidates: string[] = [];
    const allowSystemPython = !isPackaged || process.env.ALLOW_SYSTEM_PYTHON === '1';
    if (process.env.PYTHON_EXECUTABLE) {
        candidates.push(process.env.PYTHON_EXECUTABLE);
    }

    if (pythonBaseDir && fs.existsSync(pythonBaseDir)) {
        const binDir = process.platform === 'win32' ? 'Scripts' : 'bin';
        const binNames = process.platform === 'win32' ? ['python.exe'] : ['python3', 'python'];
        for (const name of binNames) {
            candidates.push(path.join(pythonBaseDir, binDir, name));
            candidates.push(path.join(pythonBaseDir, name));
        }
    }

    if (isPackaged) {
        const binDirWin = '';
        const binDirNix = 'bin';
        const baseWin = path.join(process.resourcesPath, 'python');
        const baseNix = path.join(process.resourcesPath, 'python');
        const binNamesWin = ['python.exe'];
        const binNamesNix = ['python3', 'python'];

        // Prefer platform-specific embedded runtime
        if (process.platform === 'win32') {
            for (const name of binNamesWin) {
                candidates.push(path.join(baseWin, binDirWin, name));
                candidates.push(path.join(baseWin, name));
            }
        } else {
            for (const name of binNamesNix) {
                candidates.push(path.join(baseNix, binDirNix, name));
                candidates.push(path.join(baseNix, name));
            }
        }

        // As a fallback (if someone packaged only one runtime), include both bases
        for (const name of binNamesWin) {
            candidates.push(path.join(baseWin, binDirWin, name));
            candidates.push(path.join(baseWin, name));
        }
        for (const name of binNamesNix) {
            candidates.push(path.join(baseNix, binDirNix, name));
            candidates.push(path.join(baseNix, name));
        }
    }

    const defaultBins = process.platform === 'win32' ? ['python.exe', 'python'] : ['python3', 'python'];
    if (allowSystemPython) {
        candidates.push(...defaultBins);
    }

    for (const candidate of candidates) {
        if (!candidate) continue;
        try {
            if (!candidate.includes(path.sep)) {
                // bare command; keep as last resort if nothing else exists
                continue;
            }
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        } catch {
            continue;
        }
    }

    // If system Python is allowed, fallback to bare commands; otherwise fail (return empty)
    if (allowSystemPython) {
        const bare = defaultBins.find((bin) => !!bin);
        return bare || '';
    }

    return '';
}

function findEmbeddedSitePackages(pythonBaseDir: string): string | undefined {
    try {
        // Unix-like venv layout: lib/python3.x/site-packages
        const libDirUnix = path.join(pythonBaseDir, 'lib');
        if (fs.existsSync(libDirUnix)) {
            const entries = fs.readdirSync(libDirUnix, { withFileTypes: true });
            const pyDir = entries.find((entry) => entry.isDirectory() && entry.name.startsWith('python3'));
            if (pyDir) {
                const sitePackages = path.join(libDirUnix, pyDir.name, 'site-packages');
                if (fs.existsSync(sitePackages)) {
                    return sitePackages;
                }
            }
        }

        // Windows venv layout: Lib/site-packages
        const libDirWin = path.join(pythonBaseDir, 'Lib', 'site-packages');
        if (fs.existsSync(libDirWin)) {
            return libDirWin;
        }
    } catch (err) {
        console.warn('[electron] Failed to locate embedded site-packages', err);
    }
    return undefined;
}
