import api from '@/services/api';

export function fetchConciliacoes() {
    return api.get('/conciliacoes');
}

export function createConciliacao(data: {
    nome?: string;
    configConciliacaoId: number;
    configEstornoId?: number | null;
    configCancelamentoId?: number | null;
    configMapeamentoId?: number | null;
    baseContabilId?: number | null;
    baseFiscalId?: number | null;
}) {
    // API expects: { configConciliacaoId, configEstornoId, configCancelamentoId, configMapeamentoId, baseContabilId, baseFiscalId, nome }
    return api.post('/conciliacoes', data);
}

export function getConciliacao(id: number) {
    return api.get(`/conciliacoes/${id}`);
}

export function fetchConciliacaoResultado(id: number, page: number, pageSize: number, status?: string | null, search?: string | null, searchColumn?: string | null) {
    const params: any = { page, pageSize };
    // special token for filtering NULL status
    if (status === null) params.status = '__NULL__';
    else if (typeof status === 'string' && status.length > 0) params.status = status;
    if (typeof search === 'string' && search.trim().length > 0) params.search = search.trim();
    if (typeof searchColumn === 'string' && searchColumn.trim().length > 0) params.searchColumn = searchColumn.trim();
    return api.get(`/conciliacoes/${id}/resultado`, { params });
}

export function exportConciliacao(id: number) {
    return api.post(`/conciliacoes/${id}/exportar`);
}

export function getExportStatus(id: number) {
    return api.get(`/conciliacoes/${id}/export-status`);
}

export function getDownloadUrl(id: number) {
    // returns a fully qualified download URL based on axios baseURL
    return `${api.defaults.baseURL || ''}/conciliacoes/${id}/download`;
}

export function downloadConciliacaoFile(id: number) {
    return api.get(`/conciliacoes/${id}/download`, { responseType: 'blob' });
}

export function deleteConciliacao(id: number) {
    return api.delete(`/conciliacoes/${id}`);
}

export default { fetchConciliacoes, createConciliacao, getConciliacao, fetchConciliacaoResultado, exportConciliacao, getExportStatus, getDownloadUrl, downloadConciliacaoFile, deleteConciliacao };