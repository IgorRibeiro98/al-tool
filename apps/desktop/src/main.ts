import { app, BrowserWindow } from 'electron'
import * as path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'

// URL do frontend em dev (Vite)
const DEV_URL = process.env.ELECTRON_DEV_URL || 'http://localhost:8081'

// API local (Node/Express) embarcada (usada apenas quando empacotado)
const API_PORT = process.env.ELECTRON_API_PORT ? Number(process.env.ELECTRON_API_PORT) : 3000

const isDev = !app.isPackaged

function ensureDataDirectories() {
    const userData = app.getPath('userData')
    const dataDir = path.join(userData, 'data')
    const dbDir = path.join(dataDir, 'db')
    const uploadDir = path.join(dataDir, 'uploads')
    const exportDir = path.join(dataDir, 'exports')
    const logsDir = path.join(dataDir, 'logs')

    for (const dir of [dataDir, dbDir, uploadDir, exportDir, logsDir]) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true })
        }
    }

    return {
        dataDir,
        dbDir,
        uploadDir,
        exportDir,
        logsDir
    }
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    })

    if (isDev) {
        // Em desenvolvimento, usar o dev server do Vite/React
        win.loadURL(DEV_URL)
        // optional: open devtools in dev
        // win.webContents.openDevTools()
    } else {
        // Carrega build estático do React/MUI quando empacotado
        // __dirname = resources/app/dist; client/dist empacotado em resources/client/dist
        const indexPath = path.join(__dirname, '../client/dist/index.html')
        win.loadFile(indexPath)
    }
}

async function startBackendServer() {
    return new Promise<void>((resolve, reject) => {
        const apiPath = isDev
            ? path.resolve(__dirname, '../../api/src/server.ts')
            : path.join(process.resourcesPath, 'api/dist/server.js')

        const dirs = ensureDataDirectories()
        const dbPath = path.join(dirs.dbDir, 'data.sqlite3')

        const nodeExecutable = process.execPath

        const child = spawn(nodeExecutable, [apiPath], {
            cwd: isDev
                ? path.resolve(__dirname, '../../api')
                : path.join(process.resourcesPath, 'api'),
            env: {
                ...process.env,
                PORT: String(API_PORT),
                RUN_INSIDE_ELECTRON: '1',
                DB_PATH: dbPath,
                UPLOAD_DIR: dirs.uploadDir,
                EXPORT_DIR: dirs.exportDir,
                LOGS_DIR: dirs.logsDir
            },
            stdio: 'inherit'
        })

        child.on('error', (err) => {
            console.error('Failed to start embedded API server', err)
            reject(err)
        })

        // Considerar o servidor iniciado assim que o processo filho subir
        // (os logs aparecerão no mesmo terminal via stdio: 'inherit')
        resolve()
    })
}

app.whenReady().then(async () => {
    // Quando empacotado, subimos a API embutida; em dev assumimos API externa (docker/local)
    if (!isDev) {
        try {
            await startBackendServer()
        } catch (err) {
            console.error('Error while starting backend server', err)
        }
    }

    createWindow()

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit()
})
