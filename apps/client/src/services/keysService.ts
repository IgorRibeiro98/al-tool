import api from '@/services/api';

export function fetchKeys() {
    return api.get('/keys');
}

export function getKey(id: number) {
    return api.get(`/keys/${id}`);
}

export function createKey(payload: any) {
    return api.post('/keys', payload);
}

export function updateKey(id: number, payload: any) {
    return api.put(`/keys/${id}`, payload);
}

export function deleteKey(id: number) {
    return api.delete(`/keys/${id}`);
}

export default { fetchKeys, getKey, createKey, updateKey, deleteKey };
