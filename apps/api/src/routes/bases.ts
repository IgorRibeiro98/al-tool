import { Router, Request, Response } from 'express';
import multer from 'multer';
import { fileStorage } from '../infra/storage/FileStorage';
import db from '../db/knex';
import * as ingestRepo from '../repos/ingestJobsRepository';
import path from 'path';
import fs from 'fs/promises';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

const DEFAULT_PAGE_SIZE = Math.max(1, Number(process.env.API_DEFAULT_PAGE_SIZE || 20));
const MAX_PAGE_SIZE = Math.max(1, Number(process.env.API_MAX_PAGE_SIZE || 100));

function parsePagination(req: Request) {
    const page = Math.max(1, Number(req.query.page) || 1);
    const requestedSize = Number(req.query.pageSize || req.query.limit) || DEFAULT_PAGE_SIZE;
    const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, requestedSize));
    return { page, pageSize };
}

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

function parseIdParam(req: Request): { ok: boolean; id?: number; error?: string } {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return { ok: false, error: 'Invalid id' };
    return { ok: true, id };
}

async function findBaseById(id: number) {
    return await db('bases').where({ id }).first();
}

async function getLatestJobMapForBaseIds(baseIds: number[]) {
    const map = new Map<number, any>();
    if (!baseIds.length) return map;
    const latestIds = await db('ingest_jobs')
        .whereIn('base_id', baseIds)
        .groupBy('base_id')
        .select('base_id')
        .max('id as id');

    const idList = latestIds.map((j: any) => j.id).filter(Boolean);
    if (!idList.length) return map;

    const jobs = await db('ingest_jobs')
        .whereIn('id', idList)
        .select('id', 'base_id', 'status', 'erro', 'created_at', 'updated_at');

    for (const job of jobs) map.set(job.base_id, job);
    return map;
}

async function safeCountTableRows(tableName: string) {
    try {
        const raw = await db.raw(`select count(1) as cnt from "${tableName}"`);
        // knex returns different shapes depending on dialect; normalize
        const row = Array.isArray(raw) ? raw[0] : raw;
        const cnt = row && (row.cnt ?? row[0]?.cnt ?? row.count);
        return Number(cnt ?? 0);
    } catch (_) {
        return null;
    }
}

// GET /bases - list with pagination and optional filters
router.get('/', async (req: Request, res: Response) => {
    try {
        const { page, pageSize } = parsePagination(req);
        const tipo = req.query.tipo as string | undefined;
        const periodo = req.query.periodo as string | undefined;
        const subtype = req.query.subtype as string | undefined;

        // Build query for rows
        const qb = db('bases').select('*').orderBy('created_at', 'desc').orderBy('id', 'desc');
        if (tipo) qb.where('tipo', tipo);
        if (periodo) qb.where('periodo', periodo);
        if (subtype) qb.where('subtype', subtype);

        // Compute total safely by applying the same filters to a count query.
        // Some knex dialects return different shapes for raw counts, so normalize.
        const countRow: any = (await db('bases')
            .count('* as count')
            .modify((mqb: any) => {
                if (tipo) mqb.where('tipo', tipo);
                if (periodo) mqb.where('periodo', periodo);
                if (subtype) mqb.where('subtype', subtype);
            })
            .first()) || { count: 0 };

        const rows = await qb.offset((page - 1) * pageSize).limit(pageSize);

        const baseIds = rows.map((r: any) => r.id).filter(Boolean);
        const latestJobByBase = await getLatestJobMapForBaseIds(baseIds);

        const enriched = rows.map((r: any) => {
            const latestJob = latestJobByBase.get(r.id) || null;
            const ingestStatus = latestJob?.status ?? null;
            const ingestInProgress = ingestStatus === 'PENDING' || ingestStatus === 'RUNNING';
            return {
                ...r,
                ingest_in_progress: ingestInProgress,
                ingest_status: ingestStatus,
                ingest_job: latestJob
            };
        });

        const total = Number(countRow.count ?? countRow['count'] ?? 0);
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        res.json({ data: enriched, page, pageSize, total, totalPages });
    } catch (err: any) {
        console.error(err);
        res.status(400).json({ error: 'Erro ao listar bases' });
    }
});

