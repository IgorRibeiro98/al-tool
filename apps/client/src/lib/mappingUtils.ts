export type MappingState = Record<string, string | null>;

export function buildMappingState(
    baseAColumns: BaseColumn[],
    baseBColumns: BaseColumn[],
    existingPairs?: Array<{ coluna_contabil: string; coluna_fiscal: string }>
): MappingState {
    const existingMap = new Map<string, string>();
    (existingPairs || []).forEach((pair) => {
        if (pair && pair.coluna_contabil && pair.coluna_fiscal) {
            existingMap.set(pair.coluna_contabil, pair.coluna_fiscal);
        }
    });

    const baseBSet = new Set(baseBColumns.map((col) => col.sqlite_name));
    const state: MappingState = {};

    baseAColumns.forEach((col) => {
        if (!col || !col.sqlite_name) return;
        if (existingMap.has(col.sqlite_name)) {
            state[col.sqlite_name] = existingMap.get(col.sqlite_name)!;
        } else if (baseBSet.has(col.sqlite_name)) {
            state[col.sqlite_name] = col.sqlite_name;
        } else {
            state[col.sqlite_name] = null;
        }
    });

    return state;
}

export function serializeMappingState(state: MappingState): Array<{ coluna_contabil: string; coluna_fiscal: string }> {
    return Object.entries(state)
        .filter(([, target]) => typeof target === 'string' && target.length > 0)
        .map(([source, target]) => ({ coluna_contabil: source, coluna_fiscal: target as string }));
}
