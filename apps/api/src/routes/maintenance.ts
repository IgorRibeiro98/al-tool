import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import db from '../db/knex';
import { EXPORT_DIR } from '../config/paths';

const router = Router();

async function emptyDir(dirPath: string): Promise<number> {
    try {
        await fs.access(dirPath);
    } catch (e) {
        return 0; // nothing to do
    }
    const entries = await fs.readdir(dirPath);
    let count = 0;
    for (const name of entries) {
        const abs = path.join(dirPath, name);
        try {
            const st = await fs.lstat(abs);
            if (st.isDirectory()) {
                await fs.rm(abs, { recursive: true, force: true });
            } else {
                await fs.unlink(abs);
            }
            count += 1;
        } catch (e) {
            // ignore individual failures
        }
    }
    return count;
}

// POST /maintenance/cleanup
// Deletes files in storage/uploads and storage/ingests, drops tables named base_<id>,
// removes base_columns entries and clears bases.tabela_sqlite. Returns a summary.
router.post('/cleanup', async (req: Request, res: Response) => {
    try {
        const uploadsDir = path.resolve(process.cwd(), 'storage', 'uploads');
        const ingestsDir = path.resolve(process.cwd(), 'storage', 'ingests');
        const exportsDir = EXPORT_DIR;
        // Also include absolute path used in some environments
        const ingestsDirAbs = path.resolve('/var/www/html/al-tool/al-tool/storage/ingests');

        let deletedUploads = 0;
        let deletedIngests = 0;
        let droppedTables: string[] = [];
        let deletedExports = 0;
        let deletedBases = 0;
        let droppedResultTables: string[] = [];
        let deletedJobs = 0;

        deletedUploads = await emptyDir(uploadsDir);
        // attempt to clear both candidate ingests directories and sum results
        deletedIngests += await emptyDir(ingestsDir);
        if (ingestsDirAbs !== ingestsDir) {
            deletedIngests += await emptyDir(ingestsDirAbs);
        }
        deletedExports = await emptyDir(exportsDir);

        // drop tables that start with base_
        const tbls: any = await db.raw("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'base_%'");
        const rows = Array.isArray(tbls) ? tbls : (tbls && tbls[0]) ? tbls[0] : [];
        // different results shape depending on knex/better-sqlite3, normalize
        let names: string[] = rows.map((r: any) => (r.name || r.NAME || Object.values(r)[0]));
        // exclude important metadata tables that start with base_ but must not be dropped
        names = names.filter(n => n && n !== 'base_columns' && n !== 'bases');
        for (const t of names) {
            if (!t) continue;
            try {
                const exists = await db.schema.hasTable(t);
                if (exists) {
                    await db.schema.dropTableIfExists(t);
                    droppedTables.push(t);
                }
            } catch (e) {
                // ignore
            }
        }

        // drop conciliation result tables
        const tblsResult: any = await db.raw("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'conciliacao_result_%'");
        const rowsResult = Array.isArray(tblsResult) ? tblsResult : (tblsResult && tblsResult[0]) ? tblsResult[0] : [];
        const resultNames: string[] = rowsResult.map((r: any) => (r.name || r.NAME || Object.values(r)[0]));
        for (const t of resultNames) {
            if (!t) continue;
            try {
                const exists = await db.schema.hasTable(t);
                if (exists) {
                    await db.schema.dropTableIfExists(t);
                    droppedResultTables.push(t);
                }
            } catch (_) {}
        }

        // clear base metadata: remove base_columns for bases where tabela_sqlite was dropped, and set tabela_sqlite = NULL
        try {
            const bases = await db('bases').select('id', 'tabela_sqlite');
            for (const b of bases) {
                if (b.tabela_sqlite) {
                    const tn = b.tabela_sqlite;
                    if (droppedTables.includes(tn)) {
                        try { await db('base_columns').where({ base_id: b.id }).del(); } catch (e) { }
                    }
                }
                try { await db('base_columns').where({ base_id: b.id }).del(); } catch (e) { }
                try { await db('bases').where({ id: b.id }).del(); deletedBases += 1; } catch (e) { }
            }
        } catch (e) {
            // ignore
        }

        // delete conciliation jobs
        try {
            const jobs = await db('jobs_conciliacao').select('id');
            if (jobs && jobs.length > 0) {
                try { await db('jobs_conciliacao').del(); deletedJobs = jobs.length; } catch (e) { }
            }
        } catch (e) {
            // ignore
        }

        return res.json({
            deletedUploads,
            deletedIngests,
            deletedExports,
            droppedTables,
            droppedResultTables,
            deletedBases,
            deletedJobs,
            message: 'cleanup finished'
        });
    } catch (err: any) {
        console.error('Maintenance cleanup error', err);
        return res.status(400).json({ error: 'cleanup failed', details: err && err.message });
    }
});

