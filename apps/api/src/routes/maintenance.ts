import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import db from '../db/knex';
import { EXPORT_DIR } from '../config/paths';

const router = Router();

// Constants
const LOG_PREFIX = '[maintenance]';
const STORAGE_DIR = path.resolve(process.cwd(), 'storage');
const UPLOADS_DIR = path.join(STORAGE_DIR, 'uploads');
const INGESTS_DIR = path.join(STORAGE_DIR, 'ingests');
const INGESTS_DIR_ABS = path.resolve('/var/www/html/al-tool/al-tool/storage/ingests');
const DEFAULT_TTL_DAYS = 7;

// Helpers
async function safeAccess(p: string): Promise<boolean> {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}

async function emptyDir(dirPath: string): Promise<number> {
    if (!(await safeAccess(dirPath))) return 0;
    const entries = await fs.readdir(dirPath);
    let deleted = 0;
    for (const name of entries) {
        const abs = path.join(dirPath, name);
        try {
            const st = await fs.lstat(abs);
            if (st.isDirectory()) {
                await fs.rm(abs, { recursive: true, force: true });
            } else {
                await fs.unlink(abs);
            }
            deleted += 1;
        } catch (err) {
            console.warn(LOG_PREFIX, 'failed to remove', abs, err);
        }
    }
    return deleted;
}

