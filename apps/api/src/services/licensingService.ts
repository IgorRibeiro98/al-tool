import db from '../db/knex';

type LicensingStatusNotActivated = { status: 'not_activated' };
type LicensingStatusExpired = { status: 'expired'; expiresAt: Date | null };
type LicensingStatusBlockedOffline = { status: 'blocked_offline'; expiresAt: Date | null };
type LicensingStatusActive = { status: string; expiresAt: Date | null };

export type LicensingStatus = LicensingStatusNotActivated | LicensingStatusExpired | LicensingStatusBlockedOffline | LicensingStatusActive;

type LicenseRow = {
    id?: number;
    status?: string | null;
    expires_at?: string | Date | null;
    last_success_online_validation_at?: string | Date | null;
};

class LicensingService {
    private static readonly OFFLINE_GRACE_DAYS = 37; // days allowed after last successful online validation
    private static readonly MS_PER_DAY = 24 * 60 * 60 * 1000;

    private parseDate(value: unknown): Date | null {
        if (value == null) return null;
        const d = new Date(value as any);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    private async fetchLicenseRow(): Promise<LicenseRow | null> {
        const row = await db<LicenseRow>('license').where({ id: 1 }).first();
        return row || null;
    }

    public async getStatus(): Promise<LicensingStatus> {
        try {
            const row = await this.fetchLicenseRow();
            if (!row) return { status: 'not_activated' };

            const now = new Date();
            const expiresAt = this.parseDate(row.expires_at);
            const lastSuccess = this.parseDate(row.last_success_online_validation_at);

            // If expiry date is present and in the past -> expired
            if (expiresAt && expiresAt.getTime() < now.getTime()) return { status: 'expired', expiresAt };

            // If we never had a successful online validation -> blocked offline
            if (!lastSuccess) return { status: 'blocked_offline', expiresAt: expiresAt || null };

            const allowedUntil = new Date(lastSuccess.getTime() + LicensingService.OFFLINE_GRACE_DAYS * LicensingService.MS_PER_DAY);
            if (allowedUntil.getTime() < now.getTime()) return { status: 'blocked_offline', expiresAt: expiresAt || null };

            const effectiveStatus = typeof row.status === 'string' && row.status ? row.status : 'active';
            return { status: effectiveStatus, expiresAt: expiresAt || null };
        } catch (err) {
            // Standardized error logging
            // eslint-disable-next-line no-console
            console.error('[LicensingService] getStatus error:', err);
            return { status: 'not_activated' };
        }
    }
}

export default new LicensingService();
