import db from '../db/knex';

import type { Knex } from 'knex';

const LOG_PREFIX = '[baseColumnsService]';

interface ApplyMonetaryOptions {
    readonly matchBy?: 'excel_name' | 'sqlite_name';
    readonly override?: boolean;
    readonly knex?: Knex;
}

interface ApplyMonetaryResult {
    readonly updated: number;
    readonly reason?: string;
}

interface ColumnRow {
    readonly id: number;
    readonly base_id: number;
    readonly excel_name: string;
    readonly sqlite_name: string;
    readonly is_monetary?: number | null;
}

/**
 * Apply monetary flags from a source base to a single target base.
 * - matchBy: 'excel_name' | 'sqlite_name'
 * - override: when false, only set flags on targets where is_monetary is null/undefined
 */
export async function applyMonetaryFlagsFromReference(
    sourceBaseId: number,
    targetBaseId: number,
    options?: ApplyMonetaryOptions
): Promise<ApplyMonetaryResult> {
    if (!Number.isInteger(sourceBaseId) || sourceBaseId <= 0) throw new TypeError('sourceBaseId must be positive integer');
    if (!Number.isInteger(targetBaseId) || targetBaseId <= 0) throw new TypeError('targetBaseId must be positive integer');

    const matchBy = options?.matchBy === 'sqlite_name' ? 'sqlite_name' : 'excel_name';
    const override = Boolean(options?.override === true);
    const knex = options?.knex ?? db;

    // load source columns marked monetary
    const sourceCols = await knex<ColumnRow>('base_columns').where({ base_id: sourceBaseId }).select('*');
    if (!sourceCols || sourceCols.length === 0) return { updated: 0, reason: 'no_source_columns' };

    const sourceMap = new Map<string, number>();
    for (const sc of sourceCols) {
        const key = String(sc[matchBy] ?? '');
        if (!key) continue;
        if (Number(sc.is_monetary) === 1) sourceMap.set(key, 1);
    }

    if (sourceMap.size === 0) return { updated: 0, reason: 'no_source_monetary_flags' };

    let updated = 0;
    await knex.transaction(async trx => {
        const targetCols = await trx<ColumnRow>('base_columns').where({ base_id: targetBaseId }).select('*');
        if (!targetCols || targetCols.length === 0) return;

        for (const tc of targetCols) {
            const key = String(tc[matchBy] ?? '');
            if (!key) continue;
            if (!sourceMap.has(key)) continue;
            const desired = sourceMap.get(key) as number;
            const current = tc.is_monetary === null || tc.is_monetary === undefined ? null : Number(tc.is_monetary);
            if (!override && current !== null) continue;
            await trx('base_columns').where({ id: tc.id }).update({ is_monetary: desired });
            updated += 1;
        }
    });

    // clear cache for target base if repository exists
    try {
        const baseColsRepo = require('../repos/baseColumnsRepository').default;
        if (baseColsRepo && typeof baseColsRepo.clearColumnsCache === 'function') baseColsRepo.clearColumnsCache(targetBaseId);
    } catch {
        /* ignore */
    }

    return { updated };
}

export default { applyMonetaryFlagsFromReference };
