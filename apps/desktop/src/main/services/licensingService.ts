import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import getMachineFingerprint from '../machineFingerprint';
import https from 'node:https';
import { URL } from 'node:url';

/* Constants */
const DEFAULT_DB_FILENAME = path.join(process.cwd(), 'storage', 'db', 'dev.sqlite3');
const NEXT_VALIDATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const OFFLINE_GRACE_DAYS = 30 + 7; // 37 days
const ONLINE_VALIDATION_ENDPOINT = '/licenses/validate';
const ACTIVATE_ENDPOINT = '/licenses/activate';

type LicensingStatus =
    | { status: 'not_activated' }
    | { status: 'expired'; expiresAt?: Date | null }
    | { status: 'blocked_offline'; expiresAt?: Date | null }
    | { status: string; expiresAt?: Date | null };

type LicenseRow = {
    id?: number;
    license_key?: string | null;
    activation_token?: string | null;
    machine_fingerprint?: string | null;
    status?: string | null;
    expires_at?: string | null;
    last_success_online_validation_at?: string | null;
    next_online_validation_at?: string | null;
    last_error?: string | null;
    [key: string]: any;
};

function parseDate(value: any): Date | null {
    if (value == null) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

function getApiBaseUrl(): string {
    return process.env.LICENSE_API_BASE_URL || process.env.LICENSE_SERVER_BASE_URL || '';
}

function readPackageVersion(): string {
    try {
        const pkgPath = path.resolve(process.cwd(), 'apps', 'desktop', 'package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string } | null;
            if (pkg && pkg.version) return pkg.version;
        }
    } catch {
        // ignore and fall back
    }
    return process.env.APP_VERSION || process.env.npm_package_version || '0.0.0';
}

async function postJson(url: URL, body: any, apiKey: string | undefined): Promise<any> {
    const payload = JSON.stringify(body);
    return await new Promise<any>((resolve, reject) => {
        const opts: https.RequestOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload, 'utf8'),
                'x-license-api-key': apiKey || ''
            }
        };

        const req = https.request(url, opts, (res) => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => (raw += chunk));
            res.on('end', () => {
                try {
                    const parsed = raw ? JSON.parse(raw) : {};
                    if (res.statusCode && res.statusCode >= 400) {
                        // include httpStatus to let caller decide how to handle
                        return reject({ httpStatus: res.statusCode, body: parsed });
                    }
                    resolve(parsed);
                } catch (err) {
                    reject(err);
                }
            });
        });

        req.on('error', (err) => reject(err));
        req.write(payload);
        req.end();
    });
}

export class LicensingService {
    private dbPath: string;
    private db?: Database.Database;

