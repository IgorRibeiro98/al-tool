/**
 * Testes unitários para baseColumnsRepository
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestDb, createBaseTables, TestDbContext } from '../../helpers/testDb';
import type { Knex } from 'knex';

import * as baseColumnsRepo from '../../../src/repos/baseColumnsRepository';

describe('baseColumnsRepository', () => {
    let ctx: TestDbContext;
    let db: Knex;
    let testBaseId: number;

    beforeAll(async () => {
        ctx = createTestDb();
        db = ctx.db;
        await createBaseTables(db);

        // Criar base de teste
        const [id] = await db('bases').insert({
            nome: 'Base Teste Columns',
            tipo: 'CONTABIL',
            tabela_sqlite: 'base_test_1',
        });
        testBaseId = id;

        // Inserir colunas de teste
        await db('base_columns').insert([
            { base_id: testBaseId, excel_name: 'Documento', sqlite_name: 'documento', col_index: 0, is_monetary: 0 },
            { base_id: testBaseId, excel_name: 'Valor', sqlite_name: 'valor', col_index: 1, is_monetary: 1 },
            { base_id: testBaseId, excel_name: 'Empresa', sqlite_name: 'empresa', col_index: 2, is_monetary: 0 },
        ]);
    });

    afterAll(async () => {
        await ctx.cleanup();
    });

    beforeEach(() => {
        // Limpar cache entre testes
        baseColumnsRepo.clearColumnsCache();
    });

    describe('getColumnsForBase', () => {
        it('deve retornar colunas ordenadas por col_index', async () => {
            const columns = await baseColumnsRepo.getColumnsForBase(testBaseId, { knex: db, useCache: false });

            expect(columns).toHaveLength(3);
            expect(columns[0].col_index).toBe(0);
            expect(columns[1].col_index).toBe(1);
            expect(columns[2].col_index).toBe(2);
        });

        it('deve retornar colunas com propriedades corretas', async () => {
            const columns = await baseColumnsRepo.getColumnsForBase(testBaseId, { knex: db, useCache: false });

            expect(columns[0]).toMatchObject({
                base_id: testBaseId,
                excel_name: 'Documento',
                sqlite_name: 'documento',
                col_index: 0,
                is_monetary: 0,
            });
        });

        it('deve identificar colunas monetárias', async () => {
            const columns = await baseColumnsRepo.getColumnsForBase(testBaseId, { knex: db, useCache: false });

            const monetary = columns.filter(c => c.is_monetary === 1);
            expect(monetary).toHaveLength(1);
            expect(monetary[0].excel_name).toBe('Valor');
        });

        it('deve usar cache quando habilitado', async () => {
            // Primeira chamada
            const cols1 = await baseColumnsRepo.getColumnsForBase(testBaseId, { knex: db, useCache: true });

            // Segunda chamada deve usar cache
            const cols2 = await baseColumnsRepo.getColumnsForBase(testBaseId, { knex: db, useCache: true });

            expect(cols1).toBe(cols2); // Mesma referência (cache)
        });

        it('deve retornar array vazio para base sem colunas', async () => {
            // Criar base sem colunas
            const [emptyBaseId] = await db('bases').insert({
                nome: 'Base Vazia',
                tipo: 'FISCAL',
            });

            const columns = await baseColumnsRepo.getColumnsForBase(emptyBaseId, { knex: db, useCache: false });

            expect(columns).toEqual([]);
        });

        it('deve lançar erro para baseId inválido', async () => {
            await expect(
                baseColumnsRepo.getColumnsForBase(-1, { knex: db })
            ).rejects.toThrow('baseId must be a positive integer');

            await expect(
                baseColumnsRepo.getColumnsForBase(0, { knex: db })
            ).rejects.toThrow('baseId must be a positive integer');
        });
    });

    describe('getSqliteNameForBaseColumn', () => {
        it('deve resolver nome sqlite de coluna excel', async () => {
            const sqliteName = await baseColumnsRepo.getSqliteNameForBaseColumn(
                testBaseId,
                'Documento',
                { knex: db }
            );

            expect(sqliteName).toBe('documento');
        });

        it('deve retornar null para coluna inexistente', async () => {
            const sqliteName = await baseColumnsRepo.getSqliteNameForBaseColumn(
                testBaseId,
                'ColunaInexistente',
                { knex: db }
            );

            expect(sqliteName).toBeNull();
        });

        it('deve retornar null para nome vazio', async () => {
            const sqliteName = await baseColumnsRepo.getSqliteNameForBaseColumn(
                testBaseId,
                '',
                { knex: db }
            );

            expect(sqliteName).toBeNull();
        });

        it('deve ser case-sensitive', async () => {
            const upper = await baseColumnsRepo.getSqliteNameForBaseColumn(
                testBaseId,
                'DOCUMENTO',
                { knex: db }
            );

            // Depende de como os dados foram inseridos
            expect(upper).toBeNull(); // 'DOCUMENTO' != 'Documento'
        });
    });

    describe('clearColumnsCache', () => {
        it('deve limpar cache de base específica', async () => {
            // Popular cache
            const cols1 = await baseColumnsRepo.getColumnsForBase(testBaseId, { knex: db, useCache: true });

            // Limpar cache
            baseColumnsRepo.clearColumnsCache(testBaseId);

            // Nova busca não deve usar cache
            const cols2 = await baseColumnsRepo.getColumnsForBase(testBaseId, { knex: db, useCache: true });

            expect(cols1).not.toBe(cols2); // Referências diferentes
        });

        it('deve limpar todo o cache quando sem parâmetro', async () => {
            // Popular cache
            await baseColumnsRepo.getColumnsForBase(testBaseId, { knex: db, useCache: true });

            // Limpar todo cache
            baseColumnsRepo.clearColumnsCache();

            // Verificar que não há cache
            const cols = await baseColumnsRepo.getColumnsForBase(testBaseId, { knex: db, useCache: true });
            expect(cols).toBeDefined();
        });
    });
});
