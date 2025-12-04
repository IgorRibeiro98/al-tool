import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import db from '../db/knex';

const router = Router();

// POST /maintenance/cleanup
// Deletes files in storage/uploads and storage/ingests, drops tables named base_<id>,
// removes base_columns entries and clears bases.tabela_sqlite. Returns a summary.
router.post('/cleanup', async (req: Request, res: Response) => {
    try {
        const uploadsDir = path.resolve(process.cwd(), 'storage', 'uploads');
        const ingestsDir = path.resolve(process.cwd(), 'storage', 'ingests');
        // Also include absolute path used in some environments
        const ingestsDirAbs = path.resolve('/var/www/html/al-tool/al-tool/storage/ingests');

        let deletedUploads = 0;
        let deletedIngests = 0;
        let droppedTables: string[] = [];

        // helper to empty directory (non-recursive: deletes files and subdirs)
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

        deletedUploads = await emptyDir(uploadsDir);
        // attempt to clear both candidate ingests directories and sum results
        deletedIngests += await emptyDir(ingestsDir);
        if (ingestsDirAbs !== ingestsDir) {
            deletedIngests += await emptyDir(ingestsDirAbs);
        }

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

        // clear base metadata: remove base_columns for bases where tabela_sqlite was dropped, and set tabela_sqlite = NULL
        try {
            const bases = await db('bases').select('id', 'tabela_sqlite');
            for (const b of bases) {
                if (!b.tabela_sqlite) continue;
                const tn = b.tabela_sqlite;
                if (droppedTables.includes(tn)) {
                    try { await db('base_columns').where({ base_id: b.id }).del(); } catch (e) { }
                    try { await db('bases').where({ id: b.id }).update({ tabela_sqlite: null }); } catch (e) { }
                }
            }
        } catch (e) {
            // ignore
        }

        return res.json({ deletedUploads, deletedIngests, droppedTables, message: 'cleanup finished' });
    } catch (err: any) {
        console.error('Maintenance cleanup error', err);
        return res.status(400).json({ error: 'cleanup failed', details: err && err.message });
    }
});

export default router;
