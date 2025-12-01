import axios from 'axios';

function resolveApiBaseUrl() {
    const bridgeBase = window.appBridge?.getApiBaseUrl?.()
    if (bridgeBase) return bridgeBase

    const envBase = import.meta.env.VITE_API_BASE_URL
    if (envBase) return envBase

    return 'http://localhost:3000'
}

// Base API configuration
const api = axios.create({
    baseURL: resolveApiBaseUrl(),
    headers: {
        'Content-Type': 'application/json',
    },
});

export default api;