import { Router, Request, Response } from 'express';
import db from '../db/knex';
import pipeline from '../pipeline/integration';
import * as jobsRepo from '../repos/jobsRepository';
import * as exportService from '../services/ConciliacaoExportService';
import path from 'path';
import fs from 'fs/promises';

const router = Router();

const DEFAULT_PAGE_SIZE = Math.max(1, Number(process.env.API_DEFAULT_PAGE_SIZE || 20));
const MAX_PAGE_SIZE = Math.max(1, Number(process.env.API_MAX_PAGE_SIZE || 100));

function parsePagination(req: Request) {
    const page = Math.max(1, Number(req.query.page ? Number(req.query.page) : 1));
    const requestedSize = Number(req.query.pageSize ? Number(req.query.pageSize) : req.query.limit) || DEFAULT_PAGE_SIZE;
    const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, requestedSize));
    return { page, pageSize };
}

async function resolveBaseOverride(raw: any, expectedType: 'CONTABIL' | 'FISCAL', fieldName: string) {
    if (raw === undefined || raw === null || raw === '' || raw === 'config') return null;
    const parsed = Number(raw);
    if (!parsed || Number.isNaN(parsed) || parsed <= 0) throw new Error(`${fieldName} deve ser um número válido`);
    const base = await db('bases').where({ id: parsed }).first();
    if (!base) throw new Error(`${fieldName} não encontrado`);
    if (base.tipo !== expectedType) throw new Error(`${fieldName} deve apontar para uma base do tipo ${expectedType}`);
    return base;
}

router.post('/', async (req: Request, res: Response) => {
    try {
        const { configConciliacaoId, configEstornoId, configCancelamentoId, configMapeamentoId, nome, baseContabilId, baseFiscalId } = req.body;
        const cfgId = Number(configConciliacaoId);
        if (!cfgId || Number.isNaN(cfgId)) return res.status(400).json({ error: 'configConciliacaoId is required and must be a number' });

        // fetch config conciliacao
        const cfg = await db('configs_conciliacao').where({ id: cfgId }).first();
        if (!cfg) return res.status(404).json({ error: 'config conciliacao not found' });

        let overrideBaseContabil: any = null;
        let overrideBaseFiscal: any = null;
        try {
            overrideBaseContabil = await resolveBaseOverride(baseContabilId, 'CONTABIL', 'baseContabilId');
        } catch (err: any) {
            return res.status(400).json({ error: err?.message || 'baseContabilId inválido' });
        }
        try {
            overrideBaseFiscal = await resolveBaseOverride(baseFiscalId, 'FISCAL', 'baseFiscalId');
        } catch (err: any) {
            return res.status(400).json({ error: err?.message || 'baseFiscalId inválido' });
        }

        const effectiveBaseContabilId = overrideBaseContabil?.id || cfg.base_contabil_id;
        const effectiveBaseFiscalId = overrideBaseFiscal?.id || cfg.base_fiscal_id;
        if (!effectiveBaseContabilId || !effectiveBaseFiscalId) {
            return res.status(400).json({ error: 'Configuração selecionada não possui bases padrão e nenhuma sobreposição foi informada.' });
        }
        if (effectiveBaseContabilId === effectiveBaseFiscalId) {
            return res.status(400).json({ error: 'Base contábil e base fiscal devem ser diferentes.' });
        }

        let mapeamentoId: number | null = null;
        let mapeamentoNome: string | null = null;
        if (configMapeamentoId !== undefined && configMapeamentoId !== null && configMapeamentoId !== '') {
            const parsed = Number(configMapeamentoId);
            if (Number.isNaN(parsed) || parsed <= 0) return res.status(400).json({ error: 'configMapeamentoId must be a positive number' });
            const mapRow = await db('configs_mapeamento_bases').where({ id: parsed }).first();
            if (!mapRow) return res.status(404).json({ error: 'config mapeamento not found' });
            if (mapRow.base_contabil_id !== effectiveBaseContabilId || mapRow.base_fiscal_id !== effectiveBaseFiscalId) {
                return res.status(400).json({ error: 'config mapeamento não corresponde às bases selecionadas para este job' });
            }
            mapeamentoId = parsed;
            mapeamentoNome = mapRow.nome || null;
        }

        // fetch optional estorno and cancelamento configs to denormalize their names into job
        let estornoNome: string | null = null;
        let cancelamentoNome: string | null = null;
        if (configEstornoId) {
            const e = await db('configs_estorno').where({ id: Number(configEstornoId) }).first();
            estornoNome = e ? e.nome || null : null;
        }
        if (configCancelamentoId) {
            const c = await db('configs_cancelamento').where({ id: Number(configCancelamentoId) }).first();
            cancelamentoNome = c ? c.nome || null : null;
        }

        // create job with PENDING; denormalize config names for easy display
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

        try {
            await jobsRepo.setJobPipelineStage(jobRow.id, 'queued', 0, 'Na fila para conciliação');
        } catch (e) {
            console.warn('Failed to initialize pipeline stage for job', jobRow.id, e);
        }

        const jobId = jobRow.id as number;

        // Job enqueued for background processing by the worker
        res.status(201).json(jobRow);
    } catch (err: any) {
        console.error(err);
        res.status(400).json({ error: 'Erro ao criar job' });
    }
});

