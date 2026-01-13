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

  // Collect all index creation promises for parallel execution
  const indexPromises: Promise<void>[] = [];

  const baseA = cfg.base_contabil_id;
  if (baseA) {
    const tableA = `base_${baseA}`;
    for (const cols of Object.values(chavesA)) {
      for (const c of cols) {
        indexPromises.push(ensureIndexForTableColumn(tableA, c, baseA));
      }
    }
    if (cfg.coluna_conciliacao_contabil) {
      indexPromises.push(ensureIndexForTableColumn(tableA, cfg.coluna_conciliacao_contabil, baseA));
    }
  }

  const baseB = cfg.base_fiscal_id;
  if (baseB) {
    const tableB = `base_${baseB}`;
    for (const cols of Object.values(chavesB)) {
      for (const c of cols) {
        indexPromises.push(ensureIndexForTableColumn(tableB, c, baseB));
      }
    }
    if (cfg.coluna_conciliacao_fiscal) {
      indexPromises.push(ensureIndexForTableColumn(tableB, cfg.coluna_conciliacao_fiscal, baseB));
    }
  }

  // Execute all index creations in parallel (SQLite handles locking internally)
  await Promise.all(indexPromises);
}

export async function ensureIndicesForConfigEstorno(cfg: any) {
  if (!cfg) return;
  try {
    const base = cfg.base_id;
    if (!base) return;
    const table = `base_${base}`;
    // Parallel index creation
    await Promise.all([
      ensureIndexForTableColumn(table, cfg.coluna_a ?? '', base),
      ensureIndexForTableColumn(table, cfg.coluna_b ?? '', base),
    ]);
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
    // Fetch all configs in parallel
    const [concRows, estRows, canRows] = await Promise.all([
      db('configs_conciliacao')
        .where({ base_contabil_id: baseId })
        .orWhere({ base_fiscal_id: baseId })
        .select('*'),
      db('configs_estorno').where({ base_id: baseId }).select('*'),
      db('configs_cancelamento').where({ base_id: baseId }).select('*'),
    ]);

    // Process all configs in parallel
    await Promise.all([
      ...concRows.map(c => ensureIndicesForConfigConciliacao(c as ConfigConciliacao)),
      ...estRows.map(c => ensureIndicesForConfigEstorno(c)),
      ...canRows.map(c => ensureIndicesForConfigCancelamento(c)),
    ]);
  } catch (err) {
    logError('ensureIndicesForBaseFromConfigs', err);
  }
}

/**
 * Create essential indexes for a base table immediately after ingest.
 * This speeds up subsequent operations like conciliação and export.
 * @param baseId - The base ID
 * @param columnNames - Optional list of column names to index (for key columns)
 */
export async function createEssentialIndices(baseId: number, columnNames?: string[]) {
  if (!baseId || Number.isNaN(baseId)) return;
  const tableName = `base_${baseId}`;

  try {
    // The 'id' column is auto-indexed as PRIMARY KEY, but we ensure it exists
    // Create indexes on commonly queried columns if provided
    if (columnNames && columnNames.length > 0) {
      const batchSize = 5; // Create indexes in batches to avoid long locks
      for (let i = 0; i < columnNames.length; i += batchSize) {
        const batch = columnNames.slice(i, i + batchSize);
        await Promise.all(batch.map(col => ensureIndexForTableColumn(tableName, col, baseId)));
      }
    }

    // Run ANALYZE to update query planner statistics
    try {
      await db.raw(`ANALYZE "${tableName}"`);
    } catch (_) {
      // Best-effort
    }
  } catch (err) {
    logError('createEssentialIndices', err);
  }
}

/**
 * Pre-warm the SQLite cache by reading table statistics.
 * This can speed up subsequent queries on cold starts.
 */
export async function warmTableCache(tableName: string) {
  try {
    // Simple count query to warm the cache
    await db.raw(`SELECT COUNT(*) FROM "${tableName}"`);
  } catch (_) {
    // Best-effort, ignore errors
  }
}

export default {
  createIndexIfNotExists,
  ensureIndicesForConfigConciliacao,
  ensureIndicesForConfigEstorno,
  ensureIndicesForConfigCancelamento,
  ensureIndicesForBaseFromConfigs,
  createEssentialIndices,
  warmTableCache,
};