export default router;

// POST /maintenance/cleanup/storage
// Deletes files in storage/uploads, storage/ingests and EXPORT_DIR without touching the database.
router.post('/cleanup/storage', async (req: Request, res: Response) => {
    try {
        const uploadsDir = path.resolve(process.cwd(), 'storage', 'uploads');
        const ingestsDir = path.resolve(process.cwd(), 'storage', 'ingests');
        const ingestsDirAbs = path.resolve('/var/www/html/al-tool/al-tool/storage/ingests');
        const exportsDir = EXPORT_DIR;

        let deletedUploads = 0;
        let deletedIngests = 0;
        let deletedExports = 0;

        deletedUploads = await emptyDir(uploadsDir);
        deletedIngests += await emptyDir(ingestsDir);
        if (ingestsDirAbs !== ingestsDir) {
            deletedIngests += await emptyDir(ingestsDirAbs);
        }
        deletedExports = await emptyDir(exportsDir);

        return res.json({
            deletedUploads,
            deletedIngests,
            deletedExports,
            message: 'storage cleanup finished'
        });
    } catch (err: any) {
        console.error('Maintenance storage cleanup error', err);
        return res.status(400).json({ error: 'storage cleanup failed', details: err && err.message });
    }
});

// POST /maintenance/cleanup-results
// Drops conciliation result tables and deletes export files for jobs older than TTL.
router.post('/cleanup/results', async (req: Request, res: Response) => {
    try {
        const ttlDays = Number(process.env.CLEANUP_RESULTS_TTL_DAYS || 7);
        const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);

        const jobs = await db('jobs_conciliacao')
            .whereIn('status', ['DONE', 'FAILED', 'CANCELLED'])
            .andWhere('updated_at', '<', cutoff.toISOString())
            .select('id', 'arquivo_exportado');

        const droppedTables: string[] = [];
        const deletedExports: string[] = [];
        let updatedJobs = 0;

        const safeUnlink = async (p: string) => {
            if (!p) return false;
            const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
            try {
                await fs.access(abs);
            } catch (_) {
                return false;
            }
            try {
                await fs.unlink(abs);
                return true;
            } catch (_) {
                return false;
            }
        };

        for (const job of jobs) {
            const table = `conciliacao_result_${job.id}`;
            try {
                const has = await db.schema.hasTable(table);
                if (has) {
                    await db.schema.dropTableIfExists(table);
                    droppedTables.push(table);
                }
            } catch (_) {}

            if (job.arquivo_exportado) {
                const deleted = await safeUnlink(job.arquivo_exportado);
                if (deleted) deletedExports.push(job.arquivo_exportado);
            }

            try {
                await db('jobs_conciliacao').where({ id: job.id }).update({ arquivo_exportado: null });
                updatedJobs += 1;
            } catch (_) {}
        }

        // Delete stray exports older than TTL in EXPORT_DIR
        let deletedStray = 0;
        try {
            await fs.mkdir(EXPORT_DIR, { recursive: true });
            const entries = await fs.readdir(EXPORT_DIR);
            for (const name of entries) {
                const abs = path.join(EXPORT_DIR, name);
                try {
                    const st = await fs.lstat(abs);
                    if (st.isFile() && st.mtime < cutoff) {
                        await fs.unlink(abs);
                        deletedStray += 1;
                    }
                } catch (_) {}
            }
        } catch (_) {}

        return res.json({
            cutoff: cutoff.toISOString(),
            ttlDays,
            droppedTables,
            deletedExports,
            deletedStray,
            updatedJobs,
            message: 'cleanup results finished'
        });
    } catch (err: any) {
        console.error('Maintenance cleanup results error', err);
        return res.status(400).json({ error: 'cleanup results failed', details: err && err.message });
    }
});
