import db from './knex';

// Constants
const INDEX_NAME_PREFIX = 'idx_base_';
const IDENTIFIER_SAFE_REGEX = /[^a-zA-Z0-9_]/g;

function normalizeIdentifier(value: string): string {
  return value.replace(IDENTIFIER_SAFE_REGEX, '_');
}

function getIndexName(baseId: number | string | undefined, column: string): string {
  const basePart = baseId === undefined || baseId === null ? 'x' : String(baseId);
  return `${INDEX_NAME_PREFIX}${basePart}_${normalizeIdentifier(column)}`;
}

async function indexExists(indexName: string): Promise<boolean> {
  const res: any = await db.raw("SELECT name FROM sqlite_master WHERE type='index' AND name = ?", [indexName]);
  const rows = Array.isArray(res) ? res : res && (res[0] || res);
  if (!rows) return false;
  return (rows.length ?? 0) > 0;
}

export async function createIndexIfNotExists(tableName: string, columnName: string, baseId?: number | string) {
  if (!tableName || !columnName) throw new Error('tableName and columnName are required');

  const safeColumn = normalizeIdentifier(columnName);
  const indexName = getIndexName(baseId, safeColumn);

  if (await indexExists(indexName)) return indexName;

  const safeTable = normalizeIdentifier(tableName);
  const sql = `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${safeTable}"("${safeColumn}")`;
  await db.raw(sql);
  return indexName;
}

type ConfigConciliacao = {
  chaves_contabil?: string | null;
  chaves_fiscal?: string | null;
  base_contabil_id?: number | null;
  base_fiscal_id?: number | null;
  coluna_conciliacao_contabil?: string | null;
  coluna_conciliacao_fiscal?: string | null;
};

function safeParseChaves(raw: unknown): Record<string, string[]> {
  if (!raw) return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) return { CHAVE_1: parsed.filter(Boolean).map(String) };
    if (parsed && typeof parsed === 'object') {
      const out: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (Array.isArray(v)) out[k] = v.filter(Boolean).map(String);
      }
      return out;
    }
  } catch (_) {
    // fallthrough to empty
  }
  return {};
}

function logError(context: string, err: unknown) {
  // eslint-disable-next-line no-console
  console.error(`[indexHelpers] ${context} -`, err instanceof Error ? err.stack || err.message : err);
}

async function ensureIndexForTableColumn(table: string, column: string, baseId?: number | string) {
  if (!column || !column.toString().trim()) return;
  try {
    await createIndexIfNotExists(table, column, baseId);
  } catch (err) {
    logError('ensureIndexForTableColumn', err);
  }
}

export async function ensureIndicesForConfigConciliacao(cfg: ConfigConciliacao | null | undefined) {
  if (!cfg) return;

  const chavesA = safeParseChaves(cfg.chaves_contabil);
  const chavesB = safeParseChaves(cfg.chaves_fiscal);

  const baseA = cfg.base_contabil_id;
  if (baseA) {
    const tableA = `base_${baseA}`;
    for (const cols of Object.values(chavesA)) {
      for (const c of cols) await ensureIndexForTableColumn(tableA, c, baseA);
    }
    await ensureIndexForTableColumn(tableA, cfg.coluna_conciliacao_contabil ?? '', baseA);
  }

  const baseB = cfg.base_fiscal_id;
  if (baseB) {
    const tableB = `base_${baseB}`;
    for (const cols of Object.values(chavesB)) {
      for (const c of cols) await ensureIndexForTableColumn(tableB, c, baseB);
    }
    await ensureIndexForTableColumn(tableB, cfg.coluna_conciliacao_fiscal ?? '', baseB);
  }
}

export async function ensureIndicesForConfigEstorno(cfg: any) {
  if (!cfg) return;
  try {
    const base = cfg.base_id;
    if (!base) return;
    const table = `base_${base}`;
    await ensureIndexForTableColumn(table, cfg.coluna_a ?? '', base);
    await ensureIndexForTableColumn(table, cfg.coluna_b ?? '', base);
  } catch (err) {
    logError('ensureIndicesForConfigEstorno', err);
  }
}

export async function ensureIndicesForConfigCancelamento(cfg: any) {
  if (!cfg) return;
  try {
    const base = cfg.base_id;
    if (!base) return;
    const table = `base_${base}`;
    await ensureIndexForTableColumn(table, cfg.coluna_indicador ?? '', base);
  } catch (err) {
    logError('ensureIndicesForConfigCancelamento', err);
  }
}

export async function ensureIndicesForBaseFromConfigs(baseId: number) {
  if (!baseId || Number.isNaN(baseId)) return;
  try {
    const concRows = await db('configs_conciliacao')
      .where({ base_contabil_id: baseId })
      .orWhere({ base_fiscal_id: baseId })
      .select('*');
    for (const c of concRows) await ensureIndicesForConfigConciliacao(c as ConfigConciliacao);

    const estRows = await db('configs_estorno').where({ base_id: baseId }).select('*');
    for (const c of estRows) await ensureIndicesForConfigEstorno(c);

    const canRows = await db('configs_cancelamento').where({ base_id: baseId }).select('*');
    for (const c of canRows) await ensureIndicesForConfigCancelamento(c);
  } catch (err) {
    logError('ensureIndicesForBaseFromConfigs', err);
  }
}

export default {
  createIndexIfNotExists,
  ensureIndicesForConfigConciliacao,
  ensureIndicesForConfigEstorno,
  ensureIndicesForConfigCancelamento,
  ensureIndicesForBaseFromConfigs,
};
