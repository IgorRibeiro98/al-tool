import { Router, Request, Response } from 'express';
import multer from 'multer';
import { fileStorage } from '../infra/storage/FileStorage';
import db from '../db/knex';
import ExcelIngestService from '../services/ExcelIngestService';
import * as ingestRepo from '../repos/ingestJobsRepository';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

function forceArray<T = string>(value: T | T[] | undefined | null): T[] {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
}

function pickValue<T = any>(list: T[], index: number): T | undefined {
    if (!list.length) return undefined;
    if (list.length === 1) return list[0];
    return list[index];
}

async function ensureIngestDirectory() {
    const ingestsDir = path.resolve(process.cwd(), 'storage', 'ingests');
    try {
        await fs.mkdir(ingestsDir, { recursive: true });
    } catch (err) {
        console.error('Failed to ensure ingest directory', err);
    }
}

// GET /bases - list with pagination and optional filters
router.get('/', async (req: Request, res: Response) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize) || 20));
        const tipo = req.query.tipo as string | undefined;
        const periodo = req.query.periodo as string | undefined;

        const qb = db('bases').select('*');
        if (tipo) qb.where('tipo', tipo);
        if (periodo) qb.where('periodo', periodo);

        const [{ count }] = await db.count('* as count').from(qb.clone().as('sub')) as any[];

        const rows = await qb.offset((page - 1) * pageSize).limit(pageSize);

        // determine ingest status for the returned bases (whether there is any PENDING/RUNNING ingest job)
        const baseIds = rows.map((r: any) => r.id).filter(Boolean);
        let ingestInProgressSet = new Set<number>();
        if (baseIds.length > 0) {
            const active = await db('ingest_jobs')
                .whereIn('base_id', baseIds)
                .whereIn('status', ['PENDING', 'RUNNING'])
                .select('base_id')
                .groupBy('base_id');
            ingestInProgressSet = new Set(active.map((a: any) => a.base_id));
        }

        const enriched = rows.map((r: any) => ({ ...r, ingest_in_progress: ingestInProgressSet.has(r.id) }));

        res.json({ data: enriched, page, pageSize, total: Number(count) });
    } catch (err: any) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao listar bases' });
    }
});

// GET /bases/:id - details for a single base
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const base = await db('bases').where({ id }).first();
        if (!base) return res.status(404).json({ error: 'Base not found' });

        const result: any = { ...base };
        // attach latest ingest job info (if any)
        try {
            const latest = await db('ingest_jobs').where({ base_id: id }).orderBy('id', 'desc').first();
            if (latest) {
                result.ingest_job = latest;
                result.ingest_status = latest.status;
                result.ingest_in_progress = latest.status === 'PENDING' || latest.status === 'RUNNING';
            } else {
                result.ingest_job = null;
                result.ingest_status = null;
                result.ingest_in_progress = false;
            }
        } catch (e) {
            result.ingest_job = null;
            result.ingest_status = null;
            result.ingest_in_progress = false;
        }
        if (base.tabela_sqlite) {
            // try to count rows in the table if it exists
            try {
                const [{ cnt }] = await db.raw(`select count(1) as cnt from "${base.tabela_sqlite}"`)
                    .then((r: any) => r && r); // knex returns different shapes per dialect
                result.rowCount = Number(cnt ?? ((r: any) => r));
            } catch (e) {
                // ignore count errors
                result.rowCount = null;
            }
        }

        res.json(result);
    } catch (err: any) {
        console.error(err);
        res.status(400).json({ error: 'Erro ao obter base' });
    }
});

router.get('/:id/columns', async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const base = await db('bases').where({ id }).first();
        if (!base) return res.status(404).json({ error: 'Base not found' });

        const cols = await db('base_columns')
            .where({ base_id: id })
            .select('*')
            .orderBy('col_index', 'asc');

        return res.json({ data: cols });
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Erro ao obter base' });
    }
})

