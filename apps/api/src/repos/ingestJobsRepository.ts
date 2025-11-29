import db from '../db/knex';

export type IngestJobStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';

async function ensureTable() {
    const exists = await db.schema.hasTable('ingest_jobs');
    if (!exists) {
        throw new Error("Missing DB table 'ingest_jobs'. Run the API migrations (e.g. `npm --prefix apps/api run migrate`) to create required tables.");
    }
}

export async function createJob(payload: Partial<any>) {
    await ensureTable();
    const [id] = await db('ingest_jobs').insert(payload);
    return await db('ingest_jobs').where({ id }).first();
}

export async function updateJobStatus(id: number, status: IngestJobStatus, error?: string) {
    const update: any = { status, updated_at: db.fn.now() };
    if (error) update.erro = error;
    await ensureTable();
    await db('ingest_jobs').where({ id }).update(update);
    return await db('ingest_jobs').where({ id }).first();
}

export async function getJobById(id: number) {
    await ensureTable();
    return await db('ingest_jobs').where({ id }).first();
}

export default { createJob, updateJobStatus, getJobById };
