import { Router, Request, Response } from 'express';
import db from '../db/knex';
import * as jobsRepo from '../repos/jobsRepository';
import * as exportService from '../services/ConciliacaoExportService';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';

const router = Router();

const DEFAULT_PAGE_SIZE = Math.max(1, Number(process.env.API_DEFAULT_PAGE_SIZE || 20));
const MAX_PAGE_SIZE = Math.max(1, Number(process.env.API_MAX_PAGE_SIZE || 100));
const DEFAULT_RESULT_PAGE_SIZE = Number(process.env.API_RESULT_PAGE_SIZE || 50);

function parsePagination(req: Request) {
    const page = Math.max(1, Number(req.query.page ? Number(req.query.page) : 1));
    const requestedSize = Number(req.query.pageSize ? Number(req.query.pageSize) : req.query.limit) || DEFAULT_PAGE_SIZE;
    const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, requestedSize));
    return { page, pageSize };
}

function parseId(req: Request) {
    const id = Number(req.params.id);
    return Number.isFinite(id) && id > 0 ? { ok: true as const, id } : { ok: false as const, error: 'invalid id' };
}

function resultTableName(jobId: number) {
    return `conciliacao_result_${jobId}`;
}

function safeJsonParse(input: any) {
    try { return JSON.parse(input); } catch { return input; }
}

async function safeCount(tableName: string) {
    try {
        const raw: any = await db(tableName).count({ count: '*' }).first();
        return Number(raw?.count ?? raw?.['count(*)'] ?? 0);
    } catch {
        return 0;
    }
}

async function getJobOr404(id: number, res: Response) {
    const job = await jobsRepo.getJobById(id);
    if (!job) res.status(404).json({ error: 'job not found' });
    return job;
}

// POST /conciliacoes - enqueue a job
router.post('/', async (req: Request, res: Response) => {
    try {
        const {
            configConciliacaoId,
            configEstornoId,
            configCancelamentoId,
            configMapeamentoId,
            nome,
            baseContabilId,
            baseFiscalId
        } = req.body;

        const cfgId = Number(configConciliacaoId);
        if (!cfgId || Number.isNaN(cfgId)) return res.status(400).json({ error: 'configConciliacaoId is required and must be a number' });

        const cfg = await db('configs_conciliacao').where({ id: cfgId }).first();
        if (!cfg) return res.status(404).json({ error: 'config conciliacao not found' });

        const resolveOverride = async (raw: any, expectedType: 'CONTABIL' | 'FISCAL', fieldName: string) => {
            if (raw === undefined || raw === null || raw === '' || raw === 'config') return null;
            const parsed = Number(raw);
            if (!parsed || Number.isNaN(parsed) || parsed <= 0) throw new Error(`${fieldName} deve ser um número válido`);
            const base = await db('bases').where({ id: parsed }).first();
            if (!base) throw new Error(`${fieldName} não encontrado`);
            if (base.tipo !== expectedType) throw new Error(`${fieldName} deve apontar para uma base do tipo ${expectedType}`);
            return base;
        };

        let overrideBaseContabil = null;
        let overrideBaseFiscal = null;
        try { overrideBaseContabil = await resolveOverride(baseContabilId, 'CONTABIL', 'baseContabilId'); } catch (e: any) { return res.status(400).json({ error: e?.message || 'baseContabilId inválido' }); }
        try { overrideBaseFiscal = await resolveOverride(baseFiscalId, 'FISCAL', 'baseFiscalId'); } catch (e: any) { return res.status(400).json({ error: e?.message || 'baseFiscalId inválido' }); }

        const effectiveBaseContabilId = overrideBaseContabil?.id || cfg.base_contabil_id;
        const effectiveBaseFiscalId = overrideBaseFiscal?.id || cfg.base_fiscal_id;
        if (!effectiveBaseContabilId || !effectiveBaseFiscalId) return res.status(400).json({ error: 'Configuração selecionada não possui bases padrão e nenhuma sobreposição foi informada.' });
        if (effectiveBaseContabilId === effectiveBaseFiscalId) return res.status(400).json({ error: 'Base contábil e base fiscal devem ser diferentes.' });

        let mapeamentoId: number | null = null;
        let mapeamentoNome: string | null = null;
        if (configMapeamentoId !== undefined && configMapeamentoId !== null && configMapeamentoId !== '') {
            const parsed = Number(configMapeamentoId);
            if (Number.isNaN(parsed) || parsed <= 0) return res.status(400).json({ error: 'configMapeamentoId must be a positive number' });
            const mapRow = await db('configs_mapeamento_bases').where({ id: parsed }).first();
            if (!mapRow) return res.status(404).json({ error: 'config mapeamento not found' });
            // if (mapRow.base_contabil_id !== effectiveBaseContabilId || mapRow.base_fiscal_id !== effectiveBaseFiscalId) return res.status(400).json({ error: 'config mapeamento não corresponde às bases selecionadas para este job' });
            mapeamentoId = parsed;
            mapeamentoNome = mapRow.nome || null;
        }

        const estornoNome = configEstornoId ? (await db('configs_estorno').where({ id: Number(configEstornoId) }).first())?.nome ?? null : null;
        const cancelamentoNome = configCancelamentoId ? (await db('configs_cancelamento').where({ id: Number(configCancelamentoId) }).first())?.nome ?? null : null;

        const jobRow = await jobsRepo.createJob({
            nome: nome || cfg.nome || `Job for config ${cfgId}`,
            config_conciliacao_id: cfgId,
            config_estorno_id: configEstornoId ?? null,
            config_cancelamento_id: configCancelamentoId ?? null,
            config_mapeamento_id: mapeamentoId,
            config_mapeamento_nome: mapeamentoNome,
            config_estorno_nome: estornoNome,
            config_cancelamento_nome: cancelamentoNome,
            base_contabil_id_override: overrideBaseContabil ? overrideBaseContabil.id : null,
            base_fiscal_id_override: overrideBaseFiscal ? overrideBaseFiscal.id : null,
            status: 'PENDING',
            erro: null,
            created_at: db.fn.now(),
            updated_at: db.fn.now()
        });

        if (!jobRow) return res.status(500).json({ error: 'Failed to create job' });
        try { await jobsRepo.setJobPipelineStage(jobRow.id, 'queued', 0, 'Na fila para conciliação'); } catch (e) { console.warn('Failed to initialize pipeline stage for job', jobRow?.id, e); }

        return res.status(201).json(jobRow);
    } catch (err: any) {
        console.error(err);
        return res.status(400).json({ error: 'Erro ao criar job' });
    }
});