// Base subtypes CRUD
// GET /bases/subtypes
router.get('/subtypes', async (req: Request, res: Response) => {
    try {
        const exists = await db.schema.hasTable('base_subtypes');
        if (!exists) return res.json({ data: [] });

        const rows = await db('base_subtypes').select('*').orderBy('created_at', 'desc');
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Erro ao listar subtypes' });
    }
});

// POST /bases/subtypes { name, [tipo] }
// 'tipo' is optional now — keep compatibility with existing schema by
// storing an empty string when omitted (avoids migrations on sqlite).
router.post('/subtypes', async (req: Request, res: Response) => {
    try {
        const existsP = await db.schema.hasTable('base_subtypes');
        if (!existsP) return res.status(400).json({ error: 'Tabela base_subtypes não disponível' });

        const { name } = req.body || {};
        if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name inválido' });
        const [id] = await db('base_subtypes').insert({ name });
        const created = await db('base_subtypes').where({ id }).first();
        res.status(201).json({ data: created });
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Erro ao criar subtype' });
    }
});

// DELETE /bases/subtypes/:id
router.delete('/subtypes/:id', async (req: Request, res: Response) => {
    try {
        const exists = await db.schema.hasTable('base_subtypes');
        if (!exists) return res.status(404).json({ error: 'Subtype não encontrado' });

        const id = Number(req.params.id);
        if (Number.isNaN(id) || id <= 0) return res.status(400).json({ error: 'id inválido' });
        await db('base_subtypes').where({ id }).del();
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Erro ao deletar subtype' });
    }
});

// GET /bases/subtypes/:id
router.get('/subtypes/:id', async (req: Request, res: Response) => {
    try {
        const exists = await db.schema.hasTable('base_subtypes');
        if (!exists) return res.status(404).json({ error: 'Subtype não encontrado' });

        const id = Number(req.params.id);
        if (Number.isNaN(id) || id <= 0) return res.status(400).json({ error: 'id inválido' });
        const row = await db('base_subtypes').where({ id }).first();
        if (!row) return res.status(404).json({ error: 'Subtype não encontrado' });
        res.json({ data: row });
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Erro ao obter subtype' });
    }
});

// PUT /bases/subtypes/:id { name, [tipo] }
// 'tipo' is optional — only validate/update when provided
router.put('/subtypes/:id', async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id) || id <= 0) return res.status(400).json({ error: 'id inválido' });

        const exists = await db.schema.hasTable('base_subtypes');
        if (!exists) return res.status(404).json({ error: 'Subtype não encontrado' });

        const existing = await db('base_subtypes').where({ id }).first();
        if (!existing) return res.status(404).json({ error: 'Subtype não encontrado' });

        const { name } = req.body || {};
        const update: any = {};
        if (typeof name !== 'undefined') {
            if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name inválido' });
            update.name = name;
        }
        if (!Object.keys(update).length) return res.status(400).json({ error: 'Nenhum campo para atualizar' });

        await db('base_subtypes').where({ id }).update(update);
        const updated = await db('base_subtypes').where({ id }).first();
        res.json({ data: updated });
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Erro ao atualizar subtype' });
    }
});

// GET /bases/:id - details for a single base
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const parsed = parseIdParam(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const id = parsed.id as number;

        const base = await findBaseById(id);
        if (!base) return res.status(404).json({ error: 'Base not found' });

        const result: any = { ...base };
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

        if (base.tabela_sqlite) {
            result.rowCount = await safeCountTableRows(base.tabela_sqlite);
        }

        res.json(result);
    } catch (err: any) {
        console.error(err);
        res.status(400).json({ error: 'Erro ao obter base' });
    }
});

