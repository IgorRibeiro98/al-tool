import db from '../db/knex';

export async function getColumnsForBase(baseId: number) {
    return db('base_columns').where({ base_id: baseId }).orderBy('col_index', 'asc');
}

export async function getSqliteNameForBaseColumn(baseId: number, excelName: string) {
    const row = await db('base_columns').where({ base_id: baseId, excel_name: excelName }).first();
    return row ? row.sqlite_name : null;
}
