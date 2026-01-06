import { Router, Request, Response } from 'express';
import db from '../db/knex';
import * as atribuicaoRepo from '../repos/atribuicaoRunsRepository';
import path from 'path';
import fsSync from 'fs';

const router = Router();

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const DEFAULT_RESULT_PAGE_SIZE = 50;

function parsePagination(req: Request) {
    const page = Math.max(1, Number(req.query.page) || 1);
    const requestedSize = Number(req.query.pageSize) || DEFAULT_PAGE_SIZE;
    const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, requestedSize));
    return { page, pageSize };
}

function parseId(req: Request) {
    const id = Number(req.params.id);
    return Number.isFinite(id) && id > 0 ? { ok: true as const, id } : { ok: false as const, error: 'invalid id' };
}

function resultTableName(runId: number) {
    return `atribuicao_result_${runId}`;
}

// POST /atribuicoes/runs - Create a new run
router.post('/runs', async (req: Request, res: Response) => {
    try {
        const { nome, baseOrigemId, baseDestinoId, modeWrite, selectedColumns, keysPairs, updateOriginalBase } = req.body;

        // Validate required fields
        if (!baseOrigemId || !baseDestinoId) {
            return res.status(400).json({ error: 'baseOrigemId e baseDestinoId são obrigatórios' });
        }

        const origemId = Number(baseOrigemId);
        const destinoId = Number(baseDestinoId);

        if (origemId === destinoId) {
            return res.status(400).json({ error: 'Base origem e destino devem ser diferentes' });
        }

        // Validate bases exist and are FISCAL ↔ CONTABIL
        const baseOrigem = await db('bases').where({ id: origemId }).first();
        const baseDestino = await db('bases').where({ id: destinoId }).first();

        if (!baseOrigem) return res.status(404).json({ error: 'Base origem não encontrada' });
        if (!baseDestino) return res.status(404).json({ error: 'Base destino não encontrada' });

        const tipoOrigem = (baseOrigem.tipo || '').toUpperCase();
        const tipoDestino = (baseDestino.tipo || '').toUpperCase();

        if (tipoOrigem === tipoDestino) {
            return res.status(400).json({ error: 'Base origem e destino devem ser de tipos diferentes (FISCAL ↔ CONTABIL)' });
        }

        if (!['FISCAL', 'CONTABIL'].includes(tipoOrigem) || !['FISCAL', 'CONTABIL'].includes(tipoDestino)) {
            return res.status(400).json({ error: 'Bases devem ser do tipo FISCAL ou CONTABIL' });
        }

        // Validate mode_write
        const mode = (modeWrite || 'OVERWRITE').toUpperCase();
        if (!['OVERWRITE', 'ONLY_EMPTY'].includes(mode)) {
            return res.status(400).json({ error: 'modeWrite deve ser OVERWRITE ou ONLY_EMPTY' });
        }

        // Validate selected columns exist in source base
        const columns: string[] = Array.isArray(selectedColumns) ? selectedColumns : [];
        if (columns.length > 0) {
            const baseColumns = await db('base_columns').where({ base_id: origemId }).select('sqlite_name');
            const validCols = new Set(baseColumns.map((c: any) => c.sqlite_name));
            const invalid = columns.filter(c => !validCols.has(c));
            if (invalid.length > 0) {
                return res.status(400).json({ error: `Colunas não encontradas na origem: ${invalid.join(', ')}` });
            }
        }

        // Validate keys_pairs
        const keys: Array<{ keys_pair_id: number; key_identifier: string; ordem: number }> = [];
        if (Array.isArray(keysPairs) && keysPairs.length > 0) {
            for (let i = 0; i < keysPairs.length; i++) {
                const kp = keysPairs[i];
                const pairId = Number(kp.keysPairId || kp.keys_pair_id);
                if (!pairId) {
                    return res.status(400).json({ error: `keysPairs[${i}] deve ter keysPairId válido` });
                }

                const pair = await db('keys_pairs').where({ id: pairId }).first();
                if (!pair) {
                    return res.status(404).json({ error: `keys_pair ${pairId} não encontrado` });
                }

                keys.push({
                    keys_pair_id: pairId,
                    key_identifier: kp.keyIdentifier || kp.key_identifier || `CHAVE_${i + 1}`,
                    ordem: kp.ordem ?? i,
                });
            }
        } else {
            return res.status(400).json({ error: 'keysPairs é obrigatório e deve conter ao menos um par de chaves' });
        }

        const run = await atribuicaoRepo.createRun({
            nome: nome || null,
            base_origem_id: origemId,
            base_destino_id: destinoId,
            mode_write: mode as 'OVERWRITE' | 'ONLY_EMPTY',
            selected_columns: columns,
            update_original_base: updateOriginalBase !== false,  // default true
            keys,
        });

        if (!run) return res.status(500).json({ error: 'Falha ao criar run' });

        // Initialize pipeline stage
        await atribuicaoRepo.setRunProgress(run.id, 'queued', 0, 'Na fila para atribuição');

        return res.status(201).json(run);
    } catch (err: any) {
        console.error('POST /atribuicoes/runs error', err);
        return res.status(400).json({ error: err?.message || 'Erro ao criar run' });
    }
});

