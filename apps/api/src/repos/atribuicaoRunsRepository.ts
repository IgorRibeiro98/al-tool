import db from '../db/knex';
import type { Knex } from 'knex';

export type AtribuicaoRunStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
export type ModeWrite = 'OVERWRITE' | 'ONLY_EMPTY';

export type AtribuicaoRunRow = {
    id: number;
    nome?: string | null;
    base_origem_id: number;
    base_destino_id: number;
    mode_write: ModeWrite;
    selected_columns_json?: string | null;  // JSON array of column names
    status: AtribuicaoRunStatus;
    pipeline_stage?: string | null;
    pipeline_progress?: number | null;
    erro?: string | null;
    result_table_name?: string | null;
    created_at?: string;
    updated_at?: string;
};

export type AtribuicaoRunKeyRow = {
    id: number;
    atribuicao_run_id: number;
    keys_pair_id: number;
    key_identifier: string;
    ordem: number;
    created_at?: string;
    updated_at?: string;
};

const TABLE_RUNS = 'atribuicao_runs';
const TABLE_KEYS = 'atribuicao_run_keys';

function validateId(id: number) {
    if (!Number.isInteger(id) || id <= 0) throw new TypeError('id must be a positive integer');
}

export async function createRun(
    payload: {
        nome?: string;
        base_origem_id: number;
        base_destino_id: number;
        mode_write: ModeWrite;
        selected_columns: string[];
        keys: Array<{ keys_pair_id: number; key_identifier: string; ordem: number }>;
    },
    options?: { knex?: Knex }
): Promise<AtribuicaoRunRow | null> {
    const knex = options?.knex ?? db;

    const runInsert = {
        nome: payload.nome || null,
        base_origem_id: payload.base_origem_id,
        base_destino_id: payload.base_destino_id,
        mode_write: payload.mode_write,
        selected_columns_json: JSON.stringify(payload.selected_columns || []),
        status: 'PENDING' as AtribuicaoRunStatus,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
    };

    const result = await knex(TABLE_RUNS).insert(runInsert);
    const runId = Array.isArray(result) ? result[0] : result;
    if (!runId) throw new Error('Failed to insert run');

    // Insert keys
    if (payload.keys && payload.keys.length > 0) {
        const keyInserts = payload.keys.map((k, idx) => ({
            atribuicao_run_id: runId,
            keys_pair_id: k.keys_pair_id,
            key_identifier: k.key_identifier || `CHAVE_${idx + 1}`,
            ordem: k.ordem ?? idx,
        }));
        await knex(TABLE_KEYS).insert(keyInserts);
    }

    const row = await knex(TABLE_RUNS).where({ id: runId }).first();
    return row ?? null;
}

export async function getRunById(id: number, options?: { knex?: Knex }): Promise<AtribuicaoRunRow | null> {
    validateId(id);
    const knex = options?.knex ?? db;
    const row = await knex(TABLE_RUNS).where({ id }).first();
    return row ?? null;
}

export async function listRuns(
    page = 1,
    pageSize = 20,
    status?: string,
    options?: { knex?: Knex }
): Promise<{ total: number; data: AtribuicaoRunRow[] }> {
    const knex = options?.knex ?? db;
    const offset = (Math.max(1, page) - 1) * pageSize;

    let query = knex(TABLE_RUNS);
    if (status) query = query.where('status', status);

    const countRaw: any = await query.clone().count({ count: '*' }).first();
    const total = Number(countRaw?.count || countRaw?.['count(*)'] || 0);

    const data = await query
        .clone()
        .select('*')
        .orderBy('created_at', 'desc')
        .limit(pageSize)
        .offset(offset);

    return { total, data };
}

export async function getRunKeys(runId: number, options?: { knex?: Knex }): Promise<AtribuicaoRunKeyRow[]> {
    validateId(runId);
    const knex = options?.knex ?? db;
    return knex(TABLE_KEYS)
        .where({ atribuicao_run_id: runId })
        .orderBy('ordem', 'asc')
        .orderBy('id', 'asc');
}

export async function updateRunStatus(
    id: number,
    status: AtribuicaoRunStatus,
    error?: string,
    options?: { knex?: Knex }
): Promise<AtribuicaoRunRow | null> {
    validateId(id);
    const knex = options?.knex ?? db;
    const update: Record<string, any> = { status, updated_at: knex.fn.now() };
    if (error !== undefined) update.erro = error;
    await knex(TABLE_RUNS).where({ id }).update(update);
    return getRunById(id, options);
}

export async function setRunProgress(
    id: number,
    stage: string | null,
    progress?: number | null,
    _label?: string | null,  // Not used - table doesn't have this column
    options?: { knex?: Knex }
): Promise<AtribuicaoRunRow | null> {
    validateId(id);
    const knex = options?.knex ?? db;
    const update: Record<string, any> = { updated_at: knex.fn.now() };
    if (stage !== undefined) update.pipeline_stage = stage;
    if (progress !== undefined) update.pipeline_progress = progress;
    // Note: pipeline_stage_label column doesn't exist in table
    await knex(TABLE_RUNS).where({ id }).update(update);
    return getRunById(id, options);
}

export async function setResultTableName(
    id: number,
    tableName: string,
    options?: { knex?: Knex }
): Promise<AtribuicaoRunRow | null> {
    validateId(id);
    const knex = options?.knex ?? db;
    await knex(TABLE_RUNS).where({ id }).update({
        result_table_name: tableName,
        updated_at: knex.fn.now(),
    });
    return getRunById(id, options);
}

export async function deleteRun(id: number, options?: { knex?: Knex }): Promise<boolean> {
    validateId(id);
    const knex = options?.knex ?? db;

    // Get run to find result table
    const run = await getRunById(id, options);
    if (!run) return false;

    // Drop result table if exists
    if (run.result_table_name) {
        try {
            const exists = await knex.schema.hasTable(run.result_table_name);
            if (exists) await knex.schema.dropTableIfExists(run.result_table_name);
        } catch (e) {
            console.error('Error dropping result table', e);
        }
    }

    // Delete run (cascade will delete keys)
    await knex(TABLE_RUNS).where({ id }).del();
    return true;
}

export default {
    createRun,
    getRunById,
    listRuns,
    getRunKeys,
    updateRunStatus,
    setRunProgress,
    setResultTableName,
    deleteRun,
};