    constructor(dbPath?: string) {
        this.dbPath = dbPath || process.env.DB_PATH || DEFAULT_DB_FILENAME;
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    private getDb(): Database.Database {
        if (!this.db) {
            this.db = new Database(this.dbPath, { readonly: false });
        }
        return this.db;
    }

    private upsertLicense(payload: {
        licenseKey: string;
        activationToken: string;
        machineFingerprint: string;
        expiresAt?: any;
        now: Date;
        nextValidation: Date;
    }): void {
        const db = this.getDb();
        const stmt = db.prepare(`
            INSERT INTO license (id, license_key, activation_token, machine_fingerprint, status, expires_at, last_success_online_validation_at, next_online_validation_at, last_error)
            VALUES (@id, @license_key, @activation_token, @machine_fingerprint, @status, @expires_at, @last_success_online_validation_at, @next_online_validation_at, @last_error)
            ON CONFLICT(id) DO UPDATE SET
                license_key=excluded.license_key,
                activation_token=excluded.activation_token,
                machine_fingerprint=excluded.machine_fingerprint,
                status=excluded.status,
                expires_at=excluded.expires_at,
                last_success_online_validation_at=excluded.last_success_online_validation_at,
                next_online_validation_at=excluded.next_online_validation_at,
                last_error=excluded.last_error;
        `);

        stmt.run({
            id: 1,
            license_key: payload.licenseKey,
            activation_token: payload.activationToken,
            machine_fingerprint: payload.machineFingerprint,
            status: 'active',
            expires_at: payload.expiresAt,
            last_success_online_validation_at: payload.now.toISOString(),
            next_online_validation_at: payload.nextValidation.toISOString(),
            last_error: null
        });
    }

    /**
     * Activate a license by contacting the licensing server and storing the
     * activation data locally. Throws on unrecoverable errors.
     */
    async activate(licenseKey: string): Promise<void> {
        if (!licenseKey || typeof licenseKey !== 'string') throw new Error('licenseKey is required');

        const base = getApiBaseUrl();
        if (!base) throw new Error('LICENSE_API_BASE_URL not configured');

        const machineFingerprint = getMachineFingerprint();
        const appVersion = readPackageVersion();

        const url = new URL(ACTIVATE_ENDPOINT, base);
        const apiKey = process.env.LICENSE_API_SECRET;

        const resBody = await postJson(url, { licenseKey, machineFingerprint, appVersion }, apiKey);

        const activationToken = resBody.activation_token || resBody.token || resBody.activationToken || null;
        const expiresAt = resBody.expires_at || resBody.expiresAt || resBody.expires || null;

        if (!activationToken) throw new Error('Activation response missing token');

        const now = new Date();
        const nextValidation = new Date(now.getTime() + NEXT_VALIDATION_MS);

        this.upsertLicense({
            licenseKey,
            activationToken,
            machineFingerprint,
            expiresAt,
            now,
            nextValidation
        });
    }

    /**
     * Performs online validation only when required by schedule or state.
     * Errors are recorded to the `license.last_error` column; license state
     * is updated only when necessary.
     */
    async validateIfNeeded(): Promise<void> {
        const db = this.getDb();
        const row = db.prepare('SELECT * FROM license WHERE id = 1').get() as LicenseRow | undefined;
        if (!row) return; // nothing to validate

        const now = new Date();

        const expiresAt = parseDate(row.expires_at);
        if (expiresAt && expiresAt.getTime() < now.getTime()) {
            db.prepare('UPDATE license SET status = ?, last_error = ? WHERE id = 1').run('expired', null);
            return;
        }

        const nextValidation = parseDate(row.next_online_validation_at);
        if (nextValidation && nextValidation.getTime() > now.getTime()) return;

        const activationToken = row.activation_token;
        if (!activationToken) {
            db.prepare('UPDATE license SET status = ?, last_error = ? WHERE id = 1').run('blocked', 'missing activation token');
            return;
        }

        const base = getApiBaseUrl();
        if (!base) {
            // do not change license state, just record inability to validate
            db.prepare('UPDATE license SET last_error = ? WHERE id = 1').run('LICENSE_API_BASE_URL not configured');
            return;
        }

        const machineFingerprint = getMachineFingerprint();
        const url = new URL(ONLINE_VALIDATION_ENDPOINT, base);
        const apiKey = process.env.LICENSE_API_SECRET;

        try {
            const resBody = await postJson(url, { activationToken, machineFingerprint }, apiKey);

            const newToken = resBody.activation_token || resBody.token || resBody.activationToken || null;
            const newExpires = resBody.expires_at || resBody.expiresAt || resBody.expires || null;

            const nextValidationDate = new Date(now.getTime() + NEXT_VALIDATION_MS);

            db.prepare(`
                UPDATE license SET
                    activation_token = @activation_token,
                    expires_at = @expires_at,
                    last_success_online_validation_at = @last_success_online_validation_at,
                    next_online_validation_at = @next_online_validation_at,
                    status = @status,
                    last_error = @last_error
                WHERE id = 1
            `).run({
                activation_token: newToken || activationToken,
                expires_at: newExpires || row.expires_at,
                last_success_online_validation_at: now.toISOString(),
                next_online_validation_at: nextValidationDate.toISOString(),
                status: 'active',
                last_error: null
            });
        } catch (err: any) {
            // Network or server-side error handling
            if (err && err.httpStatus) {
                const body = err.body || {};
                const message = body.message || body.error || JSON.stringify(body) || `server error ${err.httpStatus}`;

                const msgLower = String(message).toLowerCase();
                const revoked = (body.code && String(body.code).toLowerCase().includes('revok')) || msgLower.includes('revok') || msgLower.includes('invalid') || msgLower.includes('expired');

                if (revoked) {
                    db.prepare('UPDATE license SET status = ?, last_error = ? WHERE id = 1').run('blocked', message);
                } else {
                    db.prepare('UPDATE license SET last_error = ? WHERE id = 1').run(message);
                }
            } else {
                const msg = err && err.message ? err.message : String(err);
                db.prepare('UPDATE license SET last_error = ? WHERE id = 1').run(msg);
            }
        }
    }

    /**
     * Reads local license state and returns a simplified status object.
     */
    async getStatus(): Promise<LicensingStatus> {
        try {
            const db = this.getDb();
            const row = db.prepare('SELECT * FROM license WHERE id = 1').get() as LicenseRow | undefined;
            if (!row) return { status: 'not_activated' };

            const now = new Date();
            const expiresAt = parseDate(row.expires_at);
            const lastSuccess = parseDate(row.last_success_online_validation_at);

            if (expiresAt && expiresAt.getTime() < now.getTime()) return { status: 'expired', expiresAt };
            if (!lastSuccess) return { status: 'blocked_offline', expiresAt: expiresAt || null };

            const allowedUntil = new Date(lastSuccess.getTime() + OFFLINE_GRACE_DAYS * 24 * 60 * 60 * 1000);
            if (allowedUntil.getTime() < now.getTime()) return { status: 'blocked_offline', expiresAt: expiresAt || null };

            return { status: row.status || 'active', expiresAt: expiresAt || null };
        } catch (err) {
            return { status: 'not_activated' };
        }
    }
}

export function createLicensingService(dbPath?: string): LicensingService {
    return new LicensingService(dbPath);
}
