import { Router, Request, Response } from 'express';
import db from '../db/knex';

const router = Router();

function isStringArray(v: any) {
    return Array.isArray(v) && v.every(x => typeof x === 'string');
}

function validatePayload(payload: any) {
    const errors: string[] = [];
    if (!payload.nome || typeof payload.nome !== 'string') errors.push('nome is required and must be string');
    if (payload.base_contabil_id === undefined || typeof payload.base_contabil_id !== 'number' || Number.isNaN(payload.base_contabil_id)) errors.push('base_contabil_id is required and must be number');
    if (payload.base_fiscal_id === undefined || typeof payload.base_fiscal_id !== 'number' || Number.isNaN(payload.base_fiscal_id)) errors.push('base_fiscal_id is required and must be number');
    if (!isStringArray(payload.chaves_contabil)) errors.push('chaves_contabil is required and must be array of strings');
    if (!isStringArray(payload.chaves_fiscal)) errors.push('chaves_fiscal is required and must be array of strings');
    if (!payload.coluna_conciliacao_contabil || typeof payload.coluna_conciliacao_contabil !== 'string') errors.push('coluna_conciliacao_contabil is required and must be string');
    if (!payload.coluna_conciliacao_fiscal || typeof payload.coluna_conciliacao_fiscal !== 'string') errors.push('coluna_conciliacao_fiscal is required and must be string');
    if (payload.inverter_sinal_fiscal !== undefined && typeof payload.inverter_sinal_fiscal !== 'boolean') errors.push('inverter_sinal_fiscal must be boolean if provided');
    if (payload.limite_diferenca_imaterial !== undefined && isNaN(Number(payload.limite_diferenca_imaterial))) errors.push('limite_diferenca_imaterial must be a number if provided');
    return errors;
}

function parseRow(row: any) {
    const out = { ...row };
    try { out.chaves_contabil = row.chaves_contabil ? JSON.parse(row.chaves_contabil) : []; } catch { out.chaves_contabil = []; }
    try { out.chaves_fiscal = row.chaves_fiscal ? JSON.parse(row.chaves_fiscal) : []; } catch { out.chaves_fiscal = []; }
    return out;
}

// POST create
router.post('/', async (req: Request, res: Response) => {
    try {
        const payload = req.body;
        const errs = validatePayload(payload);
        if (errs.length) return res.status(400).json({ errors: errs });

        const insert = {
            nome: payload.nome,
            base_contabil_id: payload.base_contabil_id,
            base_fiscal_id: payload.base_fiscal_id,
            chaves_contabil: JSON.stringify(payload.chaves_contabil),
            chaves_fiscal: JSON.stringify(payload.chaves_fiscal),
            coluna_conciliacao_contabil: payload.coluna_conciliacao_contabil,
            coluna_conciliacao_fiscal: payload.coluna_conciliacao_fiscal,
            inverter_sinal_fiscal: payload.inverter_sinal_fiscal === true,
            limite_diferenca_imaterial: payload.limite_diferenca_imaterial !== undefined ? Number(payload.limite_diferenca_imaterial) : 0,
            created_at: db.fn.now(),
            updated_at: db.fn.now()
        } as any;

        const [id] = await db('configs_conciliacao').insert(insert);
        const created = await db('configs_conciliacao').where({ id }).first();
        try {
            const idxHelpers = await import('../db/indexHelpers');
            await idxHelpers.ensureIndicesForConfigConciliacao(created);
        } catch (e) {
            console.error('Error creating indices for new conciliacao config', e);
        }
        res.status(201).json(parseRow(created));
    } catch (err: any) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao criar config conciliacao' });
    }
});

// GET list
router.get('/', async (req: Request, res: Response) => {
    try {
        const rows = await db('configs_conciliacao').select('*').orderBy('id', 'desc');
        res.json(rows.map(parseRow));
    } catch (err: any) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao listar configs conciliacao' });
    }
});

// GET by id
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
        const row = await db('configs_conciliacao').where({ id }).first();
        if (!row) return res.status(404).json({ error: 'Not found' });
        res.json(parseRow(row));
    } catch (err: any) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao obter config conciliacao' });
    }
});

// PUT update
router.put('/:id', async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
        const payload = req.body;
        const errs = validatePayload(payload);
        if (errs.length) return res.status(400).json({ errors: errs });

        const update = {
            nome: payload.nome,
            base_contabil_id: payload.base_contabil_id,
            base_fiscal_id: payload.base_fiscal_id,
            chaves_contabil: JSON.stringify(payload.chaves_contabil),
            chaves_fiscal: JSON.stringify(payload.chaves_fiscal),
            coluna_conciliacao_contabil: payload.coluna_conciliacao_contabil,
            coluna_conciliacao_fiscal: payload.coluna_conciliacao_fiscal,
            inverter_sinal_fiscal: payload.inverter_sinal_fiscal === true,
            limite_diferenca_imaterial: payload.limite_diferenca_imaterial !== undefined ? Number(payload.limite_diferenca_imaterial) : 0,
            updated_at: db.fn.now()
        } as any;

        await db('configs_conciliacao').where({ id }).update(update);
        const updated = await db('configs_conciliacao').where({ id }).first();
        try {
            const idxHelpers = await import('../db/indexHelpers');
            await idxHelpers.ensureIndicesForConfigConciliacao(updated);
        } catch (e) {
            console.error('Error creating indices for updated conciliacao config', e);
        }
        res.json(parseRow(updated));
    } catch (err: any) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao atualizar config conciliacao' });
    }
});

// DELETE
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
        const row = await db('configs_conciliacao').where({ id }).first();
        if (!row) return res.status(404).json({ error: 'Not found' });
        await db('configs_conciliacao').where({ id }).del();
        res.status(204).send();
    } catch (err: any) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao deletar config conciliacao' });
    }
});

export default router;
