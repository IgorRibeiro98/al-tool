import { Router, Request, Response } from 'express';
import db from '../db/knex';

const router = Router();

function validatePayload(payload: any) {
    const errors: string[] = [];
    if (!payload.nome || typeof payload.nome !== 'string') errors.push('nome is required and must be string');
    if (!payload.coluna_a || typeof payload.coluna_a !== 'string') errors.push('coluna_a is required and must be string');
    if (!payload.coluna_b || typeof payload.coluna_b !== 'string') errors.push('coluna_b is required and must be string');
    if (!payload.coluna_soma || typeof payload.coluna_soma !== 'string') errors.push('coluna_soma is required and must be string');
    if (payload.limite_zero !== undefined && isNaN(Number(payload.limite_zero))) errors.push('limite_zero must be a number if provided');
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
            coluna_a: payload.coluna_a,
            coluna_b: payload.coluna_b,
            coluna_soma: payload.coluna_soma,
            limite_zero: payload.limite_zero !== undefined ? Number(payload.limite_zero) : 0,
            ativa: payload.ativa === undefined ? true : !!payload.ativa,
            created_at: db.fn.now(),
            updated_at: db.fn.now()
        } as any;

        const [id] = await db('configs_estorno').insert(insert);
        const created = await db('configs_estorno').where({ id }).first();
        try {
            const idxHelpers = await import('../db/indexHelpers');
            await idxHelpers.ensureIndicesForConfigEstorno(created);
        } catch (e) {
            console.error('Error creating indices for new estorno config', e);
        }
        res.status(201).json(created);
    } catch (err: any) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao criar config estorno' });
    }
});

// GET list
router.get('/', async (req: Request, res: Response) => {
    try {
        const rows = await db('configs_estorno').select('*').orderBy('id', 'desc');
        res.json(rows);
    } catch (err: any) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao listar configs estorno' });
    }
});

// GET by id
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
        const row = await db('configs_estorno').where({ id }).first();
        if (!row) return res.status(404).json({ error: 'Not found' });
        res.json(row);
    } catch (err: any) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao obter config estorno' });
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
            base_id: payload.base_id ?? null,
            nome: payload.nome,
            coluna_a: payload.coluna_a,
            coluna_b: payload.coluna_b,
            coluna_soma: payload.coluna_soma,
            limite_zero: payload.limite_zero !== undefined ? Number(payload.limite_zero) : 0,
            ativa: payload.ativa === undefined ? true : !!payload.ativa,
            updated_at: db.fn.now()
        } as any;

        await db('configs_estorno').where({ id }).update(update);
        const updated = await db('configs_estorno').where({ id }).first();
        try {
            const idxHelpers = await import('../db/indexHelpers');
            await idxHelpers.ensureIndicesForConfigEstorno(updated);
        } catch (e) {
            console.error('Error creating indices for updated estorno config', e);
        }
        res.json(updated);
    } catch (err: any) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao atualizar config estorno' });
    }
});

// DELETE
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
        const row = await db('configs_estorno').where({ id }).first();
        if (!row) return res.status(404).json({ error: 'Not found' });
        await db('configs_estorno').where({ id }).del();
        res.status(204).send();
    } catch (err: any) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao deletar config estorno' });
    }
});

export default router;
