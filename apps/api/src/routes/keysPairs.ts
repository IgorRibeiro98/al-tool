import { Router, Request, Response } from 'express';
import db from '../db/knex';

const router = Router();
const TABLE = 'keys_pairs';

function parseId(req: Request) {
    const id = Number(req.params.id);
    return Number.isFinite(id) && id > 0 ? { ok: true as const, id } : { ok: false as const, error: 'invalid id' };
}

async function expandPair(row: any) {
    if (!row) return row;
    const contabil = row.contabil_key_id ? await db('keys_definitions').where({ id: row.contabil_key_id }).first() : null;
    const fiscal = row.fiscal_key_id ? await db('keys_definitions').where({ id: row.fiscal_key_id }).first() : null;
    return {
        ...row,
        contabil_key: contabil ? { id: contabil.id, nome: contabil.nome, base_tipo: contabil.base_tipo, base_subtipo: contabil.base_subtipo } : null,
        fiscal_key: fiscal ? { id: fiscal.id, nome: fiscal.nome, base_tipo: fiscal.base_tipo, base_subtipo: fiscal.base_subtipo } : null
    };
}

async function validatePayload(payload: any) {
    const errors: string[] = [];
    if (!payload || typeof payload !== 'object') return ['payload must be an object'];

    if (payload.nome === undefined || typeof payload.nome !== 'string' || !payload.nome) errors.push('"nome" é obrigatório e deve ser string');

    if (payload.contabil_key_id === undefined || typeof payload.contabil_key_id !== 'number' || Number.isNaN(payload.contabil_key_id)) errors.push('"contabil_key_id" é obrigatório e deve ser número');
    if (payload.fiscal_key_id === undefined || typeof payload.fiscal_key_id !== 'number' || Number.isNaN(payload.fiscal_key_id)) errors.push('"fiscal_key_id" é obrigatório e deve ser número');

    if (errors.length) return errors;
    return [];
}

// List
router.get('/', async (req: Request, res: Response) => {
    try {
        const page = Math.max(1, Number(req.query.page || 1));
        const pageSizeRaw = Number(req.query.pageSize || 100);
        const pageSize = Math.min(1000, isFinite(pageSizeRaw) && pageSizeRaw > 0 ? pageSizeRaw : 100);

        // select minimal columns and paginate
        const baseQb = db(TABLE);
        const totalRow = await baseQb.clone().count<{ total: number }[]>('* as total').first();
        const total = totalRow ? Number((totalRow as any).total || 0) : 0;

        const pairs = await baseQb.clone()
            .select('id','nome','descricao','contabil_key_id','fiscal_key_id','created_at','updated_at')
            .orderBy('id', 'desc')
            .offset((page - 1) * pageSize)
            .limit(pageSize);

        // batch load referenced key definitions to avoid N+1
        const contabilIds = Array.from(new Set(pairs.map(p => p.contabil_key_id).filter(Boolean)));
        const fiscalIds = Array.from(new Set(pairs.map(p => p.fiscal_key_id).filter(Boolean)));
        const defIds = Array.from(new Set([...contabilIds, ...fiscalIds]));
        const defs = defIds.length ? await db('keys_definitions').whereIn('id', defIds).select('id','nome','base_tipo','base_subtipo') : [];
        const defsMap: Record<number, any> = {};
        for (const d of defs) defsMap[d.id] = d;

        const expanded = pairs.map((p: any) => ({
            ...p,
            contabil_key: p.contabil_key_id ? (defsMap[p.contabil_key_id] ? { id: defsMap[p.contabil_key_id].id, nome: defsMap[p.contabil_key_id].nome, base_tipo: defsMap[p.contabil_key_id].base_tipo, base_subtipo: defsMap[p.contabil_key_id].base_subtipo } : null) : null,
            fiscal_key: p.fiscal_key_id ? (defsMap[p.fiscal_key_id] ? { id: defsMap[p.fiscal_key_id].id, nome: defsMap[p.fiscal_key_id].nome, base_tipo: defsMap[p.fiscal_key_id].base_tipo, base_subtipo: defsMap[p.fiscal_key_id].base_subtipo } : null) : null
        }));

        return res.json({ data: expanded, meta: { total, page, pageSize } });
    } catch (err: any) {
        console.error('GET /keys-pairs error', { err, query: req.query });
        return res.status(500).json({ error: 'Erro interno ao listar pares de chaves' });
    }
});

