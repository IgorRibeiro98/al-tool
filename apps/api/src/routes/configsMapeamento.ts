import { Router, Request, Response } from 'express';
import db from '../db/knex';

const router = Router();

type MappingItem = { coluna_contabil: string; coluna_fiscal: string };

type RawMapping = Array<MappingItem>;

function isValidMappings(value: any): value is RawMapping {
    return Array.isArray(value) && value.every((item) => {
        if (!item || typeof item !== 'object') return false;
        const { coluna_contabil, coluna_fiscal } = item as MappingItem;
        return typeof coluna_contabil === 'string' && coluna_contabil.length > 0 && typeof coluna_fiscal === 'string' && coluna_fiscal.length > 0;
    });
}

function normalizeMappings(value: any): RawMapping {
    if (!isValidMappings(value)) return [];
    return value.map((item) => ({
        coluna_contabil: String(item.coluna_contabil).trim(),
        coluna_fiscal: String(item.coluna_fiscal).trim(),
    })).filter((item) => item.coluna_contabil.length > 0 && item.coluna_fiscal.length > 0);
}

function parseRow(row: any) {
    if (!row) return row;
    const parsed = { ...row };
    try {
        parsed.mapeamentos = row.mapeamentos ? JSON.parse(row.mapeamentos) : [];
    } catch (err) {
        parsed.mapeamentos = [];
    }
    return parsed;
}

function validatePayload(payload: any) {
    const errors: string[] = [];
    if (!payload || typeof payload !== 'object') {
        errors.push('payload inválido');
        return errors;
    }
    if (!payload.nome || typeof payload.nome !== 'string') errors.push('nome é obrigatório');
    if (typeof payload.base_contabil_id !== 'number' || Number.isNaN(payload.base_contabil_id)) errors.push('base_contabil_id é obrigatório e deve ser numérico');
    if (typeof payload.base_fiscal_id !== 'number' || Number.isNaN(payload.base_fiscal_id)) errors.push('base_fiscal_id é obrigatório e deve ser numérico');
    if (payload.base_contabil_id && payload.base_fiscal_id && payload.base_contabil_id === payload.base_fiscal_id) errors.push('base_contabil_id e base_fiscal_id devem ser diferentes');
    if (!isValidMappings(payload.mapeamentos)) errors.push('mapeamentos deve ser uma lista de objetos { coluna_contabil, coluna_fiscal }');
    else if (!payload.mapeamentos.length) errors.push('mapeamentos deve possuir ao menos um item');
    return errors;
}

router.get('/', async (_req: Request, res: Response) => {
    try {
        const rows = await db('configs_mapeamento_bases').select('*').orderBy('id', 'desc');
        res.json(rows.map(parseRow));
    } catch (err) {
        console.error('erro ao listar configs de mapeamento', err);
        res.status(400).json({ error: 'Erro ao listar configs de mapeamento' });
    }
});

router.get('/:id', async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'id inválido' });
        const row = await db('configs_mapeamento_bases').where({ id }).first();
        if (!row) return res.status(404).json({ error: 'Configuração não encontrada' });
        res.json(parseRow(row));
    } catch (err) {
        console.error('erro ao obter config de mapeamento', err);
        res.status(400).json({ error: 'Erro ao obter config de mapeamento' });
    }
});

router.post('/', async (req: Request, res: Response) => {
    try {
        const payload = req.body;
        const errors = validatePayload(payload);
        if (errors.length) return res.status(400).json({ errors });

        const [baseA, baseB] = await Promise.all([
            db('bases').where({ id: Number(payload.base_contabil_id) }).first(),
            db('bases').where({ id: Number(payload.base_fiscal_id) }).first()
        ]);
        if (!baseA) return res.status(400).json({ error: 'base_contabil_id inválido' });
        if (!baseB) return res.status(400).json({ error: 'base_fiscal_id inválido' });

        const normalizedMappings = normalizeMappings(payload.mapeamentos);
        if (!normalizedMappings.length) return res.status(400).json({ errors: ['mapeamentos normalizados não podem ficar vazios'] });

        const insert = {
            nome: payload.nome,
            base_contabil_id: Number(payload.base_contabil_id),
            base_fiscal_id: Number(payload.base_fiscal_id),
            mapeamentos: JSON.stringify(normalizedMappings),
            created_at: db.fn.now(),
            updated_at: db.fn.now(),
        } as any;

        const [id] = await db('configs_mapeamento_bases').insert(insert);
        const created = await db('configs_mapeamento_bases').where({ id }).first();
        res.status(201).json(parseRow(created));
    } catch (err) {
        console.error('erro ao criar config de mapeamento', err);
        res.status(400).json({ error: 'Erro ao criar config de mapeamento' });
    }
});

router.put('/:id', async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'id inválido' });
        const payload = req.body;
        const errors = validatePayload(payload);
        if (errors.length) return res.status(400).json({ errors });

        const [baseA, baseB] = await Promise.all([
            db('bases').where({ id: Number(payload.base_contabil_id) }).first(),
            db('bases').where({ id: Number(payload.base_fiscal_id) }).first()
        ]);
        if (!baseA) return res.status(400).json({ error: 'base_contabil_id inválido' });
        if (!baseB) return res.status(400).json({ error: 'base_fiscal_id inválido' });

        const normalizedMappings = normalizeMappings(payload.mapeamentos);
        if (!normalizedMappings.length) return res.status(400).json({ errors: ['mapeamentos normalizados não podem ficar vazios'] });

        await db('configs_mapeamento_bases').where({ id }).update({
            nome: payload.nome,
            base_contabil_id: Number(payload.base_contabil_id),
            base_fiscal_id: Number(payload.base_fiscal_id),
            mapeamentos: JSON.stringify(normalizedMappings),
            updated_at: db.fn.now(),
        });

        const updated = await db('configs_mapeamento_bases').where({ id }).first();
        res.json(parseRow(updated));
    } catch (err) {
        console.error('erro ao atualizar config de mapeamento', err);
        res.status(400).json({ error: 'Erro ao atualizar config de mapeamento' });
    }
});

router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'id inválido' });
        const row = await db('configs_mapeamento_bases').where({ id }).first();
        if (!row) return res.status(404).json({ error: 'Configuração não encontrada' });
        await db('configs_mapeamento_bases').where({ id }).del();
        res.status(204).send();
    } catch (err) {
        console.error('erro ao deletar config de mapeamento', err);
        res.status(400).json({ error: 'Erro ao deletar config de mapeamento' });
    }
});

export default router;
