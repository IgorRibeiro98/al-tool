// Worker para exportação de XLSX de atribuições
// Salva o arquivo em storage/exports/atribuicoes/atribuicao_<runId>.xlsx

import path from 'path';
import fs from 'fs';
import db from '../db/knex';
import * as baseColumnsRepo from '../repos/baseColumnsRepository';

const LOG_PREFIX = '[atribuicaoExportWorker]';
const EXIT_SUCCESS = 0;
const EXIT_INVALID_ARG = 1;
const EXIT_FAILURE = 2;
const CHUNK_SIZE = 1000;

const EXCLUDE_COLS = Object.freeze(new Set(['dest_row_id', 'orig_row_id', 'created_at', 'updated_at']));

interface AtribuicaoRun {
    readonly id: number;
    readonly status: string;
    readonly result_table_name?: string | null;
    readonly base_origem_id?: number | null;
    readonly base_destino_id?: number | null;
}

interface PragmaColumn {
    readonly name: string;
}

async function main(): Promise<void> {
    const runId = parseInt(process.argv[2] || '', 10);
    if (!runId || Number.isNaN(runId)) {
        console.error(`${LOG_PREFIX} RunId não informado`);
        process.exit(EXIT_INVALID_ARG);
    }
    try {
        // Verifica se a run existe e está DONE
        const run = await db<AtribuicaoRun>('atribuicao_runs').where({ id: runId }).first();
        if (!run) throw new Error('Run não encontrada');
        if (run.status !== 'DONE') throw new Error('Run não está concluída');

        const table = run.result_table_name || `atribuicao_result_${runId}`;
        const hasTable = await db.schema.hasTable(table);
        if (!hasTable) throw new Error('Tabela de resultado não encontrada');

        // Importa ExcelJS streaming
        const ExcelJS = require('exceljs');
        const outDir = path.resolve(__dirname, '../../storage/exports/atribuicoes');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const outPath = path.join(outDir, `atribuicao_${runId}.xlsx`);

        const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: outPath });
        const sheet = workbook.addWorksheet('Atribuicao');

        // Colunas (nomes sqlite)
        const rawPragma = await db.raw(`PRAGMA table_info("${table}")`) as unknown;
        const pragmaArray = Array.isArray(rawPragma) ? rawPragma : (rawPragma as { 0?: unknown[] })[0] || [];
        const sqliteColumns = (Array.isArray(pragmaArray) ? pragmaArray : []).map((c: PragmaColumn) => String(c.name));

        // Filtra colunas técnicas antes de montar header/linhas
        const dataSqliteColumns = sqliteColumns.filter(c => !EXCLUDE_COLS.has(c));

        // Tenta mapear para excel_name usando base_columns (fallback para sqlite name)
        let header: string[] = dataSqliteColumns;
        const map: Record<string, string> = {};
        try {
            // Tenta mapear consultando as colunas de base_origem e base_destino
            // Preferir o excel_name da base_destino em caso de conflito
            const origemId = run.base_origem_id ?? null;
            const destinoId = run.base_destino_id ?? null;
            // Primeiro aplica origem (como fallback)
            if (origemId) {
                const origemCols = await baseColumnsRepo.getColumnsForBase(origemId);
                for (const bc of origemCols) map[bc.sqlite_name] = bc.excel_name;
            }
            // Em seguida aplica destino e sobrescreve mapeamentos da origem quando existir
            if (destinoId) {
                const destinoCols = await baseColumnsRepo.getColumnsForBase(destinoId);
                for (const bc of destinoCols) {
                    map[bc.sqlite_name] = bc.excel_name;
                }
            }
            header = dataSqliteColumns.map(c => map[c] ?? c);
        } catch (e) {
            // if mapping fails, fallback to sqlite column names
            header = sqliteColumns;
        }

        // Build export column order directly from table columns and map headers
        const exportCols: string[] = dataSqliteColumns.slice();
        const headerLabels: string[] = exportCols.map(col => {
            // For display only: remove trailing '_atr' from chave column names
            const cleaned = String(col).replace(/_atr$/i, '');
            const lname = cleaned.toLowerCase();
            if (lname === 'matched_key_identifier' || lname === 'matched') return 'Chave';
            const m = lname.match(/^chave(?:[_-]?(\d+))?$/);
            if (m) {
                const idx = Number(m[1] || 1);
                return `CHAVE_${idx}`;
            }
            return map[col] ?? col;
        });

        sheet.addRow(headerLabels).commit();

        // Stream rows
        let lastId = 0;
        while (true) {
            const rows = await db(table)
                .select('*')
                .where('id', '>', lastId)
                .orderBy('id', 'asc')
                .limit(CHUNK_SIZE);

            if (!rows || rows.length === 0) break;

            for (const r of rows) {
                // build a case-insensitive lookup for row values because some DB drivers
                // may normalize column name casing differently than PRAGMA
                const rowLookup: Record<string, unknown> = {};
                for (const k of Object.keys(r || {})) rowLookup[String(k).toLowerCase()] = r[k];

                const values = exportCols.map(col => {
                    if (Object.prototype.hasOwnProperty.call(r, col)) return (r as Record<string, unknown>)[col] ?? '';
                    const alt = rowLookup[String(col).toLowerCase()];
                    return alt ?? '';
                });

                sheet.addRow(values).commit();
            }

            lastId = Number(rows[rows.length - 1].id) || lastId;
            if (rows.length < CHUNK_SIZE) break;
        }

        await workbook.commit();
        console.log(`${LOG_PREFIX} Export concluído:`, outPath);
        process.exit(EXIT_SUCCESS);
    } catch (err) {
        console.error(`${LOG_PREFIX} Erro no export worker:`, err);
        process.exit(EXIT_FAILURE);
    }
}

void main();
