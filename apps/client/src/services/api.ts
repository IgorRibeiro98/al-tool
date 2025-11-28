import axios from 'axios';

// Base API configuration
const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000', // Vite expõe variáveis via import.meta.env
    headers: {
        'Content-Type': 'application/json',
    },
});

export default api;