// GET /conciliacoes - list jobs (paginated)
router.get('/', async (req: Request, res: Response) => {
    try {
        const { page, pageSize } = parsePagination(req);
        const status = req.query.status as string | undefined;

        // count total
        const baseCountQuery = db('jobs_conciliacao').modify((qb) => {
            if (status) qb.where('status', status);
        });
        const countRaw: any = await baseCountQuery.count({ count: '*' }).first();
        const total = countRaw ? Number(countRaw.count || countRaw['count(*)'] || 0) : 0;

        const offset = (page - 1) * pageSize;
        const rows = await db('jobs_conciliacao')
            .modify((qb) => { if (status) qb.where('status', status); })
            .select('*')
            .orderBy('created_at', 'desc')
            .limit(pageSize)
            .offset(offset);

        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        return res.json({ page, pageSize, total, totalPages, data: rows });
    } catch (err: any) {
        console.error(err);
        res.status(400).json({ error: 'Erro ao listar conciliacoes' });
    }
});

export default router;

// POST /conciliacoes/:id/exportar - generate XLSX (if missing) and return metadata
router.post('/:id/exportar', async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' });

        const job = await jobsRepo.getJobById(id);
        if (!job) return res.status(404).json({ error: 'job not found' });
        if (job.status !== 'DONE') return res.status(409).json({ error: 'job not completed yet' });

        // if export already exists and file accessible, return immediately
        try {
            const existing = await exportService.getExportFilePathForJob(id);
            if (existing) {
                const abs = path.resolve(process.cwd(), existing);
                try {
                    await require('fs').promises.access(abs);
                    return res.json({ path: existing, filename: path.basename(abs) });
                } catch (e) {
                    // file missing, we'll regenerate in background
                }
            }
        } catch (e) {
            // ignore and attempt background generation
        }

        // Mark export in progress and start background export task
        try {
            await jobsRepo.setJobExportProgress(id, 1, 'IN_PROGRESS');
        } catch (e) {
            // ignore errors when setting progress, proceed with background export
        }

        (async () => {
            try {
                const info = await exportService.exportJobResultToZip(id);
                console.log('Background export finished for job', id, info.path);
                try { await jobsRepo.setJobExportProgress(id, 100, 'DONE'); } catch (e) { }
            } catch (bgErr) {
                console.error('Background export failed for job', id, bgErr);
                try { await jobsRepo.setJobExportProgress(id, null, 'FAILED'); } catch (e) { }
            }
        })();

        return res.status(202).json({ jobId: id, status: 'export_started' });
    } catch (err: any) {
        console.error(err);
        res.status(400).json({ error: 'Erro ao exportar' });
    }
});

// GET /conciliacoes/:id/download - download XLSX file
router.get('/:id/download', async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' });

        const job = await jobsRepo.getJobById(id);
        if (!job) return res.status(404).json({ error: 'job not found' });

        const arquivo = job.arquivo_exportado;
        if (!arquivo) return res.status(404).json({ error: 'arquivo exportado não encontrado, please run export' });

        const abs = require('path').resolve(process.cwd(), arquivo);
        const fs = require('fs');
        try {
            await require('fs').promises.access(abs);
        } catch (e) {
            return res.status(404).json({ error: 'arquivo exportado não encontrado no disco' });
        }

        // choose content type based on extension
        const ext = path.extname(abs).toLowerCase();
        let contentType = 'application/octet-stream';
        if (ext === '.zip') contentType = 'application/zip';
        else if (ext === '.xlsx') contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(abs)}"`);

        const stream = fs.createReadStream(abs);
        stream.on('error', (err: any) => {
            console.error('Error streaming file', err);
            if (!res.headersSent) res.status(400).end('Erro ao ler arquivo');
        });
        stream.pipe(res);
    } catch (err: any) {
        console.error(err);
        res.status(400).json({ error: 'Erro ao baixar arquivo' });
    }
});

// GET /conciliacoes/:id/export-status - return export-related fields for a job
router.get('/:id/export-status', async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' });

        const job = await jobsRepo.getJobById(id);
        if (!job) return res.status(404).json({ error: 'job not found' });

        // return export-specific fields
        const payload = {
            id: job.id,
            export_status: (job as any).export_status ?? null,
            export_progress: (job as any).export_progress ?? null,
            arquivo_exportado: job.arquivo_exportado ?? null,
        };

        return res.json(payload);
    } catch (err: any) {
        console.error(err);
        res.status(400).json({ error: 'Erro ao obter status de exportação' });
    }
});

