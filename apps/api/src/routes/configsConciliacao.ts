import { Router, Request, Response } from 'express';
import db from '../db/knex';

const router = Router();
const TABLE = 'configs_conciliacao';

type Chaves = string[] | Record<string, string[]>;

type KeyItem = {
    key_identifier: string;
    keys_pair_id?: number;
    contabil_key_id?: number;
    fiscal_key_id?: number;
    ordem?: number;
};

type ConciliacaoPayload = {
    nome: string;
    base_contabil_id: number;
    base_fiscal_id: number;
    // legacy fields kept for backward compatibility, new contract uses `keys`
    chaves_contabil?: Chaves;
    chaves_fiscal?: Chaves;
    keys?: KeyItem[];
    coluna_conciliacao_contabil: string;
    coluna_conciliacao_fiscal: string;
    inverter_sinal_fiscal?: boolean;
    limite_diferenca_imaterial?: number | string;
};

type KeysForConfig = Array<{
    id: number;
    key_identifier: string;
    keys_pair_id?: number | null;
    contabil_key_id?: number | null;
    fiscal_key_id?: number | null;
    ordem?: number | null;
    keys_pair?: any | null;
    contabil_key?: any | null;
    fiscal_key?: any | null;
}>;

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

    // New contract: require `keys` array referencing central keys. Legacy inline chaves_* are deprecated
    if (payload.chaves_contabil !== undefined || payload.chaves_fiscal !== undefined) errors.push('Envio de chaves inline (chaves_contabil / chaves_fiscal) foi descontinuado. Use o campo `keys` referenciando chaves centrais');
    if (!Array.isArray(payload.keys) || payload.keys.length === 0) errors.push('"keys" é obrigatório e deve ser um array com pelo menos 1 item');

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

async function loadKeysForConfig(configId: number) {
    const objs = await loadKeysForConfigs([configId]);
    return objs[configId] || [];
}

// Bulk loader to avoid N+1 queries when listing many configs
async function loadKeysForConfigs(configIds: number[]) {
    const out: Record<number, KeysForConfig> = {};
    if (!configIds || configIds.length === 0) return out;

    const keysRows = await db('configs_conciliacao_keys').whereIn('config_conciliacao_id', configIds).orderBy('ordem', 'asc').select('*');
    if (!keysRows || keysRows.length === 0) return out;

    const pairIds = Array.from(new Set(keysRows.filter(r => r.keys_pair_id).map(r => r.keys_pair_id)));
    const directDefIds = Array.from(new Set(keysRows.flatMap(r => [r.contabil_key_id, r.fiscal_key_id].filter(Boolean))));

    // fetch pairs and collect referenced defs
    const pairs = pairIds.length ? await db('keys_pairs').whereIn('id', pairIds).select('*') : [];
    const defsFromPairs = pairs.flatMap(p => [p.contabil_key_id, p.fiscal_key_id].filter(Boolean));

    const defIds = Array.from(new Set([...directDefIds, ...defsFromPairs]));
    const defs = defIds.length ? await db('keys_definitions').whereIn('id', defIds).select('*') : [];

    const pairsMap: Record<number, any> = {};
    for (const p of pairs) pairsMap[p.id] = p;

    const defsMap: Record<number, any> = {};
    for (const d of defs) defsMap[d.id] = d;

    for (const r of keysRows) {
        const cfgId = Number(r.config_conciliacao_id);
        if (!out[cfgId]) out[cfgId] = [];
        const item: any = {
            id: r.id,
            key_identifier: r.key_identifier,
            keys_pair_id: r.keys_pair_id || null,
            contabil_key_id: r.contabil_key_id || null,
            fiscal_key_id: r.fiscal_key_id || null,
            ordem: r.ordem || null,
            keys_pair: null,
            contabil_key: null,
            fiscal_key: null
        };

        if (r.keys_pair_id) {
            const pair = pairsMap[r.keys_pair_id];
            if (pair) {
                item.keys_pair = pair;
                const cont = pair.contabil_key_id ? defsMap[pair.contabil_key_id] : null;
                const fisc = pair.fiscal_key_id ? defsMap[pair.fiscal_key_id] : null;
                item.contabil_key = cont ? { id: cont.id, nome: cont.nome, base_tipo: cont.base_tipo, base_subtipo: cont.base_subtipo, columns: tryParseJson(cont.columns) } : null;
                item.fiscal_key = fisc ? { id: fisc.id, nome: fisc.nome, base_tipo: fisc.base_tipo, base_subtipo: fisc.base_subtipo, columns: tryParseJson(fisc.columns) } : null;
            }
        } else {
            const cont = r.contabil_key_id ? defsMap[r.contabil_key_id] : null;
            const fisc = r.fiscal_key_id ? defsMap[r.fiscal_key_id] : null;
            item.contabil_key = cont ? { id: cont.id, nome: cont.nome, base_tipo: cont.base_tipo, base_subtipo: cont.base_subtipo, columns: tryParseJson(cont.columns) } : null;
            item.fiscal_key = fisc ? { id: fisc.id, nome: fisc.nome, base_tipo: fisc.base_tipo, base_subtipo: fisc.base_subtipo, columns: tryParseJson(fisc.columns) } : null;
        }

        out[cfgId].push(item);
    }

    return out;
}

