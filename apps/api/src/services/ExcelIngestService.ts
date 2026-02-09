/**
 * Excel Ingest Service
 * 
 * Serviço responsável por processar arquivos XLSX/Arrow IPC, 
 * criar tabelas sqlite `base_<id>` e popular os dados.
 * 
 * Implementa:
 * - IDEIA 1: Apache Arrow IPC format (10-100x mais rápido que JSONL)
 * - IDEIA 3: Memory-Mapped Files + Zero-Copy (50-80% menos memória)
 * - IDEIA 5: Pipeline de Streaming Unificada (backpressure automático)
 */

import path from 'path';
import fs from 'fs/promises';
import { totalmem } from 'os';
import db from '../db/knex';
import baseColumnsService from './baseColumnsService';
import { streamingIngest, StreamingIngestOptions, StreamingIngestResult } from './StreamingIngestPipeline';
import { MmapFileReader } from './MmapFileReader';

// ============================================================================
// Performance Configuration - Dynamically adjusted based on available RAM
// Optimized for target: 8GB RAM, i5 8th gen, Windows 11
// ============================================================================

/**
 * Calculate optimal batch sizes based on available RAM.
 * Uses mmap for zero-copy access when available (IDEIA 3).
 */
function getOptimalBatchSizes(): { arrowBatch: number; xlsxBatch: number; maxRowsTx: number } {
    const totalRamMB = Math.floor(totalmem() / 1024 / 1024);

    // With mmap, we can be more aggressive with batch sizes since
    // the OS manages memory pages efficiently
    const mmapAvailable = MmapFileReader.isMmapAvailable();
    const mmapBoost = mmapAvailable ? 1.5 : 1.0; // 50% larger batches with mmap

    if (totalRamMB < 6000) {
        // Low memory mode (< 6GB)
        return {
            arrowBatch: Math.floor(5000 * mmapBoost),
            xlsxBatch: 1500,
            maxRowsTx: 50000
        };
    } else if (totalRamMB < 10000) {
        // Standard mode (6-10GB) - target 8GB
        return {
            arrowBatch: Math.floor(10000 * mmapBoost),
            xlsxBatch: 3000,
            maxRowsTx: 100000
        };
    } else {
        // High performance mode (> 10GB)
        return {
            arrowBatch: Math.floor(20000 * mmapBoost),
            xlsxBatch: 5000,
            maxRowsTx: 200000
        };
    }
}

const BATCH_CONFIG = getOptimalBatchSizes();

type IngestResult = { tableName: string; rowsInserted: number };

// ============================================================================
// Excel Ingest Service Class
// ============================================================================

export class ExcelIngestService {

    /**
     * Append to ingest log file for debugging and monitoring.
     */
    private async appendIngestLog(prefix: string, info: any) {
        try {
            const logsDir = path.resolve(__dirname, '..', '..', 'logs');
            await fs.mkdir(logsDir, { recursive: true });
            const file = path.join(logsDir, 'ingest-errors.log');
            await fs.appendFile(file, JSON.stringify({ ts: new Date().toISOString(), prefix, info }) + '\n');
        } catch (e) {
            // Best-effort logging; avoid throwing from logger
            console.error('appendIngestLog failed', e);
        }
    }

    /**
     * Try a set of likely candidate paths and remove the first existing file.
     */
    private async tryRemoveFileCandidate(baseId: number, relOrAbs: string) {
        if (!relOrAbs) return false;
        const tried: string[] = [];
        const candidates = path.isAbsolute(relOrAbs)
            ? [relOrAbs]
            : [
                path.resolve(process.cwd(), relOrAbs),
                path.resolve(process.cwd(), '..', relOrAbs),
                path.resolve(process.cwd(), '..', '..', relOrAbs),
                path.resolve(__dirname, '..', '..', relOrAbs),
                path.join(process.cwd(), 'apps', 'api', relOrAbs),
                path.join(process.cwd(), relOrAbs.replace(/^\/+/, ''))
            ];

        for (const c of candidates) {
            if (!c) continue;
            tried.push(c);
            try {
                await fs.stat(c);
                await fs.unlink(c);
                await this.appendIngestLog('RemovedIngestFile', { baseId, requested: relOrAbs, removedPath: c });
                return true;
            } catch (_) {
                // ignore and continue
            }
        }

        // final attempt: try as provided
        try {
            await fs.stat(relOrAbs);
            await fs.unlink(relOrAbs);
            await this.appendIngestLog('RemovedIngestFile', { baseId, requested: relOrAbs, removedPath: relOrAbs });
            return true;
        } catch (_) {
            await this.appendIngestLog('IngestCleanupNotFound', { baseId, requested: relOrAbs, tried });
            return false;
        }
    }

