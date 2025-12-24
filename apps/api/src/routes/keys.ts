import { Router, Request, Response } from 'express';
import db from '../db/knex';

const router = Router();
const TABLE = 'keys_definitions';

function parseId(req: Request) {
    const id = Number(req.params.id);
    return Number.isFinite(id) && id > 0 ? { ok: true as const, id } : { ok: false as const, error: 'invalid id' };
}

function isStringArray(v: any): v is string[] {
    return Array.isArray(v) && v.every(x => typeof x === 'string');
}

function toJsonString(v: any) {
    return v === undefined ? null : JSON.stringify(v);
}

function parseRow(row: any) {
    if (!row) return row;
    let cols: any = row.columns;
    try {
        cols = typeof cols === 'string' ? JSON.parse(cols) : cols;
    } catch (_) {
        cols = null;
    }
    return { ...row, columns: cols };
}

async function validatePayload(payload: any, isUpdate = false) {
    const errors: string[] = [];
    if (!payload || typeof payload !== 'object') return ['payload must be an object'];

    if (!isUpdate || payload.nome !== undefined) {
        if (!payload.nome || typeof payload.nome !== 'string') errors.push('"nome" é obrigatório e deve ser string');
    }

    if (!isUpdate || payload.base_tipo !== undefined) {
        if (!payload.base_tipo || typeof payload.base_tipo !== 'string') errors.push('"base_tipo" é obrigatório e deve ser string');
        else if (!['CONTABIL', 'FISCAL'].includes(payload.base_tipo)) errors.push('"base_tipo" inválido');
    }

    if (!isUpdate || payload.base_subtipo !== undefined) {
        if (!payload.base_subtipo || typeof payload.base_subtipo !== 'string') errors.push('"base_subtipo" é obrigatório e deve ser string');
    }

    if (!isUpdate || payload.columns !== undefined) {
        if (!isStringArray(payload.columns)) errors.push('"columns" é obrigatório e deve ser array de strings');
        else if (payload.columns.length === 0) errors.push('"columns" não pode ser vazio');
        else if (!payload.columns.every((c: any) => typeof c === 'string' && c.trim() !== '')) errors.push('"columns" deve conter apenas strings não vazias');
    }

    return errors;
}

// List with optional filters: base_tipo, base_subtipo, nome search
router.get('/', async (req: Request, res: Response) => {
    try {
        const tipo = req.query.base_tipo as string | undefined;
        const subtype = req.query.base_subtipo as string | undefined;
        const nome = req.query.nome as string | undefined;
        const page = Math.max(1, Number(req.query.page || 1));
        const pageSizeRaw = Number(req.query.pageSize || 100);
        const pageSize = Math.min(1000, isFinite(pageSizeRaw) && pageSizeRaw > 0 ? pageSizeRaw : 100);

        // build base query for filters
        const baseQb = db(TABLE);
        if (tipo) baseQb.where('base_tipo', tipo);
        if (subtype) baseQb.where('base_subtipo', subtype);
        if (nome) baseQb.where('nome', 'like', `%${nome}%`);

        const totalRow = await baseQb.clone().count<{ total: number }[]>('* as total').first();
        const total = totalRow ? Number((totalRow as any).total || 0) : 0;

        const rows = await baseQb.clone().select('id','nome','descricao','base_tipo','base_subtipo','columns','created_at','updated_at')
            .orderBy('id', 'desc')
            .offset((page - 1) * pageSize)
            .limit(pageSize);

        const out = rows.map(parseRow);
        return res.json({ data: out, meta: { total, page, pageSize } });
    } catch (err: any) {
        console.error('GET /keys error', { err, query: req.query });
        return res.status(400).json({ error: 'Erro interno ao listar chaves' });
    }
});

router.get('/:id', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const row = await db(TABLE).where({ id: parsed.id }).first();
        if (!row) return res.status(404).json({ error: 'Not found' });
        return res.json(parseRow(row));
    } catch (err: any) {
        console.error('GET /keys/:id error', { err, params: req.params });
        return res.status(400).json({ error: 'Erro interno ao obter chave' });
    }
});

