import os from 'os';
import { createHash } from 'crypto';

/**
 * Generate a machine fingerprint based on host properties.
 * Concatenates: hostname|platform|arch|cpuModel and returns SHA-256 hex.
 */
export function getMachineFingerprint(): string {
    const hostname = os.hostname() || '';
    const platform = os.platform() || '';
    const arch = os.arch() || '';

    let cpuModel = '';
    try {
        const cpus = os.cpus();
        if (cpus && cpus.length > 0) {
            cpuModel = (cpus[0].model || '').trim();
        }
    } catch (e) {
        cpuModel = '';
    }

    const raw = `${hostname}|${platform}|${arch}|${cpuModel}`;
    const hash = createHash('sha256').update(raw, 'utf8').digest('hex');
    return hash;
}

/* Example usage:
import { getMachineFingerprint } from './main/machineFingerprint';
console.log('machine fingerprint:', getMachineFingerprint());
*/

export default getMachineFingerprint;
