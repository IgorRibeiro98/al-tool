import { Router, Request, Response } from 'express';
import db from '../db/knex';

const router = Router();
const TABLE = 'configs_cancelamento';

type CancelamentoPayload = {
    base_id?: number | null;
    nome: string;
    coluna_indicador: string;
    valor_cancelado: string;
    valor_nao_cancelado: string;
    ativa?: boolean;
};

function validatePayload(payload: any): string[] {
    const errors: string[] = [];
    if (!payload || typeof payload !== 'object') {
        errors.push('payload must be an object');
        return errors;
    }

    if (!payload.nome || typeof payload.nome !== 'string') errors.push('"nome" é obrigatório e deve ser string');
    if (!payload.coluna_indicador || typeof payload.coluna_indicador !== 'string') errors.push('"coluna_indicador" é obrigatório e deve ser string');
    if (!payload.valor_cancelado || typeof payload.valor_cancelado !== 'string') errors.push('"valor_cancelado" é obrigatório e deve ser string');
    if (!payload.valor_nao_cancelado || typeof payload.valor_nao_cancelado !== 'string') errors.push('"valor_nao_cancelado" é obrigatório e deve ser string');

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
        await idxHelpers.ensureIndicesForConfigCancelamento(row);
    } catch (e) {
        console.error('Error creating indices for cancelamento config', e);
    }
}

// Create
router.post('/', async (req: Request, res: Response) => {
    try {
        const payload: CancelamentoPayload = req.body;
        const errors = validatePayload(payload);
        if (errors.length) return res.status(400).json({ errors });

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

        const [id] = await db(TABLE).insert(insert);
        const created = await db(TABLE).where({ id }).first();
        await ensureIndicesForRow(created);
        return res.status(201).json(created);
    } catch (err: any) {
        console.error('POST /configs_cancelamento error', err);
        return res.status(400).json({ error: 'Erro ao criar config' });
    }
});

// List
router.get('/', async (req: Request, res: Response) => {
    try {
        const rows = await db(TABLE).select('*').orderBy('id', 'desc');
        return res.json(rows);
    } catch (err: any) {
        console.error('GET /configs_cancelamento error', err);
        return res.status(400).json({ error: 'Erro ao listar configs' });
    }
});

// Get by id
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });

        const row = await db(TABLE).where({ id: parsed.id }).first();
        if (!row) return res.status(404).json({ error: 'Not found' });
        return res.json(row);
    } catch (err: any) {
        console.error('GET /configs_cancelamento/:id error', err);
        return res.status(400).json({ error: 'Erro ao obter config' });
    }
});

// Update
router.put('/:id', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });

        const payload: CancelamentoPayload = req.body;
        const errors = validatePayload({ ...payload, base_id: payload.base_id ?? undefined });
        if (errors.length) return res.status(400).json({ errors });

        const update = {
            base_id: payload.base_id ?? null,
            nome: payload.nome,
            coluna_indicador: payload.coluna_indicador,
            valor_cancelado: payload.valor_cancelado,
            valor_nao_cancelado: payload.valor_nao_cancelado,
            ativa: payload.ativa === undefined ? true : !!payload.ativa,
            updated_at: db.fn.now()
        } as any;

        await db(TABLE).where({ id: parsed.id }).update(update);
        const updated = await db(TABLE).where({ id: parsed.id }).first();
        await ensureIndicesForRow(updated);
        return res.json(updated);
    } catch (err: any) {
        console.error('PUT /configs_cancelamento/:id error', err);
        return res.status(400).json({ error: 'Erro ao atualizar config' });
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
        console.error('DELETE /configs_cancelamento/:id error', err);
        return res.status(400).json({ error: 'Erro ao deletar config' });
    }
});

export default router;
