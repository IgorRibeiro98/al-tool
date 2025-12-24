import api from '@/services/api';

export function fetchKeysPairs() {
    return api.get('/keys-pairs');
}

export function getKeysPair(id: number) {
    return api.get(`/keys-pairs/${id}`);
}

export function createKeysPair(payload: any) {
    return api.post('/keys-pairs', payload);
}

export function updateKeysPair(id: number, payload: any) {
    return api.put(`/keys-pairs/${id}`, payload);
}

export function deleteKeysPair(id: number) {
    return api.delete(`/keys-pairs/${id}`);
}

export default { fetchKeysPairs, getKeysPair, createKeysPair, updateKeysPair, deleteKeysPair };
