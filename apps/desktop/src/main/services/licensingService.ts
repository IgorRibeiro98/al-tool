import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import getMachineFingerprint from '../machineFingerprint';
import https from 'node:https';
import { URL } from 'node:url';

type LicensingStatus =
    | { status: 'not_activated' }
    | { status: 'expired'; expiresAt?: Date | null }
    | { status: 'blocked_offline'; expiresAt?: Date | null }
    | { status: string; expiresAt?: Date | null };

export class LicensingService {
    private dbPath: string;
    private db?: Database.Database;

    constructor(dbPath?: string) {
        this.dbPath = dbPath || process.env.DB_PATH || path.join(process.cwd(), 'storage', 'db', 'dev.sqlite3');
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    /**
     * Activate a license by calling the cloud licensing API and persisting
     * the returned activation data into the local `license` table (id = 1).
     * Throws an Error with the API message when activation fails.
     */
    async activate(licenseKey: string): Promise<void> {
        const machineFingerprint = getMachineFingerprint();

        const base = process.env.LICENSE_API_BASE_URL || process.env.LICENSE_SERVER_BASE_URL || '';
        if (!base) throw new Error('LICENSE_API_BASE_URL not configured');

        // determine app version (best-effort)
        let appVersion = process.env.APP_VERSION || process.env.npm_package_version || '0.0.0';
        try {
            const pkgPath = path.resolve(process.cwd(), 'apps', 'desktop', 'package.json');
            if (fs.existsSync(pkgPath)) {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                if (pkg && pkg.version) appVersion = pkg.version;
            }
        } catch (e) {
            // ignore and keep fallback
        }

        const payload = JSON.stringify({ licenseKey, machineFingerprint, appVersion });

        const url = new URL('/licenses/activate', base);

        const resBody = await new Promise<any>((resolve, reject) => {
            const opts: https.RequestOptions = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload, 'utf8'),
                    'x-license-api-key': process.env.LICENSE_API_SECRET || ''
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
                            const msg = parsed && (parsed.message || parsed.error || parsed.detail) ? (parsed.message || parsed.error || parsed.detail) : `Activation failed (${res.statusCode})`;
                            return reject(new Error(msg));
                        }
                        resolve(parsed);
                    } catch (err) {
                        return reject(err);
                    }
                });
            });

            req.on('error', (err) => reject(err));
            req.write(payload);
            req.end();
        });

        // Expect the cloud API to return an activation token and expires_at
        const activationToken = resBody.activation_token || resBody.token || resBody.activationToken || null;
        const expiresAt = resBody.expires_at || resBody.expiresAt || resBody.expires || null;

        if (!activationToken) {
            throw new Error('Activation response missing token');
        }

        const now = new Date();
        const nextValidation = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        const db = this.getDb();

        // Upsert row with id = 1
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
            license_key: licenseKey,
            activation_token: activationToken,
            machine_fingerprint: machineFingerprint,
            status: 'active',
            expires_at: expiresAt,
            last_success_online_validation_at: now.toISOString(),
            next_online_validation_at: nextValidation.toISOString(),
            last_error: null
        });
    }

    /**
     * validateIfNeeded checks whether an online validation is required and,
     * when necessary, calls the cloud /licenses/validate endpoint to refresh
     * the activation state.
     *
     * Rules implemented:
     * - If no license row exists -> do nothing.
     * - If expires_at < now -> update status = 'expired' and return.
     * - If next_online_validation_at > now -> not time to validate yet -> return.
     * - Otherwise: call POST /licenses/validate with { activation_token, machineFingerprint }.
     *
     * On successful validation response:
     * - update activation_token (if present), expires_at (if present),
     *   last_success_online_validation_at = now, next_online_validation_at = now + 30 days,
     *   status = 'active', last_error = NULL.
     *
     * On server-side validation error that indicates revocation/invalid license:
     * - update status = 'blocked' and last_error with the reason.
     *
     * On network/transport error:
     * - keep status unchanged, update last_error with the error message.
     */
    async validateIfNeeded(): Promise<void> {
        const db = this.getDb();
        const row = db.prepare('SELECT * FROM license WHERE id = 1').get() as { [key: string]: any };

        // If there's no license configured locally, nothing to validate
        if (!row) return;

        const now = new Date();

        const parseDate = (v: any): Date | null => {
            if (v == null) return null;
            const d = new Date(v);
            return Number.isNaN(d.getTime()) ? null : d;
        };

        const expiresAt = parseDate(row.expires_at);
        const nextValidation = parseDate(row.next_online_validation_at);

        // If license already expired by date, mark as expired and stop
        if (expiresAt && expiresAt.getTime() < now.getTime()) {
            const upd = db.prepare('UPDATE license SET status = ?, last_error = ? WHERE id = 1');
            upd.run('expired', null);
            return;
        }

        // If next online validation is in the future, no need to validate now
        if (nextValidation && nextValidation.getTime() > now.getTime()) {
            return;
        }

        // Need to validate with the licensing server
        const activationToken = row.activation_token;
        if (!activationToken) {
            // No token to validate against; mark blocked with explanatory error
            const upd = db.prepare('UPDATE license SET status = ?, last_error = ? WHERE id = 1');
            upd.run('blocked', 'missing activation token');
            return;
        }

        const machineFingerprint = getMachineFingerprint();
        const base = process.env.LICENSE_API_BASE_URL || process.env.LICENSE_SERVER_BASE_URL || '';
        if (!base) {
            // Cannot contact server; record error but do not change license state
            const upd = db.prepare('UPDATE license SET last_error = ? WHERE id = 1');
            upd.run('LICENSE_API_BASE_URL not configured');
            return;
        }

        const payload = JSON.stringify({ activationToken, machineFingerprint });
        const url = new URL('/licenses/validate', base);

        try {
            const resBody = await new Promise<any>((resolve, reject) => {
                const opts: https.RequestOptions = {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(payload, 'utf8'),
                        'x-license-api-key': process.env.LICENSE_API_SECRET || ''
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
                                // Treat server error as validation failure
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

            // On success, update local row with server-provided values
            const newToken = resBody.activation_token || resBody.token || resBody.activationToken || null;
            const newExpires = resBody.expires_at || resBody.expiresAt || resBody.expires || null;

            const nextValidationDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

            const updateStmt = db.prepare(`
        UPDATE license SET
          activation_token = @activation_token,
          expires_at = @expires_at,
          last_success_online_validation_at = @last_success_online_validation_at,
          next_online_validation_at = @next_online_validation_at,
          status = @status,
          last_error = @last_error
        WHERE id = 1
      `);

            updateStmt.run({
                activation_token: newToken || activationToken,
                expires_at: newExpires || row.expires_at,
                last_success_online_validation_at: now.toISOString(),
                next_online_validation_at: nextValidationDate.toISOString(),
                status: 'active',
                last_error: null
            });
        } catch (err: any) {
            // err can be network error or the object we rejected with above
            if (err && err.httpStatus) {
                // Server responded with >=400; interpret body to decide whether license is revoked
                const body = err.body || {};
                const message = body.message || body.error || JSON.stringify(body) || `server error ${err.httpStatus}`;

                // If server indicates license revoked/invalid, mark blocked; otherwise record last_error
                const revoked = (body.code && String(body.code).toLowerCase().includes('revok')) ||
                    (String(message).toLowerCase().includes('revok')) ||
                    (String(message).toLowerCase().includes('invalid')) ||
                    (String(message).toLowerCase().includes('expired'));

                if (revoked) {
                    const upd = db.prepare('UPDATE license SET status = ?, last_error = ? WHERE id = 1');
                    upd.run('blocked', message);
                } else {
                    const upd = db.prepare('UPDATE license SET last_error = ? WHERE id = 1');
                    upd.run(message);
                }
            } else {
                // Network/other error: set last_error but do not change status
                const msg = err && err.message ? err.message : String(err);
                const upd = db.prepare('UPDATE license SET last_error = ? WHERE id = 1');
                upd.run(msg);
            }
        }
    }

    private getDb(): Database.Database {
        if (!this.db) {
            this.db = new Database(this.dbPath, { readonly: false });
        }
        return this.db;
    }

    /**
     * getStatus reads the single-row `license` table (id = 1) and returns a
     * small status object according to the rules:
     * - if no row: { status: 'not_activated' }
     * - parse expires_at and last_success_online_validation_at
     * - allowedUntil = last_success_online_validation_at + 37 days (30 + 7)
     * - if expires_at < now => 'expired'
     * - else if allowedUntil < now => 'blocked_offline'
     * - otherwise keep stored status
     */
    async getStatus(): Promise<LicensingStatus> {
        try {
            const db = this.getDb();
            const row = db.prepare('SELECT * FROM license WHERE id = 1').get() as {
                expires_at?: string | null;
                last_success_online_validation_at?: string | null;
                status?: string | null;
            } | undefined;

            if (!row) {
                return { status: 'not_activated' };
            }

            const now = new Date();

            const parseDate = (v: any): Date | null => {
                if (v == null) return null;
                const d = new Date(v);
                return Number.isNaN(d.getTime()) ? null : d;
            };

            const expiresAt = parseDate(row.expires_at);
            const lastSuccess = parseDate(row.last_success_online_validation_at);

            // 30 + 7 days grace for offline usage => 37 days
            const GRACE_DAYS = 30 + 7;

            if (expiresAt && expiresAt.getTime() < now.getTime()) {
                return { status: 'expired', expiresAt };
            }

            if (!lastSuccess) {
                // No successful online validation recorded -> treat as blocked offline
                return { status: 'blocked_offline', expiresAt: expiresAt || null };
            }

            const allowedUntil = new Date(lastSuccess.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);
            if (allowedUntil.getTime() < now.getTime()) {
                return { status: 'blocked_offline', expiresAt: expiresAt || null };
            }

            // Otherwise preserve stored status (expected 'active')
            return { status: row.status || 'active', expiresAt: expiresAt || null };
        } catch (err) {
            // In case of unexpected DB errors, surface a conservative status
            return { status: 'not_activated' };
        }
    }
}

export function createLicensingService(dbPath?: string): LicensingService {
    return new LicensingService(dbPath);
}
