import api from '@/services/api';

export function fetchBases(params?: Record<string, any>) {
    return api.get('/bases', { params });
}

export function fetchBasePreview(id: number) {
    return api.get(`/bases/${id}/preview`);
}

export function getBase(id: number) {
    return api.get(`/bases/${id}`);
}

export function getBaseColumns(id: number) {
    return api.get(`/bases/${id}/columns`);
}

export function ingestBase(id: number) {
    return api.post(`/bases/${id}/ingest`);
}

export function deleteBase(id: number) {
    return api.delete(`/bases/${id}`);
}

export function createBases(formData: FormData) {
    // Let the browser/axios set the multipart boundary header
    return api.post('/bases', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
    });
}

export default { fetchBases, ingestBase, createBases, fetchBasePreview, getBase, getBaseColumns };