// GET /atribuicoes/runs - List runs (paginated)
router.get('/runs', async (req: Request, res: Response) => {
    try {
        const { page, pageSize } = parsePagination(req);
        const status = req.query.status as string | undefined;

        const { total, data } = await atribuicaoRepo.listRuns(page, pageSize, status);
        const totalPages = Math.max(1, Math.ceil(total / pageSize));

        // Enrich with base names
        const baseIds = [...new Set([...data.map(d => d.base_origem_id), ...data.map(d => d.base_destino_id)])];
        const bases = baseIds.length > 0 ? await db('bases').whereIn('id', baseIds).select('id', 'nome', 'tipo') : [];
        const basesMap: Record<number, any> = {};
        for (const b of bases) basesMap[b.id] = b;

        const enriched = data.map(d => ({
            ...d,
            base_origem: basesMap[d.base_origem_id] || null,
            base_destino: basesMap[d.base_destino_id] || null,
            selected_columns: d.selected_columns_json ? JSON.parse(d.selected_columns_json) : [],
        }));

        return res.json({ page, pageSize, total, totalPages, data: enriched });
    } catch (err: any) {
        console.error('GET /atribuicoes/runs error', err);
        return res.status(400).json({ error: 'Erro ao listar runs' });
    }
});

// GET /atribuicoes/runs/:id - Get run details
router.get('/runs/:id', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });

        const run = await atribuicaoRepo.getRunById(parsed.id);
        if (!run) return res.status(404).json({ error: 'Run não encontrada' });

        const keys = await atribuicaoRepo.getRunKeys(parsed.id);

        // Enrich with base info
        const baseOrigem = await db('bases').where({ id: run.base_origem_id }).first();
        const baseDestino = await db('bases').where({ id: run.base_destino_id }).first();

        // Enrich keys with pair info
        const pairIds = keys.map(k => k.keys_pair_id);
        const pairs = pairIds.length > 0 ? await db('keys_pairs').whereIn('id', pairIds).select('*') : [];
        const pairsMap: Record<number, any> = {};
        for (const p of pairs) pairsMap[p.id] = p;

        const enrichedKeys = keys.map(k => ({
            ...k,
            keys_pair: pairsMap[k.keys_pair_id] || null,
        }));

        return res.json({
            ...run,
            selected_columns: run.selected_columns_json ? JSON.parse(run.selected_columns_json) : [],
            update_original_base: run.update_original_base !== 0,  // convert to boolean
            base_origem: baseOrigem || null,
            base_destino: baseDestino || null,
            keys: enrichedKeys,
        });
    } catch (err: any) {
        console.error('GET /atribuicoes/runs/:id error', err);
        return res.status(400).json({ error: 'Erro ao buscar run' });
    }
});

