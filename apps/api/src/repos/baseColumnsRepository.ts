import db from '../db/knex';
import type { Knex } from 'knex';

export interface BaseColumn {
    readonly id: number;
    readonly base_id: number;
    readonly excel_name: string;
    readonly sqlite_name: string;
    readonly col_index: number;
    readonly created_at?: string;
    readonly is_monetary?: number | null;
}

interface RepoOptions {
    readonly useCache?: boolean;
    readonly knex?: Knex;
}

const LOG_PREFIX = '[baseColumnsRepository]';
const columnsCache = new Map<number, BaseColumn[]>();

function validateBaseId(baseId: number): void {
    if (!Number.isInteger(baseId) || baseId <= 0) throw new TypeError('baseId must be a positive integer');
}

/**
 * Get ordered columns metadata for a given base.
 * Uses a simple in-memory cache to avoid duplicate DB queries in the same process.
 */
export async function getColumnsForBase(baseId: number, options?: RepoOptions): Promise<BaseColumn[]> {
    validateBaseId(baseId);
    const useCache = options?.useCache ?? true;
    if (useCache && columnsCache.has(baseId)) return columnsCache.get(baseId)!;

    const knex = options?.knex ?? db;
    try {
        const rows = (await knex('base_columns').where({ base_id: baseId }).orderBy('col_index', 'asc')) as BaseColumn[];
        if (useCache) columnsCache.set(baseId, rows);
        return rows;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`${LOG_PREFIX} getColumnsForBase failed (baseId=${baseId}):`, message);
        throw err;
    }
}

/**
 * Resolve sqlite column name for a given excel column name in a base.
 * Returns null when no mapping exists.
 */
export async function getSqliteNameForBaseColumn(baseId: number, excelName: string, options?: { knex?: Knex }): Promise<string | null> {
    validateBaseId(baseId);
    if (typeof excelName !== 'string' || excelName.trim() === '') return null;

    const knex = options?.knex ?? db;
    try {
        const row = (await knex('base_columns').where({ base_id: baseId, excel_name: excelName }).first()) as BaseColumn | undefined;
        return row ? row.sqlite_name : null;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`${LOG_PREFIX} getSqliteNameForBaseColumn failed (baseId=${baseId}, excelName=${excelName}):`, message);
        throw err;
    }
}

export function clearColumnsCache(baseId?: number): void {
    if (baseId === undefined) {
        columnsCache.clear();
        return;
    }
    validateBaseId(baseId);
    columnsCache.delete(baseId);
}

export default {
    getColumnsForBase,
    getSqliteNameForBaseColumn,
    clearColumnsCache
};
