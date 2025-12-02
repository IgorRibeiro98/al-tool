import axios from 'axios';

const apiBaseRaw = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';
const API_BASE_URL = apiBaseRaw.replace(/\/$/, '');

const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

export { API_BASE_URL };

export default api;