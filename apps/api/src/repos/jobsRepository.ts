import db from '../db/knex';

export type JobStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';

export async function createJob(payload: Partial<any>) {
    try {
        const [id] = await db('jobs_conciliacao').insert(payload);
        return await db('jobs_conciliacao').where({ id }).first();
    } catch (err: any) {
        // If DB schema is missing denormalized columns (e.g., config_estorno_nome), try to add them and retry.
        const msg = err && (err.message || String(err)) || '';
        if (msg.includes('no such column') || msg.includes('no column named') || /no such column:/.test(msg)) {
            // attempt to add common optional columns used by newer code paths
            try {
                await db.schema.table('jobs_conciliacao', t => {
                    // add nullable textual columns if not present
                    // use try/catch per column in case some already exist
                    try { t.string('arquivo_exportado').nullable(); } catch (_) { }
                    try { t.string('config_estorno_nome').nullable(); } catch (_) { }
                    try { t.string('config_cancelamento_nome').nullable(); } catch (_) { }
                });
            } catch (addErr) {
                // ignore and rethrow original error below
            }
            // retry insert once
            const [id2] = await db('jobs_conciliacao').insert(payload);
            return await db('jobs_conciliacao').where({ id: id2 }).first();
        }
        throw err;
    }
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

export async function setJobExportProgress(id: number, progress: number | null, status?: string | null) {
    const update: any = {};
    if (progress !== null && progress !== undefined) update.export_progress = progress;
    if (status !== undefined) update.export_status = status;
    update.updated_at = db.fn.now();

    try {
        await db('jobs_conciliacao').where({ id }).update(update);
    } catch (err: any) {
        const msg = err && (err.message || String(err)) || '';
        if (msg.includes('no such column') || msg.includes('no column named') || /no such column: export_progress/.test(msg) || /no such column: export_status/.test(msg)) {
            try {
                await db.schema.table('jobs_conciliacao', t => {
                    try { t.integer('export_progress').nullable(); } catch (_) { }
                    try { t.string('export_status').nullable(); } catch (_) { }
                });
                await db('jobs_conciliacao').where({ id }).update(update);
            } catch (addErr) {
                throw addErr;
            }
        } else {
            throw err;
        }
    }

    return await db('jobs_conciliacao').where({ id }).first();
}

export default { createJob, updateJobStatus, getJobById };
