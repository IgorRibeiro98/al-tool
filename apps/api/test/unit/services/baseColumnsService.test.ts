/**
 * Testes unitários para baseColumnsService
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestDb, createBaseTables, TestDbContext } from '../../helpers/testDb';
import type { Knex } from 'knex';

import { applyMonetaryFlagsFromReference } from '../../../src/services/baseColumnsService';

describe('baseColumnsService', () => {
    let ctx: TestDbContext;
    let db: Knex;
    let sourceBaseId: number;
    let targetBaseId: number;

    beforeAll(async () => {
        ctx = createTestDb();
        db = ctx.db;
        await createBaseTables(db);
    });

    afterAll(async () => {
        await ctx.cleanup();
    });

    beforeEach(async () => {
        // Limpar dados anteriores
        await db('base_columns').del();
        await db('bases').del();

        // Criar base de origem com flags monetários
        const [srcId] = await db('bases').insert({
            nome: 'Base Origem',
            tipo: 'CONTABIL',
        });
        sourceBaseId = srcId;

        // Criar base de destino sem flags monetários
        const [tgtId] = await db('bases').insert({
            nome: 'Base Destino',
            tipo: 'CONTABIL',
        });
        targetBaseId = tgtId;

        // Inserir colunas na base de origem (com monetary flags)
        await db('base_columns').insert([
            { base_id: sourceBaseId, excel_name: 'Documento', sqlite_name: 'documento', col_index: 0, is_monetary: 0 },
            { base_id: sourceBaseId, excel_name: 'Valor', sqlite_name: 'valor', col_index: 1, is_monetary: 1 },
            { base_id: sourceBaseId, excel_name: 'Total', sqlite_name: 'total', col_index: 2, is_monetary: 1 },
            { base_id: sourceBaseId, excel_name: 'Empresa', sqlite_name: 'empresa', col_index: 3, is_monetary: 0 },
        ]);

        // Inserir colunas na base de destino (sem monetary flags)
        await db('base_columns').insert([
            { base_id: targetBaseId, excel_name: 'Documento', sqlite_name: 'documento', col_index: 0, is_monetary: null },
            { base_id: targetBaseId, excel_name: 'Valor', sqlite_name: 'valor', col_index: 1, is_monetary: null },
            { base_id: targetBaseId, excel_name: 'Total', sqlite_name: 'total', col_index: 2, is_monetary: null },
            { base_id: targetBaseId, excel_name: 'Empresa', sqlite_name: 'empresa', col_index: 3, is_monetary: null },
        ]);
    });

    describe('applyMonetaryFlagsFromReference', () => {
        it('deve copiar flags monetários da base de origem para destino', async () => {
            const result = await applyMonetaryFlagsFromReference(sourceBaseId, targetBaseId, { knex: db });

            expect(result.updated).toBe(2); // Valor e Total

            // Verificar que os flags foram aplicados
            const targetCols = await db('base_columns')
                .where({ base_id: targetBaseId })
                .orderBy('col_index');

            expect(targetCols[0].is_monetary).toBeNull(); // Documento - não era monetário
            expect(targetCols[1].is_monetary).toBe(1); // Valor
            expect(targetCols[2].is_monetary).toBe(1); // Total
            expect(targetCols[3].is_monetary).toBeNull(); // Empresa - não era monetário
        });

        it('deve usar matchBy excel_name por padrão', async () => {
            const result = await applyMonetaryFlagsFromReference(sourceBaseId, targetBaseId, {
                matchBy: 'excel_name',
                knex: db,
            });

            expect(result.updated).toBe(2);
        });

        it('deve suportar matchBy sqlite_name', async () => {
            const result = await applyMonetaryFlagsFromReference(sourceBaseId, targetBaseId, {
                matchBy: 'sqlite_name',
                knex: db,
            });

            expect(result.updated).toBe(2);
        });

        it('deve respeitar override=false (não sobrescrever existentes)', async () => {
            // Definir flag existente no destino
            await db('base_columns')
                .where({ base_id: targetBaseId, sqlite_name: 'valor' })
                .update({ is_monetary: 0 });

            const result = await applyMonetaryFlagsFromReference(sourceBaseId, targetBaseId, {
                override: false,
                knex: db,
            });

            // Apenas Total deve ser atualizado (Valor já tinha valor)
            expect(result.updated).toBe(1);

            const valorCol = await db('base_columns')
                .where({ base_id: targetBaseId, sqlite_name: 'valor' })
                .first();
            expect(valorCol.is_monetary).toBe(0); // Manteve valor original
        });

        it('deve sobrescrever quando override=true', async () => {
            // Definir flag existente no destino
            await db('base_columns')
                .where({ base_id: targetBaseId, sqlite_name: 'valor' })
                .update({ is_monetary: 0 });

            const result = await applyMonetaryFlagsFromReference(sourceBaseId, targetBaseId, {
                override: true,
                knex: db,
            });

            expect(result.updated).toBe(2);

            const valorCol = await db('base_columns')
                .where({ base_id: targetBaseId, sqlite_name: 'valor' })
                .first();
            expect(valorCol.is_monetary).toBe(1); // Sobrescrito
        });

        it('deve retornar reason no_source_columns quando origem não tem colunas', async () => {
            // Criar base vazia
            const [emptyId] = await db('bases').insert({ nome: 'Vazia', tipo: 'CONTABIL' });

            const result = await applyMonetaryFlagsFromReference(emptyId, targetBaseId, { knex: db });

            expect(result.updated).toBe(0);
            expect(result.reason).toBe('no_source_columns');
        });

        it('deve retornar reason no_source_monetary_flags quando origem não tem flags monetários', async () => {
            // Atualizar origem para não ter flags monetários
            await db('base_columns')
                .where({ base_id: sourceBaseId })
                .update({ is_monetary: 0 });

            const result = await applyMonetaryFlagsFromReference(sourceBaseId, targetBaseId, { knex: db });

            expect(result.updated).toBe(0);
            expect(result.reason).toBe('no_source_monetary_flags');
        });

        it('deve lançar erro para sourceBaseId inválido', async () => {
            await expect(
                applyMonetaryFlagsFromReference(-1, targetBaseId, { knex: db })
            ).rejects.toThrow('sourceBaseId must be positive integer');
        });

        it('deve lançar erro para targetBaseId inválido', async () => {
            await expect(
                applyMonetaryFlagsFromReference(sourceBaseId, 0, { knex: db })
            ).rejects.toThrow('targetBaseId must be positive integer');
        });
    });
});