router.get('/:id', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const row = await db(TABLE).where({ id: parsed.id }).first();
        if (!row) return res.status(404).json({ error: 'Not found' });
        const contabil = row.contabil_key_id ? await db('keys_definitions').where({ id: row.contabil_key_id }).first() : null;
        const fiscal = row.fiscal_key_id ? await db('keys_definitions').where({ id: row.fiscal_key_id }).first() : null;
        const expanded = {
            ...row,
            contabil_key: contabil ? { id: contabil.id, nome: contabil.nome, base_tipo: contabil.base_tipo, base_subtipo: contabil.base_subtipo } : null,
            fiscal_key: fiscal ? { id: fiscal.id, nome: fiscal.nome, base_tipo: fiscal.base_tipo, base_subtipo: fiscal.base_subtipo } : null
        };
        return res.json(expanded);
    } catch (err: any) {
        console.error('GET /keys-pairs/:id error', { err, params: req.params });
        return res.status(500).json({ error: 'Erro interno ao obter par de chaves' });
    }
});

// Create
router.post('/', async (req: Request, res: Response) => {
    try {
        const payload = req.body;
        const errors = await validatePayload(payload);
        if (errors.length) return res.status(400).json({ errors });
        // verify referenced key definitions and compatibility
        const contabil = await db('keys_definitions').where({ id: payload.contabil_key_id }).first();
        if (!contabil) return res.status(400).json({ error: 'contabil_key_id não encontrado' });
        if (contabil.base_tipo !== 'CONTABIL') return res.status(400).json({ error: 'contabil_key_id deve referenciar chave com base_tipo=CONTABIL' });

        const fiscal = await db('keys_definitions').where({ id: payload.fiscal_key_id }).first();
        if (!fiscal) return res.status(400).json({ error: 'fiscal_key_id não encontrado' });
        if (fiscal.base_tipo !== 'FISCAL') return res.status(400).json({ error: 'fiscal_key_id deve referenciar chave com base_tipo=FISCAL' });

        if (contabil.base_subtipo && fiscal.base_subtipo && contabil.base_subtipo !== fiscal.base_subtipo) {
            return res.status(400).json({ error: 'base_subtipo incompatível entre contabil_key e fiscal_key' });
        }

        // prevent duplicate pair (application-level quick check)
        const exists = await db(TABLE).where({ contabil_key_id: payload.contabil_key_id, fiscal_key_id: payload.fiscal_key_id }).first();
        if (exists) return res.status(409).json({ error: 'Par de chaves já existe' });

        const insert = {
            nome: payload.nome,
            descricao: payload.descricao || null,
            contabil_key_id: payload.contabil_key_id,
            fiscal_key_id: payload.fiscal_key_id,
            created_at: db.fn.now(),
            updated_at: db.fn.now()
        } as any;

        let id: number;
        try {
            const resInsert = await db(TABLE).insert(insert);
            id = Array.isArray(resInsert) ? Number(resInsert[0]) : Number((resInsert as any).insertId || resInsert);
        } catch (err: any) {
            const msg = String(err && err.message || '');
            if (/unique|constraint|sqlite_constrain/i.test(msg)) return res.status(409).json({ error: 'Par de chaves já existe (constraint)' });
            throw err;
        }

        const created = await db(TABLE).where({ id }).first();
        const expanded = await expandPair(created);
        return res.status(201).json(expanded);
    } catch (err: any) {
        console.error('POST /keys-pairs error', { err, body: req.body });
        return res.status(500).json({ error: 'Erro interno ao criar par de chaves' });
    }
});

