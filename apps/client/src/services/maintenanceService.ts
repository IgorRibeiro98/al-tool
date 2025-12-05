import api from './api';

export function maintenanceCleanup() {
    return api.post('/maintenance/cleanup');
}

export function maintenanceCleanupResults() {
    return api.post('/maintenance/cleanup-results');
}

export function maintenanceCleanupStorage() {
    return api.post('/maintenance/cleanup/storage');
}