async function listTablesLike(pattern: string): Promise<string[]> {
    const raw = await db.raw(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ?`, [pattern]);
    const rows = Array.isArray(raw) ? raw : (raw && raw[0]) ? raw[0] : [];
    return rows.map((r: any) => (r.name || r.NAME || Object.values(r)[0])).filter(Boolean);
}

async function dropTables(tables: string[]): Promise<string[]> {
    const dropped: string[] = [];
    for (const t of tables) {
        if (!t) continue;
        try {
            const exists = await db.schema.hasTable(t);
            if (exists) {
                await db.schema.dropTableIfExists(t);
                dropped.push(t);
            }
        } catch (err) {
            console.warn(LOG_PREFIX, 'failed to drop table', t, err);
        }
    }
    return dropped;
}

async function clearBasesMetadataAndDeleteBases(droppedTables: string[]): Promise<number> {
    let deletedBases = 0;
    try {
        const bases = await db('bases').select('id', 'tabela_sqlite');
        for (const b of bases) {
            try {
                // remove column metadata if the backing table was dropped
                if (b.tabela_sqlite && droppedTables.includes(b.tabela_sqlite)) {
                    await db('base_columns').where({ base_id: b.id }).del();
                }
                // defensive: always attempt to remove associated base_columns
                await db('base_columns').where({ base_id: b.id }).del();
            } catch (err) {
                console.warn(LOG_PREFIX, 'failed to clear base_columns for base', b.id, err);
            }
            try {
                await db('bases').where({ id: b.id }).del();
                deletedBases += 1;
            } catch (err) {
                console.warn(LOG_PREFIX, 'failed to delete base', b.id, err);
            }
        }
    } catch (err) {
        console.warn(LOG_PREFIX, 'failed to list bases', err);
    }
    return deletedBases;
}

async function deleteAllJobsConciliacao(): Promise<number> {
    try {
        const jobs = await db('jobs_conciliacao').select('id');
        if (!jobs || jobs.length === 0) return 0;
        const count = jobs.length;
        await db('jobs_conciliacao').del();
        return count;
    } catch (err) {
        console.warn(LOG_PREFIX, 'failed to delete jobs_conciliacao', err);
        return 0;
    }
}

async function safeUnlink(p?: string): Promise<boolean> {
    if (!p) return false;
    const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
    if (!(await safeAccess(abs))) return false;
    try {
        await fs.unlink(abs);
        return true;
    } catch (err) {
        console.warn(LOG_PREFIX, 'failed to unlink', abs, err);
        return false;
    }
}

// Routes
router.post('/cleanup', async (_req: Request, res: Response) => {
    try {
        const deletedUploads = await emptyDir(UPLOADS_DIR);
        let deletedIngests = await emptyDir(INGESTS_DIR);
        if (INGESTS_DIR_ABS !== INGESTS_DIR) {
            deletedIngests += await emptyDir(INGESTS_DIR_ABS);
        }
        const deletedExports = await emptyDir(EXPORT_DIR);

        // Drop base_* tables but exclude metadata tables
        const baseTables = await listTablesLike('base_%');
        const filteredBaseTables = baseTables.filter((n) => n !== 'base_columns' && n !== 'bases');
        const droppedTables = await dropTables(filteredBaseTables);

        // Drop conciliacao_result_* tables
        const resultTables = await listTablesLike('conciliacao_result_%');
        const droppedResultTables = await dropTables(resultTables);

        const deletedBases = await clearBasesMetadataAndDeleteBases(droppedTables);
        const deletedJobs = await deleteAllJobsConciliacao();

        return res.json({
            deletedUploads,
            deletedIngests,
            deletedExports,
            droppedTables,
            droppedResultTables,
            deletedBases,
            deletedJobs,
            message: 'cleanup finished',
        });
    } catch (err: any) {
        console.error(LOG_PREFIX, 'cleanup error', err);
        return res.status(400).json({ error: 'cleanup failed', details: err && err.message });
    }
});

// POST /maintenance/cleanup/storage
// Deletes files in storage/uploads, storage/ingests and EXPORT_DIR without touching the database.
router.post('/cleanup/storage', async (_req: Request, res: Response) => {
    try {
        const deletedUploads = await emptyDir(UPLOADS_DIR);
        let deletedIngests = await emptyDir(INGESTS_DIR);
        if (INGESTS_DIR_ABS !== INGESTS_DIR) {
            deletedIngests += await emptyDir(INGESTS_DIR_ABS);
        }
        const deletedExports = await emptyDir(EXPORT_DIR);

        return res.json({ deletedUploads, deletedIngests, deletedExports, message: 'storage cleanup finished' });
    } catch (err: any) {
        console.error(LOG_PREFIX, 'storage cleanup error', err);
        return res.status(400).json({ error: 'storage cleanup failed', details: err && err.message });
    }
});

// POST /maintenance/cleanup-results
// Drops conciliation result tables and deletes export files for jobs older than TTL.
router.post('/cleanup/results', async (_req: Request, res: Response) => {
    try {
        const ttlDays = Number(process.env.CLEANUP_RESULTS_TTL_DAYS || DEFAULT_TTL_DAYS);
        const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);

        const jobs = await db('jobs_conciliacao')
            .whereIn('status', ['DONE', 'FAILED', 'CANCELLED'])
            .andWhere('updated_at', '<', cutoff.toISOString())
            .select('id', 'arquivo_exportado');

        const droppedTables: string[] = [];
        const deletedExports: string[] = [];
        let updatedJobs = 0;

        for (const job of jobs) {
            const table = `conciliacao_result_${job.id}`;
            try {
                const has = await db.schema.hasTable(table);
                if (has) {
                    await db.schema.dropTableIfExists(table);
                    droppedTables.push(table);
                }
            } catch (err) {
                console.warn(LOG_PREFIX, 'failed to drop result table', table, err);
            }

            if (job.arquivo_exportado) {
                const deleted = await safeUnlink(job.arquivo_exportado);
                if (deleted) deletedExports.push(job.arquivo_exportado);
            }

            try {
                await db('jobs_conciliacao').where({ id: job.id }).update({ arquivo_exportado: null });
                updatedJobs += 1;
            } catch (err) {
                console.warn(LOG_PREFIX, 'failed to clear arquivo_exportado for job', job.id, err);
            }
        }

        // Delete stray exports older than TTL in EXPORT_DIR
        let deletedStray = 0;
        try {
            if (!(await safeAccess(EXPORT_DIR))) {
                await fs.mkdir(EXPORT_DIR, { recursive: true });
            }
            const entries = await fs.readdir(EXPORT_DIR);
            for (const name of entries) {
                const abs = path.join(EXPORT_DIR, name);
                try {
                    const st = await fs.lstat(abs);
                    if (st.isFile() && st.mtime < cutoff) {
                        await fs.unlink(abs);
                        deletedStray += 1;
                    }
                } catch (err) {
                    console.warn(LOG_PREFIX, 'failed to inspect or delete stray export', abs, err);
                }
            }
        } catch (err) {
            console.warn(LOG_PREFIX, 'failed to clean exports dir', err);
        }

        return res.json({
            cutoff: cutoff.toISOString(),
            ttlDays,
            droppedTables,
            deletedExports,
            deletedStray,
            updatedJobs,
            message: 'cleanup results finished',
        });
    } catch (err: any) {
        console.error(LOG_PREFIX, 'cleanup results error', err);
        return res.status(400).json({ error: 'cleanup results failed', details: err && err.message });
    }
});

export default router;
