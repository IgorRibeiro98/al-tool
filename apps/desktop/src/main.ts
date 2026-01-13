import { app, BrowserWindow } from 'electron';
import path from 'path';
import http from 'http';
import fs from 'fs';
import dotenv from 'dotenv';
import { spawn, ChildProcess, execFileSync } from 'child_process';
import Module from 'module';
import { createLicensingService } from './main/services/licensingService';

// ============================================================================
// PERFORMANCE OPTIMIZATIONS - V8/Chromium flags for better memory handling
// ============================================================================
// Increase V8 heap size for handling large datasets (default is ~512MB, we want 4GB+)
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');
// Disable GPU acceleration if it causes issues (uncomment if needed)
// app.commandLine.appendSwitch('disable-gpu');
// Reduce renderer process overhead
app.commandLine.appendSwitch('disable-renderer-backgrounding');
// Allow more memory for large file processing
app.commandLine.appendSwitch('max-active-webgl-contexts', '16');
// Disable throttling of background tabs (important for long operations)
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// ============================================================================

// Constants
const DEFAULT_WINDOW_WIDTH = 1024;
const DEFAULT_WINDOW_HEIGHT = 768;
const DEFAULT_HEALTH_RETRIES = 40;
const DEFAULT_HEALTH_DELAY_MS = 500;
const HEALTH_TIMEOUT_MS = 2000;

function loadEnvFiles(): void {
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
}

loadEnvFiles();

