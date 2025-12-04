import { Router, Request, Response } from 'express';
import db from '../db/knex';

const router = Router();

// Basic validator
function validatePayload(payload: any) {
    const errors: string[] = [];
    if (!payload.nome || typeof payload.nome !== 'string') errors.push('nome is required and must be string');
    if (!payload.coluna_indicador || typeof payload.coluna_indicador !== 'string') errors.push('coluna_indicador is required and must be string');
    if (!payload.valor_cancelado || typeof payload.valor_cancelado !== 'string') errors.push('valor_cancelado is required and must be string');
    if (!payload.valor_nao_cancelado || typeof payload.valor_nao_cancelado !== 'string') errors.push('valor_nao_cancelado is required and must be string');
    if (payload.ativa !== undefined && typeof payload.ativa !== 'boolean') errors.push('ativa must be boolean if provided');
    if (payload.base_id !== undefined && (typeof payload.base_id !== 'number' || Number.isNaN(payload.base_id))) errors.push('base_id must be a number if provided');
    return errors;
}

// POST create
router.post('/', async (req: Request, res: Response) => {
    try {
        const payload = req.body;
        const errs = validatePayload(payload);
        if (errs.length) return res.status(400).json({ errors: errs });

        const insert = {
            base_id: payload.base_id ?? null,
            nome: payload.nome,
            coluna_indicador: payload.coluna_indicador,
            valor_cancelado: payload.valor_cancelado,
            valor_nao_cancelado: payload.valor_nao_cancelado,
            ativa: payload.ativa === undefined ? true : !!payload.ativa,
            created_at: db.fn.now(),
            updated_at: db.fn.now()
        } as any;

        const [id] = await db('configs_cancelamento').insert(insert);
        const created = await db('configs_cancelamento').where({ id }).first();
        try {
            const idxHelpers = await import('../db/indexHelpers');
            await idxHelpers.ensureIndicesForConfigCancelamento(created);
        } catch (e) {
            console.error('Error creating indices for new cancelamento config', e);
        }
        res.status(201).json(created);
    } catch (err: any) {
        console.error(err);
        res.status(400).json({ error: 'Erro ao criar config' });
    }
});

// GET list
router.get('/', async (req: Request, res: Response) => {
    try {
        const rows = await db('configs_cancelamento').select('*').orderBy('id', 'desc');
        res.json(rows);
    } catch (err: any) {
        console.error(err);
        res.status(400).json({ error: 'Erro ao listar configs' });
    }
});

// GET by id
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
        const row = await db('configs_cancelamento').where({ id }).first();
        if (!row) return res.status(404).json({ error: 'Not found' });
        res.json(row);
    } catch (err: any) {
        console.error(err);
        res.status(400).json({ error: 'Erro ao obter config' });
    }
});

// PUT update
router.put('/:id', async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
        const payload = req.body;
        const errs = validatePayload({ ...payload, base_id: payload.base_id ?? undefined });
        if (errs.length) return res.status(400).json({ errors: errs });

        const update = {
            base_id: payload.base_id ?? null,
            nome: payload.nome,
            coluna_indicador: payload.coluna_indicador,
            valor_cancelado: payload.valor_cancelado,
            valor_nao_cancelado: payload.valor_nao_cancelado,
            ativa: payload.ativa === undefined ? true : !!payload.ativa,
            updated_at: db.fn.now()
        } as any;

        await db('configs_cancelamento').where({ id }).update(update);
        const updated = await db('configs_cancelamento').where({ id }).first();
        try {
            const idxHelpers = await import('../db/indexHelpers');
            await idxHelpers.ensureIndicesForConfigCancelamento(updated);
        } catch (e) {
            console.error('Error creating indices for updated cancelamento config', e);
        }
        res.json(updated);
    } catch (err: any) {
        console.error(err);
        res.status(400).json({ error: 'Erro ao atualizar config' });
    }
});

// DELETE
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
        const row = await db('configs_cancelamento').where({ id }).first();
        if (!row) return res.status(404).json({ error: 'Not found' });
        await db('configs_cancelamento').where({ id }).del();
        res.status(204).send();
    } catch (err: any) {
        console.error(err);
        res.status(400).json({ error: 'Erro ao deletar config' });
    }
});

export default router;
