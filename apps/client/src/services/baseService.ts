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

export function createDerivedColumn(id: number, sourceColumn: string, op: string) {
    return api.post(`/bases/${id}/columns/derived`, { sourceColumn, op });
}

export function setBaseColumnMonetary(baseId: number, columnId: number, isMonetary: boolean | number) {
    return api.patch(`/bases/${baseId}/columns/${columnId}`, { is_monetary: Number(isMonetary) === 1 || isMonetary === true ? 1 : 0 });
}

export function reuseMonetaryFlags(baseId: number, body: { targetBaseIds?: number[]; applyToSameTipo?: boolean; matchBy?: 'excel_name' | 'sqlite_name'; override?: boolean }) {
    return api.post(`/bases/${baseId}/reuse-monetary`, body);
}

export function updateBase(id: number, body: Record<string, any>) {
    return api.patch(`/bases/${id}`, body);
}

export function createBases(formData: FormData) {
    // Let the browser/axios set the multipart boundary header
    return api.post('/bases', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
    });
}

export function fetchBaseSubtypes() {
    return api.get('/bases/subtypes');
}

export function createBaseSubtype(body: { name: string }) {
    return api.post('/bases/subtypes', body);
}

export function updateBaseSubtype(id: number, body: { name?: string }) {
    return api.put(`/bases/subtypes/${id}`, body);
}

export function deleteBaseSubtype(id: number) {
    return api.delete(`/bases/subtypes/${id}`);
}

export default {
    fetchBases,
    ingestBase,
    createBases,
    fetchBasePreview,
    getBase,
    getBaseColumns,
    createDerivedColumn,
    setBaseColumnMonetary,
    reuseMonetaryFlags,
    fetchBaseSubtypes,
    createBaseSubtype,
    updateBaseSubtype,
    deleteBaseSubtype
};