import api from '@/services/api';

export function fetchConciliacoes() {
    return api.get('/conciliacoes');
}

export function createConciliacao(data: { nome?: string; configConciliacaoId: number; configEstornoId?: number | null; configCancelamentoId?: number | null }) {
    // API expects: { configConciliacaoId, configEstornoId, configCancelamentoId, nome }
    return api.post('/conciliacoes', data);
}

export function getConciliacao(id: number) {
    return api.get(`/conciliacoes/${id}`);
}

export function fetchConciliacaoResultado(id: number, page: number, pageSize: number) {
    return api.get(`/conciliacoes/${id}/resultado`, {
        params: { page, pageSize }
    });
}

export function exportConciliacao(id: number) {
    return api.post(`/conciliacoes/${id}/exportar`);
}

export default { fetchConciliacoes, createConciliacao, getConciliacao, fetchConciliacaoResultado, exportConciliacao };