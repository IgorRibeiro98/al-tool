import express from 'express';
import LicensingService from '../services/licensingService';
import db from '../db/knex';
import os from 'os';
import { createHash } from 'crypto';
import https from 'node:https';
import { URL } from 'node:url';

const router = express.Router();

// GET /api/license/status
router.get('/status', async (_req, res) => {
    try {
        const status = await LicensingService.getStatus();
        res.json(status);
    } catch (err) {
        console.error('Error on GET /api/license/status', err);
        res.status(400).json({ error: 'internal_error' });
    }
});


// POST /api/license/activate
router.post('/activate', async (req, res) => {
    try {
        const { licenseKey } = req.body || {};
        if (!licenseKey || typeof licenseKey !== 'string') {
            return res.status(400).json({ error: 'missing_license_key' });
        }

        // compute a machine fingerprint similar to the desktop util
        const hostname = os.hostname() || '';
        const platform = os.platform() || '';
        const arch = os.arch() || '';
        let cpuModel = '';
        try {
            const cpus = os.cpus();
            if (cpus && cpus.length > 0) cpuModel = (cpus[0].model || '').trim();
        } catch (e) {
            cpuModel = '';
        }
        const raw = `${hostname}|${platform}|${arch}|${cpuModel}`;
        const machineFingerprint = createHash('sha256').update(raw, 'utf8').digest('hex');

        const base = process.env.LICENSE_API_BASE_URL || process.env.LICENSE_SERVER_BASE_URL || '';
        if (!base) return res.status(400).json({ error: 'LICENSE_API_BASE_URL not configured' });

        const appVersion = process.env.APP_VERSION || process.env.npm_package_version || '0.0.0';
        const payload = JSON.stringify({ licenseKey, machineFingerprint, appVersion });
        const url = new URL('/api/licenses/activate', base);

        const resBody = await new Promise<any>((resolve, reject) => {
            const opts: https.RequestOptions = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload, 'utf8'),
                    'x-license-api-key': process.env.LICENSE_API_SECRET || ''
                }
            };

            const reqp = https.request(url, opts, (resp) => {
                let raw = '';
                resp.setEncoding('utf8');
                resp.on('data', (chunk) => (raw += chunk));
                resp.on('end', () => {
                    try {
                        const parsed = raw ? JSON.parse(raw) : {};
                        if (resp.statusCode && resp.statusCode >= 400) {
                            const msg = parsed && (parsed.message || parsed.error || parsed.detail) ? (parsed.message || parsed.error || parsed.detail) : `Activation failed (${resp.statusCode})`;
                            return reject(new Error(msg));
                        }
                        resolve(parsed);
                    } catch (err) {
                        reject(err);
                    }
                });
            });

            reqp.on('error', (err) => reject(err));
            reqp.write(payload);
            reqp.end();
        });

        const activationToken = resBody.activation_token || resBody.token || resBody.activationToken || null;
        const expiresAt = resBody.expires_at || resBody.expiresAt || resBody.expires || null;

        if (!activationToken) return res.status(400).json({ error: 'activation_response_missing_token' });

        const now = new Date();
        const nextValidation = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        // Upsert into license table with id = 1
        await db('license').insert({
            id: 1,
            license_key: licenseKey,
            activation_token: activationToken,
            machine_fingerprint: machineFingerprint,
            status: 'active',
            expires_at: expiresAt || now.toISOString(),
            last_success_online_validation_at: now.toISOString(),
            next_online_validation_at: nextValidation.toISOString(),
            last_error: null
        }).onConflict('id').merge({
            license_key: licenseKey,
            activation_token: activationToken,
            machine_fingerprint: machineFingerprint,
            status: 'active',
            expires_at: expiresAt || now.toISOString(),
            last_success_online_validation_at: now.toISOString(),
            next_online_validation_at: nextValidation.toISOString(),
            last_error: null
        });

        return res.json({ success: true });
    } catch (err: any) {
        console.error('Error on POST /api/license/activate', err);
        return res.status(400).json({ error: err?.message || 'internal_error' });
    }
});


export default router;
