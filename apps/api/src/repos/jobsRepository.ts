import db from '../db/knex';

export type JobStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';

export async function createJob(payload: Partial<any>) {
    const [id] = await db('jobs_conciliacao').insert(payload);
    return await db('jobs_conciliacao').where({ id }).first();
}

export async function updateJobStatus(id: number, status: JobStatus, error?: string) {
    const update: any = { status, updated_at: db.fn.now() };
    if (error) update.erro = error;
    await db('jobs_conciliacao').where({ id }).update(update);
    return await db('jobs_conciliacao').where({ id }).first();
}

export async function getJobById(id: number) {
    return await db('jobs_conciliacao').where({ id }).first();
}

export async function setJobExportPath(id: number, arquivoPath: string | null) {
    const update: any = { arquivo_exportado: arquivoPath, updated_at: db.fn.now() };
    try {
        await db('jobs_conciliacao').where({ id }).update(update);
    } catch (err: any) {
        // If the column doesn't exist (older DB), attempt to add it and retry
        const msg = err && (err.message || String(err)) || '';
        if (msg.includes('no such column') || msg.includes('no column named') || /no such column: arquivo_exportado/.test(msg)) {
            try {
                await db.schema.table('jobs_conciliacao', t => {
                    t.string('arquivo_exportado').nullable();
                });
                await db('jobs_conciliacao').where({ id }).update(update);
            } catch (addErr) {
                // rethrow the original error if adding column failed
                throw addErr;
            }
        } else {
            throw err;
        }
    }
    return await db('jobs_conciliacao').where({ id }).first();
}

export default { createJob, updateJobStatus, getJobById };