// POST /atribuicoes/runs/:id/start - Start execution
router.post('/runs/:id/start', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });

        const run = await atribuicaoRepo.getRunById(parsed.id);
        if (!run) return res.status(404).json({ error: 'Run não encontrada' });

        if (run.status === 'RUNNING') {
            return res.status(409).json({ error: 'Run já está em execução' });
        }

        if (run.status === 'DONE') {
            return res.status(409).json({ error: 'Run já foi concluída' });
        }

        // Update status to RUNNING
        await atribuicaoRepo.updateRunStatus(parsed.id, 'RUNNING');
        await atribuicaoRepo.setRunProgress(parsed.id, 'starting', 5, 'Iniciando atribuição');

        // Spawn runner in background
        try {
            const isProd = process.env.NODE_ENV === 'production';
            const script = isProd
                ? path.resolve(__dirname, '../worker/atribuicaoRunner.js')
                : path.resolve(__dirname, '../worker/atribuicaoRunner.ts');
            const forkArgs = [String(parsed.id)];
            const forkOptions: any = isProd
                ? { stdio: 'ignore', detached: true }
                : { stdio: 'inherit', execArgv: ['-r', 'ts-node/register'] };

            const child = require('child_process').fork(script, forkArgs, forkOptions);
            if (isProd) {
                child.unref && child.unref();
            }
            child.on && child.on('error', (err: any) => {
                console.error('Failed to spawn atribuicao runner for run', parsed.id, err);
                atribuicaoRepo.updateRunStatus(parsed.id, 'FAILED', 'Falha ao iniciar runner');
            });
        } catch (spawnErr) {
            console.error('Failed to start atribuicao runner', spawnErr);
            await atribuicaoRepo.updateRunStatus(parsed.id, 'FAILED', 'Falha ao iniciar runner');
            return res.status(500).json({ error: 'Falha ao iniciar runner' });
        }

        return res.json({ runId: parsed.id, status: 'started' });
    } catch (err: any) {
        console.error('POST /atribuicoes/runs/:id/start error', err);
        return res.status(400).json({ error: 'Erro ao iniciar run' });
    }
});

// GET /atribuicoes/runs/:id/results - Paginated results
router.get('/runs/:id/results', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });

        const page = Math.max(1, Number(req.query.page) || 1);
        const pageSize = Math.max(1, Number(req.query.pageSize) || DEFAULT_RESULT_PAGE_SIZE);
        const offset = (page - 1) * pageSize;
        const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined;

        const run = await atribuicaoRepo.getRunById(parsed.id);
        if (!run) return res.status(404).json({ error: 'Run não encontrada' });

        const table = run.result_table_name || resultTableName(parsed.id);
        const hasTable = await db.schema.hasTable(table);
        if (!hasTable) {
            return res.json({ page, pageSize, total: 0, totalPages: 0, data: [], columns: [] });
        }

        // Get column info
        let columns: string[] = [];
        try {
            const rawPragma: any = await db.raw(`PRAGMA table_info("${table}")`);
            const pragmaAny = Array.isArray(rawPragma) ? rawPragma : rawPragma[0] || [];
            columns = Array.isArray(pragmaAny) ? pragmaAny.map((c: any) => String(c.name)) : [];
        } catch (e) {
            console.warn('Failed to read table_info for result table', table, e);
        }

        // Build count query
        let countQuery = db(table);
        if (search && search.length > 0) {
            const term = `%${search}%`;
            countQuery = countQuery.where(function () {
                for (const col of columns.slice(0, 10)) { // limit search columns for performance
                    this.orWhereRaw(`CAST(?? AS TEXT) LIKE ?`, [col, term]);
                }
            });
        }

        const totalRaw: any = await countQuery.count({ count: '*' }).first();
        const total = Number(totalRaw?.count || totalRaw?.['count(*)'] || 0);
        const totalPages = Math.ceil(total / pageSize) || 0;

        // Build rows query
        let rowsQuery = db(table).select('*');
        if (search && search.length > 0) {
            const term = `%${search}%`;
            rowsQuery = rowsQuery.where(function () {
                for (const col of columns.slice(0, 10)) {
                    this.orWhereRaw(`CAST(?? AS TEXT) LIKE ?`, [col, term]);
                }
            });
        }

        const rows = await rowsQuery.orderBy('id', 'asc').limit(pageSize).offset(offset);

        return res.json({ page, pageSize, total, totalPages, data: rows, columns });
    } catch (err: any) {
        console.error('GET /atribuicoes/runs/:id/results error', err);
        return res.status(400).json({ error: 'Erro ao buscar resultados' });
    }
});

// GET /atribuicoes/runs/:id/export - Export XLSX
// Nova rota: dispara exportação em background e retorna status/link
// Função para gerar nome de arquivo igual ao worker
function sanitizeFilename(name: string, runId: number) {
    return name
        ? name.replace(/[^a-zA-Z0-9-_\.]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64) || `atribuicao_${runId}`
        : `atribuicao_${runId}`;
}

