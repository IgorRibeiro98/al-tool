import db from '../db/knex';
import type { Knex } from 'knex';

export type IngestJobStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';

export type IngestJobRow = {
    id: number;
    status: IngestJobStatus;
    erro?: string | null;
    created_at?: string;
    updated_at?: string;
    [key: string]: any;
};

function validateId(id: number) {
    if (!Number.isInteger(id) || id <= 0) throw new TypeError('id must be a positive integer');
}

async function ensureTable(knexInstance?: Knex) {
    const k = knexInstance ?? db;
    const exists = await k.schema.hasTable('ingest_jobs');
    if (!exists) {
        throw new Error("Missing DB table 'ingest_jobs'. Run the API migrations (e.g. `npm --prefix apps/api run migrate`) to create required tables.");
    }
}

/**
 * Create an ingest job. Returns the created row.
 */
export async function createJob(payload: Record<string, any>, options?: { knex?: Knex }) {
    const knex = options?.knex ?? db;
    await ensureTable(knex);
    try {
        const result = await knex('ingest_jobs').insert(payload);
        // knex sqlite returns number or array depending on client; normalize
        const id = Array.isArray(result) ? result[0] : result;
        if (!id) throw new Error('Failed to obtain inserted id for ingest_jobs');
        const created = (await knex('ingest_jobs').where({ id }).first()) as IngestJobRow | undefined;
        return created ?? null;
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error('createJob failed:', (err as Error).message ?? err);
        throw err;
    }
}

/**
 * Update job status and optional error message, returning the updated row.
 */
export async function updateJobStatus(id: number, status: IngestJobStatus, errorMessage?: string, options?: { knex?: Knex }) {
    validateId(id);
    const knex = options?.knex ?? db;
    await ensureTable(knex);
    const update: Record<string, any> = { status, updated_at: knex.fn.now() };
    if (errorMessage) update.erro = errorMessage;
    try {
        await knex('ingest_jobs').where({ id }).update(update);
        const row = (await knex('ingest_jobs').where({ id }).first()) as IngestJobRow | undefined;
        return row ?? null;
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`updateJobStatus failed (id=${id}):`, (err as Error).message ?? err);
        throw err;
    }
}

export async function getJobById(id: number, options?: { knex?: Knex }) {
    validateId(id);
    const knex = options?.knex ?? db;
    await ensureTable(knex);
    try {
        const row = (await knex('ingest_jobs').where({ id }).first()) as IngestJobRow | undefined;
        return row ?? null;
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`getJobById failed (id=${id}):`, (err as Error).message ?? err);
        throw err;
    }
}

export default { createJob, updateJobStatus, getJobById };
