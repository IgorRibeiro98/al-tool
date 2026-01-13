/**
 * Testes unitários para lógica de negócio das rotas de bases
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestDb, createBaseTables, TestDbContext } from '../../helpers/testDb';
import type { Knex } from 'knex';

describe('Bases Route Logic', () => {
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
        await db('ingest_jobs').del();
        await db('base_columns').del();
        await db('bases').del();
    });

    describe('GET /bases - listagem', () => {
        it('deve listar bases ordenadas por created_at desc', async () => {
            await db('bases').insert({ nome: 'Base 1', tipo: 'CONTABIL' });
            await new Promise(r => setTimeout(r, 10));
            await db('bases').insert({ nome: 'Base 2', tipo: 'FISCAL' });

            const bases = await db('bases')
                .select('*')
                .orderBy('created_at', 'desc')
                .orderBy('id', 'desc');

            expect(bases[0].nome).toBe('Base 2');
            expect(bases[1].nome).toBe('Base 1');
        });

        it('deve filtrar por tipo', async () => {
            await db('bases').insert([
                { nome: 'Contabil 1', tipo: 'CONTABIL' },
                { nome: 'Fiscal 1', tipo: 'FISCAL' },
                { nome: 'Contabil 2', tipo: 'CONTABIL' },
            ]);

            const contabeis = await db('bases').where({ tipo: 'CONTABIL' }).select('*');
            expect(contabeis).toHaveLength(2);
            expect(contabeis.every((b: any) => b.tipo === 'CONTABIL')).toBe(true);
        });

        it('deve filtrar por período', async () => {
            await db('bases').insert([
                { nome: 'Base Jan', tipo: 'CONTABIL', periodo: '2025-01' },
                { nome: 'Base Fev', tipo: 'CONTABIL', periodo: '2025-02' },
            ]);

            const janeiro = await db('bases').where({ periodo: '2025-01' }).select('*');
            expect(janeiro).toHaveLength(1);
            expect(janeiro[0].nome).toBe('Base Jan');
        });

        it('deve filtrar por subtype', async () => {
            await db('bases').insert([
                { nome: 'Base A', tipo: 'CONTABIL', subtype: 'RAZAO' },
                { nome: 'Base B', tipo: 'CONTABIL', subtype: 'BALANCETE' },
            ]);

            const razao = await db('bases').where({ subtype: 'RAZAO' }).select('*');
            expect(razao).toHaveLength(1);
        });
    });

    describe('Enriquecimento com status de ingestão', () => {
        it('deve incluir status do último job de ingestão', async () => {
            const [baseId] = await db('bases').insert({ nome: 'Base com Job', tipo: 'CONTABIL' });

            // Criar múltiplos jobs para mesma base
            await db('ingest_jobs').insert({ base_id: baseId, status: 'DONE' });
            await new Promise(r => setTimeout(r, 10));
            await db('ingest_jobs').insert({ base_id: baseId, status: 'FAILED' });

            // Buscar job mais recente
            const latestJob = await db('ingest_jobs')
                .where({ base_id: baseId })
                .orderBy('id', 'desc')
                .first();

            expect(latestJob?.status).toBe('FAILED');
        });

        it('deve identificar ingestão em progresso', async () => {
            const [baseId] = await db('bases').insert({ nome: 'Base Ingestando', tipo: 'CONTABIL' });
            await db('ingest_jobs').insert({ base_id: baseId, status: 'RUNNING' });

            const job = await db('ingest_jobs').where({ base_id: baseId }).first();
            const ingestInProgress = job?.status === 'PENDING' || job?.status === 'RUNNING';

            expect(ingestInProgress).toBe(true);
        });
    });

    describe('GET /bases/:id - detalhes', () => {
        it('deve retornar base por ID', async () => {
            const [id] = await db('bases').insert({ nome: 'Specific Base', tipo: 'FISCAL' });

            const base = await db('bases').where({ id }).first();

            expect(base).toBeDefined();
            expect(base?.nome).toBe('Specific Base');
        });

        it('deve retornar undefined para ID inexistente', async () => {
            const base = await db('bases').where({ id: 99999 }).first();
            expect(base).toBeUndefined();
        });
    });

    describe('POST /bases - criação', () => {
        it('deve criar base com campos obrigatórios', async () => {
            const [id] = await db('bases').insert({
                nome: 'Nova Base',
                tipo: 'CONTABIL',
            });

            const base = await db('bases').where({ id }).first();
            expect(base?.nome).toBe('Nova Base');
            expect(base?.tipo).toBe('CONTABIL');
        });

        it('deve criar base com campos opcionais', async () => {
            const [id] = await db('bases').insert({
                nome: 'Base Completa',
                tipo: 'FISCAL',
                periodo: '2025-01',
                subtype: 'NOTAS',
                tabela_sqlite: 'base_123',
            });

            const base = await db('bases').where({ id }).first();
            expect(base?.periodo).toBe('2025-01');
            expect(base?.subtype).toBe('NOTAS');
            expect(base?.tabela_sqlite).toBe('base_123');
        });
    });

    describe('DELETE /bases/:id', () => {
        it('deve deletar base existente', async () => {
            const [id] = await db('bases').insert({ nome: 'To Delete', tipo: 'CONTABIL' });

            await db('bases').where({ id }).del();

            const base = await db('bases').where({ id }).first();
            expect(base).toBeUndefined();
        });

        it('deve deletar colunas relacionadas', async () => {
            const [baseId] = await db('bases').insert({ nome: 'With Columns', tipo: 'CONTABIL' });
            await db('base_columns').insert([
                { base_id: baseId, excel_name: 'Col1', sqlite_name: 'col1', col_index: 0 },
                { base_id: baseId, excel_name: 'Col2', sqlite_name: 'col2', col_index: 1 },
            ]);

            // Deletar colunas primeiro (ou usar CASCADE)
            await db('base_columns').where({ base_id: baseId }).del();
            await db('bases').where({ id: baseId }).del();

            const columns = await db('base_columns').where({ base_id: baseId }).select('*');
            expect(columns).toHaveLength(0);
        });
    });
});

describe('Bases Subtypes', () => {
    let ctx: TestDbContext;
    let db: Knex;

    beforeAll(async () => {
        ctx = createTestDb();
        db = ctx.db;
        await createBaseTables(db);

        // Criar tabela base_subtypes se necessário
        const exists = await db.schema.hasTable('base_subtypes');
        if (!exists) {
            await db.schema.createTable('base_subtypes', (t) => {
                t.increments('id').primary();
                t.string('name').notNullable();
                t.string('tipo').nullable();
                t.timestamp('created_at').defaultTo(db.fn.now());
            });
        }
    });

    afterAll(async () => {
        await ctx.cleanup();
    });

    beforeEach(async () => {
        await db('base_subtypes').del();
    });

    it('deve listar subtypes', async () => {
        await db('base_subtypes').insert([
            { name: 'RAZAO', tipo: 'CONTABIL' },
            { name: 'BALANCETE', tipo: 'CONTABIL' },
            { name: 'NOTAS', tipo: 'FISCAL' },
        ]);

        const subtypes = await db('base_subtypes').select('*');
        expect(subtypes).toHaveLength(3);
    });

    it('deve criar novo subtype', async () => {
        const [id] = await db('base_subtypes').insert({ name: 'NOVO_TIPO', tipo: 'CONTABIL' });

        const subtype = await db('base_subtypes').where({ id }).first();
        expect(subtype?.name).toBe('NOVO_TIPO');
    });
});
