export type MappingState = Record<string, string | null>;

const MIN_FILENAME_LENGTH = 1;

function toArray<T>(value?: T[] | null): T[] {
    return Array.isArray(value) ? value : [];
}

function getColumnName(col?: BaseColumn | null): string | undefined {
    const name = col?.sqlite_name;
    if (!name) return undefined;
    const trimmed = String(name).trim();
    return trimmed.length >= MIN_FILENAME_LENGTH ? trimmed : undefined;
}

function buildExistingMap(
    existingPairs?: Array<{ coluna_contabil: string; coluna_fiscal: string }>
): Map<string, string> {
    const map = new Map<string, string>();
    for (const pair of toArray(existingPairs)) {
        if (!pair) continue;
        const source = pair.coluna_contabil && String(pair.coluna_contabil).trim();
        const target = pair.coluna_fiscal && String(pair.coluna_fiscal).trim();
        if (source && target) map.set(source, target);
    }
    return map;
}

function buildNameSet(columns?: BaseColumn[] | null): Set<string> {
    const set = new Set<string>();
    for (const col of toArray(columns)) {
        const name = getColumnName(col);
        if (name) set.add(name);
    }
    return set;
}

export function buildMappingState(
    baseAColumns?: BaseColumn[] | null,
    baseBColumns?: BaseColumn[] | null,
    existingPairs?: Array<{ coluna_contabil: string; coluna_fiscal: string }>
): MappingState {
    const state: MappingState = {};

    const aCols = toArray(baseAColumns);
    if (aCols.length === 0) return state;

    const existingMap = buildExistingMap(existingPairs);
    const baseBSet = buildNameSet(baseBColumns);

    for (const col of aCols) {
        const sourceName = getColumnName(col);
        if (!sourceName) continue;

        if (existingMap.has(sourceName)) {
            state[sourceName] = existingMap.get(sourceName)!;
            continue;
        }

        if (baseBSet.has(sourceName)) {
            state[sourceName] = sourceName;
            continue;
        }

        state[sourceName] = null;
    }

    return state;
}

export function serializeMappingState(
    state: MappingState
): Array<{ coluna_contabil: string; coluna_fiscal: string }> {
    const result: Array<{ coluna_contabil: string; coluna_fiscal: string }> = [];
    for (const [source, target] of Object.entries(state || {})) {
        if (typeof target === 'string' && target.trim().length >= MIN_FILENAME_LENGTH) {
            result.push({ coluna_contabil: source, coluna_fiscal: target });
        }
    }
    return result;
}
