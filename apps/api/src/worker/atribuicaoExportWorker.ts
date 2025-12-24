// Worker para exportação de XLSX de atribuições
// Salva o arquivo em storage/exports/atribuicoes/atribuicao_<runId>.xlsx

import path from 'path';
import fs from 'fs';
import db from '../db/knex';
import * as baseColumnsRepo from '../repos/baseColumnsRepository';

async function main() {
    const runId = Number(process.argv[2]);
    if (!runId) {
        console.error('RunId não informado');
        process.exit(1);
    }
    try {
        // Verifica se a run existe e está DONE
        const run = await db('atribuicao_runs').where({ id: runId }).first();
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
        const rawPragma: any = await db.raw(`PRAGMA table_info("${table}")`);
        const pragmaAny = Array.isArray(rawPragma) ? rawPragma : rawPragma[0] || [];
        const sqliteColumns = Array.isArray(pragmaAny) ? pragmaAny.map((c: any) => String(c.name)) : [];

        // Excluir colunas técnicas
        const excludeCols = new Set(['dest_row_id', 'orig_row_id', 'created_at', 'updated_at']);

        // Filtra colunas técnicas antes de montar header/linhas
        const dataSqliteColumns = sqliteColumns.filter(c => !excludeCols.has(c));

        // Tenta mapear para excel_name usando base_columns (fallback para sqlite name)
        let header: string[] = dataSqliteColumns;
        const map: Record<string, string> = {};
        try {
            // Tenta mapear consultando as colunas de base_origem e base_destino
            // Preferir o excel_name da base_destino em caso de conflito
            const origemId = (run && (run as any).base_origem_id) || null;
            const destinoId = (run && (run as any).base_destino_id) || null;
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
        const CHUNK_SIZE = 1000;
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
                const rowLookup: Record<string, any> = {};
                for (const k of Object.keys(r || {})) rowLookup[String(k).toLowerCase()] = r[k];

                const values = exportCols.map(col => {
                    if (r.hasOwnProperty(col)) return r[col] ?? '';
                    const alt = rowLookup[String(col).toLowerCase()];
                    return alt ?? '';
                });

                sheet.addRow(values).commit();
            }

            lastId = Number(rows[rows.length - 1].id) || lastId;
            if (rows.length < CHUNK_SIZE) break;
        }

        await workbook.commit();
        console.log('Export concluído:', outPath);
        process.exit(0);
    } catch (err: any) {
        console.error('Erro no export worker:', err);
        process.exit(2);
    }
}

main();
