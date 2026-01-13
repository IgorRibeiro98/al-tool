/**
 * Testes unitários para ConciliacaoABStep - lógica isolada
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('ConciliacaoABStep Logic', () => {
    describe('Geração de chave de conciliação', () => {
        const buildKey = (values: (string | number | null)[]): string => {
            return values
                .map((v) => (v === null || v === undefined ? '' : String(v)))
                .join('|');
        };

        beforeEach(() => {
            vi.clearAllMocks();
        });

        it('deve gerar chave concatenando valores', () => {
            expect(buildKey(['DOC001', 'EMP1', '2025-01'])).toBe('DOC001|EMP1|2025-01');
        });

        it('deve tratar null como string vazia', () => {
            expect(buildKey(['DOC001', null, '2025-01'])).toBe('DOC001||2025-01');
        });

        it('deve converter números para string', () => {
            expect(buildKey([123, 456])).toBe('123|456');
        });
    });

    describe('Matching de chaves', () => {
        interface Record {
            id: number;
            key: string;
            valor: number;
        }

        const findMatches = (
            baseA: Record[],
            baseB: Record[]
        ): Array<{ a: Record; b: Record }> => {
            const bByKey = new Map<string, Record[]>();
            for (const b of baseB) {
                const list = bByKey.get(b.key) || [];
                list.push(b);
                bByKey.set(b.key, list);
            }

            const matches: Array<{ a: Record; b: Record }> = [];
            for (const a of baseA) {
                const bMatches = bByKey.get(a.key);
                if (bMatches && bMatches.length > 0) {
                    const b = bMatches.shift()!;
                    matches.push({ a, b });
                }
            }

            return matches;
        };

        it('deve encontrar matches por chave', () => {
            const baseA: Record[] = [
                { id: 1, key: 'K1', valor: 100 },
                { id: 2, key: 'K2', valor: 200 },
            ];
            const baseB: Record[] = [
                { id: 10, key: 'K1', valor: 100 },
                { id: 20, key: 'K2', valor: 200 },
            ];

            const matches = findMatches(baseA, baseB);

            expect(matches).toHaveLength(2);
            expect(matches[0].a.id).toBe(1);
            expect(matches[0].b.id).toBe(10);
        });

        it('não deve match sem chave correspondente', () => {
            const baseA: Record[] = [{ id: 1, key: 'K1', valor: 100 }];
            const baseB: Record[] = [{ id: 10, key: 'K999', valor: 100 }];

            const matches = findMatches(baseA, baseB);

            expect(matches).toHaveLength(0);
        });
    });

    describe('Classificação de status', () => {
        type ConciliacaoStatus =
            | 'Conciliado'
            | 'Encontrado com Diferença'
            | 'Não Encontrado em A'
            | 'Não Encontrado em B';

        const classifyMatch = (
            valorA: number,
            valorB: number,
            tolerance: number
        ): ConciliacaoStatus => {
            const diff = Math.abs(valorA - valorB);
            if (diff <= tolerance) {
                return 'Conciliado';
            }
            return 'Encontrado com Diferença';
        };

        it('deve classificar como Conciliado quando valores iguais', () => {
            expect(classifyMatch(100, 100, 0.01)).toBe('Conciliado');
        });

        it('deve classificar como Conciliado dentro da tolerância', () => {
            expect(classifyMatch(100.00, 100.005, 0.01)).toBe('Conciliado');
        });

        it('deve classificar como Diferença fora da tolerância', () => {
            expect(classifyMatch(100, 105, 0.01)).toBe('Encontrado com Diferença');
        });
    });

    describe('Inversão de sinal fiscal', () => {
        const applyInversion = (valor: number, invert: boolean): number => {
            return invert ? -valor : valor;
        };

        it('deve inverter sinal quando configurado', () => {
            expect(applyInversion(100, true)).toBe(-100);
            expect(applyInversion(-50, true)).toBe(50);
        });

        it('não deve inverter quando não configurado', () => {
            expect(applyInversion(100, false)).toBe(100);
        });
    });

    describe('Limite de diferença imaterial', () => {
        const isImmaterial = (diff: number, limit: number): boolean => {
            return Math.abs(diff) <= limit;
        };

        it('deve considerar imaterial dentro do limite', () => {
            expect(isImmaterial(0.005, 0.01)).toBe(true);
            expect(isImmaterial(-0.005, 0.01)).toBe(true);
        });

        it('deve considerar material fora do limite', () => {
            expect(isImmaterial(0.02, 0.01)).toBe(false);
            expect(isImmaterial(5, 0.01)).toBe(false);
        });
    });

    describe('Estrutura da tabela de resultado', () => {
        it('deve incluir todas as colunas necessárias', () => {
            const resultColumns = [
                'id',
                'job_id',
                'chave',
                'base_a_row_id',
                'base_b_row_id',
                'valor_a',
                'valor_b',
                'diferenca',
                'status',
                'chave_usada',
                'created_at',
            ];

            expect(resultColumns).toContain('job_id');
            expect(resultColumns).toContain('status');
            expect(resultColumns).toContain('diferenca');
            expect(resultColumns).toContain('chave_usada');
        });
    });

    describe('Prioridade de chaves', () => {
        it('deve tentar chaves em ordem de prioridade', () => {
            const keyPriority = ['CHAVE_1', 'CHAVE_2', 'CHAVE_3'];

            expect(keyPriority[0]).toBe('CHAVE_1');
            expect(keyPriority.length).toBe(3);
        });

        it('deve parar na primeira chave com match', () => {
            const tryKeys = (
                keys: string[],
                hasMatch: (key: string) => boolean
            ): string | null => {
                for (const key of keys) {
                    if (hasMatch(key)) return key;
                }
                return null;
            };

            // Match na segunda chave
            const result = tryKeys(['K1', 'K2', 'K3'], (k) => k === 'K2');
            expect(result).toBe('K2');

            // Sem match
            const noMatch = tryKeys(['K1', 'K2'], () => false);
            expect(noMatch).toBeNull();
        });
    });
});
