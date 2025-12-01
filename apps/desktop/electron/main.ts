import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import * as url from 'url';

function getBackendUrl(): string {
    const port = process.env.APP_PORT || '3131';
    const base = process.env.APP_BASE_URL || `http://localhost:${port}`;
    return base;
}

async function createWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    const targetUrl = getBackendUrl();

    try {
        await win.loadURL(targetUrl);
    } catch (err) {
        // Fallback: simple local HTML error page
        const errorHtml = `
      <html>
        <head>
          <meta charset="utf-8" />
          <title>AL Tool - Backend não encontrado</title>
          <style>
            body { font-family: system-ui, sans-serif; margin: 0; padding: 0; display: flex; align-items: center; justify-content: center; height: 100vh; background: #0f172a; color: #e5e7eb; }
            .card { background: #020617; padding: 32px 40px; border-radius: 16px; box-shadow: 0 25px 50px -12px rgba(15,23,42,0.5); max-width: 520px; text-align: center; }
            h1 { font-size: 24px; margin-bottom: 8px; }
            p { margin: 4px 0; color: #9ca3af; }
            code { background: rgba(15,23,42,0.9); padding: 2px 6px; border-radius: 4px; font-size: 13px; }
            button { margin-top: 18px; padding: 8px 16px; border-radius: 999px; border: none; background: #2563eb; color: white; cursor: pointer; font-size: 14px; }
            button:hover { background: #1d4ed8; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Backend não está rodando</h1>
            <p>Não foi possível conectar em <code>${targetUrl}</code>.</p>
            <p>Certifique-se de que a API+frontend estejam ativos (ex.: <code>npm run dev</code> ou <code>npm run app:local</code>).</p>
            <button onclick="location.reload()">Tentar novamente</button>
          </div>
        </body>
      </html>
    `;
        const errorUrl = url.pathToFileURL(path.join(app.getPath('temp'), 'al-tool-error.html')).toString();
        // Carrega o HTML direto via data URL para evitar escrever arquivo
        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(errorHtml));
    }
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
