import db from '../db/knex';
import type { Knex } from 'knex';

export type BaseColumn = {
    id: number;
    base_id: number;
    excel_name: string;
    sqlite_name: string;
    col_index: number;
    created_at?: string;
    is_monetary?: number | null;
};

const columnsCache = new Map<number, BaseColumn[]>();

function validateBaseId(baseId: number) {
    if (!Number.isInteger(baseId) || baseId <= 0) throw new TypeError('baseId must be a positive integer');
}

/**
 * Get ordered columns metadata for a given base.
 * Uses a simple in-memory cache to avoid duplicate DB queries in the same process.
 */
export async function getColumnsForBase(baseId: number, options?: { useCache?: boolean; knex?: Knex }) {
    validateBaseId(baseId);
    const useCache = options?.useCache ?? true;
    if (useCache && columnsCache.has(baseId)) return columnsCache.get(baseId)!;

    const knex = options?.knex ?? db;
    try {
        const rows = (await knex('base_columns').where({ base_id: baseId }).orderBy('col_index', 'asc')) as BaseColumn[];
        if (useCache) columnsCache.set(baseId, rows);
        return rows;
    } catch (err) {
        // Minimal standardized logging; caller can decide how to handle
        // eslint-disable-next-line no-console
        console.error(`getColumnsForBase failed (baseId=${baseId}):`, (err as Error).message ?? err);
        throw err;
    }
}

/**
 * Resolve sqlite column name for a given excel column name in a base.
 * Returns null when no mapping exists.
 */
export async function getSqliteNameForBaseColumn(baseId: number, excelName: string, options?: { knex?: Knex }) {
    validateBaseId(baseId);
    if (typeof excelName !== 'string' || excelName.trim() === '') return null;

    const knex = options?.knex ?? db;
    try {
        const row = (await knex('base_columns').where({ base_id: baseId, excel_name: excelName }).first()) as BaseColumn | undefined;
        return row ? row.sqlite_name : null;
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`getSqliteNameForBaseColumn failed (baseId=${baseId}, excelName=${excelName}):`, (err as Error).message ?? err);
        throw err;
    }
}

export function clearColumnsCache(baseId?: number) {
    if (baseId === undefined) return columnsCache.clear();
    validateBaseId(baseId);
    columnsCache.delete(baseId);
}

export default {
    getColumnsForBase,
    getSqliteNameForBaseColumn,
    clearColumnsCache
};
