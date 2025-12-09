import os from 'os';
import { createHash } from 'crypto';

const HASH_ALGORITHM = 'sha256';

function safeString(value?: string | null): string {
    return (value ?? '').trim();
}

function getPrimaryCpuModel(): string {
    try {
        const cpus = os.cpus();
        if (Array.isArray(cpus) && cpus.length > 0) {
            return safeString(cpus[0].model);
        }
    } catch {
        // Best-effort: if os.cpus() fails, return empty string
    }
    return '';
}

function computeHash(input: string): string {
    return createHash(HASH_ALGORITHM).update(input, 'utf8').digest('hex');
}

/**
 * Returns a stable machine fingerprint string for the current host.
 * The fingerprint is a SHA-256 hash of selected host properties joined by '|'.
 */
export function getMachineFingerprint(): string {
    const parts = [os.hostname(), os.platform(), os.arch(), getPrimaryCpuModel()].map(safeString);
    const raw = parts.join('|');
    return computeHash(raw);
}

export default getMachineFingerprint;
