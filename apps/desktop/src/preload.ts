import { contextBridge, ipcRenderer } from 'electron'

// Em desenvolvimento usamos a API externa (docker/local) e em produção a API embutida.
function resolveApiBaseUrl() {
    if (process.env.NODE_ENV === 'production') {
        const apiPort = Number(process.env.ELECTRON_API_PORT || 3000)
        return `http://localhost:${apiPort}`
    }

    // Dev: apontar para a API que já roda fora do Electron
    const devBase = process.env.ELECTRON_API_DEV_BASE || 'http://localhost:3000'
    return devBase
}

const apiBaseUrl = resolveApiBaseUrl()

// Expose a safe, minimal API to renderer
contextBridge.exposeInMainWorld('appBridge', {
    getApiBaseUrl: () => apiBaseUrl,
    send: (channel: string, ...args: any[]) => {
        const allowed = ['toMain']
        if (allowed.includes(channel)) {
            ipcRenderer.send(channel, ...args)
        }
    },
    invoke: (channel: string, ...args: any[]) => {
        const allowed = ['invokeMain']
        if (allowed.includes(channel)) {
            return ipcRenderer.invoke(channel, ...args)
        }
        return Promise.reject(new Error('channel-not-allowed'))
    },
    on: (channel: string, listener: (...args: any[]) => void) => {
        const allowed = ['fromMain']
        if (allowed.includes(channel)) {
            const wrapped = (_: any, ...args: any[]) => listener(...args)
            ipcRenderer.on(channel, wrapped)
            return () => ipcRenderer.removeListener(channel, wrapped)
        }
        return () => { }
    }
})
