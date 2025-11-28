import { Router, Request, Response } from 'express';
import multer from 'multer';
import { fileStorage } from '../infra/storage/FileStorage';
import db from '../db/knex';
import ExcelIngestService from '../services/ExcelIngestService';
import { spawn } from 'child_process';
import path from 'path';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

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

        res.json({ data: rows, page, pageSize, total: Number(count) });
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

router.post('/', upload.single('arquivo'), async (req: Request, res: Response) => {
    try {
        const { tipo, nome, periodo } = req.body;
        if (!tipo || !['CONTABIL', 'FISCAL'].includes(tipo)) {
            return res.status(400).json({ error: 'Campo "tipo" inválido. Use CONTABIL ou FISCAL.' });
        }
        if (!nome) {
            return res.status(400).json({ error: 'Campo "nome" é obrigatório.' });
        }
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: 'Campo "arquivo" é obrigatório.' });
        }

        // Save file using storage service
        const savedPath = await fileStorage.saveFile(file.buffer, file.originalname || 'upload.bin');

        // parse optional header position fields (1-based)
        const header_linha_inicial = Number(req.body.header_linha_inicial || 1);
        const header_coluna_inicial = Number(req.body.header_coluna_inicial || 1);
        if (Number.isNaN(header_linha_inicial) || header_linha_inicial < 1) return res.status(400).json({ error: 'Campo "header_linha_inicial" inválido' });
        if (Number.isNaN(header_coluna_inicial) || header_coluna_inicial < 1) return res.status(400).json({ error: 'Campo "header_coluna_inicial" inválido' });

        // Insert record in DB
        const [id] = await db('bases').insert({
            tipo,
            nome,
            periodo: periodo || null,
            arquivo_caminho: savedPath,
            tabela_sqlite: null,
            header_linha_inicial,
            header_coluna_inicial
        });

        // After creating DB record, start conversion to JSONL in background
        // determine absolute paths
        const absInput = path.resolve(process.cwd(), savedPath);
        const ingestsDir = path.resolve(process.cwd(), 'storage', 'ingests');
        await (async () => { try { const fs = await import('fs/promises'); await fs.mkdir(ingestsDir, { recursive: true }); } catch (e) { } })();
        const jsonlFilename = `${id}.jsonl`;
        const jsonlRel = path.relative(process.cwd(), path.join(ingestsDir, jsonlFilename)).split(path.sep).join(path.posix.sep);

        // mark conversion PENDING; converter worker (separate service) will pick this up
        await db('bases').where({ id }).update({ conversion_status: 'PENDING', arquivo_jsonl_path: null });

        const created = await db('bases').where({ id }).first();

        res.status(201).json(created);
    } catch (err: any) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao processar upload' });
    }
});

router.post('/:id/ingest', async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const result = await ExcelIngestService.ingest(id);
        res.json({ table: result.tableName, rows: result.rowsInserted });
    } catch (err: any) {
        console.error(err);
        res.status(500).json({ error: err.message || 'Ingest failed' });
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