// GET /conciliacoes - list jobs (paginated)
router.get('/', async (req: Request, res: Response) => {
    try {
        const { page, pageSize } = parsePagination(req);
        const status = req.query.status as string | undefined;

        const baseCountQuery = db('jobs_conciliacao').modify((qb: any) => { if (status) qb.where('status', status); });
        const countRaw: any = await baseCountQuery.count({ count: '*' }).first();
        const total = countRaw ? Number(countRaw.count || countRaw['count(*)'] || 0) : 0;

        const offset = (page - 1) * pageSize;
        const rows = await db('jobs_conciliacao')
            .modify((qb: any) => { if (status) qb.where('status', status); })
            .select('*')
            .orderBy('created_at', 'desc')
            .limit(pageSize)
            .offset(offset);

        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        return res.json({ page, pageSize, total, totalPages, data: rows });
    } catch (err: any) {
        console.error(err);
        return res.status(400).json({ error: 'Erro ao listar conciliacoes' });
    }
});

// POST /conciliacoes/:id/exportar - generate export in background
router.post('/:id/exportar', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const id = parsed.id;

        const job = await getJobOr404(id, res);
        if (!job) return; // response already sent
        if (job.status !== 'DONE') return res.status(409).json({ error: 'job not completed yet' });

        try {
            const existing = await exportService.getExportFilePathForJob(id);
            if (existing) {
                const abs = path.resolve(process.cwd(), existing);
                try { await fs.access(abs); return res.json({ path: existing, filename: path.basename(abs) }); } catch { /* regenerate */ }
            }
        } catch { /* ignore and generate */ }

        try { await jobsRepo.setJobExportProgress(id, 1, 'IN_PROGRESS'); } catch { /* ignore */ }

        (async () => {
            try {
                const info = await exportService.exportJobResultToZip(id);
                console.log('Background export finished for job', id, info.path);
                try { await jobsRepo.setJobExportProgress(id, 100, 'DONE'); } catch { }
            } catch (bgErr) {
                console.error('Background export failed for job', id, bgErr);
                try { await jobsRepo.setJobExportProgress(id, null, 'FAILED'); } catch { }
            }
        })();

        return res.status(202).json({ jobId: id, status: 'export_started' });
    } catch (err: any) {
        console.error(err);
        return res.status(400).json({ error: 'Erro ao exportar' });
    }
});

