import { Router, Request, Response } from 'express';
import LicensingService from '../services/licensingService';
import db from '../db/knex';
import os from 'os';
import { createHash } from 'crypto';
import https from 'node:https';
import { URL } from 'node:url';

const router = Router();

// Constants and configuration
const TABLE = 'license';
const ROW_ID = 1;
const ACTIVATION_PATH = '/api/licenses/activate';
const DEFAULT_VALIDATION_DAYS = 30;

type LicenseServerResponse = {
    activation_token?: string;
    token?: string;
    activationToken?: string;
    expires_at?: string;
    expiresAt?: string;
    expires?: string;
    [key: string]: any;
};

function computeMachineFingerprint(): string {
    const hostname = os.hostname() || '';
    const platform = os.platform() || '';
    const arch = os.arch() || '';
    let cpuModel = '';
    try {
        const cpus = os.cpus();
        if (cpus && cpus.length > 0) cpuModel = (cpus[0].model || '').trim();
    } catch (e) {
        // ignore
    }
    const raw = `${hostname}|${platform}|${arch}|${cpuModel}`;
    return createHash('sha256').update(raw, 'utf8').digest('hex');
}

function getLicenseServerBase(): string | null {
    return process.env.LICENSE_API_BASE_URL || process.env.LICENSE_SERVER_BASE_URL || null;
}

async function postJsonToLicenseServer<T = any>(url: URL, body: any, apiKey = ''): Promise<T> {
    const payload = JSON.stringify(body);

    return new Promise<T>((resolve, reject) => {
        const opts: https.RequestOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload, 'utf8'),
                'x-license-api-key': apiKey || ''
            }
        };

        const req = https.request(url, opts, (resp) => {
            let raw = '';
            resp.setEncoding('utf8');
            resp.on('data', (chunk) => (raw += chunk));
            resp.on('end', () => {
                try {
                    const parsed = raw ? JSON.parse(raw) : {};
                    if (resp.statusCode && resp.statusCode >= 400) {
                        const message = parsed && (parsed.message || parsed.error || parsed.detail) ? (parsed.message || parsed.error || parsed.detail) : `License server error (${resp.statusCode})`;
                        return reject(new Error(message));
                    }
                    return resolve(parsed as T);
                } catch (err) {
                    return reject(err);
                }
            });
        });

        req.on('error', (err) => reject(err));
        req.write(payload);
        req.end();
    });
}

async function upsertLicenseRecord(data: {
    licenseKey: string;
    activationToken: string;
    machineFingerprint: string;
    expiresAt?: string | null;
}) {
    const now = new Date();
    const nextValidation = new Date(now.getTime() + DEFAULT_VALIDATION_DAYS * 24 * 60 * 60 * 1000);

    await db(TABLE)
        .insert({
            id: ROW_ID,
            license_key: data.licenseKey,
            activation_token: data.activationToken,
            machine_fingerprint: data.machineFingerprint,
            status: 'active',
            expires_at: data.expiresAt || now.toISOString(),
            last_success_online_validation_at: now.toISOString(),
            next_online_validation_at: nextValidation.toISOString(),
            last_error: null
        })
        .onConflict('id')
        .merge({
            license_key: data.licenseKey,
            activation_token: data.activationToken,
            machine_fingerprint: data.machineFingerprint,
            status: 'active',
            expires_at: data.expiresAt || now.toISOString(),
            last_success_online_validation_at: now.toISOString(),
            next_online_validation_at: nextValidation.toISOString(),
            last_error: null
        });
}

// GET /api/license/status
router.get('/status', async (_req: Request, res: Response) => {
    try {
        const status = await LicensingService.getStatus();
        return res.json(status);
    } catch (err) {
        console.error('GET /api/license/status error', err);
        return res.status(500).json({ error: 'internal_error' });
    }
});

// POST /api/license/activate
router.post('/activate', async (req: Request, res: Response) => {
    try {
        const licenseKey = req.body?.licenseKey;
        if (!licenseKey || typeof licenseKey !== 'string') return res.status(400).json({ error: 'missing_license_key' });

        const base = getLicenseServerBase();
        if (!base) return res.status(500).json({ error: 'LICENSE_API_BASE_URL not configured' });

        const machineFingerprint = computeMachineFingerprint();
        const appVersion = process.env.APP_VERSION || process.env.npm_package_version || '0.0.0';

        const url = new URL(ACTIVATION_PATH, base);
        const apiKey = process.env.LICENSE_API_SECRET || '';

        const response = (await postJsonToLicenseServer<LicenseServerResponse>(url, { licenseKey, machineFingerprint, appVersion }, apiKey));

        const activationToken = response.activation_token || response.token || response.activationToken || null;
        const expiresAt = response.expires_at || response.expiresAt || response.expires || null;

        if (!activationToken) return res.status(400).json({ error: 'activation_response_missing_token' });

        await upsertLicenseRecord({ licenseKey, activationToken, machineFingerprint, expiresAt });

        return res.json({ success: true });
    } catch (err: any) {
        console.error('POST /api/license/activate error', err?.message || err);
        return res.status(400).json({ error: err?.message || 'internal_error' });
    }
});

export default router;
