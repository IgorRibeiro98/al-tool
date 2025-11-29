import api from '@/services/api';

export function fetchBases() {
    return api.get('/bases');
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

export function createBase(formData: FormData) {
    // Let the browser/axios set the multipart boundary header
    return api.post('/bases', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
    });
}

export default { fetchBases, ingestBase, createBase, fetchBasePreview, getBase, getBaseColumns };