// GET /conciliacoes/:id/download - download export file
router.get('/:id/download', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const id = parsed.id;

        const job = await getJobOr404(id, res);
        if (!job) return;

        const arquivo = job.arquivo_exportado;
        if (!arquivo) return res.status(404).json({ error: 'arquivo exportado não encontrado, please run export' });

        const abs = path.resolve(process.cwd(), arquivo);
        try { await fs.access(abs); } catch { return res.status(404).json({ error: 'arquivo exportado não encontrado no disco' }); }

        const ext = path.extname(abs).toLowerCase();
        const contentType = ext === '.zip' ? 'application/zip' : ext === '.xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/octet-stream';

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(abs)}"`);

        const stream = fsSync.createReadStream(abs);
        stream.on('error', (err: any) => {
            console.error('Error streaming file', err);
            if (!res.headersSent) res.status(400).end('Erro ao ler arquivo');
        });
        stream.pipe(res);
    } catch (err: any) {
        console.error(err);
        return res.status(400).json({ error: 'Erro ao baixar arquivo' });
    }
});

// GET /conciliacoes/:id/export-status - export progress fields
router.get('/:id/export-status', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const id = parsed.id;

        const job = await getJobOr404(id, res);
        if (!job) return;

        const payload = {
            id: job.id,
            export_status: (job as any).export_status ?? null,
            export_progress: (job as any).export_progress ?? null,
            arquivo_exportado: job.arquivo_exportado ?? null,
        };

        return res.json(payload);
    } catch (err: any) {
        console.error(err);
        return res.status(400).json({ error: 'Erro ao obter status de exportação' });
    }
});

// GET /conciliacoes/:id - job details + summary metrics
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const id = parsed.id;

        const job = await getJobOr404(id, res);
        if (!job) return;

        const table = resultTableName(id);
        const hasTable = await db.schema.hasTable(table);

        let totalRows = 0;
        let byStatus: Array<{ status: string | null; count: number }> = [];
        let byGroup: Array<{ grupo: string | null; count: number }> = [];

        if (hasTable) {
            totalRows = await safeCount(table);
            const statuses = await db(table).select('status').count('* as count').groupBy('status');
            byStatus = statuses.map((s: any) => ({ status: s.status, count: Number(s.count) }));
            const groups = await db(table).select('grupo').count('* as count').groupBy('grupo');
            byGroup = groups.map((g: any) => ({ grupo: g.grupo, count: Number(g.count) }));
        }

        return res.json({ job, metrics: { totalRows, byStatus, byGroup } });
    } catch (err: any) {
        console.error(err);
        return res.status(400).json({ error: 'Erro ao buscar conciliacao' });
    }
});

