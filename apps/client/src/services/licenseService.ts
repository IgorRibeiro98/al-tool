import api from '@/services/api';

export function fetchLicenseStatus(params?: Record<string, any>) {
    return api.get('/license/status', { params });
}

export function activateLicense(licenseKey: string) {
    return api.post('/license/activate', { licenseKey });
}

export default { fetchLicenseStatus, activateLicense };