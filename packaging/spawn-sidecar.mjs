// Harness de spawn do sidecar — modela o que o shell desktop (Electron/Tauri) fará:
// spawna o backend Python, faz probe do /health até responder, e mata no fim.
//
//   node packaging/spawn-sidecar.mjs <exec> [args...]
//   ex: node packaging/spawn-sidecar.mjs backend/.venv/bin/python -m altool.main
//       node packaging/spawn-sidecar.mjs dist/altool-sidecar/altool-sidecar
//
// Env: APP_PORT (default 8090). Sai 0 se /health respondeu ok, 1 caso contrário.

import { spawn } from 'node:child_process';

const [exec, ...args] = process.argv.slice(2);
if (!exec) {
  console.error('uso: node spawn-sidecar.mjs <exec> [args...]');
  process.exit(2);
}
const port = process.env.APP_PORT || '8090';
const url = `http://127.0.0.1:${port}/health`;

// Ao spawnar, o backend herda o cwd = raiz do repo; PYTHONPATH aponta o src quando rodamos via venv.
const env = { ...process.env, APP_PORT: port };
const child = spawn(exec, args, { env, stdio: ['ignore', 'inherit', 'inherit'] });

let killed = false;
const cleanup = () => { if (!killed) { killed = true; try { child.kill('SIGTERM'); } catch {} } };
process.on('exit', cleanup);

async function probe() {
  const t0 = Date.now();
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        const body = await r.json();
        const ms = Date.now() - t0;
        console.log(`\n✅ sidecar respondeu /health em ~${ms}ms:`);
        console.log('  ', JSON.stringify(body));
        cleanup();
        process.exit(0);
      }
    } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  console.error('\n❌ sidecar não respondeu /health a tempo');
  cleanup();
  process.exit(1);
}

child.on('error', (e) => { console.error('falha ao spawnar:', e.message); process.exit(1); });
probe();
