/**
 * Testes unitários para lógica de configs (conciliação, estorno, cancelamento)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestDb, createBaseTables, TestDbContext } from '../../helpers/testDb';
import type { Knex } from 'knex';

describe('Configs Conciliacao Logic', () => {
    let ctx: TestDbContext;
    let db: Knex;

    beforeAll(async () => {
        ctx = createTestDb();
        db = ctx.db;
        await createBaseTables(db);
    });

    afterAll(async () => {
        await ctx.cleanup();
    });

    beforeEach(async () => {
        await db('configs_conciliacao_keys').del();
        await db('configs_conciliacao').del();
        await db('bases').del();
    });

    describe('Criação de config', () => {
        it('deve criar config com bases obrigatórias', async () => {
            const [baseAId] = await db('bases').insert({ nome: 'Base A', tipo: 'CONTABIL' });
            const [baseBId] = await db('bases').insert({ nome: 'Base B', tipo: 'FISCAL' });

            const [configId] = await db('configs_conciliacao').insert({
                nome: 'Nova Config',
                base_contabil_id: baseAId,
                base_fiscal_id: baseBId,
            });

            const config = await db('configs_conciliacao').where({ id: configId }).first();
            expect(config?.nome).toBe('Nova Config');
            expect(config?.base_contabil_id).toBe(baseAId);
            expect(config?.base_fiscal_id).toBe(baseBId);
        });

        it('deve criar config com chaves JSON', async () => {
            const [baseAId] = await db('bases').insert({ nome: 'Base A', tipo: 'CONTABIL' });
            const [baseBId] = await db('bases').insert({ nome: 'Base B', tipo: 'FISCAL' });

            const chavesContabil = JSON.stringify({ CHAVE_1: ['documento', 'empresa'] });
            const chavesFiscal = JSON.stringify({ CHAVE_1: ['nf_numero', 'empresa'] });

            const [configId] = await db('configs_conciliacao').insert({
                nome: 'Config com Chaves',
                base_contabil_id: baseAId,
                base_fiscal_id: baseBId,
                chaves_contabil: chavesContabil,
                chaves_fiscal: chavesFiscal,
            });

            const config = await db('configs_conciliacao').where({ id: configId }).first();
            const parsedChavesContabil = JSON.parse(config?.chaves_contabil || '{}');

            expect(parsedChavesContabil.CHAVE_1).toContain('documento');
        });

        it('deve criar config com colunas de conciliação', async () => {
            const [baseAId] = await db('bases').insert({ nome: 'Base A', tipo: 'CONTABIL' });
            const [baseBId] = await db('bases').insert({ nome: 'Base B', tipo: 'FISCAL' });

            const [configId] = await db('configs_conciliacao').insert({
                nome: 'Config Monetária',
                base_contabil_id: baseAId,
                base_fiscal_id: baseBId,
                coluna_conciliacao_contabil: 'valor',
                coluna_conciliacao_fiscal: 'valor_nf',
                inverter_sinal_fiscal: 0,
                limite_diferenca_imaterial: 0.01,
            });

            const config = await db('configs_conciliacao').where({ id: configId }).first();
            expect(config?.coluna_conciliacao_contabil).toBe('valor');
            expect(config?.limite_diferenca_imaterial).toBeCloseTo(0.01);
        });
    });

    describe('Múltiplas chaves', () => {
        it('deve suportar múltiplas chaves por prioridade', async () => {
            const [baseAId] = await db('bases').insert({ nome: 'Base A', tipo: 'CONTABIL' });
            const [baseBId] = await db('bases').insert({ nome: 'Base B', tipo: 'FISCAL' });

            const chavesContabil = JSON.stringify({
                CHAVE_1: ['documento'],
                CHAVE_2: ['documento', 'empresa'],
                CHAVE_3: ['nf_referencia'],
            });

            const [configId] = await db('configs_conciliacao').insert({
                nome: 'Config Multi-Chave',
                base_contabil_id: baseAId,
                base_fiscal_id: baseBId,
                chaves_contabil: chavesContabil,
            });

            const config = await db('configs_conciliacao').where({ id: configId }).first();
            const chaves = JSON.parse(config?.chaves_contabil || '{}');

            expect(Object.keys(chaves)).toHaveLength(3);
            expect(chaves.CHAVE_1).toEqual(['documento']);
            expect(chaves.CHAVE_2).toEqual(['documento', 'empresa']);
        });
    });

    describe('Keys Linking (configs_conciliacao_keys)', () => {
        it('deve vincular chaves à config com ordem', async () => {
            const [baseAId] = await db('bases').insert({ nome: 'Base A', tipo: 'CONTABIL' });
            const [baseBId] = await db('bases').insert({ nome: 'Base B', tipo: 'FISCAL' });

            const [configId] = await db('configs_conciliacao').insert({
                nome: 'Config Linked',
                base_contabil_id: baseAId,
                base_fiscal_id: baseBId,
            });

            await db('configs_conciliacao_keys').insert([
                { config_conciliacao_id: configId, key_identifier: 'CHAVE_1', ordem: 1 },
                { config_conciliacao_id: configId, key_identifier: 'CHAVE_2', ordem: 2 },
            ]);

            const keys = await db('configs_conciliacao_keys')
                .where({ config_conciliacao_id: configId })
                .orderBy('ordem', 'asc')
                .select('*');

            expect(keys).toHaveLength(2);
            expect(keys[0].key_identifier).toBe('CHAVE_1');
            expect(keys[1].key_identifier).toBe('CHAVE_2');
        });
    });
});

describe('Configs Estorno Logic', () => {
    let ctx: TestDbContext;
    let db: Knex;

    beforeAll(async () => {
        ctx = createTestDb();
        db = ctx.db;
        await createBaseTables(db);
    });

    afterAll(async () => {
        await ctx.cleanup();
    });

    beforeEach(async () => {
        await db('configs_estorno').del();
        await db('bases').del();
    });

    describe('Criação de config estorno', () => {
        it('deve criar config de estorno', async () => {
            const [baseId] = await db('bases').insert({ nome: 'Base Contabil', tipo: 'CONTABIL' });

            const [configId] = await db('configs_estorno').insert({
                nome: 'Estorno Config',
                base_id: baseId,
                coluna_soma: 'valor',
                limite_zero: 0.01,
            });

            const config = await db('configs_estorno').where({ id: configId }).first();
            expect(config?.nome).toBe('Estorno Config');
            expect(config?.coluna_soma).toBe('valor');
            expect(config?.limite_zero).toBeCloseTo(0.01);
        });

        it('deve suportar colunas de agrupamento', async () => {
            const [baseId] = await db('bases').insert({ nome: 'Base', tipo: 'CONTABIL' });

            const [configId] = await db('configs_estorno').insert({
                nome: 'Estorno Agrupado',
                base_id: baseId,
                coluna_a: 'documento',
                coluna_b: 'empresa',
                coluna_soma: 'valor',
                limite_zero: 0.001,
            });

            const config = await db('configs_estorno').where({ id: configId }).first();
            expect(config?.coluna_a).toBe('documento');
            expect(config?.coluna_b).toBe('empresa');
        });
    });
});

describe('Configs Cancelamento Logic', () => {
    let ctx: TestDbContext;
    let db: Knex;

    beforeAll(async () => {
        ctx = createTestDb();
        db = ctx.db;
        await createBaseTables(db);
    });

    afterAll(async () => {
        await ctx.cleanup();
    });

    beforeEach(async () => {
        await db('configs_cancelamento').del();
        await db('bases').del();
    });

    describe('Criação de config cancelamento', () => {
        it('deve criar config de cancelamento', async () => {
            const [baseId] = await db('bases').insert({ nome: 'Base Fiscal', tipo: 'FISCAL' });

            const [configId] = await db('configs_cancelamento').insert({
                nome: 'Cancelamento Config',
                base_id: baseId,
                coluna_indicador: 'situacao_nf',
                valor_cancelado: 'CANCELADA',
            });

            const config = await db('configs_cancelamento').where({ id: configId }).first();
            expect(config?.nome).toBe('Cancelamento Config');
            expect(config?.coluna_indicador).toBe('situacao_nf');
            expect(config?.valor_cancelado).toBe('CANCELADA');
        });

        it('deve suportar diferentes valores de cancelamento', async () => {
            const [baseId] = await db('bases').insert({ nome: 'Base', tipo: 'FISCAL' });

            // Valor simples
            await db('configs_cancelamento').insert({
                nome: 'Cancel S',
                base_id: baseId,
                coluna_indicador: 'cancelado',
                valor_cancelado: 'S',
            });

            // Valor numérico como string
            await db('configs_cancelamento').insert({
                nome: 'Cancel 1',
                base_id: baseId,
                coluna_indicador: 'status',
                valor_cancelado: '1',
            });

            const configs = await db('configs_cancelamento').select('*');
            expect(configs).toHaveLength(2);
        });
    });
});