// Create
router.post('/', async (req: Request, res: Response) => {
    try {
        const payload = req.body;
        const errors = await validatePayload(payload, false);
        if (errors.length) return res.status(400).json({ errors });

        // verify base_subtipo exists (moved from validatePayload to handler to avoid DB IO in validator)
        if (payload.base_subtipo) {
            const exists = await db('base_subtypes').where({ name: payload.base_subtipo }).first();
            if (!exists) return res.status(400).json({ error: 'base_subtipo inválido (não encontrado em base_subtypes)' });
        }

        // optional uniqueness: nome within same base_tipo/base_subtipo
        const existing = await db(TABLE).where({ nome: payload.nome, base_tipo: payload.base_tipo, base_subtipo: payload.base_subtipo }).first();
        if (existing) return res.status(400).json({ error: 'Já existe uma chave com este nome para este tipo/subtipo' });

        const insert = {
            nome: payload.nome,
            descricao: payload.descricao || null,
            base_tipo: payload.base_tipo,
            base_subtipo: payload.base_subtipo,
            columns: toJsonString(payload.columns),
            created_at: db.fn.now(),
            updated_at: db.fn.now()
        } as any;

        let id: number;
        try {
            const resInsert = await db(TABLE).insert(insert);
            // knex returns different shapes depending on driver; normalize
            id = Array.isArray(resInsert) ? Number(resInsert[0]) : Number((resInsert as any).insertId || resInsert);
        } catch (err: any) {
            // handle unique constraint if migration added unique index
            const msg = String(err && err.message || '');
            if (/unique|constraint|sqlite_constrain/i.test(msg)) return res.status(409).json({ error: 'Chave já existe (unique constraint)' });
            throw err;
        }
        const created = await db(TABLE).where({ id }).first();
        return res.status(201).json(parseRow(created));
    } catch (err: any) {
        console.error('POST /keys error', err);
        return res.status(400).json({ error: 'Erro ao criar chave' });
    }
});

// Update
router.put('/:id', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const existingRow = await db(TABLE).where({ id: parsed.id }).first();
        if (!existingRow) return res.status(404).json({ error: 'Not found' });

        const payload = req.body;
        const errors = await validatePayload(payload, true);
        if (errors.length) return res.status(400).json({ errors });

        // verify base_subtipo exists if provided
        if (payload.base_subtipo) {
            const exists = await db('base_subtypes').where({ name: payload.base_subtipo }).first();
            if (!exists) return res.status(400).json({ error: 'base_subtipo inválido (não encontrado em base_subtypes)' });
        }

        // optional uniqueness when nome/base_tipo/base_subtipo provided
        if (payload.nome || payload.base_tipo || payload.base_subtipo) {
            const nomeToCheck = payload.nome || existingRow.nome;
            const tipoToCheck = payload.base_tipo || existingRow.base_tipo;
            const subtypeToCheck = payload.base_subtipo || existingRow.base_subtipo;
            const dup = await db(TABLE).where({ nome: nomeToCheck, base_tipo: tipoToCheck, base_subtipo: subtypeToCheck }).whereNot({ id: parsed.id }).first();
            if (dup) return res.status(400).json({ error: 'Já existe uma chave com este nome para este tipo/subtipo' });
        }

        const update: any = { updated_at: db.fn.now() };
        if (payload.nome !== undefined) update.nome = payload.nome;
        if (payload.descricao !== undefined) update.descricao = payload.descricao;
        if (payload.base_tipo !== undefined) update.base_tipo = payload.base_tipo;
        if (payload.base_subtipo !== undefined) update.base_subtipo = payload.base_subtipo;
        if (payload.columns !== undefined) update.columns = toJsonString(payload.columns);

        try {
            await db(TABLE).where({ id: parsed.id }).update(update);
        } catch (err: any) {
            const msg = String(err && err.message || '');
            if (/unique|constraint|sqlite_constrain/i.test(msg)) return res.status(409).json({ error: 'Chave já existe (unique constraint)' });
            throw err;
        }
        const updated = await db(TABLE).where({ id: parsed.id }).first();
        return res.json(parseRow(updated));
    } catch (err: any) {
        console.error('PUT /keys/:id error', { err, params: req.params, body: req.body });
        return res.status(400).json({ error: 'Erro interno ao atualizar chave' });
    }
});

// Delete
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const row = await db(TABLE).where({ id: parsed.id }).first();
        if (!row) return res.status(404).json({ error: 'Not found' });
        // Prevent deletion if this key is referenced by pairs or configs (foreign key restrictions)
        const usedInPairsRow = await db('keys_pairs').where(function () {
            this.where({ contabil_key_id: parsed.id }).orWhere({ fiscal_key_id: parsed.id });
        }).count({ c: '*' }).first();
        const usedInPairs = usedInPairsRow ? Number((usedInPairsRow as any).c || 0) > 0 : false;
        if (usedInPairs) return res.status(400).json({ error: 'Chave não pode ser removida: existe referência em pares de chaves (keys_pairs). Remova ou atualize os pares primeiro.' });

        const usedInConfigsRow = await db('configs_conciliacao_keys').where(function () {
            this.where({ contabil_key_id: parsed.id }).orWhere({ fiscal_key_id: parsed.id });
        }).count({ c: '*' }).first();
        const usedInConfigs = usedInConfigsRow ? Number((usedInConfigsRow as any).c || 0) > 0 : false;
        if (usedInConfigs) return res.status(400).json({ error: 'Chave não pode ser removida: existe referência em configurações de conciliação. Remova a referência antes de excluir.' });

        await db(TABLE).where({ id: parsed.id }).del();
        return res.status(204).send();
    } catch (err: any) {
        console.error('DELETE /keys/:id error', { err, params: req.params });
        return res.status(400).json({ error: 'Erro interno ao deletar chave' });
    }
});

export default router;
