import db from '../db/knex';
import * as atribuicaoRepo from '../repos/atribuicaoRunsRepository';

const LOG_PREFIX = '[atribuicaoRunner]';
const BATCH_SIZE = 500;
const PAGE_SIZE = 1000;

// Empty values as per business rules: NULL, '', 'NULL', '0', '0.00'
function isEmptyValue(val: any): boolean {
    if (val === null || val === undefined) return true;
    const str = String(val).trim();
    return str === '' || str.toLowerCase() === 'null' || str === '0' || str === '0.00';
}

function normalizeImportValue(val: any): string {
    if (isEmptyValue(val)) return 'NULL';
    return String(val).trim();
}

function parseJobId(arg?: string): number | null {
    const id = Number(arg);
    if (!id || Number.isNaN(id)) return null;
    return id;
}

async function handleFatal(runId: number | null, err: unknown) {
    console.error(`${LOG_PREFIX} fatal error`, err);
    if (!runId) process.exit(1);
    try {
        await atribuicaoRepo.updateRunStatus(runId, 'FAILED', String((err as any)?.message || err));
        await atribuicaoRepo.setRunProgress(runId, 'failed', null, 'Atribuição interrompida');
    } catch (_) { /* ignore */ }
    process.exit(1);
}

async function main() {
    const argv = process.argv || [];
    const runId = parseJobId(argv[2]);
    if (!runId) {
        console.error(`${LOG_PREFIX} requires a numeric runId argument`);
        process.exit(2);
    }

    try {
        const run = await atribuicaoRepo.getRunById(runId);
        if (!run) {
            console.error(`${LOG_PREFIX} run not found`, runId);
            await atribuicaoRepo.updateRunStatus(runId, 'FAILED', 'Run não encontrada');
            process.exit(3);
        }

        const keys = await atribuicaoRepo.getRunKeys(runId);
        if (!keys || keys.length === 0) {
            console.error(`${LOG_PREFIX} no keys configured for run`, runId);
            await atribuicaoRepo.updateRunStatus(runId, 'FAILED', 'Nenhuma chave configurada');
            process.exit(4);
        }

        // Load bases
        const baseOrigem = await db('bases').where({ id: run.base_origem_id }).first();
        const baseDestino = await db('bases').where({ id: run.base_destino_id }).first();

        if (!baseOrigem || !baseOrigem.tabela_sqlite) {
            await atribuicaoRepo.updateRunStatus(runId, 'FAILED', 'Base origem inválida');
            process.exit(5);
        }
        if (!baseDestino || !baseDestino.tabela_sqlite) {
            await atribuicaoRepo.updateRunStatus(runId, 'FAILED', 'Base destino inválida');
            process.exit(6);
        }

        const tableOrigem = baseOrigem.tabela_sqlite;
        const tableDestino = baseDestino.tabela_sqlite;
        const modeWrite = run.mode_write || 'OVERWRITE';
        const selectedColumns: string[] = (run as any).selected_columns_json ? JSON.parse((run as any).selected_columns_json) : [];

        // Determine which side is which (FISCAL or CONTABIL)
        const origemTipo = (baseOrigem.tipo || '').toUpperCase();
        const destinoTipo = (baseDestino.tipo || '').toUpperCase();

        await atribuicaoRepo.setRunProgress(runId, 'loading_keys', 10, 'Carregando definições de chaves');

        // Load keys_pairs and their definitions
        const pairIds = keys.map(k => k.keys_pair_id);
        const pairs = await db('keys_pairs').whereIn('id', pairIds);
        const pairsMap: Record<number, any> = {};
        for (const p of pairs) pairsMap[p.id] = p;

        const defIds: number[] = [];
        for (const p of pairs) {
            if (p.contabil_key_id) defIds.push(p.contabil_key_id);
            if (p.fiscal_key_id) defIds.push(p.fiscal_key_id);
        }

        const defs = defIds.length > 0 ? await db('keys_definitions').whereIn('id', [...new Set(defIds)]) : [];
        const defsMap: Record<number, any> = {};
        for (const d of defs) defsMap[d.id] = d;

        // Build key column mappings for each priority
        type KeyConfig = {
            keyIdentifier: string;
            origemCols: string[];
            destinoCols: string[];
        };

        const parseCols = (val: any): string[] => {
            if (!val) return [];
            try {
                return Array.isArray(val) ? val : (typeof val === 'string' ? JSON.parse(val) : []);
            } catch (_) { return []; }
        };

        const keyConfigs: KeyConfig[] = [];
        for (const k of keys) {
            const pair = pairsMap[k.keys_pair_id];
            if (!pair) continue;

            const contabilDef = pair.contabil_key_id ? defsMap[pair.contabil_key_id] : null;
            const fiscalDef = pair.fiscal_key_id ? defsMap[pair.fiscal_key_id] : null;

            if (!contabilDef || !fiscalDef) continue;

            const contabilCols = parseCols(contabilDef.columns || contabilDef.columns_json);
            const fiscalCols = parseCols(fiscalDef.columns || fiscalDef.columns_json);

            // Assign based on base types
            let origemCols: string[];
            let destinoCols: string[];
            if (origemTipo === 'FISCAL') {
                origemCols = fiscalCols;
                destinoCols = contabilCols;
            } else {
                origemCols = contabilCols;
                destinoCols = fiscalCols;
            }

            keyConfigs.push({
                keyIdentifier: k.key_identifier,
                origemCols,
                destinoCols,
            });
        }

        if (keyConfigs.length === 0) {
            await atribuicaoRepo.updateRunStatus(runId, 'FAILED', 'Nenhuma chave válida configurada');
            process.exit(7);
        }

        // Get destino columns schema
        await atribuicaoRepo.setRunProgress(runId, 'creating_result_table', 15, 'Criando tabela de resultado');

        const destinoColsInfo = await db(tableDestino).columnInfo();
        const destinoCols = Object.keys(destinoColsInfo);
        const destinoColsLower = destinoCols.map(c => String(c).toLowerCase());

        // Build set of destination column names that are used as key columns (case-insensitive)
        const keyColsFromConfigs = new Set<string>();
        for (const kc of keyConfigs) {
            const dests = kc.destinoCols || [];
            for (const d of dests) keyColsFromConfigs.add(String(d).toLowerCase());
        }

        // Create result table
        const resultTableName = `atribuicao_result_${runId}`;

        // Drop if exists (for idempotency)
        const exists = await db.schema.hasTable(resultTableName);
        if (exists) {
            await db.schema.dropTableIfExists(resultTableName);
        }

        // Reserved column names that we'll add as metadata
        const reservedCols = new Set(['id', 'dest_row_id', 'orig_row_id', 'matched_key_identifier', 'created_at', 'updated_at']);

        // Prepare unique CHAVE_n column names to avoid collisions with existing columns
        const chaveColumnNames: string[] = [];
        const existingLower = new Set(destinoColsLower);
        for (let i = 0; i < keyConfigs.length; i++) {
            const base = `CHAVE_${i + 1}`;
            let name = base;
            let suffix = 'atr';
            while (existingLower.has(name.toLowerCase()) || reservedCols.has(name.toLowerCase())) {
                name = `${base}_${suffix}`;
            }
            chaveColumnNames.push(name);
            existingLower.add(name.toLowerCase());
        }

        await db.schema.createTable(resultTableName, (table) => {
            table.increments('id').primary();

            // Clone destination columns (skip reserved names and skip any columns that are key columns)
            for (const col of destinoCols) {
                const colLower = String(col).toLowerCase();
                if (reservedCols.has(colLower)) continue; // skip reserved columns
                if (keyColsFromConfigs.has(colLower)) continue; // skip key columns here; we'll add CHAVE_n later
                const info = (destinoColsInfo as any)[col];
                const colType = (info?.type || 'text').toLowerCase();
                if (colType.includes('int')) {
                    table.integer(col).nullable();
                } else if (colType.includes('real') || colType.includes('float') || colType.includes('double')) {
                    table.float(col).nullable();
                } else {
                    table.text(col).nullable();
                }
            }

            // Add imported columns from origin (skip reserved names)
            for (const col of selectedColumns) {
                const importedName = col;
                if (!destinoColsLower.includes(String(importedName).toLowerCase()) && !reservedCols.has(String(importedName).toLowerCase())) {
                    table.text(importedName).nullable();
                }
            }

            // Add CHAVE_n columns based on computed unique names
            for (let i = 0; i < chaveColumnNames.length; i++) {
                const chaveName = chaveColumnNames[i];
                if (!destinoColsLower.includes(chaveName.toLowerCase()) && !reservedCols.has(chaveName.toLowerCase())) {
                    table.text(chaveName).nullable();
                }
            }

            // Metadata columns
            table.integer('dest_row_id').notNullable();
            table.integer('orig_row_id').notNullable();
            table.string('matched_key_identifier').notNullable();
            table.timestamp('created_at').defaultTo(db.fn.now()).notNullable();
            table.timestamp('updated_at').defaultTo(db.fn.now()).notNullable();
        });

        // Create indexes
        await db.schema.alterTable(resultTableName, (table) => {
            table.index(['dest_row_id']);
            table.index(['matched_key_identifier']);
        });

        // Create temp table for matched destinations
        const tempTableName = `tmp_atribuicao_matched_dest_${runId}`;
        const tempExists = await db.schema.hasTable(tempTableName);
        if (tempExists) await db.schema.dropTableIfExists(tempTableName);

        await db.schema.createTable(tempTableName, (table) => {
            table.integer('dest_id').primary();
        });

        await atribuicaoRepo.setResultTableName(runId, resultTableName);

        // Load result table columns (case-insensitive set) to avoid inserting into absent columns
        const resultColsInfo = await db(resultTableName).columnInfo();
        const resultCols = Object.keys(resultColsInfo || {});
        const resultColsLower = new Set(resultCols.map(c => String(c).toLowerCase()));

        // Process each key in priority order
        const totalKeys = keyConfigs.length;
        let processedKeys = 0;
        let totalMatches = 0;

        for (const keyConfig of keyConfigs) {
            const progressBase = 20 + Math.round((processedKeys / totalKeys) * 70);
            await atribuicaoRepo.setRunProgress(
                runId,
                `Atribuindo ${keyConfig.keyIdentifier.toLowerCase()}`,
                progressBase,
                `Processando ${keyConfig.keyIdentifier}`
            );

            const { keyIdentifier, origemCols, destinoCols: destColsForKey } = keyConfig;

            if (origemCols.length === 0 || destColsForKey.length === 0) {
                processedKeys++;
                continue;
            }

            // Build composite key match query
            // SELECT d.id as dest_id, MIN(o.id) as orig_id
            // FROM destino d
            // JOIN origem o ON [key match]
            // LEFT JOIN tmp_matched m ON m.dest_id = d.id
            // WHERE m.dest_id IS NULL
            // GROUP BY d.id

            let lastDestId = 0;
            while (true) {
                // Paginated approach for large tables
                const matchQuery = db.select(
                    db.raw(`d.id as dest_id`),
                    db.raw(`MIN(o.id) as orig_id`)
                )
                    .from({ d: tableDestino })
                    .innerJoin({ o: tableOrigem }, function () {
                        const maxLen = Math.max(origemCols.length, destColsForKey.length);
                        for (let i = 0; i < maxLen; i++) {
                            const oCol = origemCols[i % origemCols.length];
                            const dCol = destColsForKey[i % destColsForKey.length];
                            this.on(`o.${oCol}`, '=', `d.${dCol}`);
                        }
                    })
                    .leftJoin({ m: tempTableName }, 'm.dest_id', 'd.id')
                    .whereNull('m.dest_id')
                    .andWhere('d.id', '>', lastDestId)
                    .groupBy('d.id')
                    .orderBy('d.id', 'asc')
                    .limit(PAGE_SIZE);

                const matches: Array<{ dest_id: number; orig_id: number }> = await matchQuery;
                if (!matches || matches.length === 0) break;

                const inserts: any[] = [];
                const matchedDestIds: number[] = [];

                for (const match of matches) {
                    const destId = Number(match.dest_id);
                    const origId = Number(match.orig_id);

                    // Fetch full rows
                    const destRow = await db(tableDestino).where({ id: destId }).first();
                    const origRow = await db(tableOrigem).where({ id: origId }).first();

                    if (!destRow || !origRow) continue;

                    // Build result row
                    const resultRow: Record<string, any> = {};

                    // Copy destination columns (skip reserved names) — keep original destination columns intact
                    for (const col of destinoCols) {
                        const colLower = col.toLowerCase();
                        if (reservedCols.has(colLower)) continue;
                        resultRow[col] = destRow[col];
                    }

                    // Apply imported columns based on write mode
                    for (const col of selectedColumns) {
                        const origValue = origRow[col];
                        const destValue = destRow[col];

                        if (modeWrite === 'ONLY_EMPTY') {
                            // Only write if destination cell is empty
                            if (isEmptyValue(destValue)) {
                                resultRow[col] = normalizeImportValue(origValue);
                            } else {
                                // Keep destination value
                                resultRow[col] = destValue;
                            }
                        } else {
                            // OVERWRITE mode
                            resultRow[col] = normalizeImportValue(origValue);
                        }
                    }

                    // Add metadata
                    // Populate CHAVE_1..CHAVE_N columns from destination row values
                    // Build a case-insensitive lookup for destRow to be robust against column name casing
                    const destRowLookup: Record<string, any> = {};
                    for (const k of Object.keys(destRow || {})) destRowLookup[k.toLowerCase()] = destRow[k];

                    for (let kIdx = 0; kIdx < keyConfigs.length; kIdx++) {
                        const kc = keyConfigs[kIdx];
                        const destColsForKey = kc.destinoCols || [];
                        const combined = destColsForKey.map(dc => {
                            if (!dc) return '';
                            const raw = destRow[dc] ?? destRowLookup[String(dc).toLowerCase()];
                            return raw === null || raw === undefined ? '' : String(raw);
                        }).filter(s => s !== '').join('_');
                        const chaveCol = typeof chaveColumnNames !== 'undefined' && chaveColumnNames[kIdx] ? chaveColumnNames[kIdx] : `CHAVE_${kIdx + 1}`;
                        resultRow[chaveCol] = combined || null;
                    }

                    // Add metadata
                    resultRow.dest_row_id = destId;
                    resultRow.orig_row_id = origId;
                    resultRow.matched_key_identifier = keyIdentifier;
                    resultRow.created_at = db.fn.now();
                    resultRow.updated_at = db.fn.now();

                    // Filter resultRow to include only columns that actually exist in the result table
                    const finalRow: Record<string, any> = {};
                    for (const k of Object.keys(resultRow)) {
                        if (resultColsLower.has(String(k).toLowerCase())) finalRow[k] = resultRow[k];
                    }
                    inserts.push(finalRow);
                    matchedDestIds.push(destId);
                }

                // Batch insert results
                if (inserts.length > 0) {
                    const trx = await db.transaction();
                    try {
                        for (let i = 0; i < inserts.length; i += BATCH_SIZE) {
                            const slice = inserts.slice(i, i + BATCH_SIZE);
                            await trx(resultTableName).insert(slice);
                        }
                        // Insert matched dest_ids into temp table
                        const tempInserts = matchedDestIds.map(id => ({ dest_id: id }));
                        for (let i = 0; i < tempInserts.length; i += BATCH_SIZE) {
                            const slice = tempInserts.slice(i, i + BATCH_SIZE);
                            await trx(tempTableName).insert(slice).onConflict('dest_id').ignore();
                        }
                        await trx.commit();
                        totalMatches += inserts.length;
                    } catch (err) {
                        await trx.rollback();
                        throw err;
                    }
                }

                lastDestId = matches[matches.length - 1].dest_id;
                if (matches.length < PAGE_SIZE) break;
            }

            processedKeys++;
        }

        // Cleanup temp table
        await db.schema.dropTableIfExists(tempTableName);

        // Complete
        await atribuicaoRepo.setRunProgress(runId, 'finalizing', 100, `Atribuição finalizada - ${totalMatches} registros`);
        await atribuicaoRepo.updateRunStatus(runId, 'DONE');

        console.log(`${LOG_PREFIX} run ${runId} completed with ${totalMatches} matches`);
        process.exit(0);
    } catch (err: any) {
        await handleFatal(runId, err);
    }
}

void main();