router.get('/runs/:id/export', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });

        const run = await atribuicaoRepo.getRunById(parsed.id);
        if (!run) return res.status(404).json({ error: 'Run não encontrada' });
        if (run.status !== 'DONE') {
            return res.status(409).json({ error: 'Run ainda não concluída' });
        }

        const exportDir = require('path').resolve(__dirname, '../../storage/exports/atribuicoes');
        const fileBase = sanitizeFilename(run.nome ?? 'Atribuição', run.id);
        const exportPath = require('path').join(exportDir, `${fileBase}.xlsx`);
        const fs = require('fs');

        const fallbackPath = require('path').join(exportDir, `atribuicao_${run.id}.xlsx`);

        // Se existir com o nome baseado no nome da run ou com o fallback antigo, retorna ready
        if (fs.existsSync(exportPath) || fs.existsSync(fallbackPath)) {
            return res.json({
                status: 'ready',
                downloadUrl: `/atribuicoes/runs/${parsed.id}/download-xlsx`,
            });
        }

        // Dispara worker se não existir
        const isProd = process.env.NODE_ENV === 'production';
        const script = isProd
            ? require('path').resolve(__dirname, '../worker/atribuicaoExportWorker.js')
            : require('path').resolve(__dirname, '../worker/atribuicaoExportWorker.ts');
        const forkArgs = [String(parsed.id)];
        const forkOptions = isProd
            ? { stdio: 'ignore', detached: true }
            : { stdio: 'inherit', execArgv: ['-r', 'ts-node/register'] };

        const child = require('child_process').fork(script, forkArgs, forkOptions);
        if (isProd) child.unref && child.unref();
        child.on && child.on('error', (err: any) => {
            console.error('Erro ao spawnar export worker', err);
        });

        return res.json({
            status: 'processing',
            message: 'Exportação iniciada. Tente novamente em instantes para baixar o arquivo.',
        });
    } catch (err: any) {
        console.error('GET /atribuicoes/runs/:id/export error', err);
        return res.status(400).json({ error: 'Erro ao exportar' });
    }
});

// Nova rota: download do arquivo XLSX gerado
router.get('/runs/:id/download-xlsx', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const run = await atribuicaoRepo.getRunById(parsed.id);
        if (!run) return res.status(404).json({ error: 'Run não encontrada' });
        const exportDir = require('path').resolve(__dirname, '../../storage/exports/atribuicoes');
        const fileBase = sanitizeFilename(run.nome ?? 'Atribuição', run.id);
        const exportPath = require('path').join(exportDir, `${fileBase}.xlsx`);
        const fs = require('fs');
        const fallbackPath = require('path').join(exportDir, `atribuicao_${run.id}.xlsx`);

        let pathToSend: string | null = null;
        let filenameToSend: string | null = null;
        if (fs.existsSync(exportPath)) {
            pathToSend = exportPath;
            filenameToSend = `${fileBase}.xlsx`;
        } else if (fs.existsSync(fallbackPath)) {
            pathToSend = fallbackPath;
            filenameToSend = `atribuicao_${run.id}.xlsx`;
        }

        if (!pathToSend) {
            return res.status(404).json({ error: 'Arquivo de exportação não encontrado. Aguarde a conclusão do processamento.' });
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filenameToSend}"`);
        const fileStream = fs.createReadStream(pathToSend);
        fileStream.pipe(res);
    } catch (err: any) {
        console.error('GET /atribuicoes/runs/:id/download-xlsx error', err);
        return res.status(400).json({ error: 'Erro ao baixar arquivo' });
    }
});
// DELETE /atribuicoes/runs/:id - Delete run
router.delete('/runs/:id', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });

        const run = await atribuicaoRepo.getRunById(parsed.id);
        if (!run) return res.status(404).json({ error: 'Run não encontrada' });

        if (run.status === 'RUNNING') {
            return res.status(409).json({ error: 'Não é possível deletar run em execução' });
        }

        await atribuicaoRepo.deleteRun(parsed.id);
        return res.json({ success: true });
    } catch (err: any) {
        console.error('DELETE /atribuicoes/runs/:id error', err);
        return res.status(400).json({ error: 'Erro ao deletar run' });
    }
});

export default router;
