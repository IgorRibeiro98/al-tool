import db from '../db/knex';
import type { Knex } from 'knex';

export type JobStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';

export interface JobsRow {
    readonly id: number;
    status?: JobStatus;
    erro?: string | null;
    arquivo_exportado?: string | null;
    export_progress?: number | null;
    export_status?: string | null;
    pipeline_stage?: string | null;
    pipeline_stage_label?: string | null;
    pipeline_progress?: number | null;
    created_at?: string;
    updated_at?: string;
    [key: string]: unknown;
}

interface RepoOptions {
    readonly knex?: Knex;
}

const LOG_PREFIX = '[jobsRepository]';

function validateId(id: number): void {
    if (!Number.isInteger(id) || id <= 0) throw new TypeError('id must be a positive integer');
}

async function ensureTable(knexInstance?: Knex): Promise<void> {
    const k = knexInstance ?? db;
    const exists = await k.schema.hasTable('jobs_conciliacao');
    if (!exists) {
        throw new Error("Missing DB table 'jobs_conciliacao'. Run the API migrations to create required tables.");
    }
}

async function addOptionalJobColumns(knexInstance?: Knex): Promise<void> {
    const k = knexInstance ?? db;
    await k.schema.table('jobs_conciliacao', t => {
        try { t.string('arquivo_exportado').nullable(); } catch { /* column exists */ }
        try { t.string('config_estorno_nome').nullable(); } catch { /* column exists */ }
        try { t.string('config_cancelamento_nome').nullable(); } catch { /* column exists */ }
        try { t.integer('config_mapeamento_id').unsigned().nullable(); } catch { /* column exists */ }
        try { t.string('config_mapeamento_nome').nullable(); } catch { /* column exists */ }
        try { t.integer('base_contabil_id_override').unsigned().nullable(); } catch { /* column exists */ }
        try { t.integer('base_fiscal_id_override').unsigned().nullable(); } catch { /* column exists */ }
    });
}

async function ensureColumnsAndRetryUpdate(knexInstance: Knex, id: number, update: Record<string, unknown>, columnHints: string[]): Promise<void> {
    try {
        await knexInstance('jobs_conciliacao').where({ id }).update(update);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const missing = columnHints.some(h => msg.includes(h) || /no such column/.test(msg) || /no column named/.test(msg));
        if (missing) {
            try {
                await knexInstance.schema.table('jobs_conciliacao', t => {
                    for (const col of columnHints) {
                        try {
                            // map known hints to column creations
                            if (col === 'arquivo_exportado') t.string('arquivo_exportado').nullable();
                            if (col === 'export_progress') t.integer('export_progress').nullable();
                            if (col === 'export_status') t.string('export_status').nullable();
                            if (col === 'pipeline_stage') t.string('pipeline_stage').nullable();
                            if (col === 'pipeline_stage_label') t.string('pipeline_stage_label').nullable();
                            if (col === 'pipeline_progress') t.integer('pipeline_progress').nullable();
                        } catch { /* column exists */ }
                    }
                });
                await knexInstance('jobs_conciliacao').where({ id }).update(update);
            } catch (addErr) {
                throw addErr;
            }
        } else {
            throw err;
        }
    }
}

export async function createJob(payload: Record<string, unknown>, options?: RepoOptions): Promise<JobsRow | null> {
    const knex = options?.knex ?? db;
    await ensureTable(knex);
    try {
        const result = await knex('jobs_conciliacao').insert(payload);
        const id = Array.isArray(result) ? result[0] : result;
        if (!id) throw new Error('Failed to insert job');
        const row = (await knex('jobs_conciliacao').where({ id }).first()) as JobsRow | undefined;
        return row ?? null;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('no such column') || msg.includes('no column named') || /no such column:/.test(msg)) {
            try {
                await addOptionalJobColumns(knex);
            } catch {
                // ignore - will rethrow original error below
            }
            const retry = await knex('jobs_conciliacao').insert(payload);
            const id2 = Array.isArray(retry) ? retry[0] : retry;
            const row = (await knex('jobs_conciliacao').where({ id: id2 }).first()) as JobsRow | undefined;
            return row ?? null;
        }
        throw err;
    }
}

export async function updateJobStatus(id: number, status: JobStatus, error?: string, options?: RepoOptions): Promise<JobsRow | null> {
    validateId(id);
    const knex = options?.knex ?? db;
    await ensureTable(knex);
    const update: Record<string, unknown> = { status, updated_at: knex.fn.now() };
    if (error) update.erro = error;
    await knex('jobs_conciliacao').where({ id }).update(update);
    const row = (await knex('jobs_conciliacao').where({ id }).first()) as JobsRow | undefined;
    return row ?? null;
}

export async function getJobById(id: number, options?: RepoOptions): Promise<JobsRow | null> {
    validateId(id);
    const knex = options?.knex ?? db;
    await ensureTable(knex);
    const row = (await knex('jobs_conciliacao').where({ id }).first()) as JobsRow | undefined;
    return row ?? null;
}

export async function setJobExportPath(id: number, arquivoPath: string | null, options?: RepoOptions): Promise<JobsRow | null> {
    validateId(id);
    const knex = options?.knex ?? db;
    await ensureTable(knex);
    const update: Record<string, unknown> = { arquivo_exportado: arquivoPath, updated_at: knex.fn.now() };
    await ensureColumnsAndRetryUpdate(knex, id, update, ['arquivo_exportado']);
    const row = (await knex('jobs_conciliacao').where({ id }).first()) as JobsRow | undefined;
    return row ?? null;
}

export async function setJobExportProgress(id: number, progress: number | null, status?: string | null, options?: RepoOptions): Promise<JobsRow | null> {
    validateId(id);
    const knex = options?.knex ?? db;
    await ensureTable(knex);
    const update: Record<string, unknown> = { updated_at: knex.fn.now() };
    if (progress !== null && progress !== undefined) update.export_progress = progress;
    if (status !== undefined) update.export_status = status;
    await ensureColumnsAndRetryUpdate(knex, id, update, ['export_progress', 'export_status']);
    const row = (await knex('jobs_conciliacao').where({ id }).first()) as JobsRow | undefined;
    return row ?? null;
}

export async function setJobPipelineStage(id: number, stage: string | null, progress?: number | null, label?: string | null, options?: { knex?: Knex }) {
    validateId(id);
    const knex = options?.knex ?? db;
    await ensureTable(knex);
    const update: Record<string, any> = { updated_at: knex.fn.now() };
    if (stage !== undefined) update.pipeline_stage = stage;
    if (label !== undefined) update.pipeline_stage_label = label;
    if (progress !== undefined) update.pipeline_progress = progress;
    await ensureColumnsAndRetryUpdate(knex, id, update, ['pipeline_stage', 'pipeline_stage_label', 'pipeline_progress']);
    const row = (await knex('jobs_conciliacao').where({ id }).first()) as JobsRow | undefined;
    return row ?? null;
}

export default { createJob, updateJobStatus, getJobById, setJobExportPath, setJobExportProgress, setJobPipelineStage };