// PATCH /bases/:id - update base metadata (partial)
router.patch('/:id', async (req: Request, res: Response) => {
    try {
        const parsed = parseIdParam(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const id = parsed.id as number;

        const base = await findBaseById(id);
        if (!base) return res.status(404).json({ error: 'Base not found' });

        const { nome, periodo, header_linha_inicial, header_coluna_inicial, subtype, reference_base_id } = req.body || {};

        const update: any = {};
        if (typeof nome !== 'undefined') update.nome = nome;
        if (typeof periodo !== 'undefined') update.periodo = periodo;
        if (typeof header_linha_inicial !== 'undefined') update.header_linha_inicial = header_linha_inicial ? Number(header_linha_inicial) : null;
        if (typeof header_coluna_inicial !== 'undefined') update.header_coluna_inicial = header_coluna_inicial ? Number(header_coluna_inicial) : null;
        if (typeof subtype !== 'undefined') {
            if (!subtype || typeof subtype !== 'string') return res.status(400).json({ error: 'subtype inválido ou vazio' });
            update.subtype = subtype;
        }
        if (typeof reference_base_id !== 'undefined') update.reference_base_id = reference_base_id ? Number(reference_base_id) : null;

        if (!Object.keys(update).length) return res.status(400).json({ error: 'Nenhum campo para atualizar' });

        // if reference_base_id provided, ensure it exists and matches tipo/subtype if applicable
        if (update.reference_base_id) {
            const ref = await findBaseById(update.reference_base_id);
            if (!ref) return res.status(400).json({ error: 'reference_base_id não encontrado' });
            // optional: ensure same tipo
            if (ref.tipo !== base.tipo) return res.status(400).json({ error: 'reference_base must have same tipo' });
            if (update.subtype && ref.subtype !== update.subtype) return res.status(400).json({ error: 'reference_base must have same subtype' });
        }

        await db('bases').where({ id }).update(update);
        const updated = await findBaseById(id);
        return res.json({ data: updated });
    } catch (err: any) {
        console.error(err);
        res.status(400).json({ error: 'Erro ao atualizar base' });
    }
});

router.get('/:id/columns', async (req: Request, res: Response) => {
    try {
        const parsed = parseIdParam(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const id = parsed.id as number;

        const base = await findBaseById(id);
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
});

// PATCH /bases/:id/columns/:colId - update metadata for a base column (e.g., is_monetary)
router.patch('/:id/columns/:colId', async (req: Request, res: Response) => {
    try {
        const parsed = parseIdParam(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const id = parsed.id as number;

        const colId = Number(req.params.colId);
        if (Number.isNaN(colId) || colId <= 0) return res.status(400).json({ error: 'Invalid column id' });

        const { is_monetary } = req.body || {};
        if (typeof is_monetary === 'undefined' || (Number(is_monetary) !== 0 && Number(is_monetary) !== 1 && typeof is_monetary !== 'boolean')) {
            return res.status(400).json({ error: 'is_monetary must be 0 or 1 (or boolean)' });
        }

        const base = await findBaseById(id);
        if (!base) return res.status(404).json({ error: 'Base not found' });

        // ensure the column belongs to this base
        const existing = await db('base_columns').where({ id: colId, base_id: id }).first();
        if (!existing) return res.status(404).json({ error: 'Column not found for this base' });

        const val = Number(is_monetary) === 1 || is_monetary === true ? 1 : 0;
        await db('base_columns').where({ id: colId }).update({ is_monetary: val });

        try { const baseColsRepo = require('../repos/baseColumnsRepository').default; if (baseColsRepo && typeof baseColsRepo.clearColumnsCache === 'function') baseColsRepo.clearColumnsCache(id); } catch (_) { }

        const updated = await db('base_columns').where({ id: colId }).first();
        return res.json({ success: true, data: updated });
    } catch (err: any) {
        console.error(err);
        res.status(400).json({ error: 'Erro ao atualizar coluna' });
    }
});

// POST /bases/:id/reuse-monetary
// Copy monetary column flags from source base to a set of target bases.
// Body options:
// - targetBaseIds?: number[]           // explicit list of target base ids
// - applyToSameTipo?: boolean          // when true, apply to all bases with same `tipo` (excluding source)
// - matchBy?: 'excel_name'|'sqlite_name' // how to match columns between bases (default 'excel_name')
// - override?: boolean                 // when true, overwrite target flags; default false (only set when null)
router.post('/:id/reuse-monetary', async (req: Request, res: Response) => {
    try {
        const parsed = parseIdParam(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const sourceId = parsed.id as number;

        const { targetBaseIds, applyToSameTipo, matchBy = 'excel_name', override = false } = req.body || {};

        const source = await findBaseById(sourceId);
        if (!source) return res.status(404).json({ error: 'Source base not found' });

        // collect target ids
        let targets: number[] = Array.isArray(targetBaseIds) ? targetBaseIds.map(Number).filter(n => Number.isInteger(n) && n > 0) : [];

        if (applyToSameTipo) {
            const rows = await db('bases').where({ tipo: source.tipo }).select('id');
            const ids = rows.map((r: any) => r.id).filter((id: number) => id !== sourceId);
            targets = Array.from(new Set([...targets, ...ids]));
        }

        if (!targets.length) return res.status(400).json({ error: 'No target bases specified (use targetBaseIds or set applyToSameTipo=true)' });

        // load source columns
        const sourceCols = await db('base_columns').where({ base_id: sourceId }).select('*');
        if (!sourceCols || !sourceCols.length) return res.status(400).json({ error: 'Source base has no columns to copy' });

        // build map of key -> is_monetary (only values that are 1)
        const keyField = matchBy === 'sqlite_name' ? 'sqlite_name' : 'excel_name';
        const sourceMap = new Map<string, number>();
        for (const sc of sourceCols) {
            if (sc[keyField] && (Number(sc.is_monetary) === 1)) {
                sourceMap.set(String(sc[keyField]), 1);
            }
        }

        if (!sourceMap.size) return res.status(400).json({ error: 'Source base has no columns marked as monetary to copy' });

        // apply to each target base
        const details: Array<{ baseId: number; updated: number }> = [];
        await db.transaction(async trx => {
            for (const tid of targets) {
                const targetCols = await trx('base_columns').where({ base_id: tid }).select('*');
                if (!targetCols || !targetCols.length) { details.push({ baseId: tid, updated: 0 }); continue; }

                let updatedCount = 0;
                for (const tc of targetCols) {
                    const key = String(tc[keyField] ?? '');
                    if (!key) continue;
                    if (!sourceMap.has(key)) continue;
                    const desired = sourceMap.get(key) as number;
                    const current = tc.is_monetary === null || typeof tc.is_monetary === 'undefined' ? null : Number(tc.is_monetary);
                    if (!override && current !== null && typeof current !== 'undefined') continue;
                    await trx('base_columns').where({ id: tc.id }).update({ is_monetary: desired });
                    updatedCount++;
                }
                details.push({ baseId: tid, updated: updatedCount });
            }
        });

        // clear cache for affected bases
        try { const baseColsRepo = require('../repos/baseColumnsRepository').default; if (baseColsRepo && typeof baseColsRepo.clearColumnsCache === 'function') { for (const t of targets) baseColsRepo.clearColumnsCache(t); } } catch (_) { }

        return res.json({ success: true, details });
    } catch (err: any) {
        console.error(err);
        res.status(400).json({ error: 'Erro ao reaplicar flags monetárias' });
    }
});

router.post('/', upload.array('arquivo'), async (req: Request, res: Response) => {
    try {
        const files = (req.files || []) as Express.Multer.File[];
        if (!files.length) return res.status(400).json({ error: 'Pelo menos um arquivo deve ser enviado.' });

        const tipos = forceArray<string>(req.body.tipo as any);
        const nomes = forceArray<string>(req.body.nome as any);
        const periodos = forceArray<string>(req.body.periodo as any);
        const headerLinhas = forceArray<string | number>(req.body.header_linha_inicial as any);
        const headerColunas = forceArray<string | number>(req.body.header_coluna_inicial as any);
        const subtypes = forceArray<string>(req.body.subtype as any);
        const referenceBaseIds = forceArray<string | number>(req.body.reference_base_id as any);

        await ensureIngestDirectory();

        const createdRows: any[] = [];

        for (let index = 0; index < files.length; index++) {
            const file = files[index];
            const tipoValue = pickValue(tipos, index);
            const nomeValue = pickValue(nomes, index);
            const periodoValue = pickValue(periodos, index);
            const headerLinhaValue = pickValue(headerLinhas, index);
            const headerColunaValue = pickValue(headerColunas, index);

            if (!tipoValue || !['CONTABIL', 'FISCAL'].includes(tipoValue))
                return res.status(400).json({ error: `Campo "tipo" inválido para o arquivo ${file.originalname}. Use CONTABIL ou FISCAL.` });
            if (!nomeValue) return res.status(400).json({ error: `Campo "nome" é obrigatório para o arquivo ${file.originalname}.` });

            const savedPath = await fileStorage.save(file.buffer, file.originalname || 'upload.bin');

            const header_linha_inicial = Number(headerLinhaValue || 1);
            const header_coluna_inicial = Number(headerColunaValue || 1);
            if (Number.isNaN(header_linha_inicial) || header_linha_inicial < 1)
                return res.status(400).json({ error: `Campo "header_linha_inicial" inválido para o arquivo ${file.originalname}` });
            if (Number.isNaN(header_coluna_inicial) || header_coluna_inicial < 1)
                return res.status(400).json({ error: `Campo "header_coluna_inicial" inválido para o arquivo ${file.originalname}` });

            const subtypeValue = pickValue(subtypes, index);
            if (!subtypeValue || typeof subtypeValue !== 'string') {
                return res.status(400).json({ error: `Campo "subtype" é obrigatório para o arquivo ${file.originalname}.` });
            }
            const referenceValue = pickValue(referenceBaseIds, index);

            const [id] = await db('bases').insert({
                tipo: tipoValue,
                nome: nomeValue,
                periodo: periodoValue || null,
                arquivo_caminho: savedPath,
                tabela_sqlite: null,
                header_linha_inicial,
                header_coluna_inicial,
                subtype: subtypeValue,
                reference_base_id: referenceValue ? Number(referenceValue) : null
            });

            // marcar conversão como pendente para cada base criada
            await db('bases').where({ id }).update({ conversion_status: 'PENDING', arquivo_jsonl_path: null });

            const created = await db('bases').where({ id }).first();
            createdRows.push(created);
        }

        return res.status(201).json({ data: createdRows });
    } catch (err: any) {
        console.error(err);
        res.status(400).json({ error: 'Erro ao processar upload' });
    }
});

router.post('/:id/ingest', async (req: Request, res: Response) => {
    try {
        const parsed = parseIdParam(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const id = parsed.id as number;

        const job = await ingestRepo.createJob({ base_id: id, status: 'PENDING' });
        res.status(202).json({ jobId: job?.id ?? null, status: job?.status ?? null });
    } catch (err: any) {
        console.error(err);
        res.status(400).json({ error: err.message || 'Enqueue ingest failed' });
    }
});

// DELETE /bases/:id - remove base, its metadata, files and sqlite table
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const parsed = parseIdParam(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const id = parsed.id as number;

        const base = await findBaseById(id);
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

        // remove base_columns metadata and ingest jobs (best-effort)
        try { await db('base_columns').where({ base_id: id }).del(); } catch (e) { }
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
        res.status(400).json({ error: 'Erro ao deletar base' });
    }
});

// GET /bases/:id/preview - return columns and first N rows from the ingested table
router.get('/:id/preview', async (req: Request, res: Response) => {
    try {
        const parsed = parseIdParam(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const id = parsed.id as number;

        const base = await findBaseById(id);
        if (!base) return res.status(404).json({ error: 'Base not found' });
        if (!base.tabela_sqlite) return res.status(400).json({ error: 'Base not yet ingested (tabela_sqlite is null)' });

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
        res.status(400).json({ error: 'Erro ao gerar preview' });
    }
});

// Generic helper to create derived columns using a simple operator mapping
async function createDerivedColumn(opts: {
    baseId: number;
    tableName: string;
    sourceColumn: string;
    op: string; // 'ABS' | 'INVERTER' | ...
}) {
    const { baseId, tableName, sourceColumn, op } = opts;
    // validate source column exists in table
    const colInfo = await db(tableName).columnInfo();
    const columns = Object.keys(colInfo || {});
    if (!columns.includes(sourceColumn)) throw new Error(`Source column '${sourceColumn}' not found in table ${tableName}`);

    // sanitize and pick sqlite target column name
    const prefix = String(op).toLowerCase();
    let targetCol = `${prefix}_${sourceColumn}`.toLowerCase();
    targetCol = targetCol.replace(/[^a-z0-9_]/g, '_');
    if (!columns.includes(targetCol)) {
        // add column (use decimal type consistent with ingest)
        await db.schema.alterTable(tableName, (t) => {
            t.decimal(targetCol, 30, 10).nullable();
        });
    }

    // map op to SQL expression template using knex raw placeholders
    const opMap: Record<string, (col: string) => any> = {
        'ABS': (col: string) => db.raw('abs(??)', [col]),
        'INVERTER': (col: string) => db.raw('(-1) * ??', [col])
    };

    const opFn = opMap[String(op).toUpperCase()];
    if (!opFn) throw new Error(`Unsupported derived operation: ${op}`);

    const envVar = `${String(op).toUpperCase()}_UPDATE_BATCH_SIZE`;
    const BATCH_SIZE = Math.max(100, Number(process.env[envVar] || process.env[`${String(op).toUpperCase()}_UPDATE_BATCH_SIZE`] || 1000));

    // fill values in batches
    let updatedTotal = 0;
    while (true) {
        const ids: number[] = await db(tableName).whereNull(targetCol).limit(BATCH_SIZE).pluck('id');
        if (!ids || ids.length === 0) break;
        await db(tableName).whereIn('id', ids).update({ [targetCol]: opFn(sourceColumn) });
        updatedTotal += ids.length;
    }

    // persist metadata in base_columns
    try {
        const maxIdxRow = await db('base_columns').where({ base_id: baseId }).max('col_index as mx').first();
        const nextIndex = (maxIdxRow && (maxIdxRow.mx || 0)) + 1;
        const excelName = `${String(op).toUpperCase()}(${sourceColumn})`;
        await db('base_columns').insert({ base_id: baseId, col_index: nextIndex, excel_name: excelName, sqlite_name: targetCol });
    } catch (e) {
        console.error('Failed to save base_columns metadata', e);
    }

    // try clear cache in repository
    try { const baseColsRepo = require('../repos/baseColumnsRepository').default; if (baseColsRepo && typeof baseColsRepo.clearColumnsCache === 'function') baseColsRepo.clearColumnsCache(baseId); } catch (_) { }

    return { column: targetCol, rowsUpdated: updatedTotal };
}

// POST /bases/:id/columns/derived - generic derived column creator
router.post('/:id/columns/derived', async (req: Request, res: Response) => {
    try {
        const parsed = parseIdParam(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const id = parsed.id as number;

        const { sourceColumn, op } = req.body || {};
        if (!sourceColumn || typeof sourceColumn !== 'string') return res.status(400).json({ error: 'sourceColumn is required' });
        if (!op || typeof op !== 'string') return res.status(400).json({ error: 'op is required' });

        const base = await findBaseById(id);
        if (!base) return res.status(404).json({ error: 'Base not found' });
        if (!base.tabela_sqlite) return res.status(400).json({ error: 'Base not yet ingested (tabela_sqlite is null)' });

        const tableName = base.tabela_sqlite;
        const exists = await db.schema.hasTable(tableName);
        if (!exists) return res.status(404).json({ error: `Table ${tableName} not found in DB` });

        const result = await createDerivedColumn({ baseId: id, tableName, sourceColumn, op });
        return res.status(201).json({ success: true, ...result });
    } catch (err: any) {
        console.error(err);
        res.status(400).json({ error: err.message || 'Erro ao criar coluna derivada' });
    }
});

export default router;