function tryParseJson(v: any) {
    if (v === null || v === undefined) return null;
    try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; }
}

async function parseRow(row: any) {
    const base = {
        ...row,
        chaves_contabil: parseChavesField(row.chaves_contabil),
        chaves_fiscal: parseChavesField(row.chaves_fiscal)
    } as any;
    base.keys = await loadKeysForConfig(row.id);
    return base;
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

async function saveKeysForConfig(configId: number, keys: KeyItem[]) {
    // perform delete + inserts in a transaction to avoid partial updates
    await db.transaction(async (trx) => {
        await trx('configs_conciliacao_keys').where({ config_conciliacao_id: configId }).del();
        if (!Array.isArray(keys) || keys.length === 0) return;
        const inserts: any[] = [];
        for (const k of keys) {
            inserts.push({
                config_conciliacao_id: configId,
                key_identifier: k.key_identifier,
                keys_pair_id: k.keys_pair_id || null,
                contabil_key_id: k.contabil_key_id || null,
                fiscal_key_id: k.fiscal_key_id || null,
                ordem: k.ordem || null,
                created_at: trx.fn.now(),
                updated_at: trx.fn.now()
            });
        }
        // insert in chunks if necessary
        const chunkSize = 200;
        for (let i = 0; i < inserts.length; i += chunkSize) {
            const chunk = inserts.slice(i, i + chunkSize);
            // eslint-disable-next-line no-await-in-loop
            await trx('configs_conciliacao_keys').insert(chunk);
        }
    });
}

// Create
router.post('/', async (req: Request, res: Response) => {
    try {
        const payload: ConciliacaoPayload = req.body;

        // validate basic required fields
        const basicErrs = validatePayload(payload);
        if (basicErrs.length) return res.status(400).json({ errors: basicErrs });

        // new contract requires explicit `keys` array referencing central keys
        const keysArray: KeyItem[] = payload.keys as KeyItem[];

        // verify bases exist
        const baseCont = await db('bases').where({ id: payload.base_contabil_id }).first();
        const baseFisc = await db('bases').where({ id: payload.base_fiscal_id }).first();
        if (!baseCont || !baseFisc) return res.status(400).json({ error: 'base_contabil_id ou base_fiscal_id não encontrados' });

        // validate keysArray items at application level
        // validate keys array content and uniqueness
        const seenIdentifiers = new Set<string>();
        for (const k of keysArray) {
            if (!k.key_identifier || typeof k.key_identifier !== 'string') return res.status(400).json({ error: 'Cada key item precisa de key_identifier' });
            if (seenIdentifiers.has(k.key_identifier)) return res.status(400).json({ error: `Duplicated key_identifier ${k.key_identifier}` });
            seenIdentifiers.add(k.key_identifier);
            if (!k.keys_pair_id && !(k.contabil_key_id && k.fiscal_key_id)) return res.status(400).json({ error: 'Cada key item deve ter keys_pair_id ou (contabil_key_id e fiscal_key_id)' });
            if (k.keys_pair_id) {
                const pair = await db('keys_pairs').where({ id: k.keys_pair_id }).first();
                if (!pair) return res.status(400).json({ error: `keys_pair_id ${k.keys_pair_id} não encontrado` });
                const cont = pair.contabil_key_id ? await db('keys_definitions').where({ id: pair.contabil_key_id }).first() : null;
                const fisc = pair.fiscal_key_id ? await db('keys_definitions').where({ id: pair.fiscal_key_id }).first() : null;
                if (!cont || cont.base_tipo !== 'CONTABIL') return res.status(400).json({ error: `pair ${k.keys_pair_id} contém contabil_key inválida` });
                if (!fisc || fisc.base_tipo !== 'FISCAL') return res.status(400).json({ error: `pair ${k.keys_pair_id} contém fiscal_key inválida` });
                // optional subtype compat
                if (cont.base_subtipo && baseCont.subtype && cont.base_subtipo !== baseCont.subtype) return res.status(400).json({ error: 'base_subtipo do contabil_key não compatível com base_contabil' });
                if (fisc.base_subtipo && baseFisc.subtype && fisc.base_subtipo !== baseFisc.subtype) return res.status(400).json({ error: 'base_subtipo do fiscal_key não compatível com base_fiscal' });
            } else {
                const cont = await db('keys_definitions').where({ id: k.contabil_key_id }).first();
                const fisc = await db('keys_definitions').where({ id: k.fiscal_key_id }).first();
                if (!cont || cont.base_tipo !== 'CONTABIL') return res.status(400).json({ error: `contabil_key_id ${k.contabil_key_id} inválido` });
                if (!fisc || fisc.base_tipo !== 'FISCAL') return res.status(400).json({ error: `fiscal_key_id ${k.fiscal_key_id} inválido` });
                if (cont.base_subtipo && baseCont.subtype && cont.base_subtipo !== baseCont.subtype) return res.status(400).json({ error: 'base_subtipo do contabil_key não compatível com base_contabil' });
                if (fisc.base_subtipo && baseFisc.subtype && fisc.base_subtipo !== baseFisc.subtype) return res.status(400).json({ error: 'base_subtipo do fiscal_key não compatível com base_fiscal' });
            }
        }

        const insert = {
            nome: payload.nome,
            base_contabil_id: payload.base_contabil_id,
            base_fiscal_id: payload.base_fiscal_id,
            // keep legacy snapshot if provided
            chaves_contabil: payload.chaves_contabil ? toJsonString(payload.chaves_contabil) : null,
            chaves_fiscal: payload.chaves_fiscal ? toJsonString(payload.chaves_fiscal) : null,
            coluna_conciliacao_contabil: payload.coluna_conciliacao_contabil,
            coluna_conciliacao_fiscal: payload.coluna_conciliacao_fiscal,
            inverter_sinal_fiscal: payload.inverter_sinal_fiscal === true,
            limite_diferenca_imaterial: payload.limite_diferenca_imaterial !== undefined ? Number(payload.limite_diferenca_imaterial) : 0,
            created_at: db.fn.now(),
            updated_at: db.fn.now()
        } as any;

        const [id] = await db(TABLE).insert(insert);
        // save keys in linking table
        await saveKeysForConfig(id, keysArray);

        const created = await db(TABLE).where({ id }).first();
        await ensureIndicesForRow(created);
        return res.status(201).json(await parseRow(created));
    } catch (err: any) {
        console.error('POST /configs_conciliacao error', err);
        return res.status(500).json({ error: 'Erro interno ao criar config conciliacao' });
    }
});

// List
router.get('/', async (req: Request, res: Response) => {
    try {
        // select only necessary columns and load keys in bulk to avoid N+1 queries
        const rows = await db(TABLE)
            .select('id','nome','base_contabil_id','base_fiscal_id','chaves_contabil','chaves_fiscal','coluna_conciliacao_contabil','coluna_conciliacao_fiscal','inverter_sinal_fiscal','limite_diferenca_imaterial','created_at','updated_at')
            .orderBy('id', 'desc');
        const ids = rows.map(r => Number(r.id)).filter(Boolean);
        const keysMap = await loadKeysForConfigs(ids);
        const out = rows.map(r => ({
            ...r,
            chaves_contabil: parseChavesField(r.chaves_contabil),
            chaves_fiscal: parseChavesField(r.chaves_fiscal),
            keys: keysMap[Number(r.id)] || []
        }));
        return res.json(out);
    } catch (err: any) {
        console.error('GET /configs_conciliacao error', err);
        return res.status(500).json({ error: 'Erro interno ao listar configs conciliacao' });
    }
});

// Get by id
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const row = await db(TABLE).where({ id: parsed.id }).first();
        if (!row) return res.status(404).json({ error: 'Not found' });
        // load keys via bulk loader to reuse logic
        const keysMap = await loadKeysForConfigs([parsed.id]);
        const parsedRow = {
            ...row,
            chaves_contabil: parseChavesField(row.chaves_contabil),
            chaves_fiscal: parseChavesField(row.chaves_fiscal),
            keys: keysMap[parsed.id] || []
        };
        return res.json(parsedRow);
    } catch (err: any) {
        console.error('GET /configs_conciliacao/:id error', err);
        return res.status(500).json({ error: 'Erro interno ao obter config conciliacao' });
    }
});

