/**
 * Performance Configuration Module
 * 
 * Centralized performance configuration that dynamically adjusts based on
 * available hardware resources. Optimized for target spec:
 * - 8GB RAM
 * - Intel i5 8th Gen (4 cores / 8 threads)
 * - Windows 11
 * - SSD storage
 * 
 * All configurations are automatically adjusted based on detected RAM to
 * support both lower and higher spec machines.
 */

import { cpus, totalmem, freemem } from 'os';

const LOG_PREFIX = '[PerformanceConfig]';

// ============================================================================
// Hardware Detection
// ============================================================================

export interface HardwareProfile {
    /** Total RAM in MB */
    totalRamMB: number;
    /** Free RAM in MB */
    freeRamMB: number;
    /** Number of logical CPU cores */
    cpuCores: number;
    /** RAM tier: 'low' (<6GB), 'standard' (6-10GB), 'high' (>10GB) */
    ramTier: 'low' | 'standard' | 'high';
    /** CPU tier: 'low' (<=2 cores), 'standard' (3-6 cores), 'high' (>6 cores) */
    cpuTier: 'low' | 'standard' | 'high';
}

/**
 * Detect current hardware profile
 */
export function detectHardwareProfile(): HardwareProfile {
    const totalRamMB = Math.floor(totalmem() / 1024 / 1024);
    const freeRamMB = Math.floor(freemem() / 1024 / 1024);
    const cpuCores = cpus().length;

    let ramTier: 'low' | 'standard' | 'high';
    if (totalRamMB < 6000) {
        ramTier = 'low';
    } else if (totalRamMB < 10000) {
        ramTier = 'standard';
    } else {
        ramTier = 'high';
    }

    let cpuTier: 'low' | 'standard' | 'high';
    if (cpuCores <= 2) {
        cpuTier = 'low';
    } else if (cpuCores <= 6) {
        cpuTier = 'standard';
    } else {
        cpuTier = 'high';
    }

    return { totalRamMB, freeRamMB, cpuCores, ramTier, cpuTier };
}

// ============================================================================
// Performance Profiles
// ============================================================================

export interface PerformanceProfile {
    // Worker Thread Configuration
    workers: {
        /** Maximum workers per pool */
        maxPoolSize: number;
        /** Minimum workers per pool */
        minPoolSize: number;
        /** Task timeout in ms */
        taskTimeout: number;
    };

    // SQLite Configuration
    sqlite: {
        /** Cache size in pages (negative = pages, positive = KB) */
        cachePages: number;
        /** Memory-mapped I/O size in bytes */
        mmapSize: number;
        /** Busy timeout in ms */
        busyTimeout: number;
    };

    // Processing Configuration
    processing: {
        /** Page size for paginated queries */
        pageSize: number;
        /** Batch size for inserts */
        batchSize: number;
        /** Max rows per transaction */
        maxRowsPerTransaction: number;
        /** Threshold for creating temp indexes */
        tempIndexThreshold: number;
    };

    // Export Configuration
    export: {
        /** Chunk size for streaming exports */
        chunkSize: number;
        /** Enable parallel base export */
        parallelBases: boolean;
        /** ZIP compression level (0-9) */
        compressionLevel: number;
    };
}

/**
 * Get performance profile based on hardware
 */
export function getPerformanceProfile(hardware?: HardwareProfile): PerformanceProfile {
    const hw = hardware || detectHardwareProfile();

    switch (hw.ramTier) {
        case 'low':
            return getLowMemoryProfile(hw);
        case 'high':
            return getHighPerformanceProfile(hw);
        case 'standard':
        default:
            return getStandardProfile(hw);
    }
}

function getLowMemoryProfile(hw: HardwareProfile): PerformanceProfile {
    return {
        workers: {
            maxPoolSize: 2,
            minPoolSize: 1,
            taskTimeout: 600000, // 10 min
        },
        sqlite: {
            cachePages: -25000, // ~100MB
            mmapSize: 256 * 1024 * 1024, // 256MB
            busyTimeout: 60000,
        },
        processing: {
            pageSize: 5000,
            batchSize: 2000,
            maxRowsPerTransaction: 50000,
            tempIndexThreshold: 50000,
        },
        export: {
            chunkSize: 10000,
            parallelBases: false, // Sequential to save memory
            compressionLevel: 4,
        },
    };
}

function getStandardProfile(hw: HardwareProfile): PerformanceProfile {
    // Target: 8GB RAM, i5 8th gen
    return {
        workers: {
            maxPoolSize: Math.min(4, hw.cpuCores - 1),
            minPoolSize: 1,
            taskTimeout: 300000, // 5 min
        },
        sqlite: {
            cachePages: -100000, // ~400MB
            mmapSize: 512 * 1024 * 1024, // 512MB
            busyTimeout: 60000,
        },
        processing: {
            pageSize: 10000,
            batchSize: 5000,
            maxRowsPerTransaction: 100000,
            tempIndexThreshold: 100000,
        },
        export: {
            chunkSize: 25000,
            parallelBases: true,
            compressionLevel: 6,
        },
    };
}

function getHighPerformanceProfile(hw: HardwareProfile): PerformanceProfile {
    return {
        workers: {
            maxPoolSize: Math.min(6, hw.cpuCores - 2),
            minPoolSize: 2,
            taskTimeout: 300000, // 5 min
        },
        sqlite: {
            cachePages: -200000, // ~800MB
            mmapSize: 1024 * 1024 * 1024, // 1GB
            busyTimeout: 60000,
        },
        processing: {
            pageSize: 20000,
            batchSize: 10000,
            maxRowsPerTransaction: 200000,
            tempIndexThreshold: 150000,
        },
        export: {
            chunkSize: 50000,
            parallelBases: true,
            compressionLevel: 6,
        },
    };
}

// ============================================================================
// Singleton Instance
// ============================================================================

let _cachedProfile: PerformanceProfile | null = null;
let _cachedHardware: HardwareProfile | null = null;

/**
 * Get cached performance profile (computed once at startup)
 */
export function getCachedProfile(): PerformanceProfile {
    if (!_cachedProfile) {
        _cachedHardware = detectHardwareProfile();
        _cachedProfile = getPerformanceProfile(_cachedHardware);

        console.log(`${LOG_PREFIX} Hardware detected:`, {
            ram: `${_cachedHardware.totalRamMB}MB (${_cachedHardware.ramTier})`,
            cpu: `${_cachedHardware.cpuCores} cores (${_cachedHardware.cpuTier})`,
        });
        console.log(`${LOG_PREFIX} Performance profile:`, {
            workers: _cachedProfile.workers.maxPoolSize,
            sqliteCache: `${Math.abs(_cachedProfile.sqlite.cachePages) * 4 / 1024}MB`,
            pageSize: _cachedProfile.processing.pageSize,
            parallelExport: _cachedProfile.export.parallelBases,
        });
    }
    return _cachedProfile;
}

/**
 * Get cached hardware profile
 */
export function getCachedHardware(): HardwareProfile {
    if (!_cachedHardware) {
        getCachedProfile(); // This will populate both caches
    }
    return _cachedHardware!;
}

/**
 * Reset cache (useful for testing)
 */
export function resetCache(): void {
    _cachedProfile = null;
    _cachedHardware = null;
}

export default {
    detectHardwareProfile,
    getPerformanceProfile,
    getCachedProfile,
    getCachedHardware,
    resetCache,
};
