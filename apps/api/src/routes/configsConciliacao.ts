import { Router, Request, Response } from 'express';
import db from '../db/knex';

const router = Router();
const TABLE = 'configs_conciliacao';

type Chaves = string[] | Record<string, string[]>;

type ConciliacaoPayload = {
    nome: string;
    base_contabil_id: number;
    base_fiscal_id: number;
    chaves_contabil: Chaves;
    chaves_fiscal: Chaves;
    coluna_conciliacao_contabil: string;
    coluna_conciliacao_fiscal: string;
    inverter_sinal_fiscal?: boolean;
    limite_diferenca_imaterial?: number | string;
};

function isStringArray(v: any): v is string[] {
    return Array.isArray(v) && v.every(x => typeof x === 'string');
}

function isChavesMap(v: any): v is Record<string, string[]> {
    return !!v && typeof v === 'object' && Object.values(v).every((arr: any) => Array.isArray(arr) && arr.every((x: any) => typeof x === 'string'));
}

function validatePayload(payload: any): string[] {
    const errors: string[] = [];
    if (!payload || typeof payload !== 'object') return ['payload must be an object'];

    if (!payload.nome || typeof payload.nome !== 'string') errors.push('"nome" é obrigatório e deve ser string');
    if (payload.base_contabil_id === undefined || typeof payload.base_contabil_id !== 'number' || Number.isNaN(payload.base_contabil_id)) errors.push('"base_contabil_id" é obrigatório e deve ser número');
    if (payload.base_fiscal_id === undefined || typeof payload.base_fiscal_id !== 'number' || Number.isNaN(payload.base_fiscal_id)) errors.push('"base_fiscal_id" é obrigatório e deve ser número');

    if (!(isStringArray(payload.chaves_contabil) || isChavesMap(payload.chaves_contabil))) errors.push('"chaves_contabil" é obrigatório e deve ser array de strings ou mapa');
    if (!(isStringArray(payload.chaves_fiscal) || isChavesMap(payload.chaves_fiscal))) errors.push('"chaves_fiscal" é obrigatório e deve ser array de strings ou mapa');

    if (!payload.coluna_conciliacao_contabil || typeof payload.coluna_conciliacao_contabil !== 'string') errors.push('"coluna_conciliacao_contabil" é obrigatório e deve ser string');
    if (!payload.coluna_conciliacao_fiscal || typeof payload.coluna_conciliacao_fiscal !== 'string') errors.push('"coluna_conciliacao_fiscal" é obrigatório e deve ser string');

    if (payload.inverter_sinal_fiscal !== undefined && typeof payload.inverter_sinal_fiscal !== 'boolean') errors.push('"inverter_sinal_fiscal" deve ser booleano quando informado');
    if (payload.limite_diferenca_imaterial !== undefined && isNaN(Number(payload.limite_diferenca_imaterial))) errors.push('"limite_diferenca_imaterial" deve ser numérico quando informado');

    return errors;
}

function parseChavesField(raw: any): Record<string, any> {
    if (!raw) return {};
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed)) return { CHAVE_1: parsed };
        if (parsed && typeof parsed === 'object') return parsed;
        return {};
    } catch {
        return {};
    }
}

function parseRow(row: any) {
    return {
        ...row,
        chaves_contabil: parseChavesField(row.chaves_contabil),
        chaves_fiscal: parseChavesField(row.chaves_fiscal)
    };
}

function parseId(req: Request) {
    const id = Number(req.params.id);
    return Number.isFinite(id) && id > 0 ? { ok: true as const, id } : { ok: false as const, error: 'invalid id' };
}

async function ensureIndicesForRow(row: any) {
    if (!row) return;
    try {
        const idxHelpers = await import('../db/indexHelpers');
        await idxHelpers.ensureIndicesForConfigConciliacao(row);
    } catch (e) {
        console.error('Error creating indices for conciliacao config', e);
    }
}

function toJsonString(v: any) {
    return v === undefined ? null : JSON.stringify(v);
}

// Create
router.post('/', async (req: Request, res: Response) => {
    try {
        const payload: ConciliacaoPayload = req.body;
        const errors = validatePayload(payload);
        if (errors.length) return res.status(400).json({ errors });

        const insert = {
            nome: payload.nome,
            base_contabil_id: payload.base_contabil_id,
            base_fiscal_id: payload.base_fiscal_id,
            chaves_contabil: toJsonString(payload.chaves_contabil),
            chaves_fiscal: toJsonString(payload.chaves_fiscal),
            coluna_conciliacao_contabil: payload.coluna_conciliacao_contabil,
            coluna_conciliacao_fiscal: payload.coluna_conciliacao_fiscal,
            inverter_sinal_fiscal: payload.inverter_sinal_fiscal === true,
            limite_diferenca_imaterial: payload.limite_diferenca_imaterial !== undefined ? Number(payload.limite_diferenca_imaterial) : 0,
            created_at: db.fn.now(),
            updated_at: db.fn.now()
        } as any;

        const [id] = await db(TABLE).insert(insert);
        const created = await db(TABLE).where({ id }).first();
        await ensureIndicesForRow(created);
        return res.status(201).json(parseRow(created));
    } catch (err: any) {
        console.error('POST /configs_conciliacao error', err);
        return res.status(400).json({ error: 'Erro ao criar config conciliacao' });
    }
});

// List
router.get('/', async (req: Request, res: Response) => {
    try {
        const rows = await db(TABLE).select('*').orderBy('id', 'desc');
        return res.json(rows.map(parseRow));
    } catch (err: any) {
        console.error('GET /configs_conciliacao error', err);
        return res.status(400).json({ error: 'Erro ao listar configs conciliacao' });
    }
});

// Get by id
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const row = await db(TABLE).where({ id: parsed.id }).first();
        if (!row) return res.status(404).json({ error: 'Not found' });
        return res.json(parseRow(row));
    } catch (err: any) {
        console.error('GET /configs_conciliacao/:id error', err);
        return res.status(400).json({ error: 'Erro ao obter config conciliacao' });
    }
});

// Update
router.put('/:id', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });

        const payload: ConciliacaoPayload = req.body;
        const errors = validatePayload(payload);
        if (errors.length) return res.status(400).json({ errors });

        const update = {
            nome: payload.nome,
            base_contabil_id: payload.base_contabil_id,
            base_fiscal_id: payload.base_fiscal_id,
            chaves_contabil: toJsonString(payload.chaves_contabil),
            chaves_fiscal: toJsonString(payload.chaves_fiscal),
            coluna_conciliacao_contabil: payload.coluna_conciliacao_contabil,
            coluna_conciliacao_fiscal: payload.coluna_conciliacao_fiscal,
            inverter_sinal_fiscal: payload.inverter_sinal_fiscal === true,
            limite_diferenca_imaterial: payload.limite_diferenca_imaterial !== undefined ? Number(payload.limite_diferenca_imaterial) : 0,
            updated_at: db.fn.now()
        } as any;

        await db(TABLE).where({ id: parsed.id }).update(update);
        const updated = await db(TABLE).where({ id: parsed.id }).first();
        await ensureIndicesForRow(updated);
        return res.json(parseRow(updated));
    } catch (err: any) {
        console.error('PUT /configs_conciliacao/:id error', err);
        return res.status(400).json({ error: 'Erro ao atualizar config conciliacao' });
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
        console.error('DELETE /configs_conciliacao/:id error', err);
        return res.status(400).json({ error: 'Erro ao deletar config conciliacao' });
    }
});

export default router;