// Update
router.put('/:id', async (req: Request, res: Response) => {
    try {
        const parsed = parseId(req);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const payload: ConciliacaoPayload = req.body;

        const basicErrs = validatePayload(payload);
        if (basicErrs.length) return res.status(400).json({ errors: basicErrs });

        const keysArray: KeyItem[] = payload.keys as KeyItem[];

        // verify bases exist
        const baseCont = await db('bases').where({ id: payload.base_contabil_id }).first();
        const baseFisc = await db('bases').where({ id: payload.base_fiscal_id }).first();
        if (!baseCont || !baseFisc) return res.status(400).json({ error: 'base_contabil_id ou base_fiscal_id não encontrados' });

        // validate keys and uniqueness
        const seenIdentifiers = new Set<string>();
        for (const k of keysArray) {
            if (!k.key_identifier || typeof k.key_identifier !== 'string') return res.status(400).json({ error: 'Cada key item precisa de key_identifier' });
            if (seenIdentifiers.has(k.key_identifier)) return res.status(400).json({ error: `Duplicated key_identifier ${k.key_identifier}` });
            seenIdentifiers.add(k.key_identifier);
            if (!k.keys_pair_id && !(k.contabil_key_id && k.fiscal_key_id)) return res.status(400).json({ error: 'Cada key item deve ter keys_pair_id ou (contabil_key_id e fiscal_key_id)' });
            if (k.keys_pair_id) {
                const pair = await db('keys_pairs').where({ id: k.keys_pair_id }).first();
                if (!pair) return res.status(400).json({ error: `keys_pair_id ${k.keys_pair_id} não encontrado` });
            } else {
                const cont = await db('keys_definitions').where({ id: k.contabil_key_id }).first();
                const fisc = await db('keys_definitions').where({ id: k.fiscal_key_id }).first();
                if (!cont || cont.base_tipo !== 'CONTABIL') return res.status(400).json({ error: `contabil_key_id ${k.contabil_key_id} inválido` });
                if (!fisc || fisc.base_tipo !== 'FISCAL') return res.status(400).json({ error: `fiscal_key_id ${k.fiscal_key_id} inválido` });
            }
        }

        const update = {
            nome: payload.nome,
            base_contabil_id: payload.base_contabil_id,
            base_fiscal_id: payload.base_fiscal_id,
            chaves_contabil: payload.chaves_contabil ? toJsonString(payload.chaves_contabil) : null,
            chaves_fiscal: payload.chaves_fiscal ? toJsonString(payload.chaves_fiscal) : null,
            coluna_conciliacao_contabil: payload.coluna_conciliacao_contabil,
            coluna_conciliacao_fiscal: payload.coluna_conciliacao_fiscal,
            inverter_sinal_fiscal: payload.inverter_sinal_fiscal === true,
            limite_diferenca_imaterial: payload.limite_diferenca_imaterial !== undefined ? Number(payload.limite_diferenca_imaterial) : 0,
            updated_at: db.fn.now()
        } as any;

        await db(TABLE).where({ id: parsed.id }).update(update);
        // replace keys transactionally
        await saveKeysForConfig(parsed.id, keysArray);
        const updated = await db(TABLE).where({ id: parsed.id }).first();
        await ensureIndicesForRow(updated);
        // load keys in bulk for response
        const keysMap = await loadKeysForConfigs([parsed.id]);
        return res.json({
            ...updated,
            chaves_contabil: parseChavesField(updated.chaves_contabil),
            chaves_fiscal: parseChavesField(updated.chaves_fiscal),
            keys: keysMap[parsed.id] || []
        });
    } catch (err: any) {
        console.error('PUT /configs_conciliacao/:id error', err);
        return res.status(500).json({ error: 'Erro interno ao atualizar config conciliacao' });
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
        return res.status(500).json({ error: 'Erro interno ao deletar config conciliacao' });
    }
});

export default router;