// Update
router.put('/:id', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const existing = await db(TABLE).where({ id: parsed.id }).first();
        if (!existing) return res.status(404).json({ error: 'Not found' });

        const payload = req.body;
        // allow partial updates? requirement says validate in POST/PUT — so require full payload
        const errors = await validatePayload(payload);
        if (errors.length) return res.status(400).json({ errors });

        // verify referenced key definitions and compatibility if provided
        if (payload.contabil_key_id !== undefined) {
            const contabil = await db('keys_definitions').where({ id: payload.contabil_key_id }).first();
            if (!contabil) return res.status(400).json({ error: 'contabil_key_id não encontrado' });
            if (contabil.base_tipo !== 'CONTABIL') return res.status(400).json({ error: 'contabil_key_id deve referenciar chave com base_tipo=CONTABIL' });
            if (contabil.base_subtipo && existing.fiscal_key_id) {
                const fiscalDef = await db('keys_definitions').where({ id: existing.fiscal_key_id }).first();
                if (fiscalDef && fiscalDef.base_subtipo && contabil.base_subtipo !== fiscalDef.base_subtipo) return res.status(400).json({ error: 'base_subtipo incompatível entre contabil_key e fiscal_key' });
            }
        }
        if (payload.fiscal_key_id !== undefined) {
            const fiscal = await db('keys_definitions').where({ id: payload.fiscal_key_id }).first();
            if (!fiscal) return res.status(400).json({ error: 'fiscal_key_id não encontrado' });
            if (fiscal.base_tipo !== 'FISCAL') return res.status(400).json({ error: 'fiscal_key_id deve referenciar chave com base_tipo=FISCAL' });
            if (fiscal.base_subtipo && existing.contabil_key_id) {
                const contDef = await db('keys_definitions').where({ id: existing.contabil_key_id }).first();
                if (contDef && contDef.base_subtipo && contDef.base_subtipo !== fiscal.base_subtipo) return res.status(400).json({ error: 'base_subtipo incompatível entre contabil_key e fiscal_key' });
            }
        }

        // if changing both ids or one of them, ensure pair won't collide with existing pair
        const newContId = payload.contabil_key_id !== undefined ? payload.contabil_key_id : existing.contabil_key_id;
        const newFiscalId = payload.fiscal_key_id !== undefined ? payload.fiscal_key_id : existing.fiscal_key_id;
        const dup = await db(TABLE).where({ contabil_key_id: newContId, fiscal_key_id: newFiscalId }).whereNot({ id: parsed.id }).first();
        if (dup) return res.status(409).json({ error: 'Outro par de chaves já existe com esses ids' });

        const update: any = { updated_at: db.fn.now() };
        if (payload.nome !== undefined) update.nome = payload.nome;
        if (payload.descricao !== undefined) update.descricao = payload.descricao;
        if (payload.contabil_key_id !== undefined) update.contabil_key_id = payload.contabil_key_id;
        if (payload.fiscal_key_id !== undefined) update.fiscal_key_id = payload.fiscal_key_id;

        try {
            await db(TABLE).where({ id: parsed.id }).update(update);
        } catch (err: any) {
            const msg = String(err && err.message || '');
            if (/unique|constraint|sqlite_constrain/i.test(msg)) return res.status(409).json({ error: 'Par de chaves já existe (constraint)' });
            throw err;
        }

        const updated = await db(TABLE).where({ id: parsed.id }).first();
        const expanded = await expandPair(updated);
        return res.json(expanded);
    } catch (err: any) {
        console.error('PUT /keys-pairs/:id error', err);
        return res.status(400).json({ error: 'Erro ao atualizar par de chaves' });
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
        console.error('DELETE /keys-pairs/:id error', { err, params: req.params });
        return res.status(500).json({ error: 'Erro interno ao deletar par de chaves' });
    }
});

export default router;
