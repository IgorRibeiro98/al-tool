import { Router, Request, Response } from 'express';
import db from '../db/knex';

const router = Router();
const TABLE = 'configs_estorno';

type EstornoPayload = {
    base_id?: number | null;
    nome: string;
    coluna_a: string;
    coluna_b: string;
    coluna_soma: string;
    limite_zero?: number | string;
    ativa?: boolean;
};

function validatePayload(payload: any): string[] {
    const errors: string[] = [];
    if (!payload || typeof payload !== 'object') return ['payload must be an object'];

    if (!payload.nome || typeof payload.nome !== 'string') errors.push('"nome" é obrigatório e deve ser string');
    if (!payload.coluna_a || typeof payload.coluna_a !== 'string') errors.push('"coluna_a" é obrigatório e deve ser string');
    if (!payload.coluna_b || typeof payload.coluna_b !== 'string') errors.push('"coluna_b" é obrigatório e deve ser string');
    if (!payload.coluna_soma || typeof payload.coluna_soma !== 'string') errors.push('"coluna_soma" é obrigatório e deve ser string');

    if (payload.limite_zero !== undefined && isNaN(Number(payload.limite_zero))) errors.push('"limite_zero" deve ser numérico quando informado');
    if (payload.ativa !== undefined && typeof payload.ativa !== 'boolean') errors.push('"ativa" deve ser booleano quando informado');

    if (payload.base_id !== undefined && payload.base_id !== null) {
        const n = Number(payload.base_id);
        if (!Number.isFinite(n) || n <= 0) errors.push('"base_id" deve ser um número positivo quando fornecido');
    }

    return errors;
}

function parseId(req: Request) {
    const id = Number(req.params.id);
    return Number.isFinite(id) && id > 0 ? { ok: true as const, id } : { ok: false as const, error: 'invalid id' };
}

async function ensureIndicesForRow(row: any) {
    if (!row) return;
    try {
        const idxHelpers = await import('../db/indexHelpers');
        await idxHelpers.ensureIndicesForConfigEstorno(row);
    } catch (e) {
        console.error('Error creating indices for estorno config', e);
    }
}

function toNumber(v: any, fallback = 0) {
    if (v === undefined || v === null || v === '') return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

// Create
router.post('/', async (req: Request, res: Response) => {
    try {
        const payload: EstornoPayload = req.body;
        const errors = validatePayload(payload);
        if (errors.length) return res.status(400).json({ errors });

        const insert = {
            base_id: payload.base_id ?? null,
            nome: payload.nome,
            coluna_a: payload.coluna_a,
            coluna_b: payload.coluna_b,
            coluna_soma: payload.coluna_soma,
            limite_zero: toNumber(payload.limite_zero, 0),
            ativa: payload.ativa === undefined ? true : !!payload.ativa,
            created_at: db.fn.now(),
            updated_at: db.fn.now()
        } as any;

        const [id] = await db(TABLE).insert(insert);
        const created = await db(TABLE).where({ id }).first();
        await ensureIndicesForRow(created);
        return res.status(201).json(created);
    } catch (err: any) {
        console.error('POST /configs_estorno error', err);
        return res.status(400).json({ error: 'Erro ao criar config estorno' });
    }
});

// List
router.get('/', async (req: Request, res: Response) => {
    try {
        const rows = await db(TABLE).select('*').orderBy('id', 'desc');
        return res.json(rows);
    } catch (err: any) {
        console.error('GET /configs_estorno error', err);
        return res.status(400).json({ error: 'Erro ao listar configs estorno' });
    }
});

// Get
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const row = await db(TABLE).where({ id: parsed.id }).first();
        if (!row) return res.status(404).json({ error: 'Not found' });
        return res.json(row);
    } catch (err: any) {
        console.error('GET /configs_estorno/:id error', err);
        return res.status(400).json({ error: 'Erro ao obter config estorno' });
    }
});

// Update
router.put('/:id', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });

        const payload: EstornoPayload = req.body;
        const errors = validatePayload(payload);
        if (errors.length) return res.status(400).json({ errors });

        const update = {
            base_id: payload.base_id ?? null,
            nome: payload.nome,
            coluna_a: payload.coluna_a,
            coluna_b: payload.coluna_b,
            coluna_soma: payload.coluna_soma,
            limite_zero: toNumber(payload.limite_zero, 0),
            ativa: payload.ativa === undefined ? true : !!payload.ativa,
            updated_at: db.fn.now()
        } as any;

        await db(TABLE).where({ id: parsed.id }).update(update);
        const updated = await db(TABLE).where({ id: parsed.id }).first();
        await ensureIndicesForRow(updated);
        return res.json(updated);
    } catch (err: any) {
        console.error('PUT /configs_estorno/:id error', err);
        return res.status(400).json({ error: 'Erro ao atualizar config estorno' });
    }
});

// Delete
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const row = await db(TABLE).where({ id: parsed.id }).first();
        if (!row) return res.status(404).json({ error: 'Not found' });
        await db(TABLE).where({ id: parsed.id }).del();
        return res.status(204).send();
    } catch (err: any) {
        console.error('DELETE /configs_estorno/:id error', err);
        return res.status(400).json({ error: 'Erro ao deletar config estorno' });
    }
});

export default router;
