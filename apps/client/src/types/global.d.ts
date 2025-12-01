declare global {
    type BaseType = 'CONTABIL' | 'FISCAL';

    interface Base {
        id: number;
        tipo: BaseType;
        nome?: string | null;
        periodo?: string | null;
        arquivo_caminho?: string | null;
        tabela_sqlite?: string | null;
        created_at?: string | null;
        updated_at?: string | null;
        conversion_status?: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED' | 'RUNNING' | null;
        header_linha_inicial?: number | null;
        header_coluna_inicial?: number | null;
        conversion_started_at?: string | null;
        conversion_finished_at?: string | null;
        conversion_error?: string | null;
        // ingest job info (added to support background ingestion status)
        ingest_in_progress?: boolean;
        ingest_status?: JobStatus | null;
        ingest_job?: {
            id: number;
            base_id: number;
            status: JobStatus;
            erro?: string | null;
            created_at?: string | null;
            updated_at?: string | null;
        } | null;
    }

    interface BaseColumn {
        id?: number;
        base_id?: number;
        col_index: number; // 1-based coluna absoluta no Excel
        excel_name?: string | null;
        sqlite_name: string;
        created_at?: string | null;
    }

    interface ConfigCancelamento {
        id: number;
        base_id: number;
        nome?: string | null;
        coluna_indicador: string;
        valor_cancelado: string;
        valor_nao_cancelado: string;
        ativa: boolean;
        created_at?: string | null;
        updated_at?: string | null;
    }

    interface ConfigEstorno {
        id: number;
        base_id: number;
        nome?: string | null;
        coluna_a: string;
        coluna_b: string;
        coluna_soma: string;
        limite_zero?: number | null;
        ativa: boolean;
        created_at?: string | null;
        updated_at?: string | null;
    }

    interface ConfigConciliacao {
        id: number;
        nome?: string | null;
        base_contabil_id: number;
        base_fiscal_id: number;
        // agora é um mapa de identificadores para array de nomes de colunas
        chaves_contabil: Record<string, string[]> | any;
        chaves_fiscal: Record<string, string[]> | any;
        coluna_conciliacao_contabil: string | null;
        coluna_conciliacao_fiscal: string | null;
        inverter_sinal_fiscal?: boolean;
        limite_diferenca_imaterial?: number | null;
        created_at?: string | null;
        updated_at?: string | null;
    }

    type JobStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';

    interface JobConciliacao {
        id: number;
        nome?: string | null;
        config_conciliacao_id: number;
        config_estorno_id?: number | null;
        config_cancelamento_id?: number | null;
        status: JobStatus;
        erro?: string | null;
        arquivo_exportado?: string | null;
        // denormalized config names
        config_estorno_nome?: string | null;
        config_cancelamento_nome?: string | null;
        created_at?: string | null;
        updated_at?: string | null;
    }

    interface ConciliacaoResultRow {
        id: number;
        job_id: number;
        chave?: string | null;
        status?: string | null;
        grupo?: string | null;
        a_row_id?: number | null;
        b_row_id?: number | null;
        a_values?: any | null; // JSON serialized values from base A
        b_values?: any | null; // JSON serialized values from base B
        value_a?: number | null;
        value_b?: number | null;
        difference?: number | null;
        created_at?: string | null;
    }

    interface PaginatedResult<T> {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
        data: T[];
    }

    interface ExportInfo {
        path: string;
        filename: string;
        tipo?: string | null; // ex: 'zip' ou 'xlsx'
    }

    interface BasePreview {
        columns: string[];
        rows: Array<Record<string, any>> | any[][];
    }

    // helper types for API error responses
    interface ApiError {
        error: string;
        details?: any;
    }

    interface Window {
        appBridge?: {
            getApiBaseUrl?: () => string
        }
    }

}

export { };