// GET /conciliacoes/:id - job details + summary metrics
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' });

        const job = await jobsRepo.getJobById(id);
        if (!job) return res.status(404).json({ error: 'job not found' });

        const resultTable = `conciliacao_result_${id}`;
        const hasTable = await db.schema.hasTable(resultTable);

        let totalRows = 0;
        let byStatus: Array<{ status: string | null; count: number }> = [];
        let byGroup: Array<{ grupo: string | null; count: number }> = [];

        if (hasTable) {
            const c: any = await db(resultTable).count<{ count: number }[]>({ count: '*' }).first();
            // knex/sqlite returns count as string sometimes
            totalRows = c ? Number((c as any).count || (c as any)['count(*)'] || 0) : 0;

            const statuses = await db(resultTable).select('status').count('* as count').groupBy('status');
            byStatus = statuses.map((s: any) => ({ status: s.status, count: Number(s.count) }));

            const groups = await db(resultTable).select('grupo').count('* as count').groupBy('grupo');
            byGroup = groups.map((g: any) => ({ grupo: g.grupo, count: Number(g.count) }));
        }

        return res.json({ job, metrics: { totalRows, byStatus, byGroup } });
    } catch (err: any) {
        console.error(err);
        res.status(400).json({ error: 'Erro ao buscar conciliacao' });
    }
});

// GET /conciliacoes/:id/resultado - paginated results
router.get('/:id/resultado', async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' });

        const page = Math.max(1, Number(req.query.page ? Number(req.query.page) : 1));
        const pageSize = Math.max(1, Number(req.query.pageSize ? Number(req.query.pageSize) : 50));
        const offset = (page - 1) * pageSize;

        const resultTable = `conciliacao_result_${id}`;
        const hasTable = await db.schema.hasTable(resultTable);
        if (!hasTable) return res.status(200).json({ page, pageSize, total: 0, totalPages: 0, data: [] });

        const statusRaw = typeof req.query.status === 'string' ? String(req.query.status) : undefined;

        // total and rows with optional status filtering
        let totalRaw: any;
        if (statusRaw === '__NULL__') {
            totalRaw = await db(resultTable).whereNull('status').count({ count: '*' }).first();
        } else if (statusRaw !== undefined) {
            totalRaw = await db(resultTable).where('status', statusRaw).count({ count: '*' }).first();
        } else {
            totalRaw = await db(resultTable).count({ count: '*' }).first();
        }

        const total = totalRaw ? Number(totalRaw.count || totalRaw['count(*)'] || 0) : 0;
        const totalPages = Math.ceil(total / pageSize);

        let rowsQuery = db(resultTable).select('*').orderBy('id', 'asc').limit(pageSize).offset(offset);
        if (statusRaw === '__NULL__') rowsQuery = rowsQuery.whereNull('status');
        else if (statusRaw !== undefined) rowsQuery = rowsQuery.where('status', statusRaw);
        const rows = await rowsQuery;

        // detect dynamic chave identifiers (CHAVE_1, CHAVE_2, ...)
        let keyIds: string[] = [];
        if (rows && rows.length > 0) {
            keyIds = Object.keys(rows[0]).filter(k => /^CHAVE_\d+$/.test(k));
        }

        // parse JSON columns a_values and b_values and include detected key columns
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
        res.status(400).json({ error: 'Erro ao buscar resultado' });
    }
});

// DELETE /conciliacoes/:id - delete job, its result table and exported file
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' });

        const job = await jobsRepo.getJobById(id);
        if (!job) return res.status(404).json({ error: 'job not found' });

        // attempt to delete exported file if exists
        try {
            if (job.arquivo_exportado) {
                const abs = path.resolve(process.cwd(), job.arquivo_exportado);
                await fs.unlink(abs).catch(() => { /* ignore */ });
            }
        } catch (e) {
            console.error('Error deleting exported file', e);
        }

        // drop result table if exists
        const resultTable = `conciliacao_result_${id}`;
        try {
            const exists = await db.schema.hasTable(resultTable);
            if (exists) await db.schema.dropTableIfExists(resultTable);
        } catch (e) {
            console.error('Error dropping result table', e);
        }

        // delete job row
        await db('jobs_conciliacao').where({ id }).del();

        return res.json({ success: true });
    } catch (err: any) {
        console.error(err);
        res.status(400).json({ error: 'Erro ao deletar conciliacao' });
    }
});

function safeJsonParse(input: any) {
    try { return JSON.parse(input); } catch { return input; }
}