router.post('/', upload.array('arquivo'), async (req: Request, res: Response) => {
    try {
        const files = (req.files || []) as Express.Multer.File[];
        if (!files.length) {
            return res.status(400).json({ error: 'Pelo menos um arquivo deve ser enviado.' });
        }

        const tipos = forceArray<string>(req.body.tipo as any);
        const nomes = forceArray<string>(req.body.nome as any);
        const periodos = forceArray<string>(req.body.periodo as any);
        const headerLinhas = forceArray<string | number>(req.body.header_linha_inicial as any);
        const headerColunas = forceArray<string | number>(req.body.header_coluna_inicial as any);

        await ensureIngestDirectory();

        const createdRows: any[] = [];

        for (let index = 0; index < files.length; index++) {
            const file = files[index];
            const tipoValue = pickValue(tipos, index);
            const nomeValue = pickValue(nomes, index);
            const periodoValue = pickValue(periodos, index);
            const headerLinhaValue = pickValue(headerLinhas, index);
            const headerColunaValue = pickValue(headerColunas, index);

            if (!tipoValue || !['CONTABIL', 'FISCAL'].includes(tipoValue)) {
                return res.status(400).json({ error: `Campo "tipo" inválido para o arquivo ${file.originalname}. Use CONTABIL ou FISCAL.` });
            }
            if (!nomeValue) {
                return res.status(400).json({ error: `Campo "nome" é obrigatório para o arquivo ${file.originalname}.` });
            }

            const savedPath = await fileStorage.saveFile(file.buffer, file.originalname || 'upload.bin');

            const header_linha_inicial = Number(headerLinhaValue || 1);
            const header_coluna_inicial = Number(headerColunaValue || 1);
            if (Number.isNaN(header_linha_inicial) || header_linha_inicial < 1) {
                return res.status(400).json({ error: `Campo "header_linha_inicial" inválido para o arquivo ${file.originalname}` });
            }
            if (Number.isNaN(header_coluna_inicial) || header_coluna_inicial < 1) {
                return res.status(400).json({ error: `Campo "header_coluna_inicial" inválido para o arquivo ${file.originalname}` });
            }

            const [id] = await db('bases').insert({
                tipo: tipoValue,
                nome: nomeValue,
                periodo: periodoValue || null,
                arquivo_caminho: savedPath,
                tabela_sqlite: null,
                header_linha_inicial,
                header_coluna_inicial
            });

            // marcar conversão como pendente para cada base criada
            await db('bases').where({ id }).update({ conversion_status: 'PENDING', arquivo_jsonl_path: null });

            const created = await db('bases').where({ id }).first();
            createdRows.push(created);
        }

        return res.status(201).json({ data: createdRows });
    } catch (err: any) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao processar upload' });
    }
});

router.post('/:id/ingest', async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        // create an ingest job to be processed by background worker
        const job = await ingestRepo.createJob({ base_id: id, status: 'PENDING' });
        res.status(202).json({ jobId: job.id, status: job.status });
    } catch (err: any) {
        console.error(err);
        res.status(400).json({ error: err.message || 'Enqueue ingest failed' });
    }
});

// DELETE /bases/:id - remove base, its metadata, files and sqlite table
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const base = await db('bases').where({ id }).first();
        if (!base) return res.status(404).json({ error: 'Base not found' });

        // attempt to drop the sqlite table if present
        if (base.tabela_sqlite) {
            try {
                const exists = await db.schema.hasTable(base.tabela_sqlite);
                if (exists) await db.schema.dropTableIfExists(base.tabela_sqlite);
            } catch (e) {
                console.error('Error dropping base table', e);
            }
        }

        // remove base_columns metadata
        try { await db('base_columns').where({ base_id: id }).del(); } catch (e) { }

        // remove ingest jobs for this base
        try { await db('ingest_jobs').where({ base_id: id }).del(); } catch (e) { }

        // attempt to delete stored files (arquivo_caminho, arquivo_jsonl_path)
        try {
            if (base.arquivo_caminho) {
                const abs = path.resolve(process.cwd(), base.arquivo_caminho);
                await fs.unlink(abs).catch(() => { /* ignore */ });
            }
            if (base.arquivo_jsonl_path) {
                const abs2 = path.resolve(process.cwd(), base.arquivo_jsonl_path);
                await fs.unlink(abs2).catch(() => { /* ignore */ });
            }
        } catch (e) {
            console.error('Error deleting base files', e);
        }

        // finally remove base row
        await db('bases').where({ id }).del();

        return res.json({ success: true });
    } catch (err: any) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao deletar base' });
    }
});

// GET /bases/:id/preview - return columns and first N rows from the ingested table
router.get('/:id/preview', async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const base = await db('bases').where({ id }).first();
        if (!base) return res.status(404).json({ error: 'Base not found' });

        if (!base.tabela_sqlite) {
            return res.status(400).json({ error: 'Base not yet ingested (tabela_sqlite is null)' });
        }

        const tableName = base.tabela_sqlite;
        const exists = await db.schema.hasTable(tableName);
        if (!exists) return res.status(404).json({ error: `Table ${tableName} not found in DB` });

        // get columns
        const colInfo = await db(tableName).columnInfo();
        const columns = Object.keys(colInfo || {});

        // fetch first N rows
        const limit = 50;
        const rows = await db.select('*').from(tableName).limit(limit);

        res.json({ columns, rows });
    } catch (err: any) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao gerar preview' });
    }
});

export default router;


