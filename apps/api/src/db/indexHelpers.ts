import db from './knex';

async function indexExists(indexName: string) {
    const res: any = await db.raw("SELECT name FROM sqlite_master WHERE type='index' AND name = ?", [indexName]);
    const rows = res && (res.rows || res[0]);
    if (!rows) return false;
    return rows.length > 0;
}

export async function createIndexIfNotExists(tableName: string, columnName: string, baseId?: number) {
    const safeCol = columnName.replace(/"/g, '');
    const idxName = `idx_base_${baseId ?? 'x'}_${safeCol}`;
    const exists = await indexExists(idxName);
    if (exists) return idxName;
    const sql = `CREATE INDEX \"${idxName}\" ON \"${tableName}\"(\"${safeCol}\")`;
    await db.raw(sql);
    return idxName;
}

export async function ensureIndicesForConfigConciliacao(cfg: any) {
    if (!cfg) return;
    try {
        const parseChaves = (raw: any) => {
            try {
                const p = raw ? JSON.parse(raw) : {};
                if (Array.isArray(p)) return { CHAVE_1: p } as Record<string, string[]>;
                if (p && typeof p === 'object') return p as Record<string, string[]>;
                return {} as Record<string, string[]>;
            } catch { return {} as Record<string, string[]>; }
        };
        const chavesA = parseChaves(cfg.chaves_contabil);
        const chavesB = parseChaves(cfg.chaves_fiscal);
        const baseA = cfg.base_contabil_id;
        const baseB = cfg.base_fiscal_id;
        if (baseA) {
            const tableA = `base_${baseA}`;
            for (const key of Object.keys(chavesA || {})) {
                const cols = chavesA[key] || [];
                for (const c of cols) {
                    if (typeof c === 'string' && c.trim()) await createIndexIfNotExists(tableA, c, baseA);
                }
            }
            if (cfg.coluna_conciliacao_contabil) await createIndexIfNotExists(tableA, cfg.coluna_conciliacao_contabil, baseA);
        }
        if (baseB) {
            const tableB = `base_${baseB}`;
            for (const key of Object.keys(chavesB || {})) {
                const cols = chavesB[key] || [];
                for (const c of cols) {
                    if (typeof c === 'string' && c.trim()) await createIndexIfNotExists(tableB, c, baseB);
                }
            }
            if (cfg.coluna_conciliacao_fiscal) await createIndexIfNotExists(tableB, cfg.coluna_conciliacao_fiscal, baseB);
        }
    } catch (e) {
        console.error('ensureIndicesForConfigConciliacao error', e);
    }
}

export async function ensureIndicesForConfigEstorno(cfg: any) {
    if (!cfg) return;
    try {
        const base = cfg.base_id;
        if (!base) return;
        const table = `base_${base}`;
        if (cfg.coluna_a) await createIndexIfNotExists(table, cfg.coluna_a, base);
        if (cfg.coluna_b) await createIndexIfNotExists(table, cfg.coluna_b, base);
    } catch (e) {
        console.error('ensureIndicesForConfigEstorno error', e);
    }
}

export async function ensureIndicesForConfigCancelamento(cfg: any) {
    if (!cfg) return;
    try {
        const base = cfg.base_id;
        if (!base) return;
        const table = `base_${base}`;
        if (cfg.coluna_indicador) await createIndexIfNotExists(table, cfg.coluna_indicador, base);
    } catch (e) {
        console.error('ensureIndicesForConfigCancelamento error', e);
    }
}

export async function ensureIndicesForBaseFromConfigs(baseId: number) {
    try {
        const confsConc = await db('configs_conciliacao').where({ base_contabil_id: baseId }).orWhere({ base_fiscal_id: baseId }).select('*');
        for (const c of confsConc) await ensureIndicesForConfigConciliacao(c);

        const confsEst = await db('configs_estorno').where({ base_id: baseId }).select('*');
        for (const c of confsEst) await ensureIndicesForConfigEstorno(c);

        const confsCan = await db('configs_cancelamento').where({ base_id: baseId }).select('*');
        for (const c of confsCan) await ensureIndicesForConfigCancelamento(c);
    } catch (e) {
        console.error('ensureIndicesForBaseFromConfigs error', e);
    }
}

export default { createIndexIfNotExists, ensureIndicesForConfigConciliacao, ensureIndicesForConfigEstorno, ensureIndicesForConfigCancelamento, ensureIndicesForBaseFromConfigs };
