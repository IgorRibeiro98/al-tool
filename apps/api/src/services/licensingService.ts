import db from '../db/knex';

type LicensingStatus =
    | { status: 'not_activated' }
    | { status: 'expired'; expiresAt?: Date | null }
    | { status: 'blocked_offline'; expiresAt?: Date | null }
    | { status: string; expiresAt?: Date | null };

class LicensingService {
    async getStatus(): Promise<LicensingStatus> {
        try {
            const row = await db('license').where({ id: 1 }).first();
            if (!row) return { status: 'not_activated' };

            const now = new Date();
            const parseDate = (v: any): Date | null => {
                if (v == null) return null;
                const d = new Date(v);
                return Number.isNaN(d.getTime()) ? null : d;
            };

            const expiresAt = parseDate(row.expires_at);
            const lastSuccess = parseDate(row.last_success_online_validation_at);

            const GRACE_DAYS = 30 + 7; // 37 days

            if (expiresAt && expiresAt.getTime() < now.getTime()) {
                return { status: 'expired', expiresAt };
            }

            if (!lastSuccess) {
                return { status: 'blocked_offline', expiresAt: expiresAt || null };
            }

            const allowedUntil = new Date(lastSuccess.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);
            if (allowedUntil.getTime() < now.getTime()) {
                return { status: 'blocked_offline', expiresAt: expiresAt || null };
            }

            return { status: row.status || 'active', expiresAt: expiresAt || null };
        } catch (err) {
            console.error('LicensingService.getStatus error', err);
            return { status: 'not_activated' };
        }
    }
}

export default new LicensingService();