// GET /conciliacoes/:id/resultado - paginated results
router.get('/:id/resultado', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const id = parsed.id;

        const page = Math.max(1, Number(req.query.page ? Number(req.query.page) : 1));
        const pageSize = Math.max(1, Number(req.query.pageSize ? Number(req.query.pageSize) : DEFAULT_RESULT_PAGE_SIZE));
        const offset = (page - 1) * pageSize;

        const table = resultTableName(id);
        const hasTable = await db.schema.hasTable(table);
        if (!hasTable) return res.json({ page, pageSize, total: 0, totalPages: 0, data: [], keys: [] });

        // Pre-read table columns to allow searching CHAVE_* columns reliably.
        let availableCols: string[] = [];
        try {
            const rawPragma: any = await db.raw(`PRAGMA table_info("${table}")`);
            // Normalize the various shapes knex/better-sqlite3 might return
            let pragmaAny: any;
            if (Array.isArray(rawPragma)) pragmaAny = rawPragma;
            else if (rawPragma && Array.isArray(rawPragma[0])) pragmaAny = rawPragma[0];
            else if (rawPragma && rawPragma.rows) pragmaAny = rawPragma.rows;
            else pragmaAny = rawPragma;
            // no debug logs in production; keep behavior silent
            availableCols = Array.isArray(pragmaAny) ? pragmaAny.map((c: any) => String(c.name)) : [];
        } catch (e) {
            console.warn('failed to read table_info for result table', table, e);
            availableCols = [];
        }

        const statusRaw = typeof req.query.status === 'string' ? String(req.query.status) : undefined;
        const searchRaw = typeof req.query.search === 'string' ? String(req.query.search).trim() : undefined;
        const searchColumnRaw = typeof req.query.searchColumn === 'string' ? String(req.query.searchColumn).trim() : undefined;

        // Build a count query with same filters to compute total correctly
        let countQuery: any = db(table);
        if (statusRaw === '__NULL__') countQuery = countQuery.whereNull('status');
        else if (statusRaw !== undefined) countQuery = countQuery.where('status', statusRaw);

        // If searchRaw provided, apply narrow search depending on searchColumnRaw
        if (searchRaw && searchRaw.length > 0) {
            const term = `%${searchRaw}%`;
                if (searchColumnRaw && searchColumnRaw.length > 0) {
                    const matched = availableCols.find((c: string) => c.toLowerCase() === searchColumnRaw.toLowerCase());
                    if (matched) {
                        countQuery = countQuery.andWhereRaw('CAST(??.?? AS TEXT) LIKE ?', [table, matched, term]);
                    } else {
                        return res.json({ page, pageSize, total: 0, totalPages: 0, data: [], keys: [] });
                    }
                } else {
                // no specific column: search `chave` plus any CHAVE_* columns
                countQuery = countQuery.andWhere(function (this: any) {
                    this.orWhereRaw('CAST(??.?? AS TEXT) LIKE ?', [table, 'chave', term]);
                    for (const col of availableCols.filter((n: string) => /^CHAVE_\d+$/i.test(n))) {
                        this.orWhereRaw('CAST(??.?? AS TEXT) LIKE ?', [table, col, term]);
                    }
                });
            }
        }

        const totalRaw: any = await countQuery.count({ count: '*' }).first();
        const total = totalRaw ? Number(totalRaw.count || totalRaw['count(*)'] || 0) : 0;
        const totalPages = Math.ceil(total / pageSize) || 0;

        // build rows query with same filters
        let rowsQuery: any = db(table).select('*');
        if (statusRaw === '__NULL__') rowsQuery = rowsQuery.whereNull('status');
        else if (statusRaw !== undefined) rowsQuery = rowsQuery.where('status', statusRaw);

        if (searchRaw && searchRaw.length > 0) {
            const term = `%${searchRaw}%`;
                if (searchColumnRaw && searchColumnRaw.length > 0) {
                    const matched = availableCols.find((c: string) => c.toLowerCase() === searchColumnRaw.toLowerCase());
                    if (matched) {
                        rowsQuery = rowsQuery.andWhereRaw('CAST(??.?? AS TEXT) LIKE ?', [table, matched, term]);
                    } else {
                        return res.json({ page, pageSize, total: 0, totalPages: 0, data: [], keys: [] });
                    }
                } else {
                rowsQuery = rowsQuery.andWhere(function (this: any) {
                    this.orWhereRaw('CAST(??.?? AS TEXT) LIKE ?', [table, 'chave', term]);
                    for (const col of availableCols.filter((n: string) => /^CHAVE_\d+$/i.test(n))) {
                        this.orWhereRaw('CAST(??.?? AS TEXT) LIKE ?', [table, col, term]);
                    }
                });
            }
        }

        rowsQuery = rowsQuery.orderBy('id', 'asc').limit(pageSize).offset(offset);
        const rows = await rowsQuery;

        const keyIds = rows && rows.length > 0 ? Object.keys(rows[0]).filter(k => /^CHAVE_\d+$/.test(k)) : [];

        const data = rows.map((r: any) => {
            const keyValues: Record<string, any> = {};
            for (const k of keyIds) keyValues[k] = r[k];
            return {
                id: r.id,
                job_id: r.job_id,
                chave: r.chave,
                status: r.status,
                grupo: r.grupo,
                a_row_id: r.a_row_id,
                b_row_id: r.b_row_id,
                value_a: r.value_a,
                value_b: r.value_b,
                difference: r.difference,
                a_values: r.a_values ? safeJsonParse(r.a_values) : null,
                b_values: r.b_values ? safeJsonParse(r.b_values) : null,
                created_at: r.created_at,
                ...keyValues
            };
        });

        return res.json({ page, pageSize, total, totalPages, data, keys: keyIds });
    } catch (err: any) {
        console.error(err);
        return res.status(400).json({ error: 'Erro ao buscar resultado' });
    }
});

// DELETE /conciliacoes/:id - delete job, result table and exported file
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const id = parsed.id;

        const job = await getJobOr404(id, res);
        if (!job) return;

        try { if (job.arquivo_exportado) await fs.unlink(path.resolve(process.cwd(), job.arquivo_exportado)).catch(() => {}); } catch (e) { console.error('Error deleting exported file', e); }

        const table = resultTableName(id);
        try { const exists = await db.schema.hasTable(table); if (exists) await db.schema.dropTableIfExists(table); } catch (e) { console.error('Error dropping result table', e); }

        await db('jobs_conciliacao').where({ id }).del();
        return res.json({ success: true });
    } catch (err: any) {
        console.error(err);
        return res.status(400).json({ error: 'Erro ao deletar conciliacao' });
    }
});

export default router;
