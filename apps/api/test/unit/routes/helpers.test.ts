/**
 * Testes unitários para funções auxiliares de rotas
 */
import { describe, it, expect } from 'vitest';

describe('Route Helper Functions', () => {
    describe('parsePagination', () => {
        const DEFAULT_PAGE_SIZE = 20;
        const MAX_PAGE_SIZE = 100;

        function parsePagination(query: { page?: string; pageSize?: string; limit?: string }) {
            const page = Math.max(1, Number(query.page) || 1);
            const requestedSize = Number(query.pageSize || query.limit) || DEFAULT_PAGE_SIZE;
            const pageSize = Math.min(MAX_PAGE_SIZE, requestedSize || DEFAULT_PAGE_SIZE);
            return { page, pageSize };
        }

        it('deve usar valores padrão quando não especificados', () => {
            const result = parsePagination({});
            expect(result.page).toBe(1);
            expect(result.pageSize).toBe(20);
        });

        it('deve aceitar page válido', () => {
            const result = parsePagination({ page: '5' });
            expect(result.page).toBe(5);
        });

        it('deve usar 1 para page <= 0', () => {
            expect(parsePagination({ page: '0' }).page).toBe(1);
            expect(parsePagination({ page: '-1' }).page).toBe(1);
        });

        it('deve aceitar pageSize válido', () => {
            const result = parsePagination({ pageSize: '50' });
            expect(result.pageSize).toBe(50);
        });

        it('deve limitar pageSize ao máximo', () => {
            const result = parsePagination({ pageSize: '200' });
            expect(result.pageSize).toBe(100);
        });

        it('deve usar default para pageSize 0', () => {
            const result = parsePagination({ pageSize: '0' });
            expect(result.pageSize).toBe(20);
        });

        it('deve aceitar limit como alternativa a pageSize', () => {
            const result = parsePagination({ limit: '30' });
            expect(result.pageSize).toBe(30);
        });

        it('deve preferir pageSize sobre limit', () => {
            const result = parsePagination({ pageSize: '25', limit: '30' });
            expect(result.pageSize).toBe(25);
        });
    });

    describe('parseIdParam', () => {
        function parseIdParam(params: { id?: string }): { ok: boolean; id?: number; error?: string } {
            const id = Number(params.id);
            if (Number.isNaN(id) || id <= 0) return { ok: false, error: 'Invalid id' };
            return { ok: true, id };
        }

        it('deve aceitar ID numérico válido', () => {
            const result = parseIdParam({ id: '123' });
            expect(result.ok).toBe(true);
            expect(result.id).toBe(123);
        });

        it('deve rejeitar ID inválido (string)', () => {
            const result = parseIdParam({ id: 'abc' });
            expect(result.ok).toBe(false);
            expect(result.error).toBe('Invalid id');
        });

        it('deve rejeitar ID negativo', () => {
            const result = parseIdParam({ id: '-1' });
            expect(result.ok).toBe(false);
        });

        it('deve rejeitar ID zero', () => {
            const result = parseIdParam({ id: '0' });
            expect(result.ok).toBe(false);
        });

        it('deve rejeitar ID undefined', () => {
            const result = parseIdParam({});
            expect(result.ok).toBe(false);
        });
    });

    describe('forceArray', () => {
        function forceArray<T = string>(value: T | T[] | undefined | null): T[] {
            if (value === undefined || value === null) return [];
            return Array.isArray(value) ? value : [value];
        }

        it('deve retornar array vazio para undefined', () => {
            expect(forceArray(undefined)).toEqual([]);
        });

        it('deve retornar array vazio para null', () => {
            expect(forceArray(null)).toEqual([]);
        });

        it('deve manter array existente', () => {
            expect(forceArray(['a', 'b'])).toEqual(['a', 'b']);
        });

        it('deve converter valor único para array', () => {
            expect(forceArray('single')).toEqual(['single']);
        });

        it('deve funcionar com números', () => {
            expect(forceArray(42)).toEqual([42]);
        });
    });

    describe('pickValue', () => {
        function pickValue<T = any>(list: T[], index: number): T | undefined {
            if (!list.length) return undefined;
            if (list.length === 1) return list[0];
            return list[index];
        }

        it('deve retornar undefined para lista vazia', () => {
            expect(pickValue([], 0)).toBeUndefined();
        });

        it('deve retornar único elemento independente do índice', () => {
            expect(pickValue(['single'], 0)).toBe('single');
            expect(pickValue(['single'], 5)).toBe('single');
        });

        it('deve retornar elemento pelo índice', () => {
            expect(pickValue(['a', 'b', 'c'], 0)).toBe('a');
            expect(pickValue(['a', 'b', 'c'], 1)).toBe('b');
            expect(pickValue(['a', 'b', 'c'], 2)).toBe('c');
        });

        it('deve retornar undefined para índice fora do range', () => {
            expect(pickValue(['a', 'b'], 5)).toBeUndefined();
        });
    });

    describe('safeJsonParse', () => {
        function safeJsonParse(input: any) {
            try {
                return JSON.parse(input);
            } catch {
                return input;
            }
        }

        it('deve parsear JSON válido', () => {
            expect(safeJsonParse('{"key": "value"}')).toEqual({ key: 'value' });
        });

        it('deve parsear array JSON', () => {
            expect(safeJsonParse('[1, 2, 3]')).toEqual([1, 2, 3]);
        });

        it('deve retornar input para JSON inválido', () => {
            expect(safeJsonParse('not json')).toBe('not json');
        });

        it('deve retornar input para objetos não-string', () => {
            const obj = { key: 'value' };
            expect(safeJsonParse(obj)).toBe(obj);
        });
    });
});

describe('Route Response Formatting', () => {
    describe('Pagination Response', () => {
        it('deve formatar resposta paginada corretamente', () => {
            const data = [{ id: 1 }, { id: 2 }];
            const page = 1;
            const pageSize = 20;
            const total = 100;
            const totalPages = Math.max(1, Math.ceil(total / pageSize));

            const response = { data, page, pageSize, total, totalPages };

            expect(response.data).toHaveLength(2);
            expect(response.page).toBe(1);
            expect(response.pageSize).toBe(20);
            expect(response.total).toBe(100);
            expect(response.totalPages).toBe(5);
        });

        it('deve calcular totalPages corretamente', () => {
            const calculateTotalPages = (total: number, pageSize: number) =>
                Math.max(1, Math.ceil(total / pageSize));

            expect(calculateTotalPages(0, 20)).toBe(1);
            expect(calculateTotalPages(10, 20)).toBe(1);
            expect(calculateTotalPages(20, 20)).toBe(1);
            expect(calculateTotalPages(21, 20)).toBe(2);
            expect(calculateTotalPages(100, 20)).toBe(5);
        });
    });

    describe('Error Response', () => {
        it('deve formatar resposta de erro', () => {
            const errorResponse = { error: 'Erro ao listar bases' };
            expect(errorResponse.error).toBeDefined();
        });

        it('deve incluir detalhes quando disponível', () => {
            const detailedError = { error: 'Validation failed', details: ['field1 required'] };
            expect(detailedError.details).toBeDefined();
        });
    });
});
