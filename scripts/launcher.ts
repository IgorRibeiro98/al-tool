#!/usr/bin/env node

import { spawn } from 'child_process';
import http from 'http';
import open from 'open';
import path from 'path';
const repoRoot = path.resolve(process.cwd());

const PORT = Number(process.env.APP_PORT || process.env.PORT || 3131);
const USE_ELECTRON = process.env.USE_ELECTRON === '1';
const MAX_RETRIES = 40; // ~20s se intervalo 500ms
const RETRY_DELAY_MS = 500;

function checkBackendReady(): Promise<boolean> {
    return new Promise((resolve) => {
        const req = http.get({ host: 'localhost', port: PORT, path: '/health', timeout: 2000 }, (res) => {
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

async function waitForBackend(): Promise<boolean> {
    for (let i = 0; i < MAX_RETRIES; i++) {
        const ready = await checkBackendReady();
        if (ready) return true;
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
    return false;
}

async function ensureBackendRunning(): Promise<{ alreadyRunning: boolean; child?: ReturnType<typeof spawn> }> {
    const already = await checkBackendReady();
    if (already) {
        console.log(`[launcher] Backend já está rodando em http://localhost:${PORT}`);
        return { alreadyRunning: true };
    }

    console.log('[launcher] Iniciando backend...');
    const child = spawn('npm', ['run', 'app:local'], {
        cwd: repoRoot,
        stdio: 'inherit',
        shell: false,
    });

    child.on('exit', (code) => {
        if (code !== null && code !== 0) {
            console.error(`[launcher] Backend finalizou com código ${code}`);
        }
    });

    const ready = await waitForBackend();
    if (!ready) {
        console.error('[launcher] Backend não ficou pronto dentro do tempo limite.');
    }

    return { alreadyRunning: false, child };
}

async function openUi() {
    const url = `http://localhost:${PORT}`;

    if (USE_ELECTRON) {
        console.log('[launcher] Abrindo UI via Electron...');
        const desktopDir = path.join(repoRoot, 'apps', 'desktop');
        const child = spawn('npm', ['run', 'electron:dev'], {
            cwd: desktopDir,
            stdio: 'inherit',
            shell: false,
        });

        child.on('exit', (code) => {
            if (code !== null && code !== 0) {
                console.error(`[launcher] Electron finalizou com código ${code}`);
            }
        });
    } else {
        console.log('[launcher] Abrindo UI no navegador padrão...');
        await open(url);
    }
}

async function main() {
    try {
        await ensureBackendRunning();
        await openUi();
    } catch (err) {
        console.error('[launcher] Erro inesperado:', err);
        process.exit(1);
    }
}

main();