    /**
     * Perform post-ingest cleanup: remove source files, apply monetary flags, etc.
     */
    private async performPostIngestCleanup(baseId: number, base: any) {
        try {
            const toRemove = [base?.arquivo_arrow_path, base?.arquivo_caminho].filter(Boolean) as string[];
            for (const p of toRemove) {
                try {
                    await this.tryRemoveFileCandidate(baseId, p);
                } catch (e) {
                    await this.appendIngestLog('ErrorDeletingIngestFile', {
                        baseId,
                        file: p,
                        error: e instanceof Error ? e.stack || e.message : String(e)
                    });
                }
            }

            try {
                await db('bases').where({ id: baseId }).update({ arquivo_arrow_path: null, arquivo_caminho: null });
            } catch (e) {
                await this.appendIngestLog('ErrorClearingArquivoPaths', {
                    baseId,
                    error: e instanceof Error ? e.stack || e.message : String(e)
                });
            }

            // If this base references a model base, attempt to copy monetary flags from the reference
            try {
                const refId = base && (base.reference_base_id || base.reference_base_id === 0 ? Number(base.reference_base_id) : null);
                if (refId && Number.isInteger(refId) && refId > 0) {
                    try {
                        await baseColumnsService.applyMonetaryFlagsFromReference(refId, baseId, { override: true }).catch(async (err) => {
                            await this.appendIngestLog('ApplyMonetaryFlagsFailed', {
                                baseId,
                                reference_base_id: refId,
                                error: err instanceof Error ? err.stack || err.message : String(err)
                            });
                        });
                    } catch (innerErr) {
                        await this.appendIngestLog('ApplyMonetaryFlagsException', {
                            baseId,
                            reference_base_id: refId,
                            error: innerErr instanceof Error ? (innerErr as Error).stack || (innerErr as Error).message : String(innerErr)
                        });
                    }
                }
            } catch (e) {
                await this.appendIngestLog('ApplyMonetaryFlagsOuterError', {
                    baseId,
                    error: e instanceof Error ? e.stack || e.message : String(e)
                });
            }
        } catch (e) {
            await this.appendIngestLog('PostIngestCleanupFailed', {
                baseId,
                error: e instanceof Error ? e.stack || e.message : String(e)
            });
        }
    }

    /**
     * Resolve file path from base record.
     * Prefers arquivo_arrow_path if available (Arrow IPC format).
     */
    private resolveFilePathFromBase(base: any): { filePath: string; isArrow: boolean } {
        const arrowPath = base.arquivo_arrow_path || null;
        if (arrowPath) {
            if (path.isAbsolute(arrowPath)) return { filePath: arrowPath, isArrow: true };
            const candidates = [
                path.resolve(process.cwd(), arrowPath),
                path.resolve(process.cwd(), '..', '..', arrowPath),
                path.resolve(process.cwd(), '..', arrowPath)
            ];
            for (const c of candidates) {
                return { filePath: c, isArrow: true };
            }
            return { filePath: path.resolve(process.cwd(), arrowPath), isArrow: true };
        }

        if (!base.arquivo_caminho) throw new Error('Base has no arquivo_caminho');
        return {
            filePath: path.isAbsolute(base.arquivo_caminho)
                ? base.arquivo_caminho
                : path.resolve(process.cwd(), base.arquivo_caminho),
            isArrow: false
        };
    }

    /**
     * Public entry point for ingesting a base.
     * 
     * Uses the streaming pipeline (IDEIA 5) with memory-mapped files (IDEIA 3)
     * for optimal performance.
     */
    async ingest(baseId: number): Promise<IngestResult> {
        const base = await db('bases').where({ id: baseId }).first();
        if (!base) throw new Error('Base not found');

        const headerLinhaInicial = Number(base.header_linha_inicial || 1);
        const headerColunaInicial = Number(base.header_coluna_inicial || 1);

        const { filePath, isArrow } = this.resolveFilePathFromBase(base);
        try {
            await fs.access(filePath);
        } catch (e) {
            throw new Error(`Ingest file not accessible: ${filePath}`);
        }

        // Log mmap availability
        const mmapAvailable = MmapFileReader.isMmapAvailable();
        await this.appendIngestLog('IngestStart', {
            baseId,
            filePath,
            isArrow,
            mmapAvailable,
            headerRow: headerLinhaInicial,
            startCol: headerColunaInicial,
            batchConfig: BATCH_CONFIG
        });

        // Build streaming options
        // For Arrow files, the conversion step (xlsb_to_arrow.py) already applied
        // header_linha_inicial / header_coluna_inicial, so we read from row 1, col 0.
        // For raw Excel files, we must apply the offsets during ingest.
        const options: StreamingIngestOptions = {
            baseId,
            filePath,
            headerRowNumber: isArrow ? 1 : Math.max(1, headerLinhaInicial),
            startColumnIndex: isArrow ? 0 : Math.max(0, headerColunaInicial - 1),
            batchSize: isArrow ? BATCH_CONFIG.arrowBatch : BATCH_CONFIG.xlsxBatch,
            maxRowsPerTransaction: BATCH_CONFIG.maxRowsTx,
            onProgress: async (progress) => {
                // Log progress for large files (every 100k rows)
                if (progress.rowsProcessed % 100000 === 0 && progress.rowsProcessed > 0) {
                    await this.appendIngestLog('StreamingProgress', {
                        baseId,
                        rowsProcessed: progress.rowsProcessed,
                        rowsInserted: progress.rowsInserted,
                        batchesInserted: progress.batchesInserted,
                        phase: progress.phase
                    });
                }
            }
        };

        // Execute streaming ingest
        let result: StreamingIngestResult;
        try {
            result = await streamingIngest(options);
        } catch (error) {
            await this.appendIngestLog('StreamingIngestError', {
                baseId,
                error: error instanceof Error ? error.stack || error.message : String(error)
            });
            throw error;
        }

        await this.appendIngestLog('IngestComplete', {
            baseId,
            tableName: result.tableName,
            rowsInserted: result.rowsInserted,
            durationMs: result.durationMs,
            mmapUsed: isArrow && mmapAvailable
        });

        // Post-ingest cleanup
        await this.performPostIngestCleanup(baseId, base);

        return {
            tableName: result.tableName,
            rowsInserted: result.rowsInserted
        };
    }
}

export default new ExcelIngestService();
