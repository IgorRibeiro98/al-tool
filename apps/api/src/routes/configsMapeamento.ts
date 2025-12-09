import { Router, Request, Response } from 'express';
import db from '../db/knex';

const router = Router();
const TABLE = 'configs_mapeamento_bases';

type MappingItem = { coluna_contabil: string; coluna_fiscal: string };
type RawMapping = MappingItem[];

type MapeamentoPayload = {
    nome: string;
    base_contabil_id: number;
    base_fiscal_id: number;
    mapeamentos: RawMapping | string;
};

function isValidMappings(value: any): value is RawMapping {
    return Array.isArray(value) && value.every((item) => {
        if (!item || typeof item !== 'object') return false;
        const { coluna_contabil, coluna_fiscal } = item as MappingItem;
        return typeof coluna_contabil === 'string' && coluna_contabil.length > 0 && typeof coluna_fiscal === 'string' && coluna_fiscal.length > 0;
    });
}

function normalizeMappings(value: any): RawMapping {
    if (!value) return [];
    let parsed: any = value;
    if (typeof value === 'string') {
        try { parsed = JSON.parse(value); } catch { parsed = null; }
    }
    if (!isValidMappings(parsed)) return [];
    return parsed.map((item: MappingItem) => ({
        coluna_contabil: String(item.coluna_contabil).trim(),
        coluna_fiscal: String(item.coluna_fiscal).trim(),
    })).filter((item: MappingItem) => item.coluna_contabil.length > 0 && item.coluna_fiscal.length > 0);
}

function parseRow(row: any) {
    if (!row) return row;
    const parsed = { ...row };
    parsed.mapeamentos = normalizeMappings(row.mapeamentos);
    return parsed;
}

function validatePayload(payload: any): string[] {
    const errors: string[] = [];
    if (!payload || typeof payload !== 'object') {
        errors.push('payload inválido');
        return errors;
    }
    if (!payload.nome || typeof payload.nome !== 'string') errors.push('"nome" é obrigatório');
    if (typeof payload.base_contabil_id !== 'number' || Number.isNaN(payload.base_contabil_id)) errors.push('"base_contabil_id" é obrigatório e deve ser numérico');
    if (typeof payload.base_fiscal_id !== 'number' || Number.isNaN(payload.base_fiscal_id)) errors.push('"base_fiscal_id" é obrigatório e deve ser numérico');
    if (payload.base_contabil_id && payload.base_fiscal_id && payload.base_contabil_id === payload.base_fiscal_id) errors.push('"base_contabil_id" e "base_fiscal_id" devem ser diferentes');

    const normalized = normalizeMappings(payload.mapeamentos);
    if (!normalized.length) errors.push('"mapeamentos" deve possuir ao menos um item válido');
    return errors;
}

function parseId(req: Request) {
    const id = Number(req.params.id);
    return Number.isFinite(id) && id > 0 ? { ok: true as const, id } : { ok: false as const, error: 'id inválido' };
}

async function ensureBasesExist(contabilId: number, fiscalId: number) {
    const [baseA, baseB] = await Promise.all([
        db('bases').where({ id: contabilId }).first(),
        db('bases').where({ id: fiscalId }).first(),
    ]);
    return { baseA, baseB };
}

// List
router.get('/', async (_req: Request, res: Response) => {
    try {
        const rows = await db(TABLE).select('*').orderBy('id', 'desc');
        return res.json(rows.map(parseRow));
    } catch (err) {
        console.error('erro ao listar configs de mapeamento', err);
        return res.status(400).json({ error: 'Erro ao listar configs de mapeamento' });
    }
});

// Get
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const row = await db(TABLE).where({ id: parsed.id }).first();
        if (!row) return res.status(404).json({ error: 'Configuração não encontrada' });
        return res.json(parseRow(row));
    } catch (err) {
        console.error('erro ao obter config de mapeamento', err);
        return res.status(400).json({ error: 'Erro ao obter config de mapeamento' });
    }
});

// Create
router.post('/', async (req: Request, res: Response) => {
    try {
        const payload: MapeamentoPayload = req.body;
        const errors = validatePayload(payload);
        if (errors.length) return res.status(400).json({ errors });

        const normalized = normalizeMappings(payload.mapeamentos);
        const { baseA, baseB } = await ensureBasesExist(Number(payload.base_contabil_id), Number(payload.base_fiscal_id));
        if (!baseA) return res.status(400).json({ error: 'base_contabil_id inválido' });
        if (!baseB) return res.status(400).json({ error: 'base_fiscal_id inválido' });

        if (!normalized.length) return res.status(400).json({ errors: ['"mapeamentos" normalizados não podem ficar vazios'] });

        const insert = {
            nome: payload.nome,
            base_contabil_id: Number(payload.base_contabil_id),
            base_fiscal_id: Number(payload.base_fiscal_id),
            mapeamentos: JSON.stringify(normalized),
            created_at: db.fn.now(),
            updated_at: db.fn.now(),
        } as any;

        const [id] = await db(TABLE).insert(insert);
        const created = await db(TABLE).where({ id }).first();
        return res.status(201).json(parseRow(created));
    } catch (err) {
        console.error('erro ao criar config de mapeamento', err);
        return res.status(400).json({ error: 'Erro ao criar config de mapeamento' });
    }
});

// Update
router.put('/:id', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const payload: MapeamentoPayload = req.body;
        const errors = validatePayload(payload);
        if (errors.length) return res.status(400).json({ errors });

        const normalized = normalizeMappings(payload.mapeamentos);
        const { baseA, baseB } = await ensureBasesExist(Number(payload.base_contabil_id), Number(payload.base_fiscal_id));
        if (!baseA) return res.status(400).json({ error: 'base_contabil_id inválido' });
        if (!baseB) return res.status(400).json({ error: 'base_fiscal_id inválido' });

        if (!normalized.length) return res.status(400).json({ errors: ['"mapeamentos" normalizados não podem ficar vazios'] });

        await db(TABLE).where({ id: parsed.id }).update({
            nome: payload.nome,
            base_contabil_id: Number(payload.base_contabil_id),
            base_fiscal_id: Number(payload.base_fiscal_id),
            mapeamentos: JSON.stringify(normalized),
            updated_at: db.fn.now(),
        });

        const updated = await db(TABLE).where({ id: parsed.id }).first();
        return res.json(parseRow(updated));
    } catch (err) {
        console.error('erro ao atualizar config de mapeamento', err);
        return res.status(400).json({ error: 'Erro ao atualizar config de mapeamento' });
    }
});

// Delete
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const row = await db(TABLE).where({ id: parsed.id }).first();
        if (!row) return res.status(404).json({ error: 'Configuração não encontrada' });
        await db(TABLE).where({ id: parsed.id }).del();
        return res.status(204).send();
    } catch (err) {
        console.error('erro ao deletar config de mapeamento', err);
        return res.status(400).json({ error: 'Erro ao deletar config de mapeamento' });
    }
});

export default router;