function createWindow(url: string, opts?: { width?: number; height?: number }) {
    const win = new BrowserWindow({
        width: opts?.width ?? DEFAULT_WINDOW_WIDTH,
        height: opts?.height ?? DEFAULT_WINDOW_HEIGHT,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    win.loadURL(url);
}

async function waitForHealth(port: number, retries = DEFAULT_HEALTH_RETRIES, delayMs = DEFAULT_HEALTH_DELAY_MS): Promise<boolean> {
    function check(): Promise<boolean> {
        return new Promise((resolve) => {
            const req = http.get({ host: 'localhost', port, path: '/health', timeout: HEALTH_TIMEOUT_MS }, (res) => {
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

    function ensureRuntimeDirectories(): void {
        try {
            fs.mkdirSync(dataDir, { recursive: true });
            fs.mkdirSync(path.dirname(envForApi.DB_PATH!), { recursive: true });
            fs.mkdirSync(envForApi.UPLOAD_DIR!, { recursive: true });
            fs.mkdirSync(envForApi.EXPORT_DIR!, { recursive: true });
            fs.mkdirSync(envForApi.INGESTS_DIR!, { recursive: true });
            fs.mkdirSync(logsDir, { recursive: true });
        } catch (e) {
            console.error('[electron] Failed to create runtime directories:', e);
        }
    }

    function writeBootDiagnostics() {
        try {
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
            console.error('[electron] Failed to write boot diagnostics:', e);
        }
    }

    ensureRuntimeDirectories();
    writeBootDiagnostics();
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

    // Validate embedded Python runtime (only for packaged apps). If invalid,
    // show a clear error and abort startup so the user gets actionable feedback.
    const runtimeOk = validateEmbeddedRuntime(isPackaged);
    if (!runtimeOk) {
        console.error('[electron] Embedded Python runtime validation failed; aborting startup');
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

    const devPythonBase = path.join(repoRoot, 'apps', 'desktop', 'python-runtime');
    const pythonBaseDir = isPackaged ? platformRuntimeBase() : devPythonBase;
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
    // In packaged apps we DO NOT allow using the system Python installed
    // on the user's machine. Only the embedded runtime under
    // `process.resourcesPath` (if present) or a PYTHON_EXECUTABLE that
    // resolves inside resources is allowed. This prevents attempts to
    // execute a Python binary that exists only on the build machine.
    const allowSystemPython = !isPackaged;

    // Respect PYTHON_EXECUTABLE in development, but when packaged ignore
    // absolute paths that point to the build machine (they won't exist
    // on target users). Allow packaged apps to use an embedded runtime
    // under `process.resourcesPath` only.
    const envPython = process.env.PYTHON_EXECUTABLE;
    if (envPython) {
        try {
            const isAbsolute = path.isAbsolute(envPython);
            const resourcesRoot = path.resolve(process.resourcesPath || '');
            if (isPackaged) {
                // In packaged apps we only accept PYTHON_EXECUTABLE when it points
                // into the app resources (i.e. the embedded runtime) or when it
                // resolves to an existing file. This prevents absolute paths from
                // the build machine being used on end-user systems.
                if (isAbsolute) {
                    const resolved = path.resolve(envPython);
                    if (resourcesRoot && resolved.startsWith(resourcesRoot) && fs.existsSync(resolved)) {
                        candidates.push(resolved);
                    } else {
                        console.warn('[electron] Ignoring absolute PYTHON_EXECUTABLE from .env in packaged app (outside resources or missing):', envPython);
                    }
                } else {
                    // Relative paths: resolve relative to resourcesPath and accept if exists
                    const resolvedRel = path.join(resourcesRoot, envPython);
                    if (fs.existsSync(resolvedRel)) {
                        candidates.push(resolvedRel);
                    } else {
                        console.warn('[electron] Ignoring relative PYTHON_EXECUTABLE from .env in packaged app (not found under resources):', envPython, '->', resolvedRel);
                    }
                }
            } else {
                // Development: honor whatever the developer set (absolute or bare)
                candidates.push(envPython);
            }
        } catch (err) {
            // If anything goes wrong parsing paths, don't fall back to a
            // build-machine absolute PYTHON_EXECUTABLE when running packaged
            // (it would be unsafe). In development, fall back to the env var
            // to keep DX smooth.
            if (!isPackaged) {
                candidates.push(envPython);
            } else {
                console.warn('[electron] Ignoring PYTHON_EXECUTABLE due to path parse error in packaged app', err);
            }
        }
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
        const base = platformRuntimeBase();
        const binDir = process.platform === 'win32' ? '' : 'bin';
        const binNames = process.platform === 'win32' ? ['python.exe'] : ['python3', 'python'];

        for (const name of binNames) {
            candidates.push(path.join(base, binDir, name));
            candidates.push(path.join(base, name));
        }
        // Fallback: also try generic resources/python if platform-specific dir was used
        const generic = path.join(process.resourcesPath || '', 'python');
        if (generic !== base) {
            for (const name of binNames) {
                candidates.push(path.join(generic, binDir, name));
                candidates.push(path.join(generic, name));
            }
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

/**
 * Prefer a platform-specific runtime directory inside `process.resourcesPath`.
 * Returns a path under resources (e.g. resources/python-win, resources/python-linux)
 * falling back to resources/python.
 */
function platformRuntimeBase(): string {
    const resourcesRoot = process.resourcesPath || '';
    if (!resourcesRoot) return path.join('resources', 'python');
    const platformDir = process.platform === 'win32' ? 'python-win' : 'python-linux';
    const platformPath = path.join(resourcesRoot, platformDir);
    if (fs.existsSync(platformPath)) return platformPath;
    const generic = path.join(resourcesRoot, 'python');
    return generic;
}

/**
 * Validate the bundled Python runtime under `process.resourcesPath/python`.
 * When the app is packaged we require a relocatable runtime; this function
 * checks common locations for the Python executable and for site-packages.
 * If validation fails it will show an error window with actionable steps.
 */
function validateEmbeddedRuntime(isPackaged: boolean): boolean {
    if (!isPackaged) return true;

    const base = platformRuntimeBase();
    const missing: string[] = [];

    if (!base || !fs.existsSync(base)) {
        missing.push(`embedded runtime directory not found: ${base}`);
    } else {
        // Check for python executable and perform lightweight validation
        const exeCandidates = process.platform === 'win32'
            ? [path.join(base, 'python.exe'), path.join(base, 'Scripts', 'python.exe')]
            : [path.join(base, 'bin', 'python3'), path.join(base, 'bin', 'python')];
        let foundExe: string | undefined;
        for (const c of exeCandidates) {
            try {
                if (fs.existsSync(c)) { foundExe = c; break; }
            } catch { }
        }
        if (!foundExe) {
            missing.push(`python executable not found under ${base} (expected ${exeCandidates.join(', ')})`);
        } else {
            // On Unix ensure executable bit and run quick version check
            if (process.platform !== 'win32') {
                try {
                    fs.chmodSync(foundExe, 0o755);
                } catch (e) {
                    // best-effort; continue
                    console.warn('[electron] Could not chmod embedded python:', e);
                }
            }
            try {
                const out = execFileSync(foundExe, ['-c', "import sys, json; print(json.dumps(tuple(sys.version_info[:3])))"], { encoding: 'utf8', timeout: 2000 });
                // quick sanity: must print something
                if (!out || !out.trim()) {
                    missing.push('embedded python failed quick version check');
                }
            } catch (e) {
                console.warn('[electron] Embedded python quick check failed:', e);
                missing.push('embedded python failed to run quick version check');
            }
        }

        // Check for site-packages
        const siteCandidates: string[] = [];
        // venv-like unix layout
        siteCandidates.push(path.join(base, 'lib'));
        // windows venv layout
        siteCandidates.push(path.join(base, 'Lib', 'site-packages'));
        // embeddable suggested location
        siteCandidates.push(path.join(base, 'Lib'));

        let hasSite = false;
        // If lib contains python3.x directory -> check its site-packages
        try {
            const libDir = path.join(base, 'lib');
            if (fs.existsSync(libDir)) {
                const entries = fs.readdirSync(libDir, { withFileTypes: true });
                for (const e of entries) {
                    if (e.isDirectory() && e.name.startsWith('python3')) {
                        const sp = path.join(libDir, e.name, 'site-packages');
                        if (fs.existsSync(sp)) {
                            hasSite = true;
                            break;
                        }
                    }
                }
            }
        } catch (e) {
            // ignore and continue
        }

        if (!hasSite) {
            for (const cand of siteCandidates) {
                if (fs.existsSync(cand) && fs.lstatSync(cand).isDirectory()) {
                    hasSite = true;
                    break;
                }
            }
        }

        if (!hasSite) {
            missing.push(`site-packages not found under ${base} (checked common locations)`);
        }
    }

    if (missing.length) {
        const message = `O runtime Python empacotado está inválido:\n\n- ${missing.join('\n- ')}\n\nSoluções sugeridas:\n- Recrie o runtime antes de empacotar: execute \`npm run python:setup\` no build machine.\n- Se estiver em desenvolvimento, defina \`ALLOW_SYSTEM_PYTHON=1\` para permitir o Python do sistema (não recomendado para instaladores).`;
        console.error('[electron] Embedded runtime validation errors:', missing);
        if (!hasShownErrorWindow) {
            hasShownErrorWindow = true;
            showErrorWindow(message);
        }
        return false;
    }

    return true;
}
