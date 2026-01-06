import api from '@/services/api';

export type AtribuicaoRun = {
    id: number;
    nome?: string | null;
    base_origem_id: number;
    base_destino_id: number;
    mode_write: 'OVERWRITE' | 'ONLY_EMPTY';
    selected_columns: string[];
    update_original_base?: boolean;  // default true
    status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
    pipeline_stage?: string | null;
    pipeline_progress?: number | null;
    pipeline_stage_label?: string | null;
    erro?: string | null;
    result_table_name?: string | null;
    created_at?: string;
    updated_at?: string;
    base_origem?: { id: number; nome: string; tipo: string } | null;
    base_destino?: { id: number; nome: string; tipo: string } | null;
    keys?: Array<{
        id: number;
        keys_pair_id: number;
        key_identifier: string;
        ordem: number;
        keys_pair?: any;
    }>;
};

export function listRuns(page = 1, pageSize = 20, status?: string) {
    const params: any = { page, pageSize };
    if (status) params.status = status;
    return api.get('/atribuicoes/runs', { params });
}

export function createRun(data: {
    nome?: string;
    baseOrigemId: number;
    baseDestinoId: number;
    modeWrite: 'OVERWRITE' | 'ONLY_EMPTY';
    selectedColumns: string[];
    updateOriginalBase?: boolean;
    keysPairs: Array<{ keysPairId: number; keyIdentifier?: string; ordem?: number }>;
}) {
    return api.post('/atribuicoes/runs', data);
}

export function getRun(id: number) {
    return api.get(`/atribuicoes/runs/${id}`);
}

export function startRun(id: number) {
    return api.post(`/atribuicoes/runs/${id}/start`);
}

export function getResults(id: number, page = 1, pageSize = 50, search?: string) {
    const params: any = { page, pageSize };
    if (search) params.search = search;
    return api.get(`/atribuicoes/runs/${id}/results`, { params });
}


// Novo fluxo: checar status e baixar arquivo
export function getExportStatus(id: number) {
    return api.get(`/atribuicoes/runs/${id}/export`);
}

export function getDownloadUrl(id: number) {
    return `${api.defaults.baseURL || ''}/atribuicoes/runs/${id}/download-xlsx`;
}

export function downloadExportFile(id: number) {
    return api.get(`/atribuicoes/runs/${id}/download-xlsx`, { responseType: 'blob' });
}

export function deleteRun(id: number) {
    return api.delete(`/atribuicoes/runs/${id}`);
}

export default {
    listRuns,
    createRun,
    getRun,
    startRun,
    getResults,
    getExportStatus,
    getDownloadUrl,
    downloadExportFile,
    deleteRun,
};
