import api from '@/services/api';

export function fetchConfigsConciliacao() {
    return api.get('/configs/conciliacao');
}

export function getConfigConciliacao(id: number) {
    return api.get(`/configs/conciliacao/${id}`);
}

export function createConfigConciliacao(payload: any) {
    return api.post('/configs/conciliacao', payload);
}

export function updateConfigConciliacao(id: number, payload: any) {
    return api.put(`/configs/conciliacao/${id}`, payload);
}

export function deleteConfigConciliacao(id: number) {
    return api.delete(`/configs/conciliacao/${id}`);
}

export function fetchConfigsEstorno() {
    return api.get('/configs/estorno');
}

export function getConfigEstorno(id: number) {
    return api.get(`/configs/estorno/${id}`);
}

export function createConfigEstorno(payload: any) {
    return api.post('/configs/estorno', payload);
}

export function updateConfigEstorno(id: number, payload: any) {
    return api.put(`/configs/estorno/${id}`, payload);
}

export function deleteConfigEstorno(id: number) {
    return api.delete(`/configs/estorno/${id}`);
}

export function fetchConfigsCancelamento() {
    return api.get('/configs/cancelamento');
}

export function getConfigCancelamento(id: number) {
    return api.get(`/configs/cancelamento/${id}`);
}

export function createConfigCancelamento(payload: any) {
    return api.post('/configs/cancelamento', payload);
}

export function updateConfigCancelamento(id: number, payload: Partial<any>) {
    return api.put(`/configs/cancelamento/${id}`, payload);
}

export function deleteConfigCancelamento(id: number) {
    return api.delete(`/configs/cancelamento/${id}`);
}

export function fetchConfigsMapeamento() {
    return api.get('/configs/mapeamento');
}

export function getConfigMapeamento(id: number) {
    return api.get(`/configs/mapeamento/${id}`);
}

export function createConfigMapeamento(payload: any) {
    return api.post('/configs/mapeamento', payload);
}

export function updateConfigMapeamento(id: number, payload: any) {
    return api.put(`/configs/mapeamento/${id}`, payload);
}

export function deleteConfigMapeamento(id: number) {
    return api.delete(`/configs/mapeamento/${id}`);
}

export default {
    fetchConfigsConciliacao,
    fetchConfigsEstorno,
    fetchConfigsCancelamento,
    createConfigCancelamento,
    updateConfigCancelamento,
    deleteConfigCancelamento,
    fetchConfigsMapeamento,
};
