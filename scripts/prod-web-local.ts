#!/usr/bin/env ts-node

import { spawn, ChildProcess } from 'child_process';
import http from 'http';
import open from 'open';
import path from 'path';

const repoRoot = path.resolve(process.cwd());
const PORT = Number(process.env.APP_PORT || process.env.PORT || 3131);
const USE_ELECTRON = process.env.USE_ELECTRON === '1';
const SKIP_BUILD = process.env.SKIP_BUILD === '1';
const SKIP_UI = process.env.NO_UI === '1';
const MAX_RETRIES = 60;
const RETRY_DELAY_MS = 500;

function runCommand(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env,
            stdio: 'inherit',
            shell: false,
        });

        child.on('exit', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
            }
        });

        child.on('error', reject);
    });
}

async function buildArtifacts(): Promise<void> {
    if (SKIP_BUILD) {
        console.log('[prod-web-local] Pulando build completo (SKIP_BUILD=1). Certifique-se de que dist/ está atualizado.');
        return;
    }
    console.log('[prod-web-local] Executando npm run build:prod...');
    await runCommand('npm', ['run', 'build:prod'], { cwd: repoRoot });
}

function startBackend(): ChildProcess {
    console.log('[prod-web-local] Iniciando backend em modo produção...');
    const env = {
        ...process.env,
        NODE_ENV: 'production',
        APP_PORT: String(PORT),
    };

    const child = spawn('npm', ['--workspace=apps/api', 'start'], {
        cwd: repoRoot,
        env,
        stdio: 'inherit',
        shell: false,
    });

    child.on('exit', (code) => {
        console.log(`[prod-web-local] Backend finalizado (code=${code ?? 'null'}).`);
    });

    child.on('error', (err) => {
        console.error('[prod-web-local] Erro ao iniciar backend:', err);
    });

    return child;
}

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

function startElectron(): ChildProcess {
    console.log('[prod-web-local] Abrindo UI via Electron...');
    const desktopDir = path.join(repoRoot, 'apps', 'desktop');
    const child = spawn('npm', ['run', 'electron:dev'], {
        cwd: desktopDir,
        stdio: 'inherit',
        shell: false,
    });
    child.on('exit', (code) => {
        if (code && code !== 0) {
            console.error(`[prod-web-local] Electron finalizou com código ${code}`);
        }
    });
    child.on('error', (err) => {
        console.error('[prod-web-local] Erro ao abrir Electron:', err);
    });
    return child;
}

async function openUi(): Promise<ChildProcess | undefined> {
    const url = `http://localhost:${PORT}`;
    if (SKIP_UI) {
        console.log('[prod-web-local] NO_UI=1 definido; não abrirei nenhum shell gráfico.');
        console.log(`[prod-web-local] Acesse manualmente ${url}`);
        return undefined;
    }
    if (USE_ELECTRON) {
        return startElectron();
    }
    console.log('[prod-web-local] Abrindo UI no navegador padrão...');
    await open(url);
    return undefined;
}

function setupSignalForward(back?: ChildProcess, electron?: ChildProcess) {
    const shutdown = () => {
        console.log('\n[prod-web-local] Encerrando processos...');
        if (electron && !electron.killed) {
            electron.kill('SIGINT');
        }
        if (back && !back.killed) {
            back.kill('SIGINT');
        }
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

async function main() {
    try {
        await buildArtifacts();
        const backend = startBackend();
        const ready = await waitForBackend();
        if (!ready) {
            console.error('[prod-web-local] Backend não respondeu /health a tempo. Encerrando.');
            backend.kill('SIGINT');
            process.exit(1);
        }
        console.log(`[prod-web-local] Backend pronto em http://localhost:${PORT}`);
        const electron = await openUi();
        setupSignalForward(backend, electron);
        console.log('[prod-web-local] Pressione Ctrl+C para finalizar.');
        await new Promise<void>((resolve) => backend.on('exit', () => resolve()));
    } catch (err) {
        console.error('[prod-web-local] Falha ao iniciar ambiente:', err);
        process.exit(1);
    }
}

main();


